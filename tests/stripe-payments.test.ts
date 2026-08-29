import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import * as createIntentApi from '../functions/api/payments/create-intent';
import * as onboardApi from '../functions/api/payments/onboard';
import * as webhookApi from '../functions/api/payments/webhook';

describe('Payment commissioning boundary', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    ['checkout', createIntentApi.onRequestPost, '/api/payments/create-intent', { appId: 'dronehunter' }],
    ['maker onboarding', onboardApi.onRequestPost, '/api/payments/onboard', { userId: 'usr_nate' }],
    ['settlement', webhookApi.onRequestPost, '/api/payments/webhook', { type: 'payment_intent.succeeded' }]
  ])('fails closed for %s while payments are disabled', async (_name, handler, path, body) => {
    const res = await handler({
      request: new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }),
      env: {}
    });
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/unavailable|not enabled/i);
  });

  it('requires an authenticated session before Stripe onboarding', async () => {
    const response = await onboardApi.onRequestPost({
      request: new Request('https://nates-software.com/api/payments/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: 'US' })
      }),
      env: { DB: ctx.d1, PAYMENTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_realish' }
    });
    expect(response.status).toBe(401);
  });

  it('never fabricates an account when Stripe credentials are absent or mock', async () => {
    const response = await onboardApi.onRequestPost({
      request: new Request('https://nates-software.com/api/payments/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_test_token'
        },
        body: JSON.stringify({ country: 'US' })
      }),
      env: { DB: ctx.d1, PAYMENTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_mock' }
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false });
    expect(await ctx.d1.prepare('SELECT COUNT(*) AS count FROM stripe_accounts').first()).toMatchObject({ count: 0 });
  });

  it('creates and persists a real Stripe account before returning a single-use onboarding link', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'acct_real_123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        url: 'https://connect.stripe.com/setup/c/acct_real_123/link',
        expires_at: 1_800_000_000
      }), { status: 200 }));

    const response = await onboardApi.onRequestPost({
      request: new Request('https://nates-software.com/api/payments/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_test_token'
        },
        body: JSON.stringify({ userId: 'usr_someone_else', country: 'US', email: 'nate@example.com' })
      }),
      env: {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_realish',
        PUBLIC_APP_ORIGIN: 'https://nates-software.com'
      }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      accountId: 'acct_real_123',
      onboardingUrl: 'https://connect.stripe.com/setup/c/acct_real_123/link'
    });
    const stored = await ctx.d1.prepare(
      'SELECT user_id AS userId, stripe_account_id AS accountId FROM stripe_accounts WHERE user_id = ?'
    ).bind('usr_nate').first();
    expect(stored).toMatchObject({ userId: 'usr_nate', accountId: 'acct_real_123' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
