import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';
import * as dropsApi from '../functions/api/drops';
import * as gitApi from '../functions/api/git';
import * as forkApi from '../functions/api/fork';

const OID_MAIN = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const GATEWAY_SECRET = 'test_gateway_secret_token_123';
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

describe('Phase 1: Canonical Repository Linkage & Real Fork Suite', () => {
  let ctx: TestD1Context;

  const testEnv = (extra: Record<string, unknown> = {}) => ({
    DB: ctx.d1,
    GITSMITH_GATEWAY_URL: 'https://gateway.test',
    GITSMITH_GATEWAY_FETCH: READY_GATEWAY_FETCH,
    GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET,
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
  });

  // =========================================================================
  // 1. DATA-MODEL & MIGRATION 0024 INTEGRITY
  // =========================================================================
  describe('1. Schema Linkage & Migration 0024 Invariants', () => {
    it('passes foreign key checks across the full migration chain', () => {
      const violations = ctx.runForeignKeyCheck();
      expect(violations).toEqual([]);
    });

    it('has repository_id column on app_listings with foreign key enforcement', async () => {
      // Default seed apps start with null repository_id
      const app = await ctx.d1.prepare('SELECT id, repository_id, forks FROM app_listings WHERE id = ?')
        .bind('wallart')
        .first<{ id: string; repository_id: string | null; forks: number }>();
      expect(app).not.toBeNull();
      expect(app?.id).toBe('wallart');
      expect(app?.repository_id).toBeNull();

      // Reject non-existent repository FK
      await expect(
        ctx.d1.prepare('UPDATE app_listings SET repository_id = ? WHERE id = ?')
          .bind('repo_nonexistent', 'wallart')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  // =========================================================================
  // 2. GET /api/drops CANONICAL REPO IDENTITY SURFACING
  // =========================================================================
  describe('2. GET /api/drops Canonical Repository Metadata', () => {
    it('surfaces honest-absent when app listing has no canonical repository', async () => {
      const req = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: testEnv() });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const wallart = data.drops.find((d: any) => d.id === 'wallart');
      expect(wallart).toBeDefined();
      expect(wallart.hasCanonicalRepo).toBe(false);
      expect(wallart.repositoryId).toBeNull();
      expect(wallart.repoSlug).toBeNull();
      expect(wallart.repoHeadCommitOid).toBeNull();
      expect(wallart.isRepoActive).toBe(false);
    });

    it('surfaces real repo slug, head commit OID, and active status when canonical repo is linked', async () => {
      // 1. Create canonical repository and ref for wallart
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_wallart', 'usr_nate', 'wallart', 'public', 'sha1', 'refs/heads/main', 'repositories/repo_wallart', 'active')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
        VALUES ('repo_wallart', 'refs/heads/main', ?, 1, 'usr_nate')
      `).bind(OID_MAIN).run();

      // 2. Link app_listing to repository
      await ctx.d1.prepare('UPDATE app_listings SET repository_id = ? WHERE id = ?')
        .bind('repo_wallart', 'wallart')
        .run();

      // 3. Query /api/drops
      const req = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: testEnv() });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const wallart = data.drops.find((d: any) => d.id === 'wallart');
      expect(wallart).toBeDefined();
      expect(wallart.hasCanonicalRepo).toBe(true);
      expect(wallart.repositoryId).toBe('repo_wallart');
      expect(wallart.repoSlug).toBe('nate/wallart');
      expect(wallart.repoName).toBe('wallart');
      expect(wallart.repoOwner).toBe('nate');
      expect(wallart.repoHeadCommitOid).toBe(OID_MAIN);
      expect(wallart.isRepoActive).toBe(true);
      expect(wallart.repoVisibility).toBe('public');
    });

    it('surfaces canonical repo metadata via legacy reverse FK fallback (repositories.app_id)', async () => {
      // Create repository with app_id pointing to dronehunter but app_listings.repository_id is null
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_dronehunter', 'dronehunter', 'usr_nate', 'dronehunter', 'public', 'sha1', 'refs/heads/main', 'repositories/repo_dronehunter', 'active')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
        VALUES ('repo_dronehunter', 'refs/heads/main', ?, 1, 'usr_nate')
      `).bind(OID_MAIN).run();

      const req = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: testEnv() });
      const data = await res.json();

      const drone = data.drops.find((d: any) => d.id === 'dronehunter');
      expect(drone).toBeDefined();
      expect(drone.hasCanonicalRepo).toBe(true);
      expect(drone.repositoryId).toBe('repo_dronehunter');
      expect(drone.repoSlug).toBe('nate/dronehunter');
      expect(drone.repoHeadCommitOid).toBe(OID_MAIN);
      expect(drone.isRepoActive).toBe(true);
    });
  });

  // =========================================================================
  // 3. REAL FORK BUTTON & BACKEND FLOW
  // =========================================================================
  describe('3. Real Fork Execution, Forks Increment & Honest Refusal', () => {
    beforeEach(async () => {
      // Set up active parent repository with head commit for wallart
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_wallart', 'usr_nate', 'wallart', 'public', 'sha1', 'refs/heads/main', 'repositories/repo_wallart', 'active')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
        VALUES ('repo_wallart', 'refs/heads/main', ?, 1, 'usr_nate')
      `).bind(OID_MAIN).run();

      await ctx.d1.prepare('UPDATE app_listings SET repository_id = ?, forks = 0 WHERE id = ?')
        .bind('repo_wallart', 'wallart')
        .run();
    });

    it('rejects unauthenticated fork requests with 401', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
        body: JSON.stringify({
          action: 'fork',
          parentRepositoryId: 'repo_wallart',
          childSlug: 'wallart-fork'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: testEnv() });
      expect(res.status).toBe(401);
    });

    it('honestly refuses fork when project has NO canonical repository', async () => {
      // american-gardener has no repository row
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_sam',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          action: 'fork',
          appId: 'american-gardener',
          childSlug: 'gardener-sam'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: testEnv() });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Parent repository not found');
    });

    it('executes real fork, increments parent listing forks count, and queues outbox event', async () => {
      // Check initial forks count on wallart
      const beforeApp = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('wallart').first<{ forks: number }>();
      expect(beforeApp?.forks).toBe(0);

      // User Sam creates a real fork of wallart
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_sam',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          action: 'fork',
          parentRepositoryId: 'repo_wallart',
          appId: 'wallart',
          childSlug: 'wallart-sam-mod',
          parentRefName: 'refs/heads/main'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: testEnv() });
      expect(res.status).toBe(201);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.repository.ownerUserId).toBe('usr_sam');
      expect(data.repository.slug).toBe('wallart-sam-mod');
      expect(data.repository.status).toBe('provisioning');
      expect(data.forkRequest.parentCommitOid).toBe(OID_MAIN);
      expect(data.forkRequest.lineageRootRepositoryId).toBe('repo_wallart');
      expect(data.forkRequest.depth).toBe(1);

      // Verify forks++ on app_listings
      const afterApp = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('wallart').first<{ forks: number }>();
      expect(afterApp?.forks).toBe(1);

      // Verify forge_outbox_events row
      const outbox = await ctx.d1.prepare('SELECT * FROM forge_outbox_events WHERE id = ?')
        .bind(data.outboxEventId)
        .first<{ event_type: string; aggregate_type: string; payload: string }>();
      expect(outbox).not.toBeNull();
      expect(outbox?.event_type).toBe('repository.fork_requested');
      expect(outbox?.aggregate_type).toBe('fork');

      const parsedPayload = JSON.parse(outbox!.payload);
      expect(parsedPayload.parentRepositoryId).toBe('repo_wallart');
      expect(parsedPayload.parentCommitOid).toBe(OID_MAIN);
      expect(parsedPayload.forkedByUserId).toBe('usr_sam');

      // Gateway confirms fork (Phase 2 confirmation)
      const confirmReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GATEWAY_SECRET}`
        },
        body: JSON.stringify({
          action: 'gateway-confirm-fork',
          childRepositoryId: data.repository.id,
          parentRepositoryId: 'repo_wallart',
          parentRefName: 'refs/heads/main',
          parentCommitOid: OID_MAIN,
          childInitialCommitOid: OID_MAIN,
          idempotencyKey: 'idemp_confirm_1',
          actorUserId: 'usr_sam'
        })
      });

      const confirmRes = await gitApi.onRequestPost({ request: confirmReq, env: testEnv() });
      expect(confirmRes.status).toBe(201);
      const confirmData = await confirmRes.json();
      expect(confirmData.success).toBe(true);
      expect(confirmData.status).toBe('active');

      // Verify canonical immutable lineage edge in repository_forks
      const forkEdge = await ctx.d1.prepare('SELECT * FROM repository_forks WHERE child_repository_id = ?')
        .bind(data.repository.id)
        .first<{ child_repository_id: string; parent_repository_id: string; depth: number }>();
      expect(forkEdge).not.toBeNull();
      expect(forkEdge?.parent_repository_id).toBe('repo_wallart');
      expect(forkEdge?.depth).toBe(1);
    });

    it('handles idempotent replay without double-incrementing forks', async () => {
      const forkBody = {
        action: 'fork',
        parentRepositoryId: 'repo_wallart',
        appId: 'wallart',
        childSlug: 'wallart-idempotent-test'
      };

      const req1 = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_sam', Origin: 'http://localhost' },
        body: JSON.stringify(forkBody)
      });
      const res1 = await gitApi.onRequestPost({ request: req1, env: testEnv() });
      expect(res1.status).toBe(201);

      const forksAfterFirst = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('wallart').first<any>();
      expect(forksAfterFirst.forks).toBe(1);

      // Replay identical fork request
      const req2 = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_sam', Origin: 'http://localhost' },
        body: JSON.stringify(forkBody)
      });
      const res2 = await gitApi.onRequestPost({ request: req2, env: testEnv() });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.idempotent).toBe(true);

      // Forks count must remain 1 (no double increment)
      const forksAfterSecond = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('wallart').first<any>();
      expect(forksAfterSecond.forks).toBe(1);
    });

    it('supports thin /api/fork endpoint wrapper', async () => {
      const req = new Request('http://localhost/api/fork', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_sam',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          parentRepositoryId: 'repo_wallart',
          appId: 'wallart',
          childSlug: 'wallart-thin-api'
        })
      });

      const res = await forkApi.onRequestPost({ request: req, env: testEnv() });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.repository.slug).toBe('wallart-thin-api');
    });

    it('succeeds forking a repository whose default_ref is not main when parentRefName is sent', async () => {
      const OID_CUSTOM = '9999888877776666555544443333222211110000';
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_custom_branch', 'usr_nate', 'custom-branch-app', 'public', 'sha1', 'refs/heads/develop', 'repositories/repo_custom_branch', 'active')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
        VALUES ('repo_custom_branch', 'refs/heads/develop', ?, 1, 'usr_nate')
      `).bind(OID_CUSTOM).run();

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, creator_id, name, tagline, description, version, price, repository_id, forks)
        VALUES ('custom-app', 'usr_nate', 'Custom App', 'Custom Branch App', 'App on develop ref', '1.0.0', '0.00', 'repo_custom_branch', 0)
      `).run();

      // 1. Explicit parentRefName: 'refs/heads/develop'
      const req1 = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_sam',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          action: 'fork',
          parentRepositoryId: 'repo_custom_branch',
          appId: 'custom-app',
          childSlug: 'custom-app-sam-mod',
          parentRefName: 'refs/heads/develop'
        })
      });

      const res1 = await gitApi.onRequestPost({ request: req1, env: testEnv() });
      expect(res1.status).toBe(201);
      const data1 = await res1.json();
      expect(data1.success).toBe(true);
      expect(data1.forkRequest.parentRefName).toBe('refs/heads/develop');
      expect(data1.forkRequest.parentCommitOid).toBe(OID_CUSTOM);
      expect(data1.repository.defaultRef).toBe('refs/heads/develop');

      // 2. Omitted parentRefName defaults to parent repository default_ref ('refs/heads/develop')
      const req2 = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_nate',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          action: 'fork',
          parentRepositoryId: 'repo_custom_branch',
          childSlug: 'custom-app-nate-mod'
        })
      });

      const res2 = await gitApi.onRequestPost({ request: req2, env: testEnv() });
      expect(res2.status).toBe(201);
      const data2 = await res2.json();
      expect(data2.success).toBe(true);
      expect(data2.forkRequest.parentRefName).toBe('refs/heads/develop');
      expect(data2.forkRequest.parentCommitOid).toBe(OID_CUSTOM);
    });

    it('rejects fork request with 400 when mismatched appId and parentRepositoryId are provided', async () => {
      // wallart is linked to repo_wallart; dronehunter is not linked to repo_wallart
      const wallartBefore = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('wallart').first<{ forks: number }>();
      const droneBefore = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('dronehunter').first<{ forks: number }>();

      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_sam',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          action: 'fork',
          parentRepositoryId: 'repo_wallart',
          appId: 'dronehunter', // mismatched appId
          childSlug: 'wallart-tampered'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: testEnv() });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Provided appId does not match the parent repository');

      // Ensure neither listing's fork counter was modified
      const wallartAfter = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('wallart').first<{ forks: number }>();
      const droneAfter = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('dronehunter').first<{ forks: number }>();
      expect(wallartAfter?.forks).toBe(wallartBefore?.forks);
      expect(droneAfter?.forks).toBe(droneBefore?.forks);
    });

    it('targets solely the resolved parent repository listing when incrementing forks count', async () => {
      // Fork repo_wallart by repository ID without passing appId
      const wallartBefore = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('wallart').first<{ forks: number }>();

      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_sam',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          action: 'fork',
          parentRepositoryId: 'repo_wallart',
          childSlug: 'wallart-sole-target'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: testEnv() });
      expect(res.status).toBe(201);

      const wallartAfter = await ctx.d1.prepare('SELECT forks FROM app_listings WHERE id = ?').bind('wallart').first<{ forks: number }>();
      expect(wallartAfter?.forks).toBe((wallartBefore?.forks || 0) + 1);
    });
  });
});
