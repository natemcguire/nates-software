import { requireAuth } from '../_auth';
import { calculateAllocations, fetchFrozenLiens, CommerceValidationError } from '../../../src/lib/commerceDomain';
import { checkAppResalePolicy } from '../_resalePolicy';

type PaymentIntentRecoveryResult =
  | { ok: true; paymentIntentId: string; clientSecret: string }
  | { ok: false; status: number; error: string; failureCode: string; definitive: boolean; stripeStatus?: number; retryAfter?: string };

type PaymentIntentRequest = {
  orderId: string;
  grossCents: number;
  currency: string;
  appId: string;
  appName: string;
  buyerUserId: string;
  sellerUserId: string;
  priceVersion: number;
  lineagePolicy: string;
  sellerCents?: number;
  ancestorTotalCents?: number;
  platformCents?: number;
};

function buildPaymentIntentParams(params: PaymentIntentRequest): URLSearchParams {
  const stripeParams = new URLSearchParams();
  stripeParams.append('amount', params.grossCents.toString());
  stripeParams.append('currency', params.currency);
  stripeParams.append('description', `Shareware License: ${params.appName || params.appId}`);
  stripeParams.append('automatic_payment_methods[enabled]', 'true');
  stripeParams.append('automatic_payment_methods[allow_redirects]', 'never');
  stripeParams.append('metadata[orderId]', params.orderId);
  stripeParams.append('metadata[appId]', params.appId);
  stripeParams.append('metadata[buyerUserId]', params.buyerUserId);
  stripeParams.append('metadata[sellerUserId]', params.sellerUserId);
  stripeParams.append('metadata[priceVersion]', params.priceVersion.toString());
  stripeParams.append('metadata[lineagePolicy]', params.lineagePolicy);
  if (Number.isSafeInteger(params.sellerCents)) stripeParams.append('metadata[sellerCents]', params.sellerCents!.toString());
  if (Number.isSafeInteger(params.ancestorTotalCents)) stripeParams.append('metadata[ancestorTotalCents]', params.ancestorTotalCents!.toString());
  if (Number.isSafeInteger(params.platformCents)) stripeParams.append('metadata[platformCents]', params.platformCents!.toString());
  return stripeParams;
}

async function stripeFailureResult(stripeRes: Response, action: string): Promise<PaymentIntentRecoveryResult> {
  const stripeErrData: any = await stripeRes.json().catch(() => ({}));
  const errorMessage = stripeErrData?.error?.message || `Stripe returned status ${stripeRes.status}`;
  const failureCode = stripeErrData?.error?.code || 'stripe_error';
  const errorType = stripeErrData?.error?.type;
  const definitive = stripeRes.status >= 400 && stripeRes.status < 500 &&
    (errorType === 'card_error' || failureCode === 'card_declined');
  return {
    ok: false,
    status: 502,
    error: `Stripe PaymentIntent ${action} failed: ${errorMessage}`,
    failureCode,
    definitive,
    stripeStatus: stripeRes.status,
    retryAfter: definitive ? undefined : '2'
  };
}

async function recoverOrCreatePaymentIntent(params: {
  fetchImpl: typeof fetch;
  request: PaymentIntentRequest;
  stripeSecretKey: string;
}): Promise<PaymentIntentRecoveryResult> {
  const { fetchImpl, request, stripeSecretKey } = params;
  const stripeParams = buildPaymentIntentParams(request);

  let stripeRes: Response;
  try {
    stripeRes = await fetchImpl('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `pi_${request.orderId}`
      },
      body: stripeParams.toString()
    });
  } catch (networkErr: any) {
    console.error('[STRIPE RECOVERY NETWORK ERROR]', networkErr);
    return {
      ok: false,
      status: 502,
      error: `Failed to connect to Stripe while recovering this order: ${networkErr?.message || 'network error'}. Retry shortly.`,
      failureCode: 'stripe_network_error',
      definitive: false,
      retryAfter: '2'
    };
  }

  if (!stripeRes.ok) {
    return stripeFailureResult(stripeRes, 'creation');
  }

  let stripeData: any;
  try {
    stripeData = await stripeRes.json();
  } catch {
    return {
      ok: false,
      status: 502,
      error: 'Stripe returned an unreadable PaymentIntent response. Retry shortly.',
      failureCode: 'invalid_stripe_payload',
      definitive: false,
      retryAfter: '2'
    };
  }
  const paymentIntentId = stripeData.id;
  const clientSecret = stripeData.client_secret;

  if (!paymentIntentId || !clientSecret) {
    return {
      ok: false,
      status: 502,
      error: 'Stripe did not return a valid PaymentIntent ID or client secret during recovery',
      failureCode: 'invalid_stripe_payload',
      definitive: false,
      retryAfter: '2'
    };
  }

  return { ok: true, paymentIntentId, clientSecret };
}

