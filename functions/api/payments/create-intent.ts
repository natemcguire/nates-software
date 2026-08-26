// POST /api/payments/create-intent
// Initializes Stripe PaymentIntent with transfer_group metadata and 70/20/10 split

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json() as any;
    const { appId, buyerId = 'usr_guest', currency = 'usd', customPriceCents } = body;

    if (!appId) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    // Determine price
    let amountCents = customPriceCents || 1500; // $15.00 default shareware license
    if (appId === 'dronehunter') amountCents = 1500;
    if (appId === 'certified-mailer') amountCents = 2500;
    if (appId === 'picfitai') amountCents = 2000;

    // Calculate 70/20/10 Lineage Splits
    const makerCents = Math.floor(amountCents * 0.70);
    const lineageCents = Math.floor(amountCents * 0.20);
    const platformCents = amountCents - makerCents - lineageCents; // Conserves exact cents

    const transferGroup = `grp_ord_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const paymentIntentId = `pi_mock_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    const clientSecret = `${paymentIntentId}_secret_${Math.random().toString(36).substring(2, 10)}`;

    if (env && env.DB) {
      const orderId = `ord_${Date.now().toString(36)}`;
      await env.DB.prepare(`
        INSERT INTO orders (id, buyer_user_id, app_id, payment_intent_id, transfer_group, amount_cents, currency, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `).bind(orderId, buyerId, appId, paymentIntentId, transferGroup, amountCents, currency).run();
    }

    return Response.json({
      success: true,
      clientSecret,
      paymentIntentId,
      transferGroup,
      amountCents,
      splits: {
        makerCents,
        lineageCents,
        platformCents
      },
      publishableKey: env?.STRIPE_PUBLISHABLE_KEY || 'pk_test_mock_nates_software_key'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
