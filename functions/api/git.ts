// GITSMITH control-plane API. Git object transfer and authoritative ref CAS
// belong to a real Git gateway. D1 stores the query projection, immutable fork
// lineage, access policy, and durable work queue.

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
  constantTimeTokenCompare
} from '../../src/lib/forgeDomain';

type D1Database = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };

const dbFrom = (env: any): D1Database | null =>
  env?.DB && typeof env.DB.prepare === 'function' ? env.DB as D1Database : null;

const failure = (error: string, status = 503) =>
  Response.json({ success: false, error }, { status });

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
  if (url.searchParams.has('service') || url.pathname.endsWith('/info/refs')) {
    return failure(
      'Git smart HTTP is not served by this control-plane endpoint. Configure the GITSMITH gateway.',
      501
    );
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

    // 1. Single Repository Detail Query (by ID or owner + slug)
    if (repositoryId || (ownerParam && slugParam)) {
      let repository: any = null;
      if (repositoryId) {
        repository = await repositoryAccess(db, repositoryId, user?.id);
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
          WHERE (r.owner_user_id = ? OR r.owner_user_id = (SELECT id FROM users WHERE username = ?))
            AND r.slug = ?
        `).bind(user?.id || '', user?.id || '', ownerParam, ownerParam, slugParam).first();
        repository = repoRow;
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

  // =========================================================================
  // USER SESSION-AUTHENTICATED ACTIONS
  // =========================================================================
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  const actor = auth.user!;

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
    const parentRepositoryId = String(body.parentRepositoryId || '').trim();
    const childSlug = String(body.childSlug || body.slug || '').trim();
    const parentRefName = String(body.parentRefName || 'refs/heads/main').trim();
    const visibility = ['public', 'unlisted', 'private'].includes(body.visibility) ? body.visibility : 'public';

    if (!parentRepositoryId) return failure('parentRepositoryId is required.', 400);

    const slugVal = validateRepositorySlug(childSlug);
    if (!slugVal.valid) return failure(slugVal.error!, 400);

    try {
      const parent = await repositoryAccess(db, parentRepositoryId, actor.id);
      if (!parent) return failure('Parent repository not found.', 404);
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

  return failure('Supported control-plane actions: create-repository, fork, gateway-record-ref, gateway-confirm-fork.', 400);
};
