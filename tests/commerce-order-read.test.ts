import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as orderApi from '../functions/api/payments/orders/[id]';
import * as aliasOrderApi from '../functions/api/payments/order';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';
import { encryptLicenseSecret, generateLicenseKey, hashLicenseKey, getLicenseKeyLast4, generateBase64EncryptionKey } from '../src/lib/commerce/licenseCrypto';

describe('Buyer-Scoped Order Status & Receipt Endpoint (functions/api/payments/orders/[id])', () => {
  let ctx: TestD1Context;
  let testEncryptionKey: string;
  let testEnv: any;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    testEncryptionKey = generateBase64EncryptionKey();
    testEnv = {
      DB: ctx.d1,
      LICENSE_ENCRYPTION_KEYS_JSON: JSON.stringify({ '1': testEncryptionKey }),
      LICENSE_ACTIVE_KEY_VERSION: 1
    };
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

  async function seedTestUsers() {
    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name, avatar_url, role)
      VALUES
        ('usr_buyer_a', 'buyer_alice', 'Alice Buyer', '👩‍💻', 'user'),
        ('usr_buyer_b', 'buyer_bob', 'Bob Buyer', '👨‍💻', 'user'),
        ('usr_nate', 'nate', 'Nate McGuire', '⚡', 'maker')
    `).run();
  }

  describe('1. Authentication & Method Restrictions', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const req = new Request('http://localhost/api/payments/orders/ord_test_123', { method: 'GET' });
      const res = await orderApi.onRequestGet({ request: req, env: testEnv, params: { id: 'ord_test_123' } });
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/authenticated session required/i);
    });

    it('rejects non-GET HTTP methods with 405 Method Not Allowed', async () => {
      const res = await orderApi.onRequestPost();
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET');
    });
  });

  describe('2. Parameter Validation & Missing Orders', () => {
    it('returns 400 when order ID is empty', async () => {
      await seedTestUsers();
      await createSession('usr_buyer_a', 'token_alice');

      const req = new Request('http://localhost/api/payments/orders/', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const res = await orderApi.onRequestGet({ request: req, env: testEnv, params: { id: '' } });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Order ID is required/i);
    });

    it('returns 404 when order does not exist', async () => {
      await seedTestUsers();
      await createSession('usr_buyer_a', 'token_alice');

      const req = new Request('http://localhost/api/payments/orders/ord_nonexistent', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const res = await orderApi.onRequestGet({ request: req, env: testEnv, params: { id: 'ord_nonexistent' } });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/Order not found/i);
    });
  });

  describe('3. Buyer-Scoped Security (Zero Cross-Buyer Leakage)', () => {
    it('returns 404 when a buyer attempts to query another buyer\'s order', async () => {
      await seedTestUsers();
      await createSession('usr_buyer_a', 'token_alice');
      await createSession('usr_buyer_b', 'token_bob');

      const orderId = 'ord_alice_private_123';
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency,
          lineage_snapshot_json, status, created_at
        ) VALUES (
          ?, 'idem_alice_1', 'usr_buyer_a', 'dronehunter', 'usr_nate',
          'v1.0.0', 1, 1500, 'usd',
          '{"isRoot":true,"makerCents":1350,"protocolPoolCents":150}', 'requires_payment', datetime('now')
        )
      `).bind(orderId).run();

      const reqBob = new Request(`http://localhost/api/payments/orders/${orderId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_bob' }
      });
      const resBob = await orderApi.onRequestGet({ request: reqBob, env: testEnv, params: { id: orderId } });
      const dataBob = await resBob.json();

      expect(resBob.status).toBe(404);
      expect(dataBob.success).toBe(false);
      expect(dataBob.error).toBe('Order not found');

      const reqAlice = new Request(`http://localhost/api/payments/orders/${orderId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const resAlice = await orderApi.onRequestGet({ request: reqAlice, env: testEnv, params: { id: orderId } });
      const dataAlice = await resAlice.json();

      expect(resAlice.status).toBe(200);
      expect(dataAlice.success).toBe(true);
      expect(dataAlice.order.id).toBe(orderId);
      expect(dataAlice.order.status).toBe('requires_payment');
      expect(dataAlice.order.amountCents).toBe(1500);
    });
  });

  describe('4. Pending & Fulfilled Order State Contract', () => {
    it('returns pending order details before fulfillment', async () => {
      await seedTestUsers();
      await createSession('usr_buyer_a', 'token_alice');

      const orderId = 'ord_pending_test_1';
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency,
          lineage_snapshot_json, stripe_payment_intent_id, status, created_at
        ) VALUES (
          ?, 'idem_pending_1', 'usr_buyer_a', 'dronehunter', 'usr_nate',
          'v1.0.0', 1, 1500, 'usd',
          '{"isRoot":true,"makerCents":1350,"protocolPoolCents":150,"allocations":[{"role":"maker","amountCents":1350,"basisPoints":9000}]}',
          'pi_pending_123', 'requires_payment', datetime('now')
        )
      `).bind(orderId).run();

      const req = new Request(`http://localhost/api/payments/orders/${orderId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const res = await orderApi.onRequestGet({ request: req, env: testEnv, params: { id: orderId } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.order).toMatchObject({
        id: orderId,
        appId: 'dronehunter',
        appName: 'DroneHunter 95',
        appVersion: 'v1.0.0',
        status: 'requires_payment',
        amountCents: 1500,
        currency: 'usd',
        license: null
      });
      expect(data.order.seller).toMatchObject({
        id: 'usr_nate',
        username: 'nate'
      });
      expect(data.order.lineageSnapshot.isRoot).toBe(true);
    });

    it('returns fulfilled order details with decrypted license key, last4, and binaries', async () => {
      await seedTestUsers();
      await createSession('usr_buyer_a', 'token_alice');

      const orderId = 'ord_fulfilled_test_1';
      const rawLicenseKey = generateLicenseKey('dronehunter');
      const licenseHash = await hashLicenseKey(rawLicenseKey);
      const licenseLast4 = getLicenseKeyLast4(rawLicenseKey);
      const licenseId = 'lic_test_fulfilled_1';

      const encrypted = await encryptLicenseSecret(rawLicenseKey, testEnv);

      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency,
          lineage_snapshot_json, stripe_payment_intent_id, status,
          created_at, paid_at, fulfilled_at
        ) VALUES (
          ?, 'idem_fulfilled_1', 'usr_buyer_a', 'dronehunter', 'usr_nate',
          'v1.0.0', 1, 1500, 'usd',
          '{"isRoot":true,"makerCents":1350,"protocolPoolCents":150}',
          'pi_fulfilled_123', 'fulfilled',
          datetime('now'), datetime('now'), datetime('now')
        )
      `).bind(orderId).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_licenses (
          id, order_id, app_id, owner_user_id,
          license_key_hash, license_key_last4, status, issued_at
        ) VALUES (?, ?, 'dronehunter', 'usr_buyer_a', ?, ?, 'active', datetime('now'))
      `).bind(licenseId, orderId, licenseHash, licenseLast4).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_license_secrets (
          license_id, ciphertext_base64, iv_base64, algorithm, key_version, created_at
        ) VALUES (?, ?, ?, 'AES-256-GCM', ?, datetime('now'))
      `).bind(licenseId, encrypted.ciphertextBase64, encrypted.ivBase64, encrypted.keyVersion).run();

      const req = new Request(`http://localhost/api/payments/orders/${orderId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const res = await orderApi.onRequestGet({ request: req, env: testEnv, params: { id: orderId } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.order.status).toBe('fulfilled');
      expect(data.order.license).toBeTruthy();
      expect(data.order.license.id).toBe(licenseId);
      expect(data.order.license.licenseKey).toBe(rawLicenseKey);
      expect(data.order.license.licenseKeyLast4).toBe(licenseLast4);
      expect(data.order.license.maskedKey).toBe(`NSW-DR-••••-${licenseLast4}`);
      expect(data.order.license.status).toBe('active');
    });

    it('query-param alias endpoint (/api/payments/order?id=...) also resolves the order', async () => {
      await seedTestUsers();
      await createSession('usr_buyer_a', 'token_alice');

      const orderId = 'ord_alias_test_1';
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency,
          lineage_snapshot_json, status, created_at
        ) VALUES (
          ?, 'idem_alias_1', 'usr_buyer_a', 'dronehunter', 'usr_nate',
          'v1.0.0', 1, 1500, 'usd',
          '{"isRoot":true}', 'requires_payment', datetime('now')
        )
      `).bind(orderId).run();

      const req = new Request(`http://localhost/api/payments/order?id=${orderId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer token_alice' }
      });
      const res = await aliasOrderApi.onRequestGet({ request: req, env: testEnv });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.order.id).toBe(orderId);
    });
  });
});
