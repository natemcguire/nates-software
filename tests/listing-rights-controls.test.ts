import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dropsApi from '../functions/api/drops';
import * as forkApi from '../functions/api/fork';
import * as gitApi from '../functions/api/git';
import * as repoTreeApi from '../functions/api/repo-tree';
import * as repoFileApi from '../functions/api/repo-file';
import * as createIntentApi from '../functions/api/payments/create-intent';
import * as orderApi from '../functions/api/payments/orders/[id]';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashSessionToken } from '../functions/api/_session';

describe('NSW-120 listing resale controls', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  async function seedForkLineage(resaleEnabled: boolean) {
    const parentAppId = resaleEnabled ? 'resale-parent-on' : 'resale-parent-off';
    const parentRepositoryId = resaleEnabled ? 'repo_resale_parent_on' : 'repo_resale_parent_off';
    const childRepositoryId = resaleEnabled ? 'repo_resale_child_on' : 'repo_resale_child_off';

    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, repository_id)
      VALUES (?, ?, 'Parent', 'Parent app', 'usr_sam', 'v1.0.0', NULL)
    `).bind(parentAppId, parentAppId).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, ?, 'usr_sam', ?, 'public', 'refs/heads/main', ?, 'active')
    `).bind(parentRepositoryId, parentAppId, parentAppId, `repositories/${parentRepositoryId}`).run();
    await ctx.d1.prepare('UPDATE app_listings SET repository_id = ? WHERE id = ?')
      .bind(parentRepositoryId, parentAppId).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (
        app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps, resale_enabled
      ) VALUES (?, ?, 'usr_sam', 1500, 'usd', 'active', 500, ?)
    `).bind(parentAppId, parentRepositoryId, resaleEnabled ? 1 : 0).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, 'usr_nate', ?, 'public', 'refs/heads/main', ?, 'active')
    `).bind(childRepositoryId, `${parentAppId}-fork`, `repositories/${childRepositoryId}`).run();
    await ctx.d1.prepare(`
      INSERT INTO repository_forks (
        child_repository_id, parent_repository_id, forked_by_user_id, parent_ref_name,
        parent_commit_oid, child_initial_commit_oid, lineage_root_repository_id, depth
      ) VALUES (?, ?, 'usr_nate', 'refs/heads/main', ?, ?, ?, 1)
    `).bind(childRepositoryId, parentRepositoryId, 'a'.repeat(40), 'a'.repeat(40), parentRepositoryId).run();

    return { childRepositoryId };
  }

  async function publishFork(appId: string, repositoryId: string) {
    const request = new Request('http://localhost/api/drops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
      body: JSON.stringify({
        id: appId,
        name: appId,
        version: 'v1.0.0',
        price: '$20.00',
        repositoryId
      })
    });
    return dropsApi.onRequestPost({ request, env: { DB: ctx.d1 } });
  }

  it('defaults resale_enabled to true', async () => {
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, seller_user_id, price_cents, currency, status)
      VALUES ('dronehunter', 'usr_nate', 1500, 'usd', 'draft')
      ON CONFLICT(app_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `).run();

    const product = await ctx.d1.prepare(
      'SELECT resale_enabled AS resaleEnabled FROM commerce_products WHERE app_id = ?'
    ).bind('dronehunter').first();

    expect((product as any).resaleEnabled).toBe(1);
  });

  it('rejects commercial publication of a fork whose ancestor disabled resale', async () => {
    const { childRepositoryId } = await seedForkLineage(false);
    const response = await publishFork('blocked-resale-fork', childRepositoryId);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
    expect(await ctx.d1.prepare('SELECT id FROM app_listings WHERE id = ?').bind('blocked-resale-fork').first()).toBeNull();
  });

  it('rejects commercial publication from a parentless repository with the same commit as a resale-disabled app', async () => {
    await seedForkLineage(false);
    const parentCommitOid = 'a'.repeat(40);
    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
      VALUES ('repo_resale_parent_off', 'refs/heads/main', ?, 1, 'usr_sam')
    `).bind(parentCommitOid).run();
    const clonedRepositoryId = 'repo_parentless_clone';
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, 'usr_nate', 'parentless-clone', 'public', 'refs/heads/main', ?, 'active')
    `).bind(clonedRepositoryId, `repositories/${clonedRepositoryId}`).run();
    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
      VALUES (?, 'refs/heads/main', ?, 1, 'usr_nate')
    `).bind(clonedRepositoryId, parentCommitOid).run();

    const response = await publishFork('blocked-parentless-clone', clonedRepositoryId);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
    expect(await ctx.d1.prepare('SELECT id FROM app_listings WHERE id = ?').bind('blocked-parentless-clone').first()).toBeNull();
  });

  it('rejects a modified clone when the gateway finds a resale-disabled commit in its object set', async () => {
    await seedForkLineage(false);
    const parentCommitOid = 'a'.repeat(40);
    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
      VALUES ('repo_resale_parent_off', 'refs/heads/main', ?, 1, 'usr_sam')
    `).bind(parentCommitOid).run();
    const clonedRepositoryId = 'repo_modified_clone';
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, 'usr_nate', 'modified-clone', 'public', 'refs/heads/main', ?, 'active')
    `).bind(clonedRepositoryId, `repositories/${clonedRepositoryId}`).run();
    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
      VALUES (?, 'refs/heads/main', ?, 1, 'usr_nate')
    `).bind(clonedRepositoryId, 'b'.repeat(40)).run();
    const gatewayFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      matchedCommitOid: parentCommitOid
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const request = new Request('http://localhost/api/drops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
      body: JSON.stringify({
        id: 'blocked-modified-clone',
        name: 'blocked-modified-clone',
        version: 'v1.0.0',
        price: '$20.00',
        repositoryId: clonedRepositoryId
      })
    });
    const response = await dropsApi.onRequestPost({
      request,
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_TOKEN: 'gateway-token',
        GITSMITH_GATEWAY_FETCH: gatewayFetch
      }
    });

    expect(response.status).toBe(403);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('allows commercial publication of a fork whose ancestors allow resale', async () => {
    const { childRepositoryId } = await seedForkLineage(true);
    const response = await publishFork('allowed-resale-fork', childRepositoryId);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    const product = await ctx.d1.prepare(
      'SELECT resale_enabled AS resaleEnabled FROM commerce_products WHERE app_id = ?'
    ).bind('allowed-resale-fork').first();
    expect((product as any).resaleEnabled).toBe(1);
  });

  it('refuses checkout after an ancestor disables resale', async () => {
    const { childRepositoryId } = await seedForkLineage(true);
    const childAppId = 'retroactive-resale-child';
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, repository_id)
      VALUES (?, 'Retroactive Child', 'Child', 'Child app', 'usr_nate', 'v1.0.0', NULL)
    `).bind(childAppId).run();
    await ctx.d1.prepare('UPDATE repositories SET app_id = ? WHERE id = ?')
      .bind(childAppId, childRepositoryId).run();
    await ctx.d1.prepare('UPDATE app_listings SET repository_id = ? WHERE id = ?')
      .bind(childRepositoryId, childAppId).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (
        app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps, resale_enabled
      ) VALUES (?, ?, 'usr_nate', 2000, 'usd', 'active', 500, 1)
    `).bind(childAppId, childRepositoryId).run();
    await ctx.d1.prepare(`
      UPDATE commerce_products SET resale_enabled = 0 WHERE app_id = 'resale-parent-on'
    `).run();
    const request = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_test_token',
        'Idempotency-Key': 'retroactive-resale-block'
      },
      body: JSON.stringify({ appId: childAppId })
    });
    const response = await createIntentApi.onRequestPost({
      request,
      env: {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_resale_block',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_resale_block'
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
    expect(await ctx.d1.prepare('SELECT id FROM commerce_orders WHERE app_id = ?').bind(childAppId).first()).toBeNull();
  });
});

describe('NSW-127 private-source listing controls', () => {
  let ctx: TestD1Context;
  const originalFetch = globalThis.fetch;
  const appId = 'private-source-app';
  const repositoryId = 'repo_private_source_app';
  const commitOid = 'c'.repeat(40);

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, repository_id, binaries)
      VALUES (?, 'Private Source App', 'Private', 'Private app', 'usr_nate', 'v1.0.0', NULL, ?)
    `).bind(appId, JSON.stringify({ web: 'https://app.example', source: 'https://source.example/archive.tar.gz' })).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, ?, 'usr_nate', 'private-source-app', 'public', 'refs/heads/main', ?, 'active')
    `).bind(repositoryId, appId, `repositories/${repositoryId}`).run();
    await ctx.d1.prepare('UPDATE app_listings SET repository_id = ? WHERE id = ?')
      .bind(repositoryId, appId).run();
    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
      VALUES (?, 'refs/heads/main', ?, 1, 'usr_nate')
    `).bind(repositoryId, commitOid).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (
        app_id, repository_id, seller_user_id, price_cents, currency, status,
        royalty_bps, resale_enabled, forking_enabled
      ) VALUES (?, ?, 'usr_nate', 2500, 'usd', 'active', 0, 1, 0)
    `).bind(appId, repositoryId).run();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('defaults forking_enabled to true', async () => {
    const product = await ctx.d1.prepare(
      'SELECT forking_enabled AS forkingEnabled FROM commerce_products WHERE app_id = ?'
    ).bind('dronehunter').first();
    expect((product as any).forkingEnabled).toBe(1);
  });

  it('refuses a fork request without creating a child repository', async () => {
    const request = new Request('http://localhost/api/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
      body: JSON.stringify({ appId, childSlug: 'private-source-child' })
    });
    const response = await forkApi.onRequestPost({
      request,
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_FETCH: vi.fn().mockResolvedValue(new Response(JSON.stringify({
          ready: true,
          configured: true,
          active: true,
          checks: {
            git: { available: true },
            storage: { writable: true },
            controlPlane: { reachable: true },
            dispatcher: { running: true },
            transport: { configured: true, active: true }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
    expect(await ctx.d1.prepare('SELECT id FROM repositories WHERE slug = ?').bind('private-source-child').first()).toBeNull();
  });

  it('feeds private rights to the catalog without exposing source artifacts', async () => {
    const response = await dropsApi.onRequestGet({
      request: new Request('http://localhost/api/drops?sort=alltime'),
      env: { DB: ctx.d1 }
    });
    const payload = await response.json();
    const listing = payload.drops.find((drop: any) => drop.id === appId);

    expect(response.status).toBe(200);
    expect(listing.forkingEnabled).toBe(false);
    expect(listing.resaleEnabled).toBe(true);
    expect(listing.binaries.web).toBe('https://app.example');
    expect(listing.binaries).not.toHaveProperty('source');
  });

  it('refuses repository tree access before contacting storage', async () => {
    const gatewayFetch = vi.fn();
    const request = new Request(`http://localhost/api/repo-tree?repoId=${repositoryId}`);
    const response = await repoTreeApi.onRequestGet({
      request,
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_TOKEN: 'test-token',
        __GITSMITH_GATEWAY_FETCH: gatewayFetch
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('refuses repository file access before contacting storage', async () => {
    const gatewayFetch = vi.fn();
    const request = new Request(`http://localhost/api/repo-file?repoId=${repositoryId}&path=src/index.ts`);
    const response = await repoFileApi.onRequestGet({
      request,
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_TOKEN: 'test-token',
        __GITSMITH_GATEWAY_FETCH: gatewayFetch
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('fails closed when an app-linked repository commerce join is missing', async () => {
    await ctx.d1.prepare('DELETE FROM commerce_products WHERE app_id = ?').bind(appId).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, repository_id, seller_user_id,
        app_version, price_version, gross_cents, currency, lineage_snapshot_json, status
      ) VALUES ('ord_missing_product_evidence', 'missing-product-evidence', 'usr_josh', ?, ?, 'usr_nate',
        'v1.0.0', 1, 2500, 'usd', '{}', 'fulfilled')
    `).bind(appId, repositoryId).run();
    const gatewayFetch = vi.fn();
    const treeResponse = await repoTreeApi.onRequestGet({
      request: new Request(`http://localhost/api/repo-tree?repoId=${repositoryId}`),
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_TOKEN: 'test-token',
        __GITSMITH_GATEWAY_FETCH: gatewayFetch
      }
    });
    const fileResponse = await repoFileApi.onRequestGet({
      request: new Request(`http://localhost/api/repo-file?repoId=${repositoryId}&path=src/index.ts`),
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_TOKEN: 'test-token',
        __GITSMITH_GATEWAY_FETCH: gatewayFetch
      }
    });
    const catalogResponse = await dropsApi.onRequestGet({
      request: new Request('http://localhost/api/drops?sort=alltime'),
      env: { DB: ctx.d1 }
    });
    const catalog = await catalogResponse.json();
    const listing = catalog.drops.find((drop: any) => drop.id === appId);
    const forkResponse = await forkApi.onRequestPost({
      request: new Request('http://localhost/api/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({ appId, childSlug: 'missing-product-child' })
      }),
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_FETCH: vi.fn()
      }
    });

    expect(treeResponse.status).toBe(403);
    expect(fileResponse.status).toBe(403);
    expect(forkResponse.status).toBe(403);
    expect(gatewayFetch).not.toHaveBeenCalled();
    expect(listing.forkingEnabled).toBe(false);
    expect(listing.binaries).not.toHaveProperty('source');
  });

  it('fails closed when multiple apps claim the same repository', async () => {
    await ctx.d1.prepare('UPDATE commerce_products SET forking_enabled = 1 WHERE app_id = ?').bind(appId).run();
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, repository_id)
      VALUES ('ambiguous-source-link', 'Ambiguous Source Link', 'Ambiguous', 'Ambiguous app', 'usr_nate', 'v1.0.0', ?)
    `).bind(repositoryId).run();
    const response = await repoTreeApi.onRequestGet({
      request: new Request(`http://localhost/api/repo-tree?repoId=${repositoryId}`),
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_TOKEN: 'test-token',
        __GITSMITH_GATEWAY_FETCH: vi.fn()
      }
    });

    expect(response.status).toBe(403);
  });

  it('fails closed when a product points at a different repository', async () => {
    const otherRepositoryId = 'repo_private_source_mismatch';
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, 'usr_nate', 'private-source-mismatch', 'public', 'refs/heads/main', ?, 'active')
    `).bind(otherRepositoryId, `repositories/${otherRepositoryId}`).run();
    await ctx.d1.prepare('UPDATE commerce_products SET repository_id = ? WHERE app_id = ?')
      .bind(otherRepositoryId, appId).run();
    const response = await repoTreeApi.onRequestGet({
      request: new Request(`http://localhost/api/repo-tree?repoId=${repositoryId}`),
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_TOKEN: 'test-token',
        __GITSMITH_GATEWAY_FETCH: vi.fn()
      }
    });
    const catalogResponse = await dropsApi.onRequestGet({
      request: new Request('http://localhost/api/drops?sort=alltime'),
      env: { DB: ctx.d1 }
    });
    const catalog = await catalogResponse.json();
    const listing = catalog.drops.find((drop: any) => drop.id === appId);

    expect(response.status).toBe(403);
    expect(listing.forkingEnabled).toBe(false);
    expect(listing.binaries).not.toHaveProperty('source');
  });

  it('refuses direct diff reads for private-source repositories', async () => {
    const response = await gitApi.onRequestGet({
      request: new Request(`http://localhost/api/git?action=diff&repositoryId=${repositoryId}&base=${'a'.repeat(40)}&head=${commitOid}`),
      env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: '/tmp/does-not-need-to-exist' }
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
  });

  it('keeps a repository with no app or product linkage publicly readable', async () => {
    const unlinkedRepositoryId = 'repo_unlinked_public';
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, 'usr_nate', 'unlinked-public', 'public', 'refs/heads/main', ?, 'active')
    `).bind(unlinkedRepositoryId, `repositories/${unlinkedRepositoryId}`).run();
    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
      VALUES (?, 'refs/heads/main', ?, 1, 'usr_nate')
    `).bind(unlinkedRepositoryId, 'd'.repeat(40)).run();
    const gatewayFetch = vi.fn().mockResolvedValue(Response.json({
      success: true,
      exists: true,
      files: ['README.md']
    }));
    const response = await repoTreeApi.onRequestGet({
      request: new Request(`http://localhost/api/repo-tree?repoId=${unlinkedRepositoryId}`),
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example',
        GITSMITH_GATEWAY_TOKEN: 'test-token',
        __GITSMITH_GATEWAY_FETCH: gatewayFetch
      }
    });

    expect(response.status).toBe(200);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses Git source reads by non-members', async () => {
    const keyType = 'ssh-ed25519';
    const keyBase64 = 'AAAAC3NzaC1lZDI1NTE5AAAAIPrivateReaderKey123456789012345678901';
    await ctx.d1.prepare(`
      INSERT INTO user_ssh_keys (id, user_id, key_type, key_base64, key_prefix, label)
      VALUES ('key_private_reader', 'usr_josh', ?, ?, ?, 'private-reader')
    `).bind(keyType, keyBase64, `${keyType} ${keyBase64}`).run();

    const request = new Request('http://localhost/api/git', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer gateway-private-source-token'
      },
      body: JSON.stringify({
        action: 'gateway-authorize-ssh',
        keyType,
        keyBase64,
        owner: 'nate',
        slug: 'private-source-app',
        operation: 'read'
      })
    });
    const response = await gitApi.onRequestPost({
      request,
      env: { DB: ctx.d1, GITSMITH_GATEWAY_TOKEN: 'gateway-private-source-token' }
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
  });

  it('keeps a private-source product buyable', async () => {
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role)
      VALUES ('usr_private_buyer', 'private_buyer', 'Private Buyer', 'user')
    `).run();
    const token = 'token_private_buyer';
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, 'usr_private_buyer', ?)
    `).bind(await hashSessionToken(token), Date.now() + 86_400_000).run();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'pi_private_source_buy',
      client_secret: 'pi_private_source_buy_secret'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const request = new Request('http://localhost/api/payments/create-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': 'private-source-buy-key'
      },
      body: JSON.stringify({ appId })
    });
    const response = await createIntentApi.onRequestPost({
      request,
      env: {
        DB: ctx.d1,
        PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_private_source',
        STRIPE_PUBLISHABLE_KEY: 'pk_test_private_source'
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(await ctx.d1.prepare('SELECT id FROM commerce_orders WHERE app_id = ?').bind(appId).first()).not.toBeNull();

    const orderResponse = await orderApi.onRequestGet({
      request: new Request(`http://localhost/api/payments/orders/${payload.orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      }),
      env: { DB: ctx.d1 },
      params: { id: payload.orderId }
    });
    const orderPayload = await orderResponse.json();

    expect(orderResponse.status).toBe(200);
    expect(orderPayload.order.binaries.web).toBe('https://app.example/');
    expect(orderPayload.order.binaries).not.toHaveProperty('source');
  });
});
