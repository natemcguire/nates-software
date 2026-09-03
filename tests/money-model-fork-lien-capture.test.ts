import { describe, it, expect } from 'vitest';
import { buildInheritedLiens } from '../src/lib/royaltyLiens';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as gitApi from '../functions/api/git';
import { hashSessionToken } from '../functions/api/_session';

const OID_1 = '1111111111111111111111111111111111111111';
const OID_2 = '2222222222222222222222222222222222222222';

const GATEWAY_SECRET = 'secret_gateway_token_xyz_123';
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

describe('buildInheritedLiens (pure)', () => {
  it('inherits parent liens at depth+1 and adds the immediate-parent lien at depth 1', () => {
    const parentLiens = [
      { ancestorRepositoryId: 'repo_a', ancestorUserId: 'ann', bps: 1000, depth: 1 },
    ];
    const result = buildInheritedLiens(
      parentLiens,
      1000, // parentListingBps (Bob's rate)
      'repo_b', // parentRepositoryId (Bob)
      'bob', // parentUserId
      'repo_c' // childRepositoryId (Carol)
    );

    expect(result.liens).toEqual([
      { holderOfRepositoryId: 'repo_c', ancestorRepositoryId: 'repo_a', ancestorUserId: 'ann', bps: 1000, depth: 2 },
      { holderOfRepositoryId: 'repo_c', ancestorRepositoryId: 'repo_b', ancestorUserId: 'bob', bps: 1000, depth: 1 },
    ]);
    expect(result.sumBps).toBe(2000);
  });

  it('skips a 0-bps parent listing rate (no lien row for the immediate parent)', () => {
    const result = buildInheritedLiens([], 0, 'repo_b', 'bob', 'repo_c');
    expect(result.liens).toEqual([]);
    expect(result.sumBps).toBe(0);
  });

  it('skips any inherited parent lien with bps <= 0 (defensive)', () => {
    const parentLiens = [
      { ancestorRepositoryId: 'repo_a', ancestorUserId: 'ann', bps: 0, depth: 1 },
    ];
    const result = buildInheritedLiens(parentLiens, 500, 'repo_b', 'bob', 'repo_c');
    expect(result.liens).toEqual([
      { holderOfRepositoryId: 'repo_c', ancestorRepositoryId: 'repo_b', ancestorUserId: 'bob', bps: 500, depth: 1 },
    ]);
    expect(result.sumBps).toBe(500);
  });

  it('handles a root parent with no inherited liens and no royalty rate (root fork)', () => {
    const result = buildInheritedLiens([], 0, 'repo_root', 'nate', 'repo_child');
    expect(result.liens).toEqual([]);
    expect(result.sumBps).toBe(0);
  });
});

