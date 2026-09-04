
import { processStripeInboxEvent } from '../../../src/lib/commerce/eventProcessor';
import { processTransferBatch } from '../../../src/lib/commerce/transferWorker';
import { processRecoveryBatch } from '../../../src/lib/commerce/recoveryWorker';

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
  DRAIN_INBOX_BATCH_SIZE?: string;
  DRAIN_TRANSFER_BATCH_SIZE?: string;
  DRAIN_RECOVERY_BATCH_SIZE?: string;
}

export const DEFAULT_INBOX_BATCH_SIZE = 20;
export const DEFAULT_TRANSFER_BATCH_SIZE = 10;
export const DEFAULT_RECOVERY_BATCH_SIZE = 10;

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

export interface RecoveryDrainSummary {
  ran: boolean;
  enqueuedCount: number;
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
  recovery: RecoveryDrainSummary;
}

function parseBatchSize(raw: string | undefined, fallback: number, max: number): number {
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

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
      summary.processedCount++;
      summary.errorCount++;
      console.error(`[drain-worker] inbox re-drive threw for event ${eventId}:`, err?.message || err);
    }
  }

  return summary;
}

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

export async function runRecoveryDrain(env: Env, options?: { limit?: number }): Promise<RecoveryDrainSummary> {
  const base: RecoveryDrainSummary = {
    ran: false,
    enqueuedCount: 0,
    processedCount: 0,
    succeededCount: 0,
    retryableCount: 0,
    terminalCount: 0,
    ambiguousCount: 0,
    skippedCount: 0
  };

  if (env?.PAYOUTS_ENABLED !== 'true') {
    return { ...base, reason: "PAYOUTS_ENABLED is not 'true'; recovery drain is off" };
  }

  if (!env?.DB) {
    return { ...base, reason: 'DB binding is unavailable; skipping recovery drain for this tick' };
  }

  const limit = options?.limit ?? parseBatchSize(env.DRAIN_RECOVERY_BATCH_SIZE, DEFAULT_RECOVERY_BATCH_SIZE, 25);

  try {
    const batchResult = await processRecoveryBatch(env.DB, env, { limit });
    return {
      ran: true,
      enqueuedCount: batchResult.enqueuedCount,
      processedCount: batchResult.processedCount,
      succeededCount: batchResult.succeededCount,
      retryableCount: batchResult.retryableCount,
      terminalCount: batchResult.terminalCount,
      ambiguousCount: batchResult.ambiguousCount,
      skippedCount: batchResult.skippedCount,
      reason: batchResult.success ? undefined : (batchResult.results?.[0] as any)?.error
    };
  } catch (err: any) {
    return { ...base, reason: `Recovery batch drain threw: ${err?.message || String(err)}` };
  }
}

export async function runDrainTick(env: Env): Promise<DrainTickResult> {
  const startedAt = Date.now();

  const inbox = await runInboxDrain(env);
  const transfers = await runTransferDrain(env);
  const recovery = await runRecoveryDrain(env);

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
    },
    recovery: {
      ran: recovery.ran,
      enqueued: recovery.enqueuedCount,
      processed: recovery.processedCount,
      succeeded: recovery.succeededCount,
      retryable: recovery.retryableCount,
      terminal: recovery.terminalCount,
      ambiguous: recovery.ambiguousCount,
      skipped: recovery.skippedCount,
      reason: recovery.reason
    }
  }));

  return { inbox, transfers, recovery };
}

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

  async fetch(_request: Request, env: Env): Promise<Response> {
    const result = await runDrainTick(env);
    return Response.json(result);
  }
};
