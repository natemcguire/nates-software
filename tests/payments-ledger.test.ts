import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as ledgerApi from '../functions/api/payments/ledger';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';

describe('Scoped Seller Ledger Endpoint (functions/api/payments/ledger)', () => {
  let ctx: TestD1Context;
  let testEnv: any;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    testEnv = {
      DB: ctx.d1
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createSession(userId: string, token: string) {
    const tokenHash = await hashSessionToken(token);
    const expiresAt = Date.now() + 86400000;
    await ctx.d1.prepare(`
      INSERT OR REPLACE INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(tokenHash, userId, expiresAt).run();
    return token;
  }

  async function seedTestUsersAndApps() {
    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name, avatar_url, role)
      VALUES
        ('usr_seller_a', 'seller_alice', 'Alice Seller', '👩‍💻', 'maker'),
        ('usr_seller_b', 'seller_bob', 'Bob Seller', '👨‍💻', 'maker'),
        ('usr_buyer_1', 'buyer_charlie', 'Charlie Buyer', '🛒', 'user')
    `).run();

    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO app_listings (id, creator_id, name, tagline, description, price, version, listing_status)
      VALUES
        ('app_alpha', 'usr_seller_a', 'Alpha App', 'A cool utility', 'Description for Alpha App', '$20.00', 'v1.0.0', 'active'),
        ('app_beta', 'usr_seller_b', 'Beta App', 'Another utility', 'Description for Beta App', '$30.00', 'v1.0.0', 'active')
    `).run();
  }

  describe('1. Authentication & Method Restrictions', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const req = new Request('http://localhost/api/payments/ledger', { method: 'GET' });
      const res = await ledgerApi.onRequestGet({ request: req, env: testEnv });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/authenticated session required/i);
    });

    it('rejects non-GET HTTP methods with 405 Method Not Allowed', async () => {
      const resPost = await ledgerApi.onRequestPost();
      expect(resPost.status).toBe(405);
      expect(resPost.headers.get('Allow')).toBe('GET');

      const resPut = await ledgerApi.onRequestPut();
      expect(resPut.status).toBe(405);

      const resDelete = await ledgerApi.onRequestDelete();
      expect(resDelete.status).toBe(405);
    });
  });

  describe('2. Empty State & Authentication', () => {
    it('returns empty ledger when authenticated seller has no orders', async () => {
      await seedTestUsersAndApps();
      await createSession('usr_seller_a', 'token_alice');

      const req = new Request('http://localhost/api/payments/ledger', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const res = await ledgerApi.onRequestGet({ request: req, env: testEnv });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.sellerId).toBe('usr_seller_a');
      expect(data.orders).toEqual([]);
      expect(data.summary).toEqual({
        totalOrders: 0,
        totalGrossCents: 0,
        totalEarnedCents: 0,
        settledCents: 0,
        pendingCents: 0
      });
    });
  });

  describe('3. Fulfilled Orders, Allocations, and Outbox Status', () => {
    it('returns fulfilled orders with per-order allocations and transfer outbox status', async () => {
      await seedTestUsersAndApps();
      await createSession('usr_seller_a', 'token_alice');


      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json,
          status, fulfilled_at
        ) VALUES (
          'ord_101', 'idemp_101', 'usr_buyer_1', 'app_alpha', 'usr_seller_a',
          'v1.0.0', 1, 2000, 'usd', '[]',
          'fulfilled', '2026-08-30 12:00:00'
        )
      `).run();


      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES
          ('alloc_101_maker', 'ord_101', 0, 'maker', 'usr_seller_a', 9000, 1800),
          ('alloc_101_pool', 'ord_101', 1, 'protocol_pool', NULL, 1000, 200)
      `).run();


      await ctx.d1.prepare(`
        INSERT INTO commerce_transfer_outbox (
          id, order_id, allocation_id, destination_user_id, amount_cents, currency,
          status, stripe_transfer_id, completed_at
        ) VALUES (
          'xfer_101', 'ord_101', 'alloc_101_maker', 'usr_seller_a', 1800, 'usd',
          'succeeded', 'tr_stripe_101', '2026-08-30 12:05:00'
        )
      `).run();

      const req = new Request('http://localhost/api/payments/ledger', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const res = await ledgerApi.onRequestGet({ request: req, env: testEnv });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.sellerId).toBe('usr_seller_a');
      expect(data.orders).toHaveLength(1);

      const order = data.orders[0];
      expect(order.id).toBe('ord_101');
      expect(order.appName).toBe('Alpha App');
      expect(order.grossCents).toBe(2000);
      expect(order.callerEarnedCents).toBe(1800);
      expect(order.isSettled).toBe(true);
      expect(order.transferStatus).toBe('succeeded');
      expect(order.allocations).toHaveLength(2);

      const makerAlloc = order.allocations.find((a: any) => a.role === 'maker');
      expect(makerAlloc.recipientUserId).toBe('usr_seller_a');
      expect(makerAlloc.transfer.status).toBe('succeeded');
      expect(makerAlloc.transfer.stripeTransferId).toBe('tr_stripe_101');
      expect(makerAlloc.transfer.isSettled).toBe(true);

      expect(data.summary).toEqual({
        totalOrders: 1,
        totalGrossCents: 2000,
        totalEarnedCents: 1800,
        settledCents: 1800,
        pendingCents: 0
      });
    });

    it('correctly tracks pending transfer status and non-fulfilled order exclusion', async () => {
      await seedTestUsersAndApps();
      await createSession('usr_seller_a', 'token_alice');


      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json,
          status, fulfilled_at
        ) VALUES (
          'ord_fulfilled_pending', 'idemp_p1', 'usr_buyer_1', 'app_alpha', 'usr_seller_a',
          'v1.0.0', 1, 2000, 'usd', '[]',
          'fulfilled', '2026-08-30 14:00:00'
        )
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES
          ('alloc_fp_maker', 'ord_fulfilled_pending', 0, 'maker', 'usr_seller_a', 9000, 1800)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_transfer_outbox (
          id, order_id, allocation_id, destination_user_id, amount_cents, currency,
          status
        ) VALUES (
          'xfer_fp', 'ord_fulfilled_pending', 'alloc_fp_maker', 'usr_seller_a', 1800, 'usd',
          'pending'
        )
      `).run();


      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json,
          status
        ) VALUES (
          'ord_unfulfilled', 'idemp_u1', 'usr_buyer_1', 'app_alpha', 'usr_seller_a',
          'v1.0.0', 1, 2000, 'usd', '[]',
          'requires_payment'
        )
      `).run();

      const req = new Request('http://localhost/api/payments/ledger', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const res = await ledgerApi.onRequestGet({ request: req, env: testEnv });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.orders).toHaveLength(1);
      expect(data.orders[0].id).toBe('ord_fulfilled_pending');
      expect(data.orders[0].isSettled).toBe(false);
      expect(data.orders[0].transferStatus).toBe('pending');
      expect(data.summary.pendingCents).toBe(1800);
      expect(data.summary.settledCents).toBe(0);
    });
  });

  describe('4. Caller-Scoping & Isolation (Zero Cross-Seller Leakage)', () => {
    it('ensures User B cannot see User A orders, allocations, or transfers', async () => {
      await seedTestUsersAndApps();
      await createSession('usr_seller_a', 'token_alice');
      await createSession('usr_seller_b', 'token_bob');


      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json,
          status, fulfilled_at
        ) VALUES (
          'ord_alice_1', 'idemp_a1', 'usr_buyer_1', 'app_alpha', 'usr_seller_a',
          'v1.0.0', 1, 2000, 'usd', '[]',
          'fulfilled', '2026-08-30 12:00:00'
        )
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES ('alloc_a1', 'ord_alice_1', 0, 'maker', 'usr_seller_a', 9000, 1800)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_transfer_outbox (
          id, order_id, allocation_id, destination_user_id, amount_cents, currency, status
        ) VALUES ('xfer_a1', 'ord_alice_1', 'alloc_a1', 'usr_seller_a', 1800, 'usd', 'succeeded')
      `).run();


      const reqBob = new Request('http://localhost/api/payments/ledger', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_bob' }
      });
      const resBob = await ledgerApi.onRequestGet({ request: reqBob, env: testEnv });
      const dataBob = await resBob.json();

      expect(resBob.status).toBe(200);
      expect(dataBob.sellerId).toBe('usr_seller_b');
      expect(dataBob.orders).toEqual([]);
      expect(dataBob.summary.totalOrders).toBe(0);


      const reqAlice = new Request('http://localhost/api/payments/ledger', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const resAlice = await ledgerApi.onRequestGet({ request: reqAlice, env: testEnv });
      const dataAlice = await resAlice.json();

      expect(resAlice.status).toBe(200);
      expect(dataAlice.sellerId).toBe('usr_seller_a');
      expect(dataAlice.orders).toHaveLength(1);
      expect(dataAlice.orders[0].id).toBe('ord_alice_1');
    });
  });
});
