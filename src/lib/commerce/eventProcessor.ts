import {
  claimInboxEvent,
  markInboxTerminalFailure,
  releaseInboxClaim
} from './stripeInbox';
import {
  encryptLicenseSecret,
  generateLicenseKey,
  getLicenseKeyLast4,
  hashLicenseKey
} from './licenseCrypto';
import { ProcessEventResult } from './types';
import { isRefundEventType, processRefundInboxEvent } from './refundProcessor';
import { isAccountEventType, processAccountInboxEvent } from './accountProcessor';
import { isDisputeEventType, processDisputeInboxEvent } from './disputeProcessor';

export interface ProcessorOptions {
  claimToken?: string;
  leaseDurationSeconds?: number;
  stripeFetchOverride?: typeof fetch;
}

export async function processStripeInboxEvent(
  db: any,
  env: any,
  eventId: string,
  options?: ProcessorOptions
): Promise<ProcessEventResult> {
  if (!db) {
    return { success: false, error: 'Database service is unavailable' };
  }

  let claimToken = options?.claimToken;
  if (!claimToken) {
    const claimRes = await claimInboxEvent(db, eventId, {
      leaseDurationSeconds: options?.leaseDurationSeconds ?? 60
    });
    if (!claimRes.claimed) {
      const existingRow: any = await db.prepare(`
        SELECT status, last_error FROM stripe_event_inbox WHERE event_id = ?
      `).bind(eventId).first();

      if (existingRow?.status === 'processed') {
        return {
          success: true,
          duplicate: true,
          status: 'processed'
        };
      }

      if (existingRow?.status === 'terminal_failure') {
        return {
          success: false,
          terminal: true,
          error: existingRow.last_error || 'Event previously marked terminal_failure'
        };
      }

      return {
        success: false,
        skipped: true,
        reason: `Event '${eventId}' is not available for claiming (active lease held by another worker)`
      };
    }
    claimToken = claimRes.claimToken;
  }

  const inboxRow: any = await db.prepare(`
    SELECT event_id, event_type, api_version, livemode,
           payload_json, payload_sha256, status, attempt_count,
           claim_token
    FROM stripe_event_inbox
    WHERE event_id = ?
  `).bind(eventId).first();

  if (!inboxRow) {
    return { success: false, error: `Inbox event '${eventId}' not found` };
  }

  let event: any;
  try {
    event = JSON.parse(inboxRow.payload_json);
  } catch (parseErr: any) {
    await markInboxTerminalFailure(db, eventId, claimToken, `Malformed JSON payload in inbox: ${parseErr.message}`);
    return { success: false, terminal: true, error: `Malformed JSON payload: ${parseErr.message}` };
  }

  const eventType = inboxRow.event_type || event?.type;

  if (isRefundEventType(eventType)) {
    return processRefundInboxEvent(
      db,
      env,
      inboxRow,
      event,
      claimToken,
      options?.stripeFetchOverride || globalThis.fetch
    );
  }

  if (isAccountEventType(eventType)) {
    return processAccountInboxEvent(
      db,
      env,
      inboxRow,
      event,
      claimToken,
      options?.stripeFetchOverride || globalThis.fetch
    );
  }

  if (isDisputeEventType(eventType)) {
    return processDisputeInboxEvent(
      db,
      env,
      inboxRow,
      event,
      claimToken,
      options?.stripeFetchOverride || globalThis.fetch
    );
  }

  if (eventType !== 'payment_intent.succeeded') {
    const unsupportedMsg = `Explicitly unsupported event type: '${eventType}'. Refund, dispute, and full lifecycle handling must be commissioned before payments can be enabled.`;
    await markInboxTerminalFailure(db, eventId, claimToken, unsupportedMsg);

    const possibleOrderId = event?.data?.object?.metadata?.orderId;
    if (possibleOrderId && typeof possibleOrderId === 'string') {
      try {
        await db.prepare(`
          INSERT INTO commerce_order_events (id, order_id, event_type, source, source_event_id, details_json, created_at)
          VALUES (?, ?, 'unsupported_event_received', 'stripe_webhook', ?, ?, datetime('now'))
        `).bind(
          `coe_${crypto.randomUUID().replace(/-/g, '')}`,
          possibleOrderId,
          eventId,
          JSON.stringify({ eventType, error: unsupportedMsg })
        ).run();
      } catch {}
    }

    return { success: false, terminal: true, error: unsupportedMsg };
  }

  const paymentIntentId = event?.data?.object?.id || inboxRow.stripe_object_id;
  if (!paymentIntentId || typeof paymentIntentId !== 'string' || !paymentIntentId.trim()) {
    const err = 'Missing PaymentIntent ID in event payload';
    await markInboxTerminalFailure(db, eventId, claimToken, err);
    return { success: false, terminal: true, error: err };
  }

  const stripeSecretKey = env?.STRIPE_SECRET_KEY;
  if (!stripeSecretKey || typeof stripeSecretKey !== 'string' || !stripeSecretKey.trim()) {
    const err = 'STRIPE_SECRET_KEY is not configured on the server';
    await releaseInboxClaim(db, eventId, claimToken, err, 30);
    return { success: false, retryable: true, error: err };
  }

  const fetchImpl = options?.stripeFetchOverride || globalThis.fetch;
  let stripePi: any;

  try {
    const stripeRes = await fetchImpl(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId.trim())}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`
      }
    });

    if (!stripeRes.ok) {
      const errData: any = await stripeRes.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `Stripe returned status ${stripeRes.status}`;

      if (stripeRes.status === 404 || stripeRes.status === 401 || stripeRes.status === 403) {
        await markInboxTerminalFailure(db, eventId, claimToken, `Authoritative Stripe PaymentIntent fetch failed (${stripeRes.status}): ${errMsg}`);
        return { success: false, terminal: true, error: errMsg };
      } else {
        await releaseInboxClaim(db, eventId, claimToken, `Stripe API error (${stripeRes.status}): ${errMsg}`, 60);
        return { success: false, retryable: true, error: errMsg };
      }
    }

    stripePi = await stripeRes.json();
  } catch (networkErr: any) {
    const msg = `Network error re-fetching authoritative PaymentIntent: ${networkErr.message}`;
    await releaseInboxClaim(db, eventId, claimToken, msg, 30);
    return { success: false, retryable: true, error: msg };
  }

  if (stripePi.status !== 'succeeded') {
    const msg = `Authoritative Stripe PaymentIntent status is '${stripePi.status}', expected 'succeeded'`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  if (stripePi.id !== paymentIntentId) {
    const msg = `Authoritative Stripe PaymentIntent ID mismatch: got '${stripePi.id}', expected '${paymentIntentId}'`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  const orderId = stripePi.metadata?.orderId;
  if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
    const msg = 'Authoritative Stripe PaymentIntent metadata does not contain orderId';
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  const order: any = await db.prepare(`
    SELECT id, idempotency_key, buyer_user_id, app_id, repository_id,
           seller_user_id, app_version, price_version, gross_cents,
           currency, lineage_policy, lineage_snapshot_json,
           stripe_payment_intent_id, status, state_version,
           failure_code, paid_at, fulfilled_at
    FROM commerce_orders
    WHERE id = ?
  `).bind(orderId.trim()).first();

  if (!order) {
    const msg = `Commerce order '${orderId}' referenced by Stripe PaymentIntent does not exist in D1`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  if (!order.stripe_payment_intent_id || order.stripe_payment_intent_id !== paymentIntentId) {
    const msg = `Order PaymentIntent ID mismatch: order has '${order.stripe_payment_intent_id}', Stripe returned '${paymentIntentId}'`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  const stripeAmount = parseInt(String(stripePi.amount), 10);
  if (stripeAmount !== order.gross_cents) {
    const msg = `Gross amount mismatch: Stripe amount (${stripeAmount}) !== order gross_cents (${order.gross_cents})`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  const stripeAmountReceived = Number(stripePi.amount_received);
  if (!Number.isSafeInteger(stripeAmountReceived) || stripeAmountReceived !== order.gross_cents) {
    const msg = `Received amount mismatch: Stripe amount_received (${stripePi.amount_received}) !== order gross_cents (${order.gross_cents})`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  const stripeCurrency = String(stripePi.currency || '').toLowerCase();
  const orderCurrency = String(order.currency || '').toLowerCase();
  if (stripeCurrency !== orderCurrency) {
    const msg = `Currency mismatch: Stripe currency (${stripeCurrency}) !== order currency (${orderCurrency})`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  const eventLivemode = Boolean(inboxRow.livemode);
  const stripeLivemode = Boolean(stripePi.livemode);
  if (eventLivemode !== stripeLivemode) {
    const msg = `Livemode mismatch: event livemode (${eventLivemode}) !== Stripe livemode (${stripeLivemode})`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  if (env?.STRIPE_LIVEMODE !== 'true' && env?.STRIPE_LIVEMODE !== 'false') {
    const msg = 'STRIPE_LIVEMODE must be explicitly configured as true or false';
    await releaseInboxClaim(db, eventId, claimToken, msg, 30);
    return { success: false, retryable: true, error: msg };
  }
  const configuredLivemode = env.STRIPE_LIVEMODE === 'true';
  if (stripeLivemode !== configuredLivemode) {
    const msg = `Stripe livemode (${stripeLivemode}) does not match configured environment (${configuredLivemode})`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  if (stripePi.metadata?.appId && stripePi.metadata.appId !== order.app_id) {
    const msg = `App ID mismatch in metadata: Stripe appId (${stripePi.metadata.appId}) !== order app_id (${order.app_id})`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  if (stripePi.metadata?.buyerUserId && stripePi.metadata.buyerUserId !== order.buyer_user_id) {
    const msg = `Buyer user ID mismatch in metadata: Stripe buyer (${stripePi.metadata.buyerUserId}) !== order buyer (${order.buyer_user_id})`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  if (order.status === 'fulfilled') {
    await db.prepare(`
      UPDATE stripe_event_inbox
      SET status = 'processed',
          processed_at = datetime('now'),
          last_error = NULL,
          claim_token = NULL,
          expires_at = NULL
      WHERE event_id = ?
    `).bind(eventId).run();

    return {
      success: true,
      duplicate: true,
      orderId: order.id,
      status: 'fulfilled'
    };
  }

  if (order.status !== 'requires_payment' && order.status !== 'processing') {
    const msg = `Cannot fulfill order in non-payable state '${order.status}'`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  const allocRows = await db.prepare(`
    SELECT id, sequence, role, recipient_user_id AS recipientUserId,
           source_repository_id AS sourceRepositoryId, lineage_depth AS lineageDepth,
           basis_points AS basisPoints, amount_cents AS amountCents
    FROM commerce_order_allocations
    WHERE order_id = ?
    ORDER BY sequence ASC
  `).bind(order.id).all();

  const allocations: any[] = allocRows?.results || [];
  if (allocations.length === 0) {
    const msg = `No immutable allocations found in D1 for order '${order.id}'`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  const sumAllocCents = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  if (sumAllocCents !== order.gross_cents) {
    const msg = `Allocation conservation check failed: sum(${sumAllocCents}) !== gross_cents(${order.gross_cents})`;
    await markInboxTerminalFailure(db, eventId, claimToken, msg);
    return { success: false, terminal: true, error: msg };
  }

  const licenseKey = generateLicenseKey(order.app_id);
  const licenseKeyHash = await hashLicenseKey(licenseKey);
  const licenseKeyLast4 = getLicenseKeyLast4(licenseKey);
  const licenseId = `lic_${crypto.randomUUID().replace(/-/g, '')}`;

  let encryptedSecret;
  try {
    encryptedSecret = await encryptLicenseSecret(licenseKey, env);
  } catch (cryptoErr: any) {
    const msg = `License encryption failed: ${cryptoErr.message}`;
    await releaseInboxClaim(db, eventId, claimToken, msg, 30);
    return { success: false, retryable: true, error: msg };
  }

  const statements: any[] = [];

  statements.push(
    db.prepare(`
      UPDATE commerce_orders
      SET status = 'fulfilled',
          paid_at = COALESCE(paid_at, datetime('now')),
          fulfilled_at = datetime('now'),
          state_version = state_version + 1,
          updated_at = datetime('now')
      WHERE id = ? AND status IN ('requires_payment', 'processing') AND state_version = ?
    `).bind(order.id, order.state_version)
  );

  statements.push(
    db.prepare(`
      INSERT INTO commerce_licenses (
        id, order_id, app_id, owner_user_id,
        license_key_hash, license_key_last4,
        status, issued_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    `).bind(
      licenseId,
      order.id,
      order.app_id,
      order.buyer_user_id,
      licenseKeyHash,
      licenseKeyLast4
    )
  );

  statements.push(
    db.prepare(`
      INSERT INTO commerce_license_secrets (
        license_id, ciphertext_base64, iv_base64,
        algorithm, key_version, created_at
      ) VALUES (?, ?, ?, 'AES-256-GCM', ?, datetime('now'))
    `).bind(
      licenseId,
      encryptedSecret.ciphertextBase64,
      encryptedSecret.ivBase64,
      encryptedSecret.keyVersion
    )
  );

  statements.push(
    db.prepare(`
      INSERT INTO commerce_license_secret_events (
        id, license_id, event_type, from_key_version, to_key_version, created_at
      ) VALUES (?, ?, 'created', NULL, ?, datetime('now'))
    `).bind(
      `clse_${crypto.randomUUID().replace(/-/g, '')}`,
      licenseId,
      encryptedSecret.keyVersion
    )
  );

  let outboxRowCount = 0;
  for (const alloc of allocations) {
    if ((alloc.role === 'seller' || alloc.role === 'ancestor') && alloc.amountCents > 0 && alloc.recipientUserId) {
      const outboxId = `cto_${crypto.randomUUID().replace(/-/g, '')}`;
      statements.push(
        db.prepare(`
          INSERT INTO commerce_transfer_outbox (
            id, order_id, allocation_id, destination_user_id,
            amount_cents, currency, status, attempt_count,
            available_at, next_attempt_at, stripe_idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, datetime('now'), datetime('now'), ?, datetime('now'))
        `).bind(
          outboxId,
          order.id,
          alloc.id,
          alloc.recipientUserId,
          alloc.amountCents,
          order.currency,
          `transfer:${outboxId}`
        )
      );
      outboxRowCount++;
    }
  }

  statements.push(
    db.prepare(`
      INSERT INTO commerce_order_events (
        id, order_id, event_type, source, source_event_id, details_json, created_at
      ) VALUES (?, ?, 'order_fulfilled', 'stripe_webhook', ?, ?, datetime('now'))
    `).bind(
      `coe_${crypto.randomUUID().replace(/-/g, '')}`,
      order.id,
      eventId,
      JSON.stringify({
        stripePaymentIntentId: paymentIntentId,
        licenseId,
        licenseKeyLast4,
        outboxRowsCreated: outboxRowCount
      })
    )
  );

  statements.push(
    db.prepare(`
      UPDATE stripe_event_inbox
      SET status = 'processed',
          processed_at = datetime('now'),
          last_error = NULL,
          claim_token = NULL,
          expires_at = NULL
      WHERE event_id = ? AND claim_token = ?
    `).bind(eventId, claimToken)
  );

  try {
    await db.batch(statements);
  } catch (batchErr: any) {
    const freshOrder: any = await db.prepare(`
      SELECT status FROM commerce_orders WHERE id = ?
    `).bind(order.id).first();

    if (freshOrder?.status === 'fulfilled') {
      await db.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'processed',
            processed_at = datetime('now'),
            last_error = NULL,
            claim_token = NULL,
            expires_at = NULL
        WHERE event_id = ?
      `).bind(eventId).run();

      return {
        success: true,
        fulfilledByPeer: true,
        orderId: order.id,
        status: 'fulfilled'
      };
    }

    const failureMsg = `Atomic fulfillment batch failed: ${batchErr.message}`;
    await releaseInboxClaim(db, eventId, claimToken, failureMsg, 30);
    return {
      success: false,
      retryable: true,
      error: failureMsg
    };
  }

  return {
    success: true,
    orderId: order.id,
    licenseId,
    licenseKeyLast4,
    outboxCount: outboxRowCount,
    status: 'fulfilled'
  };
}
