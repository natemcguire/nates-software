import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestPost } from '../functions/api/git';
import { hashSessionToken } from '../functions/api/_session';
import { resolveForkAppId } from '../src/components/ForkWithAiModal';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';

describe('fork appId resolution', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, 'usr_sam', ?)
    `).bind(await hashSessionToken('fork_app_id_token'), Date.now() + 100000).run();
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, listing_status)
      VALUES ('canonical-fork-app', 'Canonical Fork App', 'Fork app', '', 'usr_nate', 'v1.0.0', 'active')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
      VALUES ('repo_canonical_fork_app', 'canonical-fork-app', 'usr_nate', 'canonical-fork-app', 'repositories/canonical-fork-app.git', 'active')
    `).run();
    await ctx.d1.prepare(`UPDATE app_listings SET repository_id = 'repo_canonical_fork_app' WHERE id = 'canonical-fork-app'`).run();
    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
      VALUES ('repo_canonical_fork_app', 'refs/heads/main', ?, 1, 'usr_nate')
    `).bind('1'.repeat(40)).run();
  });

  it('omits a repository identifier from the client appId field', () => {
    expect(resolveForkAppId('repo_canonical_fork_app', 'repo_canonical_fork_app')).toBeUndefined();
    expect(resolveForkAppId('canonical-fork-app', 'repo_canonical_fork_app')).toBe('canonical-fork-app');
  });

  it('accepts a canonical repository id without rejecting it as an app mismatch', async () => {
    const response = await onRequestPost({
      request: new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fork_app_id_token' },
        body: JSON.stringify({
          action: 'fork',
          parentRepositoryId: 'repo_canonical_fork_app',
          appId: 'repo_canonical_fork_app',
          childSlug: 'canonical-fork-app-copy',
          parentRefName: 'refs/heads/main'
        })
      }),
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.test',
        GITSMITH_GATEWAY_FETCH: async () => Response.json({ ready: true, configured: true, active: true })
      }
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.forkRequest.parentRepositoryId).toBe('repo_canonical_fork_app');
  });
});
