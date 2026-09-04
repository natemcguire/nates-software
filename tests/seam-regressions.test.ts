import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken, sessionCookie, isSameOriginMutation } from '../functions/api/_session';
import * as dropsApi from '../functions/api/drops';

describe('Seam regression: PUBLISH cross-user repository link', () => {
  let ctx: TestD1Context;
  const env = () => ({
    DB: ctx.d1,
    GITSMITH_GATEWAY_URL: 'https://gateway.test',
    GITSMITH_GATEWAY_FETCH: async () => Response.json({ ready: true, configured: true, active: true, checks: {} }),
    GITSMITH_GATEWAY_TOKEN: 'test_gateway_token'
  });

  const session = async (userId: string, token: string) => {
    await ctx.d1.prepare(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(await hashSessionToken(token), userId, Date.now() + 3600000).run();
  };

  const user = async (id: string, username: string) => {
    await ctx.d1.prepare(
      `INSERT OR IGNORE INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(id, username, username).run();
  };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await user('usr_alice', 'alice');
    await user('usr_mallory', 'mallory');
    await session('usr_alice', 'session_alice');
    await session('usr_mallory', 'session_mallory');
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status, grantable_bps)
      VALUES ('repo_alice', 'usr_alice', 'alice-idea', 'public', 'sha1', 'refs/heads/main', 'repositories/repo_alice', 'active', 0)
    `).run();
  });

  it("refuses to link a repository the caller does not own", async () => {
    const req = new Request('http://localhost/api/drops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer session_mallory', 'Origin': 'http://localhost' },
      body: JSON.stringify({
        id: 'app_mallory',
        name: 'Mallory Land Grab',
        version: '1.0.0',
        price: '$20',
        repositoryId: 'repo_alice',
        royaltyBps: 5000
      })
    });
    await dropsApi.onRequestPost({ request: req, env: env() });

    const repoRow = await ctx.d1.prepare('SELECT owner_user_id FROM repositories WHERE id = ?')
      .bind('repo_alice').first<{ owner_user_id: string }>();
    expect(repoRow?.owner_user_id).toBe('usr_alice');

    const prod = await ctx.d1.prepare(
      'SELECT seller_user_id FROM commerce_products WHERE repository_id = ?'
    ).bind('repo_alice').first<{ seller_user_id: string }>();
    if (prod) expect(prod.seller_user_id).not.toBe('usr_mallory');
  });

  it("still lets the owner link their own repository", async () => {
    const req = new Request('http://localhost/api/drops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer session_alice', 'Origin': 'http://localhost' },
      body: JSON.stringify({
        id: 'app_alice',
        name: 'Alice Real Idea',
        version: '1.0.0',
        price: '$20',
        repositoryId: 'repo_alice',
        royaltyBps: 3000
      })
    });
    const res = await dropsApi.onRequestPost({ request: req, env: env() });
    expect(res.status).toBe(200);
    const productRow = await ctx.d1.prepare('SELECT royalty_bps FROM commerce_products WHERE repository_id = ?')
      .bind('repo_alice').first<{ royalty_bps: number }>();
    expect(productRow?.royalty_bps).toBe(3000);
  });
});

describe('Seam regression: session cookie is HOST-ONLY (never leaks to tenant subdomains)', () => {
  const cookieFor = (url: string) => sessionCookie(new Request(url), 'tok123');

  it('sets NO Domain attribute — the cookie must never be sent to tenant subdomains', () => {
    expect(cookieFor('https://nates-software.com/api/auth')).not.toContain('Domain=');
    expect(cookieFor('https://hotwire.nates-software.com/api/auth')).not.toContain('Domain=');
    expect(cookieFor('http://localhost:3000/api/auth')).not.toContain('Domain=');
  });

  it('keeps HttpOnly + SameSite=Lax + Path=/ and adds Secure on https', () => {
    const c = cookieFor('https://nates-software.com/api/auth');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain('Secure');
  });
});

describe('Seam regression: cookie mutations require strict same-origin (CSRF guard)', () => {
  const post = (url: string, origin: string) =>
    new Request(url, { method: 'POST', headers: { 'Cookie': 'nsw_session=tok', 'Origin': origin } });

  it('allows a cookie mutation from the exact same origin', () => {
    expect(isSameOriginMutation(post('https://nates-software.com/api/upvote', 'https://nates-software.com'))).toBe(true);
  });
  it('BLOCKS a cookie mutation from ANY other subdomain (incl. tenant apps)', () => {
    expect(isSameOriginMutation(post('https://nates-software.com/api/upvote', 'https://hotwire.nates-software.com'))).toBe(false);
    expect(isSameOriginMutation(post('https://nates-software.com/api/upvote', 'https://evil.nates-software.com'))).toBe(false);
    expect(isSameOriginMutation(post('https://nates-software.com/api/payments/create-intent', 'https://dronehunter.nates-software.com'))).toBe(false);
  });
  it('blocks a cookie mutation from a genuinely cross-site origin', () => {
    expect(isSameOriginMutation(post('https://nates-software.com/api/upvote', 'https://evil.example.com'))).toBe(false);
  });
  it('blocks a cookie mutation with no Origin header', () => {
    expect(isSameOriginMutation(new Request('https://nates-software.com/api/upvote', { method: 'POST', headers: { 'Cookie': 'nsw_session=tok' } }))).toBe(false);
  });
  it('still exempts bearer-token mutations (no cookie) and safe methods', () => {
    expect(isSameOriginMutation(new Request('https://nates-software.com/api/upvote', { method: 'POST', headers: { 'Authorization': 'Bearer x' } }))).toBe(true);
    expect(isSameOriginMutation(new Request('https://nates-software.com/api/drops', { method: 'GET' }))).toBe(true);
  });
});
