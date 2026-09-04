import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as webhookApi from '../functions/api/payments/webhook';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { generateStripeSignatureHeader, computeStripeSignature } from '../src/lib/commerce/stripeSignature';

describe('Durable Commerce P2: /api/payments/webhook Ingestion & Invariants', () => {
  let ctx: TestD1Context;
  const webhookSecret = 'whsec_test_secret_key_1234567890';

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  const validPayload = {
    id: 'evt_test_123456789',
    type: 'payment_intent.succeeded',
    api_version: '2023-10-16',
    livemode: false,
    data: {
      object: {
        id: 'pi_test_123456789',
        amount: 1500,
        currency: 'usd',
        status: 'succeeded',
        metadata: {
          orderId: 'ord_test_123'
        }
      }
    }
  };

  function createSignedRequest(
    payloadObj: any,
    secret = webhookSecret,
    timestampOffsetSec = 0
  ) {
    const rawBody = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
    const nowSec = Math.floor(Date.now() / 1000) + timestampOffsetSec;

    return {
      rawBody,
      nowSec,
      buildRequest: async (customHeaders: Record<string, string> = {}) => {
        const sigHeader = await generateStripeSignatureHeader(rawBody, secret, nowSec);
        return new Request('http://localhost/api/payments/webhook', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'stripe-signature': sigHeader.header,
            ...customHeaders
          },
          body: rawBody
        });
      }
    };
  }

  describe('1. PAYMENTS_ENABLED Guard', () => {
    it('returns 503 when PAYMENTS_ENABLED is missing or not "true"', async () => {
      const { buildRequest } = createSignedRequest(validPayload);
      const req = await buildRequest();

      const res = await webhookApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, STRIPE_WEBHOOK_SECRET: webhookSecret }
      });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Payment settlement is not enabled/i);
    });

    it('returns 503 when PAYMENTS_ENABLED is string "false"', async () => {
      const { buildRequest } = createSignedRequest(validPayload);
      const req = await buildRequest();

      const res = await webhookApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, PAYMENTS_ENABLED: 'false', STRIPE_WEBHOOK_SECRET: webhookSecret }
      });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
    });
  });

  describe('2. Mandatory STRIPE_WEBHOOK_SECRET', () => {
    it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
      const { buildRequest } = createSignedRequest(validPayload);
      const req = await buildRequest();

      const res = await webhookApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, PAYMENTS_ENABLED: 'true' }
      });
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/STRIPE_WEBHOOK_SECRET must be configured/i);
    });

    it('returns 500 when STRIPE_WEBHOOK_SECRET is empty or whitespace', async () => {
      const { buildRequest } = createSignedRequest(validPayload);
      const req = await buildRequest();

      const res = await webhookApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, PAYMENTS_ENABLED: 'true', STRIPE_WEBHOOK_SECRET: '   ' }
      });
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });

  describe('3. Stripe Signature Verification & Replay Protection', () => {
    const validEnv = () => ({
      DB: ctx.d1,
      PAYMENTS_ENABLED: 'true',
      STRIPE_WEBHOOK_SECRET: webhookSecret
    });

    it('rejects request with missing stripe-signature header (401)', async () => {
      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload)
      });

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Missing stripe-signature header/i);
    });

    it('rejects forged / invalid signature with 401', async () => {
      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=0000000000000000000000000000000000000000000000000000000000000000`
        },
        body: JSON.stringify(validPayload)
      });

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid Stripe signature');
    });

    it('rejects expired signature timestamp older than 5 minutes (300 seconds) with 401', async () => {
      const { buildRequest } = createSignedRequest(validPayload, webhookSecret, -360);
      const req = await buildRequest();

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid Stripe signature');
    });

    it('rejects future signature timestamp drifted > 5 minutes with 401', async () => {
      const { buildRequest } = createSignedRequest(validPayload, webhookSecret, +360);
      const req = await buildRequest();

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.success).toBe(false);
    });

    it('accepts valid signature within 5-minute tolerance', async () => {
      const { buildRequest } = createSignedRequest(validPayload, webhookSecret, -60);
      const req = await buildRequest();

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(202);
      expect(data.success).toBe(true);
      expect(data.received).toBe(true);
      expect(data.eventId).toBe(validPayload.id);
    });

    it('supports multiple v1 signatures in header (key rotation) if any matches', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const rawBody = JSON.stringify(validPayload);
      const validSig = await computeStripeSignature(rawBody, nowSec, webhookSecret);
      const oldSig = '1111111111111111111111111111111111111111111111111111111111111111';

      const multiSigHeader = `t=${nowSec},v1=${oldSig},v1=${validSig}`;

      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': multiSigHeader
        },
        body: rawBody
      });

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(202);
      expect(data.success).toBe(true);
    });

    it('detects tampering in raw body and rejects with 401', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const originalBody = JSON.stringify(validPayload);
      const signature = await computeStripeSignature(originalBody, nowSec, webhookSecret);

      const tamperedPayload = { ...validPayload, id: 'evt_tampered_id' };
      const tamperedBody = JSON.stringify(tamperedPayload);

      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': `t=${nowSec},v1=${signature}`
        },
        body: tamperedBody
      });

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid Stripe signature');
    });
  });

  describe('4. Payload Schema Validation', () => {
    const validEnv = () => ({
      DB: ctx.d1,
      PAYMENTS_ENABLED: 'true',
      STRIPE_WEBHOOK_SECRET: webhookSecret
    });

    it('rejects malformed JSON body with 400', async () => {
      const rawBody = '{ not valid json ';
      const nowSec = Math.floor(Date.now() / 1000);
      const signature = await computeStripeSignature(rawBody, nowSec, webhookSecret);

      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': `t=${nowSec},v1=${signature}`
        },
        body: rawBody
      });

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Invalid JSON body/i);
    });

    it('rejects payload missing event id or type with 400', async () => {
      const payloadWithoutId = { type: 'payment_intent.succeeded' };
      const { buildRequest } = createSignedRequest(payloadWithoutId);
      const req = await buildRequest();

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/missing id or type/i);
    });
  });

  describe('5. Durable Inbox Persistence & Collision Security (409)', () => {
    const validEnv = () => ({
      DB: ctx.d1,
      PAYMENTS_ENABLED: 'true',
      STRIPE_WEBHOOK_SECRET: webhookSecret
    });

    it('persists verified event into stripe_event_inbox with status received and SHA-256 hash', async () => {
      const eventId = 'evt_inbox_persist_test_1';
      const payload = { ...validPayload, id: eventId };

      const { buildRequest } = createSignedRequest(payload);
      const req = await buildRequest();

      const res = await webhookApi.onRequestPost({ request: req, env: validEnv() });
      const data = await res.json();

      expect(res.status).toBe(202);
      expect(data.success).toBe(true);
      expect(data.received).toBe(true);

      const inboxRow: any = await ctx.d1.prepare(`
        SELECT * FROM stripe_event_inbox WHERE event_id = ?
      `).bind(eventId).first();

      expect(inboxRow).toBeTruthy();
      expect(inboxRow.event_type).toBe('payment_intent.succeeded');
      expect(inboxRow.status).toBe('received');
      expect(inboxRow.signature_verified).toBe(1);
      expect(inboxRow.payload_sha256).toHaveLength(64);
    });

    it('accepts identical duplicate event idempotently (returns 202 duplicate: true)', async () => {
      const eventId = 'evt_dedup_test_identical';
      const payload = { ...validPayload, id: eventId };

      const { buildRequest: build1 } = createSignedRequest(payload);
      const res1 = await webhookApi.onRequestPost({ request: await build1(), env: validEnv() });
      const data1 = await res1.json();

      expect(res1.status).toBe(202);
      expect(data1.duplicate).toBe(false);

      const { buildRequest: build2 } = createSignedRequest(payload);
      const res2 = await webhookApi.onRequestPost({ request: await build2(), env: validEnv() });
      const data2 = await res2.json();

      expect(res2.status).toBe(202);
      expect(data2.success).toBe(true);
      expect(data2.duplicate).toBe(true);
      expect(data2.received).toBe(true);
    });

    it('rejects event ID collision with DIFFERENT payload hash with 409 Conflict', async () => {
      const eventId = 'evt_collision_test_target';

      const payload1 = {
        ...validPayload,
        id: eventId,
        data: { object: { id: 'pi_first_123', amount: 1500 } }
      };
      const { buildRequest: build1 } = createSignedRequest(payload1);
      const res1 = await webhookApi.onRequestPost({ request: await build1(), env: validEnv() });
      expect(res1.status).toBe(202);

      const payload2 = {
        ...validPayload,
        id: eventId,
        data: { object: { id: 'pi_second_hacker_attempt', amount: 9999 } }
      };
      const { buildRequest: build2 } = createSignedRequest(payload2);
      const res2 = await webhookApi.onRequestPost({ request: await build2(), env: validEnv() });
      const data2 = await res2.json();

      expect(res2.status).toBe(409);
      expect(data2.success).toBe(false);
      expect(data2.error).toMatch(/Event ID collision detected/i);
    });
  });

  describe('6. Async Background Execution Contract', () => {
    it('schedules processor with waitUntil and never returns settled: true synchronously', async () => {
      const { buildRequest } = createSignedRequest(validPayload);
      const req = await buildRequest();

      let scheduledPromise: Promise<any> | null = null;
      const waitUntilMock = vi.fn((promise: Promise<any>) => {
        scheduledPromise = promise;
      });

      const res = await webhookApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          PAYMENTS_ENABLED: 'true',
          STRIPE_WEBHOOK_SECRET: webhookSecret
        },
        waitUntil: waitUntilMock
      });

      const data = await res.json();

      expect(res.status).toBe(202);
      expect(data.received).toBe(true);
      expect(data.settled).toBeUndefined();

      expect(waitUntilMock).toHaveBeenCalledTimes(1);
      expect(scheduledPromise).not.toBeNull();
    });
  });
});
