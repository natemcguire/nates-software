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

  describe('4. Tamper Resistance (Ignores Client-Supplied Economics)', () => {
    it('completely ignores client-supplied customPriceCents, buyerId, makerId, ancestors, and currency', async () => {
      await createSession('usr_nate', 'test_token_buyer');

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
          customPriceCents: 50,
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

      expect(data.amountCents).toBe(1500);
      expect(data.currency).toBe('usd');

      const order: any = await ctx.d1.prepare(`
        SELECT * FROM commerce_orders WHERE id = ?
      `).bind(data.orderId).first();

      expect(order).toBeTruthy();
      expect(order.gross_cents).toBe(1500);
      expect(order.currency).toBe('usd');
      expect(order.buyer_user_id).toBe('usr_nate');
      expect(order.seller_user_id).toBe('usr_nate');
      expect(order.stripe_payment_intent_id).toBe('pi_test_dronehunter_123');
      expect(order.status).toBe('requires_payment');

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const callArgs = (globalThis.fetch as any).mock.calls[0];
      const sentBody = new URLSearchParams(callArgs[1].body);
      expect(sentBody.get('amount')).toBe('1500');
      expect(sentBody.get('currency')).toBe('usd');
      expect(sentBody.get('metadata[buyerUserId]')).toBe('usr_nate');
      expect(sentBody.get('metadata[sellerCents]')).toBe('1350');
      expect(sentBody.get('metadata[platformCents]')).toBe('150');
    });
  });

  describe('5. Root & Fork Allocations D1 Atomic Persistence', () => {
    it('atomically persists root app allocations (platform 10% / seller 90%, no liens) and order event', async () => {
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
        body: JSON.stringify({ appId: 'certified-mailer' })
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

      const allocs = await ctx.d1.prepare(`
        SELECT sequence, role, recipient_user_id AS recipientUserId,
               source_repository_id AS sourceRepositoryId, lineage_depth AS lineageDepth,
               basis_points AS basisPoints, amount_cents AS amountCents
        FROM commerce_order_allocations
        WHERE order_id = ?
        ORDER BY sequence ASC
      `).bind(data.orderId).all();

      expect(allocs.results).toHaveLength(2);

      const total = allocs.results!.reduce((s: number, a: any) => s + a.amountCents, 0);
      expect(total).toBe(2500);
      expect(allocs.results!.some((a: any) => a.role === 'ancestor')).toBe(false);

      const seller = allocs.results!.find((a: any) => a.role === 'seller');
      expect(seller).toEqual({
        sequence: 1,
        role: 'seller',
        recipientUserId: 'usr_nate',
        sourceRepositoryId: null,
        lineageDepth: 0,
        basisPoints: null,
        amountCents: 2250
      });

      const platform = allocs.results!.find((a: any) => a.role === 'platform');
      expect(platform).toEqual({
        sequence: 2,
        role: 'platform',
        recipientUserId: null,
        sourceRepositoryId: null,
        lineageDepth: null,
        basisPoints: null,
        amountCents: 250
      });

      const events = await ctx.d1.prepare(`
        SELECT event_type AS eventType, source FROM commerce_order_events
        WHERE order_id = ? ORDER BY created_at ASC
      `).bind(data.orderId).all();

      expect(events.results!.map((e: any) => e.eventType)).toContain('order_created');
      expect(events.results!.map((e: any) => e.eventType)).toContain('intent_created');
    });

    it('atomically persists fork app allocations from frozen liens (platform 10%, two 10% ancestor liens, seller remainder)', async () => {

      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name)
        VALUES
          ('usr_root', 'root_dev', 'Root Dev'),
          ('usr_parent', 'parent_dev', 'Parent Dev'),
          ('usr_forker', 'forker_dev', 'Forker Dev')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key)
        VALUES
          ('repo_root', 'usr_root', 'wallart-root', 'key_r'),
          ('repo_parent', 'usr_parent', 'wallart-parent', 'key_p'),
          ('repo_fork', 'usr_forker', 'wallart-fork', 'key_f')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES ('repo_parent', 'repo_root', 'usr_parent', 'refs/heads/main', 'oid_1', 'oid_1', 'repo_root', 1)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES ('repo_fork', 'repo_parent', 'usr_forker', 'refs/heads/main', 'oid_2', 'oid_2', 'repo_root', 2)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_fork_liens (
          id, holder_of_repository_id, ancestor_repository_id, ancestor_user_id, bps, depth
        ) VALUES
          ('rfl_1', 'repo_fork', 'repo_parent', 'usr_parent', 1000, 1),
          ('rfl_2', 'repo_fork', 'repo_root', 'usr_root', 1000, 2)
      `).run();

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

      const allocs = await ctx.d1.prepare(`
        SELECT sequence, role, recipient_user_id AS recipientUserId,
               source_repository_id AS sourceRepositoryId, lineage_depth AS lineageDepth,
               basis_points AS basisPoints, amount_cents AS amountCents
        FROM commerce_order_allocations
        WHERE order_id = ?
        ORDER BY sequence ASC
      `).bind(data.orderId).all();

      expect(allocs.results).toHaveLength(4);

      const total = allocs.results!.reduce((s: number, a: any) => s + a.amountCents, 0);
      expect(total).toBe(3000);

      expect(allocs.results![0]).toEqual({
        sequence: 1,
        role: 'ancestor',
        recipientUserId: 'usr_root',
        sourceRepositoryId: 'repo_root',
        lineageDepth: 2,
        basisPoints: 1000,
        amountCents: 270
      });

      expect(allocs.results![1]).toEqual({
        sequence: 2,
        role: 'ancestor',
        recipientUserId: 'usr_parent',
        sourceRepositoryId: 'repo_parent',
        lineageDepth: 1,
        basisPoints: 1000,
        amountCents: 270
      });

      expect(allocs.results![2]).toEqual({
        sequence: 3,
        role: 'seller',
        recipientUserId: 'usr_forker',
        sourceRepositoryId: 'repo_fork',
        lineageDepth: 0,
        basisPoints: null,
        amountCents: 2160
      });

      expect(allocs.results![3]).toEqual({
        sequence: 4,
        role: 'platform',
        recipientUserId: null,
        sourceRepositoryId: null,
        lineageDepth: null,
        basisPoints: null,
        amountCents: 300
      });

      expect(allocs.results!.some((a: any) => a.role === 'maker' || a.role === 'protocol_pool' || a.role === 'contributor')).toBe(false);
    });
  });

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

        STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
      };

      const res = await createIntentApi.onRequestPost({ request: req, env });
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Stripe secret key is not configured/i);

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

  describe('6B. Orphaned PaymentIntent recovery on "creating" retry (Codex #6)', () => {
    const env = () => ({
      DB: ctx.d1,
      PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
    });

    async function seedOrphanedCreatingOrder(orderId: string, idempotencyKey: string) {
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, repository_id,
          seller_user_id, app_version, price_version, gross_cents,
          currency, lineage_policy, lineage_snapshot_json, status,
          created_at, updated_at
        ) VALUES (?, ?, 'usr_nate', 'dronehunter', NULL, 'usr_nate', 'v1.0.0', 1, 1500, 'usd', 'maker_70_lineage_20_pool_10', ?, 'creating', datetime('now'), datetime('now'))
      `).bind(orderId, idempotencyKey, JSON.stringify({ isRoot: true })).run();
    }

    it('retries a "creating" order by retrieving the SAME PaymentIntent from Stripe (idempotency replay) and re-attaches it instead of stranding it', async () => {
      await createSession('usr_nate', 'test_token_buyer');
      await seedOrphanedCreatingOrder('ord_orphaned_1', 'key_orphan_recovery_1');

      const stripeMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pi_orphaned_original_999',
          client_secret: 'pi_orphaned_original_999_secret'
        })
      } as any);
      globalThis.fetch = stripeMock;

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_orphan_recovery_1'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.orderId).toBe('ord_orphaned_1');
      expect(data.paymentIntentId).toBe('pi_orphaned_original_999');
      expect(data.clientSecret).toBe('pi_orphaned_original_999_secret');
      expect(data.status).toBe('requires_payment');

      expect(stripeMock).toHaveBeenCalledTimes(1);
      const callHeaders = (stripeMock.mock.calls[0][1] as any).headers;
      expect(callHeaders['Idempotency-Key']).toBe('pi_ord_orphaned_1');

      const order: any = await ctx.d1.prepare(`
        SELECT status, stripe_payment_intent_id AS piId FROM commerce_orders WHERE id = ?
      `).bind('ord_orphaned_1').first();
      expect(order.status).toBe('requires_payment');
      expect(order.piId).toBe('pi_orphaned_original_999');

      const events: any = await ctx.d1.prepare(`
        SELECT event_type AS eventType FROM commerce_order_events WHERE order_id = ?
      `).bind('ord_orphaned_1').all();
      expect(events.results!.map((e: any) => e.eventType)).toContain('intent_recovered');
    });

    it('fails closed and honestly (does not fabricate a PI) when Stripe is unreachable during recovery, and leaves the order recoverable', async () => {
      await createSession('usr_nate', 'test_token_buyer');
      await seedOrphanedCreatingOrder('ord_orphaned_2', 'key_orphan_recovery_2');

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection timed out'));

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_orphan_recovery_2'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(502);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Failed to connect to Stripe/i);

      const order: any = await ctx.d1.prepare(`
        SELECT status, stripe_payment_intent_id AS piId FROM commerce_orders WHERE id = ?
      `).bind('ord_orphaned_2').first();
      expect(order.status).toBe('creating');
      expect(order.piId).toBeNull();
    });

    it('does not orphan the order when the D1 attach write fails after Stripe successfully creates a fresh PaymentIntent (new order path)', async () => {
      await createSession('usr_nate', 'test_token_buyer');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pi_fresh_attach_fail_1',
          client_secret: 'pi_fresh_attach_fail_1_secret'
        })
      } as any);

      const originalBatch = ctx.d1.batch.bind(ctx.d1);
      let batchCallCount = 0;
      vi.spyOn(ctx.d1, 'batch').mockImplementation(async (stmts: any) => {
        batchCallCount += 1;

        if (batchCallCount === 2) {
          throw new Error('simulated D1 outage during PI attach');
        }
        return originalBatch(stmts);
      });

      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_attach_fail_1'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Retry with the same Idempotency-Key/i);

      vi.restoreAllMocks();

      const order: any = await ctx.d1.prepare(`
        SELECT status, stripe_payment_intent_id AS piId FROM commerce_orders WHERE idempotency_key = 'key_attach_fail_1'
      `).first();
      expect(order.status).toBe('creating');
      expect(order.piId).toBeNull();

      const retryStripeMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pi_fresh_attach_fail_1',
          client_secret: 'pi_fresh_attach_fail_1_secret'
        })
      } as any);
      globalThis.fetch = retryStripeMock;

      const retryReq = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_token_buyer',
          'Idempotency-Key': 'key_attach_fail_1'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const retryRes = await createIntentApi.onRequestPost({ request: retryReq, env: env() });
      const retryData = await retryRes.json();

      expect(retryRes.status).toBe(200);
      expect(retryData.success).toBe(true);
      expect(retryData.paymentIntentId).toBe('pi_fresh_attach_fail_1');

      const recoveredOrder: any = await ctx.d1.prepare(`
        SELECT status, stripe_payment_intent_id AS piId FROM commerce_orders WHERE idempotency_key = 'key_attach_fail_1'
      `).first();
      expect(recoveredOrder.status).toBe('requires_payment');
      expect(recoveredOrder.piId).toBe('pi_fresh_attach_fail_1');
    });
  });

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
