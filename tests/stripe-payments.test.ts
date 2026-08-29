import { describe, it, expect } from 'vitest';
import * as createIntentApi from '../functions/api/payments/create-intent';
import * as onboardApi from '../functions/api/payments/onboard';
import * as webhookApi from '../functions/api/payments/webhook';

describe('Payment commissioning boundary', () => {
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
});
