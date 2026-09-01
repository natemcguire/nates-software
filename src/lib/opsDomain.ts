// OPS — operator health / reconciliation read models.
//
// Read-only. No money mutation. These functions compute honest, server-side
// metrics directly from the same durable commerce tables the drain worker
// (workers/drain/src/index.ts) operates on: stripe_event_inbox,
// commerce_transfer_outbox, commerce_reversal_outbox. Nothing here fabricates
// state — every number is a real aggregate query against those tables.
//
// Column fact: commerce_transfer_outbox.destination_user_id identifies the
// payout recipient (migrations/0009_durable_commerce.sql). The reversal
// outbox (commerce_reversal_outbox, migrations/0011_commerce_money_movement.sql)
// has no destination_user_id column of its own — it reverses an already
// succeeded transfer via original_outbox_id, so a reversal row's recipient is
// looked up (if needed) through that reference, not read directly.

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[]; success: boolean; error?: string }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface StripeInboxHealth {
  totalCount: number;
  statusCounts: StatusCount[];
  oldestUnprocessedNextAttemptAt: string | null;
  deadLetterCount: number; // terminal_failure
}

export interface OutboxHealth {
  totalCount: number;
  statusCounts: StatusCount[];
  oldestPendingCreatedAt: string | null;
  deadLetterCount: number; // terminal_failure
}

export interface WorkerFlagState {
  payoutsEnabled: boolean;
}

export interface OpsHealthSnapshot {
  generatedAt: string;
  stripeEventInbox: StripeInboxHealth;
  transferOutbox: OutboxHealth;
  reversalOutbox: OutboxHealth;
  workerFlags: WorkerFlagState;
}

const INBOX_UNPROCESSED_STATUSES = ['received', 'retryable_failure'] as const;
const OUTBOX_PENDING_STATUSES = ['pending', 'retryable_failure'] as const;

async function statusCounts(db: D1Database, table: string): Promise<StatusCount[]> {
  const result = await db.prepare(
    `SELECT status, COUNT(*) AS count FROM ${table} GROUP BY status ORDER BY status ASC`
  ).all<{ status: string; count: number }>();
  return (result.results || []).map(row => ({ status: row.status, count: Number(row.count) }));
}

function sumCounts(counts: StatusCount[]): number {
  return counts.reduce((acc, c) => acc + c.count, 0);
}

function countForStatuses(counts: StatusCount[], statuses: readonly string[]): number {
  const set = new Set(statuses);
  return counts.filter(c => set.has(c.status)).reduce((acc, c) => acc + c.count, 0);
}

/**
 * Computes honest stripe_event_inbox health: counts by status, the oldest
 * un-processed row's next_attempt_at (queue age signal), and the
 * terminal_failure (dead-letter) count.
 */
export async function computeStripeInboxHealth(db: D1Database): Promise<StripeInboxHealth> {
  const counts = await statusCounts(db, 'stripe_event_inbox');
  const totalCount = sumCounts(counts);
  const deadLetterCount = countForStatuses(counts, ['terminal_failure']);

  const oldestRow = await db.prepare(`
    SELECT next_attempt_at
    FROM stripe_event_inbox
    WHERE status IN (${INBOX_UNPROCESSED_STATUSES.map(() => '?').join(',')})
    ORDER BY next_attempt_at ASC
    LIMIT 1
  `).bind(...INBOX_UNPROCESSED_STATUSES).first<{ next_attempt_at: string }>();

  return {
    totalCount,
    statusCounts: counts,
    oldestUnprocessedNextAttemptAt: oldestRow?.next_attempt_at ?? null,
    deadLetterCount
  };
}

/**
 * Computes honest outbox health (shared shape for commerce_transfer_outbox
 * and commerce_reversal_outbox): counts by status, oldest pending row's
 * created_at, and terminal_failure (dead-letter) count.
 */
export async function computeOutboxHealth(db: D1Database, table: 'commerce_transfer_outbox' | 'commerce_reversal_outbox'): Promise<OutboxHealth> {
  const counts = await statusCounts(db, table);
  const totalCount = sumCounts(counts);
  const deadLetterCount = countForStatuses(counts, ['terminal_failure']);

  const oldestRow = await db.prepare(`
    SELECT created_at
    FROM ${table}
    WHERE status IN (${OUTBOX_PENDING_STATUSES.map(() => '?').join(',')})
    ORDER BY created_at ASC
    LIMIT 1
  `).bind(...OUTBOX_PENDING_STATUSES).first<{ created_at: string }>();

  return {
    totalCount,
    statusCounts: counts,
    oldestPendingCreatedAt: oldestRow?.created_at ?? null,
    deadLetterCount
  };
}

