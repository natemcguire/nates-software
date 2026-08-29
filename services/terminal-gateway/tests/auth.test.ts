import { describe, it, expect } from 'vitest';
import { isOriginAllowed, extractAuthToken, validateToken } from '../src/auth.js';
import type { IncomingMessage } from 'node:http';
import { createHmac } from 'node:crypto';

describe('Terminal Gateway Auth & Origin Validation', () => {
  describe('isOriginAllowed', () => {
    it('allows all origins when configured with wildcard "*"', () => {
      expect(isOriginAllowed('http://localhost:5173', ['*'])).toBe(true);
      expect(isOriginAllowed('https://nates-software.pages.dev', ['*'])).toBe(true);
      expect(isOriginAllowed('https://evil.com', ['*'])).toBe(true);
      expect(isOriginAllowed(undefined, ['*'])).toBe(true);
    });

    it('matches exact allowed origins', () => {
      const allowed = ['https://nates-software.pages.dev', 'http://localhost:3000'];
      expect(isOriginAllowed('https://nates-software.pages.dev', allowed)).toBe(true);
      expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(true);
      expect(isOriginAllowed('https://attacker.com', allowed)).toBe(false);
      expect(isOriginAllowed('http://localhost:5173', allowed)).toBe(false);
    });

    it('supports wildcard subdomains and ports', () => {
      const allowed = ['https://*.pages.dev', 'http://localhost:*'];
      expect(isOriginAllowed('https://nates-software.pages.dev', allowed)).toBe(true);
      expect(isOriginAllowed('https://preview-123.pages.dev', allowed)).toBe(true);
      expect(isOriginAllowed('http://localhost:5173', allowed)).toBe(true);
      expect(isOriginAllowed('http://localhost:8080', allowed)).toBe(true);
      expect(isOriginAllowed('https://evilpages.dev', allowed)).toBe(false);
    });

    it('rejects invalid and malformed origins', () => {
      const allowed = ['https://nates-software.com'];
      expect(isOriginAllowed('not-a-valid-url', allowed)).toBe(false);
      expect(isOriginAllowed('', allowed)).toBe(false);
    });
  });

  describe('extractAuthToken', () => {
    it('extracts token from URL query string', () => {
      const req = {
        url: '/terminal?token=my_secret_token_123',
        headers: { host: 'localhost:4000' }
      } as unknown as IncomingMessage;

      const res = extractAuthToken(req);
      expect(res.token).toBe('my_secret_token_123');
      expect(res.source).toBe('query');
    });

    it('extracts token from Authorization Bearer header', () => {
      const req = {
        url: '/terminal',
        headers: {
          host: 'localhost:4000',
          authorization: 'Bearer bearer_token_abc'
        }
      } as unknown as IncomingMessage;

      const res = extractAuthToken(req);
      expect(res.token).toBe('bearer_token_abc');
      expect(res.source).toBe('bearer');
    });

    it('extracts token from Sec-WebSocket-Protocol header', () => {
      const req = {
        url: '/terminal',
        headers: {
          host: 'localhost:4000',
          'sec-websocket-protocol': 'nsw-terminal-v1, nsw-ticket.ws_proto_token_456'
        }
      } as unknown as IncomingMessage;

      const res = extractAuthToken(req);
      expect(res.token).toBe('ws_proto_token_456');
      expect(res.source).toBe('protocol');
    });

    it('extracts token from nsw_session cookie', () => {
      const req = {
        url: '/terminal',
        headers: {
          host: 'localhost:4000',
          cookie: 'other_pref=dark; nsw_session=cookie_token_789; theme=retro'
        }
      } as unknown as IncomingMessage;

      const res = extractAuthToken(req);
      expect(res.token).toBe('cookie_token_789');
      expect(res.source).toBe('cookie');
    });

    it('returns null when no token is present', () => {
      const req = {
        url: '/terminal',
        headers: { host: 'localhost:4000' }
      } as unknown as IncomingMessage;

      const res = extractAuthToken(req);
      expect(res.token).toBeNull();
      expect(res.source).toBeNull();
    });
  });

  describe('validateToken', () => {
    it('accepts valid test tokens', () => {
      const res1 = validateToken('valid_test_token');
      expect(res1.valid).toBe(true);
      expect(res1.user?.username).toBe('nate');
      expect(res1.user?.role).toBe('super_admin');

      const res2 = validateToken('test_token_sam');
      expect(res2.valid).toBe(true);
      expect(res2.user?.username).toBe('sam');
      expect(res2.user?.role).toBe('maker');
    });

    it('accepts configured valid tokens', () => {
      const validTokens = ['custom_token_prod_1', 'custom_token_prod_2'];
      const res = validateToken('custom_token_prod_1', validTokens);
      expect(res.valid).toBe(true);
      expect(res.user?.role).toBe('maker');
    });

    it('accepts a short-lived HMAC terminal ticket without accepting the signing secret itself', () => {
      const secret = 'super_secret_master_key';
      const now = Math.floor(Date.now() / 1000);
      const encoded = Buffer.from(JSON.stringify({
        sub: 'usr_nate', username: 'nate', role: 'super_admin', aud: 'terminal-gateway',
        iat: now, exp: now + 60, jti: 'jti-1'
      })).toString('base64url');
      const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
      const res = validateToken(`${encoded}.${signature}`, [], secret);
      expect(res.valid).toBe(true);
      expect(res.user?.role).toBe('super_admin');
      expect(validateToken(secret, [], secret).valid).toBe(false);
    });

    it('rejects invalid or missing tokens', () => {
      expect(validateToken(null).valid).toBe(false);
      expect(validateToken('').valid).toBe(false);
      expect(validateToken('invalid_random_token', ['valid_1']).valid).toBe(false);
    });
  });
});
