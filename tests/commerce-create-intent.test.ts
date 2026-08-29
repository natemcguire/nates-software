import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as createIntentApi from '../functions/api/payments/create-intent';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';

describe('Durable Commerce /api/payments/create-intent Engine', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function createSession(userId: string, token = 'test_token_valid') {
    const tokenHash = await hashSessionToken(token);
    const expiresAt = Date.now() + 86400000;
    await ctx.d1.prepare(`
      INSERT OR REPLACE INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(tokenHash, userId, expiresAt).run();
    return token;
  }

  // ==========================================================================
  // 1. FAIL-CLOSED GUARD & DISABLED PRODUCTION BEHAVIOR
  // ==========================================================================
  describe('1. Disabled Production Guard', () => {
    it('returns 503 when PAYMENTS_ENABLED is not explicitly true', async () => {
      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/temporarily unavailable/i);
    });

    it('returns 503 when PAYMENTS_ENABLED is string "false"', async () => {
      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res = await createIntentApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, PAYMENTS_ENABLED: 'false' }
      });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
    });
  });

  // ==========================================================================
  // 2. AUTHENTICATION & HEADER VALIDATION
  // ==========================================================================
  describe('2. Authentication & Header Validation', () => {
    const env = () => ({
      DB: ctx.d1,
      PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
    });

    it('rejects unauthenticated requests with 401', async () => {
      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'key_123'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Valid authenticated session required/i);
    });

    it('rejects requests missing Idempotency-Key header with 400', async () => {
      await createSession('usr_nate', 'test_token_buyer');
      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Idempotency-Key header is required/i);
    });

    it('rejects invalid JSON body with 400', async () => {
      await createSession('usr_nate', 'test_token_buyer');
      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_valid_1'
        },
        body: 'invalid-json{'
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/valid JSON/i);
    });

    it('rejects missing or empty appId with 400', async () => {
      await createSession('usr_nate', 'test_token_buyer');
      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_valid_2'
        },
        body: JSON.stringify({})
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/appId is required/i);
    });
  });

  // ==========================================================================
  // 3. PRODUCT & APP LISTING INTEGRITY
  // ==========================================================================
  describe('3. D1 Product & Listing Authoritative State', () => {
    const env = () => ({
      DB: ctx.d1,
      PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
    });

    it('returns 404 if product is not registered in commerce_products', async () => {
      await createSession('usr_nate', 'test_token_buyer');
      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_unknown_app'
        },
        body: JSON.stringify({ appId: 'non-existent-app' })
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Product not found/i);
    });

    it('returns 400 if product is not in active status (e.g. draft or suspended)', async () => {
      await createSession('usr_nate', 'test_token_buyer');

      // Create draft product
      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
        VALUES ('draft-app', 'Draft App', 'Draft Tagline', 'Draft Desc', 'usr_nate', 'v1.0.0', 'MIT', '$10', '/data', '[]', '[]', '{}')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_products (app_id, seller_user_id, price_cents, currency, status)
        VALUES ('draft-app', 'usr_nate', 1000, 'usd', 'draft')
      `).run();

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_draft_app'
        },
        body: JSON.stringify({ appId: 'draft-app' })
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Product is not active/i);
    });
  });

  // ==========================================================================
  // 4. CLIENT PRICE/BUYER/ANCESTRY TAMPER RESISTANCE
  // ==========================================================================
  describe('4. Tamper Resistance (Ignores Client-Supplied Economics)', () => {
    it('completely ignores client-supplied customPriceCents, buyerId, makerId, ancestors, and currency', async () => {
      await createSession('usr_nate', 'test_token_buyer');

      // Mock Stripe fetch response
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pi_test_dronehunter_123',
          client_secret: 'pi_test_dronehunter_123_secret_abc'
        })
      } as any);

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_tamper_test_1'
        },
        body: JSON.stringify({
          appId: 'dronehunter',
          customPriceCents: 50, // HACKER ATTEMPT: $0.50 instead of $15.00
          buyerId: 'usr_hacker',
          makerId: 'usr_hacker',
          currency: 'eur',
          ancestors: [{ userId: 'usr_hacker', depth: 1 }]
        })
      });

      const env = {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
      };

      const res = await createIntentApi.onRequestPost({ request: req, env });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify authoritative price and currency used
      expect(data.amountCents).toBe(1500); // Authoritative $15.00, NOT 50 cents
      expect(data.currency).toBe('usd');

      // Verify order persisted in D1
      const order: any = await ctx.d1.prepare(`
        SELECT * FROM commerce_orders WHERE id = ?
      `).bind(data.orderId).first();

      expect(order).toBeTruthy();
      expect(order.gross_cents).toBe(1500);
      expect(order.currency).toBe('usd');
      expect(order.buyer_user_id).toBe('usr_nate'); // From authenticated session, NOT 'usr_hacker'
      expect(order.seller_user_id).toBe('usr_nate'); // From commerce_products
      expect(order.stripe_payment_intent_id).toBe('pi_test_dronehunter_123');
      expect(order.status).toBe('requires_payment');

      // Verify Stripe payload called with authoritative amounts
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const callArgs = (globalThis.fetch as any).mock.calls[0];
      const sentBody = new URLSearchParams(callArgs[1].body);
      expect(sentBody.get('amount')).toBe('1500');
      expect(sentBody.get('currency')).toBe('usd');
      expect(sentBody.get('metadata[buyerUserId]')).toBe('usr_nate');
      expect(sentBody.get('metadata[makerCents]')).toBe('1350');
      expect(sentBody.get('metadata[protocolPoolCents]')).toBe('150');
    });
  });

  // ==========================================================================
  // 5. ROOT AND FORK ALLOCATIONS D1 PERSISTENCE
  // ==========================================================================
  describe('5. Root & Fork Allocations D1 Atomic Persistence', () => {
    it('atomically persists root app allocations (9000 bps / 1000 bps) and order event', async () => {
      await createSession('usr_nate', 'test_token_buyer');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pi_root_order_123',
          client_secret: 'pi_root_order_123_secret_xyz'
        })
      } as any);

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_root_order_1'
        },
        body: JSON.stringify({ appId: 'certified-mailer' }) // $25.00
      });

      const env = {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
      };

      const res = await createIntentApi.onRequestPost({ request: req, env });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.amountCents).toBe(2500);

      // Verify allocations in D1
      const allocs = await ctx.d1.prepare(`
        SELECT sequence, role, recipient_user_id AS recipientUserId,
               source_repository_id AS sourceRepositoryId, lineage_depth AS lineageDepth,
               basis_points AS basisPoints, amount_cents AS amountCents
        FROM commerce_order_allocations
        WHERE order_id = ?
        ORDER BY sequence ASC
      `).bind(data.orderId).all();

      expect(allocs.results).toHaveLength(2);

      // Maker: 90% of 2500 = 2250 cents (9000 bps)
      expect(allocs.results![0]).toEqual({
        sequence: 0,
        role: 'maker',
        recipientUserId: 'usr_nate',
        sourceRepositoryId: null,
        lineageDepth: 0,
        basisPoints: 9000,
        amountCents: 2250
      });

      // Protocol Pool: 10% of 2500 = 250 cents (1000 bps)
      expect(allocs.results![1]).toEqual({
        sequence: 1,
        role: 'protocol_pool',
        recipientUserId: null,
        sourceRepositoryId: null,
        lineageDepth: null,
        basisPoints: 1000,
        amountCents: 250
      });

      // Verify events in D1
      const events = await ctx.d1.prepare(`
        SELECT event_type AS eventType, source FROM commerce_order_events
        WHERE order_id = ? ORDER BY created_at ASC
      `).bind(data.orderId).all();

      expect(events.results!.map((e: any) => e.eventType)).toContain('order_created');
      expect(events.results!.map((e: any) => e.eventType)).toContain('intent_created');
    });

    it('atomically persists fork app allocations (7000 maker / 2000 lineage / 1000 pool)', async () => {
      // 1. Setup user hierarchy: Root (usr_root) -> Parent (usr_parent) -> Maker (usr_forker)
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name)
        VALUES
          ('usr_root', 'root_dev', 'Root Dev'),
          ('usr_parent', 'parent_dev', 'Parent Dev'),
          ('usr_forker', 'forker_dev', 'Forker Dev')
      `).run();

      // 2. Setup repositories
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key)
        VALUES
          ('repo_root', 'usr_root', 'wallart-root', 'key_r'),
          ('repo_parent', 'usr_parent', 'wallart-parent', 'key_p'),
          ('repo_fork', 'usr_forker', 'wallart-fork', 'key_f')
      `).run();

      // 3. Setup fork relationships:
      // repo_parent is fork of repo_root
      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES ('repo_parent', 'repo_root', 'usr_parent', 'refs/heads/main', 'oid_1', 'oid_1', 'repo_root', 1)
      `).run();

      // repo_fork is fork of repo_parent
      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES ('repo_fork', 'repo_parent', 'usr_forker', 'refs/heads/main', 'oid_2', 'oid_2', 'repo_root', 2)
      `).run();

      // 4. Setup app_listings & commerce_products for the fork
      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
        VALUES ('wallart-custom-3d', 'Wallart Custom 3D', '3D Living Room Art', 'Custom art fork', 'usr_forker', 'v2.1.0', 'MIT', '$30.00', '/data', '[]', '[]', '{}')
      `).run();

      await ctx.d1.prepare(`
        UPDATE repositories SET app_id = 'wallart-custom-3d' WHERE id = 'repo_fork'
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status)
        VALUES ('wallart-custom-3d', 'repo_fork', 'usr_forker', 3000, 'usd', 'active')
      `).run();

      // Authenticated buyer
      await createSession('usr_nate', 'test_token_buyer');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pi_fork_order_456',
          client_secret: 'pi_fork_order_456_secret_def'
        })
      } as any);

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_fork_order_1'
        },
        body: JSON.stringify({ appId: 'wallart-custom-3d' })
      });

      const env = {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
      };

      const res = await createIntentApi.onRequestPost({ request: req, env });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.amountCents).toBe(3000);

      // Verify allocations in D1:
      // Gross = 3000 cents.
      // Maker (70%): 2100 cents (7000 bps)
      // Lineage (20%): 600 cents total (2000 bps) -> 2 ancestors = 300 cents each (1000 bps each)
      // Protocol Pool (10%): 300 cents (1000 bps)
      const allocs = await ctx.d1.prepare(`
        SELECT sequence, role, recipient_user_id AS recipientUserId,
               source_repository_id AS sourceRepositoryId, lineage_depth AS lineageDepth,
               basis_points AS basisPoints, amount_cents AS amountCents
        FROM commerce_order_allocations
        WHERE order_id = ?
        ORDER BY sequence ASC
      `).bind(data.orderId).all();

      expect(allocs.results).toHaveLength(4);

      // Sequence 0: Maker
      expect(allocs.results![0]).toEqual({
        sequence: 0,
        role: 'maker',
        recipientUserId: 'usr_forker',
        sourceRepositoryId: 'repo_fork',
        lineageDepth: 0,
        basisPoints: 7000,
        amountCents: 2100
      });

      // Sequence 1: Ancestor 1 (parent: repo_parent / usr_parent)
      expect(allocs.results![1]).toEqual({
        sequence: 1,
        role: 'ancestor',
        recipientUserId: 'usr_parent',
        sourceRepositoryId: 'repo_parent',
        lineageDepth: 1,
        basisPoints: 1000,
        amountCents: 300
      });

      // Sequence 2: Ancestor 2 (root: repo_root / usr_root)
      expect(allocs.results![2]).toEqual({
        sequence: 2,
        role: 'ancestor',
        recipientUserId: 'usr_root',
        sourceRepositoryId: 'repo_root',
        lineageDepth: 2,
        basisPoints: 1000,
        amountCents: 300
      });

      // Sequence 3: Protocol Pool
      expect(allocs.results![3]).toEqual({
        sequence: 3,
        role: 'protocol_pool',
        recipientUserId: null,
        sourceRepositoryId: null,
        lineageDepth: null,
        basisPoints: 1000,
        amountCents: 300
      });
    });
  });

  // ==========================================================================
  // 6. HONEST FAILURE HANDLING (NO FABRICATION)
  // ==========================================================================
  describe('6. Honest Failure Handling (Zero Fabrication)', () => {
    it('fails honestly when STRIPE_SECRET_KEY is not configured on server', async () => {
      await createSession('usr_nate', 'test_token_buyer');

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_no_stripe_secret'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const env = {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        // Missing STRIPE_SECRET_KEY
        STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
      };

      const res = await createIntentApi.onRequestPost({ request: req, env });
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Stripe secret key is not configured/i);

      // Verify order marked payment_failed with honest code
      const order: any = await ctx.d1.prepare(`
        SELECT status, failure_code FROM commerce_orders WHERE idempotency_key = 'key_no_stripe_secret'
      `).first();

      expect(order).toBeTruthy();
      expect(order.status).toBe('payment_failed');
      expect(order.failure_code).toBe('stripe_secret_missing');
    });

    it('fails honestly when Stripe API returns an HTTP error (e.g. 400 Bad Request)', async () => {
      await createSession('usr_nate', 'test_token_buyer');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Invalid currency parameter', code: 'parameter_invalid_empty' }
        })
      } as any);

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_stripe_err_1'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const env = {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
      };

      const res = await createIntentApi.onRequestPost({ request: req, env });
      const data = await res.json();

      expect(res.status).toBe(502);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Stripe PaymentIntent creation failed: Invalid currency parameter/);

      // Verify order status in D1 is payment_failed
      const order: any = await ctx.d1.prepare(`
        SELECT status, failure_code FROM commerce_orders WHERE idempotency_key = 'key_stripe_err_1'
      `).first();

      expect(order.status).toBe('payment_failed');
      expect(order.failure_code).toBe('parameter_invalid_empty');
    });

    it('fails honestly when Stripe network request throws', async () => {
      await createSession('usr_nate', 'test_token_buyer');

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection timed out'));

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_network_err_1'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const env = {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
      };

      const res = await createIntentApi.onRequestPost({ request: req, env });
      const data = await res.json();

      expect(res.status).toBe(502);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Failed to connect to Stripe/);

      const order: any = await ctx.d1.prepare(`
        SELECT status, failure_code FROM commerce_orders WHERE idempotency_key = 'key_network_err_1'
      `).first();

      expect(order.status).toBe('payment_failed');
      expect(order.failure_code).toBe('stripe_network_error');
    });
  });

  // ==========================================================================
  // 7. IDEMPOTENCY KEY REPLAY & CONFLICT BEHAVIOR
  // ==========================================================================
  describe('7. Idempotency Key Replay & Conflicts', () => {
    const env = () => ({
      DB: ctx.d1,
      PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
    });

    it('returns the same payment intent for identical idempotent request replays', async () => {
      await createSession('usr_nate', 'test_token_buyer');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pi_replay_123',
          client_secret: 'pi_replay_123_secret_xyz'
        })
      } as any);

      // First call
      const req1 = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_idempotency_replay'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res1 = await createIntentApi.onRequestPost({ request: req1, env: env() });
      const data1 = await res1.json();
      expect(res1.status).toBe(200);
      expect(data1.paymentIntentId).toBe('pi_replay_123');

      // Second call with same idempotency key
      const req2 = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_idempotency_replay'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res2 = await createIntentApi.onRequestPost({ request: req2, env: env() });
      const data2 = await res2.json();

      expect(res2.status).toBe(200);
      expect(data2.success).toBe(true);
      expect(data2.orderId).toBe(data1.orderId);
      expect(data2.paymentIntentId).toBe('pi_replay_123');

      // Stripe API should not be called a second time
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('rejects reusing an idempotency key for a different app with 409 Conflict', async () => {
      await createSession('usr_nate', 'test_token_buyer');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pi_replay_app1',
          client_secret: 'pi_replay_app1_secret'
        })
      } as any);

      // First call for dronehunter
      const req1 = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_conflict_test'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      await createIntentApi.onRequestPost({ request: req1, env: env() });

      // Second call for certified-mailer with SAME idempotency key
      const req2 = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_conflict_test'
        },
        body: JSON.stringify({ appId: 'certified-mailer' })
      });

      const res2 = await createIntentApi.onRequestPost({ request: req2, env: env() });
      const data2 = await res2.json();

      expect(res2.status).toBe(409);
      expect(data2.success).toBe(false);
      expect(data2.error).toMatch(/previously used for a different app/i);
    });
  });
});