/** Reflects the real drain-worker env flag — never fabricated, never inferred. */
export function computeWorkerFlags(env: { PAYOUTS_ENABLED?: string } | undefined | null): WorkerFlagState {
  return { payoutsEnabled: env?.PAYOUTS_ENABLED === 'true' };
}

export async function computeOpsHealthSnapshot(db: D1Database, env: { PAYOUTS_ENABLED?: string } | undefined | null): Promise<OpsHealthSnapshot> {
  const [stripeEventInbox, transferOutbox, reversalOutbox] = await Promise.all([
    computeStripeInboxHealth(db),
    computeOutboxHealth(db, 'commerce_transfer_outbox'),
    computeOutboxHealth(db, 'commerce_reversal_outbox')
  ]);

  return {
    generatedAt: new Date().toISOString(),
    stripeEventInbox,
    transferOutbox,
    reversalOutbox,
    workerFlags: computeWorkerFlags(env)
  };
}

export interface DeadLetterInboxEvent {
  kind: 'stripe_event_inbox';
  eventId: string;
  eventType: string;
  attemptCount: number;
  lastError: string | null;
  receivedAt: string;
}

export interface DeadLetterOutboxRow {
  kind: 'commerce_transfer_outbox' | 'commerce_reversal_outbox';
  id: string;
  orderRef: string; // order_id for transfer outbox, original_outbox_id for reversal outbox
  destinationUserId: string | null;
  amountCents: number;
  currency: string;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
}

export interface DeadLetterSnapshot {
  generatedAt: string;
  inboxEvents: DeadLetterInboxEvent[];
  transferOutboxRows: DeadLetterOutboxRow[];
  reversalOutboxRows: DeadLetterOutboxRow[];
}

const DEAD_LETTER_LIMIT = 200;

export async function listDeadLetterInboxEvents(db: D1Database, limit = DEAD_LETTER_LIMIT): Promise<DeadLetterInboxEvent[]> {
  const result = await db.prepare(`
    SELECT event_id, event_type, attempt_count, last_error, received_at
    FROM stripe_event_inbox
    WHERE status = 'terminal_failure'
    ORDER BY received_at DESC
    LIMIT ?
  `).bind(limit).all<{ event_id: string; event_type: string; attempt_count: number; last_error: string | null; received_at: string }>();

  return (result.results || []).map(row => ({
    kind: 'stripe_event_inbox' as const,
    eventId: row.event_id,
    eventType: row.event_type,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error,
    receivedAt: row.received_at
  }));
}

export async function listDeadLetterTransferOutbox(db: D1Database, limit = DEAD_LETTER_LIMIT): Promise<DeadLetterOutboxRow[]> {
  const result = await db.prepare(`
    SELECT id, order_id, destination_user_id, amount_cents, currency, attempt_count, last_error, created_at
    FROM commerce_transfer_outbox
    WHERE status = 'terminal_failure'
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all<{ id: string; order_id: string; destination_user_id: string | null; amount_cents: number; currency: string; attempt_count: number; last_error: string | null; created_at: string }>();

  return (result.results || []).map(row => ({
    kind: 'commerce_transfer_outbox' as const,
    id: row.id,
    orderRef: row.order_id,
    destinationUserId: row.destination_user_id,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error,
    createdAt: row.created_at
  }));
}

export async function listDeadLetterReversalOutbox(db: D1Database, limit = DEAD_LETTER_LIMIT): Promise<DeadLetterOutboxRow[]> {
  const result = await db.prepare(`
    SELECT id, original_outbox_id, amount_cents, currency, attempt_count, last_error, created_at
    FROM commerce_reversal_outbox
    WHERE status = 'terminal_failure'
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all<{ id: string; original_outbox_id: string; amount_cents: number; currency: string; attempt_count: number; last_error: string | null; created_at: string }>();

  return (result.results || []).map(row => ({
    kind: 'commerce_reversal_outbox' as const,
    id: row.id,
    orderRef: row.original_outbox_id,
    destinationUserId: null,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error,
    createdAt: row.created_at
  }));
}

export async function computeDeadLetterSnapshot(db: D1Database, limit = DEAD_LETTER_LIMIT): Promise<DeadLetterSnapshot> {
  const [inboxEvents, transferOutboxRows, reversalOutboxRows] = await Promise.all([
    listDeadLetterInboxEvents(db, limit),
    listDeadLetterTransferOutbox(db, limit),
    listDeadLetterReversalOutbox(db, limit)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    inboxEvents,
    transferOutboxRows,
    reversalOutboxRows
  };
}
