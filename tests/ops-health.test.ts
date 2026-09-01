// Tests for the OPS operator health/reconciliation surface:
//   GET /api/ops/health        (functions/api/ops/health.ts)
//   GET /api/ops/dead-letters  (functions/api/ops/dead-letters.ts)
//   src/lib/opsDomain.ts       (pure metric computation over the same tables
//                                the scheduled drain worker reconciles)
//
// Covers: super_admin-only gating (401 unauthenticated, 403 non-admin),
// honest status-count/queue-age/dead-letter computation against a seeded
// D1 harness, and that non-admins never receive any queue-state payload.

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';
import { onRequestGet as healthGet } from '../functions/api/ops/health';
import { onRequestGet as deadLettersGet } from '../functions/api/ops/dead-letters';
import {
  computeOpsHealthSnapshot,
  computeDeadLetterSnapshot,
  computeWorkerFlags
} from '../src/lib/opsDomain';

describe('OPS operator health/reconciliation surface', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  async function seedUser(id: string, role = 'maker') {
    await ctx.d1.prepare(`INSERT OR IGNORE INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)`)
      .bind(id, id.replace('usr_', ''), `User ${id}`, role).run();
  }

  async function insertSession(token: string, userId: string, expiresInMs = 3_600_000) {
    const tokenHash = await hashSessionToken(token);
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(tokenHash, userId, Date.now() + expiresInMs, Date.now()).run();
  }

  async function seedInboxEvent(eventId: string, opts: { status?: string; nextAttemptAt?: string; lastError?: string | null; attemptCount?: number; receivedAt?: string } = {}) {
    await ctx.d1.prepare(`
      INSERT INTO stripe_event_inbox (
        event_id, event_type, livemode, payload_json, payload_sha256,
        status, attempt_count, last_error, received_at, next_attempt_at
      ) VALUES (?, 'payment_intent.succeeded', 0, '{}', ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
    `).bind(
      eventId, 'a'.repeat(64), opts.status ?? 'received', opts.attemptCount ?? 0,
      opts.lastError ?? null, opts.receivedAt ?? null, opts.nextAttemptAt ?? null
    ).run();
  }

  async function seedFulfilledOrderWithTransfer(options: {
    orderId: string;
    outboxId: string;
    userId: string;
    amountCents?: number;
    status?: string;
    lastError?: string | null;
    attemptCount?: number;
    createdAt?: string;
  }) {
    const { orderId, outboxId, userId } = options;
    const amountCents = options.amountCents ?? 1350;
    await seedUser(userId);
    await seedUser('usr_buyer');

    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, seller_user_id,
        app_version, price_version, gross_cents, currency,
        lineage_policy, lineage_snapshot_json, stripe_payment_intent_id,
        status, state_version, created_at, updated_at
      ) VALUES (?, ?, 'usr_buyer', 'dronehunter', ?, 'v1.0.0', 1, 1500, 'usd', 'maker_70_lineage_20_pool_10', '{}', ?, 'fulfilled', 2, datetime('now'), datetime('now'))
    `).bind(orderId, `idem_${orderId}`, userId, `pi_${orderId}`).run();

    const allocId = `coa_${orderId}`;
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (id, order_id, sequence, role, recipient_user_id, lineage_depth, basis_points, amount_cents)
      VALUES (?, ?, 0, 'maker', ?, 0, 9000, ?)
    `).bind(allocId, orderId, userId, amountCents).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_transfer_outbox (
        id, order_id, allocation_id, destination_user_id, amount_cents, currency,
        status, attempt_count, last_error, stripe_idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, 'usd', ?, ?, ?, ?, COALESCE(?, datetime('now')))
    `).bind(
      outboxId, orderId, allocId, userId, amountCents,
      options.status ?? 'pending', options.attemptCount ?? 0, options.lastError ?? null,
      `transfer:${outboxId}`, options.createdAt ?? null
    ).run();

    return { orderId, outboxId, allocId, userId, amountCents };
  }

  async function seedSucceededTransferWithReversal(options: {
    orderId: string;
    outboxId: string;
    reversalId: string;
    userId: string;
    amountCents?: number;
    reversalStatus?: string;
    lastError?: string | null;
  }) {
    const amountCents = options.amountCents ?? 1350;
    await seedFulfilledOrderWithTransfer({
      orderId: options.orderId,
      outboxId: options.outboxId,
      userId: options.userId,
      amountCents,
      status: 'succeeded'
    });
    await ctx.d1.prepare(`UPDATE commerce_transfer_outbox SET stripe_transfer_id = ?, completed_at = datetime('now') WHERE id = ?`)
      .bind(`tr_${options.outboxId}`, options.outboxId).run();

    const eventId = `evt_src_${options.orderId}`;
    await seedInboxEvent(eventId, { status: 'processed' });

    await ctx.d1.prepare(`
      INSERT INTO commerce_reversal_outbox (
        id, original_outbox_id, source_event_id, amount_cents, currency,
        stripe_idempotency_key, status, attempt_count, last_error, created_at
      ) VALUES (?, ?, ?, ?, 'usd', ?, ?, ?, ?, datetime('now'))
    `).bind(
      options.reversalId, options.outboxId, eventId, amountCents,
      `reversal:${options.reversalId}`, options.reversalStatus ?? 'pending', 0, options.lastError ?? null
    ).run();

    return { reversalId: options.reversalId, outboxId: options.outboxId };
  }

  describe('auth gating', () => {
    it('GET /api/ops/health returns 401 with no session', async () => {
      const res = await healthGet({ request: new Request('https://x/api/ops/health'), env: { DB: ctx.d1 } } as any);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('GET /api/ops/health returns 403 for an authenticated non-admin', async () => {
      await seedUser('usr_maker', 'maker');
      await insertSession('tok_maker', 'usr_maker');
      const res = await healthGet({
        request: new Request('https://x/api/ops/health', { headers: { Authorization: 'Bearer tok_maker' } }),
        env: { DB: ctx.d1 }
      } as any);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      // Non-admin response must never leak queue state.
      expect(body.stripeEventInbox).toBeUndefined();
      expect(body.transferOutbox).toBeUndefined();
    });

    it('GET /api/ops/health returns 200 for super_admin', async () => {
      await seedUser('usr_admin', 'super_admin');
      await insertSession('tok_admin', 'usr_admin');
      const res = await healthGet({
        request: new Request('https://x/api/ops/health', { headers: { Authorization: 'Bearer tok_admin' } }),
        env: { DB: ctx.d1 }
      } as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.stripeEventInbox).toBeDefined();
    });

    it('GET /api/ops/dead-letters returns 401 with no session', async () => {
      const res = await deadLettersGet({ request: new Request('https://x/api/ops/dead-letters'), env: { DB: ctx.d1 } } as any);
      expect(res.status).toBe(401);
    });

    it('GET /api/ops/dead-letters returns 403 for an authenticated non-admin (bot role)', async () => {
      await seedUser('usr_bot', 'bot');
      await insertSession('tok_bot', 'usr_bot');
      const res = await deadLettersGet({
        request: new Request('https://x/api/ops/dead-letters', { headers: { Authorization: 'Bearer tok_bot' } }),
        env: { DB: ctx.d1 }
      } as any);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.inboxEvents).toBeUndefined();
    });

    it('GET /api/ops/dead-letters returns 200 for super_admin', async () => {
      await seedUser('usr_admin2', 'super_admin');
      await insertSession('tok_admin2', 'usr_admin2');
      const res = await deadLettersGet({
        request: new Request('https://x/api/ops/dead-letters', { headers: { Authorization: 'Bearer tok_admin2' } }),
        env: { DB: ctx.d1 }
      } as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.inboxEvents)).toBe(true);
    });
  });

  describe('computeOpsHealthSnapshot (honest status counts + queue age + flags)', () => {
    it('counts stripe_event_inbox rows by status and finds the oldest unprocessed next_attempt_at', async () => {
      await seedInboxEvent('evt_recv_1', { status: 'received', nextAttemptAt: '2026-01-05 00:00:00' });
      await seedInboxEvent('evt_recv_2', { status: 'received', nextAttemptAt: '2026-01-01 00:00:00' }); // oldest
      await seedInboxEvent('evt_retry_1', { status: 'retryable_failure', nextAttemptAt: '2026-01-03 00:00:00' });
      await seedInboxEvent('evt_processed_1', { status: 'processed' });
      await seedInboxEvent('evt_dead_1', { status: 'terminal_failure', lastError: 'card declined permanently' });

      const snapshot = await computeOpsHealthSnapshot(ctx.d1, { PAYOUTS_ENABLED: 'false' });

      expect(snapshot.stripeEventInbox.totalCount).toBe(5);
      expect(snapshot.stripeEventInbox.deadLetterCount).toBe(1);
      expect(snapshot.stripeEventInbox.oldestUnprocessedNextAttemptAt).toBe('2026-01-01 00:00:00');

      const receivedCount = snapshot.stripeEventInbox.statusCounts.find(s => s.status === 'received')?.count;
      const processedCount = snapshot.stripeEventInbox.statusCounts.find(s => s.status === 'processed')?.count;
      expect(receivedCount).toBe(2);
      expect(processedCount).toBe(1);
    });

    it('counts commerce_transfer_outbox rows by status, oldest pending, and dead-letters', async () => {
      await seedFulfilledOrderWithTransfer({ orderId: 'ord_a', outboxId: 'cto_a', userId: 'usr_maker_a', status: 'pending', createdAt: '2026-01-02 00:00:00' });
      await seedFulfilledOrderWithTransfer({ orderId: 'ord_b', outboxId: 'cto_b', userId: 'usr_maker_b', status: 'pending', createdAt: '2026-01-01 00:00:00' }); // oldest
      await seedFulfilledOrderWithTransfer({ orderId: 'ord_c', outboxId: 'cto_c', userId: 'usr_maker_c', status: 'succeeded' });
      await seedFulfilledOrderWithTransfer({ orderId: 'ord_d', outboxId: 'cto_d', userId: 'usr_maker_d', status: 'terminal_failure', lastError: 'destination account closed' });

      const snapshot = await computeOpsHealthSnapshot(ctx.d1, {});

      expect(snapshot.transferOutbox.totalCount).toBe(4);
      expect(snapshot.transferOutbox.deadLetterCount).toBe(1);
      expect(snapshot.transferOutbox.oldestPendingCreatedAt).toBe('2026-01-01 00:00:00');
    });

    it('counts commerce_reversal_outbox rows by status and dead-letters', async () => {
      await seedSucceededTransferWithReversal({ orderId: 'ord_r1', outboxId: 'cto_r1', reversalId: 'cro_r1', userId: 'usr_rev_1', reversalStatus: 'pending' });
      await seedSucceededTransferWithReversal({ orderId: 'ord_r2', outboxId: 'cto_r2', reversalId: 'cro_r2', userId: 'usr_rev_2', reversalStatus: 'terminal_failure', lastError: 'stripe account disconnected' });

      const snapshot = await computeOpsHealthSnapshot(ctx.d1, {});

      expect(snapshot.reversalOutbox.totalCount).toBe(2);
      expect(snapshot.reversalOutbox.deadLetterCount).toBe(1);
    });

    it('reflects the real PAYOUTS_ENABLED env flag honestly (never hardcoded true)', async () => {
      expect(computeWorkerFlags({ PAYOUTS_ENABLED: 'true' }).payoutsEnabled).toBe(true);
      expect(computeWorkerFlags({ PAYOUTS_ENABLED: 'false' }).payoutsEnabled).toBe(false);
      expect(computeWorkerFlags({}).payoutsEnabled).toBe(false);
      expect(computeWorkerFlags(undefined).payoutsEnabled).toBe(false);
    });

    it('returns honest empty state when no rows exist', async () => {
      const snapshot = await computeOpsHealthSnapshot(ctx.d1, {});
      expect(snapshot.stripeEventInbox.totalCount).toBe(0);
      expect(snapshot.stripeEventInbox.oldestUnprocessedNextAttemptAt).toBeNull();
      expect(snapshot.transferOutbox.totalCount).toBe(0);
      expect(snapshot.reversalOutbox.deadLetterCount).toBe(0);
    });
  });

  describe('computeDeadLetterSnapshot (stuck money visibility)', () => {
    it('returns only terminal_failure rows with their last_error, across all three tables', async () => {
      await seedInboxEvent('evt_ok', { status: 'processed' });
      await seedInboxEvent('evt_dead', { status: 'terminal_failure', lastError: 'signature mismatch after max retries', attemptCount: 5 });

      await seedFulfilledOrderWithTransfer({ orderId: 'ord_ok', outboxId: 'cto_ok', userId: 'usr_ok', status: 'succeeded' });
      await seedFulfilledOrderWithTransfer({ orderId: 'ord_dead', outboxId: 'cto_dead', userId: 'usr_dead', status: 'terminal_failure', lastError: 'invalid destination account', attemptCount: 3 });

      await seedSucceededTransferWithReversal({ orderId: 'ord_rev_ok', outboxId: 'cto_rev_ok', reversalId: 'cro_ok', userId: 'usr_rev_ok', reversalStatus: 'succeeded' });
      await seedSucceededTransferWithReversal({ orderId: 'ord_rev_dead', outboxId: 'cto_rev_dead', reversalId: 'cro_dead', userId: 'usr_rev_dead', reversalStatus: 'terminal_failure', lastError: 'reversal exceeds available balance' });

      const snapshot = await computeDeadLetterSnapshot(ctx.d1);

      expect(snapshot.inboxEvents).toHaveLength(1);
      expect(snapshot.inboxEvents[0]).toMatchObject({ eventId: 'evt_dead', lastError: 'signature mismatch after max retries', attemptCount: 5 });

      expect(snapshot.transferOutboxRows).toHaveLength(1);
      expect(snapshot.transferOutboxRows[0]).toMatchObject({ id: 'cto_dead', lastError: 'invalid destination account', destinationUserId: 'usr_dead' });

      expect(snapshot.reversalOutboxRows).toHaveLength(1);
      expect(snapshot.reversalOutboxRows[0]).toMatchObject({ id: 'cro_dead', lastError: 'reversal exceeds available balance' });
    });

    it('returns honest empty arrays when nothing is dead-lettered', async () => {
      await seedInboxEvent('evt_fine', { status: 'processed' });
      const snapshot = await computeDeadLetterSnapshot(ctx.d1);
      expect(snapshot.inboxEvents).toEqual([]);
      expect(snapshot.transferOutboxRows).toEqual([]);
      expect(snapshot.reversalOutboxRows).toEqual([]);
    });
  });

  describe('end-to-end: super_admin sees real seeded dead-letters via the HTTP handler', () => {
    it('GET /api/ops/dead-letters surfaces a seeded terminal_failure inbox row for an admin', async () => {
      await seedUser('usr_admin3', 'super_admin');
      await insertSession('tok_admin3', 'usr_admin3');
      await seedInboxEvent('evt_dead_e2e', { status: 'terminal_failure', lastError: 'webhook signature invalid', attemptCount: 6 });

      const res = await deadLettersGet({
        request: new Request('https://x/api/ops/dead-letters', { headers: { Authorization: 'Bearer tok_admin3' } }),
        env: { DB: ctx.d1 }
      } as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.inboxEvents).toHaveLength(1);
      expect(body.inboxEvents[0].eventId).toBe('evt_dead_e2e');
      expect(body.inboxEvents[0].lastError).toBe('webhook signature invalid');
    });
  });
});
