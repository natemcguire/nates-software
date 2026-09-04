import { describe, it, expect, beforeEach } from 'vitest';
import * as authApi from '../functions/api/auth';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';

describe('Real Production Authentication & Security API Tests (/api/auth)', () => {

  describe('1. Web Crypto Registration & PBKDF2 Hashing (/api/auth?action=register)', () => {
    it('should reject registration when username or password are missing', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '' })
      });

      const res = await authApi.onRequestPost({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Username and password are required');
    });

    it('should reject registration with invalid username characters or length', async () => {
      const mockEnv = {};
      const reqShort = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ab', password: 'validPassword123' })
      });
      const resShort = await authApi.onRequestPost({ request: reqShort, env: mockEnv });
      const dataShort = await resShort.json();
      expect(dataShort.success).toBe(false);
      expect(dataShort.error).toContain('3-20 characters');

      const reqInvalidChars = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'user name!@#', password: 'validPassword123' })
      });
      const resInvalidChars = await authApi.onRequestPost({ request: reqInvalidChars, env: mockEnv });
      const dataInvalidChars = await resInvalidChars.json();
      expect(dataInvalidChars.success).toBe(false);
      expect(dataInvalidChars.error).toContain('3-20 characters');
    });

    it('rejects an oversized password before any hashing (NSW-143)', async () => {
      const req = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'someuser', password: 'x'.repeat(5000) })
      });
      const res = await authApi.onRequestPost({ request: req, env: { DB: { prepare: () => { throw new Error('DB must not be reached'); } } } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('rejects a non-string password with 400, not a 500 crash (NSW-143)', async () => {
      const req = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'someuser', password: { evil: true } })
      });
      const res = await authApi.onRequestPost({ request: req, env: { DB: { prepare: () => { throw new Error('DB must not be reached'); } } } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should reject registration with reserved usernames (admin, root, sam)', async () => {
      const mockEnv = {};
      for (const reserved of ['admin', 'root', 'superadmin', 'sam']) {
        const req = new Request('http://localhost/api/auth?action=register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: reserved, password: 'securePassword123' })
        });
        const res = await authApi.onRequestPost({ request: req, env: mockEnv });
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error).toContain('Username is reserved');
      }
    });

    it('should reject registration when password is shorter than 8 characters', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'josh', password: '1234567' })
      });
      const res = await authApi.onRequestPost({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('at least 8 characters');
    });

    it('should successfully register a valid new user with role "user" and NOT grant super_admin by username', async () => {
      const mockDb = {
        prepare: (_query: string) => ({
          bind: (..._args: any[]) => ({
            first: async () => null,
            run: async () => ({ success: true })
          })
        })
      };

      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'nate_dev',
          password: 'superSecretPassword2026',
          displayName: 'Nate Developer',
          avatar: '⛵',
          bio: 'Builder'
        })
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: mockDb } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.authenticated).toBe(true);
      expect(data.user.username).toBe('nate_dev');
      expect(data.user.displayName).toBe('Nate Developer');
      expect(data.user.role).toBe('user');
      expect(data.user.isSuperAdmin).toBe(false);
      expect(data.token).toBeDefined();

      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toContain('nsw_session=');
      expect(setCookie).toContain('HttpOnly');
    });
  });

  describe('2. Login Credential Verification (/api/auth?action=login)', () => {
    it('should reject login when username or password are missing', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', password: '' })
      });

      const res = await authApi.onRequestPost({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Username and password required');
    });

    it('should reject login for non-existent users', async () => {
      const mockDb = {
        prepare: () => ({
          bind: () => ({
            first: async () => null
          })
        })
      };

      const req = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nonexistent', password: 'password123' })
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: mockDb } });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid username or password');
    });

    it('should reject login for accounts still using placeholder seeded hashes with 403 and helpful activation message', async () => {
      const mockDb = {
        prepare: (_query: string) => ({
          bind: (..._args: any[]) => ({
            first: async () => ({
              id: 'usr_nate',
              username: 'nate',
              display_name: 'Nate McGuire',
              avatar_url: '⚡',
              bio: 'Founder at East Bay Projects',
              password_hash: 'seeded_super_admin',
              salt: 'salt_nate',
              role: 'super_admin'
            }),
            run: async () => ({ success: true })
          })
        })
      };

      const req = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', password: 'adminPassword123' })
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: mockDb } });
      expect(res.status).toBe(403);
      const data = await res.json();

      expect(data.success).toBe(false);
      expect(data.error).toContain('Account not yet activated');
    });

    it('should verify real PBKDF2 credentials for activated super-admin @nate and return super_admin role', async () => {
      const salt = authApi.generateSalt();
      const realPassword = 'RealSecurePassword2026!';
      const realHash = await authApi.hashPassword(realPassword, salt);

      const mockDb = {
        prepare: (_query: string) => ({
          bind: (..._args: any[]) => ({
            first: async () => ({
              id: 'usr_nate',
              username: 'nate',
              display_name: 'Nate McGuire',
              avatar_url: '⚡',
              bio: 'Founder at East Bay Projects',
              password_hash: realHash,
              salt,
              role: 'super_admin'
            }),
            run: async () => ({ success: true })
          })
        })
      };

      const req = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', password: realPassword })
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: mockDb } });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.authenticated).toBe(true);
      expect(data.user.username).toBe('nate');
      expect(data.user.role).toBe('super_admin');
      expect(data.user.isSuperAdmin).toBe(true);
      expect(res.headers.get('Set-Cookie')).toContain('nsw_session=');
    });
  });

  describe('3. Session Resolution & Logout (/api/auth?action=me, logout)', () => {
    it('should return authenticated user when valid Bearer token is supplied', async () => {
      const mockDb = {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              id: 'usr_josh',
              username: 'josh',
              displayName: 'Josh McGuire',
              avatar: '⛵',
              bio: 'Builder',
              role: 'user'
            })
          })
        })
      };

      const req = new Request('http://localhost/api/auth?action=me', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer 0123456789abcdef0123456789abcdef' }
      });

      const res = await authApi.onRequestGet({ request: req, env: { DB: mockDb } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.authenticated).toBe(true);
      expect(data.user.username).toBe('josh');
    });

    it('should clear session cookie on logout', async () => {
      const req = new Request('http://localhost/api/auth?action=logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer test-token' }
      });

      const res = await authApi.onRequestPost({ request: req, env: {} });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.message).toBe('Logged out');
      expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    });
  });

  describe('4. Secure Owner Credential-Claim (/api/auth?action=claim-credentials)', () => {
    let ctx: TestD1Context;
    const BOOTSTRAP_TOKEN = 'secret-bootstrap-token-2026-xyz';

    beforeEach(async () => {
      ctx = await createTestD1Database({ foreignKeys: true });
    });

    it('should reject claim when username or new password are missing', async () => {
      const req = new Request('http://localhost/api/auth?action=claim-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', token: BOOTSTRAP_TOKEN })
      });

      const res = await authApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, OWNER_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN }
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Username and new password are required');
    });

    it('should reject claim when password is shorter than 8 characters', async () => {
      const req = new Request('http://localhost/api/auth?action=claim-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', newPassword: 'short', token: BOOTSTRAP_TOKEN })
      });

      const res = await authApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, OWNER_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN }
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('at least 8 characters');
    });

    it('should reject claim with 403 when OWNER_BOOTSTRAP_TOKEN is not configured on server', async () => {
      const req = new Request('http://localhost/api/auth?action=claim-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', newPassword: 'RealSecurePassword2026!', token: BOOTSTRAP_TOKEN })
      });

      const res = await authApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1 }
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('not configured on server');
    });

    it('should reject claim with 403 when bootstrap token is missing in request', async () => {
      const req = new Request('http://localhost/api/auth?action=claim-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', newPassword: 'RealSecurePassword2026!' })
      });

      const res = await authApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, OWNER_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN }
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Bootstrap token is required');
    });

    it('should reject claim with 403 when bootstrap token is incorrect (constant-time verification)', async () => {
      const req = new Request('http://localhost/api/auth?action=claim-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', newPassword: 'RealSecurePassword2026!', token: 'wrong-token-value' })
      });

      const res = await authApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, OWNER_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN }
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid bootstrap token');
    });

    it('should reject claim with 404 for non-existent account', async () => {
      const req = new Request('http://localhost/api/auth?action=claim-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nonexistent_user', newPassword: 'RealSecurePassword2026!', token: BOOTSTRAP_TOKEN })
      });

      const res = await authApi.onRequestPost({
        request: req,
        env: { DB: ctx.d1, OWNER_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN }
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('User not found');
    });

    it('should successfully claim credentials for seeded nate account, clear fake ssh key, hash with PBKDF2, and allow normal login', async () => {

      const initialUser: any = await ctx.d1.prepare('SELECT * FROM users WHERE username = ?').bind('nate').first();
      expect(initialUser).not.toBeNull();
      expect(initialUser.password_hash).toBe('seeded_super_admin');
      expect(initialUser.ssh_public_key).toContain('ssh-ed25519');
      expect(initialUser.role).toBe('super_admin');

      const claimPassword = 'NatesOwnerRealPassword2026!';
      const claimReq = new Request('http://localhost/api/auth?action=claim-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'nate',
          newPassword: claimPassword,
          token: BOOTSTRAP_TOKEN
        })
      });

      const claimRes = await authApi.onRequestPost({
        request: claimReq,
        env: { DB: ctx.d1, OWNER_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN }
      });

      expect(claimRes.status).toBe(200);
      const claimData = await claimRes.json();
      expect(claimData.success).toBe(true);
      expect(claimData.authenticated).toBe(true);
      expect(claimData.user.username).toBe('nate');
      expect(claimData.user.role).toBe('super_admin');
      expect(claimData.user.isSuperAdmin).toBe(true);
      expect(claimData.token).toBeTruthy();
      expect(claimRes.headers.get('Set-Cookie')).toContain('nsw_session=');

      const updatedUser: any = await ctx.d1.prepare('SELECT * FROM users WHERE username = ?').bind('nate').first();
      expect(updatedUser.password_hash).not.toBe('seeded_super_admin');
      expect(updatedUser.password_hash.length).toBe(64);
      expect(updatedUser.salt).not.toBe('salt_nate');
      expect(updatedUser.ssh_public_key).toBeNull();

      const expectedHash = await authApi.hashPassword(claimPassword, updatedUser.salt);
      expect(updatedUser.password_hash).toBe(expectedHash);

      const sessionInDb: any = await ctx.d1.prepare('SELECT * FROM user_sessions WHERE user_id = ?').bind(updatedUser.id).first();
      expect(sessionInDb).not.toBeNull();
      expect(sessionInDb.token_hash).toBe(await hashSessionToken(claimData.token));

      const secondClaimReq = new Request('http://localhost/api/auth?action=claim-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'nate',
          newPassword: 'AnotherPassword2026!',
          token: BOOTSTRAP_TOKEN
        })
      });

      const secondClaimRes = await authApi.onRequestPost({
        request: secondClaimReq,
        env: { DB: ctx.d1, OWNER_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN }
      });
      expect(secondClaimRes.status).toBe(400);
      const secondClaimData = await secondClaimRes.json();
      expect(secondClaimData.success).toBe(false);
      expect(secondClaimData.error).toContain('already been claimed');

      const loginReq = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', password: claimPassword })
      });

      const loginRes = await authApi.onRequestPost({
        request: loginReq,
        env: { DB: ctx.d1 }
      });
      expect(loginRes.status).toBe(200);
      const loginData = await loginRes.json();
      expect(loginData.success).toBe(true);
      expect(loginData.authenticated).toBe(true);
      expect(loginData.user.username).toBe('nate');
      expect(loginData.user.role).toBe('super_admin');
      expect(loginData.user.isSuperAdmin).toBe(true);

      const badLoginReq = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', password: 'WrongPassword123' })
      });

      const badLoginRes = await authApi.onRequestPost({
        request: badLoginReq,
        env: { DB: ctx.d1 }
      });
      expect(badLoginRes.status).toBe(401);
    });

    it('should support action=set-initial-password alias and X-Bootstrap-Token header', async () => {
      const claimPassword = 'NatesOwnerRealPassword2026!';
      const claimReq = new Request('http://localhost/api/auth?action=set-initial-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bootstrap-Token': BOOTSTRAP_TOKEN
        },
        body: JSON.stringify({
          username: 'nate',
          password: claimPassword
        })
      });

      const claimRes = await authApi.onRequestPost({
        request: claimReq,
        env: { DB: ctx.d1, OWNER_BOOTSTRAP_TOKEN: BOOTSTRAP_TOKEN }
      });

      expect(claimRes.status).toBe(200);
      const claimData = await claimRes.json();
      expect(claimData.success).toBe(true);
      expect(claimData.user.username).toBe('nate');
    });
  });

  describe('5. Personal Access CLI Token Minting (/api/auth?action=create-cli-token)', () => {
    let ctx: TestD1Context;

    beforeEach(async () => {
      ctx = await createTestD1Database({ foreignKeys: true });
    });

    it('should reject unauthenticated create-cli-token requests with 401', async () => {
      const req = new Request('http://localhost/api/auth?action=create-cli-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Unauthorized');
    });

    it('should reject cookie-authenticated create-cli-token requests if cross-origin (CSRF protection)', async () => {

      const rawToken = authApi.generateSessionToken();
      const tokenHash = await hashSessionToken(rawToken);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(tokenHash, Date.now() + 3600 * 1000).run();

      const req = new Request('http://localhost/api/auth?action=create-cli-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `nsw_session=${rawToken}`,
          'Origin': 'https://evil-attacker.com'
        }
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Forbidden');
    });

    it('should mint a 90-day CLI token for authenticated user and validate round-trip with GET /api/auth', async () => {

      const rawWebToken = authApi.generateSessionToken();
      const webTokenHash = await hashSessionToken(rawWebToken);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(webTokenHash, Date.now() + 3600 * 1000).run();

      const mintReq = new Request('http://localhost/api/auth?action=create-cli-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `nsw_session=${rawWebToken}`,
          'Origin': 'http://localhost'
        }
      });

      const mintRes = await authApi.onRequestPost({ request: mintReq, env: { DB: ctx.d1 } });
      expect(mintRes.status).toBe(200);
      const mintData = await mintRes.json();

      expect(mintData.success).toBe(true);
      expect(mintData.token).toBeDefined();
      expect(typeof mintData.token).toBe('string');
      expect(mintData.token.length).toBe(64);
      expect(mintData.user.username).toBe('nate');
      expect(mintData.user.id).toBe('usr_nate');

      const expectedMinExpiry = Date.now() + 89 * 24 * 3600 * 1000;
      expect(mintData.expiresAt).toBeGreaterThan(expectedMinExpiry);

      const cliTokenHash = await hashSessionToken(mintData.token);
      const storedSession: any = await ctx.d1.prepare(`
        SELECT * FROM user_sessions WHERE token_hash = ?
      `).bind(cliTokenHash).first();
      expect(storedSession).not.toBeNull();
      expect(storedSession.user_id).toBe('usr_nate');

      const validateReq = new Request('http://localhost/api/auth', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${mintData.token}`
        }
      });

      const validateRes = await authApi.onRequestGet({ request: validateReq, env: { DB: ctx.d1 } });
      expect(validateRes.status).toBe(200);
      const validateData = await validateRes.json();

      expect(validateData.success).toBe(true);
      expect(validateData.authenticated).toBe(true);
      expect(validateData.expiresAt).toBe(storedSession.expires_at);
      expect(typeof validateData.expiresAt).toBe('number');
      expect(validateData.user.username).toBe('nate');
      expect(validateData.user.id).toBe('usr_nate');
    });

    it('should revoke minted CLI token when logout is called with that token', async () => {

      const rawWebToken = authApi.generateSessionToken();
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(rawWebToken), Date.now() + 3600 * 1000).run();

      const mintReq = new Request('http://localhost/api/auth?action=create-cli-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${rawWebToken}`
        }
      });
      const mintRes = await authApi.onRequestPost({ request: mintReq, env: { DB: ctx.d1 } });
      const mintData = await mintRes.json();
      const cliToken = mintData.token;

      const logoutReq = new Request('http://localhost/api/auth?action=logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cliToken}` }
      });
      const logoutRes = await authApi.onRequestPost({ request: logoutReq, env: { DB: ctx.d1 } });
      expect((await logoutRes.json()).success).toBe(true);

      const validateReq = new Request('http://localhost/api/auth', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cliToken}` }
      });
      const validateData = await (await authApi.onRequestGet({ request: validateReq, env: { DB: ctx.d1 } })).json();
      expect(validateData.authenticated).toBe(false);
      expect(validateData.user).toBeNull();
    });
  });
});

