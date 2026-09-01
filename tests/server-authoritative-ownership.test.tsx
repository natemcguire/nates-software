import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as shelfApi from '../functions/api/shelf';
import * as shelfVerifyApi from '../functions/api/shelf/verify';
import { hashSessionToken } from '../functions/api/_session';
import { hashLicenseKey, generateLicenseKey } from '../src/lib/commerce/licenseCrypto';
import { CatalogProvider, useCatalog } from '../src/context/CatalogContext';
import { AuthProvider } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import { ArtifactSandbox } from '../src/components/ArtifactSandbox';
import { AppListing } from '../src/data/mockData';

// Helper component to extract CatalogContext state
function CatalogStateConsumer({ onState }: { onState: (ctx: ReturnType<typeof useCatalog>) => void }) {
  const ctx = useCatalog();
  onState(ctx);
  return null;
}

describe('Spec LICENSE — Server-Authoritative Ownership & Verification', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Client-Side Anti-Forgery & Server-Authoritative CatalogContext.isOwned
  // ==========================================================================
  describe('1. Client-Side Anti-Forgery & Server-Authoritative isOwned', () => {
    it('forged localStorage license key does NOT grant ownership (isOwned returns false)', async () => {
      // Attacker manipulates window.localStorage
      const mockStorage: Record<string, string> = {
        'nsw_license_dronehunter': 'NSW-DH-9812-77F2-FORGED',
        'nsw_license_wallart': 'NSW-WA-9999-0000',
        'nsw_runs_dronehunter': '9999'
      };

      const globalAny = global as any;
      const originalLocalStorage = globalAny.localStorage;
      globalAny.localStorage = {
        getItem: (k: string) => mockStorage[k] || null,
        setItem: (k: string, v: string) => { mockStorage[k] = v; },
        removeItem: (k: string) => { delete mockStorage[k]; },
        clear: () => {}
      };

      try {
        // Mock server fetch: unauthenticated guest user has empty shelf
        global.fetch = vi.fn().mockImplementation((url: string) => {
          if (url.includes('/api/drops')) {
            return Promise.resolve(new Response(JSON.stringify({
              success: true,
              drops: [{ id: 'dronehunter', name: 'DroneHunter 95', version: 'v1.0.0', price: '$15' }]
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          if (url.includes('/api/shelf')) {
            return Promise.resolve(new Response(JSON.stringify({
              success: true,
              shelf: []
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return Promise.resolve(new Response('{}', { status: 200 }));
        });

        let catalogContext: ReturnType<typeof useCatalog> | undefined;
        renderToString(
          <AuthProvider>
            <CatalogProvider>
              <CatalogStateConsumer onState={(c) => { catalogContext = c; }} />
            </CatalogProvider>
          </AuthProvider>
        );

        expect(catalogContext).toBeDefined();
        // Server shelf is empty -> isOwned MUST be false despite localStorage forgery
        expect(catalogContext!.isOwned('dronehunter')).toBe(false);
        expect(catalogContext!.isOwned('wallart')).toBe(false);
      } finally {
        globalAny.localStorage = originalLocalStorage;
      }
    });

    it('CatalogContext.isOwned delegates strictly to /api/shelf (never localStorage)', async () => {
      let shelfFetched = false;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/shelf')) {
          shelfFetched = true;
          return Promise.resolve(new Response(JSON.stringify({
            success: true,
            shelf: [
              {
                id: 'lic_01',
                appId: 'dronehunter',
                name: 'DroneHunter 95',
                status: 'active',
                licenseKeyLast4: '77F2'
              }
            ]
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      let catalogContext: ReturnType<typeof useCatalog> | undefined;
      renderToString(
        <AuthProvider>
          <CatalogProvider>
            <CatalogStateConsumer onState={(c) => { catalogContext = c; }} />
          </CatalogProvider>
        </AuthProvider>
      );

      expect(catalogContext).toBeDefined();
      expect(typeof catalogContext!.refreshShelf).toBe('function');
      expect(typeof catalogContext!.isOwned).toBe('function');

      // Unowned by default for unauthenticated/unfetched state
      expect(catalogContext!.isOwned('dronehunter')).toBe(false);

      // Invoking refreshShelf triggers authoritative /api/shelf network request
      await catalogContext!.refreshShelf();
      expect(shelfFetched).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('/api/shelf');
    });

    it('ArtifactSandbox displays buy button when not owned, and "License Active on Shelf" when owned', () => {
      const testApp: AppListing = {
        id: 'dronehunter',
        name: 'DroneHunter 95',
        tagline: 'Defend the retro skies',
        description: 'Retro arcade game',
        author: 'nate',
        authorAvatar: '⚡',
        version: 'v1.0.0',
        upvotes: 42,
        forkCount: 3,
        tags: ['Game'],
        screenshots: [],
        comments: [],
        price: 15
      };

      // 1. Unowned app renders "Register License" CTA
      const unownedHtml = renderToString(
        <AlertProvider>
          <AuthProvider>
            <CatalogProvider>
              <ArtifactSandbox app={testApp} />
            </CatalogProvider>
          </AuthProvider>
        </AlertProvider>
      );

      expect(unownedHtml).toContain('Register License');
      expect(unownedHtml).not.toContain('License Active on Shelf');
    });
  });

  // ==========================================================================
  // 2. Server License Verification Endpoint (/api/shelf/verify)
  // ==========================================================================
  describe('2. Server License Verification Endpoint (/api/shelf/verify)', () => {
    it('rejects unauthenticated GET /api/shelf/verify with 401 Unauthorized', async () => {
      const req = new Request('http://localhost/api/shelf/verify?appId=dronehunter', { method: 'GET' });
      const res = await shelfVerifyApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Valid authenticated session required');
    });

    it('rejects unauthenticated POST /api/shelf/verify with 401 Unauthorized', async () => {
      const req = new Request('http://localhost/api/shelf/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'dronehunter' })
      });
      const res = await shelfVerifyApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('returns 400 when authenticated request has neither appId nor licenseKey', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_alice', 'alice', 'Alice', 'user')
      `).run();
      const token = 'tok_alice';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_alice', ?)
      `).bind(await hashSessionToken(token), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/shelf/verify', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const res = await shelfVerifyApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('parameter is required');
    });

    it('returns verified: false for authenticated non-owner', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_charlie', 'charlie', 'Charlie', 'user')
      `).run();
      const token = 'tok_charlie';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_charlie', ?)
      `).bind(await hashSessionToken(token), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/shelf/verify?appId=dronehunter', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const res = await shelfVerifyApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.verified).toBe(false);
      expect(data.isOwned).toBe(false);
    });

    it('returns verified: true for real owner with minted license row in commerce_licenses', async () => {
      const ownerId = 'usr_real_owner';
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_real_owner', 'real_owner', 'Real Owner', 'user')
      `).run();
      const token = 'tok_real_owner';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_real_owner', ?)
      `).bind(await hashSessionToken(token), Date.now() + 100000).run();

      // Seed a fulfilled order and active commerce license
      const orderId = 'cord_test_owner_01';
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json, status, fulfilled_at
        ) VALUES (?, 'idem_owner_01', ?, 'dronehunter', 'usr_nate', 'v1.0.0', 1, 1500, 'usd', '[]', 'fulfilled', CURRENT_TIMESTAMP)
      `).bind(orderId, ownerId).run();

      const licenseKey = generateLicenseKey('dronehunter');
      const keyHash = await hashLicenseKey(licenseKey);
      const last4 = licenseKey.slice(-4);

      await ctx.d1.prepare(`
        INSERT INTO commerce_licenses (
          id, order_id, app_id, owner_user_id, license_key_hash, license_key_last4, status
        ) VALUES ('lic_owner_01', ?, 'dronehunter', ?, ?, ?, 'active')
      `).bind(orderId, ownerId, keyHash, last4).run();

      // 1. Verify via GET /api/shelf/verify?appId=dronehunter
      const getReq = new Request('http://localhost/api/shelf/verify?appId=dronehunter', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const getRes = await shelfVerifyApi.onRequestGet({ request: getReq, env: { DB: ctx.d1 } });
      expect(getRes.status).toBe(200);
      const getData = await getRes.json();
      expect(getData.success).toBe(true);
      expect(getData.verified).toBe(true);
      expect(getData.isOwned).toBe(true);
      expect(getData.license).toBeDefined();
      expect(getData.license.appId).toBe('dronehunter');
      expect(getData.license.licenseKeyLast4).toBe(last4);

      // 2. Verify via POST /api/shelf/verify with JSON body
      const postReq = new Request('http://localhost/api/shelf/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });
      const postRes = await shelfVerifyApi.onRequestPost({ request: postReq, env: { DB: ctx.d1 } });
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData.success).toBe(true);
      expect(postData.verified).toBe(true);
      expect(postData.isOwned).toBe(true);

      // 3. Verify with correct presented license key
      const keyReq = new Request(`http://localhost/api/shelf/verify?appId=dronehunter&key=${encodeURIComponent(licenseKey)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const keyRes = await shelfVerifyApi.onRequestGet({ request: keyReq, env: { DB: ctx.d1 } });
      const keyData = await keyRes.json();
      expect(keyData.success).toBe(true);
      expect(keyData.verified).toBe(true);

      // 4. Reject with forged/incorrect license key for that user
      const fakeKeyReq = new Request(`http://localhost/api/shelf/verify?appId=dronehunter&key=NSW-FORGED-0000-0000`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const fakeKeyRes = await shelfVerifyApi.onRequestGet({ request: fakeKeyReq, env: { DB: ctx.d1 } });
      const fakeKeyData = await fakeKeyRes.json();
      expect(fakeKeyData.success).toBe(true);
      expect(fakeKeyData.verified).toBe(false);
      expect(fakeKeyData.isOwned).toBe(false);
    });

    it('returns verified: false for refunded or revoked licenses', async () => {
      const ownerId = 'usr_refunded_owner';
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_refunded_owner', 'refunded_owner', 'Refunded Owner', 'user')
      `).run();
      const token = 'tok_refunded_owner';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_refunded_owner', ?)
      `).bind(await hashSessionToken(token), Date.now() + 100000).run();

      const orderId = 'cord_refunded_01';
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json, status, fulfilled_at
        ) VALUES (?, 'idem_ref_01', ?, 'dronehunter', 'usr_nate', 'v1.0.0', 1, 1500, 'usd', '[]', 'fulfilled', CURRENT_TIMESTAMP)
      `).bind(orderId, ownerId).run();

      const keyHash = await hashLicenseKey('NSW-DH-REFUNDED-KEY');
      await ctx.d1.prepare(`
        INSERT INTO commerce_licenses (
          id, order_id, app_id, owner_user_id, license_key_hash, license_key_last4, status
        ) VALUES ('lic_ref_01', ?, 'dronehunter', ?, ?, '0000', 'refunded')
      `).bind(orderId, ownerId, keyHash).run();

      const req = new Request('http://localhost/api/shelf/verify?appId=dronehunter', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const res = await shelfVerifyApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.verified).toBe(false);
      expect(data.isOwned).toBe(false);
    });

    it('rejects cross-user license key verification attempts (user A cannot claim user B license)', async () => {
      // User B owns the license
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_user_b', 'user_b', 'User B', 'user'),
               ('usr_user_a', 'user_a', 'User A', 'user')
      `).run();

      const tokenA = 'tok_user_a';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_user_a', ?)
      `).bind(await hashSessionToken(tokenA), Date.now() + 100000).run();

      const keyB = generateLicenseKey('dronehunter');
      const hashB = await hashLicenseKey(keyB);

      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json, status, fulfilled_at
        ) VALUES ('cord_b_01', 'idem_b_01', 'usr_user_b', 'dronehunter', 'usr_nate', 'v1.0.0', 1, 1500, 'usd', '[]', 'fulfilled', CURRENT_TIMESTAMP)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_licenses (
          id, order_id, app_id, owner_user_id, license_key_hash, license_key_last4, status
        ) VALUES ('lic_b_01', 'cord_b_01', 'dronehunter', 'usr_user_b', ?, '1234', 'active')
      `).bind(hashB).run();

      // User A tries to verify using User B's valid license key
      const req = new Request(`http://localhost/api/shelf/verify?appId=dronehunter&key=${encodeURIComponent(keyB)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      const res = await shelfVerifyApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.verified).toBe(false);
      expect(data.isOwned).toBe(false);
    });

    it('delegates to verify handler when /api/shelf?action=verify is queried', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_david', 'david', 'David', 'user')
      `).run();
      const token = 'tok_david';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_david', ?)
      `).bind(await hashSessionToken(token), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/shelf?action=verify&appId=wallart', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const res = await shelfApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.verified).toBe(false);
      expect(data.isOwned).toBe(false);
    });

    it('enforces hashed license storage at rest (never plaintext in commerce_licenses)', async () => {
      const licenseKey = generateLicenseKey('dronehunter');
      const hash = await hashLicenseKey(licenseKey);

      // Verify hash is 64 hex characters
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).not.toContain(licenseKey);
      expect(licenseKey).not.toBe(hash);
    });
  });
});
