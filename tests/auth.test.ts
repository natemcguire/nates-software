import { describe, it, expect } from 'vitest';
import * as authApi from '../functions/api/auth';

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

    it('should successfully register a valid new user with session token and Set-Cookie header', async () => {
      const mockDb = {
        prepare: (_query: string) => ({
          bind: (..._args: any[]) => ({
            first: async () => null, // no collision
            run: async () => ({ success: true })
          })
        })
      };

      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'josh',
          password: 'superSecretPassword2026',
          displayName: 'Josh McGuire',
          avatar: '⛵',
          bio: 'Co-founder at East Bay Projects'
        })
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: mockDb } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.authenticated).toBe(true);
      expect(data.user.username).toBe('josh');
      expect(data.user.displayName).toBe('Josh McGuire');
      expect(data.user.avatar).toBe('⛵');
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

    it('should verify super-admin @nate credentials and return super_admin role', async () => {
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
});
