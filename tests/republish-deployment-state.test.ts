import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestPost } from '../functions/api/drops';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';

describe('metadata republish deployment state', () => {
  let ctx: TestD1Context;
  const commitOid = '1'.repeat(40);

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await ctx.d1.prepare(`
      INSERT INTO stripe_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_status)
      VALUES ('usr_nate', 'acct_test_republish', 1, 1, 'active')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO app_listings (
        id, name, tagline, description, creator_id, version, price, listing_status, deployment_state
      ) VALUES (
        'republish-app', 'Republish App', 'Original tagline', '', 'usr_nate', 'v1.0.0', '$15.00', 'active', 'draft'
      )
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
      VALUES ('repo_republish_app', 'republish-app', 'usr_nate', 'republish-app', 'repositories/republish-app.git', 'active')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
      VALUES ('repo_republish_app', 'refs/heads/main', ?, 1, 'usr_nate')
    `).bind(commitOid).run();
    await ctx.d1.prepare(`
      UPDATE app_listings
      SET repository_id = 'repo_republish_app', deployment_state = 'deployable',
          deployment_evidence_json = '{"verified":true}', active_commit_oid = ?
      WHERE id = 'republish-app'
    `).bind(commitOid).run();
  });

  it('preserves deployable state and evidence when only listing metadata changes', async () => {
    const response = await onRequestPost({
      request: new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: 'republish-app',
          name: 'Republish App',
          tagline: 'Updated tagline',
          version: 'v1.0.0',
          price: '$20.00',
          repositoryId: 'repo_republish_app'
        })
      }),
      env: { DB: ctx.d1 }
    });
    const data = await response.json();
    const listing = await ctx.d1.prepare(`
      SELECT tagline, price, deployment_state, deployment_evidence_json, active_commit_oid
      FROM app_listings WHERE id = 'republish-app'
    `).first();

    expect(response.status).toBe(200);
    expect(data.deploymentState).toBe('deployable');
    expect(listing).toMatchObject({
      tagline: 'Updated tagline',
      price: '$20.00',
      deployment_state: 'deployable',
      deployment_evidence_json: '{"verified":true}',
      active_commit_oid: commitOid
    });
  });
});
