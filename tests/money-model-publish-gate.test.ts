import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as dropsApi from '../functions/api/drops';
import * as createIntentApi from '../functions/api/payments/create-intent';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';


describe('D2: Prove-it publish gate — invariant pin', () => {
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
    await ctx.d1.prepare(`
      INSERT OR REPLACE INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(tokenHash, userId, Date.now() + 86400000).run();
    return token;
  }

  it('publishing via POST /api/drops with a repo that has no built commit persists commerce_products.status = "draft"', async () => {
    const dropId = 'prove-it-gate-app';
    const req = new Request('http://localhost/api/drops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
      body: JSON.stringify({
        id: dropId,
        name: 'Prove It Gate App',
        tagline: 'No commit yet',
        description: 'Freshly published, no deployable revision.',
        version: 'v1.0.0',
        price: '$15.00'
      })
    });

    const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    expect(data.productStatus).toBe('draft');

    const product = await ctx.d1.prepare(
      'SELECT status FROM commerce_products WHERE app_id = ?'
    ).bind(dropId).first();
    expect(product).not.toBeNull();
    expect((product as any).status).toBe('draft');


    const repoId = data.repositoryId;
    const commit = await ctx.d1.prepare(`
      SELECT rf.commit_oid AS commitOid
      FROM repositories r
      LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
      WHERE r.id = ?
    `).bind(repoId).first();
    expect((commit as any)?.commitOid ?? null).toBeNull();
  });

  it('buy-time: create-intent rejects purchasing a "draft" product (4xx) and creates no order', async () => {
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role)
      VALUES ('usr_prove_it_buyer', 'prove_it_buyer', 'Prove It Buyer', 'user')
    `).run();
    const buyerToken = await createSession('usr_prove_it_buyer', 'tok_prove_it_buyer');


    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('prove-it-draft-app', 'Prove It Draft App', 'Draft Tagline', 'Draft Desc', 'usr_nate', 'v1.0.0', 'MIT', '$10', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, seller_user_id, price_cents, currency, status)
      VALUES ('prove-it-draft-app', 'usr_nate', 1000, 'usd', 'draft')
    `).run();

    const req = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${buyerToken}`,
        'Idempotency-Key': 'key_prove_it_draft_app'
      },
      body: JSON.stringify({ appId: 'prove-it-draft-app' })
    });

    const res = await createIntentApi.onRequestPost({
      request: req,
      env: {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
      }
    });
    const data = await res.json();

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/not active/i);


    const orders = await ctx.d1.prepare(
      'SELECT id FROM commerce_orders WHERE app_id = ?'
    ).bind('prove-it-draft-app').all();
    expect(orders.results || []).toHaveLength(0);
  });
});
