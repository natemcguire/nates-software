// Authoritative Stripe Dispute Event Processor
// Handles `charge.dispute.created` / `charge.dispute.updated` / `charge.dispute.closed`
// webhook deliveries by re-fetching the authoritative Stripe Dispute object (never
// trusting the webhook body) and durably recording it against the matching order.
// A dispute that closes as 'lost' opens a commerce_recovery_obligations row per
// maker/ancestor/contributor allocation so the recovery-execution worker can claw the funds
// back — mirroring how refundProcessor.ts opens obligations for refund deltas.

import { hashPayload, markInboxTerminalFailure, releaseInboxClaim } from './stripeInbox';
import { ProcessEventResult } from './types';

const DISPUTE_EVENT_TYPES = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated'
]);

const DISPUTE_STATUSES = new Set([
  'warning_needs_response', 'warning_under_review', 'warning_closed',
  'needs_response', 'under_review', 'won', 'lost'
]);

export function isDisputeEventType(eventType: string): boolean {
  return DISPUTE_EVENT_TYPES.has(eventType);
}

async function failTerminal(db: any, eventId: string, claimToken: string, message: string): Promise<ProcessEventResult> {
  await markInboxTerminalFailure(db, eventId, claimToken, message);
  return { success: false, terminal: true, error: message };
}

async function fetchAuthoritativeDispute(env: any, disputeId: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`https://api.stripe.com/v1/disputes/${encodeURIComponent(disputeId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
}

async function fetchAuthoritativeCharge(env: any, chargeId: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(`https://api.stripe.com/v1/charges/${encodeURIComponent(chargeId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
}

/**
 * Processes a `charge.dispute.*` event from `stripe_event_inbox`.
 *
 * Requirements:
 * 1. Re-fetches the authoritative Stripe Dispute (GET /v1/disputes/<id>) and the
 *    Charge it references — the webhook body is only used to discover the
 *    dispute ID to re-fetch, never trusted for status/economics.
 * 2. Resolves the commerce order via the charge's PaymentIntent
 *    (commerce_orders.stripe_payment_intent_id), matching the pattern used by
 *    refundProcessor.ts.
 * 3. Upserts an immutable-by-convention commerce_disputes row keyed on
 *    stripe_dispute_id, plus a commerce_dispute_observations row per delivery
 *    (every delivery remains evidence, matching refund observations).
 * 4. When the dispute is open (not yet won/lost) and the order is currently
 *    'fulfilled', advances the order to 'disputed' — informational, no money
 *    movement yet.
 * 5. When the dispute status is authoritatively 'lost', opens one
 *    commerce_recovery_obligations row per maker/ancestor/contributor allocation (capped at
 *    each allocation's frozen amount) so the recovery-execution worker can claw
 *    the funds back from already-completed transfers. Idempotent via the
 *    (source_kind, source_id, allocation_id) unique constraint.
 * 6. When the dispute status is authoritatively 'won' and the order has no
 *    other unresolved dispute, reverts the order from 'disputed' back to
 *    'fulfilled' (funds were never actually clawed back, so this is safe).
 * 7. Fails closed if the order cannot be resolved from the authoritative data.
 */
