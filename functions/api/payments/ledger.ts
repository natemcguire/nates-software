import { requireAuth } from '../_auth';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  if (!env?.DB) {
    return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
  }

  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  const seller = auth.user!;

  try {
    const { results: orders } = await env.DB.prepare(`
      SELECT DISTINCT
        o.id,
        o.buyer_user_id AS buyerUserId,
        o.app_id AS appId,
        o.repository_id AS repositoryId,
        o.seller_user_id AS sellerUserId,
        o.app_version AS appVersion,
        o.gross_cents AS grossCents,
        o.currency,
        o.lineage_policy AS lineagePolicy,
        o.status,
        o.created_at AS createdAt,
        o.paid_at AS paidAt,
        o.fulfilled_at AS fulfilledAt,
        al.name AS appName,
        bu.username AS buyerUsername,
        su.username AS sellerUsername
      FROM commerce_orders o
      LEFT JOIN app_listings al ON al.id = o.app_id
      LEFT JOIN users bu ON bu.id = o.buyer_user_id
      LEFT JOIN users su ON su.id = o.seller_user_id
      WHERE (
        o.seller_user_id = ?
        OR o.id IN (
          SELECT a_sub.order_id
          FROM commerce_order_allocations a_sub
          WHERE a_sub.recipient_user_id = ?
        )
      )
      AND o.status = 'fulfilled'
      ORDER BY COALESCE(o.fulfilled_at, o.created_at) DESC
    `).bind(seller.id, seller.id).all();

    if (!orders || orders.length === 0) {
      return Response.json({
        success: true,
        sellerId: seller.id,
        orders: [],
        entries: [],
        summary: {
          totalOrders: 0,
          totalGrossCents: 0,
          totalEarnedCents: 0,
          settledCents: 0,
          pendingCents: 0
        }
      });
    }

    const orderIds = (orders as any[]).map(o => o.id);
    const placeholders = orderIds.map(() => '?').join(',');

    const { results: rawAllocations } = await env.DB.prepare(`
      SELECT
        a.id AS allocationId,
        a.order_id AS orderId,
        a.sequence,
        a.role,
        a.recipient_user_id AS recipientUserId,
        a.source_repository_id AS sourceRepositoryId,
        a.lineage_depth AS lineageDepth,
        a.basis_points AS basisPoints,
        a.amount_cents AS amountCents,
        a.created_at AS allocationCreatedAt,
        u.username AS recipientUsername,
        t.id AS transferId,
        t.destination_user_id AS destinationUserId,
        t.status AS transferStatus,
        t.stripe_transfer_id AS stripeTransferId,
        t.available_at AS transferAvailableAt,
        t.completed_at AS transferCompletedAt,
        t.created_at AS transferCreatedAt,
        t.last_error AS transferLastError
      FROM commerce_order_allocations a
      LEFT JOIN users u ON u.id = a.recipient_user_id
      LEFT JOIN commerce_transfer_outbox t ON t.allocation_id = a.id
      WHERE a.order_id IN (${placeholders})
      ORDER BY a.order_id, a.sequence ASC
    `).bind(...orderIds).all();

    const allocationsByOrder = new Map<string, any[]>();
    for (const row of (rawAllocations || []) as any[]) {
      if (!allocationsByOrder.has(row.orderId)) {
        allocationsByOrder.set(row.orderId, []);
      }
      allocationsByOrder.get(row.orderId)!.push({
        id: row.allocationId,
        orderId: row.orderId,
        sequence: row.sequence,
        role: row.role,
        recipientUserId: row.recipientUserId,
        recipientUsername: row.recipientUsername || null,
        sourceRepositoryId: row.sourceRepositoryId || null,
        lineageDepth: row.lineageDepth,
        basisPoints: row.basisPoints,
        amountCents: row.amountCents,
        createdAt: row.allocationCreatedAt,
        transfer: row.transferId ? {
          id: row.transferId,
          destinationUserId: row.destinationUserId,
          status: row.transferStatus || 'pending',
          isSettled: row.transferStatus === 'succeeded',
          stripeTransferId: row.stripeTransferId || null,
          availableAt: row.transferAvailableAt,
          completedAt: row.transferCompletedAt,
          createdAt: row.transferCreatedAt,
          lastError: row.transferLastError || null
        } : null
      });
    }

    let totalGrossCents = 0;
    let totalEarnedCents = 0;
    let settledCents = 0;
    let pendingCents = 0;

    const enrichedOrders = (orders as any[]).map(o => {
      const orderAllocs = allocationsByOrder.get(o.id) || [];
      const callerAlloc = orderAllocs.find(a => a.recipientUserId === seller.id);

      const earnedCents = callerAlloc ? callerAlloc.amountCents : 0;
      const isSettled = callerAlloc?.transfer?.isSettled || callerAlloc?.transfer?.status === 'succeeded';
      const transferStatus = callerAlloc?.transfer?.status || (callerAlloc ? 'pending' : 'none');

      totalGrossCents += Number(o.grossCents) || 0;
      totalEarnedCents += earnedCents;
      if (isSettled) {
        settledCents += earnedCents;
      } else {
        pendingCents += earnedCents;
      }

      return {
        id: o.id,
        buyerUserId: o.buyerUserId,
        buyerUsername: o.buyerUsername || 'anonymous',
        appId: o.appId,
        appName: o.appName || o.appId,
        appVersion: o.appVersion,
        sellerUserId: o.sellerUserId,
        sellerUsername: o.sellerUsername || 'unknown',
        grossCents: o.grossCents,
        currency: o.currency,
        status: o.status,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        fulfilledAt: o.fulfilledAt,
        callerAllocation: callerAlloc || null,
        callerEarnedCents: earnedCents,
        callerRole: callerAlloc?.role || (o.sellerUserId === seller.id ? 'maker' : null),
        transferStatus,
        isSettled: Boolean(isSettled),
        allocations: orderAllocs
      };
    });

    return Response.json({
      success: true,
      sellerId: seller.id,
      orders: enrichedOrders,
      entries: enrichedOrders,
      summary: {
        totalOrders: enrichedOrders.length,
        totalGrossCents,
        totalEarnedCents,
        settledCents,
        pendingCents
      }
    });
  } catch (error: any) {
    console.error('[SELLER LEDGER GET] Error:', error);
    return Response.json(
      { success: false, error: error?.message || 'Failed to retrieve seller ledger' },
      { status: 500 }
    );
  }
};

export const onRequestPost = () => new Response(null, { status: 405, headers: { Allow: 'GET' } });
export const onRequestPut = () => new Response(null, { status: 405, headers: { Allow: 'GET' } });
export const onRequestDelete = () => new Response(null, { status: 405, headers: { Allow: 'GET' } });
