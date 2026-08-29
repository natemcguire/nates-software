// Durable Stripe Event Inbox Repository
// Implements idempotent event persistence, SHA-256 payload collision detection,
// and finite conditional lease claims.

import { InboxCollisionError } from './types';

/**
 * Computes SHA-256 hex digest for raw event payload string.
 */
export async function hashPayload(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const digestBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(payload));
  return Array.from(new Uint8Array(digestBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface RecordInboxEventParams {
  eventId: string;
  eventType: string;
  apiVersion?: string | null;
  livemode: boolean | number;
  payloadJson: string;
  payloadSha256: string;
  stripeObjectId?: string | null;
}

export interface RecordInboxEventResult {
  status: 'recorded' | 'duplicate';
  eventId: string;
  existingStatus?: string;
}

/**
 * Persists a verified Stripe event into `stripe_event_inbox` idempotently.
 *
 * Invariants:
 * 1. If event is brand new -> stored with status 'received'.
 * 2. If identical event ID with identical payload hash already exists -> returns duplicate accepted.
 * 3. If event ID exists with DIFFERENT payload hash -> throws 409 InboxCollisionError (security breach attempt).
 * 4. Safe against racing inserts via unique constraint recovery.
 */
export async function recordInboxEvent(
  db: any,
  params: RecordInboxEventParams
): Promise<RecordInboxEventResult> {
  if (!db) {
    throw new Error('Database handle is required to record inbox event');
  }

  const {
    eventId,
    eventType,
    apiVersion = null,
    livemode,
    payloadJson,
    payloadSha256,
    stripeObjectId = null
  } = params;

  // 1. Check for existing event record
  const existing: any = await db.prepare(`
    SELECT event_id, payload_sha256, status
    FROM stripe_event_inbox
    WHERE event_id = ?
  `).bind(eventId).first();

  if (existing) {
    if (existing.payload_sha256 !== payloadSha256) {
      throw new InboxCollisionError(
        `Event ID collision detected for '${eventId}': existing SHA-256 (${existing.payload_sha256}) differs from incoming SHA-256 (${payloadSha256})`
      );
    }
    return {
      status: 'duplicate',
      eventId,
      existingStatus: existing.status
    };
  }

  // 2. Insert new event into inbox
  try {
    const livemodeInt = livemode ? 1 : 0;
    await db.prepare(`
      INSERT INTO stripe_event_inbox (
        event_id, event_type, api_version, livemode,
        payload_json, payload_sha256, signature_verified,
        status, attempt_count, stripe_object_id,
        received_at, next_attempt_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'received', 0, ?, datetime('now'), datetime('now'))
    `).bind(
      eventId,
      eventType,
      apiVersion,
      livemodeInt,
      payloadJson,
      payloadSha256,
      stripeObjectId
    ).run();

    return { status: 'recorded', eventId };
  } catch (insertErr: any) {
    // Check if a concurrent request inserted the row during the race
    const raceRow: any = await db.prepare(`
      SELECT event_id, payload_sha256, status
      FROM stripe_event_inbox
      WHERE event_id = ?
    `).bind(eventId).first();

    if (raceRow) {
      if (raceRow.payload_sha256 !== payloadSha256) {
        throw new InboxCollisionError(
          `Event ID collision detected on race for '${eventId}': differing payload SHA-256`
        );
      }
      return {
        status: 'duplicate',
        eventId,
        existingStatus: raceRow.status
      };
    }

    throw insertErr;
  }
}

/**
 * Claims an inbox event with a conditional finite lease.
 *
 * A claim succeeds ONLY if:
 * 1. Status is 'received' or 'retryable_failure', OR
 * 2. Status is 'processing' but the previous claim lease has expired.
 */
export async function claimInboxEvent(
  db: any,
  eventId: string,
  options?: { leaseDurationSeconds?: number; claimToken?: string }
): Promise<{ claimed: boolean; claimToken: string }> {
  const leaseSec = options?.leaseDurationSeconds ?? 60;
  const claimToken = options?.claimToken ?? `clm_${crypto.randomUUID().replace(/-/g, '')}`;

  const res = await db.prepare(`
    UPDATE stripe_event_inbox
    SET status = 'processing',
        claim_token = ?,
        claimed_at = datetime('now'),
        expires_at = datetime('now', '+' || ? || ' seconds'),
        attempt_count = attempt_count + 1
    WHERE event_id = ?
      AND (
        status IN ('received', 'retryable_failure')
        OR (status = 'processing' AND (expires_at IS NULL OR expires_at < datetime('now')))
      )
  `).bind(claimToken, leaseSec, eventId).run();

  const changes = res?.meta?.changes ?? 0;
  return {
    claimed: changes > 0,
    claimToken
  };
}

/**
 * Releases a claim lease after a transient failure and marks the event retryable.
 */
export async function releaseInboxClaim(
  db: any,
  eventId: string,
  claimToken: string,
  errorMsg: string,
  backoffSeconds = 60
): Promise<void> {
  await db.prepare(`
    UPDATE stripe_event_inbox
    SET status = 'retryable_failure',
        last_error = ?,
        next_attempt_at = datetime('now', '+' || ? || ' seconds'),
        claim_token = NULL,
        expires_at = NULL
    WHERE event_id = ? AND claim_token = ?
  `).bind(errorMsg, backoffSeconds, eventId, claimToken).run();
}

/**
 * Durably marks an inbox event as terminal failure (e.g. invalid signature, unsupported event, tamper).
 */
export async function markInboxTerminalFailure(
  db: any,
  eventId: string,
  claimToken: string | null | undefined,
  errorMsg: string
): Promise<void> {
  if (claimToken) {
    await db.prepare(`
      UPDATE stripe_event_inbox
      SET status = 'terminal_failure',
          last_error = ?,
          processed_at = datetime('now'),
          claim_token = NULL,
          expires_at = NULL
      WHERE event_id = ? AND claim_token = ?
    `).bind(errorMsg, eventId, claimToken).run();
  } else {
    await db.prepare(`
      UPDATE stripe_event_inbox
      SET status = 'terminal_failure',
          last_error = ?,
          processed_at = datetime('now'),
          claim_token = NULL,
          expires_at = NULL
      WHERE event_id = ?
    `).bind(errorMsg, eventId).run();
  }
}