async function retrievePaymentIntent(params: {
  fetchImpl: typeof fetch;
  paymentIntentId: string;
  stripeSecretKey: string;
}): Promise<PaymentIntentRecoveryResult> {
  const { fetchImpl, paymentIntentId, stripeSecretKey } = params;
  let stripeRes: Response;
  try {
    stripeRes = await fetchImpl(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
    });
  } catch (networkErr: any) {
    return {
      ok: false,
      status: 502,
      error: `Failed to connect to Stripe while resuming this order: ${networkErr?.message || 'network error'}. Retry shortly.`,
      failureCode: 'stripe_network_error',
      definitive: false,
      retryAfter: '2'
    };
  }

  if (!stripeRes.ok) return stripeFailureResult(stripeRes, 'retrieval');

  let stripeData: any;
  try {
    stripeData = await stripeRes.json();
  } catch {
    return {
      ok: false,
      status: 502,
      error: 'Stripe returned an unreadable PaymentIntent response. Retry shortly.',
      failureCode: 'invalid_stripe_payload',
      definitive: false,
      retryAfter: '2'
    };
  }

  if (stripeData?.id !== paymentIntentId || !stripeData?.client_secret) {
    return {
      ok: false,
      status: 502,
      error: 'Stripe did not return a valid client secret for the persisted PaymentIntent',
      failureCode: 'invalid_stripe_payload',
      definitive: false,
      retryAfter: '2'
    };
  }

  return { ok: true, paymentIntentId, clientSecret: stripeData.client_secret };
}

