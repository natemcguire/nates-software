// Stripe Connect Transfer Reversal / Recovery Execution Worker
// Mirrors transferWorker.ts's exact shape (claim/lease, deterministic canonical
// request hashing, strict HTTP status classification, exponential bounded
// backoff, 23-hour idempotency cutoff, durable reconciliation) but drives
// commerce_recovery_obligations -> commerce_reversal_outbox -> POST
// /v1/transfers/<id>/reversals instead of POST /v1/transfers.
//
// Gated on PAYOUTS_ENABLED, same as transferWorker.ts: reversing money that was
// never actually paid out makes no sense while payouts are off, and this keeps
// the worker fail-closed in lockstep with the forward transfer path.

import { hashPayload } from './stripeInbox';
import { CommerceError } from './types';
import { calculateBackoffSeconds, DEFAULT_LEASE_DURATION_SECONDS, STRIPE_IDEMPOTENCY_SAFETY_WINDOW_SECONDS, validatePayoutWorkerConfig } from './transferWorker';

export class RecoveryWorkerError extends CommerceError {
  public statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'RecoveryWorkerError';
    this.statusCode = statusCode;
  }
}

export interface EnqueueReversalResult {
  success: boolean;
  obligationId: string;
  reversalOutboxId?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

/**
 * Promotes ONE pending obligation to 'reversal_queued' by creating its
 * commerce_reversal_outbox row, ONLY if the original transfer has succeeded.
 * If the original transfer has not (yet) succeeded, the obligation is left
 * 'pending' so a later tick can retry once the forward transfer completes
 * (or the obligation is otherwise resolved out of band).
 *
 * Idempotent: commerce_reversal_outbox has a UNIQUE(original_outbox_id,
 * source_event_id) constraint and the obligation is only promoted from
 * 'pending' via a conditional UPDATE, so concurrent workers race safely.
 */
export async function enqueueReversalForObligation(
  db: any,
  obligationId: string
): Promise<EnqueueReversalResult> {
  const obligation: any = await db.prepare(`
    SELECT id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
           source_event_id, amount_cents, currency, status
    FROM commerce_recovery_obligations
    WHERE id = ?
  `).bind(obligationId).first();

  if (!obligation) {
    return { success: false, obligationId, error: `Recovery obligation '${obligationId}' not found` };
  }

  if (obligation.status !== 'pending') {
    return { success: true, obligationId, skipped: true, reason: `Obligation already in status '${obligation.status}'` };
  }

  if (!obligation.original_outbox_id) {
    // No transfer was ever sent for this allocation (e.g. the outbox row was
    // never created, or is itself still terminal/failed) — nothing to reverse.
    // Leave pending; an operator or a later reconciliation pass resolves this
    // out of band (there is no money to claw back from Stripe yet).
    return { success: true, obligationId, skipped: true, reason: 'No original transfer outbox is associated with this obligation' };
  }

  const originalTransfer: any = await db.prepare(`
    SELECT id, status, stripe_transfer_id, amount_cents, currency
    FROM commerce_transfer_outbox WHERE id = ?
  `).bind(obligation.original_outbox_id).first();

  if (!originalTransfer || originalTransfer.status !== 'succeeded' || !originalTransfer.stripe_transfer_id) {
    return { success: true, obligationId, skipped: true, reason: 'Original transfer has not succeeded yet; nothing to reverse' };
  }

  const reversalOutboxId = `cro_${crypto.randomUUID().replace(/-/g, '')}`;
  const idempotencyKey = `reversal:${reversalOutboxId}`;

  try {
    const insertRes = await db.prepare(`
      INSERT INTO commerce_reversal_outbox (
        id, original_outbox_id, source_event_id, amount_cents, currency,
        stripe_idempotency_key, status, attempt_count, next_attempt_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, datetime('now'), datetime('now'))
    `).bind(
      reversalOutboxId,
      obligation.original_outbox_id,
      obligation.source_event_id,
      obligation.amount_cents,
      obligation.currency,
      idempotencyKey
    ).run();

    if ((insertRes?.meta?.changes ?? 0) !== 1) {
      throw new Error('reversal outbox insert affected no rows');
    }
  } catch (err: any) {
    // Unique constraint on (original_outbox_id, source_event_id) means a
    // concurrent worker already enqueued this reversal — treat as a safe race.
    const already: any = await db.prepare(`
      SELECT id FROM commerce_reversal_outbox WHERE original_outbox_id = ? AND source_event_id = ?
    `).bind(obligation.original_outbox_id, obligation.source_event_id).first();
    if (already?.id) {
      await db.prepare(`
        UPDATE commerce_recovery_obligations
        SET status = 'reversal_queued', reversal_outbox_id = ?
        WHERE id = ? AND status = 'pending'
      `).bind(already.id, obligationId).run();
      return { success: true, obligationId, reversalOutboxId: already.id, skipped: true, reason: 'Reversal already enqueued by a concurrent worker' };
    }
    return { success: false, obligationId, error: `Failed to enqueue reversal outbox row: ${err.message}` };
  }

  const claimRes = await db.prepare(`
    UPDATE commerce_recovery_obligations
    SET status = 'reversal_queued', reversal_outbox_id = ?
    WHERE id = ? AND status = 'pending'
  `).bind(reversalOutboxId, obligationId).run();

  if ((claimRes?.meta?.changes ?? 0) !== 1) {
    // Lost the race after inserting the reversal row; another worker already
    // moved this obligation. The just-inserted reversal_outbox row is orphaned
    // but harmless (it references a valid original_outbox_id/source_event_id
    // and will simply never be claimed by an obligation).
    return { success: true, obligationId, reversalOutboxId, skipped: true, reason: 'Obligation was concurrently claimed by another worker' };
  }

  return { success: true, obligationId, reversalOutboxId };
}

/**
 * Builds canonical Stripe /v1/transfers/<id>/reversals request parameters.
 * Deterministic parameter ordering guarantees identical SHA-256 payload across retries.
 */
export function buildStripeReversalPayload(reversal: {
  id: string;
  amount_cents: number;
  currency: string;
}): { requestBodyString: string; params: URLSearchParams } {
  const params = new URLSearchParams();
  params.append('amount', String(reversal.amount_cents));
  params.append('metadata[reversalOutboxId]', reversal.id);
  return { requestBodyString: params.toString(), params };
}

export interface ProcessReversalResult {
  success: boolean;
  reversalOutboxId?: string;
  obligationId?: string;
  stripeReversalId?: string;
  status?: string;
  skipped?: boolean;
  duplicate?: boolean;
  retryable?: boolean;
  terminal?: boolean;
  ambiguous?: boolean;
  httpStatus?: number | null;
  error?: string;
  reason?: string;
}

/**
 * Claims a commerce_reversal_outbox row with the same conditional finite lease
 * shape as claimTransferOutboxRow.
 */
async function claimReversalOutboxRow(
  db: any,
  reversalOutboxId: string,
  leaseDurationSeconds: number
): Promise<{ claimed: boolean; claimToken: string }> {
  const claimToken = `clm_${crypto.randomUUID().replace(/-/g, '')}`;
  const res = await db.prepare(`
    UPDATE commerce_reversal_outbox
    SET status = 'processing',
        claim_token = ?,
        claimed_at = datetime('now'),
        lease_expires_at = datetime('now', '+' || ? || ' seconds'),
        attempt_count = attempt_count + 1
    WHERE id = ?
      AND (
        (status IN ('pending', 'retryable_failure') AND next_attempt_at <= datetime('now') AND (lease_expires_at IS NULL OR lease_expires_at <= datetime('now')))
        OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= datetime('now'))
      )
  `).bind(claimToken, leaseDurationSeconds, reversalOutboxId).run();

  return { claimed: (res?.meta?.changes ?? 0) === 1, claimToken };
}

async function releaseReversalClaim(db: any, id: string, claimToken: string, errorMsg: string, backoffSeconds: number, httpStatus: number | null = null): Promise<void> {
  await db.prepare(`
    UPDATE commerce_reversal_outbox
    SET status = 'retryable_failure', last_error = ?, last_http_status = ?,
        next_attempt_at = datetime('now', '+' || ? || ' seconds'),
        claim_token = NULL, lease_expires_at = NULL
    WHERE id = ? AND claim_token = ?
  `).bind(errorMsg, httpStatus, backoffSeconds, id, claimToken).run();
}

async function markReversalTerminal(db: any, id: string, claimToken: string | null, errorMsg: string, httpStatus: number | null = null): Promise<void> {
  if (claimToken) {
    await db.prepare(`
      UPDATE commerce_reversal_outbox
      SET status = 'terminal_failure', last_error = ?, last_http_status = ?, completed_at = datetime('now'),
          claim_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND claim_token = ?
    `).bind(errorMsg, httpStatus, id, claimToken).run();
  } else {
    await db.prepare(`
      UPDATE commerce_reversal_outbox
      SET status = 'terminal_failure', last_error = ?, last_http_status = ?, completed_at = datetime('now'),
          claim_token = NULL, lease_expires_at = NULL
      WHERE id = ?
    `).bind(errorMsg, httpStatus, id).run();
  }
}

/**
 * Executes reversal workflow for a single commerce_reversal_outbox item, then
 * (on success) marks the originating commerce_recovery_obligations row
 * 'recovered'. Same fail-closed shape as processTransferOutboxItem.
 */
export async function processReversalOutboxItem(
  db: any,
  env: any,
  reversalOutboxId: string,
  options?: { leaseDurationSeconds?: number; stripeFetchOverride?: typeof fetch }
): Promise<ProcessReversalResult> {
  if (!db) return { success: false, reversalOutboxId, error: 'Database service is unavailable' };

  const configCheck = validatePayoutWorkerConfig(env);
  if (!configCheck.valid) {
    return { success: false, reversalOutboxId, error: configCheck.error || 'Payout worker configuration invalid' };
  }

  const leaseDurationSeconds = options?.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS;
  const { claimed, claimToken } = await claimReversalOutboxRow(db, reversalOutboxId, leaseDurationSeconds);

  if (!claimed) {
    const existing: any = await db.prepare(`
      SELECT id, status, stripe_reversal_id, last_error FROM commerce_reversal_outbox WHERE id = ?
    `).bind(reversalOutboxId).first();

    if (existing?.status === 'succeeded') {
      return { success: true, duplicate: true, reversalOutboxId, status: 'succeeded', stripeReversalId: existing.stripe_reversal_id };
    }
    if (existing?.status === 'terminal_failure') {
      return { success: false, terminal: true, reversalOutboxId, error: existing.last_error || 'Reversal previously marked terminal failure' };
    }
    return { success: false, skipped: true, reversalOutboxId, reason: `Reversal outbox row '${reversalOutboxId}' is not available for claiming` };
  }

  const reversal: any = await db.prepare(`
    SELECT id, original_outbox_id, source_event_id, amount_cents, currency, status,
           attempt_count, stripe_idempotency_key, stripe_reversal_id
    FROM commerce_reversal_outbox WHERE id = ?
  `).bind(reversalOutboxId).first();

  if (!reversal) {
    return { success: false, reversalOutboxId, error: `Reversal outbox row '${reversalOutboxId}' not found in D1` };
  }
  if (reversal.status === 'succeeded') {
    return { success: true, duplicate: true, reversalOutboxId, status: 'succeeded', stripeReversalId: reversal.stripe_reversal_id };
  }

  // 23-hour idempotency safety window on prior ambiguous attempts
  const priorAmbiguous: any = await db.prepare(`
    SELECT id, started_at, (strftime('%s','now') - strftime('%s', started_at)) AS elapsed_seconds
    FROM commerce_reversal_attempts
    WHERE reversal_outbox_id = ? AND outcome IN ('ambiguous', 'started')
    ORDER BY started_at ASC, attempt_number ASC LIMIT 1
  `).bind(reversalOutboxId).first();

  if (priorAmbiguous && priorAmbiguous.elapsed_seconds > STRIPE_IDEMPOTENCY_SAFETY_WINDOW_SECONDS) {
    const errorMsg = `Ambiguous reversal attempt exceeded 23-hour safe idempotency window; manual reconciliation required`;
    await markReversalTerminal(db, reversalOutboxId, claimToken, errorMsg);
    return { success: false, terminal: true, reversalOutboxId, error: errorMsg };
  }

  const originalTransfer: any = await db.prepare(`
    SELECT id, stripe_transfer_id FROM commerce_transfer_outbox WHERE id = ?
  `).bind(reversal.original_outbox_id).first();
  if (!originalTransfer?.stripe_transfer_id) {
    const errorMsg = `Original transfer outbox '${reversal.original_outbox_id}' has no Stripe transfer ID to reverse`;
    await markReversalTerminal(db, reversalOutboxId, claimToken, errorMsg);
    return { success: false, terminal: true, reversalOutboxId, error: errorMsg };
  }

  const expectedIdempotencyKey = `reversal:${reversalOutboxId}`;
  if (reversal.stripe_idempotency_key !== expectedIdempotencyKey) {
    const errorMsg = `Stripe idempotency key mismatch for reversal '${reversalOutboxId}'`;
    await markReversalTerminal(db, reversalOutboxId, claimToken, errorMsg);
    return { success: false, terminal: true, reversalOutboxId, error: errorMsg };
  }

  const { requestBodyString } = buildStripeReversalPayload({
    id: reversalOutboxId,
    amount_cents: reversal.amount_cents,
    currency: reversal.currency
  });
  const requestSha256 = await hashPayload(requestBodyString);

  const attemptSeq: any = await db.prepare(`
    SELECT COALESCE(MAX(attempt_number), 0) AS m FROM commerce_reversal_attempts WHERE reversal_outbox_id = ?
  `).bind(reversalOutboxId).first();
  const attemptNumber = Math.max(reversal.attempt_count > 0 ? reversal.attempt_count : 1, Number(attemptSeq?.m || 0) + 1);
  const attemptId = `cra_${crypto.randomUUID().replace(/-/g, '')}`;

  try {
    await db.prepare(`
      INSERT INTO commerce_reversal_attempts (
        id, reversal_outbox_id, attempt_number, stripe_idempotency_key, request_sha256, outcome, started_at
      ) VALUES (?, ?, ?, ?, ?, 'started', datetime('now'))
    `).bind(attemptId, reversalOutboxId, attemptNumber, expectedIdempotencyKey, requestSha256).run();
  } catch (err: any) {
    const backoffSec = calculateBackoffSeconds(attemptNumber);
    const errorMsg = `Failed to record started reversal attempt: ${err.message}`;
    await releaseReversalClaim(db, reversalOutboxId, claimToken, errorMsg, backoffSec);
    return { success: false, retryable: true, reversalOutboxId, error: errorMsg };
  }

  const fetchImpl = options?.stripeFetchOverride || globalThis.fetch;
  let stripeRes: Response;
  try {
    stripeRes = await fetchImpl(`https://api.stripe.com/v1/transfers/${encodeURIComponent(originalTransfer.stripe_transfer_id)}/reversals`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Idempotency-Key': expectedIdempotencyKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: requestBodyString
    });
  } catch (networkErr: any) {
    const errorMsg = `Network exception during Stripe reversal request: ${networkErr.message}`;
    const backoffSec = calculateBackoffSeconds(attemptNumber);
    try {
      await db.batch([
        db.prepare(`UPDATE commerce_reversal_attempts SET outcome='ambiguous', error_code='network_error', error_message=?, completed_at=datetime('now') WHERE id=?`)
          .bind(errorMsg, attemptId),
        db.prepare(`UPDATE commerce_reversal_outbox SET status='retryable_failure', last_error=?, next_attempt_at=datetime('now','+' || ? || ' seconds'), claim_token=NULL, lease_expires_at=NULL WHERE id=? AND claim_token=?`)
          .bind(errorMsg, backoffSec, reversalOutboxId, claimToken)
      ]);
    } catch {}
    return { success: false, ambiguous: true, retryable: true, reversalOutboxId, error: errorMsg };
  }

