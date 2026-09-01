// Verifies Fix 2 (INBOX marketplace) — discoverable contribution marketplace:
//   - GET /api/marketplace/opportunities (functions/api/marketplace/opportunities.ts):
//     public read of repositories with grantable_bps room, computing remaining
//     correctly from SUM(active+pending contributor_shares.basis_points).
//   - GET/POST /api/marketplace/grants (functions/api/marketplace/grants.ts):
//     owner-scoped grant history + revoke, enforcing that only 'pending'
//     grants are revocable ('active' is immutable per 0029/0030 triggers).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as opportunitiesApi from '../functions/api/marketplace/opportunities';
import * as marketplaceGrantsApi from '../functions/api/marketplace/grants';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';

describe('Marketplace: opportunities discovery + owner grant-history/revocation', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const env = () => ({ DB: ctx.d1 });

  async function createSession(userId: string, token: string) {
    const tokenHash = await hashSessionToken(token);
    const expiresAt = Date.now() + 86400000;
    await ctx.d1.prepare(`
      INSERT OR REPLACE INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(tokenHash, userId, expiresAt).run();
    return token;
  }

  async function seedUsers() {
    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name)
      VALUES
        ('usr_owner', 'ownerdev', 'Owner Dev'),
        ('usr_other_owner', 'otherowner', 'Other Owner'),
        ('usr_contrib_a', 'contriba', 'Contributor A'),
        ('usr_contrib_b', 'contribb', 'Contributor B')
    `).run();
  }

  async function seedApp(appId: string, ownerId: string) {
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES (?, ?, 'Tag', 'Desc', ?, 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).bind(appId, appId, ownerId).run();
  }

  async function seedRepo(repoId: string, appId: string, ownerId: string, grantableBps: number) {
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status, grantable_bps)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).bind(repoId, appId, ownerId, appId, `key_${repoId}`, grantableBps).run();
  }

  // ==========================================================================
  // GET /api/marketplace/opportunities
  // ==========================================================================
  describe('GET /api/marketplace/opportunities', () => {
    it('returns an honest empty list when no repository has a grantable pool', async () => {
      const req = new Request('http://localhost/api/marketplace/opportunities', { method: 'GET' });
      const res = await opportunitiesApi.onRequestGet({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.opportunities).toEqual([]);
    });

    it('computes remaining bps correctly as grantable_bps minus SUM(active+pending), excluding revoked', async () => {
      await seedUsers();
      await seedApp('app-opp-1', 'usr_owner');
      await seedRepo('repo-opp-1', 'app-opp-1', 'usr_owner', 5000);

      // Active grant: 1500 bps
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at)
        VALUES ('cs_opp_active', 'repo-opp-1', 'usr_contrib_a', 'usr_owner', 1500, 'active', datetime('now'))
      `).run();
      // Pending grant: 1000 bps
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_opp_pending', 'repo-opp-1', 'usr_contrib_b', 'usr_owner', 1000, 'pending')
      `).run();

      const req = new Request('http://localhost/api/marketplace/opportunities', { method: 'GET' });
      const res = await opportunitiesApi.onRequestGet({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.opportunities).toHaveLength(1);
      const opp = data.opportunities[0];
      expect(opp.repositoryId).toBe('repo-opp-1');
      expect(opp.grantableBps).toBe(5000);
      expect(opp.grantedBps).toBe(2500); // 1500 active + 1000 pending
      expect(opp.remainingBps).toBe(2500); // 5000 - 2500
      // No PII: only public repo/app identity + username
      expect(opp.ownerUsername).toBe('ownerdev');
      expect(opp).not.toHaveProperty('email');
      expect(opp).not.toHaveProperty('stripeAccountId');
    });

    it('excludes a repository whose entire grantable pool has already been granted (remaining = 0)', async () => {
      await seedUsers();
      await seedApp('app-opp-full', 'usr_owner');
      await seedRepo('repo-opp-full', 'app-opp-full', 'usr_owner', 2000);

      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at)
        VALUES ('cs_full', 'repo-opp-full', 'usr_contrib_a', 'usr_owner', 2000, 'active', datetime('now'))
      `).run();

      const req = new Request('http://localhost/api/marketplace/opportunities', { method: 'GET' });
      const res = await opportunitiesApi.onRequestGet({ request: req, env: env() });
      const data = await res.json();

      expect(data.opportunities.find((o: any) => o.repositoryId === 'repo-opp-full')).toBeUndefined();
    });

    it('excludes repositories with grantable_bps = 0', async () => {
      await seedUsers();
      await seedApp('app-opp-zero', 'usr_owner');
      await seedRepo('repo-opp-zero', 'app-opp-zero', 'usr_owner', 0);

      const req = new Request('http://localhost/api/marketplace/opportunities', { method: 'GET' });
      const res = await opportunitiesApi.onRequestGet({ request: req, env: env() });
      const data = await res.json();

      expect(data.opportunities.find((o: any) => o.repositoryId === 'repo-opp-zero')).toBeUndefined();
    });

    it('does not require authentication (public discovery surface)', async () => {
      await seedUsers();
      await seedApp('app-opp-public', 'usr_owner');
      await seedRepo('repo-opp-public', 'app-opp-public', 'usr_owner', 3000);

      const req = new Request('http://localhost/api/marketplace/opportunities', { method: 'GET' });
      const res = await opportunitiesApi.onRequestGet({ request: req, env: env() });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.opportunities.length).toBeGreaterThan(0);
    });

    it('rejects POST with 405', async () => {
      const res = await opportunitiesApi.onRequestPost();
      expect(res.status).toBe(405);
    });
  });

  // ==========================================================================
  // GET /api/marketplace/grants — owner-scoped grant history
  // ==========================================================================
  describe('GET /api/marketplace/grants — owner scoping', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const req = new Request('http://localhost/api/marketplace/grants', { method: 'GET' });
      const res = await marketplaceGrantsApi.onRequestGet({ request: req, env: env() });
      expect(res.status).toBe(401);
    });

    it('returns an honest empty list for an owner with no grants issued', async () => {
      await seedUsers();
      await createSession('usr_owner', 'tok_owner_empty');
      const req = new Request('http://localhost/api/marketplace/grants', {
        method: 'GET',
        headers: { Authorization: 'Bearer tok_owner_empty' }
      });
      const res = await marketplaceGrantsApi.onRequestGet({ request: req, env: env() });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.grants).toEqual([]);
    });

    it('only returns grants on repositories the CALLER owns, never another owner\'s grants', async () => {
      await seedUsers();
      await seedApp('app-owner-a', 'usr_owner');
      await seedRepo('repo-owner-a', 'app-owner-a', 'usr_owner', 5000);
      await seedApp('app-owner-b', 'usr_other_owner');
      await seedRepo('repo-owner-b', 'app-owner-b', 'usr_other_owner', 5000);

      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_owner_a', 'repo-owner-a', 'usr_contrib_a', 'usr_owner', 1000, 'pending')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_owner_b', 'repo-owner-b', 'usr_contrib_b', 'usr_other_owner', 2000, 'pending')
      `).run();

      await createSession('usr_owner', 'tok_owner_scoped');
      const req = new Request('http://localhost/api/marketplace/grants', {
        method: 'GET',
        headers: { Authorization: 'Bearer tok_owner_scoped' }
      });
      const res = await marketplaceGrantsApi.onRequestGet({ request: req, env: env() });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.grants).toHaveLength(1);
      expect(data.grants[0].id).toBe('cs_owner_a');
      expect(data.grants.find((g: any) => g.id === 'cs_owner_b')).toBeUndefined();
    });

    it('marks pending grants as revocable and active grants as not revocable', async () => {
      await seedUsers();
      await seedApp('app-rev-flags', 'usr_owner');
      await seedRepo('repo-rev-flags', 'app-rev-flags', 'usr_owner', 5000);

      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_flag_pending', 'repo-rev-flags', 'usr_contrib_a', 'usr_owner', 1000, 'pending')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at)
        VALUES ('cs_flag_active', 'repo-rev-flags', 'usr_contrib_b', 'usr_owner', 1500, 'active', datetime('now'))
      `).run();

      await createSession('usr_owner', 'tok_owner_flags');
      const req = new Request('http://localhost/api/marketplace/grants', {
        method: 'GET',
        headers: { Authorization: 'Bearer tok_owner_flags' }
      });
      const res = await marketplaceGrantsApi.onRequestGet({ request: req, env: env() });
      const data = await res.json();

      const pending = data.grants.find((g: any) => g.id === 'cs_flag_pending');
      const active = data.grants.find((g: any) => g.id === 'cs_flag_active');
      expect(pending.revocable).toBe(true);
      expect(active.revocable).toBe(false);
    });
  });

  // ==========================================================================
  // POST /api/marketplace/grants { action: 'revoke' } — pending-only revocation
  // ==========================================================================
  describe('POST /api/marketplace/grants — revoke pending only, active is immutable', () => {
    async function req(token: string, body: any) {
      return new Request('http://localhost/api/marketplace/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
    }

    it('returns 401 for unauthenticated revoke attempts', async () => {
      const request = new Request('http://localhost/api/marketplace/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', grantId: 'cs_whatever' })
      });
      const res = await marketplaceGrantsApi.onRequestPost({ request, env: env() });
      expect(res.status).toBe(401);
    });

    it('revokes a PENDING grant successfully and persists the status/timestamp', async () => {
      await seedUsers();
      await seedApp('app-revoke-ok', 'usr_owner');
      await seedRepo('repo-revoke-ok', 'app-revoke-ok', 'usr_owner', 5000);
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_revoke_ok', 'repo-revoke-ok', 'usr_contrib_a', 'usr_owner', 1000, 'pending')
      `).run();

      await createSession('usr_owner', 'tok_revoke_ok');
      const request = await req('tok_revoke_ok', { action: 'revoke', grantId: 'cs_revoke_ok' });
      const res = await marketplaceGrantsApi.onRequestPost({ request, env: env() });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe('revoked');

      const row: any = await ctx.d1.prepare('SELECT status, revoked_at FROM contributor_shares WHERE id = ?')
        .bind('cs_revoke_ok').first();
      expect(row.status).toBe('revoked');
      expect(row.revoked_at).not.toBeNull();
    });

    it('rejects revoking an ACTIVE grant with 409 (active is perpetual/immutable per 0029/0030)', async () => {
      await seedUsers();
      await seedApp('app-revoke-active', 'usr_owner');
      await seedRepo('repo-revoke-active', 'app-revoke-active', 'usr_owner', 5000);
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at)
        VALUES ('cs_revoke_active', 'repo-revoke-active', 'usr_contrib_a', 'usr_owner', 1000, 'active', datetime('now'))
      `).run();

      await createSession('usr_owner', 'tok_revoke_active');
      const request = await req('tok_revoke_active', { action: 'revoke', grantId: 'cs_revoke_active' });
      const res = await marketplaceGrantsApi.onRequestPost({ request, env: env() });
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.success).toBe(false);
      expect(data.error).toContain('pending');

      // Row must be untouched — never silently downgraded.
      const row: any = await ctx.d1.prepare('SELECT status, revoked_at FROM contributor_shares WHERE id = ?')
        .bind('cs_revoke_active').first();
      expect(row.status).toBe('active');
      expect(row.revoked_at).toBeNull();
    });

    it('rejects revoking an already-REVOKED grant with 409', async () => {
      await seedUsers();
      await seedApp('app-revoke-twice', 'usr_owner');
      await seedRepo('repo-revoke-twice', 'app-revoke-twice', 'usr_owner', 5000);
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, revoked_at)
        VALUES ('cs_revoke_twice', 'repo-revoke-twice', 'usr_contrib_a', 'usr_owner', 1000, 'revoked', datetime('now'))
      `).run();

      await createSession('usr_owner', 'tok_revoke_twice');
      const request = await req('tok_revoke_twice', { action: 'revoke', grantId: 'cs_revoke_twice' });
      const res = await marketplaceGrantsApi.onRequestPost({ request, env: env() });
      expect(res.status).toBe(409);
    });

    it('rejects revoking a grant on a repository the caller does not own with 403 (never trusts client identity)', async () => {
      await seedUsers();
      await seedApp('app-not-owner', 'usr_owner');
      await seedRepo('repo-not-owner', 'app-not-owner', 'usr_owner', 5000);
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_not_owner', 'repo-not-owner', 'usr_contrib_a', 'usr_owner', 1000, 'pending')
      `).run();

      // usr_other_owner tries to revoke a grant on usr_owner's repository
      await createSession('usr_other_owner', 'tok_not_owner');
      const request = await req('tok_not_owner', { action: 'revoke', grantId: 'cs_not_owner' });
      const res = await marketplaceGrantsApi.onRequestPost({ request, env: env() });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.success).toBe(false);

      const row: any = await ctx.d1.prepare('SELECT status FROM contributor_shares WHERE id = ?')
        .bind('cs_not_owner').first();
      expect(row.status).toBe('pending');
    });

    it('returns 404 for a nonexistent grantId', async () => {
      await seedUsers();
      await createSession('usr_owner', 'tok_404');
      const request = await req('tok_404', { action: 'revoke', grantId: 'cs_does_not_exist' });
      const res = await marketplaceGrantsApi.onRequestPost({ request, env: env() });
      expect(res.status).toBe(404);
    });

    it('rejects an unsupported action with 400', async () => {
      await seedUsers();
      await createSession('usr_owner', 'tok_bad_action');
      const request = await req('tok_bad_action', { action: 'activate', grantId: 'cs_whatever' });
      const res = await marketplaceGrantsApi.onRequestPost({ request, env: env() });
      expect(res.status).toBe(400);
    });

    it('rejects a missing grantId with 400', async () => {
      await seedUsers();
      await createSession('usr_owner', 'tok_no_id');
      const request = await req('tok_no_id', { action: 'revoke' });
      const res = await marketplaceGrantsApi.onRequestPost({ request, env: env() });
      expect(res.status).toBe(400);
    });
  });
});
