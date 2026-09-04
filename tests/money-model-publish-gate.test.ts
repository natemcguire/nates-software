import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as dropsApi from '../functions/api/drops';
import * as createIntentApi from '../functions/api/payments/create-intent';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';


describe('D2: Prove-it publish gate — invariant pin', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function createSession(userId: string, token: string) {
    const tokenHash = await hashSessionToken(token);
    await ctx.d1.prepare(`
      INSERT OR REPLACE INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(tokenHash, userId, Date.now() + 86400000).run();
    return token;
  }

  it('publishing via POST /api/drops with a repo that has no built commit persists commerce_products.status = "draft"', async () => {
    const dropId = 'prove-it-gate-app';
    const req = new Request('http://localhost/api/drops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
      body: JSON.stringify({
        id: dropId,
        name: 'Prove It Gate App',
        tagline: 'No commit yet',
        description: 'Freshly published, no deployable revision.',
        version: 'v1.0.0',
        price: '$15.00'
      })
    });

    const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    expect(data.productStatus).toBe('draft');

    const product = await ctx.d1.prepare(
      'SELECT status FROM commerce_products WHERE app_id = ?'
    ).bind(dropId).first();
    expect(product).not.toBeNull();
    expect((product as any).status).toBe('draft');


    const repoId = data.repositoryId;
    const commit = await ctx.d1.prepare(`
      SELECT rf.commit_oid AS commitOid
      FROM repositories r
      LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
      WHERE r.id = ?
    `).bind(repoId).first();
    expect((commit as any)?.commitOid ?? null).toBeNull();
  });

  it('buy-time: create-intent rejects purchasing a "draft" product (4xx) and creates no order', async () => {
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role)
      VALUES ('usr_prove_it_buyer', 'prove_it_buyer', 'Prove It Buyer', 'user')
    `).run();
    const buyerToken = await createSession('usr_prove_it_buyer', 'tok_prove_it_buyer');


    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('prove-it-draft-app', 'Prove It Draft App', 'Draft Tagline', 'Draft Desc', 'usr_nate', 'v1.0.0', 'MIT', '$10', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, seller_user_id, price_cents, currency, status)
      VALUES ('prove-it-draft-app', 'usr_nate', 1000, 'usd', 'draft')
    `).run();

    const req = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${buyerToken}`,
        'Idempotency-Key': 'key_prove_it_draft_app'
      },
      body: JSON.stringify({ appId: 'prove-it-draft-app' })
    });

    const res = await createIntentApi.onRequestPost({
      request: req,
      env: {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_123'
      }
    });
    const data = await res.json();

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/not active/i);


    const orders = await ctx.d1.prepare(
      'SELECT id FROM commerce_orders WHERE app_id = ?'
    ).bind('prove-it-draft-app').all();
    expect(orders.results || []).toHaveLength(0);
  });

  it('NSW-48: provisioning a new repository on POST /api/drops emits a forge_outbox_events "repository.provisioning_requested" row with a payload containing storageKey', async () => {
    const dropId = 'nsw48-outbox-app';
    const req = new Request('http://localhost/api/drops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
      body: JSON.stringify({
        id: dropId,
        name: 'NSW48 Outbox App',
        tagline: 'Provisioning must emit an outbox event',
        description: 'No repositoryId given, so drops.ts provisions a fresh repository.',
        version: 'v1.0.0',
        price: '$15.00'
      })
    });

    const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.repositoryProvisioned).toBe(true);

    const repositoryId = data.repositoryId;
    expect(typeof repositoryId).toBe('string');

    const outboxRow = await ctx.d1.prepare(`
      SELECT aggregate_type AS aggregateType, aggregate_id AS aggregateId,
             event_type AS eventType, payload
      FROM forge_outbox_events
      WHERE aggregate_id = ? AND event_type = 'repository.provisioning_requested'
    `).bind(repositoryId).first();

    expect(outboxRow).not.toBeNull();
    expect((outboxRow as any).aggregateType).toBe('repository');

    const payload = JSON.parse((outboxRow as any).payload);
    expect(payload.repositoryId).toBe(repositoryId);
    expect(payload.ownerUserId).toBe('usr_nate');
    expect(typeof payload.slug).toBe('string');
    expect(payload.visibility).toBe('public');
    expect(payload.objectFormat).toBe('sha1');
    expect(payload.defaultRef).toBe('refs/heads/main');
    expect(typeof payload.storageKey).toBe('string');
    expect(payload.storageKey.length).toBeGreaterThan(0);
    expect(payload.status).toBe('provisioning');
    expect(payload.appId).toBe(dropId);

    const memberRow = await ctx.d1.prepare(`
      SELECT role FROM repository_members WHERE repository_id = ? AND user_id = 'usr_nate'
    `).bind(repositoryId).first();
    expect(memberRow).not.toBeNull();
    expect((memberRow as any).role).toBe('owner');
  });

  describe('NSW-50: prove-it gate requires real build evidence, not just a commit', () => {
    async function seedRepoWithCommit(repositoryId: string, dropId: string) {
      // repositories.app_id references app_listings(id), so a placeholder listing row
      // must exist first — the POST /api/drops below then updates it (ON CONFLICT).
      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, repository_id)
        VALUES (?, 'placeholder', 'placeholder', 'placeholder', 'usr_nate', 'v0.0.1', NULL)
      `).bind(dropId).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES (?, ?, 'usr_nate', ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(repositoryId, dropId, `${dropId}-slug`, `repositories/${repositoryId}`).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
        VALUES (?, 'refs/heads/main', ?, 1, 'usr_nate')
      `).bind(repositoryId, '1'.repeat(40)).run();
      await ctx.d1.prepare(`
        UPDATE app_listings SET repository_id = ? WHERE id = ?
      `).bind(repositoryId, dropId).run();
    }

    it('a repo with a commit but NO build evidence still publishes as commerce_products.status = "draft"', async () => {
      const dropId = 'nsw50-commit-no-evidence';
      const repositoryId = 'repo_nsw50_no_evidence';
      await seedRepoWithCommit(repositoryId, dropId);

      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: dropId,
          name: 'NSW50 Commit No Evidence',
          version: 'v1.0.0',
          price: '$15.00',
          repositoryId
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      // A commit exists, so the repo is "source_ready" — but that is NOT build evidence.
      expect(data.deploymentState).toBe('source_ready');
      expect(data.productStatus).toBe('draft');

      const product = await ctx.d1.prepare(
        'SELECT status FROM commerce_products WHERE app_id = ?'
      ).bind(dropId).first();
      expect((product as any).status).toBe('draft');
    });

    it('a repo with a commit AND a "healthy" deployment_revisions row publishes as commerce_products.status = "active"', async () => {
      const dropId = 'nsw50-commit-with-revision';
      const repositoryId = 'repo_nsw50_with_revision';
      await seedRepoWithCommit(repositoryId, dropId);

      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest)
        VALUES ('build_nsw50_1', ?, ?, 'release', 'passed', 'digest_runner', 'npm run build', 'digest_manifest')
      `).bind(repositoryId, '1'.repeat(40)).run();

      await ctx.d1.prepare(`
        INSERT INTO deployment_revisions (id, app_id, repository_id, commit_oid, build_run_id, environment, revision_number, status, runtime_config_digest, deployed_by_user_id, deployed_at)
        VALUES ('deploy_nsw50_1', ?, ?, ?, 'build_nsw50_1', 'production', 1, 'healthy', 'digest_runtime', 'usr_nate', CURRENT_TIMESTAMP)
      `).bind(dropId, repositoryId, '1'.repeat(40)).run();

      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: dropId,
          name: 'NSW50 Commit With Revision',
          version: 'v1.0.0',
          price: '$15.00',
          repositoryId
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.productStatus).toBe('active');

      const product = await ctx.d1.prepare(
        'SELECT status FROM commerce_products WHERE app_id = ?'
      ).bind(dropId).first();
      expect((product as any).status).toBe('active');
    });

    it('a repo with a commit AND an existing app_listings.deployment_state of "deployable" publishes as commerce_products.status = "active"', async () => {
      const dropId = 'nsw50-existing-deployable-listing';
      const repositoryId = 'repo_nsw50_deployable';
      await seedRepoWithCommit(repositoryId, dropId);

      await ctx.d1.prepare(`
        UPDATE app_listings SET deployment_state = 'deployable' WHERE id = ?
      `).bind(dropId).run();

      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: dropId,
          name: 'NSW50 Existing Deployable Listing',
          version: 'v1.1.0',
          price: '$15.00',
          repositoryId
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.productStatus).toBe('active');

      const product = await ctx.d1.prepare(
        'SELECT status FROM commerce_products WHERE app_id = ?'
      ).bind(dropId).first();
      expect((product as any).status).toBe('active');
    });
  });
});
