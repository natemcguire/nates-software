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
  /** Owner handle without the leading '@' (e.g. "nate"). Null if the owner is unknown. */
  handle: string | null;
  ownerUserId: string;
  /** Depth from the lineage root: 0 = root app, 1 = a direct fork, etc. */
  depth: number;
  /** Immediate parent repository id, or null for the root. */
  parentRepositoryId: string | null;
  /** Number of direct forks of THIS node. */
  forkCount: number;
  /** Total cents this node's owner has earned across the platform (maker + ancestor). */
  earnedCents: number;
}

export interface LineageTree {
  rootRepositoryId: string;
  rootAppId: string | null;
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
      `SELECT r.id AS repositoryId, r.app_id AS appId, r.owner_user_id AS ownerUserId,
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
  const nodes: LineageTreeNode[] = [
    {
      repositoryId: String(rootRepo.repositoryId),
      appId: rootRepo.appId ? String(rootRepo.appId) : null,
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

  // Real earnings per owner: sum settled allocations for each distinct owner in the
  // tree. One query with an IN-list keyed by the (small, bounded) set of owner ids.
  const ownerIds = Array.from(new Set(nodes.map((n) => n.ownerUserId)));
  if (ownerIds.length > 0) {
    const placeholders = ownerIds.map(() => '?').join(',');
    const earnRows: any = await db
      .prepare(
        `SELECT recipient_user_id AS userId, SUM(amount_cents) AS cents
         FROM commerce_order_allocations
         WHERE recipient_user_id IN (${placeholders})
         GROUP BY recipient_user_id`
      )
      .bind(...ownerIds)
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
