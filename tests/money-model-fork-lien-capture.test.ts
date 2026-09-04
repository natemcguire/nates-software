import { describe, it, expect } from 'vitest';
import { buildInheritedLiens, assertForkAllowed } from '../src/lib/royaltyLiens';
import { CommerceValidationError } from '../src/lib/commerceDomain';
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
      1000,
      'repo_b',
      'bob',
      'repo_c'
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

describe('assertForkAllowed (pure)', () => {
  it('does not throw when sumBps is exactly 10000 (100%)', () => {
    expect(() => assertForkAllowed(10000)).not.toThrow();
  });

  it('does not throw for sumBps below 10000', () => {
    expect(() => assertForkAllowed(2000)).not.toThrow();
    expect(() => assertForkAllowed(0)).not.toThrow();
  });

  it('throws CommerceValidationError when sumBps exceeds 10000', () => {
    expect(() => assertForkAllowed(10001)).toThrow(CommerceValidationError);
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


    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app_ann', 'Ann Root', 'Tagline', 'Desc', 'usr_ann', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps)
      VALUES ('app_ann', ?, 'usr_ann', 1000, 'usd', 'active', 1000)
    `).bind(annRepoId).run();


    const bobForkReq = await postAsUser('session_bob', {
      action: 'fork', parentRepositoryId: annRepoId, childSlug: 'bob-fork', parentRefName: 'refs/heads/main'
    });
    expect(bobForkReq.status).toBe(201);
    const bobForkData = await bobForkReq.json();
    const bobRepoId = bobForkData.repository.id;

    const bobRequestEvent = await ctx.d1.prepare(`
      SELECT payload FROM forge_outbox_events
      WHERE id = ? AND event_type = 'repository.fork_requested'
    `).bind(bobForkData.outboxEventId).first();
    const bobRequestPayload = JSON.parse((bobRequestEvent as any).payload);
    expect(bobRequestPayload.royaltyLienSnapshot).toMatchObject({
      version: 1,
      liens: [{
        ancestorUserId: 'usr_ann',
        bps: 1000,
        sourceRepositoryId: annRepoId,
        lineageDepth: 1
      }],
      parentRoyalty: {
        ancestorUserId: 'usr_ann',
        bps: 1000,
        sourceRepositoryId: annRepoId
      },
      totalBps: 1000
    });
    expect(bobRequestPayload.royaltyLienSnapshot.lineageFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);

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


    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app_bob', 'Bob Fork', 'Tagline', 'Desc', 'usr_bob', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps)
      VALUES ('app_bob', ?, 'usr_bob', 1000, 'usd', 'active', 1000)
    `).bind(bobRepoId).run();


    await post({
      action: 'gateway-record-ref',
      repositoryId: bobRepoId,
      refName: 'refs/heads/main',
      oldOid: OID_1,
      newOid: OID_2,
      operation: 'update',
      idempotencyKey: 'bob_advance_ref'
    });


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

  it('confirms the request-time parent rate after the live parent rate changes', async () => {
    ctx = await createTestD1Database({ foreignKeys: true });

    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role) VALUES ('usr_rate_parent', 'rate-parent', 'Rate Parent', 'maker')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role) VALUES ('usr_rate_child', 'rate-child', 'Rate Child', 'maker')
    `).run();
    await createSession('usr_rate_parent', 'session_rate_parent');
    await createSession('usr_rate_child', 'session_rate_child');

    const parentCreateRes = await postAsUser('session_rate_parent', { action: 'create-repository', slug: 'rate-parent-root' });
    expect(parentCreateRes.status).toBe(201);
    const parentRepositoryId = (await parentCreateRes.json()).repository.id;

    await post({
      action: 'gateway-record-ref',
      repositoryId: parentRepositoryId,
      refName: 'refs/heads/main',
      oldOid: null,
      newOid: OID_1,
      operation: 'create',
      idempotencyKey: 'rate_parent_init_ref'
    });

    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app_rate_parent', 'Rate Parent', 'Tagline', 'Desc', 'usr_rate_parent', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps)
      VALUES ('app_rate_parent', ?, 'usr_rate_parent', 1000, 'usd', 'active', 1250)
    `).bind(parentRepositoryId).run();

    const forkRequest = await postAsUser('session_rate_child', {
      action: 'fork',
      parentRepositoryId,
      childSlug: 'rate-child-fork',
      parentRefName: 'refs/heads/main'
    });
    expect(forkRequest.status).toBe(201);
    const forkData = await forkRequest.json();

    await ctx.d1.prepare(`
      UPDATE commerce_products SET royalty_bps = 2750 WHERE repository_id = ?
    `).bind(parentRepositoryId).run();

    const confirmResponse = await post({
      action: 'gateway-confirm-fork',
      childRepositoryId: forkData.repository.id,
      parentRepositoryId,
      parentRefName: 'refs/heads/main',
      parentCommitOid: OID_1,
      childInitialCommitOid: OID_1,
      idempotencyKey: 'idemp_rate_child_confirm',
      actorUserId: 'usr_rate_child'
    });
    expect(confirmResponse.status).toBe(201);

    const lienRows: any = await ctx.d1.prepare(`
      SELECT ancestor_repository_id AS sourceRepositoryId, ancestor_user_id AS ancestorUserId, bps, depth AS lineageDepth
      FROM repository_fork_liens WHERE holder_of_repository_id = ?
    `).bind(forkData.repository.id).all();
    expect(lienRows.results).toEqual([{
      sourceRepositoryId: parentRepositoryId,
      ancestorUserId: 'usr_rate_parent',
      bps: 1250,
      lineageDepth: 1
    }]);
  });

  it('fails closed when the pinned snapshot total exceeds 100% and inserts no lien rows', async () => {
    ctx = await createTestD1Database({ foreignKeys: true });

    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role) VALUES ('usr_invalid_parent', 'invalid-parent', 'Invalid Parent', 'maker')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role) VALUES ('usr_invalid_child', 'invalid-child', 'Invalid Child', 'maker')
    `).run();
    await createSession('usr_invalid_parent', 'session_invalid_parent');
    await createSession('usr_invalid_child', 'session_invalid_child');

    const parentCreateRes = await postAsUser('session_invalid_parent', { action: 'create-repository', slug: 'invalid-parent-root' });
    expect(parentCreateRes.status).toBe(201);
    const parentRepositoryId = (await parentCreateRes.json()).repository.id;

    await post({
      action: 'gateway-record-ref',
      repositoryId: parentRepositoryId,
      refName: 'refs/heads/main',
      oldOid: null,
      newOid: OID_1,
      operation: 'create',
      idempotencyKey: 'invalid_parent_init_ref'
    });

    const forkRequest = await postAsUser('session_invalid_child', {
      action: 'fork',
      parentRepositoryId,
      childSlug: 'invalid-child-fork',
      parentRefName: 'refs/heads/main'
    });
    expect(forkRequest.status).toBe(201);
    const forkData = await forkRequest.json();

    const requestEvent = await ctx.d1.prepare(`
      SELECT payload FROM forge_outbox_events WHERE id = ?
    `).bind(forkData.outboxEventId).first();
    const requestPayload = JSON.parse((requestEvent as any).payload);
    requestPayload.royaltyLienSnapshot.totalBps = 10001;
    await ctx.d1.prepare(`
      UPDATE forge_outbox_events SET payload = ? WHERE id = ?
    `).bind(JSON.stringify(requestPayload), forkData.outboxEventId).run();

    const confirmResponse = await post({
      action: 'gateway-confirm-fork',
      childRepositoryId: forkData.repository.id,
      parentRepositoryId,
      parentRefName: 'refs/heads/main',
      parentCommitOid: OID_1,
      childInitialCommitOid: OID_1,
      idempotencyKey: 'idemp_invalid_child_confirm',
      actorUserId: 'usr_invalid_child'
    });
    expect(confirmResponse.status).toBe(409);
    expect((await confirmResponse.json()).error).toContain('would exceed 100%');

    const lienCount = await ctx.d1.prepare(`
      SELECT COUNT(*) AS count FROM repository_fork_liens WHERE holder_of_repository_id = ?
    `).bind(forkData.repository.id).first();
    expect((lienCount as any).count).toBe(0);

    const forkRow = await ctx.d1.prepare(`
      SELECT child_repository_id FROM repository_forks WHERE child_repository_id = ?
    `).bind(forkData.repository.id).first();
    expect(forkRow).toBeNull();

    const child = await ctx.d1.prepare(`
      SELECT status FROM repositories WHERE id = ?
    `).bind(forkData.repository.id).first();
    expect((child as any).status).toBe('provisioning');
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

describe('Σr <= 100% gate at fork REQUEST time (Task B3)', () => {
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

  it('rejects a fork REQUEST (Phase 1) whose inherited Σr + parent rate would exceed 10000 bps, before provisioning', async () => {
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


    const annCreateRes = await postAsUser('session_ann', { action: 'create-repository', slug: 'ann-root-b3' });
    expect(annCreateRes.status).toBe(201);
    const annRepoId = (await annCreateRes.json()).repository.id;

    await post({
      action: 'gateway-record-ref',
      repositoryId: annRepoId,
      refName: 'refs/heads/main',
      oldOid: null,
      newOid: OID_1,
      operation: 'create',
      idempotencyKey: 'ann_init_ref_b3'
    });

    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app_ann_b3', 'Ann Root', 'Tagline', 'Desc', 'usr_ann', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps)
      VALUES ('app_ann_b3', ?, 'usr_ann', 1000, 'usd', 'active', 6000)
    `).bind(annRepoId).run();


    const bobForkReq = await postAsUser('session_bob', {
      action: 'fork', parentRepositoryId: annRepoId, childSlug: 'bob-fork-b3', parentRefName: 'refs/heads/main'
    });
    expect(bobForkReq.status).toBe(201);
    const bobRepoId = (await bobForkReq.json()).repository.id;

    const bobConfirmRes = await post({
      action: 'gateway-confirm-fork',
      childRepositoryId: bobRepoId,
      parentRepositoryId: annRepoId,
      parentRefName: 'refs/heads/main',
      parentCommitOid: OID_1,
      childInitialCommitOid: OID_1,
      idempotencyKey: 'idemp_bob_confirm_b3',
      actorUserId: 'usr_bob'
    });
    expect(bobConfirmRes.status).toBe(201);


    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES ('app_bob_b3', 'Bob Fork', 'Tagline', 'Desc', 'usr_bob', 'v1.0.0', 'MIT', '$10.00', '/data', '[]', '[]', '{}')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps)
      VALUES ('app_bob_b3', ?, 'usr_bob', 1000, 'usd', 'active', 6000)
    `).bind(bobRepoId).run();

    await post({
      action: 'gateway-record-ref',
      repositoryId: bobRepoId,
      refName: 'refs/heads/main',
      oldOid: OID_1,
      newOid: OID_2,
      operation: 'update',
      idempotencyKey: 'bob_advance_ref_b3'
    });


    const carolForkReq = await postAsUser('session_carol', {
      action: 'fork', parentRepositoryId: bobRepoId, childSlug: 'carol-fork-b3', parentRefName: 'refs/heads/main'
    });
    expect(carolForkReq.status).toBeGreaterThanOrEqual(400);
    expect(carolForkReq.status).toBeLessThan(500);

    const carolForkBody = await carolForkReq.json();
    expect(carolForkBody.success).toBe(false);


    const carolRepoRow = await ctx.d1.prepare(`
      SELECT id FROM repositories WHERE owner_user_id = 'usr_carol' AND slug = 'carol-fork-b3'
    `).first();
    expect(carolRepoRow).toBeNull();


    const carolForkRow = await ctx.d1.prepare(`
      SELECT * FROM repository_forks WHERE parent_repository_id = ? AND forked_by_user_id = 'usr_carol'
    `).bind(bobRepoId).first();
    expect(carolForkRow).toBeNull();


    const anyCarolLiens = await ctx.d1.prepare(`
      SELECT COUNT(*) AS n FROM repository_fork_liens
      WHERE holder_of_repository_id IN (
        SELECT id FROM repositories WHERE owner_user_id = 'usr_carol'
      )
    `).first();
    expect((anyCarolLiens as any).n).toBe(0);


    const outboxRow = await ctx.d1.prepare(`
      SELECT COUNT(*) AS n FROM forge_outbox_events
      WHERE aggregate_type = 'fork' AND payload LIKE '%carol-fork-b3%'
    `).first();
    expect((outboxRow as any).n).toBe(0);
  });
});
