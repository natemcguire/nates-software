// Stripe Connect Transfer Execution Worker (Commerce P3)
// Implements atomic conditional lease claims, destination Stripe account resolution & snapshotting,
// deterministic attempt recording with canonical SHA-256 request hashing,
// strict HTTP status classification, exponential bounded backoff, 23-hour idempotency cutoff,
// and durable reconciliation.

import { hashPayload } from './stripeInbox';
import {
  CommerceError,
  OutboxTransferStatus
} from './types';

export const STRIPE_IDEMPOTENCY_SAFETY_WINDOW_SECONDS = 23 * 3600; // 82,800 seconds (23 hours)
export const DEFAULT_LEASE_DURATION_SECONDS = 60;
export const DEFAULT_BASE_BACKOFF_SECONDS = 30;
export const MAX_BACKOFF_SECONDS = 3600; // 1 hour cap

export class TransferWorkerError extends CommerceError {
  public statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'TransferWorkerError';
    this.statusCode = statusCode;
  }
}

export type TransferAttemptOutcome =
  | 'started'
  | 'succeeded'
  | 'retryable_failure'
  | 'terminal_failure'
  | 'ambiguous';

export interface ProcessTransferOptions {
  claimToken?: string;
  leaseDurationSeconds?: number;
  stripeFetchOverride?: typeof fetch;
}

export interface ProcessTransferResult {
  success: boolean;
  outboxId?: string;
  orderId?: string;
  allocationId?: string;
  attemptNumber?: number;
  stripeTransferId?: string;
  status?: OutboxTransferStatus;
  skipped?: boolean;
  duplicate?: boolean;
  retryable?: boolean;
  terminal?: boolean;
  ambiguous?: boolean;
  httpStatus?: number | null;
  stripeRequestId?: string | null;
  errorCode?: string | null;
  error?: string;
  reason?: string;
}

export interface ProcessBatchOptions {
  limit?: number;
  leaseDurationSeconds?: number;
  stripeFetchOverride?: typeof fetch;
}

export interface ProcessBatchResult {
  success: boolean;
  processedCount: number;
  succeededCount: number;
  retryableCount: number;
  terminalCount: number;
  ambiguousCount: number;
  skippedCount: number;
  results: ProcessTransferResult[];
}

/**
 * Calculates exponential bounded backoff seconds based on attempt number.
 * Backoff schedule: 30s, 60s, 120s, 240s, 480s, 960s, 1920s, 3600s (capped).
 */
export function calculateBackoffSeconds(
  attemptNumber: number,
  baseSeconds = DEFAULT_BASE_BACKOFF_SECONDS,
  maxSeconds = MAX_BACKOFF_SECONDS
): number {
  if (!Number.isFinite(attemptNumber) || attemptNumber <= 1) {
    return baseSeconds;
  }
  const exponent = Math.min(attemptNumber - 1, 10);
  const calculated = baseSeconds * Math.pow(2, exponent);
  return Math.min(Math.max(calculated, baseSeconds), maxSeconds);
}

/**
 * Validates payout worker runtime configuration.
 * Fails closed before any database claims if configuration is missing or disabled.
 */
export function validatePayoutWorkerConfig(env: any): { valid: boolean; error?: string; statusCode?: number } {
  if (env?.PAYOUTS_ENABLED !== 'true') {
    return {
      valid: false,
      error: 'Payout execution is disabled (PAYOUTS_ENABLED is not true).',
      statusCode: 503
    };
  }

  const stripeSecretKey = env?.STRIPE_SECRET_KEY;
  if (!stripeSecretKey || typeof stripeSecretKey !== 'string' || !stripeSecretKey.trim()) {
    return {
      valid: false,
      error: 'STRIPE_SECRET_KEY must be configured on the server.',
      statusCode: 500
    };
  }

  return { valid: true };
}

/**
 * Builds canonical Stripe /v1/transfers request parameters and URLSearchParams.
 * Deterministic parameter ordering guarantees identical SHA-256 payload across retries.
 */
export function buildStripeTransferPayload(
  outbox: {
    id: string;
    order_id: string;
    allocation_id: string;
    amount_cents: number;
    currency: string;
  },
  destinationStripeAccount: string
): { requestBodyString: string; params: URLSearchParams } {
  const params = new URLSearchParams();
  params.append('amount', String(outbox.amount_cents));
  params.append('currency', outbox.currency.toLowerCase());
  params.append('destination', destinationStripeAccount);
  params.append('transfer_group', outbox.order_id);
  params.append('metadata[orderId]', outbox.order_id);
  params.append('metadata[allocationId]', outbox.allocation_id);
  params.append('metadata[outboxId]', outbox.id);

  return {
    requestBodyString: params.toString(),
    params
  };
}

