// Tests for the standalone scheduled Commerce Drain Worker (P4)
//
// This Worker does not reimplement any commerce state machine logic — it is a
// thin scheduled caller over `processStripeInboxEvent` (src/lib/commerce/eventProcessor)
// and `processTransferBatch` (src/lib/commerce/transferWorker), the SAME functions the
// webhook handler and the /api/payments/process-transfers endpoint call. These tests
// verify the scheduling/candidate-selection/gating glue, not the underlying state
// machine (which is already covered by tests/commerce-event-processor.test.ts and
// tests/commerce-transfer-worker.test.ts).

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { recordInboxEvent, hashPayload, claimInboxEvent } from '../src/lib/commerce/stripeInbox';
import { generateBase64EncryptionKey } from '../src/lib/commerce/licenseCrypto';
import { runInboxDrain, runTransferDrain, runRecoveryDrain, runDrainTick } from '../workers/drain/src/index';

describe('Commerce Drain Worker (P4 scheduled re-drive)', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;

  const keyV1 = generateBase64EncryptionKey();
  const keysJson = JSON.stringify({ '1': keyV1 });
  const defaultEnv = () => ({
    DB: ctx.d1,
    STRIPE_SECRET_KEY: 'sk_test_mock_secret_key_123',
    STRIPE_LIVEMODE: 'false',
    LICENSE_ENCRYPTION_KEYS_JSON: keysJson,
    LICENSE_ACTIVE_KEY_VERSION: '1',
    PAYOUTS_ENABLED: 'false'
  });

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // Helper to create a root order (mirrors tests/commerce-event-processor.test.ts)
  async function seedRootOrder(orderId = 'ord_drain_test_1', status = 'requires_payment') {
    const grossCents = 1500;
    const makerCents = 1350; // 90%
    const poolCents = 150;   // 10%
    const piId = `pi_${orderId}`;

    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, seller_user_id,
        app_version, price_version, gross_cents, currency,
        lineage_policy, lineage_snapshot_json, stripe_payment_intent_id,
        status, state_version, created_at, updated_at
      ) VALUES (?, ?, 'usr_nate', 'dronehunter', 'usr_nate', 'v1.0.0', 1, ?, 'usd', 'maker_70_lineage_20_pool_10', '{}', ?, ?, 1, datetime('now'), datetime('now'))
    `).bind(orderId, `idempotency_${orderId}`, grossCents, piId, status).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES (?, ?, 0, 'maker', 'usr_nate', 0, 9000, ?)
    `).bind(`coa_maker_${orderId}`, orderId, makerCents).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES (?, ?, 1, 'protocol_pool', NULL, NULL, 1000, ?)
    `).bind(`coa_pool_${orderId}`, orderId, poolCents).run();

    return { orderId, piId, grossCents, makerCents, poolCents };
  }

  async function seedInboxEvent(eventId: string, eventType: string, eventData: any) {
    const rawPayload = JSON.stringify({
      id: eventId,
      type: eventType,
      api_version: '2023-10-16',
      livemode: false,
      data: { object: eventData }
    });
    const payloadSha256 = await hashPayload(rawPayload);

    await recordInboxEvent(ctx.d1, {
      eventId,
      eventType,
      apiVersion: '2023-10-16',
      livemode: false,
      payloadJson: rawPayload,
      payloadSha256,
      stripeObjectId: eventData?.id || null
    });

    return { eventId, rawPayload, payloadSha256 };
  }

  function mockStripeSucceeded(piId: string, orderId: string, grossCents: number) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: piId,
        status: 'succeeded',
        amount: grossCents,
        amount_received: grossCents,
        currency: 'usd',
        livemode: false,
        metadata: { orderId }
      })
    } as any);
  }

  describe('Inbox re-drive', () => {
    it('re-drives a retryable_failure event whose backoff window has elapsed to fulfilled', async () => {
      const { orderId, piId, grossCents } = await seedRootOrder('ord_drain_retry_1');
      const eventId = 'evt_drain_retry_1';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

      // Simulate a prior transient failure: retryable_failure with next_attempt_at in the past.
      await ctx.d1.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'retryable_failure',
            attempt_count = 1,
            last_error = 'transient config error',
            next_attempt_at = datetime('now', '-30 seconds')
        WHERE event_id = ?
      `).bind(eventId).run();

      mockStripeSucceeded(piId, orderId, grossCents);

      const summary = await runInboxDrain(defaultEnv());

      expect(summary.ran).toBe(true);
      expect(summary.candidateCount).toBe(1);
      expect(summary.processedCount).toBe(1);
      expect(summary.succeededCount).toBe(1);

      const inboxRow: any = await ctx.d1.prepare('SELECT status FROM stripe_event_inbox WHERE event_id = ?').bind(eventId).first();
      expect(inboxRow.status).toBe('processed');

      const order: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = ?').bind(orderId).first();
      expect(order.status).toBe('fulfilled');
    });

    it('does not re-drive a retryable_failure event whose backoff window has not elapsed', async () => {
      const { piId } = await seedRootOrder('ord_drain_future_1');
      const eventId = 'evt_drain_future_1';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

      await ctx.d1.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'retryable_failure',
            attempt_count = 1,
            last_error = 'transient config error',
            next_attempt_at = datetime('now', '+300 seconds')
        WHERE event_id = ?
      `).bind(eventId).run();

      const summary = await runInboxDrain(defaultEnv());

      expect(summary.candidateCount).toBe(0);
      expect(summary.processedCount).toBe(0);
    });

    it('is a safe no-op re-driving an event whose order is already fulfilled', async () => {
      const { orderId, piId, grossCents } = await seedRootOrder('ord_drain_already_done');
      const eventId = 'evt_drain_already_done';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });
      mockStripeSucceeded(piId, orderId, grossCents);

      // First drive: fulfills normally via the real processor.
      const first = await runInboxDrain(defaultEnv());
      expect(first.succeededCount).toBe(1);

      const orderAfterFirst: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = ?').bind(orderId).first();
      expect(orderAfterFirst.status).toBe('fulfilled');

      // Force the inbox row back to retryable so a second tick would pick it up again
      // (simulating a redelivered/duplicate signal racing the drain).
      await ctx.d1.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'retryable_failure',
            next_attempt_at = datetime('now', '-5 seconds'),
            claim_token = NULL,
            expires_at = NULL
        WHERE event_id = ?
      `).bind(eventId).run();

      const second = await runInboxDrain(defaultEnv());

      expect(second.candidateCount).toBe(1);
      expect(second.processedCount).toBe(1);
      expect(second.errorCount).toBe(0);

      // Order must remain fulfilled — monotonic transition guard makes this a safe no-op.
      const orderAfterSecond: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = ?').bind(orderId).first();
      expect(orderAfterSecond.status).toBe('fulfilled');
    });

    it('does not double-process an event whose lease is actively held by a concurrent webhook delivery', async () => {
      const { piId } = await seedRootOrder('ord_drain_race_1');
      const eventId = 'evt_drain_race_1';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

      // Simulate a webhook's `waitUntil` background processor currently holding
      // the claim lease (status='processing', not-yet-expired expires_at).
      const webhookClaim = await claimInboxEvent(ctx.d1, eventId, { leaseDurationSeconds: 60 });
      expect(webhookClaim.claimed).toBe(true);

      // A cron tick running concurrently must not see this as a due candidate
      // (it's in 'processing', not 'received'/'retryable_failure').
      const summary = await runInboxDrain(defaultEnv());

      expect(summary.candidateCount).toBe(0);
      expect(summary.processedCount).toBe(0);

      const inboxRow: any = await ctx.d1.prepare('SELECT status, claim_token FROM stripe_event_inbox WHERE event_id = ?').bind(eventId).first();
      expect(inboxRow.status).toBe('processing');
      expect(inboxRow.claim_token).toBe(webhookClaim.claimToken);
    });

    it('respects a bounded batch size per tick', async () => {
      for (let i = 0; i < 5; i++) {
        const orderId = `ord_drain_batch_${i}`;
        const { piId } = await seedRootOrder(orderId);
        const eventId = `evt_drain_batch_${i}`;
        await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });
        await ctx.d1.prepare(`
          UPDATE stripe_event_inbox
          SET status = 'retryable_failure', next_attempt_at = datetime('now', '-10 seconds')
          WHERE event_id = ?
        `).bind(eventId).run();
      }

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'requires_action' })
      } as any);

      const summary = await runInboxDrain(defaultEnv(), { limit: 2 });
      expect(summary.candidateCount).toBe(2);
      expect(summary.processedCount).toBe(2);
    });

    it('skips the tick cleanly when the DB binding is missing (fail-closed)', async () => {
      const summary = await runInboxDrain({} as any);
      expect(summary.ran).toBe(false);
      expect(summary.reason).toMatch(/DB binding is unavailable/i);
    });
  });

  describe('Payout drain gating', () => {
    it('skips the payout drain entirely when PAYOUTS_ENABLED is not \'true\'', async () => {
      const spy = vi.fn();
      globalThis.fetch = spy as any;

      const summary = await runTransferDrain({ ...defaultEnv(), PAYOUTS_ENABLED: 'false' });

      expect(summary.ran).toBe(false);
      expect(summary.reason).toMatch(/PAYOUTS_ENABLED/i);
      expect(summary.processedCount).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    });

    it('skips the payout drain when PAYOUTS_ENABLED is unset', async () => {
      const { PAYOUTS_ENABLED, ...rest } = defaultEnv();
      const summary = await runTransferDrain(rest as any);
      expect(summary.ran).toBe(false);
    });

    it('a full tick never touches Stripe transfer calls while payouts are off', async () => {
      const { orderId, piId, grossCents } = await seedRootOrder('ord_drain_tick_payouts_off');
      const eventId = 'evt_drain_tick_payouts_off';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

      let transferCallSeen = false;
      globalThis.fetch = vi.fn().mockImplementation(async (input: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes('/v1/transfers')) {
          transferCallSeen = true;
        }
        return {
          ok: true,
          json: async () => ({
            id: piId,
            status: 'succeeded',
            amount: grossCents,
            amount_received: grossCents,
            currency: 'usd',
            livemode: false,
            metadata: { orderId }
          })
        };
      }) as any;

      const result = await runDrainTick(defaultEnv());

      expect(result.inbox.succeededCount).toBe(1);
      expect(result.transfers.ran).toBe(false);
      expect(transferCallSeen).toBe(false);
      expect(result.recovery.ran).toBe(false);
    });
  });

  describe('Recovery drain gating', () => {
    it('skips the recovery drain entirely when PAYOUTS_ENABLED is not \'true\'', async () => {
      const spy = vi.fn();
      globalThis.fetch = spy as any;

      const summary = await runRecoveryDrain({ ...defaultEnv(), PAYOUTS_ENABLED: 'false' });

      expect(summary.ran).toBe(false);
      expect(summary.reason).toMatch(/PAYOUTS_ENABLED/i);
      expect(summary.processedCount).toBe(0);
      expect(summary.enqueuedCount).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    });

    it('skips the recovery drain when PAYOUTS_ENABLED is unset', async () => {
      const { PAYOUTS_ENABLED, ...rest } = defaultEnv();
      const summary = await runRecoveryDrain(rest as any);
      expect(summary.ran).toBe(false);
    });

    it('a full tick never touches Stripe reversal calls while payouts are off', async () => {
      let reversalCallSeen = false;
      globalThis.fetch = vi.fn().mockImplementation(async (input: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes('/reversals')) reversalCallSeen = true;
        return { ok: true, json: async () => ({ status: 'requires_action' }) };
      }) as any;

      const result = await runDrainTick(defaultEnv());
      expect(result.recovery.ran).toBe(false);
      expect(reversalCallSeen).toBe(false);
    });

    it('runs the recovery drain as part of a full tick once payouts are enabled', async () => {
      const summary = await runRecoveryDrain({ ...defaultEnv(), PAYOUTS_ENABLED: 'true' });
      expect(summary.ran).toBe(true);
      expect(summary.processedCount).toBe(0);
      expect(summary.enqueuedCount).toBe(0);
    });
  });
});
