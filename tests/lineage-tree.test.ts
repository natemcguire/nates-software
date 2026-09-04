import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { fetchLineageTree, resolveLineageRoot, resolveRepositoryIdForApp } from '../src/lib/lineageDomain';

describe('Lineage tree read model (fetchLineageTree)', () => {
  let ctx: TestD1Context;

  const oid = (c: string) => c.repeat(40);

  async function user(id: string, username: string) {
    await ctx.d1
      .prepare(
        `INSERT OR IGNORE INTO users (id, username, display_name, password_hash, salt, role)
         VALUES (?, ?, ?, 'h', 's', 'maker')`
      )
      .bind(id, username, username)
      .run();
  }

  async function appAndRepo(appId: string, repoId: string, ownerId: string) {
    await ctx.d1
      .prepare(
        `INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
         VALUES (?, ?, 'T', 'D', ?, 'v1', 'MIT', '$0.00', '/data', '[]', '[]', '{}')`
      )
      .bind(appId, appId, ownerId)
      .run();
    await ctx.d1
      .prepare(
        `INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
         VALUES (?, ?, ?, ?, ?, 'active')`
      )
      .bind(repoId, appId, ownerId, appId, `key_${repoId}`)
      .run();
  }

  async function fork(childRepo: string, parentRepo: string, forkedBy: string, rootRepo: string, depth: number) {
    await ctx.d1
      .prepare(
        `INSERT INTO repository_forks
           (child_repository_id, parent_repository_id, forked_by_user_id,
            parent_ref_name, parent_commit_oid, child_initial_commit_oid,
            lineage_root_repository_id, depth)
         VALUES (?, ?, ?, 'refs/heads/main', ?, ?, ?, ?)`
      )
      .bind(childRepo, parentRepo, forkedBy, oid('a'), oid('b'), rootRepo, depth)
      .run();
  }

  async function earn(
    orderSeed: string, appId: string, userId: string, repoId: string, cents: number,
    status = 'fulfilled'
  ) {
    await ctx.d1
      .prepare(
        `INSERT INTO commerce_orders
           (id, idempotency_key, buyer_user_id, app_id, seller_user_id, app_version,
            price_version, gross_cents, currency, lineage_snapshot_json, status)
         VALUES (?, ?, ?, ?, ?, 'v1', 1, ?, 'usd', '{}', ?)`
      )
      .bind(orderSeed, `idem_${orderSeed}`, userId, appId, userId, cents, status)
      .run();
    await ctx.d1
      .prepare(
        `INSERT INTO commerce_order_allocations (id, order_id, sequence, role, recipient_user_id, source_repository_id, basis_points, amount_cents)
         VALUES (?, ?, 0, 'maker', ?, ?, 7000, ?)`
      )
      .bind(`alloc_${orderSeed}`, orderSeed, userId, repoId, cents)
      .run();
  }

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await user('usr_tn', 'tnate');
    await user('usr_tj', 'tjosh');
    await user('usr_ts', 'tsam');
    await user('usr_tm', 'tmara');

    await appAndRepo('t-dronehunter', 'repo_dh', 'usr_tn');
    await appAndRepo('t-dh-thermal', 'repo_dht', 'usr_tj');
    await appAndRepo('t-dh-swarm', 'repo_dhs', 'usr_ts');
    await appAndRepo('t-swarm-nightops', 'repo_sno', 'usr_tm');

    await fork('repo_dht', 'repo_dh', 'usr_tj', 'repo_dh', 1);
    await fork('repo_dhs', 'repo_dh', 'usr_ts', 'repo_dh', 1);
    await fork('repo_sno', 'repo_dhs', 'usr_tm', 'repo_dh', 2);

    await earn('ord_nate', 't-dronehunter', 'usr_tn', 'repo_dh', 4820);
    await earn('ord_sam', 't-dh-swarm', 'usr_ts', 'repo_dhs', 740);
  });

  it('resolves the lineage root from any node in the family', async () => {
    expect(await resolveLineageRoot(ctx.d1, 'repo_dh')).toBe('repo_dh');
    expect(await resolveLineageRoot(ctx.d1, 'repo_dhs')).toBe('repo_dh');
    expect(await resolveLineageRoot(ctx.d1, 'repo_sno')).toBe('repo_dh');
  });

  it('builds the whole family in one tree, rooted at the root app', async () => {
    const tree = (await fetchLineageTree(ctx.d1, 'repo_dhs'))!;
    expect(tree).not.toBeNull();
    expect(tree.rootRepositoryId).toBe('repo_dh');
    expect(tree.rootAppId).toBe('t-dronehunter');
    expect(tree.totalNodes).toBe(4);
    expect(tree.totalForks).toBe(3);
    expect(tree.focusRepositoryId).toBe('repo_dhs');
  });

  it('reports correct per-node depth, parent, handle, and direct-fork counts', async () => {
    const tree = (await fetchLineageTree(ctx.d1, 'repo_dh'))!;
    const byRepo = new Map(tree.nodes.map((n) => [n.repositoryId, n]));

    const root = byRepo.get('repo_dh')!;
    expect(root.depth).toBe(0);
    expect(root.parentRepositoryId).toBeNull();
    expect(root.handle).toBe('tnate');
    expect(root.forkCount).toBe(2);

    const swarm = byRepo.get('repo_dhs')!;
    expect(swarm.depth).toBe(1);
    expect(swarm.parentRepositoryId).toBe('repo_dh');
    expect(swarm.handle).toBe('tsam');
    expect(swarm.forkCount).toBe(1);

    const nightops = byRepo.get('repo_sno')!;
    expect(nightops.depth).toBe(2);
    expect(nightops.parentRepositoryId).toBe('repo_dhs');
    expect(nightops.handle).toBe('tmara');
    expect(nightops.forkCount).toBe(0);
  });

  it('carries real per-owner earnings and a conserved lineage total', async () => {
    const tree = (await fetchLineageTree(ctx.d1, 'repo_dh'))!;
    const byRepo = new Map(tree.nodes.map((n) => [n.repositoryId, n]));
    expect(byRepo.get('repo_dh')!.earnedCents).toBe(4820);
    expect(byRepo.get('repo_dhs')!.earnedCents).toBe(740);
    expect(byRepo.get('repo_dht')!.earnedCents).toBe(0);
    expect(byRepo.get('repo_sno')!.earnedCents).toBe(0);
    expect(tree.lineageEarnedCents).toBe(4820 + 740);
  });

  it('resolves an app to its repo via the FORWARD link when repositories.app_id is NULL (prod shape)', async () => {
    await user('usr_fwd', 'tfwd');
    await ctx.d1.prepare(
      `INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
       VALUES ('repo_fwd', NULL, 'usr_fwd', 'fwdapp', 'key_fwd', 'active')`
    ).run();
    await ctx.d1.prepare(
      `INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, repository_id)
       VALUES ('fwdapp', 'FwdApp', 'T', 'D', 'usr_fwd', 'v1', 'MIT', '$0.00', '/data', '[]', '[]', '{}', 'repo_fwd')`
    ).run();
    expect(await resolveRepositoryIdForApp(ctx.d1, 'fwdapp')).toBe('repo_fwd');
    const tree = (await fetchLineageTree(ctx.d1, await resolveRepositoryIdForApp(ctx.d1, 'fwdapp')))!;
    expect(tree.rootRepositoryId).toBe('repo_fwd');
  });

  it('EXCLUDES unpaid/failed orders and out-of-lineage money from earnings (regression)', async () => {
    await earn('ord_creating', 't-dronehunter', 'usr_tn', 'repo_dh', 100000, 'creating');
    await earn('ord_failed', 't-dronehunter', 'usr_tn', 'repo_dh', 100000, 'payment_failed');
    await user('usr_other', 'tother');
    await appAndRepo('t-otherapp', 'repo_other', 'usr_other');
    await earn('ord_other', 't-otherapp', 'usr_tn', 'repo_other', 900000, 'fulfilled');

    const tree = (await fetchLineageTree(ctx.d1, 'repo_dh'))!;
    const byRepo = new Map(tree.nodes.map((n) => [n.repositoryId, n]));
    expect(byRepo.get('repo_dh')!.earnedCents).toBe(4820);
    expect(tree.lineageEarnedCents).toBe(4820 + 740);
  });

  it('returns a single-node tree for a never-forked root, and null for an unknown repo', async () => {
    await user('usr_tsolo', 'tsolo');
    await appAndRepo('t-soloapp', 'repo_solo', 'usr_tsolo');

    const solo = (await fetchLineageTree(ctx.d1, 'repo_solo'))!;
    expect(solo.totalNodes).toBe(1);
    expect(solo.totalForks).toBe(0);
    expect(solo.nodes[0].repositoryId).toBe('repo_solo');
    expect(solo.nodes[0].depth).toBe(0);

    expect(await fetchLineageTree(ctx.d1, 'repo_does_not_exist')).toBeNull();
    expect(await fetchLineageTree(ctx.d1, '')).toBeNull();
  });
});
