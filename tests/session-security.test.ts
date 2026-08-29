import { describe, expect, it } from 'vitest';
import {
  extractSessionToken,
  hashSessionToken,
  isSameOriginMutation,
  sessionCookie
} from '../functions/api/_session';

describe('session security boundary', () => {
  it('stores a deterministic digest rather than the bearer secret', async () => {
    const token = 'raw-secret-token';
    const digest = await hashSessionToken(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
    expect(await hashSessionToken(token)).toBe(digest);
  });

  it('prefers bearer auth and identifies cookie auth', () => {
    const bearer = new Request('https://nates-software.pages.dev/api/profile', {
      headers: { Authorization: 'Bearer bearer-token', Cookie: 'nsw_session=cookie-token' }
    });
    expect(extractSessionToken(bearer)).toEqual({ token: 'bearer-token', source: 'bearer' });

    const cookie = new Request('https://nates-software.pages.dev/api/profile', {
      headers: { Cookie: 'theme=teal; nsw_session=cookie-token' }
    });
    expect(extractSessionToken(cookie)).toEqual({ token: 'cookie-token', source: 'cookie' });
  });

  it('marks production cookies Secure and rejects cross-origin cookie mutations', () => {
    const request = new Request('https://nates-software.pages.dev/api/profile', {
      method: 'POST',
      headers: {
        Cookie: 'nsw_session=cookie-token',
        Origin: 'https://evil.example'
      }
    });
    expect(sessionCookie(request, 'cookie-token')).toContain('; Secure;');
    expect(isSameOriginMutation(request)).toBe(false);

    const sameOrigin = new Request('https://nates-software.pages.dev/api/profile', {
      method: 'POST',
      headers: {
        Cookie: 'nsw_session=cookie-token',
        Origin: 'https://nates-software.pages.dev'
      }
    });
    expect(isSameOriginMutation(sameOrigin)).toBe(true);
  });
});
