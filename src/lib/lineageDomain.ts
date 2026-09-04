
export interface LineageTreeNode {
  repositoryId: string;
  appId: string | null;
  displayName: string;
  handle: string | null;
  ownerUserId: string;
  depth: number;
  parentRepositoryId: string | null;
  forkCount: number;
  earnedCents: number;
}

export interface LineageTree {
  rootRepositoryId: string;
  rootAppId: string | null;
  rootDisplayName: string;
  focusRepositoryId: string | null;
  totalNodes: number;
  totalForks: number;
  lineageEarnedCents: number;
  nodes: LineageTreeNode[];
}

export const MAX_LINEAGE_TREE_NODES = 5000;

export async function resolveRepositoryIdForApp(
  db: any,
  appId: string | null | undefined
): Promise<string | null> {
  if (!db || !appId || typeof appId !== 'string' || !appId.trim()) return null;
  const id = appId.trim();
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
  return edge && edge.root ? String(edge.root) : id;
}

export async function fetchLineageTree(
  db: any,
  repositoryId: string | null | undefined
): Promise<LineageTree | null> {
  if (!db) return null;
  const rootId = await resolveLineageRoot(db, repositoryId);
  if (!rootId) return null;

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

  const forkCountByParent = new Map<string, number>();
  for (const f of forks) {
    const parent = f.parentRepositoryId ? String(f.parentRepositoryId) : null;
    if (parent) forkCountByParent.set(parent, (forkCountByParent.get(parent) || 0) + 1);
  }
  for (const n of nodes) {
    n.forkCount = forkCountByParent.get(n.repositoryId) || 0;
  }

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
    lineageEarnedCents: Array.from(
      new Map(nodes.map((n) => [n.ownerUserId, n.earnedCents])).values()
    ).reduce((sum, c) => sum + c, 0),
    nodes,
  };
}
