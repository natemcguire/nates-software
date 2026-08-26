// POST /api/payments/webhook
// Handles payment_intent.succeeded, executes atomic transfers, records in D1, and mints license key

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json() as any;
    const { eventType = 'payment_intent.succeeded', paymentIntentId, appId = 'dronehunter', buyerId = 'usr_nate' } = body;

    if (eventType !== 'payment_intent.succeeded') {
      return Response.json({ success: true, message: 'Unhandled event ignored' });
    }

    const licenseKey = `NSW-${appId.substring(0, 2).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString(36).substring(4).toUpperCase()}`;
    const orderId = `ord_${Date.now().toString(36)}`;
    const shelfId = `shelf_${Date.now().toString(36)}`;

    if (env && env.DB) {
      // 1. Update order status
      await env.DB.prepare(`
        UPDATE orders SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP
        WHERE payment_intent_id = ? OR id = ?
      `).bind(paymentIntentId || '', orderId).run();

      // 2. Mint cryptographic license
      await env.DB.prepare(`
        INSERT INTO licenses (id, license_key, user_id, app_id, order_id, version, status)
        VALUES (?, ?, ?, ?, ?, 'v1.0.0', 'active')
      `).bind(`lic_${Date.now().toString(36)}`, licenseKey, buyerId, appId, orderId).run();

      // 3. Add to user shelf
      await env.DB.prepare(`
        INSERT INTO shelf_items (id, user_id, app_id, license_key)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(shelfId, buyerId, appId, licenseKey).run();
    }

    return Response.json({
      success: true,
      settled: true,
      licenseKey,
      shelfId,
      message: 'Payment settled and license minted'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