/**
 * Atomically claims an outbox row with a conditional finite lease.
 * Succeeds ONLY if exactly one row is updated:
 * 1. Status in ('pending', 'retryable_failure') AND next_attempt_at <= now AND (lease_expires_at IS NULL OR lease_expires_at <= now)
 * 2. OR status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= now (expired processing lease).
 */
export async function claimTransferOutboxRow(
  db: any,
  outboxId: string,
  options?: { leaseDurationSeconds?: number; claimToken?: string }
): Promise<{ claimed: boolean; claimToken: string }> {
  if (!db) {
    throw new TransferWorkerError('Database handle is required to claim transfer outbox row');
  }

  const leaseSec = options?.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS;
  const claimToken = options?.claimToken ?? `clm_${crypto.randomUUID().replace(/-/g, '')}`;

  const res = await db.prepare(`
    UPDATE commerce_transfer_outbox
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
  `).bind(claimToken, leaseSec, outboxId).run();

  const changes = res?.meta?.changes ?? 0;
  return {
    claimed: changes === 1,
    claimToken
  };
}

/**
 * Releases an outbox claim lease after a transient failure and marks the item retryable with backoff.
 */
export async function releaseTransferClaim(
  db: any,
  outboxId: string,
  claimToken: string,
  errorMsg: string,
  backoffSeconds = DEFAULT_BASE_BACKOFF_SECONDS,
  httpStatus: number | null = null,
  stripeRequestId: string | null = null
): Promise<void> {
  await db.prepare(`
    UPDATE commerce_transfer_outbox
    SET status = 'retryable_failure',
        last_error = ?,
        last_http_status = ?,
        last_stripe_request_id = ?,
        next_attempt_at = datetime('now', '+' || ? || ' seconds'),
        claim_token = NULL,
        lease_expires_at = NULL
    WHERE id = ? AND claim_token = ?
  `).bind(errorMsg, httpStatus, stripeRequestId, backoffSeconds, outboxId, claimToken).run();
}

/**
 * Durably marks a transfer outbox row as terminal failure.
 */
export async function markTransferTerminalFailure(
  db: any,
  outboxId: string,
  claimToken: string | null | undefined,
  errorMsg: string,
  httpStatus: number | null = null,
  stripeRequestId: string | null = null
): Promise<void> {
  if (claimToken) {
    await db.prepare(`
      UPDATE commerce_transfer_outbox
      SET status = 'terminal_failure',
          last_error = ?,
          last_http_status = ?,
          last_stripe_request_id = ?,
          completed_at = datetime('now'),
          claim_token = NULL,
          lease_expires_at = NULL
      WHERE id = ? AND claim_token = ?
    `).bind(errorMsg, httpStatus, stripeRequestId, outboxId, claimToken).run();
  } else {
    await db.prepare(`
      UPDATE commerce_transfer_outbox
      SET status = 'terminal_failure',
          last_error = ?,
          last_http_status = ?,
          last_stripe_request_id = ?,
          completed_at = datetime('now'),
          claim_token = NULL,
          lease_expires_at = NULL
      WHERE id = ?
    `).bind(errorMsg, httpStatus, stripeRequestId, outboxId).run();
  }
}

/**
 * Executes transfer workflow for a single outbox item.
 *
 * Steps:
 * 1. Validate environment configuration (fail closed if PAYOUTS_ENABLED !== 'true').
 * 2. Claim item with finite conditional lease.
 * 3. Enforce 23-hour idempotency cutoff on prior ambiguous attempts (parks terminal).
 * 4. Resolve destination user's Stripe Connect account (requires payouts_enabled=1 and valid acct_ ID).
 * 5. Atomically snapshot destination_stripe_account if null (immutable thereafter).
 * 6. Enforce stripe_idempotency_key === 'transfer:' + outbox.id (never generate retry identity).
 * 7. Persist started commerce_transfer_attempt with canonical request SHA-256 before HTTP call.
 * 8. Execute POST /v1/transfers to Stripe.
 * 9. Process HTTP response:
 *    - 2xx: require valid tr_ ID, atomically mark attempt+outbox succeeded under claim token.
 *    - 429/5xx: record retryable_failure with exponential bounded backoff, release lease.
 *    - other 4xx: record terminal_failure, mark outbox terminal, release lease.
 *    - Network exception: record ambiguous attempt, release outbox as retryable_failure with backoff.
 * 10. If D1 persistence fails after Stripe 2xx success, leave retryable/ambiguous for idempotency reconciliation.
 */
