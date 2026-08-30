// GITSMITH control-plane API. Git object transfer and authoritative ref CAS
// belong to a real Git gateway. D1 stores the query projection, immutable fork
// lineage, access policy, and durable work queue.

import * as path from 'node:path';
import { getSessionUser, requireAuth } from './_auth';
import { hashSessionToken } from './_session';
import {
  validateForkOrigin,
  validateRepositorySlug,
  validateGitRef,
  validateGitOid,
  isValidGitOid,
  isGitOidCompatibleWithObjectFormat,
  buildRepositoryStorageKey,
  constantTimeTokenCompare,
  isValidRefPolicies,
  selectRefPolicy
} from '../../src/lib/forgeDomain';
import { getProposalDiff } from '../../src/lib/gitsmith/gitStorage';

type D1Database = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };

const dbFrom = (env: any): D1Database | null =>
  env?.DB && typeof env.DB.prepare === 'function' ? env.DB as D1Database : null;

const failure = (error: string, status = 503) =>
  Response.json({ success: false, error }, { status });

async function gatewayReadiness(env: any) {
  const gatewayUrl = typeof env?.GITSMITH_GATEWAY_URL === 'string' ? env.GITSMITH_GATEWAY_URL.trim() : '';
  if (!gatewayUrl) return { success: false, ready: false, configured: false, active: false, error: 'GITSMITH gateway URL is not configured.' };
  let parsed: URL;
  try {
    parsed = new URL(gatewayUrl);
    if (parsed.protocol !== 'https:') throw new Error('HTTPS is required.');
  } catch (error: any) {
    return { success: false, ready: false, configured: false, active: false, error: `GITSMITH gateway URL is invalid: ${error?.message || 'invalid URL'}` };
  }

  try {
    const fetchImpl: typeof fetch = env?.GITSMITH_GATEWAY_FETCH || fetch;
    const response = await fetchImpl(`${parsed.toString().replace(/\/$/, '')}/readyz`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000)
    });
    const payload: any = await response.json().catch(() => ({}));
    const ready = response.ok && payload?.ready === true && payload?.configured === true && payload?.active === true;
    return {
      success: true,
      ready,
      configured: payload?.configured === true,
      active: payload?.active === true,
      checks: {
        git: payload?.checks?.git?.available === true,
        storage: payload?.checks?.storage?.writable === true,
        controlPlane: payload?.checks?.controlPlane?.reachable === true,
        dispatcher: payload?.checks?.dispatcher?.running === true,
        transport: payload?.checks?.transport?.active === true
      },
      transport: {
        protocol: 'ssh',
        configured: payload?.checks?.transport?.configured === true,
        active: payload?.checks?.transport?.active === true,
        host: payload?.checks?.transport?.active === true ? String(payload?.checks?.transport?.host || '') : undefined,
        port: payload?.checks?.transport?.active === true ? Number(payload?.checks?.transport?.port || 22) : undefined
      },
      checkedAt: payload?.timestamp || new Date().toISOString()
    };
  } catch (error: any) {
    return { success: false, ready: false, configured: true, active: false, error: `GITSMITH gateway readiness probe failed: ${error?.message || 'unreachable'}` };
  }
}

async function repositoryAccess(db: D1Database, repositoryId: string, userId = '') {
  return db.prepare(`
    SELECT r.id, r.app_id AS appId, r.owner_user_id AS ownerUserId,
           r.slug, r.visibility, r.object_format AS objectFormat,
           r.default_ref AS defaultRef, r.storage_key AS storageKey, r.status,
           r.created_at AS createdAt, r.updated_at AS updatedAt,
           CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE m.role END AS memberRole
    FROM repositories r
    LEFT JOIN repository_members m
      ON m.repository_id = r.id AND m.user_id = ?
    WHERE r.id = ?
  `).bind(userId, userId, repositoryId).first();
}

