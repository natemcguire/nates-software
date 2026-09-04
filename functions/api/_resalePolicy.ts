import { isValidGitOid } from '../../src/lib/forgeDomain';

type D1Database = { prepare(sql: string): any };

export type ResalePolicyResult =
  | { status: 'clear' }
  | { status: 'blocked'; appId: string }
  | { status: 'unavailable'; error: string };

type KnownCommit = { appId: string; commitOid: string };

async function findBlockedAncestor(db: D1Database, repositoryId: string): Promise<string | null> {
  const row: any = await db.prepare(`
    WITH RECURSIVE ancestors(repository_id) AS (
      SELECT parent_repository_id
      FROM repository_forks
      WHERE child_repository_id = ?
      UNION
      SELECT rf.parent_repository_id
      FROM repository_forks rf
      JOIN ancestors a ON rf.child_repository_id = a.repository_id
    )
    SELECT cp.app_id AS appId
    FROM ancestors a
    JOIN repositories ar ON ar.id = a.repository_id
    JOIN commerce_products cp
      ON cp.repository_id = a.repository_id
      OR (cp.repository_id IS NULL AND cp.app_id = ar.app_id)
    WHERE cp.resale_enabled = 0
    LIMIT 1
  `).bind(repositoryId).first();
  return row?.appId ? String(row.appId) : null;
}

async function listCandidateCommits(db: D1Database, repositoryId: string): Promise<Set<string>> {
  const result = await db.prepare(`
    SELECT commit_oid AS commitOid FROM repository_refs WHERE repository_id = ?
    UNION
    SELECT old_oid FROM repository_ref_events WHERE repository_id = ? AND old_oid IS NOT NULL
    UNION
    SELECT new_oid FROM repository_ref_events WHERE repository_id = ? AND new_oid IS NOT NULL
    UNION
    SELECT parent_commit_oid FROM repository_forks WHERE child_repository_id = ?
    UNION
    SELECT child_initial_commit_oid FROM repository_forks WHERE child_repository_id = ?
    UNION
    SELECT commit_oid FROM build_runs WHERE repository_id = ?
    UNION
    SELECT commit_oid FROM deployment_revisions WHERE repository_id = ?
    UNION
    SELECT ma.input_target_oid
    FROM merge_attempts ma
    JOIN merge_jobs mj ON mj.id = ma.merge_job_id
    WHERE mj.target_repository_id = ?
    UNION
    SELECT ma.result_commit_oid
    FROM merge_attempts ma
    JOIN merge_jobs mj ON mj.id = ma.merge_job_id
    WHERE mj.target_repository_id = ? AND ma.result_commit_oid IS NOT NULL
  `).bind(
    repositoryId,
    repositoryId,
    repositoryId,
    repositoryId,
    repositoryId,
    repositoryId,
    repositoryId,
    repositoryId,
    repositoryId
  ).all();
  return new Set(
    (result.results || [])
      .map((row: any) => String(row.commitOid || ''))
      .filter((oid: string) => isValidGitOid(oid))
  );
}

async function listRestrictedCommits(db: D1Database, repositoryId: string): Promise<KnownCommit[]> {
  const result = await db.prepare(`
    WITH restricted_repositories(repository_id, app_id) AS (
      SELECT DISTINCT r.id, cp.app_id
      FROM commerce_products cp
      JOIN app_listings a ON a.id = cp.app_id
      JOIN repositories r ON (
        r.id = cp.repository_id
        OR r.id = a.repository_id
        OR (cp.repository_id IS NULL AND a.repository_id IS NULL AND r.app_id = cp.app_id)
      )
      WHERE cp.resale_enabled = 0 AND r.id <> ?
    ), restricted_commits(repository_id, commit_oid) AS (
      SELECT rr.repository_id, rr.commit_oid
      FROM repository_refs rr
      JOIN restricted_repositories r ON r.repository_id = rr.repository_id
      UNION
      SELECT re.repository_id, re.old_oid
      FROM repository_ref_events re
      JOIN restricted_repositories r ON r.repository_id = re.repository_id
      WHERE re.old_oid IS NOT NULL
      UNION
      SELECT re.repository_id, re.new_oid
      FROM repository_ref_events re
      JOIN restricted_repositories r ON r.repository_id = re.repository_id
      WHERE re.new_oid IS NOT NULL
      UNION
      SELECT rf.parent_repository_id, rf.parent_commit_oid
      FROM repository_forks rf
      JOIN restricted_repositories r ON r.repository_id = rf.parent_repository_id
      UNION
      SELECT rf.child_repository_id, rf.child_initial_commit_oid
      FROM repository_forks rf
      JOIN restricted_repositories r ON r.repository_id = rf.child_repository_id
      UNION
      SELECT br.repository_id, br.commit_oid
      FROM build_runs br
      JOIN restricted_repositories r ON r.repository_id = br.repository_id
      UNION
      SELECT dr.repository_id, dr.commit_oid
      FROM deployment_revisions dr
      JOIN restricted_repositories r ON r.repository_id = dr.repository_id
      UNION
      SELECT mj.target_repository_id, ma.input_target_oid
      FROM merge_attempts ma
      JOIN merge_jobs mj ON mj.id = ma.merge_job_id
      JOIN restricted_repositories r ON r.repository_id = mj.target_repository_id
      UNION
      SELECT mj.target_repository_id, ma.result_commit_oid
      FROM merge_attempts ma
      JOIN merge_jobs mj ON mj.id = ma.merge_job_id
      JOIN restricted_repositories r ON r.repository_id = mj.target_repository_id
      WHERE ma.result_commit_oid IS NOT NULL
    )
    SELECT DISTINCT r.app_id AS appId, rc.commit_oid AS commitOid
    FROM restricted_commits rc
    JOIN restricted_repositories r ON r.repository_id = rc.repository_id
  `).bind(repositoryId).all();
  return (result.results || [])
    .map((row: any) => ({ appId: String(row.appId || ''), commitOid: String(row.commitOid || '') }))
    .filter((row: KnownCommit) => row.appId && isValidGitOid(row.commitOid));
}

