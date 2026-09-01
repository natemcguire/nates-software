// ACCEPTANCE TEST — buy → own → fork → contributor-payout, fully offline.
//
// This is the definition-of-done proof for the core marketplace loop. It runs
// entirely against the local D1 test harness with a MOCKED Stripe (no network,
// no real keys, no prod money movement) and is part of `npm test`.
//
// It drives the REAL production code paths and asserts their invariants — it
// does not reimplement commerce logic:
//   - functions/api/payments/create-intent.ts  (snapshot price + allocations, create PaymentIntent)
//   - src/lib/commerce/eventProcessor.ts        (authoritative fulfillment state machine)
//   - src/lib/commerce/stripeInbox.ts           (durable event inbox)
//   - src/lib/commerceDomain.ts                 (calculateAllocations, via create-intent)
//
// Stripe is mocked two ways, both offline:
//   1. create-intent calls the global `fetch` to POST a PaymentIntent — we mock
//      globalThis.fetch to return a deterministic pi_… id + client_secret.
//   2. processStripeInboxEvent re-fetches the authoritative PaymentIntent — we
//      pass its `stripeFetchOverride` option (the commerce layer's built-in
//      seam) so the GET returns a 'succeeded' intent matching the durable order.
//
// The chain proved here:
//   BUY   — buyer creates an order for a root app; a signed 'succeeded' webhook
//           is processed and the order is fulfilled.
//   OWN   — exactly one license (+ encrypted secret) is minted to the buyer, and
//           the buyer's private shelf projection shows it.
//   FORK  — a downstream repo is forked from the root repo (repository_forks +
//           canonical lineage), given its own app/listing/product, and granted a
//           contributor share.
//   PAYOUT— a second buyer purchases the forked app; fulfillment queues a
//           pending transfer_outbox row for EACH real recipient: the fork maker,
//           the upstream ancestor (root maker), AND the contributor. The
//           contributor-outbox assertion is the regression guard for the
//           silent-money bug where contributor earnings were recorded but never
//           queued for payout.

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

  // Deterministic AES-256 key map for license secret encryption at rest.
  const keyV1 = generateBase64EncryptionKey();
  const licenseKeysJson = JSON.stringify({ '1': keyV1 });

  // Env for the create-intent endpoint (payments enabled + Stripe keys present).
  function checkoutEnv() {
    return {
      DB: ctx.d1,
      PAYMENTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_acceptance_key',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_acceptance_key'
    };
  }

  // Env for the fulfillment processor (Stripe re-fetch + license crypto + livemode).
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

  // ---- Fixtures -------------------------------------------------------------

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
    grantableBps?: number;
  }) {
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES (?, ?, 'Tagline', 'Desc', ?, 'v1.0.0', 'MIT', '$0.00', '/data', '[]', '[]', '{}')
    `).bind(opts.appId, opts.appId, opts.sellerId).run();

    // grantable_bps defaults to 0 (migration 0029) and the cap trigger
    // (migration 0030) rejects any contributor share beyond it — so a repo
    // that will grant contributor shares must open its grantable pool.
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status, grantable_bps)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).bind(opts.repoId, opts.appId, opts.sellerId, opts.appId, `key_${opts.repoId}`, opts.grantableBps ?? 0).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status)
      VALUES (?, ?, ?, ?, 'usd', 'active')
    `).bind(opts.appId, opts.repoId, opts.sellerId, opts.priceCents).run();
  }

  // Immutable fork-origin record. fetchRepositoryAncestry walks this to derive
  // the ancestor allocation for the parent repo's owner at purchase time.
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

  async function grantContributorShare(opts: {
    id: string;
    repoId: string;
    contributorId: string;
    grantedById: string;
    bps: number;
  }) {
    await ctx.d1.prepare(`
      INSERT INTO contributor_shares (
        id, repository_id, contributor_user_id, granted_by_user_id,
        basis_points, status, activated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
    `).bind(opts.id, opts.repoId, opts.contributorId, opts.grantedById, opts.bps).run();
  }

  // ---- Mocked Stripe --------------------------------------------------------

  // create-intent POSTs to /v1/payment_intents via globalThis.fetch. Return a
  // deterministic id + client_secret so the durable order gets a stable PI id.
  function mockCreateIntentStripe(paymentIntentId: string) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: paymentIntentId, client_secret: `${paymentIntentId}_secret` })
    } as any);
  }

  // processStripeInboxEvent GETs /v1/payment_intents/{id} via stripeFetchOverride.
  // Return an authoritative 'succeeded' intent that matches the durable order.
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

  // ---- Helpers to drive a full buy → fulfill for one app -------------------

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

  // ==========================================================================
  // 1. BUY → OWN  (root app: maker 90% / protocol pool 10%)
  // ==========================================================================
  it('BUY → OWN: a root purchase fulfills the order, mints exactly one license + encrypted secret to the buyer, and queues a maker payout with conserved allocations', async () => {
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

    // --- Allocation conservation: sum(allocations) === gross_cents ----------
    const allocs = await allocationsFor(order.orderId);
    expect(allocs).toEqual([
      { sequence: 0, role: 'maker', recipientUserId: 'usr_root_maker', amountCents: 1350 },
      { sequence: 1, role: 'protocol_pool', recipientUserId: null, amountCents: 150 }
    ]);
    expect(allocs.reduce((s, a) => s + a.amountCents, 0)).toBe(order.grossCents);

    // --- Fulfill via mocked signed webhook ---------------------------------
    const result = await deliverAndProcessWebhook(order, 'evt_acc_root');
    expect(result.success).toBe(true);
    expect(result.status).toBe('fulfilled');
    expect(result.outboxCount).toBe(1); // maker only; protocol pool never paid

    // INVARIANT: order fulfilled
    const fulfilled: any = await ctx.d1.prepare(`
      SELECT status, fulfilled_at FROM commerce_orders WHERE id = ?
    `).bind(order.orderId).first();
    expect(fulfilled.status).toBe('fulfilled');
    expect(fulfilled.fulfilled_at).toBeTruthy();

    // INVARIANT: exactly one license, owned by the buyer
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

    // INVARIANT: exactly one encrypted secret at rest (AES-256-GCM)
    const secrets: any = await ctx.d1.prepare(`
      SELECT algorithm, key_version, ciphertext_base64, iv_base64
      FROM commerce_license_secrets WHERE license_id = ?
    `).bind(license.id).all();
    expect(secrets.results).toHaveLength(1);
    expect(secrets.results![0].algorithm).toBe('AES-256-GCM');
    expect(secrets.results![0].ciphertext_base64).toBeTruthy();
    expect(secrets.results![0].iv_base64).toBeTruthy();

    // INVARIANT: one pending maker payout obligation (destination = maker)
    const outbox = await outboxFor(order.orderId);
    expect(outbox).toEqual([
      { destinationUserId: 'usr_root_maker', amountCents: 1350, status: 'pending' }
    ]);

    // OWN: the buyer's private shelf projection now shows the owned title
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

  // ==========================================================================
  // 2. IDEMPOTENCY — no double fulfillment on webhook replay
  // ==========================================================================
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

    // Replay the exact same event (duplicate delivery / racing worker)
    const replay = await processStripeInboxEvent(ctx.d1, fulfillmentEnv(), 'evt_acc_root', {
      stripeFetchOverride: stripeGetSucceeded(order)
    });
    expect(replay.success).toBe(true);
    expect(replay.duplicate).toBe(true);

    // INVARIANT: still exactly one license and one outbox row in total
    const licenses: any = await ctx.d1.prepare(`SELECT id FROM commerce_licenses WHERE order_id = ?`).bind(order.orderId).all();
    expect(licenses.results).toHaveLength(1);
    const outbox = await outboxFor(order.orderId);
    expect(outbox).toHaveLength(1);
  });

  // ==========================================================================
  // 3. FORK → CONTRIBUTOR PAYOUT
  //    Root repo (usr_root_maker) --forked--> fork repo (usr_fork_maker),
  //    with a contributor (usr_contributor) granted 1000 bps on the fork.
  //    A $20.00 purchase of the forked app splits:
  //      maker    7000 - 1000 = 6000 bps -> 1200c  (usr_fork_maker)
  //      ancestor 2000 bps               ->  400c  (usr_root_maker)   [lineage]
  //      contributor 1000 bps            ->  200c  (usr_contributor)  [carve]
  //      protocol pool 1000 bps          ->  200c  (never paid out)
  // ==========================================================================
  it('FORK → CONTRIBUTOR PAYOUT: purchasing a forked app emits a contributor allocation AND queues a pending contributor payout obligation, alongside maker + ancestor payouts', async () => {
    // Ownership loop from step 1 so the fork has a real parent + license history.
    await seedUser('usr_root_maker');
    await seedUser('usr_fork_maker');
    await seedUser('usr_contributor');
    await seedUser('usr_buyer_a');
    await seedUser('usr_buyer_b');

    await seedApp({ appId: 'acc-root', repoId: 'repo-acc-root', sellerId: 'usr_root_maker', priceCents: 1500 });

    // FORK: a downstream app forked from the root repo, owned by the fork maker.
    // Open a 6000 bps grantable pool (fork maker's 7000 bps slice minus the
    // 1000 bps maker floor) so the contributor grant is admitted by the cap trigger.
    await seedApp({ appId: 'acc-fork', repoId: 'repo-acc-fork', sellerId: 'usr_fork_maker', priceCents: 2000, grantableBps: 6000 });
    await seedFork({
      childRepoId: 'repo-acc-fork',
      parentRepoId: 'repo-acc-root',
      forkedByUserId: 'usr_fork_maker',
      lineageRootRepoId: 'repo-acc-root',
      depth: 1
    });

    // A contributor carved a 1000 bps share of the fork maker's slice.
    await grantContributorShare({
      id: 'cs_acc_1',
      repoId: 'repo-acc-fork',
      contributorId: 'usr_contributor',
      grantedById: 'usr_fork_maker',
      bps: 1000
    });

    await createSession('usr_buyer_b', 'tok_buyer_b');

    const order = await createOrder({
      appId: 'acc-fork',
      buyerToken: 'tok_buyer_b',
      idempotencyKey: 'acc-key-fork',
      paymentIntentId: 'pi_acc_fork'
    });
    expect(order.grossCents).toBe(2000);

    // INVARIANT: a 'contributor' allocation row is emitted with conserved cents
    const allocs = await allocationsFor(order.orderId);
    const byRole = Object.fromEntries(allocs.map(a => [a.role, a]));

    expect(byRole.maker).toMatchObject({ recipientUserId: 'usr_fork_maker', amountCents: 1200 });
    expect(byRole.ancestor).toMatchObject({ recipientUserId: 'usr_root_maker', amountCents: 400 });
    expect(byRole.contributor).toMatchObject({ recipientUserId: 'usr_contributor', amountCents: 200 });
    expect(byRole.protocol_pool).toMatchObject({ recipientUserId: null, amountCents: 200 });

    // Conservation of cents and basis points across the full split.
    expect(allocs.reduce((s, a) => s + a.amountCents, 0)).toBe(order.grossCents);

    // Fulfill the forked purchase.
    const result = await deliverAndProcessWebhook(order, 'evt_acc_fork');
    expect(result.success).toBe(true);
    expect(result.status).toBe('fulfilled');
    // maker + ancestor + contributor => 3 payout obligations (never protocol pool)
    expect(result.outboxCount).toBe(3);

    // INVARIANT (regression guard): a pending payout obligation is queued for
    // EACH real recipient — including the contributor. Before the fix,
    // contributor earnings were recorded but silently never queued for payout.
    const outbox = await outboxFor(order.orderId);
    expect(outbox).toEqual([
      { destinationUserId: 'usr_fork_maker', amountCents: 1200, status: 'pending' },
      { destinationUserId: 'usr_root_maker', amountCents: 400, status: 'pending' },
      { destinationUserId: 'usr_contributor', amountCents: 200, status: 'pending' }
    ]);

    // Explicit, isolated assertion on the contributor payout obligation.
    const contributorPayout: any = await ctx.d1.prepare(`
      SELECT destination_user_id AS destinationUserId, amount_cents AS amountCents, status
      FROM commerce_transfer_outbox
      WHERE order_id = ? AND destination_user_id = 'usr_contributor'
    `).bind(order.orderId).all();
    expect(contributorPayout.results).toHaveLength(1);
    expect(contributorPayout.results![0]).toEqual({
      destinationUserId: 'usr_contributor',
      amountCents: 200,
      status: 'pending'
    });

    // The buyer of the fork owns exactly one license for the forked app.
    const forkLicense: any = await ctx.d1.prepare(`
      SELECT app_id, owner_user_id FROM commerce_licenses WHERE order_id = ?
    `).bind(order.orderId).all();
    expect(forkLicense.results).toHaveLength(1);
    expect(forkLicense.results![0]).toEqual({ app_id: 'acc-fork', owner_user_id: 'usr_buyer_b' });
  });
});
