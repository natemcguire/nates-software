import { describe, it, expect } from 'vitest';
import * as authApi from '../functions/api/auth';
import * as webhookApi from '../functions/api/payments/webhook';
import * as shelfApi from '../functions/api/shelf';
import * as inboxApi from '../functions/api/inbox';

describe('Security Hardening & Zero-Bypass Invariants', () => {
  it('should reject login with incorrect password even for seeded accounts', async () => {
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              id: 'usr_nate',
              username: 'nate',
              salt: 'aabbccddeeff00112233445566778899',
              password_hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
            })
          })
        })
      }
    };

    const req = new Request('http://localhost/api/auth?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nate', password: 'wrongpassword' })
    });

    const res = await authApi.onRequestPost({ request: req, env: mockEnv });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid username or password');
  });

  it('should reject webhook requests with invalid or missing Stripe signatures', async () => {
    const mockEnv = {
      PAYMENTS_ENABLED: 'true',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_123456'
    };

    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 't=12345,v1=invalid_fake_signature'
      },
      body: JSON.stringify({ type: 'payment_intent.succeeded', id: 'pi_test' })
    });

    const res = await webhookApi.onRequestPost({ request: req, env: mockEnv });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid Stripe signature');
  });

  it('should reject direct shelf license minting with 405 Method Not Allowed', async () => {
    const mockEnv = {};
    const req = new Request('http://localhost/api/shelf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'dronehunter' })
    });

    const res = await shelfApi.onRequestPost({ request: req, env: mockEnv });
    const data = await res.json();

    expect(data.success).toBe(false);
    expect(res.status).toBe(405);
    expect(data.error).toContain('Direct license minting is disabled');
  });

  it('should reject invalid inbox actions', async () => {
    const mockEnv = {};
    const req = new Request('http://localhost/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invalid_action' })
    });

    const res = await inboxApi.onRequestPost({ request: req, env: mockEnv });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
  });
});
