// POST /api/payments/create-intent
// Purchase State Machine Step 1:
// Freeze and snapshot the current Lineage DAG and maker/ancestor royalty splits at this exact instant.

import { createSettlementRecord, AncestorNode } from '../../../src/lib/gitsmithBackend';

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json() as any;
    const { appId, buyerId = 'usr_guest', currency = 'usd', customPriceCents, makerId, ancestors } = body;

    if (!appId) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    // Determine price
    let amountCents = customPriceCents || 1500; // $15.00 default shareware license
    if (appId === 'dronehunter') amountCents = 1500;
    if (appId === 'certified-mailer') amountCents = 2500;
    if (appId === 'picfitai') amountCents = 2000;

    // Snapshot Lineage DAG at the exact instant of the economic purchase event
    const ancestorList: AncestorNode[] = Array.isArray(ancestors) && ancestors.length > 0
      ? ancestors
      : [
          { appId: `${appId}-root`, creatorId: 'usr_nate', depth: 1 }
        ];

    const snapshotSettlement = createSettlementRecord({
      appId,
      buyerUserId: buyerId,
      makerId: makerId || 'usr_nate',
      grossCents: amountCents,
      ancestors: ancestorList,
      options: { distributionMethod: 'decay' }
    });

    const makerCents = snapshotSettlement.split.makerCents;
    const lineageCents = snapshotSettlement.split.lineageTotalCents;
    const platformCents = snapshotSettlement.split.poolCents;
    const lineageSnapshotJson = JSON.stringify({
      snapshottedAt: new Date().toISOString(),
      appId,
      makerId: makerId || 'usr_nate',
      ancestors: snapshotSettlement.split.ancestorSplits,
      makerCents,
      lineageCents,
      platformCents
    });

    const transferGroup = `grp_ord_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    let paymentIntentId = `pi_mock_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    let clientSecret = `${paymentIntentId}_secret_${Math.random().toString(36).substring(2, 10)}`;

    const stripeKey = env?.STRIPE_SECRET_KEY;

    if (stripeKey && !stripeKey.includes('mock') && !stripeKey.includes('test_mock')) {
      try {
        const params = new URLSearchParams();
        params.append('amount', amountCents.toString());
        params.append('currency', currency);
        params.append('transfer_group', transferGroup);
        params.append('description', `Shareware License: ${appId}`);
        params.append('metadata[appId]', appId);
        params.append('metadata[buyerId]', buyerId);
        params.append('metadata[makerId]', makerId || 'usr_nate');
        params.append('metadata[makerCents]', makerCents.toString());
        params.append('metadata[lineageCents]', lineageCents.toString());
        params.append('metadata[platformCents]', platformCents.toString());
        params.append('metadata[transferGroup]', transferGroup);
        params.append('metadata[lineageSnapshot]', lineageSnapshotJson);
        params.append('automatic_payment_methods[enabled]', 'true');

        const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });

        if (stripeRes.ok) {
          const pi = await stripeRes.json() as any;
          paymentIntentId = pi.id;
          clientSecret = pi.client_secret;
        } else {
          const err = await stripeRes.json() as any;
          console.error('[STRIPE ERROR]', err);
        }
      } catch (err: any) {
        console.error('[STRIPE INTENT FAILED]', err.message);
      }
    }

    if (env && env.DB) {
      const orderId = `ord_${Date.now().toString(36)}`;
      try {
        await env.DB.prepare(`
          INSERT INTO orders (id, buyer_user_id, app_id, gross_cents, stripe_payment_intent_id, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
        `).bind(orderId, buyerId, appId, amountCents, paymentIntentId).run();
      } catch {}
    }

    return Response.json({
      success: true,
      clientSecret,
      paymentIntentId,
      transferGroup,
      amountCents,
      lineageSnapshot: JSON.parse(lineageSnapshotJson),
      splits: {
        makerCents,
        lineageCents,
        platformCents,
        ancestorSplits: snapshotSettlement.split.ancestorSplits,
        conservationVerified: snapshotSettlement.split.conservationVerified
      },
      publishableKey: env?.STRIPE_PUBLISHABLE_KEY || 'pk_live_51S46TOAfNMTQ8RYHf8lJtpCtsLFqSj6Uo6qkqpRGLrtKUYFVEhMqNMkvHaCzKuj0P1g36OxHnA6K7sFg4djbyc1800W2v7I4tF'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
