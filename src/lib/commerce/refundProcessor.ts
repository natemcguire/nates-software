import { calculateRefundAllocationDelta, FrozenAllocation } from './recoveryDomain';
import { hashPayload, markInboxTerminalFailure, releaseInboxClaim } from './stripeInbox';
import { ProcessEventResult } from './types';

const REFUND_EVENT_TYPES = new Set(['refund.created', 'refund.updated', 'charge.refund.updated']);
const REFUND_STATUSES = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);

export function isRefundEventType(eventType: string): boolean {
  return REFUND_EVENT_TYPES.has(eventType);
}

async function failTerminal(db: any, eventId: string, claimToken: string, message: string): Promise<ProcessEventResult> {
  await markInboxTerminalFailure(db, eventId, claimToken, message);
  return { success: false, terminal: true, error: message };
}

async function fetchAuthoritativeRefund(env: any, refundId: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`https://api.stripe.com/v1/refunds/${encodeURIComponent(refundId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
}

async function fetchAuthoritativePaymentIntent(env: any, paymentIntentId: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
}

export async function processRefundInboxEvent(
  db: any,
  env: any,
  inboxRow: any,
  event: any,
  claimToken: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ProcessEventResult> {
  const eventId = inboxRow.event_id;
  const refundId = event?.data?.object?.id || inboxRow.stripe_object_id;
  if (typeof refundId !== 'string' || !refundId.startsWith('re_')) {
    return failTerminal(db, eventId, claimToken, 'Refund event does not reference a Stripe Refund ID');
  }
  if (!env?.STRIPE_SECRET_KEY) {
    await releaseInboxClaim(db, eventId, claimToken, 'STRIPE_SECRET_KEY is not configured on the server', 30);
    return { success: false, retryable: true, error: 'STRIPE_SECRET_KEY is not configured on the server' };
  }
  if (env?.STRIPE_LIVEMODE !== 'true' && env?.STRIPE_LIVEMODE !== 'false') {
    await releaseInboxClaim(db, eventId, claimToken, 'STRIPE_LIVEMODE must be explicitly configured', 30);
    return { success: false, retryable: true, error: 'STRIPE_LIVEMODE must be explicitly configured' };
  }

  let response: Response;
  try {
    response = await fetchAuthoritativeRefund(env, refundId, fetchImpl);
  } catch (error: any) {
    const message = `Network error re-fetching authoritative Refund: ${error.message}`;
    await releaseInboxClaim(db, eventId, claimToken, message, 30);
    return { success: false, retryable: true, error: message };
  }
  if (!response.ok) {
    const payload: any = await response.json().catch(() => ({}));
    const message = `Authoritative Stripe Refund fetch failed (${response.status}): ${payload?.error?.message || 'unknown error'}`;
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return failTerminal(db, eventId, claimToken, message);
    }
    await releaseInboxClaim(db, eventId, claimToken, message, 60);
    return { success: false, retryable: true, error: message };
  }

  const refund: any = await response.json();
  const status = String(refund.status || '');
  const normalizedStatus = status === 'canceled' ? 'cancelled' : status;
  const paymentIntentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
  const amountCents = Number(refund.amount);
  const currency = String(refund.currency || '').toLowerCase();
  if (refund.id !== refundId || refund.object !== 'refund' || !REFUND_STATUSES.has(status)) {
    return failTerminal(db, eventId, claimToken, 'Authoritative Stripe Refund identity, object type, or status is invalid');
  }
  if (!paymentIntentId || !chargeId || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return failTerminal(db, eventId, claimToken, 'Authoritative Stripe Refund is missing valid payment, charge, or amount fields');
  }
  let paymentIntentResponse: Response;
  try {
    paymentIntentResponse = await fetchAuthoritativePaymentIntent(env, paymentIntentId, fetchImpl);
  } catch (error: any) {
    const message = `Network error re-fetching refund PaymentIntent: ${error.message}`;
    await releaseInboxClaim(db, eventId, claimToken, message, 30);
    return { success: false, retryable: true, error: message };
  }
  if (!paymentIntentResponse.ok) {
    const message = `Authoritative refund PaymentIntent fetch failed (${paymentIntentResponse.status})`;
    if ([401, 403, 404].includes(paymentIntentResponse.status)) return failTerminal(db, eventId, claimToken, message);
    await releaseInboxClaim(db, eventId, claimToken, message, 60);
    return { success: false, retryable: true, error: message };
  }
  const paymentIntent: any = await paymentIntentResponse.json();
  const latestChargeId = typeof paymentIntent.latest_charge === 'string'
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge?.id;
  const configuredLivemode = env.STRIPE_LIVEMODE === 'true';
  if (paymentIntent.id !== paymentIntentId || paymentIntent.object !== 'payment_intent'
      || Boolean(paymentIntent.livemode) !== Boolean(inboxRow.livemode)
      || Boolean(paymentIntent.livemode) !== configuredLivemode
      || Number(paymentIntent.amount) < amountCents
      || String(paymentIntent.currency || '').toLowerCase() !== currency
      || latestChargeId !== chargeId) {
    return failTerminal(db, eventId, claimToken, 'Refund does not match its authoritative PaymentIntent or configured environment');
  }

  const order: any = await db.prepare(`
    SELECT id, gross_cents, refunded_cents, currency, status, state_version
    FROM commerce_orders WHERE stripe_payment_intent_id = ?
  `).bind(paymentIntentId).first();
  if (!order) return failTerminal(db, eventId, claimToken, `No commerce order matches PaymentIntent '${paymentIntentId}'`);
  if (currency !== order.currency || amountCents > order.gross_cents) {
    return failTerminal(db, eventId, claimToken, 'Refund economics do not match the immutable commerce order');
  }

  const canonicalId = `crf_${refundId}`;
  const authoritativeJson = JSON.stringify(refund);
  const authoritativeSha = await hashPayload(authoritativeJson);
  const existing: any = await db.prepare(`
    SELECT id, order_id, stripe_charge_id, amount_cents, currency, status, finalized_at
    FROM commerce_refunds WHERE stripe_refund_id = ?
  `).bind(refundId).first();
  if (existing && (existing.order_id !== order.id || existing.stripe_charge_id !== chargeId
      || existing.amount_cents !== amountCents || existing.currency !== currency)) {
    return failTerminal(db, eventId, claimToken, 'Stripe Refund economics conflict with its existing canonical record');
  }
  if (existing?.finalized_at) {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO commerce_refund_observations
        (event_id, refund_id, observed_status, authoritative_sha256) VALUES (?, ?, ?, ?)`)
        .bind(eventId, existing.id, normalizedStatus, authoritativeSha),
      db.prepare(`UPDATE stripe_event_inbox SET status='processed', processed_at=datetime('now'), last_error=NULL,
        claim_token=NULL, expires_at=NULL WHERE event_id=? AND claim_token=?`).bind(eventId, claimToken)
    ]);
    return { success: true, duplicate: true, orderId: order.id, status: order.status };
  }

  const baseStatements: any[] = [db.prepare(`
    INSERT INTO commerce_refunds
      (id, stripe_refund_id, order_id, stripe_charge_id, amount_cents, currency, status,
       reason, failure_reason, authoritative_json, first_event_id, last_event_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(stripe_refund_id) DO UPDATE SET
      status=excluded.status, reason=excluded.reason, failure_reason=excluded.failure_reason,
      authoritative_json=excluded.authoritative_json, last_event_id=excluded.last_event_id, updated_at=datetime('now')
  `).bind(canonicalId, refundId, order.id, chargeId, amountCents, currency, normalizedStatus,
    refund.reason ?? null, refund.failure_reason ?? null, authoritativeJson, eventId, eventId)];

  if (status !== 'succeeded') {
    baseStatements.push(
      db.prepare(`INSERT INTO commerce_refund_observations
        (event_id, refund_id, observed_status, authoritative_sha256) VALUES (?, ?, ?, ?)`)
        .bind(eventId, canonicalId, normalizedStatus, authoritativeSha),
      db.prepare(`UPDATE stripe_event_inbox SET status='processed', processed_at=datetime('now'), last_error=NULL,
        claim_token=NULL, expires_at=NULL WHERE event_id=? AND claim_token=?`).bind(eventId, claimToken)
    );
    await db.batch(baseStatements);
    return { success: true, orderId: order.id, status: normalizedStatus };
  }

  if (!['fulfilled', 'disputed'].includes(order.status) || order.refunded_cents + amountCents > order.gross_cents) {
    return failTerminal(db, eventId, claimToken, `Succeeded refund cannot advance order from state '${order.status}'`);
  }
  const allocationResult = await db.prepare(`
    SELECT id, sequence, role, amount_cents AS amountCents
    FROM commerce_order_allocations WHERE order_id=? ORDER BY sequence
  `).bind(order.id).all();
  const allocations = (allocationResult.results || []) as FrozenAllocation[];
  const priorResult = await db.prepare(`
    SELECT ra.allocation_id, SUM(ra.amount_cents) AS amount
    FROM commerce_refund_allocations ra
    JOIN commerce_refunds r ON r.id=ra.refund_id
    WHERE r.order_id=? AND r.finalized_at IS NOT NULL GROUP BY ra.allocation_id
  `).bind(order.id).all();
  const prior = new Map<string, number>((priorResult.results || []).map((row: any) => [row.allocation_id, Number(row.amount)]));
  let deltas;
  try {
    deltas = calculateRefundAllocationDelta(allocations, order.gross_cents, order.refunded_cents + amountCents, prior);
  } catch (error: any) {
    return failTerminal(db, eventId, claimToken, `Refund allocation failed: ${error.message}`);
  }

  const nextRefunded = order.refunded_cents + amountCents;
  const nextStatus = nextRefunded === order.gross_cents ? 'refunded' : order.status;
  const statements = [...baseStatements,
    db.prepare(`UPDATE commerce_orders SET refunded_cents=?, status=?, state_version=state_version+1,
      updated_at=datetime('now') WHERE id=? AND state_version=? AND refunded_cents=? AND status=?`)
      .bind(nextRefunded, nextStatus, order.id, order.state_version, order.refunded_cents, order.status)
  ];
  for (const delta of deltas) {
    statements.push(db.prepare(`INSERT INTO commerce_refund_allocations
      (id, refund_id, allocation_id, sequence, amount_cents) VALUES (?, ?, ?, ?, ?)`)
      .bind(`cra_${refundId}_${delta.sequence}`, canonicalId, delta.id, delta.sequence, delta.deltaAmountCents));
    if (delta.deltaAmountCents > 0 && delta.role !== 'protocol_pool') {
      statements.push(db.prepare(`INSERT INTO commerce_recovery_obligations
        (id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
         source_event_id, amount_cents, currency, status)
        VALUES (?, ?, 'refund', ?, ?, (SELECT id FROM commerce_transfer_outbox WHERE allocation_id=?),
                ?, ?, ?, 'pending')`)
        .bind(`cro_refund_${refundId}_${delta.sequence}`, order.id, refundId, delta.id, delta.id,
          eventId, delta.deltaAmountCents, currency));
    }
  }
  if (nextStatus === 'refunded') statements.push(db.prepare(`UPDATE commerce_licenses SET status='refunded',
    revoked_at=COALESCE(revoked_at, datetime('now')) WHERE order_id=? AND status IN ('active','revoked')`).bind(order.id));
  statements.push(
    db.prepare(`INSERT INTO commerce_refund_observations
      (event_id, refund_id, observed_status, authoritative_sha256) VALUES (?, ?, 'succeeded', ?)`)
      .bind(eventId, canonicalId, authoritativeSha),
    db.prepare(`INSERT INTO commerce_order_events
      (id, order_id, event_type, source, source_event_id, details_json) VALUES (?, ?, ?, 'stripe_webhook', ?, ?)`)
      .bind(`coe_refund_${eventId}`, order.id, nextStatus === 'refunded' ? 'order_refunded' : 'order_partially_refunded',
        eventId, JSON.stringify({ refundId, amountCents, cumulativeRefundedCents: nextRefunded })),
    db.prepare(`UPDATE commerce_refunds SET finalized_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND finalized_at IS NULL`)
      .bind(canonicalId),
    db.prepare(`UPDATE stripe_event_inbox SET status='processed', processed_at=datetime('now'), last_error=NULL,
      claim_token=NULL, expires_at=NULL WHERE event_id=? AND claim_token=?`).bind(eventId, claimToken)
  );
  try {
    await db.batch(statements);
  } catch (error: any) {
    const message = `Atomic refund reconciliation failed: ${error.message}`;
    await releaseInboxClaim(db, eventId, claimToken, message, 30);
    return { success: false, retryable: true, error: message };
  }
  return { success: true, orderId: order.id, status: nextStatus };
}
