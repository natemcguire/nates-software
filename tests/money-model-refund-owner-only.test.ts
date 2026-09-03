// Tests for the owner-only discretionary refund INITIATION endpoint:
//   POST /api/payments/refund  (functions/api/payments/refund.ts)
//
// Policy (docs/superpowers/plans/2026-09-03-shareware-restored-money-model.md,
// Task D1 + Global Constraints): all sales are final. ONLY the site owner
// (role 'super_admin') may initiate a refund, at their discretion. No
// buyer/maker refund path may exist anywhere in the app.
//
// This endpoint only CREATES the Stripe refund (POST /v1/refunds). It must
// NOT write commerce_refunds / commerce_order_allocations rows itself — that
// money-movement recording is exclusively the job of the existing
// refund.created webhook processor (src/lib/commerce/refundProcessor.ts),
// which GETs the authoritative refund back from Stripe before recording
// anything. Duplicating that here would create two paths that can disagree
// about the truth of a refund.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';
import { onRequestPost as refundPost } from '../functions/api/payments/refund';

describe('POST /api/payments/refund — owner-only discretionary refund', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  async function seedUser(id: string, role = 'maker') {
    await ctx.d1.prepare(`INSERT OR IGNORE INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)`)
      .bind(id, id.replace('usr_', ''), `User ${id}`, role).run();
  }

  async function insertSession(token: string, userId: string, expiresInMs = 3_600_000) {
    const tokenHash = await hashSessionToken(token);
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(tokenHash, userId, Date.now() + expiresInMs, Date.now()).run();
  }

  async function seedFulfilledOrder(orderId: string, opts: { paymentIntentId?: string; grossCents?: number; status?: string } = {}) {
    await seedUser('usr_buyer');
    await seedUser('usr_maker_seller');
    const paymentIntentId = opts.paymentIntentId ?? `pi_${orderId}`;
    const grossCents = opts.grossCents ?? 1500;
    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, seller_user_id,
        app_version, price_version, gross_cents, currency,
        lineage_policy, lineage_snapshot_json, stripe_payment_intent_id,
        status, state_version, created_at, updated_at
      ) VALUES (?, ?, 'usr_buyer', 'dronehunter', 'usr_maker_seller', 'v1.0.0', 1, ?, 'usd', 'shareware_restored', '{}', ?, ?, 1, datetime('now'), datetime('now'))
    `).bind(orderId, `idem_${orderId}`, grossCents, paymentIntentId, opts.status ?? 'fulfilled').run();
    return { orderId, paymentIntentId, grossCents };
  }

  function req(body: unknown, token?: string): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return new Request('https://x/api/payments/refund', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  }

  it('returns 401 when unauthenticated', async () => {
    const { orderId } = await seedFulfilledOrder('ord_unauth');
    const res = await refundPost({ request: req({ orderId }), env: { DB: ctx.d1 } } as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 403 for an authenticated non-super_admin (maker) session', async () => {
    await seedUser('usr_maker', 'maker');
    await insertSession('tok_maker', 'usr_maker');
    const { orderId } = await seedFulfilledOrder('ord_forbidden');
    const res = await refundPost({
      request: req({ orderId }, 'tok_maker'),
      env: { DB: ctx.d1 }
    } as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 403 for an authenticated non-super_admin (user role) session', async () => {
    await seedUser('usr_plain', 'user');
    await insertSession('tok_plain', 'usr_plain');
    const { orderId } = await seedFulfilledOrder('ord_forbidden_2');
    const res = await refundPost({
      request: req({ orderId }, 'tok_plain'),
      env: { DB: ctx.d1 }
    } as any);
    expect(res.status).toBe(403);
  });

  it('super_admin issues POST /v1/refunds to Stripe and returns 200 + refundId; writes no commerce_refunds row', async () => {
    await seedUser('usr_nate', 'super_admin');
    await insertSession('tok_admin', 'usr_nate');
    const { orderId, paymentIntentId } = await seedFulfilledOrder('ord_ok');

    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://api.stripe.com/v1/refunds');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer sk_test_123');
      expect(init.headers['Idempotency-Key']).toBeTruthy();
      const params = new URLSearchParams(init.body);
      expect(params.get('payment_intent')).toBe(paymentIntentId);
      return new Response(JSON.stringify({ id: 're_test_123', object: 'refund', status: 'pending', payment_intent: paymentIntentId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const res = await refundPost({
      request: req({ orderId }, 'tok_admin'),
      env: { DB: ctx.d1, STRIPE_SECRET_KEY: 'sk_test_123' },
      stripeFetchOverride: fetchMock
    } as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.refundId).toBe('re_test_123');

    // This endpoint must NEVER write commerce_refunds itself — that is
    // exclusively the refund.created webhook processor's job (it re-fetches
    // the authoritative refund from Stripe before recording anything).
    const rows = await ctx.d1.prepare(`SELECT COUNT(*) AS n FROM commerce_refunds`).first();
    expect(Number((rows as any).n)).toBe(0);
  });

  it('supports an optional partial amountCents and includes it in the idempotency key + Stripe body', async () => {
    await seedUser('usr_nate', 'super_admin');
    await insertSession('tok_admin', 'usr_nate');
    const { orderId, paymentIntentId } = await seedFulfilledOrder('ord_partial', { grossCents: 2000 });

    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const params = new URLSearchParams(init.body);
      expect(params.get('payment_intent')).toBe(paymentIntentId);
      expect(params.get('amount')).toBe('500');
      return new Response(JSON.stringify({ id: 're_partial_1', object: 'refund', status: 'pending', payment_intent: paymentIntentId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const res = await refundPost({
      request: req({ orderId, amountCents: 500 }, 'tok_admin'),
      env: { DB: ctx.d1, STRIPE_SECRET_KEY: 'sk_test_123' },
      stripeFetchOverride: fetchMock
    } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.refundId).toBe('re_partial_1');
  });

  it('returns a 4xx/502 when Stripe returns an error, and writes no commerce_refunds row', async () => {
    await seedUser('usr_nate', 'super_admin');
    await insertSession('tok_admin', 'usr_nate');
    const { orderId } = await seedFulfilledOrder('ord_stripe_fail');

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'This PaymentIntent has already been refunded.', type: 'invalid_request_error' }
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

    const res = await refundPost({
      request: req({ orderId }, 'tok_admin'),
      env: { DB: ctx.d1, STRIPE_SECRET_KEY: 'sk_test_123' },
      stripeFetchOverride: fetchMock
    } as any);

    expect([400, 402, 409, 422, 502]).toContain(res.status);
    const body = await res.json();
    expect(body.success).toBe(false);

    const rows = await ctx.d1.prepare(`SELECT COUNT(*) AS n FROM commerce_refunds`).first();
    expect(Number((rows as any).n)).toBe(0);
  });

  it('returns 404 for an unknown orderId (super_admin)', async () => {
    await seedUser('usr_nate', 'super_admin');
    await insertSession('tok_admin', 'usr_nate');
    const res = await refundPost({
      request: req({ orderId: 'ord_does_not_exist' }, 'tok_admin'),
      env: { DB: ctx.d1, STRIPE_SECRET_KEY: 'sk_test_123' }
    } as any);
    expect(res.status).toBe(404);
  });

  it('returns 400 for an order with no Stripe payment intent attached', async () => {
    await seedUser('usr_nate', 'super_admin');
    await insertSession('tok_admin', 'usr_nate');
    await seedUser('usr_buyer');
    await seedUser('usr_maker_seller');
    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, seller_user_id,
        app_version, price_version, gross_cents, currency,
        lineage_policy, lineage_snapshot_json, stripe_payment_intent_id,
        status, state_version, created_at, updated_at
      ) VALUES ('ord_no_pi', 'idem_ord_no_pi', 'usr_buyer', 'dronehunter', 'usr_maker_seller', 'v1.0.0', 1, 1500, 'usd', 'shareware_restored', '{}', NULL, 'creating', 1, datetime('now'), datetime('now'))
    `).run();

    const res = await refundPost({
      request: req({ orderId: 'ord_no_pi' }, 'tok_admin'),
      env: { DB: ctx.d1, STRIPE_SECRET_KEY: 'sk_test_123' }
    } as any);
    expect(res.status).toBe(400);
  });
});

describe('no non-admin refund-initiation path exists (grep guard)', () => {
  it('only functions/api/payments/refund.ts POSTs /v1/refunds; only refundProcessor.ts GETs it', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const searchDirs = ['functions', 'src'];
    const matches: { file: string; line: number; text: string }[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          walk(full);
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf-8');
          content.split('\n').forEach((line, idx) => {
            if (line.includes('v1/refunds')) {
              matches.push({ file: path.relative(repoRoot, full), line: idx + 1, text: line.trim() });
            }
          });
        }
      }
    }

    for (const d of searchDirs) walk(path.join(repoRoot, d));

    const files = new Set(matches.map(m => m.file));
    expect(Array.from(files).sort()).toEqual([
      'functions/api/payments/refund.ts',
      'src/lib/commerce/refundProcessor.ts'
    ]);

    for (const m of matches) {
      if (m.file === 'functions/api/payments/refund.ts') {
        expect(m.text.toLowerCase()).not.toContain("method: 'get'");
      }
      if (m.file === 'src/lib/commerce/refundProcessor.ts') {
        // The webhook processor only ever GETs the authoritative refund back;
        // it must never itself POST a new refund into existence.
        expect(m.text).not.toMatch(/method:\s*'POST'/);
      }
    }
  });
});
