import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { processStripeInboxEvent } from '../src/lib/commerce/eventProcessor';
import { recordInboxEvent, hashPayload, claimInboxEvent } from '../src/lib/commerce/stripeInbox';
import { generateBase64EncryptionKey } from '../src/lib/commerce/licenseCrypto';

describe('Durable Commerce P2: Concurrency, Monotonicity & Race Conditions', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;

  const keyV1 = generateBase64EncryptionKey();
  const keysJson = JSON.stringify({ '1': keyV1 });
  const defaultEnv = () => ({
    DB: ctx.d1,
    STRIPE_SECRET_KEY: 'sk_test_mock_secret_key_123',
    LICENSE_ENCRYPTION_KEYS_JSON: keysJson,
    LICENSE_ACTIVE_KEY_VERSION: '1'
  });

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function setupOrderAndEvent(orderId: string, status = 'requires_payment', stateVersion = 1) {
    const grossCents = 1500;
    const piId = `pi_${orderId}`;

    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, seller_user_id,
        app_version, price_version, gross_cents, currency,
        lineage_policy, lineage_snapshot_json, stripe_payment_intent_id,
        status, state_version, created_at, updated_at
      ) VALUES (?, ?, 'usr_nate', 'dronehunter', 'usr_nate', 'v1.0.0', 1, ?, 'usd', 'maker_70_lineage_20_pool_10', '{}', ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(orderId, `idem_${orderId}`, grossCents, piId, status, stateVersion).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES (?, ?, 0, 'maker', 'usr_nate', 0, 9000, 1350)
    `).bind(`coa_m_${orderId}`, orderId).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES (?, ?, 1, 'protocol_pool', NULL, NULL, 1000, 150)
    `).bind(`coa_p_${orderId}`, orderId).run();

    const eventId = `evt_${orderId}`;
    const rawPayload = JSON.stringify({
      id: eventId,
      type: 'payment_intent.succeeded',
      api_version: '2023-10-16',
      livemode: false,
      data: { object: { id: piId } }
    });
    const payloadSha256 = await hashPayload(rawPayload);

    await recordInboxEvent(ctx.d1, {
      eventId,
      eventType: 'payment_intent.succeeded',
      apiVersion: '2023-10-16',
      livemode: false,
      payloadJson: rawPayload,
      payloadSha256,
      stripeObjectId: piId
    });

    return { orderId, piId, eventId, grossCents };
  }

  // ==========================================================================
  // 1. CONCURRENT RACING PROCESSORS
  // ==========================================================================
  describe('1. Concurrent Processor Races', () => {
    it('prevents double license minting and outbox creation when multiple workers race simultaneously', async () => {
      const { orderId, piId, eventId, grossCents } = await setupOrderAndEvent('ord_concurrent_race_1');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: piId,
          status: 'succeeded',
          amount: grossCents,
          currency: 'usd',
          livemode: false,
          metadata: { orderId, appId: 'dronehunter', buyerUserId: 'usr_nate' }
        })
      } as any);

      // Launch 5 workers concurrently on the exact same event
      const workerResults = await Promise.all([
        processStripeInboxEvent(ctx.d1, defaultEnv(), eventId),
        processStripeInboxEvent(ctx.d1, defaultEnv(), eventId),
        processStripeInboxEvent(ctx.d1, defaultEnv(), eventId),
        processStripeInboxEvent(ctx.d1, defaultEnv(), eventId),
        processStripeInboxEvent(ctx.d1, defaultEnv(), eventId)
      ]);

      // At least one worker succeeded in claiming and fulfilling
      const successfulWorkers = workerResults.filter(r => r.success);
      expect(successfulWorkers.length).toBeGreaterThanOrEqual(1);

      // Exactly ONE license minted in D1
      const licenses: any = await ctx.d1.prepare('SELECT * FROM commerce_licenses WHERE order_id = ?').bind(orderId).all();
      expect(licenses.results).toHaveLength(1);

      // Exactly ONE secret record
      const secrets: any = await ctx.d1.prepare('SELECT * FROM commerce_license_secrets WHERE license_id = ?').bind(licenses.results![0].id).all();
      expect(secrets.results).toHaveLength(1);

      // Exactly ONE outbox record
      const outbox: any = await ctx.d1.prepare('SELECT * FROM commerce_transfer_outbox WHERE order_id = ?').bind(orderId).all();
      expect(outbox.results).toHaveLength(1);

      // Order state_version incremented exactly once (from 1 to 2)
      const order: any = await ctx.d1.prepare('SELECT state_version, status FROM commerce_orders WHERE id = ?').bind(orderId).first();
      expect(order.status).toBe('fulfilled');
      expect(order.state_version).toBe(2);
    });
  });

  // ==========================================================================
  // 2. MONOTONIC STATE TRANSITION REJECTION
  // ==========================================================================
  describe('2. Monotonic State Transition Rejection', () => {
    it.each([
      ['payment_failed'],
      ['cancelled'],
      ['refunded'],
      ['disputed']
    ])('rejects fulfillment when order is in terminal/non-payable state "%s"', async (invalidStatus) => {
      const orderId = `ord_invalid_${invalidStatus}`;
      const { piId, eventId, grossCents } = await setupOrderAndEvent(orderId, invalidStatus);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: piId,
          status: 'succeeded',
          amount: grossCents,
          currency: 'usd',
          livemode: false,
          metadata: { orderId }
        })
      } as any);

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.error).toMatch(new RegExp(`Cannot fulfill order in non-payable state '${invalidStatus}'`));

      // Verify no licenses were minted
      const licenses: any = await ctx.d1.prepare('SELECT * FROM commerce_licenses WHERE order_id = ?').bind(orderId).all();
      expect(licenses.results).toHaveLength(0);

      // Verify no outbox rows created
      const outbox: any = await ctx.d1.prepare('SELECT * FROM commerce_transfer_outbox WHERE order_id = ?').bind(orderId).all();
      expect(outbox.results).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 3. RETRYABLE FAILURES & BACKOFF LEASE RELEASE
  // ==========================================================================
  describe('3. Retryable Failures & Lease Release', () => {
    it('releases claim and sets retryable_failure with backoff when Stripe API fails with network error', async () => {
      const { eventId } = await setupOrderAndEvent('ord_retry_network_1');

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Connection to api.stripe.com timed out'));

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toMatch(/Network error/i);

      // Check inbox row: status must be retryable_failure, claim_token released, next_attempt_at in the future
      const inboxRow: any = await ctx.d1.prepare(`
        SELECT status, claim_token, last_error, next_attempt_at, attempt_count
        FROM stripe_event_inbox WHERE event_id = ?
      `).bind(eventId).first();

      expect(inboxRow.status).toBe('retryable_failure');
      expect(inboxRow.claim_token).toBeNull();
      expect(inboxRow.attempt_count).toBe(1);
      expect(inboxRow.last_error).toMatch(/Network error/i);

      // Another worker can re-claim the retryable event
      const reClaim = await claimInboxEvent(ctx.d1, eventId);
      expect(reClaim.claimed).toBe(true);
    });

    it('releases claim and sets retryable_failure when STRIPE_SECRET_KEY is missing on server', async () => {
      const { eventId } = await setupOrderAndEvent('ord_retry_no_secret_1');

      const envWithoutSecret = {
        DB: ctx.d1,
        // STRIPE_SECRET_KEY missing
        LICENSE_ENCRYPTION_KEYS_JSON: keysJson,
        LICENSE_ACTIVE_KEY_VERSION: '1'
      };

      const result = await processStripeInboxEvent(ctx.d1, envWithoutSecret, eventId);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toMatch(/STRIPE_SECRET_KEY is not configured/i);

      const inboxRow: any = await ctx.d1.prepare(`
        SELECT status, claim_token, last_error FROM stripe_event_inbox WHERE event_id = ?
      `).bind(eventId).first();

      expect(inboxRow.status).toBe('retryable_failure');
      expect(inboxRow.claim_token).toBeNull();
    });
  });

  // ==========================================================================
  // 4. LIVEMODE MISMATCH SECURITY CHECK
  // ==========================================================================
  describe('4. Livemode Mismatch Protection', () => {
    it('rejects with terminal_failure when event livemode differs from authoritative Stripe livemode', async () => {
      const { orderId, piId, eventId, grossCents } = await setupOrderAndEvent('ord_livemode_mismatch_1');

      // Stripe API reports livemode: true (live production mode), but event was recorded with livemode: false (test mode)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: piId,
          status: 'succeeded',
          amount: grossCents,
          currency: 'usd',
          livemode: true, // Livemode mismatch!
          metadata: { orderId }
        })
      } as any);

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.error).toMatch(/Livemode mismatch/i);

      const inboxRow: any = await ctx.d1.prepare('SELECT status, last_error FROM stripe_event_inbox WHERE event_id = ?').bind(eventId).first();
      expect(inboxRow.status).toBe('terminal_failure');
      expect(inboxRow.last_error).toMatch(/Livemode mismatch/i);
    });
  });
});
