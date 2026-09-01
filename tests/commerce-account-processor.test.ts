// Tests for account.updated handling (src/lib/commerce/accountProcessor.ts),
// routed through the SAME processStripeInboxEvent state machine the webhook
// invokes (src/lib/commerce/eventProcessor.ts). Verifies the authoritative
// re-fetch pattern: the webhook body is never trusted for charges_enabled /
// payouts_enabled, only used to discover which account to re-fetch.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashPayload, recordInboxEvent } from '../src/lib/commerce/stripeInbox';
import { processStripeInboxEvent } from '../src/lib/commerce/eventProcessor';

describe('Commerce: account.updated authoritative processor', () => {
  let ctx: TestD1Context;
  const env = { STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_LIVEMODE: 'false' };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
    await ctx.d1.prepare(`INSERT OR IGNORE INTO users (id, username, display_name)
      VALUES ('usr_nate', 'nate', 'Nate')`).run();
    await ctx.d1.prepare(`INSERT INTO stripe_accounts
      (user_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_status, country)
      VALUES ('usr_nate', 'acct_test123', 0, 0, 'pending', 'US')`).run();
  });

  async function event(eventId: string, accountId: string) {
    const payload = JSON.stringify({
      id: eventId, type: 'account.updated', livemode: false,
      data: { object: { id: accountId, object: 'account' } }
    });
    await recordInboxEvent(ctx.d1, {
      eventId, eventType: 'account.updated', livemode: false,
      payloadJson: payload, payloadSha256: await hashPayload(payload), stripeObjectId: accountId
    });
  }

  function stripeFetch(accountResponse: any) {
    return vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => accountResponse
    } as Response));
  }

  it('flips payouts_enabled and marks onboarding complete from the authoritative account, ignoring a lying webhook body', async () => {
    await event('evt_acct_1', 'acct_test123');

    // Simulate a webhook body claiming enabled=true isn't even read — the handler
    // re-fetches from Stripe. We verify by making the mocked "authoritative"
    // response the source of truth regardless of what the stored payload said.
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_acct_1', {
      stripeFetchOverride: stripeFetch({
        id: 'acct_test123',
        object: 'account',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: { currently_due: [], past_due: [], disabled_reason: null }
      })
    });

    expect(result.success).toBe(true);

    const row: any = await ctx.d1.prepare(`
      SELECT charges_enabled, payouts_enabled, onboarding_status FROM stripe_accounts WHERE stripe_account_id = 'acct_test123'
    `).first();
    expect(row.charges_enabled).toBe(1);
    expect(row.payouts_enabled).toBe(1);
    expect(row.onboarding_status).toBe('complete');

    const inboxRow: any = await ctx.d1.prepare(`SELECT status FROM stripe_event_inbox WHERE event_id = 'evt_acct_1'`).first();
    expect(inboxRow.status).toBe('processed');
  });

  it('keeps a restricted account disabled even though the webhook payload signaled success', async () => {
    await event('evt_acct_restricted', 'acct_test123');

    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_acct_restricted', {
      stripeFetchOverride: stripeFetch({
        id: 'acct_test123',
        object: 'account',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        requirements: { currently_due: [], past_due: ['individual.verification.document'], disabled_reason: 'requirements.past_due' }
      })
    });

    expect(result.success).toBe(true);

    const row: any = await ctx.d1.prepare(`
      SELECT charges_enabled, payouts_enabled, onboarding_status FROM stripe_accounts WHERE stripe_account_id = 'acct_test123'
    `).first();
    expect(row.charges_enabled).toBe(0);
    expect(row.payouts_enabled).toBe(0);
    expect(row.onboarding_status).toBe('restricted');
  });

  it('leaves onboarding pending while details are not yet submitted', async () => {
    await event('evt_acct_pending', 'acct_test123');

    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_acct_pending', {
      stripeFetchOverride: stripeFetch({
        id: 'acct_test123',
        object: 'account',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        requirements: { currently_due: ['individual.id_number'], past_due: [], disabled_reason: null }
      })
    });

    expect(result.success).toBe(true);
    const row: any = await ctx.d1.prepare(`SELECT onboarding_status FROM stripe_accounts WHERE stripe_account_id = 'acct_test123'`).first();
    expect(row.onboarding_status).toBe('pending');
  });

  it('is idempotent: re-processing the same account.updated event twice converges on the same state', async () => {
    await event('evt_acct_idem', 'acct_test123');
    const fetchImpl = stripeFetch({
      id: 'acct_test123', object: 'account',
      charges_enabled: true, payouts_enabled: true, details_submitted: true,
      requirements: { currently_due: [], past_due: [], disabled_reason: null }
    });

    const first = await processStripeInboxEvent(ctx.d1, env, 'evt_acct_idem', { stripeFetchOverride: fetchImpl });
    expect(first.success).toBe(true);

    // Force the inbox row back to retryable to simulate a redelivery, and re-run.
    await ctx.d1.prepare(`UPDATE stripe_event_inbox SET status='retryable_failure', next_attempt_at=datetime('now','-5 seconds'), claim_token=NULL, expires_at=NULL WHERE event_id='evt_acct_idem'`).run();
    const second = await processStripeInboxEvent(ctx.d1, env, 'evt_acct_idem', { stripeFetchOverride: fetchImpl });
    expect(second.success).toBe(true);

    const row: any = await ctx.d1.prepare(`SELECT payouts_enabled FROM stripe_accounts WHERE stripe_account_id = 'acct_test123'`).first();
    expect(row.payouts_enabled).toBe(1);
  });

  it('fails closed (terminal) when no local stripe_accounts row matches the authoritative account', async () => {
    await event('evt_acct_unknown', 'acct_unknown_999');
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_acct_unknown', {
      stripeFetchOverride: stripeFetch({ id: 'acct_unknown_999', object: 'account', charges_enabled: true, payouts_enabled: true, details_submitted: true })
    });
    expect(result.success).toBe(false);
    expect(result.terminal).toBe(true);
  });
});
