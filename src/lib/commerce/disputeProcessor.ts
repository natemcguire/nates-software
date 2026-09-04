import { hashPayload, markInboxTerminalFailure, releaseInboxClaim } from './stripeInbox';
import { calculateDisputeRecoveryDelta } from './recoveryDomain';
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

async function runGuardedOrderCas(
  db: any,
  sql: string,
  params: any[]
): Promise<{ ok: boolean; changes: number; dbError?: any }> {
  try {
    const result: any = await db.prepare(sql).bind(...params).run();
    const changes = result?.meta?.changes ?? 0;
    return { ok: changes === 1, changes };
  } catch (error: any) {
    return { ok: false, changes: 0, dbError: error };
  }
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
    const allocationResult = await db.prepare(`
      SELECT id, sequence, role, amount_cents AS amountCents
      FROM commerce_order_allocations
      WHERE order_id = ?
      ORDER BY sequence
    `).bind(order.id).all();
    const allocations = (allocationResult.results || []) as any[];

    if (allocations.length === 0) {
      const message = `No allocations found for order '${order.id}' to recover a lost dispute against`;
      await releaseInboxClaim(db, eventId, claimToken, message, 30);
      return { success: false, retryable: true, error: message };
    }

    const priorRefundResult = await db.prepare(`
      SELECT ra.allocation_id, SUM(ra.amount_cents) AS amount
      FROM commerce_refund_allocations ra
      JOIN commerce_refunds r ON r.id = ra.refund_id
      WHERE r.order_id = ? AND r.finalized_at IS NOT NULL
      GROUP BY ra.allocation_id
    `).bind(order.id).all();
    const priorDisputeResult = await db.prepare(`
      SELECT allocation_id, SUM(amount_cents) AS amount
      FROM commerce_recovery_obligations
      WHERE order_id = ? AND source_kind = 'dispute' AND source_id != ?
      GROUP BY allocation_id
    `).bind(order.id, disputeId).all();
    const priorByAllocation = new Map<string, number>();
    let priorClawbackCents = 0;
    for (const row of (priorRefundResult.results || []) as any[]) {
      const amount = Number(row.amount);
      priorByAllocation.set(row.allocation_id, (priorByAllocation.get(row.allocation_id) ?? 0) + amount);
      priorClawbackCents += amount;
    }
    for (const row of (priorDisputeResult.results || []) as any[]) {
      const amount = Number(row.amount);
      priorByAllocation.set(row.allocation_id, (priorByAllocation.get(row.allocation_id) ?? 0) + amount);
      priorClawbackCents += amount;
    }

    let deltas;
    try {
      deltas = calculateDisputeRecoveryDelta(allocations, order.gross_cents, amountCents, priorClawbackCents, priorByAllocation);
    } catch (error: any) {
      return failTerminal(db, eventId, claimToken, `Dispute recovery allocation failed: ${error.message}`);
    }
    const sumDeltas = deltas.reduce((sum, delta) => sum + delta.deltaAmountCents, 0);
    if (sumDeltas !== amountCents) {
      const message = `Dispute recovery deltas (${sumDeltas}) do not conserve dispute amount (${amountCents})`;
      return failTerminal(db, eventId, claimToken, message);
    }

    const lostStatements: any[] = [];
    for (const delta of deltas) {
      if (delta.role === 'protocol_pool' || delta.role === 'platform' || delta.deltaAmountCents <= 0) continue;
      const outboxRow: any = await db.prepare(`
        SELECT id FROM commerce_transfer_outbox WHERE allocation_id = ?
      `).bind(delta.id).first();
      lostStatements.push(
        db.prepare(`
          INSERT OR IGNORE INTO commerce_recovery_obligations
            (id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
             source_event_id, amount_cents, currency, status)
          VALUES (?, ?, 'dispute', ?, ?, ?, ?, ?, ?, 'pending')
        `).bind(
          `cro_dispute_${disputeId}_${delta.sequence}`,
          order.id,
          disputeId,
          delta.id,
          outboxRow?.id ?? null,
          eventId,
          delta.deltaAmountCents,
          currency
        )
      );
      recoveryObligationsOpened++;
    }

    if (order.status === 'fulfilled') {
      const casResult = await runGuardedOrderCas(db, `
        UPDATE commerce_orders SET status = 'disputed', state_version = state_version + 1, updated_at = datetime('now')
        WHERE id = ? AND state_version = ? AND status = 'fulfilled'
      `, [order.id, order.state_version]);
      if (!casResult.ok) {
        const message = casResult.dbError
          ? `Dispute order transition to 'disputed' failed: ${casResult.dbError.message}`
          : `Dispute order transition to 'disputed' affected ${casResult.changes} rows (expected 1) — concurrent order state change detected`;
        await releaseInboxClaim(db, eventId, claimToken, message, 5);
        return { success: false, retryable: true, error: message };
      }
      orderNextStatus = 'disputed';
    }

    lostStatements.push(
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
    statements.push(...lostStatements);
  } else if (status === 'won') {
    if (order.status === 'disputed') {
      const casResult = await runGuardedOrderCas(db, `
        UPDATE commerce_orders SET status = 'fulfilled', state_version = state_version + 1, updated_at = datetime('now')
        WHERE id = ? AND state_version = ? AND status = 'disputed'
          AND NOT EXISTS (
            SELECT 1 FROM commerce_disputes
            WHERE order_id = ? AND stripe_dispute_id != ? AND status NOT IN ('won', 'warning_closed')
          )
      `, [order.id, order.state_version, order.id, disputeId]);
      if (casResult.dbError) {
        const message = `Dispute order transition to 'fulfilled' failed: ${casResult.dbError.message}`;
        await releaseInboxClaim(db, eventId, claimToken, message, 5);
        return { success: false, retryable: true, error: message };
      }
      if (casResult.ok) {
        orderNextStatus = 'fulfilled';
      }
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
    if (order.status === 'fulfilled') {
      const casResult = await runGuardedOrderCas(db, `
        UPDATE commerce_orders SET status = 'disputed', state_version = state_version + 1, updated_at = datetime('now')
        WHERE id = ? AND state_version = ? AND status = 'fulfilled'
      `, [order.id, order.state_version]);
      if (!casResult.ok) {
        const message = casResult.dbError
          ? `Dispute order transition to 'disputed' failed: ${casResult.dbError.message}`
          : `Dispute order transition to 'disputed' affected ${casResult.changes} rows (expected 1) — concurrent order state change detected`;
        await releaseInboxClaim(db, eventId, claimToken, message, 5);
        return { success: false, retryable: true, error: message };
      }
      orderNextStatus = 'disputed';
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
    const message = `Dispute reconciliation batch failed (needs manual reconciliation): ${error.message}`;
    return failTerminal(db, eventId, claimToken, message);
  }

  return {
    success: true,
    orderId: order.id,
    status: orderNextStatus
  };
}
