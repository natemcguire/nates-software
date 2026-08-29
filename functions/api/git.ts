// GITSMITH control-plane API. Git object transfer and authoritative ref CAS
// belong to a real Git gateway. D1 stores the query projection, immutable fork
// lineage, access policy, and durable work queue.

import { getSessionUser, requireAuth } from './_auth';
import { validateForkOrigin } from '../../src/lib/forgeDomain';

type D1Database = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };

const dbFrom = (env: any): D1Database | null =>
  env?.DB && typeof env.DB.prepare === 'function' ? env.DB as D1Database : null;

const failure = (error: string, status = 503) =>
  Response.json({ success: false, error }, { status });

async function repositoryAccess(db: D1Database, repositoryId: string, userId = '') {
  return db.prepare(`
    SELECT r.id, r.app_id AS appId, r.owner_user_id AS ownerUserId,
           r.slug, r.visibility, r.object_format AS objectFormat,
           r.default_ref AS defaultRef, r.status,
           CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE m.role END AS memberRole
    FROM repositories r
    LEFT JOIN repository_members m
      ON m.repository_id = r.id AND m.user_id = ?
    WHERE r.id = ?
  `).bind(userId, userId, repositoryId).first();
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  if (url.searchParams.has('service') || url.pathname.endsWith('/info/refs')) {
    return failure(
      'Git smart HTTP is not served by this control-plane endpoint. Configure the GITSMITH gateway.',
      501
    );
  }

  const repositoryId = url.searchParams.get('repositoryId');
  if (!repositoryId) {
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
  const db = dbFrom(env);
  if (!db) return failure('Forge database binding is unavailable.');

  try {
    const user = await getSessionUser(request, env);
    const repository = await repositoryAccess(db, repositoryId, user?.id);
    if (!repository) return failure('Repository not found.', 404);
    if (repository.visibility === 'private' && !repository.memberRole) {
      return failure(user ? 'Forbidden.' : 'Authentication required.', user ? 403 : 401);
    }
    const refs = await db.prepare(`
      SELECT ref_name AS refName, commit_oid AS commitOid, version,
             updated_by_user_id AS updatedByUserId, updated_at AS updatedAt
      FROM repository_refs WHERE repository_id = ? ORDER BY ref_name
    `).bind(repositoryId).all();
    const fork = await db.prepare(`
      SELECT parent_repository_id AS parentRepositoryId,
             parent_ref_name AS parentRefName, parent_commit_oid AS parentCommitOid,
             child_initial_commit_oid AS childInitialCommitOid,
             lineage_root_repository_id AS lineageRootRepositoryId,
             depth, created_at AS createdAt
      FROM repository_forks WHERE child_repository_id = ?
    `).bind(repositoryId).first();
    return Response.json({ success: true, repository, refs: refs.results || [], fork: fork || null });
  } catch (error: any) {
    return failure(`Forge query failed: ${error?.message || 'unknown database error'}`, 500);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  const actor = auth.user!;
  const db = dbFrom(env);
  if (!db) return failure('Forge database binding is unavailable.');

  let body: any;
  try { body = await request.json(); }
  catch { return failure('Request body must be valid JSON.', 400); }

  if (['ref-update', 'push', 'cas'].includes(body.action)) {
    return failure('Ref mutation is accepted only from the authenticated GITSMITH gateway.', 501);
  }
  if (body.action !== 'fork') return failure('Supported control-plane action: fork.', 400);

  const childRepositoryId = String(body.childRepositoryId || '');
  const parentRepositoryId = String(body.parentRepositoryId || '');
  const parentRefName = String(body.parentRefName || 'refs/heads/main');

  try {
    const child = await repositoryAccess(db, childRepositoryId, actor.id);
    const parent = await repositoryAccess(db, parentRepositoryId, actor.id);
    if (!child || !parent) return failure('Parent or child repository not found.', 404);
    if (child.ownerUserId !== actor.id) {
      return failure('Only the child repository owner can register its fork origin.', 403);
    }
    if (parent.visibility === 'private' && !parent.memberRole) {
      return failure('Parent repository is not accessible.', 403);
    }

    const parentRef = await db.prepare(`
      SELECT commit_oid AS commitOid FROM repository_refs
      WHERE repository_id = ? AND ref_name = ?
    `).bind(parentRepositoryId, parentRefName).first();
    const childRef = await db.prepare(`
      SELECT commit_oid AS commitOid FROM repository_refs
      WHERE repository_id = ? AND ref_name = ?
    `).bind(childRepositoryId, child.defaultRef).first();
    if (!parentRef) return failure('Parent ref is not present in the canonical projection.', 409);
    if (!childRef) return failure('Child default ref is not present in the canonical projection.', 409);

    const parentFork = await db.prepare(`
      SELECT lineage_root_repository_id AS lineageRootRepositoryId, depth
      FROM repository_forks WHERE child_repository_id = ?
    `).bind(parentRepositoryId).first();
    const lineageRootRepositoryId = parentFork?.lineageRootRepositoryId || parentRepositoryId;
    const depth = parentFork ? Number(parentFork.depth) + 1 : 1;
    const errors = validateForkOrigin({
      childRepositoryId, parentRepositoryId, parentRefName,
      parentCommitOid: String(parentRef.commitOid),
      childInitialCommitOid: String(childRef.commitOid),
      lineageRootRepositoryId, depth
    });
    if (errors.length) return Response.json({ success: false, errors }, { status: 400 });
    if (parentRef.commitOid !== childRef.commitOid) {
      return failure('Register fork origin before the child default ref diverges from its parent snapshot.', 409);
    }

    const eventId = `evt_${crypto.randomUUID()}`;
    const event = {
      childRepositoryId, parentRepositoryId, parentRefName,
      parentCommitOid: parentRef.commitOid,
      childInitialCommitOid: childRef.commitOid,
      lineageRootRepositoryId, depth, actorUserId: actor.id
    };
    await db.batch([
      db.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        childRepositoryId, parentRepositoryId, actor.id, parentRefName,
        parentRef.commitOid, childRef.commitOid, lineageRootRepositoryId, depth
      ),
      db.prepare(`
        INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
        VALUES (?, 'fork', ?, 'repository.fork_registered', ?)
      `).bind(eventId, childRepositoryId, JSON.stringify(event))
    ]);
    return Response.json({ success: true, fork: event, outboxEventId: eventId }, { status: 201 });
  } catch (error: any) {
    const message = String(error?.message || 'unknown database error');
    if (message.includes('UNIQUE') || message.includes('constraint')) {
      return failure('Fork origin already exists or violates an integrity constraint.', 409);
    }
    return failure(`Fork registration failed: ${message}`, 500);
  }
};
