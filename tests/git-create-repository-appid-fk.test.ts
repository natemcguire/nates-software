import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as gitApi from '../functions/api/git';
import { hashSessionToken } from '../functions/api/_session';

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

describe('NSW-49: create-repository appId FK misreported as slug-conflict 409', () => {
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

  const createRepoRequest = (body: Record<string, unknown>, token = 'session_nate') => gitApi.onRequestPost({
    request: new Request('http://localhost/api/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: 'http://localhost' },
      body: JSON.stringify({ action: 'create-repository', ...body })
    }),
    env: testEnv()
  });

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await createSession('usr_nate', 'session_nate');
  });

  it('returns a clean 400 with a clear message when appId references no app_listings row', async () => {
    const res = await createRepoRequest({ slug: 'orphan-appid-repo', appId: 'nonexistent-app-listing' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe(
      "Unknown appId 'nonexistent-app-listing' — publish the listing first or omit appId"
    );

    const repoRow = await ctx.d1.prepare('SELECT id FROM repositories WHERE slug = ?').bind('orphan-appid-repo').first();
    expect(repoRow).toBeNull();
    const outboxRow = await ctx.d1.prepare(
      "SELECT id FROM forge_outbox_events WHERE event_type = 'repository.provisioning_requested'"
    ).all();
    expect(outboxRow.results || []).toHaveLength(0);
  });

  it('creates the repository successfully when appId references a real app_listings row', async () => {
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version)
      VALUES ('real-app-listing', 'Real App', 'Tagline', 'Desc', 'usr_nate', 'v1.0.0')
    `).run();

    const res = await createRepoRequest({ slug: 'valid-appid-repo', appId: 'real-app-listing' });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.repository.appId).toBe('real-app-listing');

    const repoRow = await ctx.d1.prepare('SELECT app_id FROM repositories WHERE slug = ?').bind('valid-appid-repo').first();
    expect((repoRow as any).app_id).toBe('real-app-listing');
  });

  it('refuses (403) linking a repository to a listing owned by another maker (NSW-141)', async () => {
    await ctx.d1.prepare(`INSERT INTO users (id, username, display_name, role) VALUES ('usr_victim', 'victim', 'Victim', 'maker')`).run();
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version)
      VALUES ('victim-app', 'Victim App', 'T', 'D', 'usr_victim', 'v1.0.0')
    `).run();

    const res = await createRepoRequest({ slug: 'hijack-repo', appId: 'victim-app' });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);

    const repoRow = await ctx.d1.prepare('SELECT id FROM repositories WHERE slug = ?').bind('hijack-repo').first();
    expect(repoRow).toBeNull();
  });

  it('still returns 409 for a genuine slug/storage-key uniqueness conflict (unrelated to appId)', async () => {
    const first = await createRepoRequest({ slug: 'collide-me' });
    expect(first.status).toBe(201);

    // Force the idempotency pre-check to miss (simulating a race) so the INSERT
    // hits the real (owner_user_id, slug) UNIQUE constraint and the catch block runs.
    const raceDb = {
      ...ctx.d1,
      prepare: (query: string) => {
        const statement = ctx.d1.prepare(query);
        if (/SELECT id, app_id AS appId, owner_user_id AS ownerUserId, slug,\s*\n\s*visibility, object_format AS objectFormat, default_ref AS defaultRef,\s*\n\s*storage_key AS storageKey, status, created_at AS createdAt, updated_at AS updatedAt\s*\n\s*FROM repositories\s*\n\s*WHERE owner_user_id = \? AND slug = \?/.test(query)) {
          return { ...statement, bind: () => ({ ...statement, first: async () => null }) };
        }
        return statement;
      },
      batch: ctx.d1.batch.bind(ctx.d1)
    };

    const res = await gitApi.onRequestPost({
      request: new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
        body: JSON.stringify({ action: 'create-repository', slug: 'collide-me' })
      }),
      env: testEnv({ DB: raceDb })
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('already exists');
  });
});