async function markDefinitivePaymentFailure(db: any, orderId: string, failureCode: string, error: string, stripeStatus?: number) {
  await db.batch([
    db.prepare(`
      UPDATE commerce_orders SET status = 'payment_failed', failure_code = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(failureCode, orderId),
    db.prepare(`
      INSERT INTO commerce_order_events (id, order_id, event_type, source, source_event_id, details_json, created_at)
      VALUES (?, ?, 'intent_creation_failed', 'checkout', ?, ?, datetime('now'))
    `).bind(
      `coe_${crypto.randomUUID().replace(/-/g, '')}`,
      orderId,
      `stripe_err_${orderId}`,
      JSON.stringify({ error, code: failureCode, status: stripeStatus })
    )
  ]);
}

export const onRequestPost = async ({ request, env, stripeFetchOverride }: {
  request: Request;
  env: any;
  stripeFetchOverride?: typeof fetch;
}) => {
  const fetchImpl = stripeFetchOverride || globalThis.fetch;
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

    const auth = await requireAuth(request, env);
    if (auth.errorResponse) {
      return auth.errorResponse;
    }
    const buyer = auth.user!;

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

    const resalePolicy = await checkAppResalePolicy(env, appId);
    if (resalePolicy.status === 'unavailable') {
      return Response.json({ success: false, error: resalePolicy.error }, { status: 503 });
    }
    if (resalePolicy.status === 'blocked') {
      return Response.json({
        success: false,
        error: 'This app is no longer available for sale because an upstream author disabled fork resale.'
      }, { status: 403 });
    }

    const existingOrder: any = await env.DB.prepare(`
      SELECT co.id, co.idempotency_key, co.buyer_user_id, co.app_id, co.repository_id, co.seller_user_id,
             co.app_version, co.price_version, co.gross_cents, co.currency, co.lineage_policy,
             co.lineage_snapshot_json, co.stripe_payment_intent_id, co.status, co.failure_code,
             a.name AS app_name
      FROM commerce_orders co
      JOIN app_listings a ON a.id = co.app_id
      WHERE co.buyer_user_id = ? AND co.idempotency_key = ?
    `).bind(buyer.id, trimmedIdempotencyKey).first();

    if (existingOrder) {
      if (existingOrder.app_id !== appId) {
        return Response.json(
          { success: false, error: 'Idempotency key was previously used for a different app purchase' },
          { status: 409 }
        );
      }

      if (existingOrder.stripe_payment_intent_id && existingOrder.status !== 'payment_failed') {
        const stripeSecretKey = env?.STRIPE_SECRET_KEY;
        const publishableKey = env?.STRIPE_PUBLISHABLE_KEY;
        if (!stripeSecretKey || typeof stripeSecretKey !== 'string' || !stripeSecretKey.trim()) {
          return Response.json(
            { success: false, error: 'Stripe secret key is not configured on the server; cannot resume this order' },
            { status: 500 }
          );
        }
        if (!publishableKey) {
          return Response.json(
            { success: false, error: 'Stripe publishable key is not configured' },
            { status: 500 }
          );
        }

        const retrieval = await retrievePaymentIntent({
          fetchImpl,
          paymentIntentId: existingOrder.stripe_payment_intent_id,
          stripeSecretKey
        });
        if (!retrieval.ok) {
          return Response.json(
            { success: false, error: retrieval.error },
            { status: retrieval.status, headers: retrieval.retryAfter ? { 'Retry-After': retrieval.retryAfter } : undefined }
          );
        }

        return Response.json({
          success: true,
          orderId: existingOrder.id,
          paymentIntentId: existingOrder.stripe_payment_intent_id,
          clientSecret: retrieval.clientSecret,
          amountCents: existingOrder.gross_cents,
          currency: existingOrder.currency,
          publishableKey,
          lineageSnapshot: JSON.parse(existingOrder.lineage_snapshot_json),
          status: existingOrder.status,
          resumed: true
        });
      }

      if (existingOrder.status === 'payment_failed') {
        return Response.json(
          { success: false, error: `Previous attempt with this idempotency key failed: ${existingOrder.failure_code || 'payment_failed'}` },
          { status: 409 }
        );
      }

      if (existingOrder.status === 'creating') {
        const stripeSecretKey = env?.STRIPE_SECRET_KEY;
        const stripePublishableKey = env?.STRIPE_PUBLISHABLE_KEY;

        if (!stripeSecretKey || typeof stripeSecretKey !== 'string' || !stripeSecretKey.trim()) {
          return Response.json(
            { success: false, error: 'Stripe secret key is not configured on the server; cannot verify or recover this order' },
            { status: 500 }
          );
        }
        if (!stripePublishableKey || typeof stripePublishableKey !== 'string' || !stripePublishableKey.trim()) {
          return Response.json(
            { success: false, error: 'Stripe publishable key is not configured on the server; cannot recover this order' },
            { status: 500 }
          );
        }

        const lineageSnapshot = JSON.parse(existingOrder.lineage_snapshot_json);
        const recovery = await recoverOrCreatePaymentIntent({
          fetchImpl,
          request: {
            orderId: existingOrder.id,
            grossCents: existingOrder.gross_cents,
            currency: existingOrder.currency,
            appId: existingOrder.app_id,
            appName: existingOrder.app_name,
            buyerUserId: existingOrder.buyer_user_id,
            sellerUserId: existingOrder.seller_user_id,
            priceVersion: existingOrder.price_version,
            lineagePolicy: existingOrder.lineage_policy,
            sellerCents: lineageSnapshot.sellerCents,
            ancestorTotalCents: lineageSnapshot.ancestorTotalCents,
            platformCents: lineageSnapshot.platformCents
          },
          stripeSecretKey
        });

        if (!recovery.ok) {
          if (recovery.definitive) {
            await markDefinitivePaymentFailure(
              env.DB,
              existingOrder.id,
              recovery.failureCode,
              recovery.error,
              recovery.stripeStatus
            );
          }
          return Response.json(
            { success: false, error: recovery.error },
            { status: recovery.status, headers: recovery.retryAfter ? { 'Retry-After': recovery.retryAfter } : undefined }
          );
        }

        try {
          await env.DB.batch([
            env.DB.prepare(`
              UPDATE commerce_orders
              SET stripe_payment_intent_id = ?, status = 'requires_payment', updated_at = datetime('now')
              WHERE id = ? AND status = 'creating'
            `).bind(recovery.paymentIntentId, existingOrder.id),
            env.DB.prepare(`
              INSERT INTO commerce_order_events (id, order_id, event_type, source, source_event_id, details_json, created_at)
              VALUES (?, ?, 'intent_recovered', 'checkout', ?, ?, datetime('now'))
            `).bind(
              `coe_${crypto.randomUUID().replace(/-/g, '')}`,
              existingOrder.id,
              recovery.paymentIntentId,
              JSON.stringify({ paymentIntentId: recovery.paymentIntentId, recovered: true })
            )
          ]);
        } catch (dbErr: any) {
          console.error('[COMMERCE ORDER RECOVERY PERSISTENCE ERROR]', dbErr);
          return Response.json(
            { success: false, error: `Verified PaymentIntent at Stripe but failed to persist recovery: ${dbErr?.message || 'database error'}` },
            { status: 500, headers: { 'Retry-After': '2' } }
          );
        }

        return Response.json({
          success: true,
          orderId: existingOrder.id,
          paymentIntentId: recovery.paymentIntentId,
          clientSecret: recovery.clientSecret,
          amountCents: existingOrder.gross_cents,
          currency: existingOrder.currency,
          publishableKey: stripePublishableKey,
          lineageSnapshot,
          status: 'requires_payment',
          recovered: true
        });
      }

      return Response.json(
        { success: false, error: 'An order with this idempotency key is already being created; retry shortly' },
        { status: 409, headers: { 'Retry-After': '2' } }
      );
    }

    const product: any = await env.DB.prepare(`
      SELECT cp.app_id AS appId, cp.repository_id AS repositoryId, cp.seller_user_id AS sellerUserId,
             cp.price_cents AS priceCents, cp.currency, cp.price_version AS priceVersion, cp.status,
             cp.release_id AS releaseId, cr.app_id AS releaseAppId,
             cr.repository_id AS releaseRepositoryId, cr.seller_user_id AS releaseSellerUserId,
             cr.version AS releaseVersion, cr.commit_oid AS releaseCommitOid
      FROM commerce_products cp
      LEFT JOIN commerce_releases cr ON cr.id = cp.release_id
      WHERE cp.app_id = ?
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

    if (!product.releaseId || product.releaseAppId !== appId ||
        product.releaseRepositoryId !== product.repositoryId ||
        product.releaseSellerUserId !== product.sellerUserId ||
        !product.releaseCommitOid) {
      return Response.json(
        { success: false, error: 'Product does not have a verified immutable release bound for purchase' },
        { status: 409 }
      );
    }

    const appListing: any = await env.DB.prepare(`
      SELECT id, name, version, creator_id AS creatorId
      FROM app_listings
      WHERE id = ?
    `).bind(appId).first();

    if (!appListing) {
      return Response.json({ success: false, error: `App listing not found for app: ${appId}` }, { status: 404 });
    }

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

    const liens = repositoryId ? await fetchFrozenLiens(env.DB, repositoryId) : [];

    let calculation;
    try {
      calculation = calculateAllocations({
        grossCents: product.priceCents,
        currency: product.currency,
        sellerUserId: product.sellerUserId,
        sellerRepositoryId: repositoryId,
        liens
      });
    } catch (allocErr: any) {
      if (allocErr instanceof CommerceValidationError) {
        console.error('[COMMERCE LIEN ALLOCATION INVALID]', allocErr);
        const failedOrderId = `ord_${crypto.randomUUID().replace(/-/g, '')}`;
        await env.DB.prepare(`
          INSERT INTO commerce_orders (
            id, idempotency_key, buyer_user_id, app_id, repository_id,
            seller_user_id, release_id, app_version, price_version, gross_cents,
            currency, lineage_policy, lineage_snapshot_json, status, failure_code,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'payment_failed', 'lien_allocation_invalid', datetime('now'), datetime('now'))
        `).bind(
          failedOrderId,
          trimmedIdempotencyKey,
          buyer.id,
          appId,
          repositoryId,
          product.sellerUserId,
          product.releaseId,
          product.releaseVersion,
          product.priceVersion,
          product.priceCents,
          product.currency,
          'additive_frozen_liens_house_first',
          JSON.stringify({ error: allocErr.message })
        ).run();

        return Response.json(
          { success: false, error: `Lien allocation is invalid: ${allocErr.message}` },
          { status: 500 }
        );
      }
      throw allocErr;
    }

    const orderId = `ord_${crypto.randomUUID().replace(/-/g, '')}`;
    const statements: any[] = [];

    statements.push(
      env.DB.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, repository_id,
          seller_user_id, release_id, app_version, price_version, gross_cents,
          currency, lineage_policy, lineage_snapshot_json, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', datetime('now'), datetime('now'))
      `).bind(
        orderId,
        trimmedIdempotencyKey,
        buyer.id,
        appId,
        repositoryId,
        product.sellerUserId,
        product.releaseId,
        product.releaseVersion,
        product.priceVersion,
        calculation.grossCents,
        calculation.currency,
        'additive_frozen_liens_house_first',
        calculation.snapshotJson
      )
    );

    for (const alloc of calculation.allocations) {
      if (alloc.amountCents <= 0) continue;
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
          ancestorCount: liens.length
        })
      )
    );

    try {
      await env.DB.batch(statements);
    } catch (dbErr: any) {
      console.error('[COMMERCE ORDER PERSISTENCE ERROR]', dbErr);
      return Response.json(
        { success: false, error: `Failed to persist commerce order: ${dbErr?.message || 'database error'}` },
        { status: 500 }
      );
    }

    const stripeSecretKey = env?.STRIPE_SECRET_KEY;
    const stripePublishableKey = env?.STRIPE_PUBLISHABLE_KEY;

    if (!stripeSecretKey || typeof stripeSecretKey !== 'string' || !stripeSecretKey.trim()) {
      return Response.json(
        { success: false, error: 'Stripe secret key is not configured on the server' },
        { status: 500 }
      );
    }

    if (!stripePublishableKey || typeof stripePublishableKey !== 'string' || !stripePublishableKey.trim()) {
      return Response.json(
        { success: false, error: 'Stripe publishable key is not configured on the server' },
        { status: 500 }
      );
    }

    const stripeResult = await recoverOrCreatePaymentIntent({
      fetchImpl,
      request: {
        orderId,
        grossCents: calculation.grossCents,
        currency: calculation.currency,
        appId,
        appName: appListing.name || appId,
        buyerUserId: buyer.id,
        sellerUserId: product.sellerUserId,
        priceVersion: product.priceVersion,
        lineagePolicy: 'additive_frozen_liens_house_first',
        sellerCents: calculation.sellerCents,
        ancestorTotalCents: calculation.ancestorTotalCents,
        platformCents: calculation.platformCents
      },
      stripeSecretKey
    });

    if (!stripeResult.ok) {
      if (stripeResult.definitive) {
        await markDefinitivePaymentFailure(
          env.DB,
          orderId,
          stripeResult.failureCode,
          stripeResult.error,
          stripeResult.stripeStatus
        );
      }
      return Response.json(
        { success: false, error: stripeResult.error },
        { status: stripeResult.status, headers: stripeResult.retryAfter ? { 'Retry-After': stripeResult.retryAfter } : undefined }
      );
    }

    const paymentIntentId = stripeResult.paymentIntentId;
    const clientSecret = stripeResult.clientSecret;

    try {
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
    } catch (dbErr: any) {
      console.error('[COMMERCE ORDER ATTACH PI PERSISTENCE ERROR]', dbErr);
      return Response.json(
        {
          success: false,
          error: `PaymentIntent was created at Stripe but failed to persist to the order: ${dbErr?.message || 'database error'}. Retry with the same Idempotency-Key to recover it.`
        },
        { status: 500, headers: { 'Retry-After': '2' } }
      );
    }

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