export async function processTransferOutboxItem(
  db: any,
  env: any,
  outboxId: string,
  options?: ProcessTransferOptions
): Promise<ProcessTransferResult> {
  if (!db) {
    return { success: false, outboxId, error: 'Database service is unavailable' };
  }

  // 1. Mandatory Fail-Closed Configuration Guard
  const configCheck = validatePayoutWorkerConfig(env);
  if (!configCheck.valid) {
    return {
      success: false,
      outboxId,
      error: configCheck.error || 'Payout worker configuration invalid'
    };
  }

  // 2. Claim outbox row with conditional finite lease
  let claimToken = options?.claimToken;
  if (!claimToken) {
    const claimRes = await claimTransferOutboxRow(db, outboxId, {
      leaseDurationSeconds: options?.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS
    });

    if (!claimRes.claimed) {
      const existing: any = await db.prepare(`
        SELECT id, status, stripe_transfer_id, last_error
        FROM commerce_transfer_outbox
        WHERE id = ?
      `).bind(outboxId).first();

      if (existing?.status === 'succeeded') {
        return {
          success: true,
          duplicate: true,
          outboxId,
          status: 'succeeded',
          stripeTransferId: existing.stripe_transfer_id
        };
      }

      if (existing?.status === 'terminal_failure') {
        return {
          success: false,
          terminal: true,
          outboxId,
          error: existing.last_error || 'Transfer previously marked terminal failure'
        };
      }

      return {
        success: false,
        skipped: true,
        outboxId,
        reason: `Transfer outbox row '${outboxId}' is not available for claiming (active lease held or not due)`
      };
    }
    claimToken = claimRes.claimToken;
  }

  // 3. Load Outbox Record
  const outbox: any = await db.prepare(`
    SELECT id, order_id, allocation_id, destination_user_id,
           amount_cents, currency, status, attempt_count,
           available_at, next_attempt_at, lease_expires_at,
           stripe_idempotency_key, destination_stripe_account,
           last_http_status, last_stripe_request_id, last_error,
           created_at
    FROM commerce_transfer_outbox
    WHERE id = ?
  `).bind(outboxId).first();

  if (!outbox) {
    return { success: false, outboxId, error: `Transfer outbox row '${outboxId}' not found in D1` };
  }

  if (outbox.status === 'succeeded') {
    return {
      success: true,
      duplicate: true,
      outboxId,
      status: 'succeeded',
      stripeTransferId: outbox.stripe_transfer_id
    };
  }

  // 4. Check 23-Hour Idempotency Safety Window on Prior Ambiguous Attempts
  const priorAmbiguous: any = await db.prepare(`
    SELECT id, attempt_number, outcome, started_at,
           (strftime('%s', 'now') - strftime('%s', started_at)) AS elapsed_seconds
    FROM commerce_transfer_attempts
    WHERE outbox_id = ? AND outcome IN ('ambiguous', 'started')
    ORDER BY started_at ASC, attempt_number ASC
    LIMIT 1
  `).bind(outboxId).first();

  if (priorAmbiguous && priorAmbiguous.elapsed_seconds > STRIPE_IDEMPOTENCY_SAFETY_WINDOW_SECONDS) {
    const errorMsg = `Ambiguous transfer attempt exceeded 23-hour safe idempotency window (${priorAmbiguous.elapsed_seconds}s > ${STRIPE_IDEMPOTENCY_SAFETY_WINDOW_SECONDS}s); manual reconciliation required`;
    await markTransferTerminalFailure(db, outboxId, claimToken, errorMsg);

    try {
      await db.prepare(`
        INSERT INTO commerce_order_events (
          id, order_id, event_type, source, source_event_id, details_json, created_at
        ) VALUES (?, ?, 'transfer_parked_terminal', 'worker', ?, ?, datetime('now'))
      `).bind(
        `coe_${crypto.randomUUID().replace(/-/g, '')}`,
        outbox.order_id,
        `parked_${outboxId}_${Date.now()}`,
        JSON.stringify({
          outboxId,
          reason: errorMsg,
          elapsedSeconds: priorAmbiguous.elapsed_seconds
        })
      ).run();
    } catch {}

    return {
      success: false,
      terminal: true,
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      error: errorMsg
    };
  }

  // 5. Destination User Validation
  const destinationUserId = outbox.destination_user_id;
  if (!destinationUserId || typeof destinationUserId !== 'string' || !destinationUserId.trim()) {
    const errorMsg = `Transfer outbox row '${outboxId}' has no valid destination_user_id (protocol pool transfers not supported)`;
    await markTransferTerminalFailure(db, outboxId, claimToken, errorMsg);
    return {
      success: false,
      terminal: true,
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      error: errorMsg
    };
  }

  // 6. Resolve Destination User's Stripe Account
  const stripeAccount: any = await db.prepare(`
    SELECT user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_status
    FROM stripe_accounts
    WHERE user_id = ?
  `).bind(destinationUserId.trim()).first();

  if (!stripeAccount) {
    const backoffSec = calculateBackoffSeconds(outbox.attempt_count);
    const errorMsg = `Destination user '${destinationUserId}' does not have a Stripe Connect account record in stripe_accounts`;
    await releaseTransferClaim(db, outboxId, claimToken, errorMsg, backoffSec);
    return {
      success: false,
      retryable: true,
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      error: errorMsg
    };
  }

  const isPayoutsEnabled = Boolean(stripeAccount.payouts_enabled === 1 || stripeAccount.payouts_enabled === true);
  if (!isPayoutsEnabled) {
    const backoffSec = calculateBackoffSeconds(outbox.attempt_count);
    const errorMsg = `Destination user '${destinationUserId}' Stripe Connect account '${stripeAccount.stripe_account_id}' has payouts disabled (payouts_enabled != 1)`;
    await releaseTransferClaim(db, outboxId, claimToken, errorMsg, backoffSec);
    return {
      success: false,
      retryable: true,
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      error: errorMsg
    };
  }

  const resolvedAccountId = stripeAccount.stripe_account_id;
  if (!resolvedAccountId || typeof resolvedAccountId !== 'string' || !/^acct_[A-Za-z0-9_]+$/.test(resolvedAccountId)) {
    const backoffSec = calculateBackoffSeconds(outbox.attempt_count);
    const errorMsg = `Destination user '${destinationUserId}' has invalid Stripe account ID format '${resolvedAccountId}' (must start with acct_)`;
    await releaseTransferClaim(db, outboxId, claimToken, errorMsg, backoffSec);
    return {
      success: false,
      retryable: true,
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      error: errorMsg
    };
  }

  // 7. Atomically Snapshot destination_stripe_account if null (never change once snapshotted)
  let targetStripeAccount = outbox.destination_stripe_account;
  if (!targetStripeAccount) {
    try {
      const snapshotResult = await db.prepare(`
        UPDATE commerce_transfer_outbox
        SET destination_stripe_account = ?
        WHERE id = ? AND claim_token = ? AND destination_stripe_account IS NULL
      `).bind(resolvedAccountId, outboxId, claimToken).run();
      if ((snapshotResult?.meta?.changes ?? 0) !== 1) {
        throw new Error('destination snapshot claim was lost');
      }
    } catch (snapErr: any) {
      const errorMsg = `Could not durably snapshot payout destination: ${snapErr.message}`;
      await releaseTransferClaim(db, outboxId, claimToken, errorMsg, 30);
      return { success: false, retryable: true, outboxId, orderId: outbox.order_id, allocationId: outbox.allocation_id, error: errorMsg };
    }
    targetStripeAccount = resolvedAccountId;
  }

  // 8. Require Persisted stripe_idempotency_key exactly transfer:<outbox-id>
  const expectedIdempotencyKey = `transfer:${outboxId}`;
  let persistedKey = outbox.stripe_idempotency_key;

  if (persistedKey && persistedKey !== expectedIdempotencyKey) {
    const errorMsg = `Stripe idempotency key mismatch for outbox '${outboxId}': expected '${expectedIdempotencyKey}', found '${persistedKey}'`;
    await markTransferTerminalFailure(db, outboxId, claimToken, errorMsg);
    return {
      success: false,
      terminal: true,
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      error: errorMsg
    };
  }

  if (!persistedKey) {
    try {
      const keyResult = await db.prepare(`
        UPDATE commerce_transfer_outbox
        SET stripe_idempotency_key = ?
        WHERE id = ? AND claim_token = ? AND stripe_idempotency_key IS NULL
      `).bind(expectedIdempotencyKey, outboxId, claimToken).run();
      if ((keyResult?.meta?.changes ?? 0) !== 1) {
        throw new Error('idempotency snapshot claim was lost');
      }
      persistedKey = expectedIdempotencyKey;
    } catch (keyErr: any) {
      const errorMsg = `Could not durably persist Stripe idempotency identity: ${keyErr.message}`;
      await releaseTransferClaim(db, outboxId, claimToken, errorMsg, 30);
      return { success: false, retryable: true, outboxId, orderId: outbox.order_id, allocationId: outbox.allocation_id, error: errorMsg };
    }
  }

  // 9. Build Canonical Stripe Request & SHA-256 Hash
  const { requestBodyString } = buildStripeTransferPayload(outbox, targetStripeAccount);
  const requestSha256 = await hashPayload(requestBodyString);

  // 10. Persist Started Attempt Record Before External Call
  const attemptSequence: any = await db.prepare(`
    SELECT COALESCE(MAX(attempt_number), 0) AS max_attempt_number
    FROM commerce_transfer_attempts WHERE outbox_id = ?
  `).bind(outboxId).first();
  const attemptNumber = Math.max(
    outbox.attempt_count > 0 ? outbox.attempt_count : 1,
    Number(attemptSequence?.max_attempt_number || 0) + 1
  );
  const attemptId = `cta_${crypto.randomUUID().replace(/-/g, '')}`;

  try {
    await db.prepare(`
      INSERT INTO commerce_transfer_attempts (
        id, outbox_id, attempt_number, stripe_idempotency_key,
        request_sha256, outcome, started_at
      ) VALUES (?, ?, ?, ?, ?, 'started', datetime('now'))
    `).bind(
      attemptId,
      outboxId,
      attemptNumber,
      expectedIdempotencyKey,
      requestSha256
    ).run();
  } catch (attemptInsertErr: any) {
    const backoffSec = calculateBackoffSeconds(attemptNumber);
    const errorMsg = `Failed to record started transfer attempt: ${attemptInsertErr.message}`;
    await releaseTransferClaim(db, outboxId, claimToken, errorMsg, backoffSec);
    return {
      success: false,
      retryable: true,
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      attemptNumber,
      error: errorMsg
    };
  }

  // 11. External POST /v1/transfers Call to Stripe
  const fetchImpl = options?.stripeFetchOverride || globalThis.fetch;
  let stripeRes: Response;

  try {
    stripeRes = await fetchImpl('https://api.stripe.com/v1/transfers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Idempotency-Key': expectedIdempotencyKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: requestBodyString
    });
  } catch (networkErr: any) {
    // Network Exceptions are AMBIGUOUS
    const errorMsg = `Network exception during Stripe transfer request: ${networkErr.message}`;
    const backoffSec = calculateBackoffSeconds(attemptNumber);

    try {
      await db.batch([
        db.prepare(`
          UPDATE commerce_transfer_attempts
          SET outcome = 'ambiguous',
              error_code = 'network_error',
              error_message = ?,
              completed_at = datetime('now')
          WHERE id = ?
        `).bind(errorMsg, attemptId),
        db.prepare(`
          UPDATE commerce_transfer_outbox
          SET status = 'retryable_failure',
              last_error = ?,
              last_http_status = NULL,
              next_attempt_at = datetime('now', '+' || ? || ' seconds'),
              claim_token = NULL,
              lease_expires_at = NULL
          WHERE id = ? AND claim_token = ?
        `).bind(errorMsg, backoffSec, outboxId, claimToken),
        db.prepare(`
          INSERT INTO commerce_order_events (
            id, order_id, event_type, source, source_event_id, details_json, created_at
          ) VALUES (?, ?, 'transfer_ambiguous_failure', 'worker', ?, ?, datetime('now'))
        `).bind(
          `coe_${crypto.randomUUID().replace(/-/g, '')}`,
          outbox.order_id,
          `${attemptId}_ambiguous`,
          JSON.stringify({
            outboxId,
            attemptNumber,
            error: errorMsg
          })
        )
      ]);
    } catch {}

    return {
      success: false,
      ambiguous: true,
      retryable: true,
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      attemptNumber,
      errorCode: 'network_error',
      error: errorMsg
    };
  }

  // 12. Parse HTTP Status and Stripe Headers
  const httpStatus = stripeRes.status;
  const stripeRequestId = stripeRes.headers.get('request-id') || stripeRes.headers.get('stripe-request-id') || null;

  // =========================================================================
  // Case A: 2xx Success (Requires valid tr_ ID)
  // =========================================================================
  if (httpStatus >= 200 && httpStatus < 300) {
    let transferData: any;
    try {
      transferData = await stripeRes.json();
    } catch (jsonErr: any) {
      const errorMsg = `Stripe returned 2xx (${httpStatus}) but body was malformed JSON: ${jsonErr.message}`;
      const backoffSec = calculateBackoffSeconds(attemptNumber);

      await db.batch([
        db.prepare(`
          UPDATE commerce_transfer_attempts
          SET outcome = 'ambiguous',
              http_status = ?,
              stripe_request_id = ?,
              error_code = 'malformed_json',
              error_message = ?,
              completed_at = datetime('now')
          WHERE id = ?
        `).bind(httpStatus, stripeRequestId, errorMsg, attemptId),
        db.prepare(`
          UPDATE commerce_transfer_outbox
          SET status = 'retryable_failure',
              last_http_status = ?,
              last_stripe_request_id = ?,
              last_error = ?,
              next_attempt_at = datetime('now', '+' || ? || ' seconds'),
              claim_token = NULL,
              lease_expires_at = NULL
          WHERE id = ? AND claim_token = ?
        `).bind(httpStatus, stripeRequestId, errorMsg, backoffSec, outboxId, claimToken)
      ]);

      return {
        success: false,
        ambiguous: true,
        retryable: true,
        outboxId,
        orderId: outbox.order_id,
        allocationId: outbox.allocation_id,
        attemptNumber,
        httpStatus,
        stripeRequestId,
        error: errorMsg
      };
    }

    const transferId = transferData?.id;
    if (!transferId || typeof transferId !== 'string' || !/^tr_[A-Za-z0-9_]+$/.test(transferId)) {
      const errorMsg = `Stripe returned 2xx (${httpStatus}) but missing valid transfer ID (tr_...): ${JSON.stringify(transferId)}`;
      const backoffSec = calculateBackoffSeconds(attemptNumber);

      await db.batch([
        db.prepare(`
          UPDATE commerce_transfer_attempts
          SET outcome = 'ambiguous',
              http_status = ?,
              stripe_request_id = ?,
              error_code = 'missing_transfer_id',
              error_message = ?,
              completed_at = datetime('now')
          WHERE id = ?
        `).bind(httpStatus, stripeRequestId, errorMsg, attemptId),
        db.prepare(`
          UPDATE commerce_transfer_outbox
          SET status = 'retryable_failure',
              last_http_status = ?,
              last_stripe_request_id = ?,
              last_error = ?,
              next_attempt_at = datetime('now', '+' || ? || ' seconds'),
              claim_token = NULL,
              lease_expires_at = NULL
          WHERE id = ? AND claim_token = ?
        `).bind(httpStatus, stripeRequestId, errorMsg, backoffSec, outboxId, claimToken)
      ]);

      return {
        success: false,
        ambiguous: true,
        retryable: true,
        outboxId,
        orderId: outbox.order_id,
        allocationId: outbox.allocation_id,
        attemptNumber,
        httpStatus,
        stripeRequestId,
        error: errorMsg
      };
    }

    const responseMatchesRequest =
      Number(transferData.amount) === outbox.amount_cents &&
      String(transferData.currency || '').toLowerCase() === String(outbox.currency).toLowerCase() &&
      transferData.destination === targetStripeAccount &&
      transferData.transfer_group === outbox.order_id &&
      transferData.metadata?.orderId === outbox.order_id &&
      transferData.metadata?.allocationId === outbox.allocation_id &&
      transferData.metadata?.outboxId === outbox.id;
    if (!responseMatchesRequest) {
      const errorMsg = `Stripe returned transfer '${transferId}' with economics or metadata that do not match the durable outbox request; manual reconciliation required`;
      await db.batch([
        db.prepare(`
          UPDATE commerce_transfer_attempts
          SET outcome = 'ambiguous', http_status = ?, stripe_request_id = ?,
              stripe_transfer_id = ?, error_code = 'response_mismatch', error_message = ?,
              completed_at = datetime('now')
          WHERE id = ?
        `).bind(httpStatus, stripeRequestId, transferId, errorMsg, attemptId),
        db.prepare(`
          UPDATE commerce_transfer_outbox
          SET status = 'terminal_failure', last_http_status = ?, last_stripe_request_id = ?,
              last_error = ?, completed_at = datetime('now'), claim_token = NULL,
              lease_expires_at = NULL
          WHERE id = ? AND claim_token = ?
        `).bind(httpStatus, stripeRequestId, errorMsg, outboxId, claimToken)
      ]);
      return {
        success: false, terminal: true, ambiguous: true, outboxId,
        orderId: outbox.order_id, allocationId: outbox.allocation_id,
        attemptNumber, httpStatus, stripeRequestId, stripeTransferId: transferId,
        errorCode: 'response_mismatch', error: errorMsg
      };
    }

    // Atomically persist success under claim token
    const successStatements = [
      db.prepare(`
        UPDATE commerce_transfer_outbox
        SET status = 'succeeded',
            stripe_transfer_id = ?,
            last_http_status = ?,
            last_stripe_request_id = ?,
            last_error = NULL,
            completed_at = datetime('now'),
            claim_token = NULL,
            lease_expires_at = NULL
        WHERE id = ? AND claim_token = ?
      `).bind(transferId, httpStatus, stripeRequestId, outboxId, claimToken),
      db.prepare(`
        UPDATE commerce_transfer_attempts
        SET outcome = 'succeeded',
            http_status = ?,
            stripe_request_id = ?,
            stripe_transfer_id = ?,
            error_code = NULL,
            error_message = NULL,
            completed_at = datetime('now')
        WHERE id = ?
      `).bind(httpStatus, stripeRequestId, transferId, attemptId),
      db.prepare(`
        INSERT INTO commerce_order_events (
          id, order_id, event_type, source, source_event_id, details_json, created_at
        ) VALUES (?, ?, 'transfer_succeeded', 'worker', ?, ?, datetime('now'))
      `).bind(
        `coe_${crypto.randomUUID().replace(/-/g, '')}`,
        outbox.order_id,
        `${attemptId}_succeeded`,
        JSON.stringify({
          outboxId,
          allocationId: outbox.allocation_id,
          destinationUserId: outbox.destination_user_id,
          destinationStripeAccount: targetStripeAccount,
          amountCents: outbox.amount_cents,
          currency: outbox.currency,
          stripeTransferId: transferId,
          attemptNumber
        })
      )
    ];

    try {
      await db.batch(successStatements);
    } catch (batchErr: any) {
      // D1 Write Failure after Stripe Success: Leave retryable/ambiguous so same idempotency key reconciles
      try {
        await db.prepare(`
          UPDATE commerce_transfer_outbox
          SET status = 'retryable_failure',
              last_http_status = ?,
              last_stripe_request_id = ?,
              last_error = ?,
              next_attempt_at = datetime('now', '+30 seconds'),
              claim_token = NULL,
              lease_expires_at = NULL
          WHERE id = ? AND claim_token = ?
        `).bind(httpStatus, stripeRequestId, `D1 batch write failure after Stripe 2xx: ${batchErr.message}`, outboxId, claimToken).run();
      } catch {}

      return {
        success: false,
        ambiguous: true,
        retryable: true,
        outboxId,
        orderId: outbox.order_id,
        allocationId: outbox.allocation_id,
        attemptNumber,
        httpStatus,
        stripeRequestId,
        error: `D1 write failed after Stripe transfer creation: ${batchErr.message}`
      };
    }

    return {
      success: true,
      status: 'succeeded',
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      attemptNumber,
      stripeTransferId: transferId,
      httpStatus,
      stripeRequestId
    };
  }

  // =========================================================================
  // Case B: 429 & 5xx (Retryable Failures)
  // =========================================================================
  if (httpStatus === 429 || httpStatus >= 500) {
    const errData: any = await stripeRes.json().catch(() => ({}));
    const errObj = errData?.error || {};
    const errorCode = errObj.code || errObj.type || `http_${httpStatus}`;
    const errorMessage = errObj.message || `Stripe API returned retryable HTTP ${httpStatus}`;
    const backoffSec = calculateBackoffSeconds(attemptNumber);

    await db.batch([
      db.prepare(`
        UPDATE commerce_transfer_attempts
        SET outcome = 'retryable_failure',
            http_status = ?,
            stripe_request_id = ?,
            error_code = ?,
            error_message = ?,
            completed_at = datetime('now')
        WHERE id = ?
      `).bind(httpStatus, stripeRequestId, errorCode, errorMessage, attemptId),
      db.prepare(`
        UPDATE commerce_transfer_outbox
        SET status = 'retryable_failure',
            last_http_status = ?,
            last_stripe_request_id = ?,
            last_error = ?,
            next_attempt_at = datetime('now', '+' || ? || ' seconds'),
            claim_token = NULL,
            lease_expires_at = NULL
        WHERE id = ? AND claim_token = ?
      `).bind(httpStatus, stripeRequestId, errorMessage, backoffSec, outboxId, claimToken),
      db.prepare(`
        INSERT INTO commerce_order_events (
          id, order_id, event_type, source, source_event_id, details_json, created_at
        ) VALUES (?, ?, 'transfer_retryable_failure', 'worker', ?, ?, datetime('now'))
      `).bind(
        `coe_${crypto.randomUUID().replace(/-/g, '')}`,
        outbox.order_id,
        `${attemptId}_retryable`,
        JSON.stringify({
          outboxId,
          attemptNumber,
          httpStatus,
          errorCode,
          errorMessage
        })
      )
    ]);

    return {
      success: false,
      retryable: true,
      outboxId,
      orderId: outbox.order_id,
      allocationId: outbox.allocation_id,
      attemptNumber,
      httpStatus,
      stripeRequestId,
      errorCode,
      error: errorMessage
    };
  }

  // =========================================================================
  // Case C: Other 4xx (Terminal Failures: 400, 401, 403, 404, 422)
  // =========================================================================
  const errData: any = await stripeRes.json().catch(() => ({}));
  const errObj = errData?.error || {};
  const errorCode = errObj.code || errObj.type || `http_${httpStatus}`;
  const errorMessage = errObj.message || `Stripe API returned terminal HTTP ${httpStatus}`;

  await db.batch([
    db.prepare(`
      UPDATE commerce_transfer_attempts
      SET outcome = 'terminal_failure',
          http_status = ?,
          stripe_request_id = ?,
          error_code = ?,
          error_message = ?,
          completed_at = datetime('now')
      WHERE id = ?
    `).bind(httpStatus, stripeRequestId, errorCode, errorMessage, attemptId),
    db.prepare(`
      UPDATE commerce_transfer_outbox
      SET status = 'terminal_failure',
          last_http_status = ?,
          last_stripe_request_id = ?,
          last_error = ?,
          completed_at = datetime('now'),
          claim_token = NULL,
          lease_expires_at = NULL
      WHERE id = ? AND claim_token = ?
    `).bind(httpStatus, stripeRequestId, errorMessage, outboxId, claimToken),
    db.prepare(`
      INSERT INTO commerce_order_events (
        id, order_id, event_type, source, source_event_id, details_json, created_at
      ) VALUES (?, ?, 'transfer_terminal_failure', 'worker', ?, ?, datetime('now'))
    `).bind(
      `coe_${crypto.randomUUID().replace(/-/g, '')}`,
      outbox.order_id,
      `${attemptId}_terminal`,
      JSON.stringify({
        outboxId,
        attemptNumber,
        httpStatus,
        errorCode,
        errorMessage
      })
    )
  ]);

  return {
    success: false,
    terminal: true,
    outboxId,
    orderId: outbox.order_id,
    allocationId: outbox.allocation_id,
    attemptNumber,
    httpStatus,
    stripeRequestId,
    errorCode,
    error: errorMessage
  };
}

