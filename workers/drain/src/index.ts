// Standalone Cloudflare Scheduled Worker — Commerce Drain (P4)
//
// Cloudflare Pages Functions cannot run `cron` triggers, so the durable commerce
// state machine (stripe_event_inbox + commerce_transfer_outbox) needs a separate
// scheduled Worker to re-drive rows that were stranded by a transient failure.
//
// This Worker does NOT reimplement any Stripe calls or the claim/lease/backoff
// scheme. It is a thin scheduled caller over the existing commerce library:
//   - Inbox re-drive: src/lib/commerce/eventProcessor.ts `processStripeInboxEvent`
//     (same function the webhook invokes from `waitUntil`). That function claims
//     the row itself via `claimInboxEvent`, so this Worker never touches the
//     lease columns directly — a concurrent webhook delivery and this cron tick
//     race safely on the existing conditional UPDATE.
//   - Payout drain (gated): src/lib/commerce/transferWorker.ts `processTransferBatch`
//     (same function functions/api/payments/process-transfers.ts calls). It fails
//     closed on its own via `validatePayoutWorkerConfig` if PAYOUTS_ENABLED isn't
//     'true', so this Worker also short-circuits before calling it.

import { processStripeInboxEvent } from '../../../src/lib/commerce/eventProcessor';
import { processTransferBatch } from '../../../src/lib/commerce/transferWorker';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[]; success: boolean; error?: string }>;
  run(): Promise<{ success: boolean; error?: string; meta?: { changes?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  DB?: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_LIVEMODE?: string;
  LICENSE_ENCRYPTION_KEYS_JSON?: string;
  LICENSE_ACTIVE_KEY_VERSION?: string;
  PAYOUTS_ENABLED?: string;
  PAYOUT_WORKER_SECRET?: string;
  // Bounded batch size per tick for the inbox re-drive path. Optional; defaults below.
  DRAIN_INBOX_BATCH_SIZE?: string;
  // Bounded batch size per tick for the transfer outbox drain. Optional; defaults below.
  DRAIN_TRANSFER_BATCH_SIZE?: string;
}

export const DEFAULT_INBOX_BATCH_SIZE = 20;
export const DEFAULT_TRANSFER_BATCH_SIZE = 10;

export interface InboxDrainSummary {
  ran: boolean;
  candidateCount: number;
  processedCount: number;
  succeededCount: number;
  duplicateCount: number;
  terminalCount: number;
  retryableCount: number;
  errorCount: number;
  reason?: string;
}

export interface TransferDrainSummary {
  ran: boolean;
  processedCount: number;
  succeededCount: number;
  retryableCount: number;
  terminalCount: number;
  ambiguousCount: number;
  skippedCount: number;
  reason?: string;
}

export interface DrainTickResult {
  inbox: InboxDrainSummary;
  transfers: TransferDrainSummary;
}

function parseBatchSize(raw: string | undefined, fallback: number, max: number): number {
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

/**
 * Finds `stripe_event_inbox` rows that are due for re-drive: still in a
 * claimable status (`received` or `retryable_failure`) whose backoff window
 * has elapsed. This mirrors the same condition `claimInboxEvent` itself
 * enforces (see src/lib/commerce/stripeInbox.ts) — it is a read-only
 * candidate list, not a second claim/lease implementation. The actual claim
 * still happens exclusively inside `processStripeInboxEvent`.
 */
async function findDueInboxEventIds(db: D1Database, limit: number): Promise<string[]> {
  const rows = await db.prepare(`
    SELECT event_id
    FROM stripe_event_inbox
    WHERE status IN ('received', 'retryable_failure')
      AND next_attempt_at <= datetime('now')
    ORDER BY next_attempt_at ASC, received_at ASC
    LIMIT ?
  `).bind(limit).all<{ event_id: string }>();

  return (rows.results || []).map(r => r.event_id);
}

/**
 * Re-drives stranded `stripe_event_inbox` rows by invoking the SAME
 * `processStripeInboxEvent` state machine the webhook handler uses. Always
 * runs (not gated behind PAYOUTS_ENABLED) — fulfillment must not depend on
 * payouts being commissioned.
 */
export async function runInboxDrain(env: Env, options?: { limit?: number }): Promise<InboxDrainSummary> {
  const base: InboxDrainSummary = {
    ran: false,
    candidateCount: 0,
    processedCount: 0,
    succeededCount: 0,
    duplicateCount: 0,
    terminalCount: 0,
    retryableCount: 0,
    errorCount: 0
  };

  if (!env?.DB) {
    return { ...base, reason: 'DB binding is unavailable; skipping inbox drain for this tick' };
  }

  const limit = options?.limit ?? parseBatchSize(env.DRAIN_INBOX_BATCH_SIZE, DEFAULT_INBOX_BATCH_SIZE, 100);

  let candidateIds: string[];
  try {
    candidateIds = await findDueInboxEventIds(env.DB, limit);
  } catch (err: any) {
    return { ...base, reason: `Failed to query due inbox events: ${err?.message || String(err)}` };
  }

  const summary: InboxDrainSummary = { ...base, ran: true, candidateCount: candidateIds.length };

  for (const eventId of candidateIds) {
    try {
      const result = await processStripeInboxEvent(env.DB, env, eventId);
      summary.processedCount++;

      if (result.duplicate) {
        summary.duplicateCount++;
      } else if (result.success) {
        summary.succeededCount++;
      } else if (result.terminal) {
        summary.terminalCount++;
      } else if (result.retryable || result.skipped) {
        summary.retryableCount++;
      } else {
        summary.errorCount++;
      }
    } catch (err: any) {
      // A single row's processor throwing must not abort the rest of the batch.
      summary.processedCount++;
      summary.errorCount++;
      console.error(`[drain-worker] inbox re-drive threw for event ${eventId}:`, err?.message || err);
    }
  }

  return summary;
}

/**
 * Drains the transfer outbox using the SAME `processTransferBatch` function
 * the /api/payments/process-transfers endpoint calls. Only runs when
 * `PAYOUTS_ENABLED === 'true'`; otherwise a clean no-op (payouts stay off
 * until commissioned). `processTransferBatch` also fails closed internally
 * via `validatePayoutWorkerConfig`, so this is a belt-and-suspenders gate.
 */
export async function runTransferDrain(env: Env, options?: { limit?: number }): Promise<TransferDrainSummary> {
  const base: TransferDrainSummary = {
    ran: false,
    processedCount: 0,
    succeededCount: 0,
    retryableCount: 0,
    terminalCount: 0,
    ambiguousCount: 0,
    skippedCount: 0
  };

  if (env?.PAYOUTS_ENABLED !== 'true') {
    return { ...base, reason: "PAYOUTS_ENABLED is not 'true'; payout drain is off" };
  }

  if (!env?.DB) {
    return { ...base, reason: 'DB binding is unavailable; skipping payout drain for this tick' };
  }

  const limit = options?.limit ?? parseBatchSize(env.DRAIN_TRANSFER_BATCH_SIZE, DEFAULT_TRANSFER_BATCH_SIZE, 25);

  try {
    const batchResult = await processTransferBatch(env.DB, env, { limit });
    return {
      ran: true,
      processedCount: batchResult.processedCount,
      succeededCount: batchResult.succeededCount,
      retryableCount: batchResult.retryableCount,
      terminalCount: batchResult.terminalCount,
      ambiguousCount: batchResult.ambiguousCount,
      skippedCount: batchResult.skippedCount,
      reason: batchResult.success ? undefined : (batchResult.results?.[0] as any)?.error
    };
  } catch (err: any) {
    return { ...base, reason: `Transfer batch drain threw: ${err?.message || String(err)}` };
  }
}

/**
 * Executes one full drain tick: inbox re-drive (always) then payout drain
 * (gated). Structured, quiet logging — one line per tick, one line per
 * sub-path only when it actually ran or had something to report.
 */
export async function runDrainTick(env: Env): Promise<DrainTickResult> {
  const startedAt = Date.now();

  const inbox = await runInboxDrain(env);
  const transfers = await runTransferDrain(env);

  const durationMs = Date.now() - startedAt;

  console.log('[drain-worker] tick complete', JSON.stringify({
    durationMs,
    inbox: {
      ran: inbox.ran,
      candidates: inbox.candidateCount,
      processed: inbox.processedCount,
      succeeded: inbox.succeededCount,
      duplicate: inbox.duplicateCount,
      terminal: inbox.terminalCount,
      retryable: inbox.retryableCount,
      errors: inbox.errorCount,
      reason: inbox.reason
    },
    transfers: {
      ran: transfers.ran,
      processed: transfers.processedCount,
      succeeded: transfers.succeededCount,
      retryable: transfers.retryableCount,
      terminal: transfers.terminalCount,
      ambiguous: transfers.ambiguousCount,
      skipped: transfers.skippedCount,
      reason: transfers.reason
    }
  }));

  return { inbox, transfers };
}

// Minimal local shapes for the Workers runtime cron contract. The repo does not
// depend on @cloudflare/workers-types, so these are declared locally rather than
// relying on ambient globals that aren't installed.
export interface DrainScheduledEvent {
  cron: string;
  scheduledTime: number;
}

export interface DrainExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async scheduled(_event: DrainScheduledEvent, env: Env, ctx: DrainExecutionContext): Promise<void> {
    ctx.waitUntil(runDrainTick(env).catch((err: any) => {
      console.error('[drain-worker] tick failed:', err?.message || err);
    }));
  },

  // Not routed in production (no HTTP route is configured for this Worker),
  // but a manual fetch handler is useful for local `wrangler dev` smoke tests
  // and keeps the module a valid Worker export.
  async fetch(_request: Request, env: Env): Promise<Response> {
    const result = await runDrainTick(env);
    return Response.json(result);
  }
};