  const httpStatus = stripeRes.status;

  if (httpStatus >= 200 && httpStatus < 300) {
    let data: any;
    try {
      data = await stripeRes.json();
    } catch (jsonErr: any) {
      const errorMsg = `Stripe returned 2xx (${httpStatus}) but body was malformed JSON: ${jsonErr.message}`;
      const backoffSec = calculateBackoffSeconds(attemptNumber);
      await db.batch([
        db.prepare(`UPDATE commerce_reversal_attempts SET outcome='ambiguous', http_status=?, error_code='malformed_json', error_message=?, completed_at=datetime('now') WHERE id=?`)
          .bind(httpStatus, errorMsg, attemptId),
        db.prepare(`UPDATE commerce_reversal_outbox SET status='retryable_failure', last_http_status=?, last_error=?, next_attempt_at=datetime('now','+' || ? || ' seconds'), claim_token=NULL, lease_expires_at=NULL WHERE id=? AND claim_token=?`)
          .bind(httpStatus, errorMsg, backoffSec, reversalOutboxId, claimToken)
      ]);
      return { success: false, ambiguous: true, retryable: true, reversalOutboxId, httpStatus, error: errorMsg };
    }

    const reversalId = data?.id;
    if (!reversalId || typeof reversalId !== 'string' || !/^trr_[A-Za-z0-9_]+$/.test(reversalId)) {
      const errorMsg = `Stripe returned 2xx (${httpStatus}) but missing valid reversal ID (trr_...)`;
      const backoffSec = calculateBackoffSeconds(attemptNumber);
      await db.batch([
        db.prepare(`UPDATE commerce_reversal_attempts SET outcome='ambiguous', http_status=?, error_code='missing_reversal_id', error_message=?, completed_at=datetime('now') WHERE id=?`)
          .bind(httpStatus, errorMsg, attemptId),
        db.prepare(`UPDATE commerce_reversal_outbox SET status='retryable_failure', last_http_status=?, last_error=?, next_attempt_at=datetime('now','+' || ? || ' seconds'), claim_token=NULL, lease_expires_at=NULL WHERE id=? AND claim_token=?`)
          .bind(httpStatus, errorMsg, backoffSec, reversalOutboxId, claimToken)
      ]);
      return { success: false, ambiguous: true, retryable: true, reversalOutboxId, httpStatus, error: errorMsg };
    }

    const matches = Number(data.amount) === reversal.amount_cents
      && String(data.currency || '').toLowerCase() === String(reversal.currency).toLowerCase()
      && data.transfer === originalTransfer.stripe_transfer_id;
    if (!matches) {
      const errorMsg = `Stripe returned reversal '${reversalId}' with economics that do not match the durable outbox request; manual reconciliation required`;
      await db.batch([
        db.prepare(`UPDATE commerce_reversal_attempts SET outcome='ambiguous', http_status=?, stripe_reversal_id=?, error_code='response_mismatch', error_message=?, completed_at=datetime('now') WHERE id=?`)
          .bind(httpStatus, reversalId, errorMsg, attemptId),
        db.prepare(`UPDATE commerce_reversal_outbox SET status='terminal_failure', last_http_status=?, last_error=?, completed_at=datetime('now'), claim_token=NULL, lease_expires_at=NULL WHERE id=? AND claim_token=?`)
          .bind(httpStatus, errorMsg, reversalOutboxId, claimToken)
      ]);
      return { success: false, terminal: true, ambiguous: true, reversalOutboxId, httpStatus, stripeReversalId: reversalId, error: errorMsg };
    }

    const obligation: any = await db.prepare(`
      SELECT id FROM commerce_recovery_obligations WHERE reversal_outbox_id = ?
    `).bind(reversalOutboxId).first();

    const successStatements = [
      db.prepare(`
        UPDATE commerce_reversal_outbox
        SET status='succeeded', stripe_reversal_id=?, last_http_status=?, last_error=NULL,
            completed_at=datetime('now'), claim_token=NULL, lease_expires_at=NULL
        WHERE id=? AND claim_token=?
      `).bind(reversalId, httpStatus, reversalOutboxId, claimToken),
      db.prepare(`
        UPDATE commerce_reversal_attempts SET outcome='succeeded', http_status=?, stripe_reversal_id=?, error_code=NULL, error_message=NULL, completed_at=datetime('now') WHERE id=?
      `).bind(httpStatus, reversalId, attemptId)
    ];

    if (obligation?.id) {
      successStatements.push(
        db.prepare(`
          UPDATE commerce_recovery_obligations SET status='recovered', resolved_at=datetime('now') WHERE id=? AND status='reversal_queued'
        `).bind(obligation.id)
      );
      successStatements.push(
        db.prepare(`
          INSERT INTO commerce_order_events (id, order_id, event_type, source, source_event_id, details_json, created_at)
          SELECT ?, order_id, 'recovery_reversal_succeeded', 'worker', ?, ?, datetime('now')
          FROM commerce_recovery_obligations WHERE id = ?
        `).bind(`coe_${crypto.randomUUID().replace(/-/g, '')}`, `${attemptId}_recovered`, JSON.stringify({ reversalOutboxId, stripeReversalId: reversalId, amountCents: reversal.amount_cents }), obligation.id)
      );
    }

    try {
      await db.batch(successStatements);
    } catch (batchErr: any) {
      try {
        await db.prepare(`
          UPDATE commerce_reversal_outbox
          SET status='retryable_failure', last_http_status=?, last_error=?, next_attempt_at=datetime('now','+30 seconds'), claim_token=NULL, lease_expires_at=NULL
          WHERE id=? AND claim_token=?
        `).bind(httpStatus, `D1 batch write failure after Stripe 2xx: ${batchErr.message}`, reversalOutboxId, claimToken).run();
      } catch {}
      return { success: false, ambiguous: true, retryable: true, reversalOutboxId, httpStatus, error: `D1 write failed after Stripe reversal creation: ${batchErr.message}` };
    }

    return { success: true, status: 'succeeded', reversalOutboxId, stripeReversalId: reversalId, httpStatus };
  }

