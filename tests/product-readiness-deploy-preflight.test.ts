import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as readinessApi from '../functions/api/product-readiness';
import { hashSessionToken } from '../functions/api/_session';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

describe('GET /api/product-readiness?deploy=1 — deploy-readiness preflight', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  async function seedUser(id: string) {
    await ctx.d1.prepare(`INSERT OR IGNORE INTO users (id, username, display_name) VALUES (?, ?, ?)`).bind(id, id, id).run();
  }

  async function createSession(userId: string, token: string) {
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(await hashSessionToken(token), userId, Date.now() + 3_600_000).run();
  }

  function authenticatedRequest(url: string, token = 'valid_test_token') {
    return new Request(url, { headers: { Authorization: `Bearer ${token}` } });
  }

  async function seedListing(appId: string, opts: { hostname?: string | null; originKind?: string | null } = {}) {
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, hostname, origin_kind)
      VALUES (?, ?, 'Tagline', 'Desc', 'usr_maker', 'v1.0.0', 'MIT', '$15.00', '/data', '[]', '[]', '{}', ?, ?)
    `).bind(appId, appId, opts.hostname ?? null, opts.originKind ?? 'r2_static').run();
  }

  async function seedRepository(repoId: string, appId: string, status = 'active') {
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
      VALUES (?, ?, 'usr_maker', ?, ?, ?)
    `).bind(repoId, appId, appId, `key_${repoId}`, status).run();
  }

  it('is omitted entirely when ?deploy=1 is not passed (no behavior change to the base projection)', async () => {
    await seedUser('usr_maker');
    await seedListing('no-deploy-flag');
    const req = new Request('http://localhost/api/product-readiness?appId=no-deploy-flag');
    const res = await readinessApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
    const data: any = await res.json();
    expect(data.readiness.deploy).toBeUndefined();
  });

  it('is never computed for the all-apps catalog sweep, even without an appId', async () => {
    const req = new Request('http://localhost/api/product-readiness?deploy=1');
    const res = await readinessApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
    const data: any = await res.json();
    expect(Array.isArray(data.readiness)).toBe(true);
    for (const r of data.readiness) expect(r.deploy).toBeUndefined();
  });

  it('rejects anonymous deploy preflight without changing state or provisioning ECR', async () => {
    await seedUser('usr_maker');
    await seedListing('anonymous-preflight', { hostname: 'anonymous-preflight.nates-software.com' });
    await seedRepository('repo-anonymous-preflight', 'anonymous-preflight', 'active');
    const before = await ctx.d1.prepare(`
      SELECT deployment_state, deployment_error, deployment_evidence_json
      FROM app_listings WHERE id = 'anonymous-preflight'
    `).first();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected ECR provisioning'));

    const response = await readinessApi.onRequestGet({
      request: new Request('http://localhost/api/product-readiness?appId=anonymous-preflight&deploy=1'),
      env: {
        DB: ctx.d1,
        STORAGE: {},
        AWS_ACCESS_KEY_ID: 'AKIA_TEST',
        AWS_SECRET_ACCESS_KEY: 'secret_test',
        AWS_CODEBUILD_DEPLOY_PROJECT: 'nsw-deploy'
      }
    });
    const after = await ctx.d1.prepare(`
      SELECT deployment_state, deployment_error, deployment_evidence_json
      FROM app_listings WHERE id = 'anonymous-preflight'
    `).first();

    expect(response.status).toBe(401);
    expect(after).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an authenticated non-owner deploy preflight without provisioning ECR', async () => {
    await seedUser('usr_maker');
    await seedUser('usr_other_maker');
    await createSession('usr_other_maker', 'readiness_other_token');
    await seedListing('non-owner-preflight', { hostname: 'non-owner-preflight.nates-software.com' });
    await seedRepository('repo-non-owner-preflight', 'non-owner-preflight', 'active');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected ECR provisioning'));

    const response = await readinessApi.onRequestGet({
      request: authenticatedRequest(
        'http://localhost/api/product-readiness?appId=non-owner-preflight&deploy=1',
        'readiness_other_token'
      ),
      env: {
        DB: ctx.d1,
        STORAGE: {},
        AWS_ACCESS_KEY_ID: 'AKIA_TEST',
        AWS_SECRET_ACCESS_KEY: 'secret_test',
        AWS_CODEBUILD_DEPLOY_PROJECT: 'nsw-deploy'
      }
    });

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports not-ready with reasons when the app has no active linked repository', async () => {
    await seedUser('usr_maker');
    await seedListing('no-repo-app', { hostname: 'no-repo-app.nates-software.com' });
    const req = authenticatedRequest('http://localhost/api/product-readiness?appId=no-repo-app&deploy=1');
    const res = await readinessApi.onRequestGet({ request: req, env: { DB: ctx.d1, STORAGE: {} } });
    const data: any = await res.json();

    expect(data.readiness.deploy.ready).toBe(false);
    expect(data.readiness.deploy.checks.repositoryLinked).toBe(false);
    expect(data.readiness.deploy.reasons.some((r: string) => r.toLowerCase().includes('repository'))).toBe(true);
  });

  it('reports not-ready with reasons when hostname/origin is missing (router cannot bind it)', async () => {
    await seedUser('usr_maker');
    await seedListing('no-hostname-app', { hostname: null });
    await seedRepository('repo-no-hostname', 'no-hostname-app', 'active');
    const req = authenticatedRequest('http://localhost/api/product-readiness?appId=no-hostname-app&deploy=1');
    const res = await readinessApi.onRequestGet({ request: req, env: { DB: ctx.d1, STORAGE: {} } });
    const data: any = await res.json();

    expect(data.readiness.deploy.ready).toBe(false);
    expect(data.readiness.deploy.checks.routerBindable).toBe(false);
    expect(data.readiness.deploy.reasons.some((r: string) => r.toLowerCase().includes('router') || r.toLowerCase().includes('hostname'))).toBe(true);
  });

  it('reports not-ready when R2 STORAGE is not bound in this environment', async () => {
    await seedUser('usr_maker');
    await seedListing('no-storage-app', { hostname: 'no-storage-app.nates-software.com' });
    await seedRepository('repo-no-storage', 'no-storage-app', 'active');
    const req = authenticatedRequest('http://localhost/api/product-readiness?appId=no-storage-app&deploy=1');
    const res = await readinessApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
    const data: any = await res.json();

    expect(data.readiness.deploy.ready).toBe(false);
    expect(data.readiness.deploy.checks.storageConfigured).toBe(false);
  });

  it('reports ecrRepositoryProvisioned=null (not fabricated true/false) and not-ready when AWS credentials are absent', async () => {
    await seedUser('usr_maker');
    await seedListing('no-aws-app', { hostname: 'no-aws-app.nates-software.com' });
    await seedRepository('repo-no-aws', 'no-aws-app', 'active');
    const req = authenticatedRequest('http://localhost/api/product-readiness?appId=no-aws-app&deploy=1');
    const res = await readinessApi.onRequestGet({
      request: req,
      env: { DB: ctx.d1, STORAGE: {}, AWS_CODEBUILD_DEPLOY_PROJECT: 'nsw-deploy' }
    });
    const data: any = await res.json();

    expect(data.readiness.deploy.checks.ecrRepositoryProvisioned).toBeNull();
    expect(data.readiness.deploy.ready).toBe(false);
    expect(data.readiness.deploy.reasons.some((r: string) => r.toLowerCase().includes('ecr'))).toBe(true);
  });

  it('allows the owner to run the ECR preflight when every deploy check is confirmed', async () => {
    await seedUser('usr_maker');
    await createSession('usr_maker', 'readiness_owner_token');
    await seedListing('all-ready-app', { hostname: 'all-ready-app.nates-software.com', originKind: 'cf_container' });
    await seedRepository('repo-all-ready', 'all-ready-app', 'active');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ __type: 'RepositoryAlreadyExistsException', message: 'already exists' }),
      { status: 400 }
    )) as any;
    try {
      const req = authenticatedRequest('http://localhost/api/product-readiness?appId=all-ready-app&deploy=1', 'readiness_owner_token');
      const res = await readinessApi.onRequestGet({
        request: req,
        env: { DB: ctx.d1, STORAGE: {}, AWS_ACCESS_KEY_ID: 'AKIA_TEST', AWS_SECRET_ACCESS_KEY: 'secret_test', AWS_CODEBUILD_DEPLOY_PROJECT: 'nsw-deploy' }
      });
      const data: any = await res.json();
      expect(data.readiness.deploy.checks.ecrRepositoryProvisioned).toBe(true);
      expect(data.readiness.deploy.checks.repositoryLinked).toBe(true);
      expect(data.readiness.deploy.checks.routerBindable).toBe(true);
      expect(data.readiness.deploy.checks.storageConfigured).toBe(true);
      expect(data.readiness.deploy.checks.buildSubstrateConfigured).toBe(true);
      expect(data.readiness.deploy.ready).toBe(true);
      expect(data.readiness.deploy.reasons).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reports not-ready with a reason when the live ECR check fails (repo genuinely not provisioned)', async () => {
    await seedUser('usr_maker');
    await seedListing('ecr-missing-app', { hostname: 'ecr-missing-app.nates-software.com' });
    await seedRepository('repo-ecr-missing', 'ecr-missing-app', 'active');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ __type: 'SomeOtherException', message: 'permission denied' }),
      { status: 403 }
    )) as any;
    try {
      const req = authenticatedRequest('http://localhost/api/product-readiness?appId=ecr-missing-app&deploy=1');
      const res = await readinessApi.onRequestGet({
        request: req,
        env: { DB: ctx.d1, STORAGE: {}, AWS_ACCESS_KEY_ID: 'AKIA_TEST', AWS_SECRET_ACCESS_KEY: 'secret_test', AWS_CODEBUILD_DEPLOY_PROJECT: 'nsw-deploy' }
      });
      const data: any = await res.json();
      expect(data.readiness.deploy.checks.ecrRepositoryProvisioned).toBe(false);
      expect(data.readiness.deploy.ready).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
