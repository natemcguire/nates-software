import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { processStripeInboxEvent } from '../src/lib/commerce/eventProcessor';
import { recordInboxEvent, hashPayload, claimInboxEvent } from '../src/lib/commerce/stripeInbox';
import { generateBase64EncryptionKey } from '../src/lib/commerce/licenseCrypto';

describe('Durable Commerce P2: Authoritative Event Processor & Fulfillment State Machine', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;

  const keyV1 = generateBase64EncryptionKey();
  const keysJson = JSON.stringify({ '1': keyV1 });
  const defaultEnv = () => ({
    DB: ctx.d1,
    STRIPE_SECRET_KEY: 'sk_test_mock_secret_key_123',
    STRIPE_LIVEMODE: 'false',
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

  // Helper to create a root order (dronehunter, $15.00)
  async function seedRootOrder(orderId = 'ord_root_test_1', status = 'requires_payment') {
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

    // Allocation 0: Maker
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES (?, ?, 0, 'maker', 'usr_nate', 0, 9000, ?)
    `).bind(`coa_maker_${orderId}`, orderId, makerCents).run();

    // Allocation 1: Protocol Pool
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES (?, ?, 1, 'protocol_pool', NULL, NULL, 1000, ?)
    `).bind(`coa_pool_${orderId}`, orderId, poolCents).run();

    return { orderId, piId, grossCents, makerCents, poolCents };
  }

  // Helper to record an event in stripe_event_inbox
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

  // ==========================================================================
  // 1. CONDITIONAL FINITE LEASES & CONCURRENT LOCKING
  // ==========================================================================
  describe('1. Finite Leases & Claim Locks', () => {
    it('claims an available event and prevents concurrent execution with active lease', async () => {
      const eventId = 'evt_lease_test_1';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: 'pi_test_1' });

      // First claim succeeds
      const claim1 = await claimInboxEvent(ctx.d1, eventId, { leaseDurationSeconds: 60 });
      expect(claim1.claimed).toBe(true);

      // Second claim with active lease fails
      const claim2 = await claimInboxEvent(ctx.d1, eventId, { leaseDurationSeconds: 60 });
      expect(claim2.claimed).toBe(false);
    });

    it('allows claiming an event whose finite lease has expired', async () => {
      const eventId = 'evt_lease_expired_test';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: 'pi_test_expired' });

      // Simulate expired claim (claimed 10 minutes ago with expires_at in the past)
      await ctx.d1.prepare(`
        UPDATE stripe_event_inbox
        SET status = 'processing',
            claim_token = 'clm_stale_token',
            claimed_at = datetime('now', '-600 seconds'),
            expires_at = datetime('now', '-500 seconds')
        WHERE event_id = ?
      `).bind(eventId).run();

      // New worker can re-claim expired lease
      const claim = await claimInboxEvent(ctx.d1, eventId, { leaseDurationSeconds: 60 });
      expect(claim.claimed).toBe(true);
      expect(claim.claimToken).not.toBe('clm_stale_token');
    });
  });

  // ==========================================================================
  // 2. UNSUPPORTED LIFECYCLE EVENTS GUARD (FAIL-CLOSED)
  // ==========================================================================
  describe('2. Unsupported Lifecycle Events (Refunds/Disputes Fail-Closed)', () => {
    it.each([
      ['charge.refunded', { id: 'ch_refund_1', metadata: { orderId: 'ord_1' } }],
      ['charge.expired', { id: 'ch_exp_1', metadata: { orderId: 'ord_1' } }],
      ['payment_intent.payment_failed', { id: 'pi_fail_1', metadata: { orderId: 'ord_1' } }],
      ['customer.subscription.created', { id: 'sub_1' }]

    ])('marks unsupported event %s as terminal_failure with explicit error', async (eventType, objectData) => {
      const eventId = `evt_unsupported_${eventType.replace(/\./g, '_')}`;
      await seedInboxEvent(eventId, eventType, objectData);

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.error).toMatch(/Explicitly unsupported event type/i);

      // Verify row in D1 marked terminal_failure
      const inboxRow: any = await ctx.d1.prepare(`
        SELECT status, last_error FROM stripe_event_inbox WHERE event_id = ?
      `).bind(eventId).first();

      expect(inboxRow.status).toBe('terminal_failure');
      expect(inboxRow.last_error).toMatch(/Explicitly unsupported event type/i);
    });
  });

  // ==========================================================================
  // 3. AUTHORITATIVE STRIPE RE-FETCH & TAMPER RESISTANCE
  // ==========================================================================
  describe('3. Authoritative Stripe Re-fetch & Tamper Resistance', () => {
    it('re-fetches Stripe PaymentIntent and verifies status is succeeded', async () => {
      const { orderId, piId, grossCents } = await seedRootOrder('ord_tamper_1');
      const eventId = 'evt_tamper_status';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

      // Mock Stripe returning status 'requires_action' instead of 'succeeded'
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: piId,
          status: 'requires_action', // Not succeeded!
          amount: grossCents,
          currency: 'usd',
          livemode: false,
          metadata: { orderId }
        })
      } as any);

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.error).toMatch(/status is 'requires_action', expected 'succeeded'/i);

      // Order remains in requires_payment
      const order: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = ?').bind(orderId).first();
      expect(order.status).toBe('requires_payment');
    });

    it('rejects when Stripe gross amount does not match immutable order gross cents', async () => {
      const { orderId, piId } = await seedRootOrder('ord_tamper_amount');
      const eventId = 'evt_tamper_amount';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

      // Stripe amount ($10.00) differs from order ($15.00)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: piId,
          status: 'succeeded',
          amount: 1000, // Tampered amount!
          currency: 'usd',
          livemode: false,
          metadata: { orderId }
        })
      } as any);

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.error).toMatch(/Gross amount mismatch/i);
    });

    it('rejects when Stripe currency does not match immutable order currency', async () => {
      const { orderId, piId, grossCents } = await seedRootOrder('ord_tamper_currency');
      const eventId = 'evt_tamper_currency';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: piId,
          status: 'succeeded',
          amount: grossCents,
          amount_received: grossCents,
          currency: 'eur', // Tampered currency!
          livemode: false,
          metadata: { orderId }
        })
      } as any);

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.error).toMatch(/Currency mismatch/i);
    });

    it('rejects when Stripe metadata does not contain orderId or references non-existent order', async () => {
      const eventId = 'evt_tamper_missing_order';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: 'pi_no_order' });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pi_no_order',
          status: 'succeeded',
          amount: 1500,
          amount_received: 1500,
          currency: 'usd',
          livemode: false,
          metadata: {} // Missing orderId!
        })
      } as any);

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.error).toMatch(/metadata does not contain orderId/i);
    });
  });

  // ==========================================================================
  // 4. MONOTONIC STATE TRANSITIONS & ATOMIC FULFILLMENT (ROOT APP)
  // ==========================================================================
  describe('4. Atomic Fulfillment & Economic Conservation (Root App)', () => {
    it('atomically fulfills root order: updates order state_version, mints license + AES-GCM secret, and creates 1 maker outbox row (never pool)', async () => {
      const { orderId, piId, grossCents, makerCents } = await seedRootOrder('ord_root_fulfill_1');
      const eventId = 'evt_root_fulfill_1';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: piId,
          status: 'succeeded',
          amount: grossCents,
          amount_received: grossCents,
          currency: 'usd',
          livemode: false,
          metadata: { orderId, appId: 'dronehunter', buyerUserId: 'usr_nate' }
        })
      } as any);

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(true);
      expect(result.orderId).toBe(orderId);
      expect(result.status).toBe('fulfilled');
      expect(result.outboxCount).toBe(1); // Only maker; protocol pool has NO outbox row

      // 1. Verify commerce_orders updated to 'fulfilled' with state_version = 2
      const order: any = await ctx.d1.prepare(`
        SELECT status, state_version, paid_at, fulfilled_at FROM commerce_orders WHERE id = ?
      `).bind(orderId).first();

      expect(order.status).toBe('fulfilled');
      expect(order.state_version).toBe(2);
      expect(order.paid_at).toBeTruthy();
      expect(order.fulfilled_at).toBeTruthy();

      // 2. Verify exactly ONE canonical commerce_licenses record
      const licenses: any = await ctx.d1.prepare(`
        SELECT * FROM commerce_licenses WHERE order_id = ?
      `).bind(orderId).all();

      expect(licenses.results).toHaveLength(1);
      const lic = licenses.results![0];
      expect(lic.app_id).toBe('dronehunter');
      expect(lic.owner_user_id).toBe('usr_nate');
      expect(lic.license_key_hash).toHaveLength(64);
      expect(lic.license_key_last4).toHaveLength(4);
      expect(lic.status).toBe('active');

      // 3. Verify AES-256-GCM secret row in commerce_license_secrets
      const secrets: any = await ctx.d1.prepare(`
        SELECT * FROM commerce_license_secrets WHERE license_id = ?
      `).bind(lic.id).all();

      expect(secrets.results).toHaveLength(1);
      const secret = secrets.results![0];
      expect(secret.algorithm).toBe('AES-256-GCM');
      expect(secret.key_version).toBe(1);
      expect(secret.ciphertext_base64).toBeTruthy();
      expect(secret.iv_base64).toBeTruthy();

      // 4. Verify secret creation event
      const secretEvents: any = await ctx.d1.prepare(`
        SELECT * FROM commerce_license_secret_events WHERE license_id = ?
      `).bind(lic.id).all();

      expect(secretEvents.results).toHaveLength(1);
      expect(secretEvents.results![0].event_type).toBe('created');
      expect(secretEvents.results![0].to_key_version).toBe(1);

      // 5. Verify exactly ONE outbox row for Maker (never protocol pool)
      const outbox: any = await ctx.d1.prepare(`
        SELECT * FROM commerce_transfer_outbox WHERE order_id = ?
      `).bind(orderId).all();

      expect(outbox.results).toHaveLength(1);
      const outboxRow = outbox.results![0];
      expect(outboxRow.destination_user_id).toBe('usr_nate');
      expect(outboxRow.amount_cents).toBe(makerCents); // 1350 cents ($13.50 = 90%)
      expect(outboxRow.currency).toBe('usd');
      expect(outboxRow.status).toBe('pending');

      // 6. Verify legacy shelf_items table is NOT dual-written (remains only seeded 3 rows)
      const shelfRows: any = await ctx.d1.prepare(`
        SELECT * FROM shelf_items WHERE id NOT IN ('shelf_1', 'shelf_2', 'shelf_3')
      `).all();
      expect(shelfRows.results).toHaveLength(0);

      // 7. Verify stripe_event_inbox is marked 'processed'
      const inbox: any = await ctx.d1.prepare(`
        SELECT status, processed_at, last_error FROM stripe_event_inbox WHERE event_id = ?
      `).bind(eventId).first();

      expect(inbox.status).toBe('processed');
      expect(inbox.processed_at).toBeTruthy();
      expect(inbox.last_error).toBeNull();
    });
  });

  // ==========================================================================
  // 5. FORK ALLOCATION OUTBOX BATCHING (70% MAKER / 20% ANCESTORS / 10% POOL)
  // ==========================================================================
  describe('5. Fork Order Fulfillment & Lineage Outbox Batching', () => {
    it('creates outbox rows for Maker and each Ancestor in the chain (never protocol pool)', async () => {
      // 1. Create users
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name)
        VALUES ('usr_root_dev', 'root_dev', 'Root'),
               ('usr_parent_dev', 'parent_dev', 'Parent'),
               ('usr_fork_dev', 'fork_dev', 'Forker'),
               ('usr_buyer_dev', 'buyer_dev', 'Buyer')
      `).run();

      const orderId = 'ord_fork_fulfill_1';
      const piId = `pi_${orderId}`;
      const grossCents = 3000; // $30.00
      const makerCents = 2100; // 70%
      const anc1Cents = 300;   // 10%
      const anc2Cents = 300;   // 10%
      const poolCents = 300;   // 10%

      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency,
          lineage_policy, lineage_snapshot_json, stripe_payment_intent_id,
          status, state_version
        ) VALUES (?, 'key_fork_1', 'usr_buyer_dev', 'dronehunter', 'usr_fork_dev', 'v2.0.0', 1, ?, 'usd', 'maker_70_lineage_20_pool_10', '{}', ?, 'requires_payment', 1)
      `).bind(orderId, grossCents, piId).run();

      // Allocations:
      // Seq 0: Maker ($21.00)
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (id, order_id, sequence, role, recipient_user_id, lineage_depth, basis_points, amount_cents)
        VALUES ('coa_f_0', ?, 0, 'maker', 'usr_fork_dev', 0, 7000, ?)
      `).bind(orderId, makerCents).run();

      // Seq 1: Ancestor 1 ($3.00)
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (id, order_id, sequence, role, recipient_user_id, lineage_depth, basis_points, amount_cents)
        VALUES ('coa_f_1', ?, 1, 'ancestor', 'usr_parent_dev', 1, 1000, ?)
      `).bind(orderId, anc1Cents).run();

      // Seq 2: Ancestor 2 ($3.00)
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (id, order_id, sequence, role, recipient_user_id, lineage_depth, basis_points, amount_cents)
        VALUES ('coa_f_2', ?, 2, 'ancestor', 'usr_root_dev', 2, 1000, ?)
      `).bind(orderId, anc2Cents).run();

      // Seq 3: Protocol Pool ($3.00)
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (id, order_id, sequence, role, recipient_user_id, lineage_depth, basis_points, amount_cents)
        VALUES ('coa_f_3', ?, 3, 'protocol_pool', NULL, NULL, 1000, ?)
      `).bind(orderId, poolCents).run();

      const eventId = 'evt_fork_fulfill_1';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: piId,
          status: 'succeeded',
          amount: grossCents,
          amount_received: grossCents,
          currency: 'usd',
          livemode: false,
          metadata: { orderId, appId: 'dronehunter', buyerUserId: 'usr_buyer_dev' }
        })
      } as any);

      const result = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);

      expect(result.success).toBe(true);
      expect(result.outboxCount).toBe(3); // Maker + Ancestor 1 + Ancestor 2 (never protocol pool)

      const outboxRows: any = await ctx.d1.prepare(`
        SELECT destination_user_id, amount_cents FROM commerce_transfer_outbox
        WHERE order_id = ? ORDER BY amount_cents DESC
      `).bind(orderId).all();

      expect(outboxRows.results).toHaveLength(3);
      expect(outboxRows.results![0]).toEqual({ destination_user_id: 'usr_fork_dev', amount_cents: 2100 });
      expect(outboxRows.results![1]).toEqual({ destination_user_id: 'usr_parent_dev', amount_cents: 300 });
      expect(outboxRows.results![2]).toEqual({ destination_user_id: 'usr_root_dev', amount_cents: 300 });
    });
  });

  // ==========================================================================
  // 6. RACING PROCESSORS & CONCURRENCY SAFETY
  // ==========================================================================
  describe('6. Concurrency Safety & Race Idempotency', () => {
    it('handles duplicate delivery / racing processors safely without double fulfillment', async () => {
      const { orderId, piId, grossCents } = await seedRootOrder('ord_race_test_1');
      const eventId = 'evt_race_test_1';
      await seedInboxEvent(eventId, 'payment_intent.succeeded', { id: piId });

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

      // First processor execution
      const res1 = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);
      expect(res1.success).toBe(true);
      expect(res1.status).toBe('fulfilled');

      // Second processor execution (e.g. duplicate webhook delivery or concurrent worker)
      const res2 = await processStripeInboxEvent(ctx.d1, defaultEnv(), eventId);
      expect(res2.success).toBe(true);
      expect(res2.duplicate).toBe(true);

      // Verify exactly ONE license was minted in total
      const licenses: any = await ctx.d1.prepare('SELECT * FROM commerce_licenses WHERE order_id = ?').bind(orderId).all();
      expect(licenses.results).toHaveLength(1);

      // Verify exactly ONE outbox row in total
      const outbox: any = await ctx.d1.prepare('SELECT * FROM commerce_transfer_outbox WHERE order_id = ?').bind(orderId).all();
      expect(outbox.results).toHaveLength(1);
    });
  });
});
