import { describe, it, expect } from 'vitest';
import * as createIntentApi from '../functions/api/payments/create-intent';
import * as onboardApi from '../functions/api/payments/onboard';
import * as webhookApi from '../functions/api/payments/webhook';

describe('Stripe Marketplace Payments & 70/20/10 Lineage Engine', () => {

  it('should calculate exact 70% maker, 20% lineage, 10% platform split conserving all cents', async () => {
    const mockEnv = {};
    const req = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'dronehunter', customPriceCents: 1500 })
    });

    const res = await createIntentApi.onRequestPost({ request: req, env: mockEnv });
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.amountCents).toBe(1500);
    expect(data.splits.makerCents).toBe(1050); // 70%
    expect(data.splits.lineageCents).toBe(300); // 20%
    expect(data.splits.platformCents).toBe(150); // 10%
    expect(data.splits.makerCents + data.splits.lineageCents + data.splits.platformCents).toBe(1500);
    expect(data.transferGroup).toContain('grp_ord_');
  });

  it('should generate Stripe Connect Express onboarding URL for makers', async () => {
    const mockEnv = {};
    const req = new Request('http://localhost/api/payments/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nate', country: 'US' })
    });

    const res = await onboardApi.onRequestPost({ request: req, env: mockEnv });
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.accountId).toContain('acct_mock_nate_');
    expect(data.url).toContain('https://connect.stripe.com/express/onboarding/');
  });

  it('should handle payment_intent.succeeded webhook and mint cryptographic license', async () => {
    const mockEnv = {};
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'payment_intent.succeeded',
        paymentIntentId: 'pi_test_123',
        appId: 'dronehunter',
        buyerId: 'usr_nate'
      })
    });

    const res = await webhookApi.onRequestPost({ request: req, env: mockEnv });
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.settled).toBe(true);
    expect(data.licenseKey).toMatch(/^NSW-DR-\d{4}-[A-Z0-9]+$/);
    expect(data.shelfId).toContain('shelf_');
  });
});
