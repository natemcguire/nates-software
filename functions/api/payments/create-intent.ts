// POST /api/payments/create-intent
// Durable Commerce Purchase State Machine Step 1:
// Snapshot authoritative price & lineage DAG allocations in D1 and create Stripe PaymentIntent.

import { requireAuth } from '../_auth';
import { calculateAllocations, fetchRepositoryAncestry } from '../../../src/lib/commerceDomain';

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  // Fail-closed guard: payments disabled in production until durable commerce is fully commissioned
  if (env?.PAYMENTS_ENABLED !== 'true') {
    return Response.json(
      { success: false, error: 'Checkout is temporarily unavailable while durable settlement is being commissioned.' },
      { status: 503 }
    );
  }

  try {
    if (!env?.DB) {
      return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
    }

    // Require authenticated session and validate same-origin mutation
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) {
      return auth.errorResponse;
    }
    const buyer = auth.user!;

    // Require Idempotency-Key header
    const idempotencyKey = request.headers.get('Idempotency-Key') || request.headers.get('idempotency-key');
    if (!idempotencyKey || !idempotencyKey.trim()) {
      return Response.json(
        { success: false, error: 'Idempotency-Key header is required' },
        { status: 400 }
      );
    }
    const trimmedIdempotencyKey = idempotencyKey.trim();
    if (trimmedIdempotencyKey.length > 128 || /[^A-Za-z0-9._:-]/.test(trimmedIdempotencyKey)) {
      return Response.json(
        { success: false, error: 'Idempotency-Key must be at most 128 characters using letters, numbers, dot, underscore, colon, or hyphen' },
        { status: 400 }
      );
    }

    // Parse request body and strictly validate appId
    // All client-supplied price, buyer, maker, and ancestor fields are deliberately ignored.
    let body: any;
    try {
      body = await request.json();
    } catch {
      return Response.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const appId = typeof body?.appId === 'string' ? body.appId.trim() : '';
    if (!appId) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    // Check for existing order with (buyer_user_id, idempotency_key)
    const existingOrder: any = await env.DB.prepare(`
      SELECT id, idempotency_key, buyer_user_id, app_id, repository_id, seller_user_id,
             app_version, price_version, gross_cents, currency, lineage_policy,
             lineage_snapshot_json, stripe_payment_intent_id, status, failure_code
      FROM commerce_orders
      WHERE buyer_user_id = ? AND idempotency_key = ?
    `).bind(buyer.id, trimmedIdempotencyKey).first();

    if (existingOrder) {
      if (existingOrder.app_id !== appId) {
        return Response.json(
          { success: false, error: 'Idempotency key was previously used for a different app purchase' },
          { status: 409 }
        );
      }

      if (existingOrder.stripe_payment_intent_id && existingOrder.status !== 'payment_failed') {
        const publishableKey = env?.STRIPE_PUBLISHABLE_KEY;
        if (!publishableKey) {
          return Response.json(
            { success: false, error: 'Stripe publishable key is not configured' },
            { status: 500 }
          );
        }
        return Response.json({
          success: true,
          orderId: existingOrder.id,
          paymentIntentId: existingOrder.stripe_payment_intent_id,
          amountCents: existingOrder.gross_cents,
          currency: existingOrder.currency,
          publishableKey,
          lineageSnapshot: JSON.parse(existingOrder.lineage_snapshot_json),
          status: existingOrder.status
        });
      }

      if (existingOrder.status === 'payment_failed') {
        return Response.json(
          { success: false, error: `Previous attempt with this idempotency key failed: ${existingOrder.failure_code || 'payment_failed'}` },
          { status: 409 }
        );
      }

      return Response.json(
        { success: false, error: 'An order with this idempotency key is already being created; retry shortly' },
        { status: 409, headers: { 'Retry-After': '2' } }
      );
    }

    // Read authoritative product definition from D1 commerce_products
    const product: any = await env.DB.prepare(`
      SELECT app_id AS appId, repository_id AS repositoryId, seller_user_id AS sellerUserId,
             price_cents AS priceCents, currency, price_version AS priceVersion, status
      FROM commerce_products
      WHERE app_id = ?
    `).bind(appId).first();

    if (!product) {
      return Response.json({ success: false, error: `Product not found for app: ${appId}` }, { status: 404 });
    }

    if (product.status !== 'active') {
      return Response.json(
        { success: false, error: `Product is not active for purchasing (status: ${product.status})` },
        { status: 400 }
      );
    }

    // Read authoritative app listing from D1 app_listings
    const appListing: any = await env.DB.prepare(`
      SELECT id, name, version, creator_id AS creatorId
      FROM app_listings
      WHERE id = ?
    `).bind(appId).first();

    if (!appListing) {
      return Response.json({ success: false, error: `App listing not found for app: ${appId}` }, { status: 404 });
    }

    // Determine repository ID (from product or fallback to repositories table if linked)
    let repositoryId = product.repositoryId || null;
    if (!repositoryId) {
      const repoRow: any = await env.DB.prepare(`
        SELECT id FROM repositories WHERE app_id = ?
      `).bind(appId).first();
      if (repoRow?.id) {
        repositoryId = repoRow.id;
      }
    }

    if (repositoryId) {
      const repository: any = await env.DB.prepare(`
        SELECT app_id AS appId, owner_user_id AS ownerUserId, status
        FROM repositories WHERE id = ?
      `).bind(repositoryId).first();
      if (!repository || repository.appId !== appId || repository.ownerUserId !== product.sellerUserId || repository.status !== 'active') {
        return Response.json(
          { success: false, error: 'Product repository ownership or listing linkage is invalid' },
          { status: 409 }
        );
      }
    }

    // Read repository lineage ancestry DAG from D1
    const ancestors = await fetchRepositoryAncestry(env.DB, repositoryId);

    // Calculate deterministic allocations
    const calculation = calculateAllocations({
      grossCents: product.priceCents,
      currency: product.currency,
      sellerUserId: product.sellerUserId,
      repositoryId,
      ancestors
    });

    // Generate durable order ID and prepare atomic batch
    const orderId = `ord_${crypto.randomUUID().replace(/-/g, '')}`;
    const statements: any[] = [];

    // 1. Persist commerce_orders row in 'creating' status
    statements.push(
      env.DB.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, repository_id,
          seller_user_id, app_version, price_version, gross_cents,
          currency, lineage_policy, lineage_snapshot_json, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', datetime('now'), datetime('now'))
      `).bind(
        orderId,
        trimmedIdempotencyKey,
        buyer.id,
        appId,
        repositoryId,
        product.sellerUserId,
        appListing.version || 'v1.0.0',
        product.priceVersion,
        calculation.grossCents,
        calculation.currency,
        calculation.lineagePolicy,
        calculation.snapshotJson
      )
    );

    // 2. Persist immutable commerce_order_allocations rows
    for (const alloc of calculation.allocations) {
      const allocId = `coa_${crypto.randomUUID().replace(/-/g, '')}`;
      statements.push(
        env.DB.prepare(`
          INSERT INTO commerce_order_allocations (
            id, order_id, sequence, role, recipient_user_id,
            source_repository_id, lineage_depth, basis_points,
            amount_cents, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          allocId,
          orderId,
          alloc.sequence,
          alloc.role,
          alloc.recipientUserId,
          alloc.sourceRepositoryId,
          alloc.lineageDepth,
          alloc.basisPoints,
          alloc.amountCents
        )
      );
    }

    // 3. Persist initial checkout event
    const eventId = `coe_${crypto.randomUUID().replace(/-/g, '')}`;
    statements.push(
      env.DB.prepare(`
        INSERT INTO commerce_order_events (
          id, order_id, event_type, source, source_event_id, details_json, created_at
        ) VALUES (?, ?, 'order_created', 'checkout', ?, ?, datetime('now'))
      `).bind(
        eventId,
        orderId,
        `checkout_${orderId}`,
        JSON.stringify({
          grossCents: calculation.grossCents,
          currency: calculation.currency,
          buyerUserId: buyer.id,
          sellerUserId: product.sellerUserId,
          isRoot: calculation.isRoot,
          ancestorCount: ancestors.length
        })
      )
    );

    // Execute atomic persistence before calling Stripe
    try {
      await env.DB.batch(statements);
    } catch (dbErr: any) {
      console.error('[COMMERCE ORDER PERSISTENCE ERROR]', dbErr);
      return Response.json(
        { success: false, error: `Failed to persist commerce order: ${dbErr?.message || 'database error'}` },
        { status: 500 }
      );
    }

    // Fail honestly: never fabricate mock Stripe keys, secrets, or IDs
    const stripeSecretKey = env?.STRIPE_SECRET_KEY;
    const stripePublishableKey = env?.STRIPE_PUBLISHABLE_KEY;

    if (!stripeSecretKey || typeof stripeSecretKey !== 'string' || !stripeSecretKey.trim()) {
      await env.DB.prepare(`
        UPDATE commerce_orders SET status = 'payment_failed', failure_code = 'stripe_secret_missing', updated_at = datetime('now')
        WHERE id = ?
      `).bind(orderId).run();

      return Response.json(
        { success: false, error: 'Stripe secret key is not configured on the server' },
        { status: 500 }
      );
    }

    if (!stripePublishableKey || typeof stripePublishableKey !== 'string' || !stripePublishableKey.trim()) {
      await env.DB.prepare(`
        UPDATE commerce_orders SET status = 'payment_failed', failure_code = 'stripe_publishable_missing', updated_at = datetime('now')
        WHERE id = ?
      `).bind(orderId).run();

      return Response.json(
        { success: false, error: 'Stripe publishable key is not configured on the server' },
        { status: 500 }
      );
    }

    // Call Stripe to create genuine PaymentIntent
    let stripeRes: Response;
    try {
      const stripeParams = new URLSearchParams();
      stripeParams.append('amount', calculation.grossCents.toString());
      stripeParams.append('currency', calculation.currency);
      stripeParams.append('description', `Shareware License: ${appListing.name || appId}`);
      stripeParams.append('automatic_payment_methods[enabled]', 'true');
      // Restrict to non-redirect methods (cards, wallets). The CheckoutModal
      // confirms in-page with `redirect: 'if_required'` and provides no
      // return_url, so redirect-based methods (which Stripe would otherwise
      // offer with the default allow_redirects=always) cannot complete and
      // would error at confirm time. 'never' keeps the in-modal flow honest.
      stripeParams.append('automatic_payment_methods[allow_redirects]', 'never');
      stripeParams.append('metadata[orderId]', orderId);
      stripeParams.append('metadata[appId]', appId);
      stripeParams.append('metadata[buyerUserId]', buyer.id);
      stripeParams.append('metadata[sellerUserId]', product.sellerUserId);
      stripeParams.append('metadata[priceVersion]', product.priceVersion.toString());
      stripeParams.append('metadata[lineagePolicy]', calculation.lineagePolicy);
      stripeParams.append('metadata[makerCents]', calculation.makerCents.toString());
      stripeParams.append('metadata[lineageTotalCents]', calculation.lineageTotalCents.toString());
      stripeParams.append('metadata[protocolPoolCents]', calculation.protocolPoolCents.toString());

      stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': `pi_${orderId}`
        },
        body: stripeParams.toString()
      });
    } catch (networkErr: any) {
      console.error('[STRIPE NETWORK ERROR]', networkErr);
      await env.DB.prepare(`
        UPDATE commerce_orders SET status = 'payment_failed', failure_code = 'stripe_network_error', updated_at = datetime('now')
        WHERE id = ?
      `).bind(orderId).run();

      return Response.json(
        { success: false, error: `Failed to connect to Stripe: ${networkErr?.message || 'network error'}` },
        { status: 502 }
      );
    }

    if (!stripeRes.ok) {
      const stripeErrData: any = await stripeRes.json().catch(() => ({}));
      const errorMessage = stripeErrData?.error?.message || `Stripe returned status ${stripeRes.status}`;
      const errorCode = stripeErrData?.error?.code || 'stripe_error';

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE commerce_orders SET status = 'payment_failed', failure_code = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(errorCode, orderId),
        env.DB.prepare(`
          INSERT INTO commerce_order_events (id, order_id, event_type, source, source_event_id, details_json, created_at)
          VALUES (?, ?, 'intent_creation_failed', 'checkout', ?, ?, datetime('now'))
        `).bind(
          `coe_${crypto.randomUUID().replace(/-/g, '')}`,
          orderId,
          `stripe_err_${orderId}`,
          JSON.stringify({ error: errorMessage, code: errorCode, status: stripeRes.status })
        )
      ]);

      return Response.json(
        { success: false, error: `Stripe PaymentIntent creation failed: ${errorMessage}` },
        { status: 502 }
      );
    }

    const stripeData = await stripeRes.json() as any;
    const paymentIntentId = stripeData.id;
    const clientSecret = stripeData.client_secret;

    if (!paymentIntentId || !clientSecret) {
      await env.DB.prepare(`
        UPDATE commerce_orders SET status = 'payment_failed', failure_code = 'invalid_stripe_payload', updated_at = datetime('now')
        WHERE id = ?
      `).bind(orderId).run();

      return Response.json(
        { success: false, error: 'Stripe did not return a valid PaymentIntent ID or client secret' },
        { status: 502 }
      );
    }

    // Update commerce_orders to 'requires_payment' and record event
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE commerce_orders
        SET stripe_payment_intent_id = ?, status = 'requires_payment', updated_at = datetime('now')
        WHERE id = ?
      `).bind(paymentIntentId, orderId),
      env.DB.prepare(`
        INSERT INTO commerce_order_events (id, order_id, event_type, source, source_event_id, details_json, created_at)
        VALUES (?, ?, 'intent_created', 'checkout', ?, ?, datetime('now'))
      `).bind(
        `coe_${crypto.randomUUID().replace(/-/g, '')}`,
        orderId,
        paymentIntentId,
        JSON.stringify({ paymentIntentId, clientSecretPresent: Boolean(clientSecret) })
      )
    ]);

    return Response.json({
      success: true,
      orderId,
      clientSecret,
      paymentIntentId,
      amountCents: calculation.grossCents,
      currency: calculation.currency,
      publishableKey: stripePublishableKey,
      lineageSnapshot: calculation.snapshot,
      allocations: calculation.allocations
    });
  } catch (err: any) {
    console.error('[CREATE INTENT UNHANDLED ERROR]', err);
    return Response.json(
      { success: false, error: err?.message || 'Internal server error during intent creation' },
      { status: 500 }
    );
  }
};
