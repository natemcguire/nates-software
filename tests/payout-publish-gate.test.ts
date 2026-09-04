import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestPost } from '../functions/api/drops';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';

describe('paid listing payout gate', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  it('keeps a proven paid listing in draft while Stripe payouts are disabled', async () => {
    await ctx.d1.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, price, listing_status, deployment_state)
      VALUES ('payout-gate-app', 'Payout Gate App', 'Payout gate', '', 'usr_nate', 'v1.0.0', '$15.00', 'active', 'deployable')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, app_id, owner_user_id, slug, storage_key, status)
      VALUES ('repo_payout_gate', 'payout-gate-app', 'usr_nate', 'payout-gate-app', 'repositories/payout-gate-app.git', 'active')
    `).run();
    await ctx.d1.prepare(`UPDATE app_listings SET repository_id = 'repo_payout_gate' WHERE id = 'payout-gate-app'`).run();

    const response = await onRequestPost({
      request: new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: 'payout-gate-app',
          name: 'Payout Gate App',
          tagline: 'Payout gate',
          version: 'v1.0.0',
          price: '$15.00',
          repositoryId: 'repo_payout_gate'
        })
      }),
      env: { DB: ctx.d1 }
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.payoutsEnabled).toBe(false);
    expect(data.productStatus).toBe('draft');
    expect(data.message).toMatch(/connect Stripe/i);
  });
});
