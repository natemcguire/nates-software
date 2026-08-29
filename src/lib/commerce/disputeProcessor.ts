// Authoritative Stripe Dispute Lifecycle Processor & Recovery Obligations Ledger
// Re-fetches Stripe Dispute + PaymentIntent, validates immutability constraints,
// enforces monotonic canonical dispute state, revokes/restores licenses,
// and records exact compensating recovery obligations without double recovery.

import { calculateRefundAllocationDelta, FrozenAllocation } from './recoveryDomain';
import { hashPayload, markInboxTerminalFailure, releaseInboxClaim } from './stripeInbox';
import { ProcessEventResult } from './types';

const DISPUTE_EVENT_TYPES = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
  'dispute.created',
  'dispute.updated',
  'dispute.closed',
  'dispute.funds_withdrawn',
  'dispute.funds_reinstated'
]);

const DISPUTE_STATUSES = new Set([
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost'
]);

export function isDisputeEventType(eventType: string): boolean {
  return DISPUTE_EVENT_TYPES.has(eventType);
}

async function failTerminal(
  db: any,
  eventId: string,
  claimToken: string,
  message: string
): Promise<ProcessEventResult> {
  await markInboxTerminalFailure(db, eventId, claimToken, message);
  return { success: false, terminal: true, error: message };
}

