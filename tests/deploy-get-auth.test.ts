import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as deployApi from '../functions/api/deploy';
import { hashSessionToken } from '../functions/api/_session';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';

describe('GET /api/deploy authorization', () => {
  let ctx: TestD1Context;

  const ownerToken = 'deploy_owner_token';
  const otherToken = 'deploy_other_token';

  async function createSession(userId: string, token: string) {
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(await hashSessionToken(token), userId, Date.now() + 3_600_000).run();
  }

  async function snapshotState() {
    const listing = await ctx.d1.prepare(`
      SELECT deployment_state, deployment_error, deployment_evidence_json,
             active_deployment_id, active_commit_oid
      FROM app_listings WHERE id = 'auth-gated-deploy'
    `).first();
    const buildRuns = await ctx.d1.prepare(`
      SELECT id, status, result_digest, exit_code, finished_at
      FROM build_runs WHERE repository_id = 'repo_auth_gated_deploy' ORDER BY id
    `).all();
    const revisions = await ctx.d1.prepare(`
      SELECT id, status FROM deployment_revisions
      WHERE app_id = 'auth-gated-deploy' ORDER BY id
    `).all();
    return { listing, buildRuns: buildRuns.results, revisions: revisions.results };
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    ctx = await createTestD1Database({ foreignKeys: true });
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role)
      VALUES ('usr_deploy_owner', 'deploy-owner', 'Deploy Owner', 'maker'),
             ('usr_deploy_other', 'deploy-other', 'Deploy Other', 'maker')
    `).run();
    await createSession('usr_deploy_owner', ownerToken);
    await createSession('usr_deploy_other', otherToken);
    await ctx.d1.prepare(`
      INSERT INTO app_listings (
        id, name, tagline, description, creator_id, version, license, price,
        storage, tags, screenshots, binaries, listing_status, deployment_state
      ) VALUES (
        'auth-gated-deploy', 'Auth Gated Deploy', 'Tagline', 'Description',
        'usr_deploy_owner', 'v1.0.0', 'MIT', '$15.00', '/data', '[]', '[]', '{}',
        'active', 'building'
      )
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
      VALUES (
        'repo_auth_gated_deploy', 'auth-gated-deploy', 'usr_deploy_owner',
        'auth-gated-deploy', 'repositories/repo_auth_gated_deploy', 'active'
      )
    `).run();
    await ctx.d1.prepare(`
      UPDATE app_listings SET repository_id = 'repo_auth_gated_deploy'
      WHERE id = 'auth-gated-deploy'
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO build_runs (
        id, repository_id, commit_oid, purpose, status, runner_image_digest,
        build_command, source_manifest_digest, started_at
      ) VALUES (
        'build_auth_gated_deploy', 'repo_auth_gated_deploy', 'invalid-commit',
        'release', 'running', 'candidate-project:build-1', 'npm run build',
        'sha256:source', CURRENT_TIMESTAMP
      )
    `).run();
  });

  it('keeps the no-appId service information public', async () => {
    const response = await deployApi.onRequestGet({
      request: new Request('http://localhost/api/deploy'),
      env: { DB: ctx.d1 }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      service: 'RIG Deployment Lifecycle Control Plane'
    });
  });

  it('rejects an anonymous app-scoped request without mutating or dispatching', async () => {
    const before = await snapshotState();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected dispatch'));

    const response = await deployApi.onRequestGet({
      request: new Request('http://localhost/api/deploy?appId=auth-gated-deploy'),
      env: { DB: ctx.d1 }
    });

    expect(response.status).toBe(401);
    expect(await snapshotState()).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an authenticated non-owner without mutating or dispatching', async () => {
    const before = await snapshotState();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected dispatch'));

    const response = await deployApi.onRequestGet({
      request: new Request('http://localhost/api/deploy?appId=auth-gated-deploy', {
        headers: { Authorization: `Bearer ${otherToken}` }
      }),
      env: { DB: ctx.d1 }
    });

    expect(response.status).toBe(403);
    expect(await snapshotState()).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows the owner to run lazy finalization and return the resulting status', async () => {
    const response = await deployApi.onRequestGet({
      request: new Request('http://localhost/api/deploy?appId=auth-gated-deploy', {
        headers: { Authorization: `Bearer ${ownerToken}` }
      }),
      env: { DB: ctx.d1 }
    });
    const data: any = await response.json();
    const build: any = await ctx.d1.prepare(`
      SELECT status, exit_code FROM build_runs WHERE id = 'build_auth_gated_deploy'
    `).first();
    const listing: any = await ctx.d1.prepare(`
      SELECT deployment_state, deployment_error
      FROM app_listings WHERE id = 'auth-gated-deploy'
    `).first();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      success: true,
      appId: 'auth-gated-deploy',
      deploymentState: 'failed'
    });
    expect(build).toMatchObject({ status: 'failed', exit_code: 1 });
    expect(listing.deployment_state).toBe('failed');
    expect(listing.deployment_error).toContain('Invalid commitOid');
  });
});