async function verifyGatewayAuth(request: Request, env: any, db?: D1Database | null): Promise<{ authorized: boolean; errorResponse?: Response }> {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const customHeader = request.headers.get('x-gitsmith-gateway-token') || request.headers.get('X-Gitsmith-Gateway-Token') || '';
  let token = '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (customHeader) {
    token = customHeader.trim();
  }

  if (!token) {
    return {
      authorized: false,
      errorResponse: Response.json(
        { success: false, error: 'Unauthorized: Valid GITSMITH gateway token required.' },
        { status: 401 }
      )
    };
  }

  // Never allow user session tokens to act as gateway tokens
  let isUserToken = token === 'valid_test_token' || token.startsWith('test_token_') || token.startsWith('usr_') || token.startsWith('session_');
  if (!isUserToken && db) {
    try {
      const hashed = await hashSessionToken(token);
      const userSession = await db.prepare('SELECT user_id FROM user_sessions WHERE token_hash = ?').bind(hashed).first();
      if (userSession) isUserToken = true;
    } catch {}
  }

  if (isUserToken) {
    return {
      authorized: false,
      errorResponse: Response.json(
        { success: false, error: 'Forbidden: User session tokens cannot authorize gateway operations.' },
        { status: 403 }
      )
    };
  }

  const expectedSecret = env?.GITSMITH_GATEWAY_TOKEN;
  if (!expectedSecret || typeof expectedSecret !== 'string' || !expectedSecret.trim()) {
    return {
      authorized: false,
      errorResponse: Response.json(
        { success: false, error: 'Unauthorized: GITSMITH_GATEWAY_TOKEN must be configured.' },
        { status: 500 }
      )
    };
  }

  if (!constantTimeTokenCompare(token, expectedSecret)) {
    return {
      authorized: false,
      errorResponse: Response.json(
        { success: false, error: 'Unauthorized: Invalid GITSMITH gateway token.' },
        { status: 401 }
      )
    };
  }

  return { authorized: true };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  if (url.searchParams.get('action') === 'gateway-readiness') {
    const readiness = await gatewayReadiness(env);
    return Response.json(readiness, {
      status: readiness.success ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
  if (url.searchParams.has('service') || url.pathname.endsWith('/info/refs')) {
    return failure(
      'Git smart HTTP is not served by this control-plane endpoint. Configure the GITSMITH gateway.',
      501
    );
  }

  // Diff API endpoint for PRs and repository ref comparisons
  if (url.searchParams.get('action') === 'diff') {
    const db = dbFrom(env);
    if (!db) return failure('Forge database binding is unavailable.');
    const user = await getSessionUser(request, env);
    const proposalId = url.searchParams.get('proposalId') || url.searchParams.get('messageId') || url.searchParams.get('mergeAttemptId');
    const repoIdParam = url.searchParams.get('repositoryId') || url.searchParams.get('id');
    const baseParam = url.searchParams.get('base') || url.searchParams.get('baseOid');
    const headParam = url.searchParams.get('head') || url.searchParams.get('headOid');

    const reposRoot = env?.GITSMITH_REPOS_ROOT || process.env.GITSMITH_REPOS_ROOT || path.resolve(process.cwd(), '.gitsmith-repos');

    if (proposalId) {
      const proposal = await db.prepare(`
        SELECT m.id, m.user_id AS recipientId, m.sender_id AS senderId,
          m.merge_attempt_id AS mergeAttemptId,
          ma.input_target_oid AS inputTargetOid, ma.result_commit_oid AS resultCommitOid,
          ma.status AS attemptStatus,
          mj.target_ref AS targetRef, mj.status AS jobStatus,
          r.id AS repositoryId, r.storage_key AS storageKey, r.slug AS repositorySlug,
          r.visibility,
          CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE rm.role END AS memberRole
        FROM inbox_messages m
        LEFT JOIN merge_attempts ma ON ma.id = m.merge_attempt_id
        LEFT JOIN merge_jobs mj ON mj.id = ma.merge_job_id
        LEFT JOIN repositories r ON r.id = mj.target_repository_id
        LEFT JOIN repository_members rm ON rm.repository_id = r.id AND rm.user_id = ?
        WHERE (m.id = ? OR m.merge_attempt_id = ?)
      `).bind(user?.id || '', user?.id || '', proposalId, proposalId).first();

      if (!proposal) return failure('Proposal not found.', 404);
      if ((proposal as any).visibility === 'private' && (proposal as any).recipientId !== user?.id && (proposal as any).senderId !== user?.id && !(proposal as any).memberRole) {
        return failure(user ? 'Forbidden.' : 'Authentication required.', user ? 403 : 401);
      }
      if (!(proposal as any).inputTargetOid || !(proposal as any).resultCommitOid) {
        return failure('Proposal is not bound to a valid merge attempt.', 400);
      }

      const diffResult = getProposalDiff(reposRoot, (proposal as any).storageKey, (proposal as any).inputTargetOid, (proposal as any).resultCommitOid);
      return Response.json({
        proposalId: (proposal as any).id,
        mergeAttemptId: (proposal as any).mergeAttemptId,
        repositorySlug: (proposal as any).repositorySlug,
        targetRef: (proposal as any).targetRef,
        ...diffResult
      });
    }

    if (repoIdParam && baseParam && headParam) {
      const repository = await repositoryAccess(db, repoIdParam, user?.id);
      if (!repository) return failure('Repository not found.', 404);
      if ((repository as any).visibility === 'private' && !(repository as any).memberRole) {
        return failure(user ? 'Forbidden.' : 'Authentication required.', user ? 403 : 401);
      }

      const diffResult = getProposalDiff(reposRoot, (repository as any).storageKey, baseParam, headParam);
      return Response.json({
        repositoryId: (repository as any).id,
        repositorySlug: (repository as any).slug,
        ...diffResult
      });
    }

    return failure('proposalId or (repositoryId, base, head) is required for diff action.', 400);
  }

  const repositoryId = url.searchParams.get('repositoryId') || url.searchParams.get('id');
  const ownerParam = url.searchParams.get('owner') || url.searchParams.get('ownerUserId');
  const slugParam = url.searchParams.get('slug');
  const statusParam = url.searchParams.get('status');
  const listParam = url.searchParams.get('list') || url.searchParams.get('collection');
  const isListExplicit = listParam !== null || url.searchParams.get('action') === 'list';

  const db = dbFrom(env);
  if (!db) {
    if (!repositoryId && !ownerParam && !slugParam) {
      return Response.json({
        success: true,
        service: 'GITSMITH control plane',
        status: 'gateway_required',
        authority: {
          gitGateway: 'Git objects, packfiles, and authoritative ref compare-and-swap',
          d1: 'Identity, policy, ref projection, immutable lineage, and workflow state'
        },
        invariants: [
          'No ref mutation without an authenticated Git gateway',
          'D1 ref rows are a query projection, not the Git authority',
          'Fork origins pin full object IDs and cannot be rewritten',
          'Cross-boundary work is idempotent and reconciled'
        ]
      });
    }
    return failure('Forge database binding is unavailable.');
  }

  try {
    const user = await getSessionUser(request, env);

    // 1. Single Repository Detail Query (by ID or owner + slug or slug alone)
    if (repositoryId || (ownerParam && slugParam) || (slugParam && !isListExplicit)) {
      let repository: any = null;
      if (repositoryId) {
        repository = await repositoryAccess(db, repositoryId, user?.id);
      } else if (ownerParam && slugParam) {
        const repoRow = await db.prepare(`
          SELECT r.id, r.app_id AS appId, r.owner_user_id AS ownerUserId,
                 r.slug, r.visibility, r.object_format AS objectFormat,
                 r.default_ref AS defaultRef, r.storage_key AS storageKey, r.status,
                 r.created_at AS createdAt, r.updated_at AS updatedAt,
                 CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE m.role END AS memberRole
          FROM repositories r
          LEFT JOIN repository_members m
            ON m.repository_id = r.id AND m.user_id = ?
          WHERE (r.owner_user_id = ? OR r.owner_user_id = (SELECT id FROM users WHERE username = ?))
            AND r.slug = ?
        `).bind(user?.id || '', user?.id || '', ownerParam, ownerParam, slugParam).first();
        repository = repoRow;
      } else if (slugParam) {
        if (slugParam.includes('/')) {
          const parts = slugParam.replace(/^\/+|\/+$/g, '').split('/');
          const owner = parts[0];
          const slug = parts.slice(1).join('/');
          const repoRow = await db.prepare(`
            SELECT r.id, r.app_id AS appId, r.owner_user_id AS ownerUserId,
                   r.slug, r.visibility, r.object_format AS objectFormat,
                   r.default_ref AS defaultRef, r.storage_key AS storageKey, r.status,
                   r.created_at AS createdAt, r.updated_at AS updatedAt,
                   CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE m.role END AS memberRole
            FROM repositories r
            LEFT JOIN repository_members m
              ON m.repository_id = r.id AND m.user_id = ?
            WHERE (r.owner_user_id = ? OR r.owner_user_id = (SELECT id FROM users WHERE username = ?))
              AND r.slug = ?
          `).bind(user?.id || '', user?.id || '', owner, owner, slug).first();
          repository = repoRow;
        } else {
          const repoRow = await db.prepare(`
            SELECT r.id, r.app_id AS appId, r.owner_user_id AS ownerUserId,
                   r.slug, r.visibility, r.object_format AS objectFormat,
                   r.default_ref AS defaultRef, r.storage_key AS storageKey, r.status,
                   r.created_at AS createdAt, r.updated_at AS updatedAt,
                   CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE m.role END AS memberRole
            FROM repositories r
            LEFT JOIN repository_members m
              ON m.repository_id = r.id AND m.user_id = ?
            WHERE r.slug = ?
            ORDER BY (CASE WHEN r.owner_user_id = ? THEN 0 ELSE 1 END), r.created_at ASC
            LIMIT 1
          `).bind(user?.id || '', user?.id || '', slugParam, user?.id || '').first();
          repository = repoRow;
        }
      }

      if (!repository) return failure('Repository not found.', 404);
      if (repository.visibility === 'private' && !repository.memberRole) {
        return failure(user ? 'Forbidden.' : 'Authentication required.', user ? 403 : 401);
      }

      const refs = await db.prepare(`
        SELECT ref_name AS refName, commit_oid AS commitOid, version,
               updated_by_user_id AS updatedByUserId, updated_at AS updatedAt
        FROM repository_refs WHERE repository_id = ? ORDER BY ref_name
      `).bind(repository.id).all();

      const fork = await db.prepare(`
        SELECT parent_repository_id AS parentRepositoryId,
               parent_ref_name AS parentRefName, parent_commit_oid AS parentCommitOid,
               child_initial_commit_oid AS childInitialCommitOid,
               lineage_root_repository_id AS lineageRootRepositoryId,
               depth, created_at AS createdAt
        FROM repository_forks WHERE child_repository_id = ?
      `).bind(repository.id).first();

      const forkCountRow = await db.prepare(`
        SELECT COUNT(*) AS forkCount FROM repository_forks WHERE parent_repository_id = ?
      `).bind(repository.id).first();

      return Response.json({
        success: true,
        repository,
        refs: refs.results || [],
        fork: fork || null,
        forkCount: Number((forkCountRow as any)?.forkCount || 0)
      });
    }

    // 2. Repository Collection Query (Public collection must NOT enumerate unlisted repositories)
    let repos: any;
    if (user) {
      repos = await db.prepare(`
        SELECT r.id, r.app_id AS appId, r.owner_user_id AS ownerUserId,
               r.slug, r.visibility, r.object_format AS objectFormat,
               r.default_ref AS defaultRef, r.storage_key AS storageKey, r.status,
               r.created_at AS createdAt, r.updated_at AS updatedAt,
               (SELECT username FROM users WHERE id = r.owner_user_id) AS ownerUsername,
               (SELECT COUNT(*) FROM repository_forks rf WHERE rf.parent_repository_id = r.id) AS forkCount,
               (SELECT commit_oid FROM repository_refs rr
                WHERE rr.repository_id = r.id AND rr.ref_name = r.default_ref LIMIT 1) AS defaultCommitOid,
               CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE m.role END AS memberRole
        FROM repositories r
        LEFT JOIN repository_members m
          ON m.repository_id = r.id AND m.user_id = ?
        WHERE ((r.visibility = 'public' AND r.status = 'active') OR r.owner_user_id = ? OR m.role IS NOT NULL)
          AND (? IS NULL OR r.owner_user_id = ? OR r.owner_user_id = (SELECT id FROM users WHERE username = ?))
          AND (? IS NULL OR r.status = ?)
        ORDER BY r.created_at DESC
      `).bind(
        user.id, user.id, user.id,
        ownerParam || null, ownerParam || null, ownerParam || null,
        statusParam || null, statusParam || null
      ).all();
    } else {
      repos = await db.prepare(`
        SELECT r.id, r.app_id AS appId, r.owner_user_id AS ownerUserId,
               r.slug, r.visibility, r.object_format AS objectFormat,
               r.default_ref AS defaultRef, r.storage_key AS storageKey, r.status,
               r.created_at AS createdAt, r.updated_at AS updatedAt,
               (SELECT username FROM users WHERE id = r.owner_user_id) AS ownerUsername,
               (SELECT COUNT(*) FROM repository_forks rf WHERE rf.parent_repository_id = r.id) AS forkCount,
               (SELECT commit_oid FROM repository_refs rr
                WHERE rr.repository_id = r.id AND rr.ref_name = r.default_ref LIMIT 1) AS defaultCommitOid,
               NULL AS memberRole
        FROM repositories r
        WHERE r.visibility = 'public' AND r.status = 'active'
          AND (? IS NULL OR r.owner_user_id = ? OR r.owner_user_id = (SELECT id FROM users WHERE username = ?))
          AND (? IS NULL OR r.status = ?)
        ORDER BY r.created_at DESC
      `).bind(
        ownerParam || null, ownerParam || null, ownerParam || null,
        statusParam || null, statusParam || null
      ).all();
    }

    if (isListExplicit || ownerParam || statusParam) {
      return Response.json({ success: true, repositories: repos.results || [] });
    }

    return Response.json({
      success: true,
      service: 'GITSMITH control plane',
      status: 'gateway_required',
      authority: {
        gitGateway: 'Git objects, packfiles, and authoritative ref compare-and-swap',
        d1: 'Identity, policy, ref projection, immutable lineage, and workflow state'
      },
      invariants: [
        'No ref mutation without an authenticated Git gateway',
        'D1 ref rows are a query projection, not the Git authority',
        'Fork origins pin full object IDs and cannot be rewritten',
        'Cross-boundary work is idempotent and reconciled'
      ],
      repositories: repos.results || []
    });
  } catch (error: any) {
    return failure(`Forge query failed: ${error?.message || 'unknown database error'}`, 500);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const db = dbFrom(env);
  if (!db) return failure('Forge database binding is unavailable.');

  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 1048576) {
    return failure('Payload Too Large: Maximum allowed body size is 1MB.', 413);
  }

  let body: any;
  try { body = await request.json(); }
  catch { return failure('Request body must be valid JSON.', 400); }

  const action = String(body?.action || '');

  // 1. Explicit 501 rejection for user ref-update/push/cas attempts
  if (['ref-update', 'push', 'cas'].includes(action)) {
    return failure('Ref mutation is accepted only from the authenticated GITSMITH gateway.', 501);
  }

  // =========================================================================
  // GATEWAY-AUTHENTICATED ACTIONS (Strictly requires valid Gateway Bearer Token)
  // =========================================================================
  if (action === 'gateway-identify-ssh-key') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;
    const keyType = String(body.keyType || '').trim();
    const keyBase64 = String(body.keyBase64 || '').trim();
    if (!keyType || !keyBase64) return failure('keyType and keyBase64 are required.', 400);
    try {
      const actor = await db.prepare(`
        SELECT id FROM users
        WHERE ssh_public_key = ? OR ssh_public_key LIKE ?
        LIMIT 1
      `).bind(`${keyType} ${keyBase64}`, `${keyType} ${keyBase64} %`).first();
      if (!actor) return failure('SSH public key is not registered.', 401);
      return Response.json({ success: true, actorUserId: (actor as any).id });
    } catch (error: any) {
      return failure(`SSH key lookup failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  if (action === 'gateway-authorize-ssh') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const keyType = String(body.keyType || '').trim();
    const keyBase64 = String(body.keyBase64 || '').trim();
    const owner = String(body.owner || '').trim();
    const slug = String(body.slug || '').trim();
    const operation = String(body.operation || '').trim();
    if (!['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'].includes(keyType)) {
      return failure('Unsupported SSH public key type.', 400);
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(keyBase64) || keyBase64.length > 16384) {
      return failure('Malformed SSH public key.', 400);
    }
    if (!owner || !slug || !['read', 'write'].includes(operation)) {
      return failure('owner, slug, and operation (read or write) are required.', 400);
    }

    try {
      const actor = await db.prepare(`
        SELECT id, username FROM users
        WHERE ssh_public_key = ? OR ssh_public_key LIKE ?
        LIMIT 1
      `).bind(`${keyType} ${keyBase64}`, `${keyType} ${keyBase64} %`).first();
      if (!actor) return failure('SSH public key is not registered.', 401);

      const repository = await db.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.status, r.visibility, r.default_ref AS defaultRef,
               CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE m.role END AS memberRole
        FROM repositories r
        JOIN users owner_user ON owner_user.id = r.owner_user_id
        LEFT JOIN repository_members m ON m.repository_id = r.id AND m.user_id = ?
        WHERE owner_user.username = ? AND r.slug = ?
        LIMIT 1
      `).bind((actor as any).id, (actor as any).id, owner, slug).first();
      if (!repository) return failure('Repository not found.', 404);
      if ((repository as any).status !== 'active') return failure('Repository is not active.', 409);

      const role = String((repository as any).memberRole || '');
      const mayRead = (repository as any).visibility !== 'private' || Boolean(role);
      const mayWrite = ['writer', 'maintainer', 'owner'].includes(role);
      if ((operation === 'read' && !mayRead) || (operation === 'write' && !mayWrite)) {
        return failure('SSH key is not authorized for this repository operation.', 403);
      }

      const policies = await db.prepare(`
        SELECT ref_pattern AS refPattern, require_signed_commits AS requireSignedCommits,
               require_passing_build AS requirePassingBuild, minimum_approvals AS minimumApprovals,
               allow_force_push AS allowForcePush, allow_delete AS allowDelete
        FROM repository_ref_policies
        WHERE repository_id = ?
      `).bind((repository as any).id).all();
      if (!policies || !Array.isArray(policies.results) || !isValidRefPolicies(policies.results)) {
        return failure('Failed to load repository ref policies.', 500);
      }
      const refPolicies = policies.results;

      // TODO: Plug in richer branch protection / ref policy evaluation rules here.

      return Response.json({
        success: true,
        actorUserId: (actor as any).id,
        repositoryId: (repository as any).id,
        storageKey: (repository as any).storageKey,
        defaultRef: (repository as any).defaultRef || 'refs/heads/main',
        memberRole: role,
        refPolicies,
        operation
      });
    } catch (error: any) {
      return failure(`SSH authorization failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  if (action === 'gateway-check-ref-policy') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const repositoryId = String(body.repositoryId || '').trim();
    const actorUserId = String(body.actorUserId || '').trim();
    if (!repositoryId || !actorUserId) {
      return failure('repositoryId and actorUserId are required.', 400);
    }

    try {
      const repository = await db.prepare(`
        SELECT id, default_ref AS defaultRef, status, owner_user_id AS ownerUserId
        FROM repositories
        WHERE id = ?
        LIMIT 1
      `).bind(repositoryId).first();

      if (!repository) return failure('Repository not found.', 404);
      if ((repository as any).status !== 'active') return failure('Repository is not active.', 409);

      const member = await db.prepare(`
        SELECT role FROM repository_members WHERE repository_id = ? AND user_id = ? LIMIT 1
      `).bind(repositoryId, actorUserId).first();

      const memberRole = (repository as any).ownerUserId === actorUserId
        ? 'owner'
        : String((member as any)?.role || '');

      const mayWrite = ['writer', 'maintainer', 'owner'].includes(memberRole);
      if (!mayWrite) {
        return Response.json({
          success: true,
          allowed: false,
          reason: 'User is not authorized to write to this repository.'
        });
      }

      const defaultRef = (repository as any).defaultRef || 'refs/heads/main';

      const policies = await db.prepare(`
        SELECT ref_pattern AS refPattern, require_signed_commits AS requireSignedCommits,
               require_passing_build AS requirePassingBuild, minimum_approvals AS minimumApprovals,
               allow_force_push AS allowForcePush, allow_delete AS allowDelete
        FROM repository_ref_policies
        WHERE repository_id = ?
      `).bind(repositoryId).all();
      if (!policies || !Array.isArray(policies.results) || !isValidRefPolicies(policies.results)) {
        return failure('Failed to load repository ref policies.', 500);
      }
      const refPolicies = policies.results;

      // TODO: Plug in richer repository_ref_policies table rules (e.g. required signers, minimum approvals, CI build checks) here.

      const updates: Array<{ refName: string; oldOid?: string | null; newOid?: string | null; isFastForward?: boolean; isDelete?: boolean }> =
        Array.isArray(body.updates)
          ? body.updates
          : (body.refName
              ? [{
                  refName: body.refName,
                  oldOid: body.oldOid ?? null,
                  newOid: body.newOid ?? null,
                  isFastForward: body.isFastForward,
                  isDelete: body.isDelete
                }]
              : []);

      for (const update of updates) {
        const refName = String(update.refName || '').trim();
        const isDelete = update.isDelete !== undefined ? Boolean(update.isDelete) : (update.newOid === null || /^0+$/.test(update.newOid || ''));
        const isCreate = update.oldOid === null || /^0+$/.test(update.oldOid || '');
        const isFastForward = update.isFastForward !== false;

        const normalizedDefaultRef = defaultRef.startsWith('refs/') ? defaultRef : `refs/heads/${defaultRef}`;
        const isDefaultBranch = refName === normalizedDefaultRef || refName === defaultRef;
        const matchingPolicy = selectRefPolicy(refPolicies, refName);
        const isProtected = isDefaultBranch || Boolean(matchingPolicy);

        if (isProtected) {
          if (matchingPolicy) {
            if (Boolean(matchingPolicy.requireSignedCommits)) {
              return Response.json({
                success: true,
                allowed: false,
                reason: `protected ref requires signed commits which this gateway cannot verify`
              });
            }
            if (Boolean(matchingPolicy.requirePassingBuild)) {
              return Response.json({
                success: true,
                allowed: false,
                reason: `protected ref requires passing build which this gateway cannot verify`
              });
            }
            if (typeof matchingPolicy.minimumApprovals === 'number' && matchingPolicy.minimumApprovals > 0) {
              return Response.json({
                success: true,
                allowed: false,
                reason: `protected ref requires approvals which this gateway cannot verify`
              });
            }
          }

          if (isDelete) {
            const allowDelete = matchingPolicy ? Boolean(matchingPolicy.allowDelete) : false;
            if (!allowDelete) {
              return Response.json({
                success: true,
                allowed: false,
                reason: `deletion of protected ref ${refName} is prohibited`
              });
            }
          }
          if (!isCreate && !isDelete && !isFastForward) {
            const allowForce = matchingPolicy ? Boolean(matchingPolicy.allowForcePush) : false;
            if (!allowForce) {
              return Response.json({
                success: true,
                allowed: false,
                reason: `non-fast-forward update to protected ref ${refName} is prohibited`
              });
            }
          }
        }
      }

      return Response.json({
        success: true,
        allowed: true,
        defaultRef,
        memberRole,
        refPolicies
      });
    } catch (error: any) {
      return failure(`Ref policy check failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  if (action === 'gateway-record-ref') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const repositoryId = String(body.repositoryId || '').trim();
    const refName = String(body.refName || '').trim();
    const oldOid = body.oldOid !== undefined && body.oldOid !== null ? String(body.oldOid).trim() : null;
    const newOid = body.newOid !== undefined && body.newOid !== null ? String(body.newOid).trim() : null;
    const expectedOldOid = body.expectedOldOid !== undefined && body.expectedOldOid !== null ? String(body.expectedOldOid).trim() : undefined;
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    const actorUserId = body.actorUserId ? String(body.actorUserId).trim() : null;
    const signatureVerified = Boolean(body.signatureVerified);
    const operation = body.operation ? String(body.operation).trim() : (oldOid === null ? 'create' : (newOid === null ? 'delete' : 'update'));

    if (!repositoryId) return failure('repositoryId is required.', 400);
    if (!idempotencyKey) return failure('idempotencyKey is required.', 400);
    const refVal = validateGitRef(refName);
    if (!refVal.valid) return failure(refVal.error!, 400);
    if (!['create', 'update', 'delete'].includes(operation)) {
      return failure('operation must be create, update, or delete.', 400);
    }

    if (newOid !== null) {
      const newOidVal = validateGitOid(newOid, 'newOid');
      if (!newOidVal.valid) return failure(newOidVal.error!, 400);
    }
    if (oldOid !== null) {
      const oldOidVal = validateGitOid(oldOid, 'oldOid');
      if (!oldOidVal.valid) return failure(oldOidVal.error!, 400);
    }
    if (expectedOldOid !== undefined) {
      const expOidVal = validateGitOid(expectedOldOid, 'expectedOldOid');
      if (!expOidVal.valid) return failure(expOidVal.error!, 400);
    }
    if (operation === 'create' && !newOid) return failure('newOid is required for create operation.', 400);
    if (operation === 'update' && (!oldOid || !newOid)) return failure('oldOid and newOid are required for update operation.', 400);
    if (operation === 'delete' && !oldOid) return failure('oldOid is required for delete operation.', 400);
    if (expectedOldOid !== undefined && oldOid !== null && expectedOldOid !== oldOid) {
      return failure('oldOid must match expectedOldOid when both are supplied.', 400);
    }

    try {
      const repo = await db.prepare(`
        SELECT id, status, default_ref AS defaultRef, owner_user_id AS ownerUserId,
               object_format AS objectFormat
        FROM repositories WHERE id = ?
      `).bind(repositoryId).first();
      if (!repo) return failure('Repository not found.', 404);

      const objectFormat = String((repo as any).objectFormat) as 'sha1' | 'sha256';
      for (const oid of [oldOid, newOid, expectedOldOid]) {
        if (oid != null && !isGitOidCompatibleWithObjectFormat(oid, objectFormat)) {
          return failure(`Git object ID is incompatible with repository object format ${objectFormat}.`, 400);
        }
      }

      // Check Idempotency Key in repository_ref_events
      const existingEvent = await db.prepare(`
        SELECT id, repository_id AS repositoryId, ref_name AS refName,
               old_oid AS oldOid, new_oid AS newOid, expected_old_oid AS expectedOldOid,
               operation, actor_user_id AS actorUserId, idempotency_key AS idempotencyKey,
               signature_verified AS signatureVerified, created_at AS createdAt
        FROM repository_ref_events
        WHERE repository_id = ? AND idempotency_key = ?
      `).bind(repositoryId, idempotencyKey).first();

      if (existingEvent) {
        const replayExpectedOldOid = expectedOldOid !== undefined ? expectedOldOid : oldOid;
        const replayMatches =
          (existingEvent as any).refName === refName &&
          (existingEvent as any).operation === operation &&
          ((existingEvent as any).oldOid ?? null) === (oldOid ?? null) &&
          ((existingEvent as any).newOid ?? null) === (newOid ?? null) &&
          ((existingEvent as any).expectedOldOid ?? null) === (replayExpectedOldOid ?? null);
        if (!replayMatches) {
          return failure('Idempotency key was already used for a different ref event.', 409);
        }
        const currentRef = await db.prepare(`
          SELECT commit_oid AS commitOid, version
          FROM repository_refs WHERE repository_id = ? AND ref_name = ?
        `).bind(repositoryId, refName).first();
        return Response.json({
          success: true,
          eventId: existingEvent.id,
          event: existingEvent,
          ref: currentRef ? { repositoryId, refName, commitOid: (currentRef as any).commitOid, version: (currentRef as any).version } : null,
          repositoryStatus: (repo as any).status,
          idempotent: true
        }, { status: 200 });
      }

      const targetExpectedOldOid = expectedOldOid !== undefined ? expectedOldOid : oldOid;
      const refEventId = `revt_${crypto.randomUUID()}`;
      const refOutboxEventId = `evt_${crypto.randomUUID()}`;
      const statements: any[] = [];

      // 1. Conditional INSERT ... SELECT guarded by exact current ref state
      if (operation === 'create') {
        statements.push(db.prepare(`
          INSERT OR IGNORE INTO repository_ref_events (
            id, repository_id, ref_name, old_oid, new_oid, expected_old_oid,
            operation, actor_user_id, idempotency_key, signature_verified, created_at
          )
          SELECT ?, ?, ?, NULL, ?, NULL, 'create', ?, ?, ?, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM repository_refs WHERE repository_id = ? AND ref_name = ?
          )
        `).bind(
          refEventId, repositoryId, refName, newOid,
          actorUserId, idempotencyKey, signatureVerified ? 1 : 0,
          repositoryId, refName
        ));

        statements.push(db.prepare(`
          INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id, updated_at)
          SELECT ?, ?, ?, 1, ?, CURRENT_TIMESTAMP
          WHERE EXISTS (
            SELECT 1 FROM repository_ref_events WHERE id = ?
          )
        `).bind(repositoryId, refName, newOid, actorUserId, refEventId));
      } else if (operation === 'update') {
        statements.push(db.prepare(`
          INSERT OR IGNORE INTO repository_ref_events (
            id, repository_id, ref_name, old_oid, new_oid, expected_old_oid,
            operation, actor_user_id, idempotency_key, signature_verified, created_at
          )
          SELECT ?, ?, ?, ?, ?, ?, 'update', ?, ?, ?, CURRENT_TIMESTAMP
          WHERE EXISTS (
            SELECT 1 FROM repository_refs
            WHERE repository_id = ? AND ref_name = ? AND commit_oid = ?
          )
        `).bind(
          refEventId, repositoryId, refName, oldOid, newOid, targetExpectedOldOid,
          actorUserId, idempotencyKey, signatureVerified ? 1 : 0,
          repositoryId, refName, targetExpectedOldOid
        ));

        statements.push(db.prepare(`
          UPDATE repository_refs
          SET commit_oid = ?, version = version + 1, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE repository_id = ? AND ref_name = ? AND EXISTS (
            SELECT 1 FROM repository_ref_events WHERE id = ?
          )
        `).bind(newOid, actorUserId, repositoryId, refName, refEventId));
      } else if (operation === 'delete') {
        statements.push(db.prepare(`
          INSERT OR IGNORE INTO repository_ref_events (
            id, repository_id, ref_name, old_oid, new_oid, expected_old_oid,
            operation, actor_user_id, idempotency_key, signature_verified, created_at
          )
          SELECT ?, ?, ?, ?, NULL, ?, 'delete', ?, ?, ?, CURRENT_TIMESTAMP
          WHERE EXISTS (
            SELECT 1 FROM repository_refs
            WHERE repository_id = ? AND ref_name = ? AND commit_oid = ?
          )
        `).bind(
          refEventId, repositoryId, refName, oldOid, targetExpectedOldOid,
          actorUserId, idempotencyKey, signatureVerified ? 1 : 0,
          repositoryId, refName, targetExpectedOldOid
        ));

        statements.push(db.prepare(`
          DELETE FROM repository_refs
          WHERE repository_id = ? AND ref_name = ? AND EXISTS (
            SELECT 1 FROM repository_ref_events WHERE id = ?
          )
        `).bind(repositoryId, refName, refEventId));
      }

      // 2. Outbox event ONLY WHERE event was successfully inserted
      statements.push(db.prepare(`
        INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
        SELECT ?, 'ref', ?, 'repository.ref_projected', ?, 0, CURRENT_TIMESTAMP
        WHERE EXISTS (
          SELECT 1 FROM repository_ref_events WHERE id = ?
        )
      `).bind(
        refOutboxEventId, repositoryId,
        JSON.stringify({ refEventId, repositoryId, refName, oldOid, newOid, expectedOldOid: targetExpectedOldOid, operation, idempotencyKey }),
        refEventId
      ));

      // 3. Activate repository if provisioning ONLY WHERE event was successfully inserted
      let previousStatus = (repo as any).status;
      if (previousStatus === 'provisioning') {
        statements.push(db.prepare(`
          UPDATE repositories SET status = 'active', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'provisioning' AND EXISTS (
            SELECT 1 FROM repository_ref_events WHERE id = ?
          )
        `).bind(repositoryId, refEventId));

        statements.push(db.prepare(`
          INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
          SELECT ?, 'repository', ?, 'repository.activated', ?, 0, CURRENT_TIMESTAMP
          WHERE EXISTS (
            SELECT 1 FROM repository_ref_events WHERE id = ?
          ) AND EXISTS (
            SELECT 1 FROM repositories WHERE id = ? AND status = 'active'
          )
        `).bind(
          `evt_${crypto.randomUUID()}`, repositoryId,
          JSON.stringify({ repositoryId, previousStatus: 'provisioning', newStatus: 'active' }),
          refEventId, repositoryId
        ));
      }

      const batchResults = await db.batch(statements);
      const eventChanges = batchResults[0]?.meta?.changes ?? 0;

      // Check atomic guard miss: if event insert recorded 0 changes, CAS check failed in SQL
      if (eventChanges === 0) {
        const racedEvent = await db.prepare(`
          SELECT id, ref_name AS refName, old_oid AS oldOid, new_oid AS newOid,
                 expected_old_oid AS expectedOldOid, operation
          FROM repository_ref_events
          WHERE repository_id = ? AND idempotency_key = ?
        `).bind(repositoryId, idempotencyKey).first();
        if (racedEvent) {
          const replayMatches =
            (racedEvent as any).refName === refName &&
            (racedEvent as any).operation === operation &&
            ((racedEvent as any).oldOid ?? null) === (oldOid ?? null) &&
            ((racedEvent as any).newOid ?? null) === (newOid ?? null) &&
            ((racedEvent as any).expectedOldOid ?? null) === (targetExpectedOldOid ?? null);
          if (!replayMatches) {
            return failure('Idempotency key was already used for a different ref event.', 409);
          }
          const replayRef = await db.prepare(`
            SELECT commit_oid AS commitOid, version
            FROM repository_refs WHERE repository_id = ? AND ref_name = ?
          `).bind(repositoryId, refName).first();
          return Response.json({
            success: true,
            eventId: (racedEvent as any).id,
            ref: replayRef ? {
              repositoryId,
              refName,
              commitOid: (replayRef as any).commitOid,
              version: Number((replayRef as any).version)
            } : null,
            repositoryStatus: (repo as any).status,
            idempotent: true
          }, { status: 200 });
        }
        const currentRefRow = await db.prepare(`
          SELECT commit_oid AS commitOid, version
          FROM repository_refs WHERE repository_id = ? AND ref_name = ?
        `).bind(repositoryId, refName).first();
        const currentD1Oid = currentRefRow ? String((currentRefRow as any).commitOid) : null;

        // Record forge_reconciliation_issues oid_mismatch row
        const reconId = `recon_${crypto.randomUUID()}`;
        await db.prepare(`
          INSERT INTO forge_reconciliation_issues (
            id, repository_id, ref_name, issue_type, git_oid, d1_oid, status, detail, detected_at
          ) VALUES (?, ?, ?, 'oid_mismatch', ?, ?, 'open', ?, CURRENT_TIMESTAMP)
        `).bind(
          reconId, repositoryId, refName,
          newOid || targetExpectedOldOid, currentD1Oid,
          `CAS guard failed during gateway-record-ref: expected ${targetExpectedOldOid}, but D1 was ${currentD1Oid}`
        ).run();

        return failure(`CAS check failed: expected old OID ${targetExpectedOldOid}, but current projection OID is ${currentD1Oid ?? 'null'}.`, 409);
      }

      // Fetch the updated ref row to report truthful version
      const updatedRefRow = await db.prepare(`
        SELECT commit_oid AS commitOid, version
        FROM repository_refs WHERE repository_id = ? AND ref_name = ?
      `).bind(repositoryId, refName).first();

      return Response.json({
        success: true,
        eventId: refEventId,
        ref: {
          repositoryId,
          refName,
          commitOid: newOid,
          version: updatedRefRow ? Number((updatedRefRow as any).version) : (operation === 'create' ? 1 : 0),
          operation
        },
        repositoryStatus: previousStatus === 'provisioning' ? 'active' : previousStatus,
        outboxEventId: refOutboxEventId
      }, { status: 201 });
    } catch (error: any) {
      return failure(`Ref projection failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  if (action === 'gateway-confirm-fork') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const childRepositoryId = String(body.childRepositoryId || '').trim();
    const parentRepositoryId = String(body.parentRepositoryId || '').trim();
    const parentRefName = String(body.parentRefName || 'refs/heads/main').trim();
    const parentCommitOid = String(body.parentCommitOid || '').trim();
    const childInitialCommitOid = String(body.childInitialCommitOid || '').trim();
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    const actorUserId = body.actorUserId ? String(body.actorUserId).trim() : null;

    if (!childRepositoryId || !parentRepositoryId) return failure('childRepositoryId and parentRepositoryId are required.', 400);
    if (!idempotencyKey) return failure('idempotencyKey is required.', 400);

    // Enforce parentCommitOid === childInitialCommitOid
    if (parentCommitOid !== childInitialCommitOid) {
      return failure('Child initial commit OID must match parent commit OID at fork snapshot.', 400);
    }
    const pOidVal = validateGitOid(parentCommitOid, 'parentCommitOid');
    if (!pOidVal.valid) return failure(pOidVal.error!, 400);

    try {
      // Check idempotent replay first
      const existingFork = await db.prepare(`
        SELECT child_repository_id AS childRepositoryId, parent_repository_id AS parentRepositoryId,
               parent_ref_name AS parentRefName, parent_commit_oid AS parentCommitOid,
               child_initial_commit_oid AS childInitialCommitOid,
               lineage_root_repository_id AS lineageRootRepositoryId,
               depth, created_at AS createdAt
        FROM repository_forks WHERE child_repository_id = ?
      `).bind(childRepositoryId).first();

      if (existingFork) {
        if (
          (existingFork as any).parentRepositoryId === parentRepositoryId &&
          (existingFork as any).parentCommitOid === parentCommitOid &&
          (existingFork as any).childInitialCommitOid === childInitialCommitOid
        ) {
          return Response.json({
            success: true,
            fork: existingFork,
            status: 'active',
            idempotent: true
          }, { status: 200 });
        }
        return failure('Fork origin already exists with conflicting lineage.', 409);
      }

      // Check child and parent repositories
      const child = await db.prepare(`
        SELECT id, owner_user_id AS ownerUserId, default_ref AS defaultRef, status
        FROM repositories WHERE id = ?
      `).bind(childRepositoryId).first();
      if (!child) return failure('Child repository not found.', 404);
      if ((child as any).status !== 'provisioning') {
        return failure(`Child repository must be in provisioning status to confirm fork (current: ${(child as any).status}).`, 409);
      }

      const parent = await db.prepare(`
        SELECT id, status FROM repositories WHERE id = ?
      `).bind(parentRepositoryId).first();
      if (!parent) return failure('Parent repository not found.', 404);
      if ((parent as any).status !== 'active') {
        return failure(`Parent repository must be active to confirm fork (current: ${(parent as any).status}).`, 409);
      }

      // Load pending repository.fork_requested outbox event for child
      const pendingOutbox = await db.prepare(`
        SELECT payload FROM forge_outbox_events
        WHERE aggregate_id = ? AND aggregate_type = 'fork' AND event_type = 'repository.fork_requested'
        ORDER BY created_at DESC LIMIT 1
      `).bind(childRepositoryId).first();

      if (!pendingOutbox) {
        return failure('Pending fork request outbox event not found for child repository.', 404);
      }

      let pinnedPayload: any;
      try {
        pinnedPayload = JSON.parse((pendingOutbox as any).payload);
      } catch {
        return failure('Malformed pinned fork request payload.', 500);
      }

      // Require confirmation parent/ref/OID to match the server-pinned request
      if (pinnedPayload.parentRepositoryId !== parentRepositoryId) {
        return failure('Confirmation parent repository does not match pinned fork request.', 409);
      }
      if (pinnedPayload.parentRefName !== parentRefName) {
        return failure('Confirmation parent ref does not match pinned fork request.', 409);
      }
      if (pinnedPayload.parentCommitOid !== parentCommitOid) {
        return failure('Confirmation parent commit OID does not match pinned fork request.', 409);
      }
      if (pinnedPayload.childInitialCommitOid !== childInitialCommitOid) {
        return failure('Confirmation child initial commit OID does not match pinned fork request.', 409);
      }

      // Derive lineage root and depth SOLELY from pinned payload
      const derivedLineageRootId = String(pinnedPayload.lineageRootRepositoryId);
      const derivedDepth = Number(pinnedPayload.depth);

      const pinnedErrors = validateForkOrigin({
        childRepositoryId,
        parentRepositoryId,
        parentRefName,
        parentCommitOid,
        childInitialCommitOid,
        lineageRootRepositoryId: derivedLineageRootId,
        depth: derivedDepth
      });
      if (pinnedErrors.length) {
        return Response.json({ success: false, errors: pinnedErrors }, { status: 409 });
      }
      if (pinnedPayload.forkedByUserId !== (child as any).ownerUserId) {
        return failure('Pinned fork owner does not match child repository owner.', 409);
      }

      const forkUserId = pinnedPayload.forkedByUserId || actorUserId || (child as any).ownerUserId;
      const childRefName = pinnedPayload.defaultRef || parentRefName || (child as any).defaultRef || 'refs/heads/main';
      const forkOutboxEventId = `evt_${crypto.randomUUID()}`;
      const refEventId = `revt_${crypto.randomUUID()}`;

      await db.batch([
        // 1. Immutable fork edge
        db.prepare(`
          INSERT INTO repository_forks (
            child_repository_id, parent_repository_id, forked_by_user_id,
            parent_ref_name, parent_commit_oid, child_initial_commit_oid,
            lineage_root_repository_id, depth, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          childRepositoryId, parentRepositoryId, forkUserId, parentRefName,
          parentCommitOid, childInitialCommitOid, derivedLineageRootId, derivedDepth
        ),
        // 2. Seed child initial ref
        db.prepare(`
          INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id, updated_at)
          VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
        `).bind(childRepositoryId, childRefName, childInitialCommitOid, forkUserId),
        // 3. Ref creation event
        db.prepare(`
          INSERT INTO repository_ref_events (
            id, repository_id, ref_name, old_oid, new_oid, expected_old_oid,
            operation, actor_user_id, idempotency_key, signature_verified, created_at
          ) VALUES (?, ?, ?, NULL, ?, NULL, 'create', ?, ?, 1, CURRENT_TIMESTAMP)
        `).bind(refEventId, childRepositoryId, childRefName, childInitialCommitOid, forkUserId, idempotencyKey),
        // 4. Activate child repository
        db.prepare(`
          UPDATE repositories SET status = 'active', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'provisioning'
        `).bind(childRepositoryId),
        // 5. Outbox confirmation event
        db.prepare(`
          INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
          VALUES (?, 'fork', ?, 'repository.fork_confirmed', ?, 0, CURRENT_TIMESTAMP)
        `).bind(
          forkOutboxEventId, childRepositoryId,
          JSON.stringify({
            childRepositoryId, parentRepositoryId, parentRefName,
            parentCommitOid, childInitialCommitOid, lineageRootRepositoryId: derivedLineageRootId,
            depth: derivedDepth, actorUserId: forkUserId, status: 'active'
          })
        )
      ]);

      return Response.json({
        success: true,
        fork: {
          childRepositoryId, parentRepositoryId, parentRefName,
          parentCommitOid, childInitialCommitOid, lineageRootRepositoryId: derivedLineageRootId,
          depth: derivedDepth
        },
        status: 'active',
        outboxEventId: forkOutboxEventId
      }, { status: 201 });
    } catch (error: any) {
      const message = String(error?.message || 'unknown database error');
      if (message.includes('UNIQUE') || message.includes('constraint')) {
        return failure('Fork confirmation violates an integrity constraint.', 409);
      }
      return failure(`Fork confirmation failed: ${message}`, 500);
    }
  }

  if (action === 'gateway-confirm-provisioning') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const repositoryId = String(body.repositoryId || '').trim();
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    if (!repositoryId) return failure('repositoryId is required.', 400);
    if (!idempotencyKey) return failure('idempotencyKey is required.', 400);

    try {
      const repo = await db.prepare(`
        SELECT id, status, slug, owner_user_id AS ownerUserId, storage_key AS storageKey,
               object_format AS objectFormat, default_ref AS defaultRef
        FROM repositories WHERE id = ?
      `).bind(repositoryId).first();
      if (!repo) return failure('Repository not found.', 404);

      if ((repo as any).status === 'archived' || (repo as any).status === 'quarantined') {
        return failure(`Cannot confirm provisioning for ${(repo as any).status} repository.`, 409);
      }

      if ((repo as any).status === 'active') {
        const provisionedEvt = await db.prepare(`
          SELECT payload FROM forge_outbox_events
          WHERE aggregate_id = ? AND aggregate_type = 'repository' AND event_type = 'repository.provisioned'
          ORDER BY created_at DESC LIMIT 1
        `).bind(repositoryId).first();

        if (provisionedEvt) {
          let parsed: any;
          try { parsed = JSON.parse((provisionedEvt as any).payload); } catch {}
          if (parsed && parsed.idempotencyKey && parsed.idempotencyKey !== idempotencyKey) {
            return failure('Repository is already active with a different provisioning idempotency key.', 409);
          }
        }

        return Response.json({
          success: true,
          repositoryId,
          status: 'active',
          idempotent: true
        }, { status: 200 });
      }

      if ((repo as any).status !== 'provisioning') {
        return failure(`Repository must be in provisioning status to confirm (current: ${(repo as any).status}).`, 409);
      }

      // Validate pinned provisioning request event
      const pendingOutbox = await db.prepare(`
        SELECT payload FROM forge_outbox_events
        WHERE aggregate_id = ? AND aggregate_type = 'repository' AND event_type = 'repository.provisioning_requested'
        ORDER BY created_at DESC LIMIT 1
      `).bind(repositoryId).first();

      if (!pendingOutbox) {
        return failure('Pending provisioning request outbox event not found.', 404);
      }

      let pinnedPayload: any;
      try {
        pinnedPayload = JSON.parse((pendingOutbox as any).payload);
      } catch {
        return failure('Malformed pinned provisioning request payload.', 500);
      }

      if (pinnedPayload.repositoryId !== repositoryId || pinnedPayload.storageKey !== (repo as any).storageKey) {
        return failure('Provisioning confirmation does not match pinned provisioning request.', 409);
      }

      if (body.storageKey && String(body.storageKey).trim() !== (repo as any).storageKey) {
        return failure('Confirmation storage key does not match pinned provisioning request.', 409);
      }

      const outboxEventId = `evt_${crypto.randomUUID()}`;
      await db.batch([
        db.prepare(`
          UPDATE repositories SET status = 'active', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'provisioning'
        `).bind(repositoryId),
        db.prepare(`
          INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
          VALUES (?, 'repository', ?, 'repository.provisioned', ?, 0, CURRENT_TIMESTAMP)
        `).bind(
          outboxEventId, repositoryId,
          JSON.stringify({ repositoryId, storageKey: (repo as any).storageKey, status: 'active', idempotencyKey })
        )
      ]);

      return Response.json({
        success: true,
        repositoryId,
        status: 'active',
        outboxEventId
      }, { status: 200 });
    } catch (error: any) {
      return failure(`Provisioning confirmation failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  if (action === 'gateway-complete-merge') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const mergeJobId = String(body.mergeJobId || '').trim();
    const mergeAttemptId = String(body.mergeAttemptId || '').trim();
    const outboxEventId = String(body.outboxEventId || '').trim();
    const status = String(body.status || '').trim();
    const actualTargetOid = body.actualTargetOid == null ? null : String(body.actualTargetOid).trim();
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    if (!mergeJobId || !mergeAttemptId || !outboxEventId || !idempotencyKey) {
      return failure('mergeJobId, mergeAttemptId, outboxEventId, and idempotencyKey are required.', 400);
    }
    if (!['landed', 'stale'].includes(status)) return failure('status must be landed or stale.', 400);
    if (actualTargetOid !== null) {
      const oid = validateGitOid(actualTargetOid, 'actualTargetOid');
      if (!oid.valid) return failure(oid.error!, 400);
    }

    try {
      const row = await db.prepare(`
        SELECT ma.id AS mergeAttemptId, ma.merge_job_id AS mergeJobId,
          ma.input_target_oid AS inputTargetOid, ma.result_commit_oid AS resultCommitOid,
          ma.status AS attemptStatus, mj.status AS jobStatus,
          mj.target_repository_id AS repositoryId, mj.target_ref AS targetRef,
          mj.landed_commit_oid AS landedCommitOid,
          repository.storage_key AS storageKey,
          rr.commit_oid AS projectedOid, approval.decision AS approvalDecision,
          evt.payload AS outboxPayload
        FROM merge_attempts ma
        JOIN merge_jobs mj ON mj.id = ma.merge_job_id
        JOIN repositories repository ON repository.id = mj.target_repository_id
        LEFT JOIN repository_refs rr
          ON rr.repository_id = mj.target_repository_id AND rr.ref_name = mj.target_ref
        LEFT JOIN merge_approvals approval
          ON approval.merge_attempt_id = ma.id
          AND approval.result_commit_oid = ma.result_commit_oid
        LEFT JOIN forge_outbox_events evt
          ON evt.id = ? AND evt.aggregate_type = 'merge'
          AND evt.aggregate_id = ma.id AND evt.event_type = 'merge.approved'
        WHERE ma.id = ? AND mj.id = ?
      `).bind(outboxEventId, mergeAttemptId, mergeJobId).first();
      if (!row) return failure('Merge attempt not found.', 404);
      if (!(row as any).outboxPayload) return failure('Pinned approved-merge outbox event not found.', 409);

      let pinned: any;
      try { pinned = JSON.parse(String((row as any).outboxPayload)); }
      catch { return failure('Pinned approved-merge payload is malformed.', 500); }
      const pinnedMatches = pinned.mergeJobId === mergeJobId && pinned.mergeAttemptId === mergeAttemptId &&
        pinned.repositoryId === (row as any).repositoryId && pinned.targetRef === (row as any).targetRef &&
        pinned.storageKey === (row as any).storageKey &&
        pinned.expectedTargetOid === (row as any).inputTargetOid &&
        pinned.resultCommitOid === (row as any).resultCommitOid;
      if (!pinnedMatches) return failure('Merge completion does not match the pinned approved attempt.', 409);
      if ((row as any).approvalDecision !== 'approved') return failure('Merge attempt is not approved.', 409);

      if ((row as any).attemptStatus === status && (row as any).jobStatus === status) {
        const exactReplay = status === 'stale' || (row as any).landedCommitOid === (row as any).resultCommitOid;
        if (exactReplay) return Response.json({ success: true, status, idempotent: true }, { status: 200 });
      }
      if ((row as any).attemptStatus !== 'approved' || (row as any).jobStatus !== 'landing') {
        return failure(`Merge cannot complete from attempt ${(row as any).attemptStatus} and job ${(row as any).jobStatus}.`, 409);
      }

      if (status === 'landed') {
        if (actualTargetOid !== (row as any).resultCommitOid || (row as any).projectedOid !== (row as any).resultCommitOid) {
          return failure('Cannot mark merge landed until Git and the ref projection equal the approved result OID.', 409);
        }
      } else if (actualTargetOid === (row as any).resultCommitOid) {
        return failure('A ref already at the approved result cannot be marked stale.', 409);
      }

      const failureDetail = status === 'stale'
        ? `CAS stale: expected ${(row as any).inputTargetOid}, actual ${actualTargetOid ?? 'null'}`
        : null;
      await db.batch([
        db.prepare(`
          UPDATE merge_attempts SET status = ?, failure_detail = ?, finished_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'approved' AND result_commit_oid = ?
        `).bind(status, failureDetail, mergeAttemptId, (row as any).resultCommitOid),
        db.prepare(`
          UPDATE merge_jobs SET status = ?, landed_commit_oid = ?, failure_code = ?,
            updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'landing'
        `).bind(status, status === 'landed' ? (row as any).resultCommitOid : null,
          status === 'stale' ? 'target_ref_stale' : null, mergeJobId),
        db.prepare(`
          UPDATE inbox_messages SET is_merged = ?
          WHERE merge_attempt_id = ?
        `).bind(status === 'landed' ? 1 : 0, mergeAttemptId)
      ]);

      return Response.json({
        success: true, status, mergeJobId, mergeAttemptId,
        landedCommitOid: status === 'landed' ? (row as any).resultCommitOid : null,
        idempotencyKey
      }, { status: 200 });
    } catch (error: any) {
      return failure(`Merge completion failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  if (action === 'gateway-status') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;
    return Response.json({ success: true, service: 'GITSMITH control plane', gatewayApiVersion: 1 });
  }

  if (action === 'gateway-claim-outbox') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const limit = Math.max(1, Math.min(Number(body.limit) || 10, 50));
    const leaseSeconds = Math.max(5, Math.min(Number(body.leaseSeconds) || 60, 3600));
    const maxAttempts = Math.max(1, Math.min(Number(body.maxAttempts) || 5, 20));

    try {
      const candidatesRes = await db.prepare(`
        SELECT id, aggregate_type, aggregate_id, event_type, payload,
               attempts, available_at, delivered_at, last_error,
               claim_token, lease_expires_at, dead_lettered_at, created_at
        FROM forge_outbox_events
        WHERE delivered_at IS NULL
          AND dead_lettered_at IS NULL
          AND (available_at IS NULL OR available_at <= CURRENT_TIMESTAMP)
          AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
          AND attempts < ?
          AND event_type IN ('repository.provisioning_requested', 'repository.fork_requested', 'merge.approved')
        ORDER BY created_at ASC
        LIMIT ?
      `).bind(maxAttempts, limit).all();

      const candidates = candidatesRes.results || [];
      const claimedEvents: any[] = [];

      for (const event of candidates) {
        const claimToken = `clm_${crypto.randomUUID().replace(/-/g, '')}`;
        const updateRes = await db.prepare(`
          UPDATE forge_outbox_events
          SET claim_token = ?,
              lease_expires_at = datetime('now', '+' || ? || ' seconds'),
              available_at = datetime('now', '+' || ? || ' seconds'),
              attempts = attempts + 1
          WHERE id = ?
            AND delivered_at IS NULL
            AND dead_lettered_at IS NULL
            AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
        `).bind(claimToken, leaseSeconds, leaseSeconds, (event as any).id).run();

        const changes = (updateRes as any)?.meta?.changes ?? 0;
        if (changes > 0) {
          claimedEvents.push({
            ...event,
            claim_token: claimToken,
            attempts: Number((event as any).attempts) + 1
          });
        }
      }

      return Response.json({
        success: true,
        claimed: claimedEvents
      }, { status: 200 });
    } catch (error: any) {
      return failure(`Outbox claim failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  if (action === 'gateway-complete-outbox') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const eventId = String(body.eventId || body.id || '').trim();
    const claimToken = String(body.claimToken || '').trim();
    if (!eventId) return failure('eventId is required.', 400);
    if (!claimToken) return failure('claimToken is required.', 400);

    try {
      const updateRes = await db.prepare(`
        UPDATE forge_outbox_events
        SET delivered_at = CURRENT_TIMESTAMP,
            claim_token = NULL,
            lease_expires_at = NULL,
            last_error = NULL
        WHERE id = ? AND claim_token = ? AND delivered_at IS NULL
      `).bind(eventId, claimToken).run();

      const changes = (updateRes as any)?.meta?.changes ?? 0;
      if (changes > 0) {
        return Response.json({ success: true, eventId, delivered: true }, { status: 200 });
      }

      const existing = await db.prepare(`
        SELECT id, delivered_at AS deliveredAt, claim_token AS claimToken
        FROM forge_outbox_events WHERE id = ?
      `).bind(eventId).first();

      if (existing && (existing as any).deliveredAt) {
        return Response.json({ success: true, eventId, idempotent: true }, { status: 200 });
      }

      return failure('Invalid or expired claim token for outbox event.', 409);
    } catch (error: any) {
      return failure(`Outbox complete failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  if (action === 'gateway-fail-outbox') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const eventId = String(body.eventId || body.id || '').trim();
    const claimToken = String(body.claimToken || '').trim();
    const errorMessage = String(body.error || 'Unknown error').trim();
    const maxAttempts = Math.max(1, Math.min(Number(body.maxAttempts) || 5, 20));
    const isTerminal = Boolean(body.terminal);
    const baseBackoffSeconds = Math.max(1, Math.min(Number(body.baseBackoffSeconds) || 2, 3600));
    const maxBackoffSeconds = Math.max(baseBackoffSeconds, Math.min(Number(body.maxBackoffSeconds) || 300, 86400));

    if (!eventId) return failure('eventId is required.', 400);
    if (!claimToken) return failure('claimToken is required.', 400);

    try {
      const event = await db.prepare(`
        SELECT id, aggregate_id AS aggregateId, aggregate_type AS aggregateType,
               event_type AS eventType, attempts, claim_token AS claimToken
        FROM forge_outbox_events WHERE id = ?
      `).bind(eventId).first();

      if (!event) return failure('Outbox event not found.', 404);
      if ((event as any).claimToken !== claimToken) {
        return failure('Claim token mismatch or lease expired.', 409);
      }

      const attempts = Number((event as any).attempts);
      if (attempts >= maxAttempts || isTerminal) {
        await db.prepare(`
          UPDATE forge_outbox_events
          SET claim_token = NULL,
              lease_expires_at = NULL,
              dead_lettered_at = CURRENT_TIMESTAMP,
              available_at = '9999-12-31 23:59:59',
              last_error = ?
          WHERE id = ? AND claim_token = ?
        `).bind(`Dead-letter: Max attempts reached (${attempts}). Last error: ${errorMessage}`, eventId, claimToken).run();

        if ((event as any).aggregateId) {
          try {
            const issueId = `recon_dead_${crypto.randomUUID()}`;
            await db.prepare(`
              INSERT INTO forge_reconciliation_issues (
                id, repository_id, issue_type, status, detail, detected_at
              ) VALUES (?, ?, 'git_missing_in_d1', 'open', ?, CURRENT_TIMESTAMP)
            `).bind(
              issueId,
              (event as any).aggregateId,
              `Outbox event ${eventId} (${(event as any).eventType}) dead-lettered after ${attempts} attempts: ${errorMessage}`
            ).run();
          } catch {}
        }

        return Response.json({
          success: true,
          eventId,
          deadLettered: true,
          attempts
        }, { status: 200 });
      }

      const backoffSec = Math.min(
        Math.max(baseBackoffSeconds * Math.pow(2, attempts - 1), baseBackoffSeconds),
        maxBackoffSeconds
      );

      await db.prepare(`
        UPDATE forge_outbox_events
        SET claim_token = NULL,
            lease_expires_at = NULL,
            available_at = datetime('now', '+' || ? || ' seconds'),
            last_error = ?
        WHERE id = ? AND claim_token = ?
      `).bind(backoffSec, errorMessage, eventId, claimToken).run();

      return Response.json({
        success: true,
        eventId,
        retryable: true,
        backoffSeconds: backoffSec,
        attempts
      }, { status: 200 });
    } catch (error: any) {
      return failure(`Outbox fail transition failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  if (action === 'gateway-reconcile') {
    const gwAuth = await verifyGatewayAuth(request, env, db);
    if (!gwAuth.authorized) return gwAuth.errorResponse!;

    const repoSnapshots = Array.isArray(body.repositories) ? body.repositories : [];

    try {
      const openIssues: any[] = [];

      for (const repoSnap of repoSnapshots) {
        const repoId = String(repoSnap.repositoryId || '').trim();
        if (!repoId) continue;

        const repo = await db.prepare(`
          SELECT id, status FROM repositories WHERE id = ?
        `).bind(repoId).first();
        if (!repo) continue;

        const diskRefs = Array.isArray(repoSnap.diskRefs) ? repoSnap.diskRefs : [];
        const diskRefMap = new Map<string, string>();
        for (const dr of diskRefs) {
          if (dr.refName && dr.commitOid) {
            diskRefMap.set(dr.refName, dr.commitOid);
          }
        }

        const d1RefsRes = await db.prepare(`
          SELECT ref_name AS refName, commit_oid AS commitOid
          FROM repository_refs WHERE repository_id = ?
        `).bind(repoId).all();
        const d1Refs = d1RefsRes.results || [];
        const d1RefMap = new Map<string, string>();
        for (const d1r of d1Refs) {
          d1RefMap.set((d1r as any).refName, (d1r as any).commitOid);
        }

        for (const [refName, diskOid] of diskRefMap.entries()) {
          const d1Oid = d1RefMap.get(refName);
          if (!d1Oid) {
            const existingIssue = await db.prepare(`
              SELECT id FROM forge_reconciliation_issues
              WHERE repository_id = ? AND issue_type = 'git_missing_in_d1' AND ref_name = ? AND status = 'open'
            `).bind(repoId, refName).first();

            let issueId = (existingIssue as any)?.id;
            if (!issueId) {
              issueId = `recon_gmid_${crypto.randomUUID()}`;
              await db.prepare(`
                INSERT INTO forge_reconciliation_issues (
                  id, repository_id, ref_name, issue_type, git_oid, d1_oid, status, detail, detected_at
                ) VALUES (?, ?, ?, 'git_missing_in_d1', ?, NULL, 'open', ?, CURRENT_TIMESTAMP)
              `).bind(
                issueId, repoId, refName, diskOid,
                `Authoritative Git ref '${refName}' (${diskOid}) is missing in D1 projection.`
              ).run();
            }

            openIssues.push({
              id: issueId,
              repository_id: repoId,
              ref_name: refName,
              issue_type: 'git_missing_in_d1',
              git_oid: diskOid,
              d1_oid: null,
              status: 'open',
              detail: `Authoritative Git ref '${refName}' (${diskOid}) is missing in D1 projection.`
            });
          } else if (d1Oid !== diskOid) {
            const existingIssue = await db.prepare(`
              SELECT id FROM forge_reconciliation_issues
              WHERE repository_id = ? AND issue_type = 'oid_mismatch' AND ref_name = ? AND status = 'open'
            `).bind(repoId, refName).first();

            let issueId = (existingIssue as any)?.id;
            if (!issueId) {
              issueId = `recon_mismatch_${crypto.randomUUID()}`;
              await db.prepare(`
                INSERT INTO forge_reconciliation_issues (
                  id, repository_id, ref_name, issue_type, git_oid, d1_oid, status, detail, detected_at
                ) VALUES (?, ?, ?, 'oid_mismatch', ?, ?, 'open', ?, CURRENT_TIMESTAMP)
              `).bind(
                issueId, repoId, refName, diskOid, d1Oid,
                `Authoritative Git OID (${diskOid}) differs from D1 projection OID (${d1Oid}) on ref '${refName}'.`
              ).run();
            }

            openIssues.push({
              id: issueId,
              repository_id: repoId,
              ref_name: refName,
              issue_type: 'oid_mismatch',
              git_oid: diskOid,
              d1_oid: d1Oid,
              status: 'open',
              detail: `Authoritative Git OID (${diskOid}) differs from D1 projection OID (${d1Oid}) on ref '${refName}'.`
            });
          }
        }

        for (const [refName, d1Oid] of d1RefMap.entries()) {
          if (!diskRefMap.has(refName)) {
            const existingIssue = await db.prepare(`
              SELECT id FROM forge_reconciliation_issues
              WHERE repository_id = ? AND issue_type = 'd1_missing_in_git' AND ref_name = ? AND status = 'open'
            `).bind(repoId, refName).first();

            let issueId = (existingIssue as any)?.id;
            if (!issueId) {
              issueId = `recon_dmig_${crypto.randomUUID()}`;
              await db.prepare(`
                INSERT INTO forge_reconciliation_issues (
                  id, repository_id, ref_name, issue_type, git_oid, d1_oid, status, detail, detected_at
                ) VALUES (?, ?, ?, 'd1_missing_in_git', NULL, ?, 'open', ?, CURRENT_TIMESTAMP)
              `).bind(
                issueId, repoId, refName, d1Oid,
                `D1 ref '${refName}' (${d1Oid}) is missing from authoritative Git repository.`
              ).run();
            }

            openIssues.push({
              id: issueId,
              repository_id: repoId,
              ref_name: refName,
              issue_type: 'd1_missing_in_git',
              git_oid: null,
              d1_oid: d1Oid,
              status: 'open',
              detail: `D1 ref '${refName}' (${d1Oid}) is missing from authoritative Git repository.`
            });
          }
        }
      }

      return Response.json({
        success: true,
        scannedRepositories: repoSnapshots.length,
        openIssuesFound: openIssues.length,
        resolvedCount: 0,
        issues: openIssues
      }, { status: 200 });
    } catch (error: any) {
      return failure(`Reconciliation failed: ${error?.message || 'unknown database error'}`, 500);
    }
  }

  // =========================================================================
  // USER SESSION-AUTHENTICATED ACTIONS
  // =========================================================================
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  const actor = auth.user!;

  if (action === 'create-repository' || action === 'fork') {
    const readiness = await gatewayReadiness(env);
    if (!readiness.success || !readiness.ready) {
      return failure('GITSMITH gateway is not ready. No provisioning request was created.', 503);
    }
  }

  // --- Action: create-repository ---
  if (action === 'create-repository') {
    const slug = String(body.slug || '').trim();
    const appId = body.appId ? String(body.appId).trim() : null;
    const visibility = ['public', 'unlisted', 'private'].includes(body.visibility) ? body.visibility : 'public';
    const objectFormat = ['sha1', 'sha256'].includes(body.objectFormat) ? body.objectFormat : 'sha1';
    const defaultRef = String(body.defaultRef || 'refs/heads/main').trim();

    const slugVal = validateRepositorySlug(slug);
    if (!slugVal.valid) return failure(slugVal.error!, 400);

    const refVal = validateGitRef(defaultRef);
    if (!refVal.valid) return failure(refVal.error!, 400);

    try {
      // Idempotency: Check if repository already exists for (owner_user_id, slug)
      const existing = await db.prepare(`
        SELECT id, app_id AS appId, owner_user_id AS ownerUserId, slug,
               visibility, object_format AS objectFormat, default_ref AS defaultRef,
               storage_key AS storageKey, status, created_at AS createdAt, updated_at AS updatedAt
        FROM repositories
        WHERE owner_user_id = ? AND slug = ?
      `).bind(actor.id, slug).first();

      if (existing) {
        return Response.json({ success: true, repository: existing, idempotent: true }, { status: 200 });
      }

      // Generate server-side immutable ID (do not trust client ID)
      const id = `repo_${crypto.randomUUID()}`;
      const storageKey = buildRepositoryStorageKey(id);
      const outboxEventId = `evt_${crypto.randomUUID()}`;
      const payload = JSON.stringify({
        repositoryId: id,
        ownerUserId: actor.id,
        slug,
        visibility,
        objectFormat,
        defaultRef,
        storageKey,
        status: 'provisioning',
        appId
      });

      await db.batch([
        db.prepare(`
          INSERT INTO repositories (
            id, app_id, owner_user_id, slug, visibility, object_format,
            default_ref, storage_key, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'provisioning', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(id, appId, actor.id, slug, visibility, objectFormat, defaultRef, storageKey),
        db.prepare(`
          INSERT INTO repository_members (repository_id, user_id, role, granted_by_user_id, created_at)
          VALUES (?, ?, 'owner', ?, CURRENT_TIMESTAMP)
        `).bind(id, actor.id, actor.id),
        db.prepare(`
          INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
          VALUES (?, 'repository', ?, 'repository.provisioning_requested', ?, 0, CURRENT_TIMESTAMP)
        `).bind(outboxEventId, id, payload)
      ]);

      return Response.json({
        success: true,
        repository: {
          id,
          appId,
          ownerUserId: actor.id,
          slug,
          visibility,
          objectFormat,
          defaultRef,
          storageKey,
          status: 'provisioning'
        },
        outboxEventId
      }, { status: 201 });
    } catch (error: any) {
      const message = String(error?.message || 'unknown database error');
      if (message.includes('UNIQUE') || message.includes('constraint')) {
        return failure('A repository with this slug or storage key already exists.', 409);
      }
      return failure(`Repository creation failed: ${message}`, 500);
    }
  }

  // --- Action: fork (Phase 1: Session-authenticated fork request) ---
  if (action === 'fork') {
    let rawParentId = String(body.parentRepositoryId || body.parentSlug || body.parent || body.slug || '').trim();
    if (/^(ssh|https?|file):\/\//.test(rawParentId)) {
      try {
        rawParentId = new URL(rawParentId).pathname.replace(/^\/+/, '').replace(/\.git$/i, '');
      } catch {}
    }
    if (!rawParentId) return failure('parentRepositoryId is required.', 400);

    let childSlug = String(body.childSlug || '').trim();
    if (!childSlug && body.slug && body.parentRepositoryId && body.slug !== body.parentRepositoryId) {
      childSlug = String(body.slug).trim();
    }
    if (childSlug.includes('/')) {
      childSlug = childSlug.split('/').pop()!;
    }
    const parentRefName = String(body.parentRefName || 'refs/heads/main').trim();
    const visibility = ['public', 'unlisted', 'private'].includes(body.visibility) ? body.visibility : 'public';

    try {
      let parent = await repositoryAccess(db, rawParentId, actor.id);
      if (!parent && rawParentId.includes('/')) {
        const parts = rawParentId.replace(/^\/+|\/+$/g, '').split('/');
        const owner = parts[0];
        const slug = parts.slice(1).join('/');
        parent = await db.prepare(`
          SELECT r.id, r.app_id AS appId, r.owner_user_id AS ownerUserId,
                 r.slug, r.visibility, r.object_format AS objectFormat,
                 r.default_ref AS defaultRef, r.storage_key AS storageKey, r.status,
                 r.created_at AS createdAt, r.updated_at AS updatedAt,
                 CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE m.role END AS memberRole
          FROM repositories r
          LEFT JOIN repository_members m
            ON m.repository_id = r.id AND m.user_id = ?
          WHERE (r.owner_user_id = ? OR r.owner_user_id = (SELECT id FROM users WHERE username = ?))
            AND r.slug = ?
        `).bind(actor.id, actor.id, owner, owner, slug).first();
      }
      if (!parent) {
        parent = await db.prepare(`
          SELECT r.id, r.app_id AS appId, r.owner_user_id AS ownerUserId,
                 r.slug, r.visibility, r.object_format AS objectFormat,
                 r.default_ref AS defaultRef, r.storage_key AS storageKey, r.status,
                 r.created_at AS createdAt, r.updated_at AS updatedAt,
                 CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE m.role END AS memberRole
          FROM repositories r
          LEFT JOIN repository_members m
            ON m.repository_id = r.id AND m.user_id = ?
          WHERE r.slug = ?
          ORDER BY (CASE WHEN r.owner_user_id = ? THEN 0 ELSE 1 END), r.created_at ASC
          LIMIT 1
        `).bind(actor.id, actor.id, rawParentId, actor.id).first();
      }

      if (!parent) return failure('Parent repository not found.', 404);
      const parentRepositoryId = (parent as any).id;

      if (!childSlug) {
        childSlug = (parent as any).slug;
      }
      const slugVal = validateRepositorySlug(childSlug);
      if (!slugVal.valid) return failure(slugVal.error!, 400);

      if ((parent as any).status !== 'active') {
        return failure(`Parent repository must be active to fork (current: ${(parent as any).status}).`, 409);
      }
      if ((parent as any).visibility === 'private' && !(parent as any).memberRole) {
        return failure('Parent repository is not accessible.', 403);
      }

      const parentRef = await db.prepare(`
        SELECT commit_oid AS commitOid FROM repository_refs
        WHERE repository_id = ? AND ref_name = ?
      `).bind(parentRepositoryId, parentRefName).first();

      if (!parentRef) return failure('Parent ref is not present in the canonical projection.', 409);
      if (!isValidGitOid((parentRef as any).commitOid)) {
        return failure('Parent commit OID is invalid.', 409);
      }

      // Idempotency: Check if pending or confirmed child repository already exists with same (owner_user_id, slug)
      const existingChild = await db.prepare(`
        SELECT id, app_id AS appId, owner_user_id AS ownerUserId, slug,
               visibility, object_format AS objectFormat, default_ref AS defaultRef,
               storage_key AS storageKey, status
        FROM repositories WHERE owner_user_id = ? AND slug = ?
      `).bind(actor.id, childSlug).first();

      if (existingChild) {
        // Check if already confirmed
        const existingFork = await db.prepare(`
          SELECT parent_repository_id AS parentRepositoryId, depth,
                 lineage_root_repository_id AS lineageRootRepositoryId, parent_commit_oid AS parentCommitOid
          FROM repository_forks WHERE child_repository_id = ?
        `).bind((existingChild as any).id).first();

        if (existingFork && (existingFork as any).parentRepositoryId === parentRepositoryId) {
          return Response.json({
            success: true,
            repository: existingChild,
            forkRequest: {
              childRepositoryId: (existingChild as any).id,
              parentRepositoryId,
              parentRefName,
              parentCommitOid: (existingFork as any).parentCommitOid,
              lineageRootRepositoryId: (existingFork as any).lineageRootRepositoryId,
              depth: (existingFork as any).depth
            },
            idempotent: true
          }, { status: 200 });
        }

        // Check if pending fork request in outbox
        const pendingOutbox = await db.prepare(`
          SELECT payload FROM forge_outbox_events
          WHERE aggregate_id = ? AND aggregate_type = 'fork' AND event_type = 'repository.fork_requested'
          ORDER BY created_at DESC LIMIT 1
        `).bind((existingChild as any).id).first();

        if (pendingOutbox) {
          let parsed: any;
          try { parsed = JSON.parse((pendingOutbox as any).payload); } catch {}
          if (parsed && parsed.parentRepositoryId === parentRepositoryId) {
            return Response.json({
              success: true,
              repository: existingChild,
              forkRequest: {
                childRepositoryId: (existingChild as any).id,
                parentRepositoryId: parsed.parentRepositoryId,
                parentRefName: parsed.parentRefName,
                parentCommitOid: parsed.parentCommitOid,
                lineageRootRepositoryId: parsed.lineageRootRepositoryId,
                depth: parsed.depth
              },
              idempotent: true
            }, { status: 200 });
          }
        }

        return failure('A repository with this slug already exists for this user.', 409);
      }

      const parentFork = await db.prepare(`
        SELECT lineage_root_repository_id AS lineageRootRepositoryId, depth
        FROM repository_forks WHERE child_repository_id = ?
      `).bind(parentRepositoryId).first();

      const lineageRootRepositoryId = (parentFork as any)?.lineageRootRepositoryId || parentRepositoryId;
      const depth = parentFork ? Number((parentFork as any).depth) + 1 : 1;
      const childRepositoryId = `repo_${crypto.randomUUID()}`;

      const errors = validateForkOrigin({
        childRepositoryId,
        parentRepositoryId,
        parentRefName,
        parentCommitOid: String((parentRef as any).commitOid),
        childInitialCommitOid: String((parentRef as any).commitOid),
        lineageRootRepositoryId,
        depth
      });
      if (errors.length) return Response.json({ success: false, errors }, { status: 400 });

      const storageKey = buildRepositoryStorageKey(childRepositoryId);
      const outboxEventId = `evt_${crypto.randomUUID()}`;
      const forkPayload = JSON.stringify({
        childRepositoryId,
        parentRepositoryId,
        forkedByUserId: actor.id,
        parentRefName,
        parentCommitOid: (parentRef as any).commitOid,
        childInitialCommitOid: (parentRef as any).commitOid,
        lineageRootRepositoryId,
        depth,
        storageKey,
        childSlug,
        defaultRef: parentRefName,
        visibility
      });

      await db.batch([
        db.prepare(`
          INSERT INTO repositories (
            id, app_id, owner_user_id, slug, visibility, object_format,
            default_ref, storage_key, status, created_at, updated_at
          ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'provisioning', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).bind(
          childRepositoryId, actor.id, childSlug, visibility,
          (parent as any).objectFormat || 'sha1', parentRefName, storageKey
        ),
        db.prepare(`
          INSERT INTO repository_members (repository_id, user_id, role, granted_by_user_id, created_at)
          VALUES (?, ?, 'owner', ?, CURRENT_TIMESTAMP)
        `).bind(childRepositoryId, actor.id, actor.id),
        db.prepare(`
          INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
          VALUES (?, 'fork', ?, 'repository.fork_requested', ?, 0, CURRENT_TIMESTAMP)
        `).bind(outboxEventId, childRepositoryId, forkPayload)
      ]);

      return Response.json({
        success: true,
        repository: {
          id: childRepositoryId,
          ownerUserId: actor.id,
          slug: childSlug,
          visibility,
          objectFormat: (parent as any).objectFormat || 'sha1',
          defaultRef: parentRefName,
          storageKey,
          status: 'provisioning'
        },
        forkRequest: {
          childRepositoryId,
          parentRepositoryId,
          parentRefName,
          parentCommitOid: (parentRef as any).commitOid,
          lineageRootRepositoryId,
          depth
        },
        outboxEventId
      }, { status: 201 });
    } catch (error: any) {
      const message = String(error?.message || 'unknown database error');
      if (message.includes('UNIQUE') || message.includes('constraint')) {
        return failure('Fork request violates an integrity constraint or slug already exists.', 409);
      }
      return failure(`Fork request failed: ${message}`, 500);
    }
  }

  return failure('Supported control-plane actions: create-repository, fork, gateway-record-ref, gateway-confirm-fork, gateway-confirm-provisioning, gateway-complete-merge, gateway-status, gateway-claim-outbox, gateway-complete-outbox, gateway-fail-outbox, gateway-reconcile.', 400);
};
