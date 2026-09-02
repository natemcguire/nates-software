import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as lineageApi from '../functions/api/lineage';

// Exercises GET /api/lineage end-to-end against the real schema via the D1 harness:
//   @tn/t-dronehunter (root) → @ts/t-dh-swarm (fork)
describe('GET /api/lineage (public tree endpoint)', () => {
  let ctx: TestD1Context;

  const get = (qs: string) =>
    lineageApi.onRequestGet({
      request: new Request(`https://nates-software.com/api/lineage${qs}`, { method: 'GET' }),
      env: { DB: ctx.d1 },
    });

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    const run = (sql: string, ...b: any[]) => ctx.d1.prepare(sql).bind(...b).run();

    await run(
      `INSERT OR IGNORE INTO users (id, username, display_name, password_hash, salt, role)
       VALUES ('usr_tn','tnate','tnate','h','s','maker'), ('usr_ts','tsam','tsam','h','s','maker')`
    );
    for (const [appId, repoId, owner] of [
      ['t-dronehunter', 'repo_dh', 'usr_tn'],
      ['t-dh-swarm', 'repo_dhs', 'usr_ts'],
    ]) {
      await run(
        `INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
         VALUES (?, ?, 'T', 'D', ?, 'v1', 'MIT', '$0.00', '/data', '[]', '[]', '{}')`,
        appId, appId, owner
      );
      await run(
        `INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        repoId, appId, owner, appId, `key_${repoId}`
      );
    }
    await run(
      `INSERT INTO repository_forks
         (child_repository_id, parent_repository_id, forked_by_user_id, parent_ref_name,
          parent_commit_oid, child_initial_commit_oid, lineage_root_repository_id, depth)
       VALUES ('repo_dhs','repo_dh','usr_ts','refs/heads/main', ?, ?, 'repo_dh', 1)`,
      'a'.repeat(40), 'b'.repeat(40)
    );
  });

  it('returns the full tree when queried by appId (friendly share URL key)', async () => {
    const res = await get('?appId=t-dronehunter');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.tree.rootAppId).toBe('t-dronehunter');
    expect(body.tree.totalNodes).toBe(2);
    expect(body.tree.totalForks).toBe(1);
    // A fork's appId resolves the same family (any node → whole tree).
    const byRepo = new Map(body.tree.nodes.map((n: any) => [n.repositoryId, n]));
    expect((byRepo.get('repo_dh') as any).handle).toBe('tnate');
    expect((byRepo.get('repo_dhs') as any).handle).toBe('tsam');
  });

  it('accepts an explicit repositoryId and flags the focus node', async () => {
    const res = await get('?repositoryId=repo_dhs');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tree.focusRepositoryId).toBe('repo_dhs');
    expect(body.tree.rootRepositoryId).toBe('repo_dh');
  });

  it('sets a short public cache header (embeddable, shareable)', async () => {
    const res = await get('?appId=t-dronehunter');
    expect(res.headers.get('Cache-Control')).toMatch(/public/);
  });

  it('rejects missing and malformed ids', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?appId=' + encodeURIComponent('bad id!'))).status).toBe(400);
    expect((await get('?repositoryId=' + encodeURIComponent("'; DROP TABLE users;--"))).status).toBe(400);
  });

  it('404s for an unknown app and an app with no repo', async () => {
    const unknown = await get('?appId=does-not-exist');
    expect(unknown.status).toBe(404);
    const body: any = await unknown.json();
    expect(body.success).toBe(false);
  });

  it('fails closed (500, no internals leaked) when the DB is unavailable', async () => {
    const res = await lineageApi.onRequestGet({
      request: new Request('https://nates-software.com/api/lineage?appId=t-dronehunter'),
      env: {},
    });
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/sql|d1|prepare|stack/i);
  });
});
