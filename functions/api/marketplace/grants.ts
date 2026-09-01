// GET  /api/marketplace/grants  — authenticated grant-history surface for repo OWNERS.
// POST /api/marketplace/grants  — { action: 'revoke', grantId } revokes a PENDING grant.
//
// Fix 2 (INBOX marketplace) — discoverable contribution marketplace, part 2.
//
// This is distinct from GET /api/payments/grants (functions/api/payments/grants.ts),
// which is the CONTRIBUTOR-scoped "what have I been granted / what have I
// earned" surface. This endpoint is the OWNER-scoped "who did I grant shares
// to on repos I own, and can I still revoke any of them" surface.
//
// Server derives the caller's identity from session ONLY — a request can
// never claim to be inspecting/revoking another owner's grants. Only
// 'pending' grants are revocable; 'active' grants are perpetual/irrevocable
// per the marketplace policy and the 0029/0030 immutability triggers — this
// endpoint never attempts to bypass those triggers, it just enforces the
// same rule at the API boundary so the error is a clean 409 instead of a
// raw SQLite RAISE(ABORT).

import { requireAuth, getSessionUser } from '../_auth';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const user = await getSessionUser(request, env);
  if (!user) {
    return Response.json(
      { success: false, error: 'Unauthorized: Valid authenticated session required' },
      { status: 401 }
    );
  }

  if (!env?.DB) {
    return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
  }

  try {
    const url = new URL(request.url);
    const repositoryIdFilter = (url.searchParams.get('repositoryId') || '').trim() || null;

    // Owner-scoped: only grants on repositories THIS caller owns. Never
    // accepts an ownerUserId from the request — always the session's own id.
    const { results } = await env.DB.prepare(`
      SELECT
        cs.id, cs.repository_id AS repositoryId, cs.contributor_user_id AS contributorUserId,
        cu.username AS contributorUsername,
        cs.granted_by_user_id AS grantedByUserId,
        cs.basis_points AS basisPoints, cs.status,
        cs.created_at AS createdAt, cs.activated_at AS activatedAt, cs.revoked_at AS revokedAt,
        r.slug AS repoSlug, r.app_id AS appId, a.name AS appName
      FROM contributor_shares cs
      JOIN repositories r ON r.id = cs.repository_id
      JOIN users cu ON cu.id = cs.contributor_user_id
      LEFT JOIN app_listings a ON a.id = r.app_id
      WHERE r.owner_user_id = ?
        AND (? IS NULL OR cs.repository_id = ?)
      ORDER BY cs.created_at DESC
    `).bind(user.id, repositoryIdFilter, repositoryIdFilter).all();

    const grants = (results || []).map((row: any) => ({
      id: row.id,
      repositoryId: row.repositoryId,
      repoSlug: row.repoSlug,
      appId: row.appId ?? null,
      appName: row.appName ?? null,
      contributorUserId: row.contributorUserId,
      contributorUsername: row.contributorUsername,
      grantedByUserId: row.grantedByUserId,
      basisPoints: row.basisPoints,
      status: row.status,
      createdAt: row.createdAt,
      activatedAt: row.activatedAt,
      revokedAt: row.revokedAt,
      revocable: row.status === 'pending'
    }));

    return Response.json({ success: true, grants });
  } catch (error: any) {
    console.error('[MARKETPLACE GRANTS READ ERROR]', error);
    return Response.json(
      { success: false, error: 'Failed to load grant history' },
      { status: 500 }
    );
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const { user, errorResponse } = await requireAuth(request, env);
  if (errorResponse || !user) {
    return errorResponse || Response.json(
      { success: false, error: 'Unauthorized: Valid authenticated session required' },
      { status: 401 }
    );
  }

  if (!env?.DB) {
    return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ success: false, error: 'Request body must be valid JSON object' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action : null;
    if (action !== 'revoke') {
      return Response.json({ success: false, error: `Unsupported action: ${action ?? 'undefined'}` }, { status: 400 });
    }

    const grantId = typeof body.grantId === 'string' ? body.grantId.trim() : '';
    if (!grantId) {
      return Response.json({ success: false, error: 'grantId is required' }, { status: 400 });
    }

    // Load the grant plus its repository owner so we can authorize AND give
    // an honest, specific error (not-found vs not-yours vs not-pending)
    // rather than a single opaque failure.
    const grant: any = await env.DB.prepare(`
      SELECT cs.id, cs.status, cs.repository_id AS repositoryId, r.owner_user_id AS ownerUserId
      FROM contributor_shares cs
      JOIN repositories r ON r.id = cs.repository_id
      WHERE cs.id = ?
    `).bind(grantId).first();

    if (!grant) {
      return Response.json({ success: false, error: 'Grant not found' }, { status: 404 });
    }

    if (grant.ownerUserId !== user.id) {
      return Response.json(
        { success: false, error: 'Forbidden: only the repository owner can revoke a grant' },
        { status: 403 }
      );
    }

    if (grant.status !== 'pending') {
      // Active grants are perpetual/irrevocable per marketplace policy and the
      // 0029/0030 triggers — never attempt the UPDATE, just say so honestly.
      return Response.json(
        { success: false, error: `Only pending grants are revocable; this grant is '${grant.status}'` },
        { status: 409 }
      );
    }

    const result = await env.DB.prepare(`
      UPDATE contributor_shares
      SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).bind(grantId).run();

    const changed = (result?.meta?.changes ?? 0) > 0;
    if (!changed) {
      // Lost a race with some other transition between the read above and
      // this write — report the real current state, don't fake success.
      return Response.json(
        { success: false, error: 'Grant was no longer pending; revoke did not apply' },
        { status: 409 }
      );
    }

    return Response.json({ success: true, grantId, status: 'revoked' });
  } catch (error: any) {
    console.error('[MARKETPLACE GRANT REVOKE ERROR]', error);
    return Response.json(
      { success: false, error: 'Failed to revoke grant' },
      { status: 500 }
    );
  }
};
