import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dropsApi from '../functions/api/drops';
import * as createIntentApi from '../functions/api/payments/create-intent';
import * as orderApi from '../functions/api/payments/orders/[id]';
import * as shelfApi from '../functions/api/shelf';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';

describe('NSW-140 immutable commerce releases', () => {
  let ctx: TestD1Context;
  const appId = 'nsw140-release-app';
  const repositoryId = 'repo_nsw140_release_app';
  const commitA = 'a'.repeat(40);
  const commitB = 'b'.repeat(40);

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role)
      VALUES ('usr_nsw140_buyer', 'nsw140_buyer', 'NSW 140 Buyer', 'user')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO stripe_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_status)
      VALUES ('usr_nate', 'acct_nsw140', 1, 1, 'active')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, repository_id, binaries)
      VALUES (?, 'Release App', 'Original tagline', 'Release binding', 'usr_nate', 'v0.1.0', NULL, '{}')
    `).bind(appId).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, ?, 'usr_nate', 'nsw140-release-app', 'public', 'refs/heads/main', ?, 'active')
    `).bind(repositoryId, appId, `repositories/${repositoryId}`).run();
    await ctx.d1.prepare('UPDATE app_listings SET repository_id = ? WHERE id = ?')
      .bind(repositoryId, appId).run();
  });

  async function createSession(userId: string, token: string) {
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(await hashSessionToken(token), userId, Date.now() + 86_400_000).run();
  }

  async function setHead(commitOid: string, version = 1) {
    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
      VALUES (?, 'refs/heads/main', ?, ?, 'usr_nate')
      ON CONFLICT(repository_id, ref_name) DO UPDATE SET
        commit_oid = excluded.commit_oid,
        version = excluded.version,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = CURRENT_TIMESTAMP
    `).bind(repositoryId, commitOid, version).run();
  }

  async function seedHealthyRevision(commitOid: string, suffix: string) {
    const buildRunId = `build_nsw140_${suffix}`;
    const deploymentRevisionId = `deploy_nsw140_${suffix}`;
    await ctx.d1.prepare(`
      INSERT INTO build_runs (
        id, repository_id, commit_oid, purpose, status, runner_image_digest,
        build_command, source_manifest_digest, result_digest
      ) VALUES (?, ?, ?, 'release', 'passed', 'sha256:runner', 'npm run build', 'sha256:source', ?)
    `).bind(buildRunId, repositoryId, commitOid, `sha256:${suffix.padEnd(64, suffix[0])}`).run();
    await ctx.d1.prepare(`
      INSERT INTO build_artifacts (
        id, build_run_id, kind, r2_key, sha256, media_type, size_bytes
      ) VALUES (?, ?, 'bundle', ?, ?, 'application/x-tar', 1024)
    `).bind(`artifact_nsw140_${suffix}`, buildRunId, `apps/${appId}/${suffix}`, `sha256:${suffix.padEnd(64, suffix[0])}`).run();
    await ctx.d1.prepare(`
      INSERT INTO deployment_revisions (
        id, app_id, repository_id, commit_oid, build_run_id, environment,
        revision_number, status, url, runtime_config_digest, deployed_by_user_id, deployed_at
      ) VALUES (?, ?, ?, ?, ?, 'production', ?, 'healthy', ?, ?, 'usr_nate', CURRENT_TIMESTAMP)
    `).bind(
      deploymentRevisionId,
      appId,
      repositoryId,
      commitOid,
      buildRunId,
      suffix === 'a' ? 1 : 2,
      `https://${suffix}.example`,
      `sha256:${suffix.padEnd(64, suffix[0])}`
    ).run();
    return { buildRunId, deploymentRevisionId };
  }

  async function publish(version: string, forkingEnabled: boolean, resaleEnabled: boolean) {
    return dropsApi.onRequestPost({
      request: new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: appId,
          name: 'Release App',
          tagline: 'Original tagline',
          version,
          price: '$25.00',
          repositoryId,
          forkingEnabled,
          resaleEnabled,
          binaries: {
            web: 'https://v1.example/app',
            source: 'https://v1.example/source.tar.gz'
          }
        })
      }),
      env: { DB: ctx.d1 }
    });
  }

  it('keeps a listing draft when the healthy revision does not match the current head', async () => {
    await setHead(commitB);
    await seedHealthyRevision(commitA, 'a');

    const response = await publish('v1.0.0', true, true);
    const payload = await response.json();
    const product: any = await ctx.d1.prepare(`
      SELECT status, release_id AS releaseId FROM commerce_products WHERE app_id = ?
    `).bind(appId).first();

    expect(response.status).toBe(200);
    expect(payload.productStatus).toBe('draft');
    expect(payload.releaseId).toBeNull();
    expect(product).toEqual({ status: 'draft', releaseId: null });
    expect(await ctx.d1.prepare('SELECT id FROM commerce_releases WHERE app_id = ?').bind(appId).first()).toBeNull();
  });

  it('binds checkout and shelf delivery to the original release after head and rights changes', async () => {
    await setHead(commitA);
    const evidence = await seedHealthyRevision(commitA, 'a');
    const publishResponse = await publish('v1.0.0', true, true);
    const published = await publishResponse.json();

    expect(published.productStatus).toBe('active');
    expect(typeof published.releaseId).toBe('string');

    const release: any = await ctx.d1.prepare('SELECT * FROM commerce_releases WHERE id = ?')
      .bind(published.releaseId).first();
    expect(release.commit_oid).toBe(commitA);
    expect(release.deployment_revision_id).toBe(evidence.deploymentRevisionId);
    expect(release.build_run_id).toBe(evidence.buildRunId);
    expect(JSON.parse(release.artifact_manifest_json).artifacts[0].sha256).toMatch(/^sha256:/);
    await expect(ctx.d1.prepare('UPDATE commerce_releases SET version = ? WHERE id = ?')
      .bind('v9.0.0', published.releaseId).run()).rejects.toThrow(/commerce releases are immutable/);

    const buyerToken = 'nsw140_buyer_token';
    await createSession('usr_nsw140_buyer', buyerToken);
    const checkoutResponse = await createIntentApi.onRequestPost({
      request: new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${buyerToken}`,
          'Idempotency-Key': 'nsw140-order'
        },
        body: JSON.stringify({ appId })
      }),
      env: {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_nsw140',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_nsw140'
      },
      stripeFetchOverride: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        id: 'pi_nsw140',
        client_secret: 'pi_nsw140_secret'
      }), { status: 200 }))
    });
    const checkout = await checkoutResponse.json();
    expect(checkoutResponse.status).toBe(200);

    const order: any = await ctx.d1.prepare('SELECT release_id AS releaseId FROM commerce_orders WHERE id = ?')
      .bind(checkout.orderId).first();
    expect(order.releaseId).toBe(published.releaseId);

    await ctx.d1.prepare("UPDATE commerce_orders SET status = 'fulfilled' WHERE id = ?")
      .bind(checkout.orderId).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_licenses (
        id, order_id, app_id, owner_user_id, release_id,
        license_key_hash, license_key_last4, status
      ) VALUES ('lic_nsw140', ?, ?, 'usr_nsw140_buyer', ?, ?, '140A', 'active')
    `).bind(checkout.orderId, appId, published.releaseId, '1'.repeat(64)).run();
    const license: any = await ctx.d1.prepare('SELECT release_id AS releaseId FROM commerce_licenses WHERE id = ?')
      .bind('lic_nsw140').first();
    expect(license.releaseId).toBe(published.releaseId);

    await setHead(commitB, 2);
    await ctx.d1.prepare(`
      UPDATE app_listings SET version = 'v2.0.0', binaries = ? WHERE id = ?
    `).bind(JSON.stringify({ web: 'https://v2.example/app' }), appId).run();
    await ctx.d1.prepare(`
      UPDATE commerce_products SET forking_enabled = 0, resale_enabled = 0 WHERE app_id = ?
    `).bind(appId).run();
    await ctx.d1.prepare("UPDATE repositories SET visibility = 'private' WHERE id = ?")
      .bind(repositoryId).run();

    const orderResponse = await orderApi.onRequestGet({
      request: new Request(`http://localhost/api/payments/orders/${checkout.orderId}`, {
        headers: { Authorization: `Bearer ${buyerToken}` }
      }),
      env: { DB: ctx.d1 },
      params: { id: checkout.orderId }
    });
    const orderPayload = await orderResponse.json();
    expect(orderPayload.order.appVersion).toBe('v1.0.0');
    expect(orderPayload.order.binaries).toEqual({
      web: 'https://v1.example/app',
      source: 'https://v1.example/source.tar.gz'
    });
    expect(orderPayload.order.release).toMatchObject({
      id: published.releaseId,
      commitOid: commitA,
      version: 'v1.0.0',
      forkingEnabled: true,
      resaleEnabled: true,
      visibility: 'public'
    });

    const shelfResponse = await shelfApi.onRequestGet({
      request: new Request('http://localhost/api/shelf', {
        headers: { Authorization: `Bearer ${buyerToken}` }
      }),
      env: { DB: ctx.d1 }
    });
    const shelfPayload = await shelfResponse.json();
    expect(shelfPayload.shelf[0].version).toBe('v1.0.0');
    expect(shelfPayload.shelf[0].binaries).toEqual({
      web: 'https://v1.example/app',
      source: 'https://v1.example/source.tar.gz'
    });
    expect(shelfPayload.shelf[0].release).toMatchObject({
      id: published.releaseId,
      commitOid: commitA,
      forkingEnabled: true,
      resaleEnabled: true,
      visibility: 'public'
    });
  });

  it('resolves legacy orders and licenses with no release id', async () => {
    const buyerToken = 'nsw140_legacy_token';
    await createSession('usr_nsw140_buyer', buyerToken);
    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, seller_user_id,
        app_version, price_version, gross_cents, currency, lineage_snapshot_json, status
      ) VALUES (
        'ord_nsw140_legacy', 'nsw140-legacy', 'usr_nsw140_buyer', 'dronehunter', 'usr_nate',
        'v1.0.0', 1, 1500, 'usd', '{}', 'fulfilled'
      )
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_licenses (
        id, order_id, app_id, owner_user_id, license_key_hash, license_key_last4, status
      ) VALUES (
        'lic_nsw140_legacy', 'ord_nsw140_legacy', 'dronehunter', 'usr_nsw140_buyer', ?, '140L', 'active'
      )
    `).bind('2'.repeat(64)).run();

    const orderResponse = await orderApi.onRequestGet({
      request: new Request('http://localhost/api/payments/orders/ord_nsw140_legacy', {
        headers: { Authorization: `Bearer ${buyerToken}` }
      }),
      env: { DB: ctx.d1 },
      params: { id: 'ord_nsw140_legacy' }
    });
    const orderPayload = await orderResponse.json();
    expect(orderResponse.status).toBe(200);
    expect(orderPayload.order.release).toBeNull();
    expect(orderPayload.order.appVersion).toBe('v1.0.0');

    const shelfResponse = await shelfApi.onRequestGet({
      request: new Request('http://localhost/api/shelf', {
        headers: { Authorization: `Bearer ${buyerToken}` }
      }),
      env: { DB: ctx.d1 }
    });
    const shelfPayload = await shelfResponse.json();
    expect(shelfResponse.status).toBe(200);
    expect(shelfPayload.shelf[0].release).toBeNull();
    expect(shelfPayload.shelf[0].version).toBe('v1.0.0');
  });
});
