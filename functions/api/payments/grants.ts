import { requireAuth } from '../_auth';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;

  if (!env?.DB) {
    return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
  }

  const userId = auth.user!.id;

  try {
    const [grantsResult, earningsResult, payoutsResult] = await Promise.all([
      env.DB.prepare(`
        SELECT cs.id, cs.repository_id AS repositoryId, r.app_id AS appId,
               cs.basis_points AS basisPoints, cs.status, cs.created_at AS createdAt,
               cs.activated_at AS activatedAt
        FROM contributor_shares cs
        JOIN repositories r ON r.id = cs.repository_id
        WHERE cs.contributor_user_id = ?
        ORDER BY cs.created_at DESC
      `).bind(userId).all(),
      env.DB.prepare(`
        SELECT coa.role, COUNT(*) AS n, SUM(coa.amount_cents) AS total_cents
        FROM commerce_order_allocations coa
        JOIN commerce_orders o ON o.id = coa.order_id
        WHERE coa.recipient_user_id = ? AND o.status = 'fulfilled'
        GROUP BY coa.role
      `).bind(userId).all(),
      env.DB.prepare(`
        SELECT status, COUNT(*) AS n, SUM(amount_cents) AS total_cents
        FROM commerce_transfer_outbox
        WHERE destination_user_id = ?
        GROUP BY status
      `).bind(userId).all()
    ]);

    const grants = (grantsResult?.results || []).map((row: any) => ({
      id: row.id,
      repositoryId: row.repositoryId,
      appId: row.appId,
      basisPoints: row.basisPoints,
      status: row.status,
      createdAt: row.createdAt,
      activatedAt: row.activatedAt
    }));

    const earningsByRole = (earningsResult?.results || []).map((row: any) => ({
      role: row.role,
      count: row.n,
      totalCents: row.total_cents || 0
    }));

    const byStatus = (payoutsResult?.results || []).map((row: any) => ({
      status: row.status,
      count: row.n,
      totalCents: row.total_cents || 0
    }));

    return Response.json({
      success: true,
      grants,
      earningsByRole,
      payouts: { byStatus }
    });
  } catch (error: any) {
    console.error('[GRANTS LOOKUP ERROR]', error);
    return Response.json(
      { success: false, error: 'Failed to load grants and earnings' },
      { status: 500 }
    );
  }
};

export const onRequestPost = async (_context?: unknown) => Response.json({
  success: false,
  error: 'Contributor grants are no longer created. This surface is a read-only history of legacy grants.'
}, { status: 405, headers: { Allow: 'GET' } });
