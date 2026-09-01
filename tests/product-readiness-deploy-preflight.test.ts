// Spec RIG Fix 2 — deploy-readiness preflight gates the publish control.
// GET /api/product-readiness?appId=...&deploy=1 extends the existing
// product-readiness projection with an honest, non-fabricated `deploy`
// preflight over the prerequisites functions/api/deploy.ts itself requires:
// an active linked repository, a routable hostname/origin, R2 artifact
// storage, AWS build substrate configuration, and (live-checked, since it is
// never persisted in D1) the per-app ECR repository.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as readinessApi from '../functions/api/product-readiness';
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

  it('reports not-ready with reasons when the app has no active linked repository', async () => {
    await seedUser('usr_maker');
    await seedListing('no-repo-app', { hostname: 'no-repo-app.nates-software.com' });
    const req = new Request('http://localhost/api/product-readiness?appId=no-repo-app&deploy=1');
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
    const req = new Request('http://localhost/api/product-readiness?appId=no-hostname-app&deploy=1');
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
    const req = new Request('http://localhost/api/product-readiness?appId=no-storage-app&deploy=1');
    const res = await readinessApi.onRequestGet({ request: req, env: { DB: ctx.d1 /* no STORAGE */ } });
    const data: any = await res.json();

    expect(data.readiness.deploy.ready).toBe(false);
    expect(data.readiness.deploy.checks.storageConfigured).toBe(false);
  });

  it('reports ecrRepositoryProvisioned=null (not fabricated true/false) and not-ready when AWS credentials are absent', async () => {
    await seedUser('usr_maker');
    await seedListing('no-aws-app', { hostname: 'no-aws-app.nates-software.com' });
    await seedRepository('repo-no-aws', 'no-aws-app', 'active');
    const req = new Request('http://localhost/api/product-readiness?appId=no-aws-app&deploy=1');
    const res = await readinessApi.onRequestGet({
      request: req,
      env: { DB: ctx.d1, STORAGE: {}, AWS_CODEBUILD_DEPLOY_PROJECT: 'nsw-deploy' /* build substrate configured, but no AWS creds */ }
    });
    const data: any = await res.json();

    expect(data.readiness.deploy.checks.ecrRepositoryProvisioned).toBeNull();
    expect(data.readiness.deploy.ready).toBe(false);
    expect(data.readiness.deploy.reasons.some((r: string) => r.toLowerCase().includes('ecr'))).toBe(true);
  });

  it('is ready=true when repository, router, storage, build substrate, and ECR are all confirmed', async () => {
    await seedUser('usr_maker');
    await seedListing('all-ready-app', { hostname: 'all-ready-app.nates-software.com', originKind: 'cf_container' });
    await seedRepository('repo-all-ready', 'all-ready-app', 'active');

    // createEcrRepository ultimately calls global fetch via aws4fetch; stub it
    // to simulate ECR's idempotent RepositoryAlreadyExistsException response
    // (i.e. the repo is provisioned and reachable) so this test stays offline.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ __type: 'RepositoryAlreadyExistsException', message: 'already exists' }),
      { status: 400 }
    )) as any;
    try {
      const req = new Request('http://localhost/api/product-readiness?appId=all-ready-app&deploy=1');
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
      const req = new Request('http://localhost/api/product-readiness?appId=ecr-missing-app&deploy=1');
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