  if (httpStatus === 429 || httpStatus >= 500) {
    const errData: any = await stripeRes.json().catch(() => ({}));
    const errObj = errData?.error || {};
    const errorCode = errObj.code || errObj.type || `http_${httpStatus}`;
    const errorMessage = errObj.message || `Stripe API returned retryable HTTP ${httpStatus}`;
    const backoffSec = calculateBackoffSeconds(attemptNumber);
    await db.batch([
      db.prepare(`UPDATE commerce_reversal_attempts SET outcome='retryable_failure', http_status=?, error_code=?, error_message=?, completed_at=datetime('now') WHERE id=?`)
        .bind(httpStatus, errorCode, errorMessage, attemptId),
      db.prepare(`UPDATE commerce_reversal_outbox SET status='retryable_failure', last_http_status=?, last_error=?, next_attempt_at=datetime('now','+' || ? || ' seconds'), claim_token=NULL, lease_expires_at=NULL WHERE id=? AND claim_token=?`)
        .bind(httpStatus, errorMessage, backoffSec, reversalOutboxId, claimToken)
    ]);
    return { success: false, retryable: true, reversalOutboxId, httpStatus, error: errorMessage };
  }

  const errData: any = await stripeRes.json().catch(() => ({}));
  const errObj = errData?.error || {};
  const errorCode = errObj.code || errObj.type || `http_${httpStatus}`;
  const errorMessage = errObj.message || `Stripe API returned terminal HTTP ${httpStatus}`;
  await db.batch([
    db.prepare(`UPDATE commerce_reversal_attempts SET outcome='terminal_failure', http_status=?, error_code=?, error_message=?, completed_at=datetime('now') WHERE id=?`)
      .bind(httpStatus, errorCode, errorMessage, attemptId),
    db.prepare(`UPDATE commerce_reversal_outbox SET status='terminal_failure', last_http_status=?, last_error=?, completed_at=datetime('now'), claim_token=NULL, lease_expires_at=NULL WHERE id=? AND claim_token=?`)
      .bind(httpStatus, errorMessage, reversalOutboxId, claimToken)
  ]);
  return { success: false, terminal: true, reversalOutboxId, httpStatus, error: errorMessage };
}

