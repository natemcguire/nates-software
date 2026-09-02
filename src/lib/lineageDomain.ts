// lineageDomain.ts
//
// Read model for the VIRAL LINEAGE TREE (the embeddable fork family tree + the share
// cards that hang off it). This is a pure read model over the canonical, immutable
// `repository_forks` edges (migration 0006) plus real per-owner earnings from
// `commerce_order_allocations` (migration 0009). It moves no money and mutates nothing.
//
// The design goal is ONE bounded, indexed query for the whole tree — `repository_forks`
// has `idx_repository_forks_root (lineage_root_repository_id, depth)`, so an entire
// lineage family is fetched in a single scan ordered by generation. We deliberately do
// NOT walk generation-by-generation (that would be N sequential D1 subrequests and a
// request→DB amplification vector on a public, unauthenticated endpoint).

export interface LineageTreeNode {
  repositoryId: string;
  appId: string | null;
  /** Best human name for the node: appId ?? repo slug ?? repositoryId. Never a bare UUID
   *  unless there is genuinely nothing better — used for display so the tree/card never
   *  shows a raw `repo_…` id as the product name. */
  displayName: string;
  /** Owner handle without the leading '@' (e.g. "nate"). Null if the owner is unknown. */
  handle: string | null;
  ownerUserId: string;
  /** Depth from the lineage root: 0 = root app, 1 = a direct fork, etc. */
  depth: number;
  /** Immediate parent repository id, or null for the root. */
  parentRepositoryId: string | null;
  /** Number of direct forks of THIS node. */
  forkCount: number;
  /** Cents this node's owner earned FROM THIS LINEAGE, from fulfilled orders only. */
  earnedCents: number;
}

export interface LineageTree {
  rootRepositoryId: string;
  rootAppId: string | null;
  /** Human name for the root app: rootAppId ?? root repo slug ?? repo id. Never a bare UUID if avoidable. */
  rootDisplayName: string;
  /** The repository the caller asked about (the "you are here" node), if resolvable. */
  focusRepositoryId: string | null;
  totalNodes: number;
  totalForks: number;
  /** Sum of earnedCents across every distinct owner in the tree. */
  lineageEarnedCents: number;
  nodes: LineageTreeNode[];
}

// A single tree is bounded so a pathological (free, depth-unbounded) fork chain can't
// turn a public endpoint into an unbounded response. 5000 nodes is far above any real
// lineage and still a small D1 result set.
export const MAX_LINEAGE_TREE_NODES = 5000;

/**
 * Resolve an app id to its canonical repository id. Public share URLs are keyed by the
 * friendly app id (e.g. "dronehunter"); the lineage tree is keyed by repository id.
 * Prefers an active repo; falls back to any repo for the app. Returns null if none.
 */
export async function resolveRepositoryIdForApp(
  db: any,
  appId: string | null | undefined
): Promise<string | null> {
  if (!db || !appId || typeof appId !== 'string' || !appId.trim()) return null;
  const id = appId.trim();
  // The FORWARD link `app_listings.repository_id` is the populated one in prod; the
  // reverse link `repositories.app_id` is often NULL (forge repos created without an
  // app back-reference). Prefer the forward link, then fall back to the reverse one.
  const fwd: any = await db
    .prepare(`SELECT repository_id AS id FROM app_listings WHERE id = ? AND repository_id IS NOT NULL`)
    .bind(id)
    .first();
  if (fwd && fwd.id) return String(fwd.id);

  const row: any = await db
    .prepare(
      `SELECT id FROM repositories
       WHERE app_id = ?
       ORDER BY (status = 'active') DESC, created_at ASC
       LIMIT 1`
    )
    .bind(id)
    .first();
  return row && row.id ? String(row.id) : null;
}

/**
 * Resolve the lineage ROOT repository id for any repository in a family.
 * A root repo (never forked) has no `repository_forks` row as a child, so it is its own
 * root. A forked repo carries `lineage_root_repository_id` on its edge.
 */
export async function resolveLineageRoot(
  db: any,
  repositoryId: string | null | undefined
): Promise<string | null> {
  if (!db || !repositoryId || typeof repositoryId !== 'string' || !repositoryId.trim()) {
    return null;
  }
  const id = repositoryId.trim();
  const edge: any = await db
    .prepare('SELECT lineage_root_repository_id AS root FROM repository_forks WHERE child_repository_id = ?')
    .bind(id)
    .first();
  // No child edge → this repo was never forked FROM another, so it is a root itself.
  return edge && edge.root ? String(edge.root) : id;
}

/**
 * Build the full lineage tree for the family that `repositoryId` belongs to.
 * Returns null if the repository doesn't exist. The returned tree is rooted at the
 * lineage root and includes every descendant fork, each with real handle/app/earnings.
 */
