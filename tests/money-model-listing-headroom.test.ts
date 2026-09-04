import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import { onRequestPost } from '../functions/api/drops';
import {
  assertListingRoyaltyAllowed,
  getListingRoyaltyHeadroomBps,
  MINIMUM_SELLER_HEADROOM_BPS
} from '../src/lib/royaltyLiens';

describe('listing royalty headroom', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await ctx.d1.prepare(`
      INSERT INTO app_listings (
        id, name, tagline, description, creator_id, version, license, price, storage,
        tags, screenshots, binaries, listing_status, deployment_state
      ) VALUES (
        'headroom-app', 'Headroom App', 'Headroom', '', 'usr_nate', 'v1.0.0', 'MIT', '$10.00', 'SQLite',
        '[]', '[]', '{}', 'active', 'source_ready'
      )
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
      VALUES
        ('repo_headroom_ancestor', NULL, 'usr_nate', 'headroom-ancestor', 'repositories/headroom-ancestor.git', 'active'),
        ('repo_headroom_app', 'headroom-app', 'usr_nate', 'headroom-app', 'repositories/headroom-app.git', 'active')
    `).run();
    await ctx.d1.prepare(`UPDATE app_listings SET repository_id = 'repo_headroom_app' WHERE id = 'headroom-app'`).run();
    await ctx.d1.prepare(`
      INSERT INTO repository_fork_liens (
        id, holder_of_repository_id, ancestor_repository_id, ancestor_user_id, bps, depth
      ) VALUES ('lien_headroom', 'repo_headroom_app', 'repo_headroom_ancestor', 'usr_nate', 1000, 1)
    `).run();
  });

  const publish = (royaltyBps: number) => onRequestPost({
    request: new Request('http://localhost/api/drops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
      body: JSON.stringify({
        id: 'headroom-app',
        name: 'Headroom App',
        tagline: 'Headroom',
        version: 'v1.0.0',
        price: '$10.00',
        repositoryId: 'repo_headroom_app',
        royaltyBps
      })
    }),
    env: { DB: ctx.d1 }
  });

  it('reserves one basis point of the after-platform remainder for the descendant seller', () => {
    expect(MINIMUM_SELLER_HEADROOM_BPS).toBe(1);
    expect(getListingRoyaltyHeadroomBps(1000)).toBe(8999);
    expect(() => assertListingRoyaltyAllowed(1000, 8999)).not.toThrow();
    expect(() => assertListingRoyaltyAllowed(1000, 9000)).toThrow(/minimum seller remainder/);
  });

  it('rejects an overcommitted listing server-side and accepts the exact remaining headroom', async () => {
    const rejected = await publish(9000);
    expect(rejected.status).toBe(422);
    expect(await ctx.d1.prepare(`SELECT app_id FROM commerce_products WHERE app_id = 'headroom-app'`).first()).toBeNull();

    const accepted = await publish(8999);
    expect(accepted.status).toBe(200);
    const product = await ctx.d1.prepare(`SELECT royalty_bps FROM commerce_products WHERE app_id = 'headroom-app'`).first();
    expect((product as any).royalty_bps).toBe(8999);
  });
});