describe('gateway-confirm-fork: lien capture integration (real D1 + real handler)', () => {
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

  const post = (body: Record<string, unknown>) => gitApi.onRequestPost({
    request: new Request('http://localhost/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}`, Origin: 'http://localhost' },
      body: JSON.stringify(body)
    }),
    env: testEnv()
  });

  const postAsUser = (token: string, body: Record<string, unknown>) => gitApi.onRequestPost({
    request: new Request('http://localhost/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: 'http://localhost' },
      body: JSON.stringify(body)
    }),
    env: testEnv()
  });

  it('captures Ann@1000/depth2 + Bob@1000/depth1 for Carol after Bob forks Ann and Carol forks Bob', async () => {
    ctx = await createTestD1Database({ foreignKeys: true });

    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role) VALUES ('usr_ann', 'ann', 'Ann', 'maker')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role) VALUES ('usr_bob', 'bob', 'Bob', 'maker')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role) VALUES ('usr_carol', 'carol', 'Carol', 'maker')
    `).run();
    await createSession('usr_ann', 'session_ann');
    await createSession('usr_bob', 'session_bob');
    await createSession('usr_carol', 'session_carol');

    // 1. Ann creates the root repository and activates it via gateway ref record.
    const annCreateRes = await postAsUser('session_ann', { action: 'create-repository', slug: 'ann-root' });
    expect(annCreateRes.status).toBe(201);
    const annRepoId = (await annCreateRes.json()).repository.id;

    await post({
      action: 'gateway-record-ref',
      repositoryId: annRepoId,
      refName: 'refs/heads/main',
      oldOid: null,
      newOid: OID_1,
      operation: 'create',
      idempotencyKey: 'ann_init_ref'
    });

    // Ann's listing royalty rate: 10% (1000 bps).
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app_ann', 'Ann Root', 'Tagline', 'Desc', 'usr_ann', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps)
      VALUES ('app_ann', ?, 'usr_ann', 1000, 'usd', 'active', 1000)
    `).bind(annRepoId).run();

    // 2. Bob forks Ann (Phase 1 request + Phase 2 gateway confirm).
    const bobForkReq = await postAsUser('session_bob', {
      action: 'fork', parentRepositoryId: annRepoId, childSlug: 'bob-fork', parentRefName: 'refs/heads/main'
    });
    expect(bobForkReq.status).toBe(201);
    const bobForkData = await bobForkReq.json();
    const bobRepoId = bobForkData.repository.id;

    const bobConfirmRes = await post({
      action: 'gateway-confirm-fork',
      childRepositoryId: bobRepoId,
      parentRepositoryId: annRepoId,
      parentRefName: 'refs/heads/main',
      parentCommitOid: OID_1,
      childInitialCommitOid: OID_1,
      idempotencyKey: 'idemp_bob_confirm',
      actorUserId: 'usr_bob'
    });
    expect(bobConfirmRes.status).toBe(201);

    // Bob's own listing royalty rate: also 10% (1000 bps).
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app_bob', 'Bob Fork', 'Tagline', 'Desc', 'usr_bob', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps)
      VALUES ('app_bob', ?, 'usr_bob', 1000, 'usd', 'active', 1000)
    `).bind(bobRepoId).run();

    // Bob's repo needs to be active + have a ref to fork from; advance to OID_2 to give Carol something to pin.
    await post({
      action: 'gateway-record-ref',
      repositoryId: bobRepoId,
      refName: 'refs/heads/main',
      oldOid: OID_1,
      newOid: OID_2,
      operation: 'update',
      idempotencyKey: 'bob_advance_ref'
    });

    // 3. Carol forks Bob (Phase 1 request + Phase 2 gateway confirm).
    const carolForkReq = await postAsUser('session_carol', {
      action: 'fork', parentRepositoryId: bobRepoId, childSlug: 'carol-fork', parentRefName: 'refs/heads/main'
    });
    expect(carolForkReq.status).toBe(201);
    const carolForkData = await carolForkReq.json();
    const carolRepoId = carolForkData.repository.id;

    const carolConfirmRes = await post({
      action: 'gateway-confirm-fork',
      childRepositoryId: carolRepoId,
      parentRepositoryId: bobRepoId,
      parentRefName: 'refs/heads/main',
      parentCommitOid: OID_2,
      childInitialCommitOid: OID_2,
      idempotencyKey: 'idemp_carol_confirm',
      actorUserId: 'usr_carol'
    });
    expect(carolConfirmRes.status).toBe(201);

    // 4. Assert repository_fork_liens for Carol's repo = Ann@1000/depth2 + Bob@1000/depth1.
    const lienRows: any = await ctx.d1.prepare(`
      SELECT holder_of_repository_id AS holderOfRepositoryId, ancestor_repository_id AS ancestorRepositoryId,
             ancestor_user_id AS ancestorUserId, bps, depth
      FROM repository_fork_liens WHERE holder_of_repository_id = ?
      ORDER BY depth DESC
    `).bind(carolRepoId).all();

    expect(lienRows.results).toEqual([
      { holderOfRepositoryId: carolRepoId, ancestorRepositoryId: annRepoId, ancestorUserId: 'usr_ann', bps: 1000, depth: 2 },
      { holderOfRepositoryId: carolRepoId, ancestorRepositoryId: bobRepoId, ancestorUserId: 'usr_bob', bps: 1000, depth: 1 },
    ]);

    // 5. Bob's own repo should carry exactly one lien: Ann@1000/depth1.
    const bobLienRows: any = await ctx.d1.prepare(`
      SELECT holder_of_repository_id AS holderOfRepositoryId, ancestor_repository_id AS ancestorRepositoryId,
             ancestor_user_id AS ancestorUserId, bps, depth
      FROM repository_fork_liens WHERE holder_of_repository_id = ?
      ORDER BY depth DESC
    `).bind(bobRepoId).all();

    expect(bobLienRows.results).toEqual([
      { holderOfRepositoryId: bobRepoId, ancestorRepositoryId: annRepoId, ancestorUserId: 'usr_ann', bps: 1000, depth: 1 },
    ]);
  });

  it('writes no liens when the parent has no commerce_products row (royalty_bps treated as 0)', async () => {
    ctx = await createTestD1Database({ foreignKeys: true });

    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role) VALUES ('usr_dave', 'dave', 'Dave', 'maker')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role) VALUES ('usr_erin', 'erin', 'Erin', 'maker')
    `).run();
    await createSession('usr_dave', 'session_dave');
    await createSession('usr_erin', 'session_erin');

    const daveCreateRes = await postAsUser('session_dave', { action: 'create-repository', slug: 'dave-root' });
    const daveRepoId = (await daveCreateRes.json()).repository.id;

    await post({
      action: 'gateway-record-ref',
      repositoryId: daveRepoId,
      refName: 'refs/heads/main',
      oldOid: null,
      newOid: OID_1,
      operation: 'create',
      idempotencyKey: 'dave_init_ref'
    });
    // No commerce_products row for Dave's repo -> royalty_bps treated as 0.

    const erinForkReq = await postAsUser('session_erin', {
      action: 'fork', parentRepositoryId: daveRepoId, childSlug: 'erin-fork', parentRefName: 'refs/heads/main'
    });
    const erinRepoId = (await erinForkReq.json()).repository.id;

    const erinConfirmRes = await post({
      action: 'gateway-confirm-fork',
      childRepositoryId: erinRepoId,
      parentRepositoryId: daveRepoId,
      parentRefName: 'refs/heads/main',
      parentCommitOid: OID_1,
      childInitialCommitOid: OID_1,
      idempotencyKey: 'idemp_erin_confirm',
      actorUserId: 'usr_erin'
    });
    expect(erinConfirmRes.status).toBe(201);

    const lienRows: any = await ctx.d1.prepare(`
      SELECT * FROM repository_fork_liens WHERE holder_of_repository_id = ?
    `).bind(erinRepoId).all();
    expect(lienRows.results).toEqual([]);
  });
});