export async function fetchLineageTree(
  db: any,
  repositoryId: string | null | undefined
): Promise<LineageTree | null> {
  if (!db) return null;
  const rootId = await resolveLineageRoot(db, repositoryId);
  if (!rootId) return null;

  // Confirm the root repo exists and grab its app + owner (the root has no fork edge,
  // so its metadata comes from `repositories`, not `repository_forks`).
  const rootRepo: any = await db
    .prepare(
      `SELECT r.id AS repositoryId, r.app_id AS appId, r.slug AS slug, r.owner_user_id AS ownerUserId,
              u.username AS handle
       FROM repositories r
       LEFT JOIN users u ON u.id = r.owner_user_id
       WHERE r.id = ?`
    )
    .bind(rootId)
    .first();
  if (!rootRepo) return null;

  // ONE indexed query for every fork in the family, nearest-generation first.
  const forkRows: any = await db
    .prepare(
      `SELECT f.child_repository_id AS repositoryId,
              f.parent_repository_id AS parentRepositoryId,
              f.depth AS depth,
              r.app_id AS appId,
              r.slug AS slug,
              r.owner_user_id AS ownerUserId,
              u.username AS handle
       FROM repository_forks f
       JOIN repositories r ON r.id = f.child_repository_id
       LEFT JOIN users u ON u.id = r.owner_user_id
       WHERE f.lineage_root_repository_id = ?
       ORDER BY f.depth ASC, f.created_at ASC
       LIMIT ?`
    )
    .bind(rootId, MAX_LINEAGE_TREE_NODES)
    .all();

  const forks: any[] = (forkRows && forkRows.results) || [];

  // Assemble node list: root (depth 0) + every fork.
  const nameFor = (appId: any, slug: any, repoId: string): string =>
    (appId && String(appId)) || (slug && String(slug)) || repoId;

  const nodes: LineageTreeNode[] = [
    {
      repositoryId: String(rootRepo.repositoryId),
      appId: rootRepo.appId ? String(rootRepo.appId) : null,
      displayName: nameFor(rootRepo.appId, rootRepo.slug, String(rootRepo.repositoryId)),
      handle: rootRepo.handle ? String(rootRepo.handle) : null,
      ownerUserId: String(rootRepo.ownerUserId),
      depth: 0,
      parentRepositoryId: null,
      forkCount: 0,
      earnedCents: 0,
    },
    ...forks.map((f) => ({
      repositoryId: String(f.repositoryId),
      appId: f.appId ? String(f.appId) : null,
      displayName: nameFor(f.appId, f.slug, String(f.repositoryId)),
      handle: f.handle ? String(f.handle) : null,
      ownerUserId: String(f.ownerUserId),
      depth: Number(f.depth),
      parentRepositoryId: f.parentRepositoryId ? String(f.parentRepositoryId) : null,
      forkCount: 0,
      earnedCents: 0,
    })),
  ];

  // Compute direct-fork counts by parent (one pass over the edges).
  const forkCountByParent = new Map<string, number>();
  for (const f of forks) {
    const parent = f.parentRepositoryId ? String(f.parentRepositoryId) : null;
    if (parent) forkCountByParent.set(parent, (forkCountByParent.get(parent) || 0) + 1);
  }
  for (const n of nodes) {
    n.forkCount = forkCountByParent.get(n.repositoryId) || 0;
  }

  // Real earnings per owner, earned FROM THIS LINEAGE. Two guards make this number
  // honest and match every other earnings surface (profile.ts, ledger.ts, grants.ts):
  //   1. JOIN commerce_orders + WHERE o.status='fulfilled' — only money actually
  //      collected. Allocation rows are written at order CREATION (status='creating'),
  //      before payment; without this filter a started-then-abandoned or refunded
  //      checkout would inflate the PUBLIC share card with money that was never paid.
  //   2. AND a.source_repository_id IN (this tree's repos) — so "earned across the
  //      lineage" is literally this family's money, not the owner's whole-platform
  //      total (an owner active in two apps would otherwise show app-B money on app-A).
  const ownerIds = Array.from(new Set(nodes.map((n) => n.ownerUserId)));
  const repoIds = nodes.map((n) => n.repositoryId);
  if (ownerIds.length > 0 && repoIds.length > 0) {
    const ownerPh = ownerIds.map(() => '?').join(',');
    const repoPh = repoIds.map(() => '?').join(',');
    const earnRows: any = await db
      .prepare(
        `SELECT a.recipient_user_id AS userId, SUM(a.amount_cents) AS cents
         FROM commerce_order_allocations a
         JOIN commerce_orders o ON o.id = a.order_id
         WHERE a.recipient_user_id IN (${ownerPh})
           AND a.source_repository_id IN (${repoPh})
           AND o.status = 'fulfilled'
         GROUP BY a.recipient_user_id`
      )
      .bind(...ownerIds, ...repoIds)
      .all();
    const earnedByUser = new Map<string, number>();
    for (const row of (earnRows && earnRows.results) || []) {
      earnedByUser.set(String(row.userId), Number(row.cents) || 0);
    }
    for (const n of nodes) {
      n.earnedCents = earnedByUser.get(n.ownerUserId) || 0;
    }
  }

  const focusId =
    repositoryId && typeof repositoryId === 'string' && repositoryId.trim()
      ? repositoryId.trim()
      : null;

  return {
    rootRepositoryId: rootId,
    rootAppId: rootRepo.appId ? String(rootRepo.appId) : null,
    rootDisplayName: nameFor(rootRepo.appId, rootRepo.slug, rootId),
    focusRepositoryId: nodes.some((n) => n.repositoryId === focusId) ? focusId : null,
    totalNodes: nodes.length,
    totalForks: forks.length,
    // lineageEarnedCents counts each distinct OWNER once (a maker who owns two nodes in
    // the tree isn't double-counted — earnedCents is per-owner, summed over distinct owners).
    lineageEarnedCents: Array.from(
      new Map(nodes.map((n) => [n.ownerUserId, n.earnedCents])).values()
    ).reduce((sum, c) => sum + c, 0),
    nodes,
  };
}