async function fetchAuthoritativeDispute(
  env: any,
  disputeId: string,
  fetchImpl: typeof fetch
): Promise<Response> {
  return fetchImpl(`https://api.stripe.com/v1/disputes/${encodeURIComponent(disputeId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
}

async function fetchAuthoritativePaymentIntent(
  env: any,
  paymentIntentId: string,
  fetchImpl: typeof fetch
): Promise<Response> {
  return fetchImpl(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
}

export async function processDisputeInboxEvent(
  db: any,
  env: any,
  inboxRow: any,
  event: any,
  claimToken: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ProcessEventResult> {
  const eventId = inboxRow.event_id;
  let disputeId = event?.data?.object?.id || inboxRow.stripe_object_id;
  if (typeof disputeId !== 'string' || (!disputeId.startsWith('dp_') && !disputeId.startsWith('du_'))) {
    if (typeof event?.data?.object?.dispute === 'string') {
      disputeId = event.data.object.dispute;
    } else if (typeof event?.data?.object?.dispute?.id === 'string') {
      disputeId = event.data.object.dispute.id;
    }
  }

  if (typeof disputeId !== 'string' || (!disputeId.startsWith('dp_') && !disputeId.startsWith('du_'))) {
    return failTerminal(db, eventId, claimToken, 'Dispute event does not reference a Stripe Dispute ID');
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
    response = await fetchAuthoritativeDispute(env, disputeId, fetchImpl);
  } catch (error: any) {
    const message = `Network error re-fetching authoritative Dispute: ${error.message}`;
    await releaseInboxClaim(db, eventId, claimToken, message, 30);
    return { success: false, retryable: true, error: message };
  }

  if (!response.ok) {
    const payload: any = await response.json().catch(() => ({}));
    const message = `Authoritative Stripe Dispute fetch failed (${response.status}): ${payload?.error?.message || 'unknown error'}`;
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return failTerminal(db, eventId, claimToken, message);
    }
    await releaseInboxClaim(db, eventId, claimToken, message, 60);
    return { success: false, retryable: true, error: message };
  }

  const dispute: any = await response.json();
  const status = String(dispute.status || '');
  const normalizedStatus = status;
  const paymentIntentId = typeof dispute.payment_intent === 'string'
    ? dispute.payment_intent
    : dispute.payment_intent?.id;
  const chargeId = typeof dispute.charge === 'string'
    ? dispute.charge
    : dispute.charge?.id;
  const amountCents = Number(dispute.amount);
  const currency = String(dispute.currency || '').toLowerCase();

  if (dispute.id !== disputeId || dispute.object !== 'dispute' || !DISPUTE_STATUSES.has(normalizedStatus)) {
    return failTerminal(db, eventId, claimToken, 'Authoritative Stripe Dispute identity, object type, or status is invalid');
  }

  if (!chargeId || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return failTerminal(db, eventId, claimToken, 'Authoritative Stripe Dispute is missing valid charge or amount fields');
  }

  const configuredLivemode = env.STRIPE_LIVEMODE === 'true';
  if (Boolean(dispute.livemode) !== Boolean(inboxRow.livemode) || Boolean(dispute.livemode) !== configuredLivemode) {
    return failTerminal(db, eventId, claimToken, 'Dispute livemode does not match configured environment or inbox record');
  }

  if (!paymentIntentId) {
    return failTerminal(db, eventId, claimToken, 'Authoritative Stripe Dispute is missing payment_intent reference');
  }

  let paymentIntentResponse: Response;
  try {
    paymentIntentResponse = await fetchAuthoritativePaymentIntent(env, paymentIntentId, fetchImpl);
  } catch (error: any) {
    const message = `Network error re-fetching dispute PaymentIntent: ${error.message}`;
    await releaseInboxClaim(db, eventId, claimToken, message, 30);
    return { success: false, retryable: true, error: message };
  }

  if (!paymentIntentResponse.ok) {
    const message = `Authoritative dispute PaymentIntent fetch failed (${paymentIntentResponse.status})`;
    if ([401, 403, 404].includes(paymentIntentResponse.status)) {
      return failTerminal(db, eventId, claimToken, message);
    }
    await releaseInboxClaim(db, eventId, claimToken, message, 60);
    return { success: false, retryable: true, error: message };
  }

  const paymentIntent: any = await paymentIntentResponse.json();
  const latestChargeId = typeof paymentIntent.latest_charge === 'string'
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge?.id;

  if (
    paymentIntent.id !== paymentIntentId ||
    paymentIntent.object !== 'payment_intent' ||
    Boolean(paymentIntent.livemode) !== Boolean(inboxRow.livemode) ||
    Boolean(paymentIntent.livemode) !== configuredLivemode ||
    Number(paymentIntent.amount) < amountCents ||
    String(paymentIntent.currency || '').toLowerCase() !== currency ||
    (latestChargeId && latestChargeId !== chargeId)
  ) {
    return failTerminal(db, eventId, claimToken, 'Dispute does not match its authoritative PaymentIntent or configured environment');
  }

  const order: any = await db.prepare(`
    SELECT id, gross_cents, refunded_cents, currency, status, state_version
    FROM commerce_orders
    WHERE stripe_payment_intent_id = ?
  `).bind(paymentIntentId).first();

  if (!order) {
    return failTerminal(db, eventId, claimToken, `No commerce order matches PaymentIntent '${paymentIntentId}'`);
  }

  if (currency !== order.currency || amountCents > order.gross_cents) {
    return failTerminal(db, eventId, claimToken, 'Dispute economics do not match the immutable commerce order');
  }

  if (!['fulfilled', 'disputed', 'refunded'].includes(order.status)) {
    return failTerminal(db, eventId, claimToken, `Dispute cannot advance order from state '${order.status}'`);
  }

  const canonicalId = `cdp_${disputeId}`;
  const authoritativeJson = JSON.stringify(dispute);
  const authoritativeSha = await hashPayload(authoritativeJson);

  const existing: any = await db.prepare(`
    SELECT id, order_id, stripe_charge_id, amount_cents, currency, status, closed_at
    FROM commerce_disputes
    WHERE stripe_dispute_id = ?
  `).bind(disputeId).first();

  if (existing && (
    existing.order_id !== order.id ||
    existing.stripe_charge_id !== chargeId ||
    existing.amount_cents !== amountCents ||
    existing.currency !== currency
  )) {
    return failTerminal(db, eventId, claimToken, 'Stripe Dispute economics conflict with its existing canonical record');
  }

  // Idempotency: duplicate delivery for same observed dispute status
  if (existing && existing.status === normalizedStatus) {
    await db.batch([
      db.prepare(`
        INSERT OR IGNORE INTO commerce_dispute_observations
          (event_id, dispute_id, observed_status, authoritative_sha256, observed_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(eventId, existing.id, normalizedStatus, authoritativeSha),
      db.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'processed', processed_at = datetime('now'), last_error = NULL,
            claim_token = NULL, expires_at = NULL
        WHERE event_id = ? AND claim_token = ?
      `).bind(eventId, claimToken)
    ]);
    return { success: true, duplicate: true, orderId: order.id, status: order.status };
  }

  // Monotonic regression guard:
  // 1. Terminal dispute status (won/lost) cannot regress to open/warning status or flip
  if (existing && (existing.status === 'won' || existing.status === 'lost')) {
    if (normalizedStatus !== existing.status) {
      await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO commerce_dispute_observations
            (event_id, dispute_id, observed_status, authoritative_sha256, observed_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).bind(eventId, existing.id, normalizedStatus, authoritativeSha),
        db.prepare(`
          UPDATE stripe_event_inbox
          SET status = 'processed', processed_at = datetime('now'), last_error = NULL,
              claim_token = NULL, expires_at = NULL
          WHERE event_id = ? AND claim_token = ?
        `).bind(eventId, claimToken)
      ]);
      return {
        success: true,
        skipped: true,
        orderId: order.id,
        status: order.status,
        reason: `Terminal dispute status '${existing.status}' cannot regress to '${normalizedStatus}'`
      };
    }
  }

  // 2. Formal active dispute (needs_response, under_review) cannot regress to inquiry status
  if (existing && (existing.status === 'needs_response' || existing.status === 'under_review')) {
    if (['warning_needs_response', 'warning_under_review', 'warning_closed'].includes(normalizedStatus)) {
      await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO commerce_dispute_observations
            (event_id, dispute_id, observed_status, authoritative_sha256, observed_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).bind(eventId, existing.id, normalizedStatus, authoritativeSha),
        db.prepare(`
          UPDATE stripe_event_inbox
          SET status = 'processed', processed_at = datetime('now'), last_error = NULL,
              claim_token = NULL, expires_at = NULL
          WHERE event_id = ? AND claim_token = ?
        `).bind(eventId, claimToken)
      ]);
      return {
        success: true,
        skipped: true,
        orderId: order.id,
        status: order.status,
        reason: `Active dispute status '${existing.status}' cannot regress to inquiry '${normalizedStatus}'`
      };
    }
  }

  // 3. Closed inquiry (warning_closed) cannot regress to open inquiry
  if (existing && existing.status === 'warning_closed') {
    if (['warning_needs_response', 'warning_under_review'].includes(normalizedStatus)) {
      await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO commerce_dispute_observations
            (event_id, dispute_id, observed_status, authoritative_sha256, observed_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).bind(eventId, existing.id, normalizedStatus, authoritativeSha),
        db.prepare(`
          UPDATE stripe_event_inbox
          SET status = 'processed', processed_at = datetime('now'), last_error = NULL,
              claim_token = NULL, expires_at = NULL
          WHERE event_id = ? AND claim_token = ?
        `).bind(eventId, claimToken)
      ]);
      return {
        success: true,
        skipped: true,
        orderId: order.id,
        status: order.status,
        reason: `Closed inquiry 'warning_closed' cannot regress to '${normalizedStatus}'`
      };
    }
  }

  const evidenceDueAt = (dispute.evidence_details?.due_by && typeof dispute.evidence_details.due_by === 'number')
    ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
    : null;

  const openedAt = (dispute.created && typeof dispute.created === 'number')
    ? new Date(dispute.created * 1000).toISOString()
    : new Date().toISOString();

  const closedAt = ['won', 'lost', 'warning_closed'].includes(normalizedStatus)
    ? new Date().toISOString()
    : null;

  const baseStatements: any[] = [
    db.prepare(`
      INSERT INTO commerce_disputes
        (id, stripe_dispute_id, order_id, stripe_charge_id, amount_cents, currency, status,
         reason, evidence_due_at, authoritative_json, first_event_id, last_event_id, opened_at, closed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(stripe_dispute_id) DO UPDATE SET
        status = excluded.status,
        reason = excluded.reason,
        evidence_due_at = excluded.evidence_due_at,
        authoritative_json = excluded.authoritative_json,
        last_event_id = excluded.last_event_id,
        closed_at = CASE
          WHEN excluded.status IN ('won', 'lost', 'warning_closed') THEN COALESCE(commerce_disputes.closed_at, excluded.closed_at, datetime('now'))
          ELSE NULL
        END,
        updated_at = datetime('now')
    `).bind(
      canonicalId,
      disputeId,
      order.id,
      chargeId,
      amountCents,
      currency,
      normalizedStatus,
      dispute.reason ?? null,
      evidenceDueAt,
      authoritativeJson,
      eventId,
      eventId,
      openedAt,
      closedAt
    )
  ];

  // 1. Warning statuses (inquiries) do not alter order/license lifecycle
  if (['warning_needs_response', 'warning_under_review', 'warning_closed'].includes(normalizedStatus)) {
    baseStatements.push(
      db.prepare(`
        INSERT OR IGNORE INTO commerce_dispute_observations
          (event_id, dispute_id, observed_status, authoritative_sha256, observed_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(eventId, canonicalId, normalizedStatus, authoritativeSha),
      db.prepare(`
        INSERT INTO commerce_order_events
          (id, order_id, event_type, source, source_event_id, details_json)
        VALUES (?, ?, 'dispute_inquiry_received', 'stripe_webhook', ?, ?)
      `).bind(
        `coe_dispute_${eventId}`,
        order.id,
        eventId,
        JSON.stringify({ disputeId, status: normalizedStatus, amountCents, reason: dispute.reason ?? null })
      ),
      db.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'processed', processed_at = datetime('now'), last_error = NULL,
            claim_token = NULL, expires_at = NULL
        WHERE event_id = ? AND claim_token = ?
      `).bind(eventId, claimToken)
    );

    try {
      await db.batch(baseStatements);
    } catch (error: any) {
      const message = `Atomic dispute warning reconciliation failed: ${error.message}`;
      await releaseInboxClaim(db, eventId, claimToken, message, 30);
      return { success: false, retryable: true, error: message };
    }

    return { success: true, orderId: order.id, status: normalizedStatus };
  }

  // 2. Active dispute (needs_response, under_review): revoke license and mark order disputed
  if (['needs_response', 'under_review'].includes(normalizedStatus)) {
    const statements = [...baseStatements];

    if (order.status === 'fulfilled') {
      statements.push(
        db.prepare(`
          UPDATE commerce_orders
          SET status = 'disputed', state_version = state_version + 1, updated_at = datetime('now')
          WHERE id = ? AND state_version = ? AND status = 'fulfilled'
        `).bind(order.id, order.state_version)
      );
    }

    statements.push(
      db.prepare(`
        UPDATE commerce_licenses
        SET status = 'revoked', revoked_at = COALESCE(revoked_at, datetime('now'))
        WHERE order_id = ? AND status = 'active'
      `).bind(order.id),
      db.prepare(`
        INSERT OR IGNORE INTO commerce_dispute_observations
          (event_id, dispute_id, observed_status, authoritative_sha256, observed_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(eventId, canonicalId, normalizedStatus, authoritativeSha),
      db.prepare(`
        INSERT INTO commerce_order_events
          (id, order_id, event_type, source, source_event_id, details_json)
        VALUES (?, ?, 'order_disputed', 'stripe_webhook', ?, ?)
      `).bind(
        `coe_dispute_${eventId}`,
        order.id,
        eventId,
        JSON.stringify({ disputeId, status: normalizedStatus, amountCents, reason: dispute.reason ?? null })
      ),
      db.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'processed', processed_at = datetime('now'), last_error = NULL,
            claim_token = NULL, expires_at = NULL
        WHERE event_id = ? AND claim_token = ?
      `).bind(eventId, claimToken)
    );

    try {
      await db.batch(statements);
    } catch (error: any) {
      const message = `Atomic dispute reconciliation failed: ${error.message}`;
      await releaseInboxClaim(db, eventId, claimToken, message, 30);
      return { success: false, retryable: true, error: message };
    }

    return { success: true, orderId: order.id, status: 'disputed' };
  }

  // 3. Lost dispute: revoke license, keep order disputed/refunded, and record exact recovery obligations
  if (normalizedStatus === 'lost') {
    const statements = [...baseStatements];

    if (order.status === 'fulfilled') {
      statements.push(
        db.prepare(`
          UPDATE commerce_orders
          SET status = 'disputed', state_version = state_version + 1, updated_at = datetime('now')
          WHERE id = ? AND state_version = ? AND status = 'fulfilled'
        `).bind(order.id, order.state_version)
      );
    }

    statements.push(
      db.prepare(`
        UPDATE commerce_licenses
        SET status = 'revoked', revoked_at = COALESCE(revoked_at, datetime('now'))
        WHERE order_id = ? AND status = 'active'
      `).bind(order.id)
    );

    const allocationResult = await db.prepare(`
      SELECT id, sequence, role, amount_cents AS amountCents
      FROM commerce_order_allocations
      WHERE order_id = ?
      ORDER BY sequence
    `).bind(order.id).all();
    const allocations = (allocationResult.results || []) as FrozenAllocation[];

    const priorResult = await db.prepare(`
      SELECT allocation_id, SUM(amount_cents) AS total_recovered
      FROM commerce_recovery_obligations
      WHERE order_id = ? AND status <> 'cancelled'
      GROUP BY allocation_id
    `).bind(order.id).all();

    const prior = new Map<string, number>(
      (priorResult.results || []).map((row: any) => [row.allocation_id, Number(row.total_recovered)])
    );

    const priorLostDisputesResult: any = await db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total_lost_cents
      FROM commerce_disputes
      WHERE order_id = ? AND status = 'lost' AND stripe_dispute_id <> ?
    `).bind(order.id, disputeId).first();
    const priorLostDisputesCents = Number(priorLostDisputesResult?.total_lost_cents || 0);

    const totalClawback = Math.min(order.gross_cents, order.refunded_cents + priorLostDisputesCents + amountCents);
    let deltas;
    try {
      deltas = calculateRefundAllocationDelta(allocations, order.gross_cents, totalClawback, prior);
    } catch (error: any) {
      return failTerminal(db, eventId, claimToken, `Dispute recovery allocation failed: ${error.message}`);
    }

    for (const delta of deltas) {
      if (delta.deltaAmountCents > 0 && delta.role !== 'protocol_pool') {
        statements.push(
          db.prepare(`
            INSERT INTO commerce_recovery_obligations
              (id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
               source_event_id, amount_cents, currency, status)
            VALUES (?, ?, 'dispute', ?, ?, (SELECT id FROM commerce_transfer_outbox WHERE allocation_id = ?),
                    ?, ?, ?, 'pending')
          `).bind(
            `cro_dispute_${disputeId}_${delta.sequence}`,
            order.id,
            disputeId,
            delta.id,
            delta.id,
            eventId,
            delta.deltaAmountCents,
            currency
          )
        );
      }
    }

    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO commerce_dispute_observations
          (event_id, dispute_id, observed_status, authoritative_sha256, observed_at)
        VALUES (?, ?, 'lost', ?, datetime('now'))
      `).bind(eventId, canonicalId, authoritativeSha),
      db.prepare(`
        INSERT INTO commerce_order_events
          (id, order_id, event_type, source, source_event_id, details_json)
        VALUES (?, ?, 'order_dispute_lost', 'stripe_webhook', ?, ?)
      `).bind(
        `coe_dispute_${eventId}`,
        order.id,
        eventId,
        JSON.stringify({ disputeId, status: 'lost', amountCents, reason: dispute.reason ?? null })
      ),
      db.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'processed', processed_at = datetime('now'), last_error = NULL,
            claim_token = NULL, expires_at = NULL
        WHERE event_id = ? AND claim_token = ?
      `).bind(eventId, claimToken)
    );

    try {
      await db.batch(statements);
    } catch (error: any) {
      const message = `Atomic lost dispute reconciliation failed: ${error.message}`;
      await releaseInboxClaim(db, eventId, claimToken, message, 30);
      return { success: false, retryable: true, error: message };
    }

    return {
      success: true,
      orderId: order.id,
      status: order.status === 'refunded' ? 'refunded' : 'disputed'
    };
  }

  // 4. Won dispute: restore fulfilled order and active license if no other active/lost disputes and not fully refunded
  if (normalizedStatus === 'won') {
    const statements = [...baseStatements];

    const otherDisputesRow: any = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM commerce_disputes
      WHERE order_id = ?
        AND stripe_dispute_id <> ?
        AND status IN ('needs_response', 'under_review', 'lost')
    `).bind(order.id, disputeId).first();

    const hasOtherActiveOrLost = Number(otherDisputesRow?.count || 0) > 0;
    const isFullyRefunded = order.refunded_cents >= order.gross_cents || order.status === 'refunded';
    const shouldRestore = !hasOtherActiveOrLost && !isFullyRefunded;

    if (shouldRestore) {
      if (order.status === 'disputed') {
        statements.push(
          db.prepare(`
            UPDATE commerce_orders
            SET status = 'fulfilled', state_version = state_version + 1, updated_at = datetime('now')
            WHERE id = ? AND state_version = ? AND status = 'disputed'
          `).bind(order.id, order.state_version)
        );
      }

      statements.push(
        db.prepare(`
          UPDATE commerce_licenses
          SET status = 'active', revoked_at = NULL
          WHERE order_id = ? AND status = 'revoked'
        `).bind(order.id)
      );
    }

    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO commerce_dispute_observations
          (event_id, dispute_id, observed_status, authoritative_sha256, observed_at)
        VALUES (?, ?, 'won', ?, datetime('now'))
      `).bind(eventId, canonicalId, authoritativeSha),
      db.prepare(`
        INSERT INTO commerce_order_events
          (id, order_id, event_type, source, source_event_id, details_json)
        VALUES (?, ?, 'order_dispute_won', 'stripe_webhook', ?, ?)
      `).bind(
        `coe_dispute_${eventId}`,
        order.id,
        eventId,
        JSON.stringify({
          disputeId,
          status: 'won',
          restored: shouldRestore,
          reason: shouldRestore ? null : (isFullyRefunded ? 'order_fully_refunded' : 'other_dispute_active_or_lost')
        })
      ),
      db.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'processed', processed_at = datetime('now'), last_error = NULL,
            claim_token = NULL, expires_at = NULL
        WHERE event_id = ? AND claim_token = ?
      `).bind(eventId, claimToken)
    );

    try {
      await db.batch(statements);
    } catch (error: any) {
      const message = `Atomic won dispute reconciliation failed: ${error.message}`;
      await releaseInboxClaim(db, eventId, claimToken, message, 30);
      return { success: false, retryable: true, error: message };
    }

    return {
      success: true,
      orderId: order.id,
      status: shouldRestore ? 'fulfilled' : order.status
    };
  }

  return { success: true, orderId: order.id, status: normalizedStatus };
}
