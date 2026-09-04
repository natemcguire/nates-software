import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as grantsApi from '../functions/api/payments/grants';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';

describe('GET /api/payments/grants — caller-scoped grants + earnings + payouts', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
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

  async function seedUsers() {
    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name)
      VALUES
        ('usr_a', 'alice', 'Alice'),
        ('usr_b', 'bob', 'Bob'),
        ('usr_maker', 'maker_dev', 'Maker Dev')
    `).run();
  }

  const env = () => ({ DB: ctx.d1 });

  it('returns 401 for unauthenticated requests', async () => {
    const req = new Request('http://localhost/api/payments/grants', { method: 'GET' });
    const res = await grantsApi.onRequestGet({ request: req, env: env() });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
  });

  it('returns honest empty state (empty arrays, zero totals) for a user with no grants, earnings, or payouts', async () => {
    await seedUsers();
    await createSession('usr_a', 'tok_empty');

    const req = new Request('http://localhost/api/payments/grants', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer tok_empty' }
    });
    const res = await grantsApi.onRequestGet({ request: req, env: env() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.grants).toEqual([]);
    expect(data.earningsByRole).toEqual([]);
    expect(data.payouts).toEqual({ byStatus: [] });
  });

  it('returns the authed happy path: grants, earnings by role, and payouts by status', async () => {
    await seedUsers();

    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app-grants', 'Grants App', 'Tag', 'Desc', 'usr_maker', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, grantable_bps)
      VALUES ('repo-grants', 'app-grants', 'usr_maker', 'app-grants', 'key_repo_grants', 2000)
    `).run();

    await ctx.d1.prepare(`
      INSERT INTO contributor_shares (
        id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at
      ) VALUES ('cs_active', 'repo-grants', 'usr_a', 'usr_maker', 1500, 'active', datetime('now'))
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app-grants-2', 'Grants App 2', 'Tag', 'Desc', 'usr_maker', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, grantable_bps)
      VALUES ('repo-grants-2', 'app-grants-2', 'usr_maker', 'app-grants-2', 'key_repo_grants_2', 2000)
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO contributor_shares (
        id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status
      ) VALUES ('cs_pending', 'repo-grants-2', 'usr_a', 'usr_maker', 1000, 'pending')
    `).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, repository_id, seller_user_id,
        app_version, price_version, gross_cents, currency, lineage_policy,
        lineage_snapshot_json, status
      ) VALUES ('ord_fulfilled_1', 'idem_1', 'usr_b', 'app-grants', 'repo-grants', 'usr_maker',
        'v1.0.0', 1, 1500, 'usd', 'maker_70_lineage_20_pool_10', '{}', 'fulfilled')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id, source_repository_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES
        ('coa_maker_1', 'ord_fulfilled_1', 0, 'maker', 'usr_maker', 'repo-grants', 0, 7500, 1125),
        ('coa_contrib_1', 'ord_fulfilled_1', 1, 'contributor', 'usr_a', 'repo-grants', NULL, 1500, 225),
        ('coa_pool_1', 'ord_fulfilled_1', 2, 'protocol_pool', NULL, NULL, NULL, 1000, 150)
    `).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, repository_id, seller_user_id,
        app_version, price_version, gross_cents, currency, lineage_policy,
        lineage_snapshot_json, status
      ) VALUES ('ord_fulfilled_2', 'idem_2', 'usr_b', 'app-grants', 'repo-grants', 'usr_maker',
        'v1.0.0', 1, 1000, 'usd', 'maker_70_lineage_20_pool_10', '{}', 'fulfilled')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id, source_repository_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES
        ('coa_maker_2', 'ord_fulfilled_2', 0, 'maker', 'usr_maker', 'repo-grants', 0, 8500, 850),
        ('coa_contrib_2', 'ord_fulfilled_2', 1, 'contributor', 'usr_a', 'repo-grants', NULL, 500, 50),
        ('coa_pool_2', 'ord_fulfilled_2', 2, 'protocol_pool', NULL, NULL, NULL, 1000, 100)
    `).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, repository_id, seller_user_id,
        app_version, price_version, gross_cents, currency, lineage_policy,
        lineage_snapshot_json, status
      ) VALUES ('ord_pending_1', 'idem_3', 'usr_b', 'app-grants', 'repo-grants', 'usr_maker',
        'v1.0.0', 1, 1000, 'usd', 'maker_70_lineage_20_pool_10', '{}', 'requires_payment')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id, source_repository_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES ('coa_contrib_3', 'ord_pending_1', 1, 'contributor', 'usr_a', 'repo-grants', NULL, 1000, 100)
    `).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_transfer_outbox (
        id, order_id, allocation_id, destination_user_id, amount_cents, currency, status
      ) VALUES ('outbox_1', 'ord_fulfilled_1', 'coa_contrib_1', 'usr_a', 225, 'usd', 'succeeded')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_transfer_outbox (
        id, order_id, allocation_id, destination_user_id, amount_cents, currency, status
      ) VALUES ('outbox_2', 'ord_fulfilled_2', 'coa_contrib_2', 'usr_a', 50, 'usd', 'pending')
    `).run();

    await createSession('usr_a', 'tok_a');

    const req = new Request('http://localhost/api/payments/grants', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer tok_a' }
    });
    const res = await grantsApi.onRequestGet({ request: req, env: env() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    expect(data.grants).toHaveLength(2);
    const activeGrant = data.grants.find((g: any) => g.id === 'cs_active');
    const pendingGrant = data.grants.find((g: any) => g.id === 'cs_pending');
    expect(activeGrant).toMatchObject({
      id: 'cs_active', repositoryId: 'repo-grants', appId: 'app-grants',
      basisPoints: 1500, status: 'active'
    });
    expect(activeGrant.activatedAt).toBeTruthy();
    expect(pendingGrant).toMatchObject({
      id: 'cs_pending', repositoryId: 'repo-grants-2', appId: 'app-grants-2',
      basisPoints: 1000, status: 'pending'
    });
    expect(pendingGrant.activatedAt).toBeNull();

    expect(data.earningsByRole).toEqual([
      { role: 'contributor', count: 2, totalCents: 275 }
    ]);

    const byStatus = data.payouts.byStatus.slice().sort((a: any, b: any) => a.status.localeCompare(b.status));
    expect(byStatus).toEqual([
      { status: 'pending', count: 1, totalCents: 50 },
      { status: 'succeeded', count: 1, totalCents: 225 }
    ]);
  });

  it('scopes strictly to the caller: usr_b never sees usr_a grants, earnings, or payouts', async () => {
    await seedUsers();

    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app-scope', 'Scope App', 'Tag', 'Desc', 'usr_maker', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, grantable_bps)
      VALUES ('repo-scope', 'app-scope', 'usr_maker', 'app-scope', 'key_repo_scope', 2000)
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO contributor_shares (
        id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at
      ) VALUES ('cs_a_only', 'repo-scope', 'usr_a', 'usr_maker', 1200, 'active', datetime('now'))
    `).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, repository_id, seller_user_id,
        app_version, price_version, gross_cents, currency, lineage_policy,
        lineage_snapshot_json, status
      ) VALUES ('ord_scope_1', 'idem_scope_1', 'usr_b', 'app-scope', 'repo-scope', 'usr_maker',
        'v1.0.0', 1, 1000, 'usd', 'maker_70_lineage_20_pool_10', '{}', 'fulfilled')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id, source_repository_id,
        lineage_depth, basis_points, amount_cents
      ) VALUES ('coa_scope_1', 'ord_scope_1', 1, 'contributor', 'usr_a', 'repo-scope', NULL, 1200, 120)
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_transfer_outbox (
        id, order_id, allocation_id, destination_user_id, amount_cents, currency, status
      ) VALUES ('outbox_scope_1', 'ord_scope_1', 'coa_scope_1', 'usr_a', 120, 'usd', 'succeeded')
    `).run();

    await createSession('usr_b', 'tok_b');

    const req = new Request('http://localhost/api/payments/grants', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer tok_b' }
    });
    const res = await grantsApi.onRequestGet({ request: req, env: env() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.grants).toEqual([]);
    expect(data.earningsByRole).toEqual([]);
    expect(data.payouts).toEqual({ byStatus: [] });
  });

  it('rejects non-GET methods with 405', async () => {
    const res = await grantsApi.onRequestPost();
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
  });
});
