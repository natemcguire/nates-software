import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestGet } from '../functions/api/profile';
import { hashSessionToken } from '../functions/api/_session';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';

describe('profile earnings breakdown', () => {
  let ctx: TestD1Context;
  const sessionToken = 'profile_earnings_token';

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, role)
      VALUES
        ('usr_profile_buyer', 'profile_buyer', 'Profile Buyer', 'user'),
        ('usr_profile_ancestor', 'profile_ancestor', 'Profile Ancestor', 'maker')
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, 'usr_nate', ?)
    `).bind(await hashSessionToken(sessionToken), Date.now() + 100000).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_orders (
        id, idempotency_key, buyer_user_id, app_id, seller_user_id, app_version,
        price_version, gross_cents, currency, lineage_snapshot_json, status, fulfilled_at
      ) VALUES (
        'ord_profile_earnings', 'idem_profile_earnings', 'usr_profile_buyer', 'dronehunter', 'usr_nate', 'v1.0.0',
        1, 2000, 'usd', '{}', 'fulfilled', CURRENT_TIMESTAMP
      )
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations (
        id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
      ) VALUES
        ('alloc_profile_ancestor', 'ord_profile_earnings', 1, 'ancestor', 'usr_profile_ancestor', 1111, 200),
        ('alloc_profile_seller', 'ord_profile_earnings', 2, 'seller', 'usr_nate', NULL, 1600),
        ('alloc_profile_platform', 'ord_profile_earnings', 3, 'platform', NULL, NULL, 200)
    `).run();
    await ctx.d1.prepare(`
      INSERT INTO commerce_transfer_outbox (
        id, order_id, allocation_id, destination_user_id, amount_cents, currency,
        status, stripe_transfer_id, completed_at
      ) VALUES (
        'transfer_profile_seller', 'ord_profile_earnings', 'alloc_profile_seller', 'usr_nate', 1600, 'usd',
        'succeeded', 'tr_profile_seller', CURRENT_TIMESTAMP
      )
    `).run();
  });

  it('separates sales, fees, upstream royalties, earnings, and payout state', async () => {
    const response = await onRequestGet({
      request: new Request('http://localhost/api/profile', {
        headers: { Authorization: `Bearer ${sessionToken}` }
      }),
      env: { DB: ctx.d1 }
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.royalties).toMatchObject({
      grossSalesCents: 2000,
      platformFeesCents: 200,
      upstreamRoyaltiesPaidCents: 200,
      netEarningsCents: 1600,
      availableForPayoutCents: 0,
      pendingPayoutCents: 0,
      paidOutCents: 1600
    });
  });
});