async function inspectGatewayObjects(env: any, repositoryId: string, commits: KnownCommit[]): Promise<ResalePolicyResult> {
  if (!env?.GITSMITH_GATEWAY_URL || !env?.GITSMITH_GATEWAY_TOKEN || commits.length === 0) {
    return { status: 'clear' };
  }
  const repository: any = await env.DB.prepare(`
    SELECT storage_key AS storageKey FROM repositories WHERE id = ?
  `).bind(repositoryId).first();
  if (!repository?.storageKey) {
    return { status: 'unavailable', error: 'Repository provenance could not be verified.' };
  }
  const gatewayFetch: typeof fetch = env.__GITSMITH_GATEWAY_FETCH || env.GITSMITH_GATEWAY_FETCH || fetch;
  const endpoint = new URL('/api/gateway/object-presence', env.GITSMITH_GATEWAY_URL).toString();
  for (let index = 0; index < commits.length; index += 256) {
    const chunk = commits.slice(index, index + 256);
    let response: Response;
    try {
      response = await gatewayFetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITSMITH_GATEWAY_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          storageKey: repository.storageKey,
          commitOids: chunk.map(row => row.commitOid)
        })
      });
    } catch {
      return { status: 'unavailable', error: 'Repository provenance could not be verified.' };
    }
    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      return { status: 'unavailable', error: 'Repository provenance could not be verified.' };
    }
    const payload: any = await response.json().catch(() => null);
    if (!payload || payload.success !== true || (payload.matchedCommitOid !== null && !isValidGitOid(payload.matchedCommitOid))) {
      return { status: 'unavailable', error: 'Repository provenance could not be verified.' };
    }
    if (payload.matchedCommitOid) {
      const match = chunk.find(row => row.commitOid === payload.matchedCommitOid);
      if (match) return { status: 'blocked', appId: match.appId };
    }
  }
  return { status: 'clear' };
}

export async function checkRepositoryResalePolicy(env: any, repositoryId: string): Promise<ResalePolicyResult> {
  const blockedAncestor = await findBlockedAncestor(env.DB, repositoryId);
  if (blockedAncestor) return { status: 'blocked', appId: blockedAncestor };

  const [candidateCommits, restrictedCommits] = await Promise.all([
    listCandidateCommits(env.DB, repositoryId),
    listRestrictedCommits(env.DB, repositoryId)
  ]);
  const exactMatch = restrictedCommits.find(row => candidateCommits.has(row.commitOid));
  if (exactMatch) return { status: 'blocked', appId: exactMatch.appId };

  return inspectGatewayObjects(env, repositoryId, restrictedCommits);
}

export async function checkAppResalePolicy(env: any, appId: string): Promise<ResalePolicyResult> {
  const product: any = await env.DB.prepare(`
    SELECT cp.price_cents AS priceCents,
           COALESCE(cp.repository_id, a.repository_id, (
             SELECT r.id FROM repositories r
             WHERE r.app_id = cp.app_id
             ORDER BY CASE WHEN r.status = 'active' THEN 0 ELSE 1 END, r.created_at ASC
             LIMIT 1
           )) AS repositoryId
    FROM commerce_products cp
    JOIN app_listings a ON a.id = cp.app_id
    WHERE cp.app_id = ?
  `).bind(appId).first();
  if (!product?.repositoryId || Number(product.priceCents) <= 0) return { status: 'clear' };
  return checkRepositoryResalePolicy(env, String(product.repositoryId));
}
