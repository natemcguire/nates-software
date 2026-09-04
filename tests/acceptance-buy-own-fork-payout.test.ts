import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as createIntentApi from '../functions/api/payments/create-intent';
import * as shelfApi from '../functions/api/shelf';
import { processStripeInboxEvent } from '../src/lib/commerce/eventProcessor';
import { recordInboxEvent, hashPayload } from '../src/lib/commerce/stripeInbox';
import { generateBase64EncryptionKey } from '../src/lib/commerce/licenseCrypto';
import { hashSessionToken } from '../functions/api/_session';

describe('ACCEPTANCE: buy → own → fork → contributor-payout (offline, mocked Stripe)', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;

  const keyV1 = generateBase64EncryptionKey();
  const licenseKeysJson = JSON.stringify({ '1': keyV1 });

  function checkoutEnv() {
    return {
      DB: ctx.d1,
      PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_acceptance_key',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_acceptance_key'
    };
  }

  function fulfillmentEnv() {
    return {
      DB: ctx.d1,
      STRIPE_SECRET_KEY: 'sk_test_acceptance_key',
      STRIPE_LIVEMODE: 'false',
      LICENSE_ENCRYPTION_KEYS_JSON: licenseKeysJson,
      LICENSE_ACTIVE_KEY_VERSION: '1'
    };
  }

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function seedUser(id: string) {
    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name) VALUES (?, ?, ?)
    `).bind(id, id, id).run();
  }

  async function createSession(userId: string, token: string) {
    const tokenHash = await hashSessionToken(token);
    const expiresAt = Date.now() + 86_400_000;
    await ctx.d1.prepare(`
      INSERT OR REPLACE INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(tokenHash, userId, expiresAt).run();
    return token;
  }

  async function seedApp(opts: {
    appId: string;
    repoId: string;
    sellerId: string;
    priceCents: number;
    royaltyBps?: number;
  }) {
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES (?, ?, 'Tagline', 'Desc', ?, 'v1.0.0', 'MIT', '$0.00', '/data', '[]', '[]', '{}')
    `).bind(opts.appId, opts.appId, opts.sellerId).run();

    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).bind(opts.repoId, opts.appId, opts.sellerId, opts.appId, `key_${opts.repoId}`).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps)
      VALUES (?, ?, ?, ?, 'usd', 'active', ?)
    `).bind(opts.appId, opts.repoId, opts.sellerId, opts.priceCents, opts.royaltyBps ?? 0).run();
  }

  async function seedFork(opts: {
    childRepoId: string;
    parentRepoId: string;
    forkedByUserId: string;
    lineageRootRepoId: string;
    depth: number;
  }) {
    await ctx.d1.prepare(`
      INSERT INTO repository_forks (
        child_repository_id, parent_repository_id, forked_by_user_id,
        parent_ref_name, parent_commit_oid, child_initial_commit_oid,
        lineage_root_repository_id, depth
      ) VALUES (?, ?, ?, 'refs/heads/main', ?, ?, ?, ?)
    `).bind(
      opts.childRepoId, opts.parentRepoId, opts.forkedByUserId,
      'a'.repeat(40), 'b'.repeat(40), opts.lineageRootRepoId, opts.depth
    ).run();
  }

  async function seedFrozenLien(opts: {
    id: string;
    holderOfRepositoryId: string;
    ancestorRepositoryId: string;
    ancestorUserId: string;
    bps: number;
    depth: number;
  }) {
    await ctx.d1.prepare(`
      INSERT INTO repository_fork_liens (
        id, holder_of_repository_id, ancestor_repository_id, ancestor_user_id, bps, depth
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(opts.id, opts.holderOfRepositoryId, opts.ancestorRepositoryId, opts.ancestorUserId, opts.bps, opts.depth).run();
  }

  function mockCreateIntentStripe(paymentIntentId: string) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: paymentIntentId, client_secret: `${paymentIntentId}_secret` })
    } as any);
  }

  function stripeGetSucceeded(order: {
    paymentIntentId: string;
    orderId: string;
    grossCents: number;
  }) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: order.paymentIntentId,
        status: 'succeeded',
        amount: order.grossCents,
        amount_received: order.grossCents,
        currency: 'usd',
        livemode: false,
        metadata: { orderId: order.orderId }
      })
    } as any);
  }

  async function createOrder(opts: {
    appId: string;
    buyerToken: string;
    idempotencyKey: string;
    paymentIntentId: string;
  }): Promise<{ orderId: string; paymentIntentId: string; grossCents: number }> {
    mockCreateIntentStripe(opts.paymentIntentId);

    const req = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${opts.buyerToken}`,
        'Idempotency-Key': opts.idempotencyKey
      },
      body: JSON.stringify({ appId: opts.appId })
    });

    const res = await createIntentApi.onRequestPost({ request: req, env: checkoutEnv() });
    const data: any = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.paymentIntentId).toBe(opts.paymentIntentId);

    const orderRow: any = await ctx.d1.prepare(`
      SELECT id, gross_cents AS grossCents, status FROM commerce_orders WHERE stripe_payment_intent_id = ?
    `).bind(opts.paymentIntentId).first();

    expect(orderRow.status).toBe('requires_payment');

    return {
      orderId: orderRow.id,
      paymentIntentId: opts.paymentIntentId,
      grossCents: orderRow.grossCents
    };
  }

  async function deliverAndProcessWebhook(order: {
    orderId: string;
    paymentIntentId: string;
    grossCents: number;
  }, eventId: string) {
    const rawPayload = JSON.stringify({
      id: eventId,
      type: 'payment_intent.succeeded',
      api_version: '2023-10-16',
      livemode: false,
      data: { object: { id: order.paymentIntentId, metadata: { orderId: order.orderId } } }
    });

    await recordInboxEvent(ctx.d1, {
      eventId,
      eventType: 'payment_intent.succeeded',
      apiVersion: '2023-10-16',
      livemode: false,
      payloadJson: rawPayload,
      payloadSha256: await hashPayload(rawPayload),
      stripeObjectId: order.paymentIntentId
    });

    return processStripeInboxEvent(ctx.d1, fulfillmentEnv(), eventId, {
      stripeFetchOverride: stripeGetSucceeded(order)
    });
  }

  async function allocationsFor(orderId: string) {
    const { results } = await ctx.d1.prepare(`
      SELECT sequence, role, recipient_user_id AS recipientUserId, amount_cents AS amountCents
      FROM commerce_order_allocations WHERE order_id = ? ORDER BY sequence ASC
    `).bind(orderId).all();
    return results as any[];
  }

  async function outboxFor(orderId: string) {
    const { results } = await ctx.d1.prepare(`
      SELECT destination_user_id AS destinationUserId, amount_cents AS amountCents, status
      FROM commerce_transfer_outbox WHERE order_id = ? ORDER BY amount_cents DESC, destination_user_id ASC
    `).bind(orderId).all();
    return results as any[];
  }

  it('BUY → OWN: a root purchase fulfills the order, mints exactly one license + encrypted secret to the buyer, and queues a seller payout with conserved allocations', async () => {
    await seedUser('usr_root_maker');
    await seedUser('usr_buyer_a');
    await seedApp({ appId: 'acc-root', repoId: 'repo-acc-root', sellerId: 'usr_root_maker', priceCents: 1500 });
    await createSession('usr_buyer_a', 'tok_buyer_a');

    const order = await createOrder({
      appId: 'acc-root',
      buyerToken: 'tok_buyer_a',
      idempotencyKey: 'acc-key-root',
      paymentIntentId: 'pi_acc_root'
    });

    const allocs = await allocationsFor(order.orderId);
    expect(allocs).toEqual([
      { sequence: 1, role: 'seller', recipientUserId: 'usr_root_maker', amountCents: 1350 },
      { sequence: 2, role: 'platform', recipientUserId: null, amountCents: 150 }
    ]);
    expect(allocs.reduce((s, a) => s + a.amountCents, 0)).toBe(order.grossCents);

    const result = await deliverAndProcessWebhook(order, 'evt_acc_root');
    expect(result.success).toBe(true);
    expect(result.status).toBe('fulfilled');
    expect(result.outboxCount).toBe(1);

    const fulfilled: any = await ctx.d1.prepare(`
      SELECT status, fulfilled_at FROM commerce_orders WHERE id = ?
    `).bind(order.orderId).first();
    expect(fulfilled.status).toBe('fulfilled');
    expect(fulfilled.fulfilled_at).toBeTruthy();

    const licenses: any = await ctx.d1.prepare(`
      SELECT id, app_id, owner_user_id, license_key_hash, license_key_last4, status
      FROM commerce_licenses WHERE order_id = ?
    `).bind(order.orderId).all();
    expect(licenses.results).toHaveLength(1);
    const license = licenses.results![0];
    expect(license.app_id).toBe('acc-root');
    expect(license.owner_user_id).toBe('usr_buyer_a');
    expect(license.license_key_hash).toHaveLength(64);
    expect(license.status).toBe('active');

    const secrets: any = await ctx.d1.prepare(`
      SELECT algorithm, key_version, ciphertext_base64, iv_base64
      FROM commerce_license_secrets WHERE license_id = ?
    `).bind(license.id).all();
    expect(secrets.results).toHaveLength(1);
    expect(secrets.results![0].algorithm).toBe('AES-256-GCM');
    expect(secrets.results![0].ciphertext_base64).toBeTruthy();
    expect(secrets.results![0].iv_base64).toBeTruthy();

    const outbox = await outboxFor(order.orderId);
    expect(outbox).toEqual([
      { destinationUserId: 'usr_root_maker', amountCents: 1350, status: 'pending' }
    ]);

    const shelfReq = new Request('http://localhost/api/shelf', {
      headers: { 'Authorization': 'Bearer tok_buyer_a' }
    });
    const shelfRes = await shelfApi.onRequestGet({ request: shelfReq, env: { DB: ctx.d1 } });
    const shelfData: any = await shelfRes.json();
    expect(shelfRes.status).toBe(200);
    expect(shelfData.success).toBe(true);
    expect(shelfData.shelf).toHaveLength(1);
    expect(shelfData.shelf[0].appId).toBe('acc-root');
    expect(shelfData.shelf[0].licenseKeyLast4).toBe(license.license_key_last4);
  });

  it('IDEMPOTENT REPLAY: re-processing the same succeeded event does not mint a second license or a second payout obligation', async () => {
    await seedUser('usr_root_maker');
    await seedUser('usr_buyer_a');
    await seedApp({ appId: 'acc-root', repoId: 'repo-acc-root', sellerId: 'usr_root_maker', priceCents: 1500 });
    await createSession('usr_buyer_a', 'tok_buyer_a');

    const order = await createOrder({
      appId: 'acc-root',
      buyerToken: 'tok_buyer_a',
      idempotencyKey: 'acc-key-root',
      paymentIntentId: 'pi_acc_root'
    });

    const first = await deliverAndProcessWebhook(order, 'evt_acc_root');
    expect(first.success).toBe(true);
    expect(first.status).toBe('fulfilled');

    const replay = await processStripeInboxEvent(ctx.d1, fulfillmentEnv(), 'evt_acc_root', {
      stripeFetchOverride: stripeGetSucceeded(order)
    });
    expect(replay.success).toBe(true);
    expect(replay.duplicate).toBe(true);

    const licenses: any = await ctx.d1.prepare(`SELECT id FROM commerce_licenses WHERE order_id = ?`).bind(order.orderId).all();
    expect(licenses.results).toHaveLength(1);
    const outbox = await outboxFor(order.orderId);
    expect(outbox).toHaveLength(1);
  });

  it('FORK → ANCESTOR PAYOUT: purchasing a forked app pays its frozen ancestor lien AND queues a pending ancestor payout obligation, alongside the seller payout', async () => {
    await seedUser('usr_root_maker');
    await seedUser('usr_fork_maker');
    await seedUser('usr_buyer_a');
    await seedUser('usr_buyer_b');

    await seedApp({ appId: 'acc-root', repoId: 'repo-acc-root', sellerId: 'usr_root_maker', priceCents: 1500, royaltyBps: 1000 });

    await seedApp({ appId: 'acc-fork', repoId: 'repo-acc-fork', sellerId: 'usr_fork_maker', priceCents: 2000 });
    await seedFork({
      childRepoId: 'repo-acc-fork',
      parentRepoId: 'repo-acc-root',
      forkedByUserId: 'usr_fork_maker',
      lineageRootRepoId: 'repo-acc-root',
      depth: 1
    });

    await seedFrozenLien({
      id: 'fl_acc_1',
      holderOfRepositoryId: 'repo-acc-fork',
      ancestorRepositoryId: 'repo-acc-root',
      ancestorUserId: 'usr_root_maker',
      bps: 1000,
      depth: 1
    });

    await createSession('usr_buyer_b', 'tok_buyer_b');

    const order = await createOrder({
      appId: 'acc-fork',
      buyerToken: 'tok_buyer_b',
      idempotencyKey: 'acc-key-fork',
      paymentIntentId: 'pi_acc_fork'
    });
    expect(order.grossCents).toBe(2000);

    const allocs = await allocationsFor(order.orderId);
    const byRole = Object.fromEntries(allocs.map(a => [a.role, a]));

    expect(byRole.ancestor).toMatchObject({ recipientUserId: 'usr_root_maker', amountCents: 180 });
    expect(byRole.seller).toMatchObject({ recipientUserId: 'usr_fork_maker', amountCents: 1620 });
    expect(byRole.platform).toMatchObject({ recipientUserId: null, amountCents: 200 });

    expect(allocs.reduce((s, a) => s + a.amountCents, 0)).toBe(order.grossCents);

    const result = await deliverAndProcessWebhook(order, 'evt_acc_fork');
    expect(result.success).toBe(true);
    expect(result.status).toBe('fulfilled');
    expect(result.outboxCount).toBe(2);

    const outbox = await outboxFor(order.orderId);
    expect(outbox).toEqual([
      { destinationUserId: 'usr_fork_maker', amountCents: 1620, status: 'pending' },
      { destinationUserId: 'usr_root_maker', amountCents: 180, status: 'pending' }
    ]);

    const ancestorPayout: any = await ctx.d1.prepare(`
      SELECT destination_user_id AS destinationUserId, amount_cents AS amountCents, status
      FROM commerce_transfer_outbox
      WHERE order_id = ? AND destination_user_id = 'usr_root_maker'
    `).bind(order.orderId).all();
    expect(ancestorPayout.results).toHaveLength(1);
    expect(ancestorPayout.results![0]).toEqual({
      destinationUserId: 'usr_root_maker',
      amountCents: 180,
      status: 'pending'
    });

    const forkLicense: any = await ctx.d1.prepare(`
      SELECT app_id, owner_user_id FROM commerce_licenses WHERE order_id = ?
    `).bind(order.orderId).all();
    expect(forkLicense.results).toHaveLength(1);
    expect(forkLicense.results![0]).toEqual({ app_id: 'acc-fork', owner_user_id: 'usr_buyer_b' });
  });
});
