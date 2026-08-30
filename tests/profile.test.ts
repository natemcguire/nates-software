import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateMakerProfile,
  maskLicenseKey,
  extractLicenseKeyLast4,
  sanitizePublicProfile,
  formatCentsToUsd,
  calculateMakerEconomics,
  publishedArtifactLinks
} from '../src/lib/profileDomain';
import * as profileApi from '../functions/api/profile';
import * as shelfApi from '../functions/api/shelf';
import { hashSessionToken } from '../functions/api/_session';
import { encryptLicenseSecret, generateBase64EncryptionKey, hashLicenseKey } from '../src/lib/commerce/licenseCrypto';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

describe('PROFILE.CFG & MY SHELF Comprehensive Suite', () => {
  // ==========================================================================
  // 1. Domain Validation & Sanitization Invariants
  // ==========================================================================
  describe('1. Profile Domain Validation & Masking Invariants', () => {
    it('should accept valid maker profile input', () => {
      const valid = {
        username: 'nate',
        displayName: 'Nate McGuire',
        avatar: '⚡',
        bio: 'Founder at East Bay Projects.',
        sshKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY84pQ4eM19287KlmQ4892187 nate@macmini'
      };
      const result = validateMakerProfile(valid);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept RSA and ECDSA SSH keys', () => {
      const rsa = {
        displayName: 'Sam Altman',
        sshKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC3... sam@machine'
      };
      const ecdsa = {
        displayName: 'Josh McGuire',
        sshKey: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY... josh@machine'
      };
      expect(validateMakerProfile(rsa).valid).toBe(true);
      expect(validateMakerProfile(ecdsa).valid).toBe(true);
    });

    it('should reject invalid usernames with special characters, uppercase, or invalid length', () => {
      expect(validateMakerProfile({ username: 'NateUpper' }).valid).toBe(false);
      expect(validateMakerProfile({ username: 'nate@admin.dev' }).valid).toBe(false);
      expect(validateMakerProfile({ username: 'a' }).valid).toBe(false); // too short (< 2)
      expect(validateMakerProfile({ username: 'a'.repeat(35) }).valid).toBe(false); // too long (> 30)
    });

    it('should reject invalid display names and malformed SSH keys', () => {
      expect(validateMakerProfile({ displayName: ' ' }).valid).toBe(false);
      expect(validateMakerProfile({ displayName: 'a'.repeat(60) }).valid).toBe(false);
      expect(validateMakerProfile({ displayName: 'Valid Name', sshKey: 'not-an-ssh-key' }).valid).toBe(false);
      expect(validateMakerProfile({ displayName: 'Valid Name', sshKey: 'ssh-ed25519' }).valid).toBe(false); // single token
    });

    it('should safely mask license keys without leaking plaintext entropy', () => {
      expect(maskLicenseKey('NSW-DRONE-9812-77F2', 'dronehunter')).toBe('NSW-DRONE-••••-77F2');
      expect(maskLicenseKey('NSW-CERTMAIL-4401-90B1', 'certified-mailer')).toBe('NSW-CERTMAIL-••••-90B1');
      expect(maskLicenseKey('UNKNOWN-RAW-KEY-ABC4', 'test')).toBe('NSW-TE-••••-ABC4');
      expect(maskLicenseKey('', 'dronehunter')).toBe('NSW-DR-••••-0000');
      expect(maskLicenseKey(undefined, 'wallart')).toBe('NSW-WA-••••-0000');
    });

    it('should extract last 4 characters safely', () => {
      expect(extractLicenseKeyLast4('NSW-DRONE-9812-77F2')).toBe('77F2');
      expect(extractLicenseKeyLast4('12')).toBe('0012');
      expect(extractLicenseKeyLast4('')).toBe('0000');
    });

    it('should expose only known HTTPS maker-published artifact actions', () => {
      expect(publishedArtifactLinks({
        web: 'https://example.com/app',
        mac: 'https://cdn.example.com/app.dmg',
        export: 'https://example.com/export',
        source: 'javascript:alert(1)',
        unknown: 'https://example.com/hidden',
        win: 42
      })).toEqual([
        { kind: 'web', label: 'Open App', url: 'https://example.com/app' },
        { kind: 'mac', label: 'Download for macOS', url: 'https://cdn.example.com/app.dmg' },
        { kind: 'export', label: 'Export App Data', url: 'https://example.com/export' }
      ]);
    });

    it('should sanitize database user rows into strictly public profiles', () => {
      const dbRow = {
        id: 'usr_nate_secret_id',
        username: 'nate',
        display_name: 'Nate McGuire',
        avatar_url: '⚡',
        bio: 'Founder.',
        password_hash: 'secret_hash_value',
        salt: 'secret_salt_value',
        ssh_public_key: 'ssh-ed25519 AAAAC3... secret_key',
        stripe_account_id: 'acct_private_12345',
        is_verified_maker: 1,
        created_at: '2026-08-25T00:00:00Z'
      };

      const sanitized = sanitizePublicProfile(dbRow);
      expect(sanitized.username).toBe('nate');
      expect(sanitized.displayName).toBe('Nate McGuire');
      expect(sanitized.isVerified).toBe(true);
      expect((sanitized as any).password_hash).toBeUndefined();
      expect((sanitized as any).salt).toBeUndefined();
      expect((sanitized as any).ssh_public_key).toBeUndefined();
      expect((sanitized as any).stripe_account_id).toBeUndefined();
      expect((sanitized as any).id).toBeUndefined();
    });

    it('should format cents to USD properly', () => {
      expect(formatCentsToUsd(0)).toBe('$0.00');
      expect(formatCentsToUsd(1500)).toBe('$15.00');
      expect(formatCentsToUsd(242000)).toBe('$2,420.00');
    });

    it('should calculate maker economics accurately', () => {
      const allocations = [
        { role: 'maker', amount_cents: 1050, app_id: 'dronehunter', name: 'DroneHunter 95' },
        { role: 'ancestor', amount_cents: 300, app_id: 'dronehunter', name: 'DroneHunter 95' },
        { role: 'maker', amount_cents: 1750, app_id: 'certified-mailer', name: 'Certified Mailer' }
      ];

      const economics = calculateMakerEconomics(allocations);
      expect(economics.makerSalesCents).toBe(2800);
      expect(economics.lineageEarnedCents).toBe(300);
      expect(economics.makerBalanceCents).toBe(3100);
      expect(economics.lineageBreakdown).toHaveLength(2);
    });
  });

  // ==========================================================================
  // 2. Profile API Endpoint Contracts (/api/profile)
  // ==========================================================================
  describe('2. Profile API Endpoint Contracts (/api/profile)', () => {
    let ctx: TestD1Context;

    beforeEach(async () => {
      ctx = await createTestD1Database();
    });

    it('should return public maker profile without private keys, Stripe IDs, or shelf on unauthenticated GET', async () => {
      const req = new Request('http://localhost/api/profile?username=nate', { method: 'GET' });
      const res = await profileApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.isOwner).toBe(false);
      expect(data.user.username).toBe('nate');
      expect(data.user.displayName).toBe('Nate McGuire');
      expect(data.user.avatar).toBe('⚡');
      expect(data.user.isVerified).toBe(true);

      // Private fields MUST NOT exist in public response
      expect(data.user.sshKey).toBeUndefined();
      expect(data.user.stripeAccountId).toBeUndefined();
      expect(data.user.password_hash).toBeUndefined();
      expect(data.shelf).toBeUndefined();
      expect(data.royalties).toBeUndefined();

      // Published apps summary should be present
      expect(Array.isArray(data.publishedApps)).toBe(true);
      expect(data.publishedApps.length).toBeGreaterThanOrEqual(1);
    });

    it('should return 400 when unauthenticated GET requests /api/profile without username', async () => {
      const req = new Request('http://localhost/api/profile', { method: 'GET' });
      const res = await profileApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Username parameter is required');
    });

    it('should return 404 for non-existent maker username', async () => {
      const req = new Request('http://localhost/api/profile?username=ghost_user_999', { method: 'GET' });
      const res = await profileApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toBe('User not found');
    });

    it('fails closed when profile storage is unavailable or a canonical query fails', async () => {
      const request = new Request('http://localhost/api/profile?username=nate');
      expect((await profileApi.onRequestGet({ request, env: {} })).status).toBe(503);

      const brokenDb = { prepare: () => { throw new Error('D1 unavailable'); } };
      const failed = await profileApi.onRequestGet({ request, env: { DB: brokenDb } });
      expect(failed.status).toBe(503);
      expect((await failed.json()).success).toBe(false);
    });

    it('should return private profile with SSH keys, Stripe status, and royalties for authenticated owner', async () => {
      // Create session for usr_nate
      const sessionToken = 'tok_nate_owner';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(sessionToken), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/profile', {
        method: 'GET',
        headers: { Authorization: `Bearer ${sessionToken}` }
      });
      const res = await profileApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.isOwner).toBe(true);
      expect(data.user.username).toBe('nate');
      expect(data.user.sshKey).toContain('ssh-ed25519');
      expect(data.royalties).toBeDefined();
      expect(data.royalties.makerBalanceCents).toBeDefined();
    });

    it('should reject unauthenticated POST /api/profile with 401', async () => {
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Hacker' })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should reject authenticated POST /api/profile with invalid SSH key with 400', async () => {
      const sessionToken = 'tok_nate_edit';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(sessionToken), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          displayName: 'Nate McGuire',
          sshKey: 'invalid-malformed-key'
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('SSH key must start with valid protocol');
    });

    it('should update authenticated user profile fields in D1 successfully', async () => {
      const sessionToken = 'tok_nate_edit2';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(sessionToken), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          displayName: 'Nate M. (Founder)',
          avatar: '🚀',
          bio: 'Building indie local-first tools for the open web.',
          sshKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY84pQ4eM19287KlmQ4892187 nate@macmini'
        })
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.user).toMatchObject({
        username: 'nate',
        displayName: 'Nate M. (Founder)',
        avatar: '🚀'
      });

      const userRow = await ctx.d1.prepare('SELECT display_name, avatar_url, bio FROM users WHERE id = ?').bind('usr_nate').first();
      expect((userRow as any).display_name).toBe('Nate M. (Founder)');
      expect((userRow as any).avatar_url).toBe('🚀');
      expect((userRow as any).bio).toContain('Building indie');
    });

    it('returns 400 for malformed profile JSON without changing storage', async () => {
      const sessionToken = 'tok_nate_bad_json';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(sessionToken), Date.now() + 100000).run();
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: '{broken'
      });
      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('valid JSON');
    });
  });

  // ==========================================================================
  // 3. Shelf API & Canonical Commerce Licensing Contracts (/api/shelf)
  // ==========================================================================
  describe('3. Shelf API & Canonical Commerce Licensing Contracts (/api/shelf)', () => {
    let ctx: TestD1Context;
    const encryptionKeyBase64 = generateBase64EncryptionKey();
    const envWithKeys = {
      LICENSE_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: encryptionKeyBase64 }),
      LICENSE_ACTIVE_KEY_VERSION: 1
    };

    beforeEach(async () => {
      ctx = await createTestD1Database();
    });

    it('should reject unauthenticated GET /api/shelf with 401', async () => {
      const req = new Request('http://localhost/api/shelf', { method: 'GET' });
      const res = await shelfApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Valid authenticated session required');
    });

    it('should return empty shelf for a fresh authenticated user with no purchases', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_fresh_buyer', 'fresh_buyer', 'Fresh Buyer', 'user')
      `).run();
      const token = 'tok_fresh_buyer';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_fresh_buyer', ?)
      `).bind(await hashSessionToken(token), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/shelf', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const res = await shelfApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.shelf).toEqual([]);
    });

    it('should prevent arbitrary username lookups (shelf is strictly private to authenticated session)', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_attacker', 'attacker', 'Attacker', 'user')
      `).run();
      const token = 'tok_attacker';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_attacker', ?)
      `).bind(await hashSessionToken(token), Date.now() + 100000).run();

      // Attacker attempts to snoop usr_nate's shelf by passing ?username=nate
      const req = new Request('http://localhost/api/shelf?username=nate', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const res = await shelfApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      // Returns attacker's shelf (empty), NOT nate's shelf
      expect(data.shelf).toEqual([]);
    });

    it('should query canonical commerce licenses with safe masked key metadata and app information', async () => {
      const buyerId = 'usr_alice_buyer';
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_alice_buyer', 'alice_buyer', 'Alice Buyer', 'user')
      `).run();
      const token = 'tok_alice_buyer';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_alice_buyer', ?)
      `).bind(await hashSessionToken(token), Date.now() + 100000).run();

      // Seed a fulfilled commerce order & canonical license
      const orderId = 'cord_alice_01';
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json, status, fulfilled_at
        ) VALUES (?, 'idem_alice_01', ?, 'dronehunter', 'usr_nate', 'v1.0.0', 1, 1500, 'usd', '[]', 'fulfilled', CURRENT_TIMESTAMP)
      `).bind(orderId, buyerId).run();

      const licenseId = 'lic_alice_01';
      const licenseRawKey = 'NSW-DRONE-4491-88A2';
      const keyHash = await hashLicenseKey(licenseRawKey);
      const encryptedSecret = await encryptLicenseSecret(licenseRawKey, envWithKeys);

      await ctx.d1.prepare(`
        INSERT INTO commerce_licenses (id, order_id, app_id, owner_user_id, license_key_hash, license_key_last4, status)
        VALUES (?, ?, 'dronehunter', ?, ?, '88A2', 'active')
      `).bind(licenseId, orderId, buyerId, keyHash).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_license_secrets (license_id, ciphertext_base64, iv_base64, algorithm, key_version)
        VALUES (?, ?, ?, 'AES-256-GCM', ?)
      `).bind(licenseId, encryptedSecret.ciphertextBase64, encryptedSecret.ivBase64, encryptedSecret.keyVersion).run();
      await ctx.d1.prepare('UPDATE app_listings SET binaries = ? WHERE id = ?').bind(JSON.stringify({
        web: 'https://drone.example.com',
        mac: 'https://cdn.example.com/drone.dmg',
        source: 'javascript:alert(1)',
        privateInstaller: 'https://example.com/not-allowlisted'
      }), 'dronehunter').run();

      // Query shelf
      const req = new Request('http://localhost/api/shelf', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const res = await shelfApi.onRequestGet({ request: req, env: { DB: ctx.d1, ...envWithKeys } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.shelf).toHaveLength(1);

      const item = data.shelf[0];
      expect(item.appId).toBe('dronehunter');
      expect(item.name).toBe('DroneHunter 95');
      expect(item.licenseKeyLast4).toBe('88A2');
      expect(item.maskedKey).toBe('NSW-DR-••••-88A2');
      expect(item.source).toBe('commerce');
      expect(item.status).toBe('active');
      expect(item.binaries).toEqual({
        web: 'https://drone.example.com/',
        mac: 'https://cdn.example.com/drone.dmg'
      });
      // Plaintext key is NOT leaked in default shelf response
      expect(item.rawLicenseKey).toBeUndefined();
      expect(item.licenseKey).toBeUndefined();
    });

    it('should reject direct license minting on POST /api/shelf with 405 Method Not Allowed', async () => {
      const req = new Request('http://localhost/api/shelf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'dronehunter' })
      });
      const res = await shelfApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });

      expect(res.status).toBe(405);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Direct license minting is disabled');
    });
  });
});
