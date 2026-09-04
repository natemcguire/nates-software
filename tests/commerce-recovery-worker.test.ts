import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import {
  enqueueReversalForObligation,
  processReversalOutboxItem,
  processRecoveryBatch
} from '../src/lib/commerce/recoveryWorker';

describe('Commerce: recovery/reversal execution worker', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;

  const defaultEnv = () => ({
    DB: ctx.d1,
    PAYOUTS_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_mock_stripe_key_abc123'
  });

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function seedFulfilledOrderWithSucceededTransfer(options?: {
    orderId?: string;
    outboxId?: string;
    userId?: string;
    amountCents?: number;
  }) {
    const orderId = options?.orderId ?? `ord_rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const outboxId = options?.outboxId ?? `cto_rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const userId = options?.userId ?? 'usr_nate';
    const amountCents = options?.amountCents ?? 1350;

    await ctx.d1.prepare(`INSERT OR IGNORE INTO users (id, username, display_name) VALUES (?, ?, ?)`)
      .bind(userId, userId.replace('usr_', ''), `User ${userId}`).run();
    await ctx.d1.prepare(`INSERT OR IGNORE INTO users (id, username, display_name) VALUES ('usr_josh', 'josh', 'Josh')`).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, seller_user_id,
        app_version, price_version, gross_cents, currency,
        lineage_policy, lineage_snapshot_json, stripe_payment_intent_id,
        status, state_version, created_at, updated_at
      ) VALUES (?, ?, 'usr_josh', 'dronehunter', ?, 'v1.0.0', 1, 1500, 'usd', 'maker_70_lineage_20_pool_10', '{}', ?, 'fulfilled', 2, datetime('now'), datetime('now'))
    `).bind(orderId, `idem_${orderId}`, userId, `pi_${orderId}`).run();

    const allocId = `coa_m_${orderId}`;
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (id, order_id, sequence, role, recipient_user_id, lineage_depth, basis_points, amount_cents)
      VALUES (?, ?, 0, 'maker', ?, 0, 9000, ?)
    `).bind(allocId, orderId, userId, amountCents).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_transfer_outbox (
        id, order_id, allocation_id, destination_user_id, amount_cents, currency,
        status, stripe_transfer_id, stripe_idempotency_key, attempt_count, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, 'usd', 'succeeded', ?, ?, 1, datetime('now'), datetime('now'))
    `).bind(outboxId, orderId, allocId, userId, amountCents, `tr_${outboxId}`, `transfer:${outboxId}`).run();

    const eventId = `evt_src_${orderId}`;
    await ctx.d1.prepare(`
      INSERT INTO stripe_event_inbox (event_id, event_type, livemode, payload_json, payload_sha256, status, attempt_count, received_at, next_attempt_at, processed_at)
      VALUES (?, 'charge.dispute.closed', 0, '{}', ?, 'processed', 1, datetime('now'), datetime('now'), datetime('now'))
    `).bind(eventId, 'a'.repeat(64)).run();

    const obligationId = `cro_ob_${orderId}`;
    await ctx.d1.prepare(`
      INSERT INTO commerce_recovery_obligations (
        id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
        source_event_id, amount_cents, currency, status
      ) VALUES (?, ?, 'dispute', ?, ?, ?, ?, ?, 'usd', 'pending')
    `).bind(obligationId, orderId, `dp_${orderId}`, allocId, outboxId, eventId, amountCents).run();

    return { orderId, outboxId, allocId, userId, amountCents, obligationId, eventId };
  }

  describe('enqueueReversalForObligation', () => {
    it('promotes a pending obligation whose original transfer succeeded into a queued reversal outbox row', async () => {
      const { obligationId, outboxId, amountCents } = await seedFulfilledOrderWithSucceededTransfer();

      const result = await enqueueReversalForObligation(ctx.d1, obligationId);
      expect(result.success).toBe(true);
      expect(result.reversalOutboxId).toBeTruthy();

      const obligation: any = await ctx.d1.prepare(`SELECT status, reversal_outbox_id FROM commerce_recovery_obligations WHERE id = ?`).bind(obligationId).first();
      expect(obligation.status).toBe('reversal_queued');
      expect(obligation.reversal_outbox_id).toBe(result.reversalOutboxId);

      const reversalRow: any = await ctx.d1.prepare(`SELECT original_outbox_id, amount_cents, status FROM commerce_reversal_outbox WHERE id = ?`).bind(result.reversalOutboxId).first();
      expect(reversalRow).toMatchObject({ original_outbox_id: outboxId, amount_cents: amountCents, status: 'pending' });
    });

    it('leaves the obligation pending when the original transfer has not succeeded yet', async () => {
      const { obligationId, outboxId } = await seedFulfilledOrderWithSucceededTransfer();
      await ctx.d1.prepare(`UPDATE commerce_transfer_outbox SET status = 'processing', stripe_transfer_id = NULL WHERE id = ?`).bind(outboxId).run();

      const result = await enqueueReversalForObligation(ctx.d1, obligationId);
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);

      const obligation: any = await ctx.d1.prepare(`SELECT status FROM commerce_recovery_obligations WHERE id = ?`).bind(obligationId).first();
      expect(obligation.status).toBe('pending');
    });

    it('is idempotent when called twice on the same obligation', async () => {
      const { obligationId } = await seedFulfilledOrderWithSucceededTransfer();
      const first = await enqueueReversalForObligation(ctx.d1, obligationId);
      const second = await enqueueReversalForObligation(ctx.d1, obligationId);
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(second.skipped).toBe(true);

      const count: any = await ctx.d1.prepare(`SELECT COUNT(*) AS n FROM commerce_reversal_outbox WHERE original_outbox_id = (SELECT original_outbox_id FROM commerce_recovery_obligations WHERE id = ?)`).bind(obligationId).first();
      expect(count.n).toBe(1);
    });
  });

  describe('processReversalOutboxItem', () => {
    it('reverses a completed transfer and marks the obligation recovered', async () => {
      const { obligationId, amountCents } = await seedFulfilledOrderWithSucceededTransfer();
      const enqueueResult = await enqueueReversalForObligation(ctx.d1, obligationId);
      const reversalOutboxId = enqueueResult.reversalOutboxId!;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        expect(url).toContain('/reversals');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'trr_mock123',
            object: 'transfer_reversal',
            amount: amountCents,
            currency: 'usd',
            transfer: url.split('/v1/transfers/')[1].split('/')[0]
          })
        } as any;
      }) as any;

      const result = await processReversalOutboxItem(ctx.d1, defaultEnv(), reversalOutboxId);
      expect(result).toMatchObject({ success: true, status: 'succeeded', stripeReversalId: 'trr_mock123' });

      const obligation: any = await ctx.d1.prepare(`SELECT status, resolved_at FROM commerce_recovery_obligations WHERE id = ?`).bind(obligationId).first();
      expect(obligation.status).toBe('recovered');
      expect(obligation.resolved_at).toBeTruthy();

      const reversalRow: any = await ctx.d1.prepare(`SELECT status, stripe_reversal_id FROM commerce_reversal_outbox WHERE id = ?`).bind(reversalOutboxId).first();
      expect(reversalRow).toMatchObject({ status: 'succeeded', stripe_reversal_id: 'trr_mock123' });
    });

    it('is gated off when PAYOUTS_ENABLED is not true', async () => {
      const { obligationId } = await seedFulfilledOrderWithSucceededTransfer();
      const enqueueResult = await enqueueReversalForObligation(ctx.d1, obligationId);
      const spy = vi.fn();
      globalThis.fetch = spy as any;

      const result = await processReversalOutboxItem(ctx.d1, { ...defaultEnv(), PAYOUTS_ENABLED: 'false' }, enqueueResult.reversalOutboxId!);
      expect(result.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();

      const reversalRow: any = await ctx.d1.prepare(`SELECT status FROM commerce_reversal_outbox WHERE id = ?`).bind(enqueueResult.reversalOutboxId).first();
      expect(reversalRow.status).toBe('pending');
    });

    it('marks retryable on a 5xx Stripe response and preserves the obligation for a later retry', async () => {
      const { obligationId } = await seedFulfilledOrderWithSucceededTransfer();
      const enqueueResult = await enqueueReversalForObligation(ctx.d1, obligationId);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false, status: 503,
        json: async () => ({ error: { message: 'Stripe is down', type: 'api_error' } })
      } as any);

      const result = await processReversalOutboxItem(ctx.d1, defaultEnv(), enqueueResult.reversalOutboxId!);
      expect(result.retryable).toBe(true);

      const reversalRow: any = await ctx.d1.prepare(`SELECT status FROM commerce_reversal_outbox WHERE id = ?`).bind(enqueueResult.reversalOutboxId).first();
      expect(reversalRow.status).toBe('retryable_failure');

      const obligation: any = await ctx.d1.prepare(`SELECT status FROM commerce_recovery_obligations WHERE id = ?`).bind(obligationId).first();
      expect(obligation.status).toBe('reversal_queued');
    });
  });

  describe('processRecoveryBatch', () => {
    it('enqueues and executes a full recovery pass end-to-end', async () => {
      const { obligationId, amountCents } = await seedFulfilledOrderWithSucceededTransfer();

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'trr_batch1',
          object: 'transfer_reversal',
          amount: amountCents,
          currency: 'usd',
          transfer: url.split('/v1/transfers/')[1].split('/')[0]
        })
      } as any)) as any;

      const batchResult = await processRecoveryBatch(ctx.d1, defaultEnv(), { limit: 5 });
      expect(batchResult.success).toBe(true);
      expect(batchResult.enqueuedCount).toBe(1);
      expect(batchResult.succeededCount).toBe(1);

      const obligation: any = await ctx.d1.prepare(`SELECT status FROM commerce_recovery_obligations WHERE id = ?`).bind(obligationId).first();
      expect(obligation.status).toBe('recovered');
    });

    it('is a clean no-op when PAYOUTS_ENABLED is not true', async () => {
      await seedFulfilledOrderWithSucceededTransfer();
      const spy = vi.fn();
      globalThis.fetch = spy as any;

      const batchResult = await processRecoveryBatch(ctx.d1, { ...defaultEnv(), PAYOUTS_ENABLED: 'false' }, { limit: 5 });
      expect(batchResult.success).toBe(false);
      expect(batchResult.enqueuedCount).toBe(0);
      expect(batchResult.processedCount).toBe(0);
      expect(spy).not.toHaveBeenCalled();

      const obligations: any = await ctx.d1.prepare(`SELECT status FROM commerce_recovery_obligations`).all();
      expect(obligations.results.every((r: any) => r.status === 'pending')).toBe(true);
    });

    it('leaves an obligation pending (does not enqueue) when its original transfer has not succeeded', async () => {
      const { obligationId, outboxId } = await seedFulfilledOrderWithSucceededTransfer();
      await ctx.d1.prepare(`UPDATE commerce_transfer_outbox SET status = 'pending', stripe_transfer_id = NULL WHERE id = ?`).bind(outboxId).run();

      const spy = vi.fn();
      globalThis.fetch = spy as any;

      const batchResult = await processRecoveryBatch(ctx.d1, defaultEnv(), { limit: 5 });
      expect(batchResult.enqueuedCount).toBe(0);
      expect(spy).not.toHaveBeenCalled();

      const obligation: any = await ctx.d1.prepare(`SELECT status FROM commerce_recovery_obligations WHERE id = ?`).bind(obligationId).first();
      expect(obligation.status).toBe('pending');
    });
  });
});
