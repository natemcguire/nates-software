// Verifies A2: create-intent fetches active contributor_shares for the
// order's repository and wires them into calculateAllocations so contributor
// rows are actually persisted and paid, instead of remaining dark.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as createIntentApi from '../functions/api/payments/create-intent';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';

describe('A2: create-intent wires active contributor_shares into allocations', () => {
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

  async function createSession(userId: string, token: string) {
    const tokenHash = await hashSessionToken(token);
    const expiresAt = Date.now() + 86400000;
    await ctx.d1.prepare(`
      INSERT OR REPLACE INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(tokenHash, userId, expiresAt).run();
    return token;
  }

  async function seedUsers() {
    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name)
      VALUES
        ('usr_buyer', 'buyer', 'Buyer'),
        ('usr_maker', 'maker_dev', 'Maker Dev'),
        ('usr_contrib1', 'contrib1', 'Contributor One'),
        ('usr_contrib2', 'contrib2', 'Contributor Two'),
        ('usr_parent', 'parent_dev', 'Parent Dev')
    `).run();
  }

  function mockStripeSuccess(id = 'pi_contrib_test') {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id, client_secret: `${id}_secret` })
    } as any);
  }

  const env = () => ({
    DB: ctx.d1,
    PAYMENTS_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
  });

  async function seedRootAppWithRepo(opts: { appId: string; repoId: string; priceCents: number; grantableBps?: number }) {
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES (?, ?, 'Tagline', 'Desc', 'usr_maker', 'v1.0.0', 'MIT', '$0.00', '/data', '[]', '[]', '{}')
    `).bind(opts.appId, opts.appId).run();

    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, grantable_bps)
      VALUES (?, ?, 'usr_maker', ?, ?, ?)
    `).bind(opts.repoId, opts.appId, opts.appId, `key_${opts.repoId}`, opts.grantableBps ?? 8000).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status)
      VALUES (?, ?, 'usr_maker', ?, 'usd', 'active')
    `).bind(opts.appId, opts.repoId, opts.priceCents).run();
  }

  async function grantShare(opts: { id: string; repoId: string; contributorId: string; bps: number; status?: string }) {
    const status = opts.status || 'active';
    const activatedAt = status === 'active' ? "datetime('now')" : 'NULL';
    const revokedAt = status === 'revoked' ? "datetime('now')" : 'NULL';
    await ctx.d1.prepare(`
      INSERT INTO contributor_shares (
        id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at, revoked_at
      ) VALUES (?, ?, ?, 'usr_maker', ?, ?, ${activatedAt}, ${revokedAt})
    `).bind(opts.id, opts.repoId, opts.contributorId, opts.bps, status).run();
  }

  async function getOrderIdByKey(key: string): Promise<string> {
    const row: any = await ctx.d1.prepare(`SELECT id FROM commerce_orders WHERE idempotency_key = ?`).bind(key).first();
    return row.id;
  }

  async function getAllocations(orderId: string) {
    const { results } = await ctx.d1.prepare(`
      SELECT sequence, role, recipient_user_id AS recipientUserId,
             source_repository_id AS sourceRepositoryId, lineage_depth AS lineageDepth,
             basis_points AS basisPoints, amount_cents AS amountCents
      FROM commerce_order_allocations
      WHERE order_id = ?
      ORDER BY sequence ASC
    `).bind(orderId).all();
    return results as any[];
  }

  it('1 active contributor (1500 bps) on a $15.00 root purchase: maker 7500/1125, contributor 1500/225, pool 1000/150, sum=grossCents', async () => {
    await seedUsers();
    await seedRootAppWithRepo({ appId: 'app-1c', repoId: 'repo-1c', priceCents: 1500 });
    await grantShare({ id: 'cs_1', repoId: 'repo-1c', contributorId: 'usr_contrib1', bps: 1500 });
    await createSession('usr_buyer', 'tok_1c');
    mockStripeSuccess('pi_1c');

    const req = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok_1c',
        'Idempotency-Key': 'key_1c'
      },
      body: JSON.stringify({ appId: 'app-1c' })
    });

    const res = await createIntentApi.onRequestPost({ request: req, env: env() });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    const orderId = await getOrderIdByKey('key_1c');
    const allocs = await getAllocations(orderId);
    expect(allocs).toHaveLength(3);

    expect(allocs[0]).toEqual({
      sequence: 0, role: 'maker', recipientUserId: 'usr_maker',
      sourceRepositoryId: 'repo-1c', lineageDepth: 0, basisPoints: 7500, amountCents: 1125
    });
    expect(allocs[1]).toEqual({
      sequence: 1, role: 'contributor', recipientUserId: 'usr_contrib1',
      sourceRepositoryId: 'repo-1c', lineageDepth: null, basisPoints: 1500, amountCents: 225
    });
    expect(allocs[2]).toEqual({
      sequence: 2, role: 'protocol_pool', recipientUserId: null,
      sourceRepositoryId: null, lineageDepth: null, basisPoints: 1000, amountCents: 150
    });

    const sum = allocs.reduce((s, a) => s + a.amountCents, 0);
    expect(sum).toBe(1500);
    const bpsSum = allocs.reduce((s, a) => s + a.basisPoints, 0);
    expect(bpsSum).toBe(10000);
  });

  it('2 active contributors (500 + 1500 bps) on a $20.00 root purchase: maker 7000/1400, contrib1 500/100, contrib2 1500/300, pool 1000/200, sum=grossCents', async () => {
    await seedUsers();
    await seedRootAppWithRepo({ appId: 'app-2c', repoId: 'repo-2c', priceCents: 2000 });
    await grantShare({ id: 'cs_2a', repoId: 'repo-2c', contributorId: 'usr_contrib1', bps: 500 });
    await grantShare({ id: 'cs_2b', repoId: 'repo-2c', contributorId: 'usr_contrib2', bps: 1500 });
    await createSession('usr_buyer', 'tok_2c');
    mockStripeSuccess('pi_2c');

    const req = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok_2c',
        'Idempotency-Key': 'key_2c'
      },
      body: JSON.stringify({ appId: 'app-2c' })
    });

    const res = await createIntentApi.onRequestPost({ request: req, env: env() });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    const orderId = await getOrderIdByKey('key_2c');
    const allocs = await getAllocations(orderId);
    expect(allocs).toHaveLength(4);

    expect(allocs[0]).toEqual({
      sequence: 0, role: 'maker', recipientUserId: 'usr_maker',
      sourceRepositoryId: 'repo-2c', lineageDepth: 0, basisPoints: 7000, amountCents: 1400
    });
    expect(allocs[1]).toEqual({
      sequence: 1, role: 'contributor', recipientUserId: 'usr_contrib1',
      sourceRepositoryId: 'repo-2c', lineageDepth: null, basisPoints: 500, amountCents: 100
    });
    expect(allocs[2]).toEqual({
      sequence: 2, role: 'contributor', recipientUserId: 'usr_contrib2',
      sourceRepositoryId: 'repo-2c', lineageDepth: null, basisPoints: 1500, amountCents: 300
    });
    expect(allocs[3]).toEqual({
      sequence: 3, role: 'protocol_pool', recipientUserId: null,
      sourceRepositoryId: null, lineageDepth: null, basisPoints: 1000, amountCents: 200
    });

    const sum = allocs.reduce((s, a) => s + a.amountCents, 0);
    expect(sum).toBe(2000);
    const bpsSum = allocs.reduce((s, a) => s + a.basisPoints, 0);
    expect(bpsSum).toBe(10000);
  });

  it('pending and revoked contributor_shares are ignored (only active is wired in)', async () => {
    await seedUsers();
    await seedRootAppWithRepo({ appId: 'app-pr', repoId: 'repo-pr', priceCents: 1000 });
    await grantShare({ id: 'cs_pending', repoId: 'repo-pr', contributorId: 'usr_contrib1', bps: 3000, status: 'pending' });
    await grantShare({ id: 'cs_revoked', repoId: 'repo-pr', contributorId: 'usr_contrib2', bps: 3000, status: 'revoked' });
    await createSession('usr_buyer', 'tok_pr');
    mockStripeSuccess('pi_pr');

    const req = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok_pr',
        'Idempotency-Key': 'key_pr'
      },
      body: JSON.stringify({ appId: 'app-pr' })
    });

    const res = await createIntentApi.onRequestPost({ request: req, env: env() });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    const orderId = await getOrderIdByKey('key_pr');
    const allocs = await getAllocations(orderId);

    // No contributor rows at all — root app behaves byte-identically to the no-contributor path
    expect(allocs).toHaveLength(2);
    expect(allocs.some(a => a.role === 'contributor')).toBe(false);
    expect(allocs[0]).toEqual({
      sequence: 0, role: 'maker', recipientUserId: 'usr_maker',
      sourceRepositoryId: 'repo-pr', lineageDepth: 0, basisPoints: 9000, amountCents: 900
    });
    expect(allocs[1]).toEqual({
      sequence: 1, role: 'protocol_pool', recipientUserId: null,
      sourceRepositoryId: null, lineageDepth: null, basisPoints: 1000, amountCents: 100
    });

    const sum = allocs.reduce((s, a) => s + a.amountCents, 0);
    expect(sum).toBe(1000);
  });

  it('no repository (repositoryId null) leaves allocations unchanged — no contributor lookup performed', async () => {
    await seedUsers();
    // dronehunter is seeded by migration 0001/0009 with a real commerce_products row and NO repository_id
    await createSession('usr_nate', 'tok_norepo');
    mockStripeSuccess('pi_norepo');

    const req = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok_norepo',
        'Idempotency-Key': 'key_norepo'
      },
      body: JSON.stringify({ appId: 'dronehunter' })
    });

    const res = await createIntentApi.onRequestPost({ request: req, env: env() });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    const orderId = await getOrderIdByKey('key_norepo');
    const allocs = await getAllocations(orderId);
    expect(allocs).toHaveLength(2);
    expect(allocs.some(a => a.role === 'contributor')).toBe(false);
    expect(allocs[0].role).toBe('maker');
    expect(allocs[0].basisPoints).toBe(9000);
    expect(allocs[1].role).toBe('protocol_pool');

    const sum = allocs.reduce((s: number, a: any) => s + a.amountCents, 0);
    expect(sum).toBe(data.amountCents);
  });

  it('over-cap contributor state fails the order closed with contributor_allocation_invalid and never calls Stripe', async () => {
    await seedUsers();
    await seedRootAppWithRepo({ appId: 'app-overcap', repoId: 'repo-overcap', priceCents: 1000 });
    // The 0030 cap trigger prevents inserting shares beyond grantable_bps at
    // write time, but grantable_bps itself defaults to 0 and is a separate
    // knob from the maker-floor (9000 - 1000 = 8000bps) enforced inside
    // calculateAllocations. Raise grantable_bps enough to let the DB accept
    // an over-cap grant (> 8000bps) that validateContributors still rejects.
    await ctx.d1.prepare(`UPDATE repositories SET grantable_bps = 10000 WHERE id = 'repo-overcap'`).run();
    await grantShare({ id: 'cs_over1', repoId: 'repo-overcap', contributorId: 'usr_contrib1', bps: 8500 });

    await createSession('usr_buyer', 'tok_overcap');
    mockStripeSuccess('pi_overcap');

    const req = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tok_overcap',
        'Idempotency-Key': 'key_overcap'
      },
      body: JSON.stringify({ appId: 'app-overcap' })
    });

    const res = await createIntentApi.onRequestPost({ request: req, env: env() });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/Contributor allocation is invalid/i);

    // Stripe must never be called
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const order: any = await ctx.d1.prepare(`
      SELECT status, failure_code FROM commerce_orders WHERE idempotency_key = 'key_overcap'
    `).first();
    expect(order).toBeTruthy();
    expect(order.status).toBe('payment_failed');
    expect(order.failure_code).toBe('contributor_allocation_invalid');

    // No allocation rows were ever persisted for the failed order
    const orderId = order ? (await getOrderIdByKey('key_overcap')) : null;
    if (orderId) {
      const allocs = await getAllocations(orderId);
      expect(allocs).toHaveLength(0);
    }
  });
});