/**
 * Executes batch transfer execution over bounded 1..25 rows sequentially.
 * Reports honest per-status counts. Never accepts economic overrides from caller.
 */
export async function processTransferBatch(
  db: any,
  env: any,
  options?: ProcessBatchOptions
): Promise<ProcessBatchResult> {
  const configCheck = validatePayoutWorkerConfig(env);
  if (!configCheck.valid) {
    return {
      success: false,
      processedCount: 0,
      succeededCount: 0,
      retryableCount: 0,
      terminalCount: 0,
      ambiguousCount: 0,
      skippedCount: 0,
      results: [
        {
          success: false,
          error: configCheck.error || 'Payout execution configuration invalid'
        }
      ]
    };
  }

  const limit = Math.max(1, Math.min(25, options?.limit ?? 10));
  const results: ProcessTransferResult[] = [];

  let succeededCount = 0;
  let retryableCount = 0;
  let terminalCount = 0;
  let ambiguousCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < limit; i++) {
    // Select next due claimable row
    const claimable: any = await db.prepare(`
      SELECT id FROM commerce_transfer_outbox
      WHERE (
        (status IN ('pending', 'retryable_failure') AND next_attempt_at <= datetime('now') AND (lease_expires_at IS NULL OR lease_expires_at <= datetime('now')))
        OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= datetime('now'))
      )
      ORDER BY next_attempt_at ASC, created_at ASC, id ASC
      LIMIT 1
    `).first();

    if (!claimable) {
      break; // No more due rows
    }

    const itemResult = await processTransferOutboxItem(db, env, claimable.id, {
      leaseDurationSeconds: options?.leaseDurationSeconds,
      stripeFetchOverride: options?.stripeFetchOverride
    });

    results.push(itemResult);

    if (itemResult.success && itemResult.status === 'succeeded') {
      succeededCount++;
    } else if (itemResult.skipped) {
      skippedCount++;
    } else if (itemResult.terminal) {
      terminalCount++;
    } else if (itemResult.ambiguous) {
      ambiguousCount++;
    } else if (itemResult.retryable) {
      retryableCount++;
    }
  }

  return {
    success: true,
    processedCount: results.length,
    succeededCount,
    retryableCount,
    terminalCount,
    ambiguousCount,
    skippedCount,
    results
  };
}
