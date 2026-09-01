import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';
import * as dropsApi from '../functions/api/drops';
import { ArtifactSandbox } from '../src/components/ArtifactSandbox';
import { PostEditorView } from '../src/views/PostEditorView';
import { AlertProvider } from '../src/context/AlertContext';
import { AuthProvider } from '../src/context/AuthContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { AppListing } from '../src/data/mockData';

const READY_GATEWAY_FETCH = async () => Response.json({
  ready: true,
  configured: true,
  active: true,
  checks: {
    git: { available: true },
    storage: { writable: true },
    controlPlane: { reachable: true },
    dispatcher: { running: true }
  }
});

describe('Marketplace Phase A: grantable_bps Set, Validation & Display', () => {
  let ctx: TestD1Context;

  const testEnv = (extra: Record<string, unknown> = {}) => ({
    DB: ctx.d1,
    GITSMITH_GATEWAY_URL: 'https://gateway.test',
    GITSMITH_GATEWAY_FETCH: READY_GATEWAY_FETCH,
    GITSMITH_GATEWAY_TOKEN: 'test_gateway_token',
    ...extra
  });

  const createSession = async (userId: string, token: string) => {
    const tokenHash = await hashSessionToken(token);
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(tokenHash, userId, Date.now() + 3600000).run();
  };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await createSession('usr_nate', 'session_nate');
    await createSession('usr_sam', 'session_sam');

    // Create root repo
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status, grantable_bps)
      VALUES ('repo_root', 'usr_nate', 'idea-root', 'public', 'sha1', 'refs/heads/main', 'repositories/repo_root', 'active', 0)
    `).run();

    // Create fork repo
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status, grantable_bps)
      VALUES ('repo_fork', 'usr_nate', 'idea-fork', 'public', 'sha1', 'refs/heads/main', 'repositories/repo_fork', 'active', 0)
    `).run();

    // Record lineage fork edge (repo_fork is a child of repo_root)
    await ctx.d1.prepare(`
      INSERT INTO repository_forks (
        child_repository_id, parent_repository_id, forked_by_user_id,
        parent_ref_name, parent_commit_oid, child_initial_commit_oid,
        lineage_root_repository_id, depth
      )
      VALUES (
        'repo_fork', 'repo_root', 'usr_nate',
        'refs/heads/main', '1111111111111111111111111111111111111111', '2222222222222222222222222222222222222222',
        'repo_root', 1
      )
    `).run();
  });

  // =========================================================================
  // 1. SET AT DROP-SUBMIT & DATABASE PERSISTENCE
  // =========================================================================
  describe('1. Drop Submission and Atomic grantable_bps Persistence', () => {
    it('sets grantable_bps on a root repository up to 8000 bps (the buy-path carve cap) and round-trips via GET', async () => {
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_root_idea',
          name: 'Root Shareware Idea',
          version: '1.0.0',
          price: '$25',
          repositoryId: 'repo_root',
          grantableBps: 8000
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(200);
      const submitData = await submitRes.json();
      expect(submitData.success).toBe(true);

      // Verify stored on repositories table
      const repoRow = await ctx.d1.prepare('SELECT grantable_bps FROM repositories WHERE id = ?')
        .bind('repo_root')
        .first<{ grantable_bps: number }>();
      expect(repoRow?.grantable_bps).toBe(8000);

      // Verify GET /api/drops returns grantable_bps and grantableBps
      const getReq = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const getRes = await dropsApi.onRequestGet({ request: getReq, env: testEnv() });
      expect(getRes.status).toBe(200);
      const getData = await getRes.json();
      const drop = getData.drops.find((d: any) => d.id === 'app_root_idea');
      expect(drop).toBeDefined();
      expect(drop.grantable_bps).toBe(8000);
      expect(drop.grantableBps).toBe(8000);
      expect(drop.repositoryId).toBe('repo_root');
    });

    it('accepts snake_case grantable_bps in POST body', async () => {
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_root_snake',
          name: 'Root Snake Idea',
          version: '1.0.0',
          price: '$15',
          repositoryId: 'repo_root',
          grantable_bps: 7500
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(200);

      const repoRow = await ctx.d1.prepare('SELECT grantable_bps FROM repositories WHERE id = ?')
        .bind('repo_root')
        .first<{ grantable_bps: number }>();
      expect(repoRow?.grantable_bps).toBe(7500);
    });

    it('sets grantable_bps on a fork repository up to 6000 bps (60%)', async () => {
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_fork_idea',
          name: 'Forked Shareware Mod',
          version: '1.0.0',
          price: '$30',
          repositoryId: 'repo_fork',
          grantableBps: 6000
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(200);

      const repoRow = await ctx.d1.prepare('SELECT grantable_bps FROM repositories WHERE id = ?')
        .bind('repo_fork')
        .first<{ grantable_bps: number }>();
      expect(repoRow?.grantable_bps).toBe(6000);
    });
  });

  // =========================================================================
  // 2. SET-TIME VALIDATION & FAIL-CLOSED GUARDS
  // =========================================================================
  describe('2. Fail-Closed Validation Rules', () => {
    it('rejects root idea exceeding the 8000 bps cap with 422', async () => {
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_root_over',
          name: 'Over Cap Root',
          version: '1.0.0',
          price: '$20',
          repositoryId: 'repo_root',
          grantableBps: 9001
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(422);
      const data = await submitRes.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('exceeds maximum allowable cap of 8000 bps (80%) for root repository');
    });

    it('rejects fork idea exceeding 6000 bps cap with 422', async () => {
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_fork_over',
          name: 'Over Cap Fork',
          version: '1.0.0',
          price: '$20',
          repositoryId: 'repo_fork',
          grantableBps: 6500
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(422);
      const data = await submitRes.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('exceeds maximum allowable cap of 6000 bps (60%) for fork repository');
    });

    it('honestly provisions a repository for a drop with null repository_id, so nonzero grantableBps is accepted against the new (root) repo', async () => {
      // Fix 1 (HOTWIRE #6): drops.ts now honestly provisions a real
      // repositories row for any drop that doesn't already have one, so a
      // maker no longer has to separately "link a repository" first — one
      // genuinely exists (status 'provisioning') by the time grantableBps is
      // validated. This supersedes the old fail-closed 422 behavior.
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_no_repo',
          name: 'No Repo Idea',
          version: '1.0.0',
          price: '$20',
          repositoryId: null,
          grantableBps: 5000
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(200);
      const data = await submitRes.json();
      expect(data.success).toBe(true);
      expect(data.repositoryProvisioned).toBe(true);

      const repo = await ctx.d1.prepare('SELECT grantable_bps AS grantableBps, status FROM repositories WHERE id = ?')
        .bind(data.repositoryId).first();
      expect((repo as any).grantableBps).toBe(5000);
      expect((repo as any).status).toBe('provisioning');
    });

    it('still rejects grantableBps above the 8000 root cap even against a freshly-provisioned repository', async () => {
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_no_repo_over_cap',
          name: 'No Repo Idea Over Cap',
          version: '1.0.0',
          price: '$20',
          repositoryId: null,
          grantableBps: 9500
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(422);
      const data = await submitRes.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('exceeds maximum allowable cap');
    });

    it('allows drop with null repository_id when grantableBps is 0 or omitted', async () => {
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_no_repo_zero',
          name: 'No Repo Zero Pool',
          version: '1.0.0',
          price: '$20',
          repositoryId: null,
          grantableBps: 0
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(200);
      const data = await submitRes.json();
      expect(data.success).toBe(true);
    });

    it.each([
      [50.5, 'float'],
      ['not-a-number', 'string text'],
      [NaN, 'NaN'],
      [Infinity, 'Infinity'],
      [true, 'boolean']
    ])('rejects non-integer grantableBps (%s: %s) with 422', async (invalidBps, _desc) => {
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_invalid_bps',
          name: 'Invalid BPS Test',
          version: '1.0.0',
          price: '$20',
          repositoryId: 'repo_root',
          grantableBps: invalidBps
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(422);
      const data = await submitRes.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('grantableBps must be an integer between 0 and 10000');
    });

    it.each([
      [-1, 'negative'],
      [-500, 'large negative'],
      [10001, 'over 10000'],
      [50000, 'very large']
    ])('rejects out of bounds grantableBps (%i: %s) with 422', async (outOfBoundsBps, _desc) => {
      const submitReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_bounds_bps',
          name: 'Bounds BPS Test',
          version: '1.0.0',
          price: '$20',
          repositoryId: 'repo_root',
          grantableBps: outOfBoundsBps
        })
      });

      const submitRes = await dropsApi.onRequestPost({ request: submitReq, env: testEnv() });
      expect(submitRes.status).toBe(422);
      const data = await submitRes.json();
      expect(data.success).toBe(false);
    });

    it('rejects lowering grantable pool below sum of active + pending grants (Decision #2)', async () => {
      // Set initial pool to 5000 bps
      await ctx.d1.prepare('UPDATE repositories SET grantable_bps = 5000 WHERE id = ?')
        .bind('repo_root')
        .run();

      // Insert an active grant of 2000 bps and pending grant of 1000 bps (total 3000 bps granted)
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at)
        VALUES ('cs_active_1', 'repo_root', 'usr_sam', 'usr_nate', 2000, 'active', CURRENT_TIMESTAMP)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_pending_1', 'repo_root', 'usr_sam', 'usr_nate', 1000, 'pending')
      `).run();

      // Attempt to lower pool to 2500 bps (below 3000 bps granted) -> rejected with 422
      const lowerReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_lower_pool',
          name: 'Lower Pool Test',
          version: '1.0.0',
          price: '$20',
          repositoryId: 'repo_root',
          grantableBps: 2500
        })
      });

      const lowerRes = await dropsApi.onRequestPost({ request: lowerReq, env: testEnv() });
      expect(lowerRes.status).toBe(422);
      const data = await lowerRes.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('30% is already granted; can\'t drop the pool below that');

      // Lowering down to exactly 3000 or 3500 bps succeeds
      const validLowerReq = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer session_nate'
        },
        body: JSON.stringify({
          id: 'app_lower_pool_ok',
          name: 'Lower Pool Valid',
          version: '1.0.0',
          price: '$20',
          repositoryId: 'repo_root',
          grantableBps: 3500
        })
      });

      const validLowerRes = await dropsApi.onRequestPost({ request: validLowerReq, env: testEnv() });
      expect(validLowerRes.status).toBe(200);

      const repoRow = await ctx.d1.prepare('SELECT grantable_bps FROM repositories WHERE id = ?')
        .bind('repo_root')
        .first<{ grantable_bps: number }>();
      expect(repoRow?.grantable_bps).toBe(3500);
    });
  });

  // =========================================================================
  // 3. UI RENDERING TESTS (ArtifactSandbox badge & PostEditorView input)
  // =========================================================================
  describe('3. UI Rendering: ArtifactSandbox Badge & PostEditorView', () => {
    const baseApp: AppListing = {
      id: 'app_test_badge',
      name: 'Badge Test App',
      tagline: 'Testing contributor upside badge',
      description: 'Long description',
      author: 'nate',
      authorAvatar: '🎯',
      version: 'v1.0.0',
      upvotes: 10,
      forkCount: 2,
      tags: ['Utility'],
      screenshots: ['https://example.com/shot.png'],
      comments: [],
      price: 15
    };

    it('renders the "Up to 90% of every sale available to contributors" badge when grantable_bps is 9000', () => {
      const appWithGrantable: AppListing = {
        ...baseApp,
        grantable_bps: 9000,
        grantableBps: 8000
      };

      const html = renderToString(
        <AlertProvider>
          <AuthProvider>
            <CatalogProvider>
              <ArtifactSandbox app={appWithGrantable} />
            </CatalogProvider>
          </AuthProvider>
        </AlertProvider>
      );

      expect(html).toContain('Up to 90% of every sale available to contributors');
    });

    it('renders the "Up to 50% of every sale available to contributors" badge when grantable_bps is 5000', () => {
      const appWithGrantable: AppListing = {
        ...baseApp,
        grantable_bps: 5000,
        grantableBps: 5000
      };

      const html = renderToString(
        <AlertProvider>
          <AuthProvider>
            <CatalogProvider>
              <ArtifactSandbox app={appWithGrantable} />
            </CatalogProvider>
          </AuthProvider>
        </AlertProvider>
      );

      expect(html).toContain('Up to 50% of every sale available to contributors');
    });

    it('does NOT render the contributor upside badge when grantable_bps is 0 or undefined', () => {
      const appZero: AppListing = {
        ...baseApp,
        grantable_bps: 0,
        grantableBps: 0
      };

      const html = renderToString(
        <AlertProvider>
          <AuthProvider>
            <CatalogProvider>
              <ArtifactSandbox app={appZero} />
            </CatalogProvider>
          </AuthProvider>
        </AlertProvider>
      );

      expect(html).not.toContain('available to contributors');
    });

    it('renders PostEditorView with grantable pool input and 90% cap for root app', () => {
      const rootApp: AppListing = {
        ...baseApp,
        forkDepth: 0,
        grantable_bps: 8000
      };

      const html = renderToString(
        <AlertProvider>
          <PostEditorView
            app={rootApp}
            initialTab="pricing"
            onSave={() => {}}
            onCancel={() => {}}
          />
        </AlertProvider>
      );

      expect(html).toContain('Post Editor');
      expect(html).toContain('Pricing &amp; Contributor Revenue Splits');
      expect(html).toContain('Contributor Share Pool');
      expect(html).toContain('90%');
    });

    it('renders PostEditorView with 60% cap for fork app', () => {
      const forkApp: AppListing = {
        ...baseApp,
        forkDepth: 1,
        grantable_bps: 5000
      };

      const html = renderToString(
        <AlertProvider>
          <PostEditorView
            app={forkApp}
            initialTab="pricing"
            onSave={() => {}}
            onCancel={() => {}}
          />
        </AlertProvider>
      );

      expect(html).toContain('60%');
    });
  });
});