export interface ProcessRecoveryBatchResult {
  success: boolean;
  enqueuedCount: number;
  processedCount: number;
  succeededCount: number;
  retryableCount: number;
  terminalCount: number;
  ambiguousCount: number;
  skippedCount: number;
  results: (EnqueueReversalResult | ProcessReversalResult)[];
}

/**
 * Executes one bounded recovery drain pass:
 * 1. Promotes up to `limit` pending obligations whose original transfer has
 *    succeeded into queued reversal outbox rows.
 * 2. Executes up to `limit` due reversal outbox rows against Stripe.
 * Gated on PAYOUTS_ENABLED via validatePayoutWorkerConfig, same as
 * processTransferBatch — a clean no-op when payouts are off.
 */
export async function processRecoveryBatch(
  db: any,
  env: any,
  options?: { limit?: number; leaseDurationSeconds?: number; stripeFetchOverride?: typeof fetch }
): Promise<ProcessRecoveryBatchResult> {
  const configCheck = validatePayoutWorkerConfig(env);
  if (!configCheck.valid) {
    return {
      success: false, enqueuedCount: 0, processedCount: 0, succeededCount: 0,
      retryableCount: 0, terminalCount: 0, ambiguousCount: 0, skippedCount: 0,
      results: [{ success: false, error: configCheck.error || 'Payout worker configuration invalid' } as any]
    };
  }

  const limit = Math.max(1, Math.min(25, options?.limit ?? 10));
  const results: (EnqueueReversalResult | ProcessReversalResult)[] = [];
  let enqueuedCount = 0;

  // Phase 1: promote pending obligations whose original transfer has succeeded.
  const pendingObligations: any = await db.prepare(`
    SELECT id FROM commerce_recovery_obligations
    WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?
  `).bind(limit).all();

  for (const row of (pendingObligations.results || []) as any[]) {
    const res = await enqueueReversalForObligation(db, row.id);
    results.push(res);
    if (res.success && !res.skipped) enqueuedCount++;
  }

  // Phase 2: execute due reversal outbox rows.
  let succeededCount = 0;
  let retryableCount = 0;
  let terminalCount = 0;
  let ambiguousCount = 0;
  let skippedCount = 0;
  let processedCount = 0;

  for (let i = 0; i < limit; i++) {
    const claimable: any = await db.prepare(`
      SELECT id FROM commerce_reversal_outbox
      WHERE (
        (status IN ('pending', 'retryable_failure') AND next_attempt_at <= datetime('now') AND (lease_expires_at IS NULL OR lease_expires_at <= datetime('now')))
        OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= datetime('now'))
      )
      ORDER BY next_attempt_at ASC, created_at ASC, id ASC
      LIMIT 1
    `).first();

    if (!claimable) break;

    const itemResult = await processReversalOutboxItem(db, env, claimable.id, {
      leaseDurationSeconds: options?.leaseDurationSeconds,
      stripeFetchOverride: options?.stripeFetchOverride
    });
    results.push(itemResult);
    processedCount++;

    if (itemResult.success && itemResult.status === 'succeeded') succeededCount++;
    else if (itemResult.skipped) skippedCount++;
    else if (itemResult.terminal) terminalCount++;
    else if (itemResult.ambiguous) ambiguousCount++;
    else if (itemResult.retryable) retryableCount++;
  }

  return {
    success: true,
    enqueuedCount,
    processedCount,
    succeededCount,
    retryableCount,
    terminalCount,
    ambiguousCount,
    skippedCount,
    results
  };
}
