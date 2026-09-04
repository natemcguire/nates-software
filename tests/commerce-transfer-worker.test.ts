import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import {
  processTransferOutboxItem,
  claimTransferOutboxRow,
  calculateBackoffSeconds,
  buildStripeTransferPayload,
  validatePayoutWorkerConfig
} from '../src/lib/commerce/transferWorker';
import * as processTransfersApi from '../functions/api/payments/process-transfers';
import { hashPayload } from '../src/lib/commerce/stripeInbox';

describe('Commerce P3: Stripe Connect Transfer Worker & Process-Transfers Endpoint', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;

  const defaultWorkerSecret = 'payout_sec_test_secret_key_12345';
  const defaultStripeKey = 'sk_test_mock_stripe_key_abc123';

  const defaultEnv = () => ({
    DB: ctx.d1,
    PAYOUTS_ENABLED: 'true',
    STRIPE_SECRET_KEY: defaultStripeKey,
    PAYOUT_WORKER_SECRET: defaultWorkerSecret
  });

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function seedOrderAndOutbox(options?: {
    orderId?: string;
    outboxId?: string;
    userId?: string;
    stripeAccountId?: string;
    amountCents?: number;
    currency?: string;
    payoutsEnabled?: number | boolean;
    outboxStatus?: string;
    nextAttemptAtOffsetSec?: number;
    leaseExpiresAtOffsetSec?: number;
    destinationStripeAccount?: string | null;
  }) {
    const orderId = options?.orderId ?? `ord_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const outboxId = options?.outboxId ?? `cto_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const userId = options?.userId ?? 'usr_nate';
    const stripeAccountId = options?.stripeAccountId ?? 'acct_1MmockUserAccount99';
    const amountCents = options?.amountCents ?? 1350;
    const currency = options?.currency ?? 'usd';
    const payoutsEnabled = options?.payoutsEnabled !== undefined ? (options.payoutsEnabled ? 1 : 0) : 1;
    const outboxStatus = options?.outboxStatus ?? 'pending';
    const destinationStripeAccount = options?.destinationStripeAccount ?? null;

    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name)
      VALUES (?, ?, ?)
    `).bind(userId, userId.replace('usr_', ''), `User ${userId}`).run();

    if (stripeAccountId) {
      await ctx.d1.prepare(`
        INSERT OR REPLACE INTO stripe_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_status)
        VALUES (?, ?, 1, ?, 'complete')
      `).bind(userId, stripeAccountId, payoutsEnabled).run();
    }

    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, seller_user_id,
        app_version, price_version, gross_cents, currency,
        lineage_policy, lineage_snapshot_json, stripe_payment_intent_id,
        status, state_version, created_at, updated_at
      ) VALUES (?, ?, 'usr_nate', 'dronehunter', ?, 'v1.0.0', 1, 1500, ?, 'maker_70_lineage_20_pool_10', '{}', ?, 'fulfilled', 2, datetime('now'), datetime('now'))
    `).bind(
      orderId,
      `idem_${orderId}`,
      userId,
      currency,
      `pi_${orderId}`
    ).run();

    const allocId = `coa_m_${orderId}`;
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES (?, ?, 0, 'maker', ?, 0, 9000, ?)
    `).bind(allocId, orderId, userId, amountCents).run();

    const poolAllocId = `coa_p_${orderId}`;
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES (?, ?, 1, 'protocol_pool', NULL, NULL, 1000, 150)
    `).bind(poolAllocId, orderId).run();

    const nextAttemptMod = options?.nextAttemptAtOffsetSec !== undefined
      ? `datetime('now', '${options.nextAttemptAtOffsetSec >= 0 ? '+' : ''}${options.nextAttemptAtOffsetSec} seconds')`
      : `datetime('now')`;

    const leaseMod = options?.leaseExpiresAtOffsetSec !== undefined
      ? `datetime('now', '${options.leaseExpiresAtOffsetSec >= 0 ? '+' : ''}${options.leaseExpiresAtOffsetSec} seconds')`
      : `NULL`;

    await ctx.d1.prepare(`
      INSERT INTO commerce_transfer_outbox (
        id, order_id, allocation_id, destination_user_id,
        amount_cents, currency, status, attempt_count,
        available_at, next_attempt_at, lease_expires_at,
        stripe_idempotency_key, destination_stripe_account, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), ${nextAttemptMod}, ${leaseMod}, ?, ?, datetime('now'))
    `).bind(
      outboxId,
      orderId,
      allocId,
      userId,
      amountCents,
      currency,
      outboxStatus,
      `transfer:${outboxId}`,
      destinationStripeAccount
    ).run();

    return {
      orderId,
      outboxId,
      allocId,
      poolAllocId,
      userId,
      stripeAccountId,
      amountCents,
      currency
    };
  }

  function successfulTransfer(
    seed: Awaited<ReturnType<typeof seedOrderAndOutbox>>,
    id: string,
    destination = seed.stripeAccountId
  ) {
    return {
      id,
      amount: seed.amountCents,
      currency: seed.currency,
      destination,
      transfer_group: seed.orderId,
      metadata: {
        orderId: seed.orderId,
        allocationId: seed.allocId,
        outboxId: seed.outboxId
      }
    };
  }

  describe('1. Auth & Configuration Fail-Closed Guards', () => {
    it('returns 503 when PAYOUTS_ENABLED is missing or not true', async () => {
      const req = new Request('http://localhost/api/payments/process-transfers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${defaultWorkerSecret}`,
          'Content-Type': 'application/json'
        }
      });

      const res1 = await processTransfersApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, STRIPE_SECRET_KEY: defaultStripeKey, PAYOUT_WORKER_SECRET: defaultWorkerSecret }
      });
      expect(res1.status).toBe(503);
      const data1 = await res1.json();
      expect(data1.success).toBe(false);
      expect(data1.error).toMatch(/disabled/i);

      const res2 = await processTransfersApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, PAYOUTS_ENABLED: 'false', STRIPE_SECRET_KEY: defaultStripeKey, PAYOUT_WORKER_SECRET: defaultWorkerSecret }
      });
      expect(res2.status).toBe(503);
    });

    it('returns 500 when STRIPE_SECRET_KEY or PAYOUT_WORKER_SECRET is missing', async () => {
      const req = new Request('http://localhost/api/payments/process-transfers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${defaultWorkerSecret}`,
          'Content-Type': 'application/json'
        }
      });

      const res1 = await processTransfersApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, PAYOUTS_ENABLED: 'true', PAYOUT_WORKER_SECRET: defaultWorkerSecret }
      });
      expect(res1.status).toBe(500);

      const res2 = await processTransfersApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, PAYOUTS_ENABLED: 'true', STRIPE_SECRET_KEY: defaultStripeKey }
      });
      expect(res2.status).toBe(500);
    });

    it('returns 401 when Authorization header is missing or not Bearer', async () => {
      const req1 = new Request('http://localhost/api/payments/process-transfers', {
        method: 'POST'
      });
      const res1 = await processTransfersApi.onRequestPost({
        request: req1,
        env: defaultEnv()
      });
      expect(res1.status).toBe(401);

      const req2 = new Request('http://localhost/api/payments/process-transfers', {
        method: 'POST',
        headers: { 'Authorization': `Basic dXNlcjpwYXNz` }
      });
      const res2 = await processTransfersApi.onRequestPost({
        request: req2,
        env: defaultEnv()
      });
      expect(res2.status).toBe(401);
    });

    it('returns 401 when Bearer token does not match PAYOUT_WORKER_SECRET', async () => {
      const req = new Request('http://localhost/api/payments/process-transfers', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer wrong_secret_token_value' }
      });
      const res = await processTransfersApi.onRequestPost({
        request: req,
        env: defaultEnv()
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/unauthorized/i);
    });

    it('pure worker validatePayoutWorkerConfig correctly validates environment', () => {
      expect(validatePayoutWorkerConfig({ PAYOUTS_ENABLED: 'false' }).valid).toBe(false);
      expect(validatePayoutWorkerConfig({ PAYOUTS_ENABLED: 'true' }).valid).toBe(false);
      expect(validatePayoutWorkerConfig({ PAYOUTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test' }).valid).toBe(true);
    });
  });

  describe('2. Due & Lease Claims with Conditional Single-Row UPDATE', () => {
    it('claims a due pending outbox row and increments attempt_count', async () => {
      const seed = await seedOrderAndOutbox({ outboxStatus: 'pending' });

      const claim = await claimTransferOutboxRow(ctx.d1, seed.outboxId, { leaseDurationSeconds: 60 });
      expect(claim.claimed).toBe(true);
      expect(claim.claimToken).toMatch(/^clm_/);

      const row: any = await ctx.d1.prepare(`
        SELECT status, claim_token, attempt_count, lease_expires_at
        FROM commerce_transfer_outbox
        WHERE id = ?
      `).bind(seed.outboxId).first();

      expect(row.status).toBe('processing');
      expect(row.claim_token).toBe(claim.claimToken);
      expect(row.attempt_count).toBe(1);
      expect(row.lease_expires_at).toBeTruthy();
    });

    it('claims a due retryable_failure row when next_attempt_at <= now', async () => {
      const seed = await seedOrderAndOutbox({
        outboxStatus: 'retryable_failure',
        nextAttemptAtOffsetSec: -10
      });

      const claim = await claimTransferOutboxRow(ctx.d1, seed.outboxId);
      expect(claim.claimed).toBe(true);
    });

    it('does NOT claim a retryable_failure row when next_attempt_at > now (backoff active)', async () => {
      const seed = await seedOrderAndOutbox({
        outboxStatus: 'retryable_failure',
        nextAttemptAtOffsetSec: 300
      });

      const claim = await claimTransferOutboxRow(ctx.d1, seed.outboxId);
      expect(claim.claimed).toBe(false);
    });

    it('claims an expired processing lease (status=processing, lease_expires_at < now)', async () => {
      const seed = await seedOrderAndOutbox({
        outboxStatus: 'processing',
        leaseExpiresAtOffsetSec: -30
      });

      const claim = await claimTransferOutboxRow(ctx.d1, seed.outboxId, { leaseDurationSeconds: 45 });
      expect(claim.claimed).toBe(true);
    });

    it('does NOT claim an active processing lease (lease_expires_at > now)', async () => {
      const seed = await seedOrderAndOutbox({
        outboxStatus: 'processing',
        leaseExpiresAtOffsetSec: 60
      });

      const claim = await claimTransferOutboxRow(ctx.d1, seed.outboxId);
      expect(claim.claimed).toBe(false);
    });

    it('enforces exactly one changed row on claim to prevent double execution', async () => {
      const seed = await seedOrderAndOutbox({ outboxStatus: 'pending' });

      const claim1 = await claimTransferOutboxRow(ctx.d1, seed.outboxId, { leaseDurationSeconds: 60 });
      expect(claim1.claimed).toBe(true);

      const claim2 = await claimTransferOutboxRow(ctx.d1, seed.outboxId, { leaseDurationSeconds: 60 });
      expect(claim2.claimed).toBe(false);
    });
  });

  describe('3. Disabled / Missing Stripe Accounts', () => {
    it('releases claim with backoff when destination user has no stripe_accounts row', async () => {
      const seed = await seedOrderAndOutbox({
        stripeAccountId: ''
      });

      await ctx.d1.prepare(`DELETE FROM stripe_accounts WHERE user_id = ?`).bind(seed.userId).run();

      const mockFetch = vi.fn();
      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toMatch(/does not have a Stripe Connect account record/i);

      const outboxRow: any = await ctx.d1.prepare(`
        SELECT status, claim_token, last_error FROM commerce_transfer_outbox WHERE id = ?
      `).bind(seed.outboxId).first();
      expect(outboxRow.status).toBe('retryable_failure');
      expect(outboxRow.claim_token).toBeNull();
    });

    it('releases claim with backoff when destination user has payouts_enabled = 0', async () => {
      const seed = await seedOrderAndOutbox({
        payoutsEnabled: 0
      });

      const mockFetch = vi.fn();
      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toMatch(/payouts disabled/i);
    });

    it('releases claim with backoff when destination stripe_account_id is invalid format', async () => {
      const seed = await seedOrderAndOutbox();
      await ctx.d1.prepare(`
        UPDATE stripe_accounts SET stripe_account_id = 'invalid_acc_123' WHERE user_id = ?
      `).bind(seed.userId).run();

      const mockFetch = vi.fn();
      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toMatch(/invalid Stripe account ID format/i);
    });
  });

  describe('4. Destination Stripe Account Snapshot Immutability', () => {
    it('atomically snapshots destination_stripe_account before first Stripe call', async () => {
      const seed = await seedOrderAndOutbox({
        stripeAccountId: 'acct_1MsnapshotTest123',
        destinationStripeAccount: null
      });

      let capturedBody = '';
      const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = init.body;
        return new Response(JSON.stringify(successfulTransfer(seed, 'tr_success_snapshot_1')), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'request-id': 'req_snap_1' }
        });
      });

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(true);
      expect(capturedBody).toContain('destination=acct_1MsnapshotTest123');

      const outboxRow: any = await ctx.d1.prepare(`
        SELECT destination_stripe_account, status FROM commerce_transfer_outbox WHERE id = ?
      `).bind(seed.outboxId).first();
      expect(outboxRow.destination_stripe_account).toBe('acct_1MsnapshotTest123');
      expect(outboxRow.status).toBe('succeeded');
    });

    it('uses snapshotted destination_stripe_account even if user modifies stripe_accounts later', async () => {
      const snapshottedAccount = 'acct_1MoriginalSnapshot';
      const seed = await seedOrderAndOutbox({
        stripeAccountId: 'acct_1MnewAccountAfterReonboard',
        destinationStripeAccount: snapshottedAccount
      });

      let capturedBody = '';
      const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = init.body;
        return new Response(JSON.stringify(successfulTransfer(seed, 'tr_success_immut_1', snapshottedAccount)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(true);
      expect(capturedBody).toContain(`destination=${snapshottedAccount}`);
    });

    it('database trigger rejects modifying destination_stripe_account once snapshotted', async () => {
      const seed = await seedOrderAndOutbox({
        destinationStripeAccount: 'acct_1MfirstImmutable'
      });

      await expect(
        ctx.d1.prepare(`
          UPDATE commerce_transfer_outbox
          SET destination_stripe_account = 'acct_1MtamperAttempt'
          WHERE id = ?
        `).bind(seed.outboxId).run()
      ).rejects.toThrow(/commerce transfer economics are immutable/i);
    });
  });

  describe('5. Exact Canonical Request & Attempt SHA-256 Pre-Persistence', () => {
    it('sends exact parameters and persists attempt with request_sha256 before Stripe call', async () => {
      const seed = await seedOrderAndOutbox({
        amountCents: 1350,
        currency: 'usd',
        stripeAccountId: 'acct_1MexactParams99'
      });

      let capturedUrl = '';
      let capturedInit: any = null;
      let attemptStateDuringFetch: any = null;

      const mockFetch = vi.fn().mockImplementation(async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;

        attemptStateDuringFetch = await ctx.d1.prepare(`
          SELECT outbox_id, attempt_number, stripe_idempotency_key, request_sha256, outcome
          FROM commerce_transfer_attempts
          WHERE outbox_id = ?
        `).bind(seed.outboxId).first();

        return new Response(JSON.stringify(successfulTransfer(seed, 'tr_exact_12345')), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'request-id': 'req_exact_1' }
        });
      });

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(true);
      expect(capturedUrl).toBe('https://api.stripe.com/v1/transfers');
      expect(capturedInit.method).toBe('POST');
      expect(capturedInit.headers['Authorization']).toBe(`Bearer ${defaultStripeKey}`);
      expect(capturedInit.headers['Idempotency-Key']).toBe(`transfer:${seed.outboxId}`);
      expect(capturedInit.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

      const params = new URLSearchParams(capturedInit.body);
      expect(params.get('amount')).toBe('1350');
      expect(params.get('currency')).toBe('usd');
      expect(params.get('destination')).toBe('acct_1MexactParams99');
      expect(params.get('transfer_group')).toBe(seed.orderId);
      expect(params.get('metadata[orderId]')).toBe(seed.orderId);
      expect(params.get('metadata[allocationId]')).toBe(seed.allocId);
      expect(params.get('metadata[outboxId]')).toBe(seed.outboxId);

      expect(attemptStateDuringFetch).toBeTruthy();
      expect(attemptStateDuringFetch.outcome).toBe('started');
      expect(attemptStateDuringFetch.attempt_number).toBe(1);
      expect(attemptStateDuringFetch.stripe_idempotency_key).toBe(`transfer:${seed.outboxId}`);

      const expectedSha256 = await hashPayload(capturedInit.body);
      expect(attemptStateDuringFetch.request_sha256).toBe(expectedSha256);
    });
  });

  describe('6. Idempotent Retry & Stable Idempotency Key', () => {
    it('retrying a failed attempt reuses the exact stripe_idempotency_key and increments attempt_number', async () => {
      const seed = await seedOrderAndOutbox();

      const idempotencyKeysUsed: string[] = [];
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
        callCount++;
        idempotencyKeysUsed.push(init.headers['Idempotency-Key']);

        if (callCount === 1) {
          return new Response(JSON.stringify({ error: { message: 'Stripe internal error' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'request-id': 'req_fail_1' }
          });
        }
        return new Response(JSON.stringify(successfulTransfer(seed, 'tr_retry_success_99')), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'request-id': 'req_succ_2' }
        });
      });

      const res1 = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });
      expect(res1.success).toBe(false);
      expect(res1.retryable).toBe(true);

      await ctx.d1.prepare(`
        UPDATE commerce_transfer_outbox
        SET next_attempt_at = datetime('now')
        WHERE id = ?
      `).bind(seed.outboxId).run();

      const res2 = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });
      expect(res2.success).toBe(true);
      expect(res2.stripeTransferId).toBe('tr_retry_success_99');

      expect(idempotencyKeysUsed).toHaveLength(2);
      expect(idempotencyKeysUsed[0]).toBe(`transfer:${seed.outboxId}`);
      expect(idempotencyKeysUsed[1]).toBe(`transfer:${seed.outboxId}`);

      const attempts: any[] = (await ctx.d1.prepare(`
        SELECT attempt_number, outcome, stripe_transfer_id, http_status
        FROM commerce_transfer_attempts
        WHERE outbox_id = ?
        ORDER BY attempt_number ASC
      `).bind(seed.outboxId).all()).results!;

      expect(attempts).toHaveLength(2);
      expect(attempts[0].attempt_number).toBe(1);
      expect(attempts[0].outcome).toBe('retryable_failure');
      expect(attempts[0].http_status).toBe(500);

      expect(attempts[1].attempt_number).toBe(2);
      expect(attempts[1].outcome).toBe('succeeded');
      expect(attempts[1].stripe_transfer_id).toBe('tr_retry_success_99');
    });
  });

  describe('7. HTTP Response Classifications (2xx, 429, 5xx, 4xx)', () => {
    it('parks a 2xx transfer response whose economics do not match the durable request', async () => {
      const seed = await seedOrderAndOutbox();
      const mismatched = { ...successfulTransfer(seed, 'tr_mismatch_1'), amount: seed.amountCents - 1 };
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mismatched), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'request-id': 'req_mismatch_1' }
        })
      );

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.ambiguous).toBe(true);
      expect(result.errorCode).toBe('response_mismatch');
      const row: any = await ctx.d1.prepare('SELECT status, stripe_transfer_id FROM commerce_transfer_outbox WHERE id = ?')
        .bind(seed.outboxId).first();
      expect(row.status).toBe('terminal_failure');
      expect(row.stripe_transfer_id).toBeNull();
    });

    it('2xx with valid tr_ ID marks attempt + outbox succeeded and inserts audit event', async () => {
      const seed = await seedOrderAndOutbox();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successfulTransfer(seed, 'tr_valid_777')), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'request-id': 'req_ok_1' }
        })
      );

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(true);
      expect(result.stripeTransferId).toBe('tr_valid_777');
      expect(result.httpStatus).toBe(200);

      const outboxRow: any = await ctx.d1.prepare(`
        SELECT status, stripe_transfer_id, last_http_status, completed_at
        FROM commerce_transfer_outbox WHERE id = ?
      `).bind(seed.outboxId).first();
      expect(outboxRow.status).toBe('succeeded');
      expect(outboxRow.stripe_transfer_id).toBe('tr_valid_777');
      expect(outboxRow.completed_at).toBeTruthy();

      const eventRow: any = await ctx.d1.prepare(`
        SELECT event_type, source FROM commerce_order_events WHERE order_id = ? AND source = 'worker'
      `).bind(seed.orderId).first();
      expect(eventRow.event_type).toBe('transfer_succeeded');
    });

    it('2xx missing valid tr_ ID is treated as ambiguous / retryable failure', async () => {
      const seed = await seedOrderAndOutbox();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'invalid_prefix_id' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(false);
      expect(result.ambiguous).toBe(true);
      expect(result.retryable).toBe(true);

      const outboxRow: any = await ctx.d1.prepare(`
        SELECT status, stripe_transfer_id FROM commerce_transfer_outbox WHERE id = ?
      `).bind(seed.outboxId).first();
      expect(outboxRow.status).toBe('retryable_failure');
      expect(outboxRow.stripe_transfer_id).toBeNull();
    });

    it('429 Rate Limit is classified as retryable_failure with exponential backoff', async () => {
      const seed = await seedOrderAndOutbox();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'rate_limit', message: 'Too many requests' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'request-id': 'req_429_1' }
        })
      );

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.httpStatus).toBe(429);
      expect(result.stripeRequestId).toBe('req_429_1');

      const attemptRow: any = await ctx.d1.prepare(`
        SELECT outcome, http_status, error_code FROM commerce_transfer_attempts WHERE outbox_id = ?
      `).bind(seed.outboxId).first();
      expect(attemptRow.outcome).toBe('retryable_failure');
      expect(attemptRow.http_status).toBe(429);
    });

    it('503 Service Unavailable is classified as retryable_failure with exponential backoff', async () => {
      const seed = await seedOrderAndOutbox();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Service temporarily unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'request-id': 'req_503_1' }
        })
      );

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.httpStatus).toBe(503);
    });

    it('400 Bad Request (terminal 4xx) is classified as terminal_failure', async () => {
      const seed = await seedOrderAndOutbox();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'parameter_invalid_empty', message: 'Invalid parameter' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'request-id': 'req_400_1' }
        })
      );

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.httpStatus).toBe(400);

      const outboxRow: any = await ctx.d1.prepare(`
        SELECT status, last_error FROM commerce_transfer_outbox WHERE id = ?
      `).bind(seed.outboxId).first();
      expect(outboxRow.status).toBe('terminal_failure');
    });

    it('403 Forbidden is classified as terminal_failure', async () => {
      const seed = await seedOrderAndOutbox();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Account restricted' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.httpStatus).toBe(403);
    });
  });

  describe('8. Network Exceptions are Ambiguous', () => {
    it('records attempt outcome ambiguous and releases outbox as retryable_failure on fetch throw', async () => {
      const seed = await seedOrderAndOutbox();

      const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch: Connection timeout'));

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(false);
      expect(result.ambiguous).toBe(true);
      expect(result.retryable).toBe(true);
      expect(result.errorCode).toBe('network_error');

      const attemptRow: any = await ctx.d1.prepare(`
        SELECT outcome, error_code, error_message FROM commerce_transfer_attempts WHERE outbox_id = ?
      `).bind(seed.outboxId).first();
      expect(attemptRow.outcome).toBe('ambiguous');
      expect(attemptRow.error_code).toBe('network_error');

      const outboxRow: any = await ctx.d1.prepare(`
        SELECT status, claim_token FROM commerce_transfer_outbox WHERE id = ?
      `).bind(seed.outboxId).first();
      expect(outboxRow.status).toBe('retryable_failure');
      expect(outboxRow.claim_token).toBeNull();
    });
  });

  describe('9. Concurrent Execution & Race Conditions', () => {
    it('concurrent workers racing on the same row: exactly one claims and executes transfer', async () => {
      const seed = await seedOrderAndOutbox();

      let stripeCalls = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        stripeCalls++;
        return new Response(JSON.stringify(successfulTransfer(seed, 'tr_race_winner')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      const [res1, res2] = await Promise.all([
        processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, { stripeFetchOverride: mockFetch }),
        processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, { stripeFetchOverride: mockFetch })
      ]);

      expect(stripeCalls).toBe(1);

      const succeeded = [res1, res2].filter(r => r.success && r.status === 'succeeded');
      const skipped = [res1, res2].filter(r => r.skipped);

      expect(succeeded).toHaveLength(1);
      expect(skipped).toHaveLength(1);
    });
  });

  describe('10. 23-Hour Ambiguous Idempotency Window Cutoff', () => {
    it('parks terminal with manual-reconciliation error when ambiguous attempt exceeds 23 hours', async () => {
      const seed = await seedOrderAndOutbox({
        outboxStatus: 'retryable_failure'
      });

      const attemptId = `cta_old_ambiguous_${seed.outboxId}`;
      await ctx.d1.prepare(`
        INSERT INTO commerce_transfer_attempts (
          id, outbox_id, attempt_number, stripe_idempotency_key,
          request_sha256, outcome, error_code, error_message,
          started_at, completed_at
        ) VALUES (?, ?, 1, ?, ?, 'ambiguous', 'network_error', 'Timeout', datetime('now', '-24 hours'), datetime('now', '-24 hours'))
      `).bind(
        attemptId,
        seed.outboxId,
        `transfer:${seed.outboxId}`,
        'a'.repeat(64)
      ).run();

      const mockFetch = vi.fn();
      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.error).toMatch(/exceeded 23-hour safe idempotency window.*manual reconciliation required/i);

      const outboxRow: any = await ctx.d1.prepare(`
        SELECT status, last_error FROM commerce_transfer_outbox WHERE id = ?
      `).bind(seed.outboxId).first();
      expect(outboxRow.status).toBe('terminal_failure');
    });

    it('safely retries when ambiguous attempt was started within 23 hours (e.g. 2 hours ago)', async () => {
      const seed = await seedOrderAndOutbox({
        outboxStatus: 'retryable_failure'
      });

      await ctx.d1.prepare(`
        INSERT INTO commerce_transfer_attempts (
          id, outbox_id, attempt_number, stripe_idempotency_key,
          request_sha256, outcome, started_at
        ) VALUES (?, ?, 1, ?, ?, 'ambiguous', datetime('now', '-2 hours'))
      `).bind(
        `cta_recent_amb_${seed.outboxId}`,
        seed.outboxId,
        `transfer:${seed.outboxId}`,
        'b'.repeat(64)
      ).run();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successfulTransfer(seed, 'tr_reconciled_after_2h')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const result = await processTransferOutboxItem(ctx.d1, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.stripeTransferId).toBe('tr_reconciled_after_2h');
    });
  });

  describe('11. No Protocol Pool Transfers', () => {
    it('protocol pool allocations never have outbox rows created and cannot be transferred', async () => {
      const seed = await seedOrderAndOutbox();

      const poolOutbox: any = await ctx.d1.prepare(`
        SELECT id FROM commerce_transfer_outbox WHERE allocation_id = ?
      `).bind(seed.poolAllocId).first();
      expect(poolOutbox).toBeNull();
    });

    it('trigger aborts attempting to insert outbox row for protocol pool allocation', async () => {
      const seed = await seedOrderAndOutbox();

      await expect(
        ctx.d1.prepare(`
          INSERT INTO commerce_transfer_outbox (
            id, order_id, allocation_id, destination_user_id,
            amount_cents, currency, status, stripe_idempotency_key
          ) VALUES (?, ?, ?, NULL, 150, 'usd', 'pending', ?)
        `).bind(
          `cto_pool_illegal_${seed.orderId}`,
          seed.orderId,
          seed.poolAllocId,
          `transfer:cto_pool_illegal_${seed.orderId}`
        ).run()
      ).rejects.toThrow(/commerce outbox requires matching fulfilled allocation/i);
    });
  });

  describe('12. Database Write Failure After Stripe Success (Idempotency Reconciliation)', () => {
    it('leaves outbox row retryable when D1 batch throws after Stripe 200 success', async () => {
      const seed = await seedOrderAndOutbox();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(successfulTransfer(seed, 'tr_created_on_stripe')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const faultyDb = {
        ...ctx.d1,
        prepare: (q: string) => ctx.d1.prepare(q),
        batch: vi.fn().mockRejectedValue(new Error('Simulated D1 Disk Write I/O Error'))
      };

      const result = await processTransferOutboxItem(faultyDb, defaultEnv(), seed.outboxId, {
        stripeFetchOverride: mockFetch
      });

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.ambiguous).toBe(true);
      expect(result.error).toMatch(/D1 write failed after Stripe transfer creation/i);

      const outboxRow: any = await ctx.d1.prepare(`
        SELECT status FROM commerce_transfer_outbox WHERE id = ?
      `).bind(seed.outboxId).first();
      expect(outboxRow.status).toBe('retryable_failure');
    });
  });

  describe('13. Batch Execution & Parameter Rejection on POST /api/payments/process-transfers', () => {
    it('rejects caller attempts to provide amount, destination, price, or orderId overrides with 400', async () => {
      const forbiddenPayloads = [
        { destination: 'acct_hackerAccount' },
        { destination_stripe_account: 'acct_hackerAccount' },
        { amount: 99999 },
        { amount_cents: 99999 },
        { price: 5000 },
        { currency: 'eur' },
        { orderId: 'ord_fake_id' },
        { outboxId: 'cto_fake_id' },
        { stripeTransferId: 'tr_fake' }
      ];

      for (const payload of forbiddenPayloads) {
        const req = new Request('http://localhost/api/payments/process-transfers', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${defaultWorkerSecret}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const res = await processTransfersApi.onRequestPost({
          request: req,
          env: defaultEnv()
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error).toMatch(/rejects caller override parameter/i);
      }
    });

    it('processes bounded rows sequentially and reports honest per-status counts', async () => {
      const seed1 = await seedOrderAndOutbox({ orderId: 'ord_b_1', outboxId: 'cto_b_1' });
      const seed2 = await seedOrderAndOutbox({ orderId: 'ord_b_2', outboxId: 'cto_b_2' });
      await seedOrderAndOutbox({ orderId: 'ord_b_3', outboxId: 'cto_b_3' });

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        callCount++;
        const body = new URLSearchParams(init.body);
        const outboxId = body.get('metadata[outboxId]');

        if (outboxId === seed1.outboxId) {
          return new Response(JSON.stringify(successfulTransfer(seed1, 'tr_b1_ok')), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else if (outboxId === seed2.outboxId) {
          return new Response(JSON.stringify({ error: { message: 'Stripe 500' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        } else {
          return new Response(JSON.stringify({ error: { code: 'terminal_err', message: 'Stripe 400' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
      });

      const req = new Request('http://localhost/api/payments/process-transfers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${defaultWorkerSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ limit: 10 })
      });

      const res = await processTransfersApi.onRequestPost({
        request: req,
        env: defaultEnv()
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.processedCount).toBe(3);
      expect(data.succeededCount).toBe(1);
      expect(data.retryableCount).toBe(1);
      expect(data.terminalCount).toBe(1);
      expect(data.results).toHaveLength(3);
    });

    it('calculateBackoffSeconds produces bounded exponential schedule', () => {
      expect(calculateBackoffSeconds(1)).toBe(30);
      expect(calculateBackoffSeconds(2)).toBe(60);
      expect(calculateBackoffSeconds(3)).toBe(120);
      expect(calculateBackoffSeconds(4)).toBe(240);
      expect(calculateBackoffSeconds(5)).toBe(480);
      expect(calculateBackoffSeconds(6)).toBe(960);
      expect(calculateBackoffSeconds(7)).toBe(1920);
      expect(calculateBackoffSeconds(8)).toBe(3600);
      expect(calculateBackoffSeconds(20)).toBe(3600);
    });

    it('buildStripeTransferPayload produces canonical query string', () => {
      const payload = buildStripeTransferPayload(
        {
          id: 'cto_123',
          order_id: 'ord_123',
          allocation_id: 'coa_123',
          amount_cents: 1500,
          currency: 'USD'
        },
        'acct_target_123'
      );

      expect(payload.params.get('amount')).toBe('1500');
      expect(payload.params.get('currency')).toBe('usd');
      expect(payload.params.get('destination')).toBe('acct_target_123');
      expect(payload.params.get('transfer_group')).toBe('ord_123');
      expect(payload.params.get('metadata[orderId]')).toBe('ord_123');
      expect(payload.params.get('metadata[allocationId]')).toBe('coa_123');
      expect(payload.params.get('metadata[outboxId]')).toBe('cto_123');
    });
  });
});
