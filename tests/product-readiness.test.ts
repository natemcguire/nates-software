// Tests for GET /api/product-readiness — the single authoritative,
// server-computed projection of whether an app is genuinely
// buyable/forkable/deployable. Must never fabricate readiness: every field
// is a direct read of an existing row, and 'overall' fails closed.

import { describe, it, expect, beforeEach } from 'vitest';
import * as readinessApi from '../functions/api/product-readiness';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

describe('GET /api/product-readiness', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  async function seedUser(id: string) {
    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name)
      VALUES (?, ?, ?)
    `).bind(id, id, id).run();
  }

  async function seedListing(appId: string, opts: {
    deploymentState?: string;
    hostname?: string | null;
  } = {}) {
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state, hostname)
      VALUES (?, ?, 'Tagline', 'Desc', 'usr_maker', 'v1.0.0', 'MIT', '$15.00', '/data', '[]', '[]', '{}', ?, ?)
    `).bind(appId, appId, opts.deploymentState || 'draft', opts.hostname ?? null).run();
  }

  async function seedRepository(repoId: string, appId: string, status = 'active') {
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
      VALUES (?, ?, 'usr_maker', ?, ?, ?)
    `).bind(repoId, appId, appId, `key_${repoId}`, status).run();
  }

  async function seedProduct(appId: string, opts: { repositoryId?: string | null; status?: string; priceCents?: number } = {}) {
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status)
      VALUES (?, ?, 'usr_maker', ?, 'usd', ?)
    `).bind(appId, opts.repositoryId ?? null, opts.priceCents ?? 1500, opts.status || 'active').run();
  }

  function envFor() {
    return { DB: ctx.d1 };
  }

  it('returns "unavailable" for a completely missing app (no listing row at all)', async () => {
    const req = new Request('http://localhost/api/product-readiness?appId=ghost-app');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.readiness.overall).toBe('unavailable');
    expect(data.readiness.listing.exists).toBe(false);
    expect(data.readiness.product.exists).toBe(false);
    expect(data.readiness.repository.exists).toBe(false);
    expect(data.readiness.deployment.active).toBe(false);
  });

  it('returns "draft" for a listing with no active product and no active repository', async () => {
    await seedUser('usr_maker');
    await seedListing('draft-app');

    const req = new Request('http://localhost/api/product-readiness?appId=draft-app');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.readiness.overall).toBe('draft');
    expect(data.readiness.listing.exists).toBe(true);
    expect(data.readiness.product.exists).toBe(false);
  });

  it('returns "forkable" for a listing with an active linked repository but no active product', async () => {
    await seedUser('usr_maker');
    await seedListing('fork-only-app');
    await seedRepository('repo-fork-only', 'fork-only-app', 'active');

    const req = new Request('http://localhost/api/product-readiness?appId=fork-only-app');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(data.readiness.overall).toBe('forkable');
    expect(data.readiness.repository.exists).toBe(true);
    expect(data.readiness.repository.active).toBe(true);
    expect(data.readiness.product.exists).toBe(false);
  });

  it('does not report "forkable" when the linked repository is not active', async () => {
    await seedUser('usr_maker');
    await seedListing('quarantined-repo-app');
    await seedRepository('repo-quarantined', 'quarantined-repo-app', 'quarantined');

    const req = new Request('http://localhost/api/product-readiness?appId=quarantined-repo-app');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(data.readiness.overall).toBe('draft');
    expect(data.readiness.repository.exists).toBe(true);
    expect(data.readiness.repository.active).toBe(false);
  });

  it('returns "buyable" for an app with an active product + listing, independent of repository/deployment', async () => {
    await seedUser('usr_maker');
    await seedListing('buyable-app');
    await seedProduct('buyable-app', { priceCents: 2000 });

    const req = new Request('http://localhost/api/product-readiness?appId=buyable-app');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(data.readiness.overall).toBe('buyable');
    expect(data.readiness.product.exists).toBe(true);
    expect(data.readiness.product.active).toBe(true);
    expect(data.readiness.product.priceCents).toBe(2000);
    expect(data.readiness.product.currency).toBe('usd');
  });

  it('does not report "buyable" when the product exists but is not active (e.g. draft/suspended)', async () => {
    await seedUser('usr_maker');
    await seedListing('suspended-app');
    await seedProduct('suspended-app', { status: 'suspended' });

    const req = new Request('http://localhost/api/product-readiness?appId=suspended-app');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(data.readiness.overall).not.toBe('buyable');
    expect(data.readiness.product.exists).toBe(true);
    expect(data.readiness.product.active).toBe(false);
  });

  it('reports deployment.active=true only when deployment_state=active AND hostname is set', async () => {
    await seedUser('usr_maker');
    await seedListing('live-app', { deploymentState: 'active', hostname: 'live-app.nates-software.com' });
    await seedRepository('repo-live', 'live-app', 'active');
    await seedProduct('live-app', { repositoryId: 'repo-live' });

    const req = new Request('http://localhost/api/product-readiness?appId=live-app');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(data.readiness.overall).toBe('buyable');
    expect(data.readiness.deployment.active).toBe(true);
    expect(data.readiness.deployment.hostname).toBe('live-app.nates-software.com');
    expect(data.readiness.deployment.deploymentState).toBe('active');
  });

  it('never fabricates deployment.active=true from a hostname alone (fail-closed)', async () => {
    await seedUser('usr_maker');
    // hostname is backfilled/present but deployment_state never left draft —
    // e.g. a catalog placeholder that has a routing label but nothing built.
    await seedListing('fake-live-app', { deploymentState: 'draft', hostname: 'fake-live-app' });

    const req = new Request('http://localhost/api/product-readiness?appId=fake-live-app');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(data.readiness.deployment.active).toBe(false);
    expect(data.readiness.deployment.hostname).toBeNull();
  });

  it('a fully-equipped app (product+listing+repo+deployment) reads "buyable" — the honest all-green case', async () => {
    await seedUser('usr_maker');
    await seedListing('complete-app', { deploymentState: 'active', hostname: 'complete-app.nates-software.com' });
    await seedRepository('repo-complete', 'complete-app', 'active');
    await seedProduct('complete-app', { repositoryId: 'repo-complete', priceCents: 999 });

    const req = new Request('http://localhost/api/product-readiness?appId=complete-app');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(data.readiness).toEqual({
      appId: 'complete-app',
      product: { exists: true, active: true, priceCents: 999, currency: 'usd' },
      listing: { exists: true, name: 'complete-app' },
      repository: { exists: true, active: true, id: 'repo-complete' },
      deployment: { active: true, hostname: 'complete-app.nates-software.com', deploymentState: 'active' },
      overall: 'buyable'
    });
  });

  it('with no appId, returns a readiness array covering every app in the catalog (includes seeded dronehunter)', async () => {
    const req = new Request('http://localhost/api/product-readiness');
    const res = await readinessApi.onRequestGet({ request: req, env: envFor() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.readiness)).toBe(true);
    expect(data.readiness.length).toBeGreaterThan(0);

    const dronehunter = data.readiness.find((r: any) => r.appId === 'dronehunter');
    expect(dronehunter).toBeTruthy();
    // dronehunter ships an active commerce_products row with no linked repository in the base schema
    expect(dronehunter.overall).toBe('buyable');
    expect(dronehunter.product.active).toBe(true);
  });

  it('returns 503 when DB binding is unavailable', async () => {
    const req = new Request('http://localhost/api/product-readiness?appId=anything');
    const res = await readinessApi.onRequestGet({ request: req, env: {} });
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.success).toBe(false);
  });

  it('rejects POST with 405', async () => {
    const res = await readinessApi.onRequestPost();
    expect(res.status).toBe(405);
  });
});