export async function processDisputeInboxEvent(
  db: any,
  env: any,
  inboxRow: any,
  event: any,
  claimToken: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ProcessEventResult> {
  const eventId = inboxRow.event_id;
  const disputeId = event?.data?.object?.id || inboxRow.stripe_object_id;
  if (typeof disputeId !== 'string' || !disputeId.startsWith('dp_')) {
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
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  const amountCents = Number(dispute.amount);
  const currency = String(dispute.currency || '').toLowerCase();
  if (dispute.id !== disputeId || dispute.object !== 'dispute' || !DISPUTE_STATUSES.has(status)) {
    return failTerminal(db, eventId, claimToken, 'Authoritative Stripe Dispute identity, object type, or status is invalid');
  }
  if (!chargeId || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return failTerminal(db, eventId, claimToken, 'Authoritative Stripe Dispute is missing valid charge or amount fields');
  }
  if (Boolean(dispute.livemode) !== Boolean(inboxRow.livemode) || Boolean(dispute.livemode) !== (env.STRIPE_LIVEMODE === 'true')) {
    return failTerminal(db, eventId, claimToken, 'Dispute livemode does not match the delivered event or configured environment');
  }

  let chargeResponse: Response;
  try {
    chargeResponse = await fetchAuthoritativeCharge(env, chargeId, fetchImpl);
  } catch (error: any) {
    const message = `Network error re-fetching dispute Charge: ${error.message}`;
    await releaseInboxClaim(db, eventId, claimToken, message, 30);
    return { success: false, retryable: true, error: message };
  }
  if (!chargeResponse.ok) {
    const message = `Authoritative dispute Charge fetch failed (${chargeResponse.status})`;
    if ([401, 403, 404].includes(chargeResponse.status)) return failTerminal(db, eventId, claimToken, message);
    await releaseInboxClaim(db, eventId, claimToken, message, 60);
    return { success: false, retryable: true, error: message };
  }
  const charge: any = await chargeResponse.json();
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (charge.id !== chargeId || charge.object !== 'charge' || !paymentIntentId) {
    return failTerminal(db, eventId, claimToken, 'Authoritative Charge does not reference a PaymentIntent matching the dispute');
  }

  const order: any = await db.prepare(`
    SELECT id, gross_cents, refunded_cents, currency, status, state_version
    FROM commerce_orders WHERE stripe_payment_intent_id = ?
  `).bind(paymentIntentId).first();
  if (!order) return failTerminal(db, eventId, claimToken, `No commerce order matches dispute PaymentIntent '${paymentIntentId}'`);
  if (currency !== order.currency) {
    return failTerminal(db, eventId, claimToken, 'Dispute currency does not match the immutable commerce order');
  }

  const canonicalId = `cdp_${disputeId}`;
  const authoritativeJson = JSON.stringify(dispute);
  const authoritativeSha = await hashPayload(authoritativeJson);
  const existing: any = await db.prepare(`
    SELECT id, order_id, stripe_charge_id, amount_cents, currency, status, closed_at
    FROM commerce_disputes WHERE stripe_dispute_id = ?
  `).bind(disputeId).first();
  if (existing && (existing.order_id !== order.id || existing.stripe_charge_id !== chargeId
      || existing.amount_cents !== amountCents || existing.currency !== currency)) {
    return failTerminal(db, eventId, claimToken, 'Stripe Dispute economics conflict with its existing canonical record');
  }

  const isTerminal = status === 'won' || status === 'lost' || status === 'warning_closed';
  const closedAtSql = isTerminal ? `COALESCE(closed_at, datetime('now'))` : 'closed_at';
  const evidenceDueAt = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
    : null;
  const openedAt = dispute.created
    ? new Date(dispute.created * 1000).toISOString()
    : new Date().toISOString();

  const statements: any[] = [
    db.prepare(`
      INSERT INTO commerce_disputes
        (id, stripe_dispute_id, order_id, stripe_charge_id, amount_cents, currency, status,
         reason, evidence_due_at, authoritative_json, first_event_id, last_event_id, opened_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(stripe_dispute_id) DO UPDATE SET
        status = excluded.status,
        reason = excluded.reason,
        evidence_due_at = excluded.evidence_due_at,
        authoritative_json = excluded.authoritative_json,
        last_event_id = excluded.last_event_id,
        closed_at = ${closedAtSql},
        updated_at = datetime('now')
    `).bind(
      canonicalId, disputeId, order.id, chargeId, amountCents, currency, status,
      dispute.reason ?? null, evidenceDueAt, authoritativeJson, eventId, eventId, openedAt
    ),
    db.prepare(`
      INSERT INTO commerce_dispute_observations
        (event_id, dispute_id, observed_status, authoritative_sha256)
      VALUES (?, ?, ?, ?)
    `).bind(eventId, canonicalId, status, authoritativeSha)
  ];

  let recoveryObligationsOpened = 0;
  let orderNextStatus = order.status;

  if (status === 'lost') {
    // Idempotent: obligations are keyed uniquely on (source_kind, source_id, allocation_id),
    // and the trigger commerce_recovery_matches_order_allocation caps each row at the
    // allocation's frozen amount, so re-processing a 'lost' delivery is a safe no-op via
    // INSERT OR IGNORE (never double-opens obligations for the same dispute).
    // Recover from every PAYABLE role — maker, ancestor, AND contributor. The
    // payout path queues transfer_outbox rows for all three (protocol_pool is
    // never paid out, so there is nothing to claw back from it). Omitting
    // 'contributor' here let a granted contributor keep funds after a lost
    // dispute — money not conserved. This mirrors refundProcessor, which
    // recovers every role except protocol_pool.
    const allocationResult = await db.prepare(`
      SELECT id, sequence, role, amount_cents AS amountCents
      FROM commerce_order_allocations
      WHERE order_id = ? AND role IN ('maker', 'ancestor', 'contributor')
      ORDER BY sequence
    `).bind(order.id).all();
    const allocations = (allocationResult.results || []) as any[];

    for (const alloc of allocations) {
      const outboxRow: any = await db.prepare(`
        SELECT id FROM commerce_transfer_outbox WHERE allocation_id = ?
      `).bind(alloc.id).first();
      statements.push(
        db.prepare(`
          INSERT OR IGNORE INTO commerce_recovery_obligations
            (id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
             source_event_id, amount_cents, currency, status)
          VALUES (?, ?, 'dispute', ?, ?, ?, ?, ?, ?, 'pending')
        `).bind(
          `cro_dispute_${disputeId}_${alloc.sequence}`,
          order.id,
          disputeId,
          alloc.id,
          outboxRow?.id ?? null,
          eventId,
          alloc.amountCents,
          currency
        )
      );
      recoveryObligationsOpened++;
    }

    if (order.status === 'fulfilled') {
      orderNextStatus = 'disputed';
      statements.push(
        db.prepare(`
          UPDATE commerce_orders SET status = 'disputed', state_version = state_version + 1, updated_at = datetime('now')
          WHERE id = ? AND state_version = ? AND status = 'fulfilled'
        `).bind(order.id, order.state_version)
      );
    }

    statements.push(
      db.prepare(`
        INSERT INTO commerce_order_events (id, order_id, event_type, source, source_event_id, details_json, created_at)
        VALUES (?, ?, 'dispute_lost', 'stripe_webhook', ?, ?, datetime('now'))
      `).bind(
        `coe_dispute_lost_${eventId}`,
        order.id,
        eventId,
        JSON.stringify({ disputeId, amountCents, recoveryObligationsOpened })
      )
    );
  } else if (status === 'won') {
    if (order.status === 'disputed') {
      orderNextStatus = 'fulfilled';
      statements.push(
        db.prepare(`
          UPDATE commerce_orders SET status = 'fulfilled', state_version = state_version + 1, updated_at = datetime('now')
          WHERE id = ? AND state_version = ? AND status = 'disputed'
        `).bind(order.id, order.state_version)
      );
    }
    statements.push(
      db.prepare(`
        INSERT INTO commerce_order_events (id, order_id, event_type, source, source_event_id, details_json, created_at)
        VALUES (?, ?, 'dispute_won', 'stripe_webhook', ?, ?, datetime('now'))
      `).bind(
        `coe_dispute_won_${eventId}`,
        order.id,
        eventId,
        JSON.stringify({ disputeId, amountCents })
      )
    );
  } else {
    // Dispute opened or still under review: informational transition only.
    if (order.status === 'fulfilled') {
      orderNextStatus = 'disputed';
      statements.push(
        db.prepare(`
          UPDATE commerce_orders SET status = 'disputed', state_version = state_version + 1, updated_at = datetime('now')
          WHERE id = ? AND state_version = ? AND status = 'fulfilled'
        `).bind(order.id, order.state_version)
      );
    }
    statements.push(
      db.prepare(`
        INSERT INTO commerce_order_events (id, order_id, event_type, source, source_event_id, details_json, created_at)
        VALUES (?, ?, 'dispute_opened', 'stripe_webhook', ?, ?, datetime('now'))
      `).bind(
        `coe_dispute_opened_${eventId}`,
        order.id,
        eventId,
        JSON.stringify({ disputeId, amountCents, status })
      )
    );
  }

  statements.push(
    db.prepare(`
      UPDATE stripe_event_inbox SET status='processed', processed_at=datetime('now'), last_error=NULL,
        claim_token=NULL, expires_at=NULL WHERE event_id=? AND claim_token=?
    `).bind(eventId, claimToken)
  );

  try {
    await db.batch(statements);
  } catch (error: any) {
    const message = `Atomic dispute reconciliation failed: ${error.message}`;
    await releaseInboxClaim(db, eventId, claimToken, message, 30);
    return { success: false, retryable: true, error: message };
  }

  return {
    success: true,
    orderId: order.id,
    status: orderNextStatus
  };
}
