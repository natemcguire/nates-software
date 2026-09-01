// Tests for charge.dispute.* handling (src/lib/commerce/disputeProcessor.ts),
// routed through processStripeInboxEvent (src/lib/commerce/eventProcessor.ts).
// Mirrors the shape of tests/commerce-refund-processor.test.ts: authoritative
// re-fetch of the Dispute + its Charge, never trusting the webhook body.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashPayload, recordInboxEvent } from '../src/lib/commerce/stripeInbox';
import { processStripeInboxEvent } from '../src/lib/commerce/eventProcessor';

describe('Commerce: charge.dispute.* authoritative processor', () => {
  let ctx: TestD1Context;
  const env = { STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_LIVEMODE: 'false' };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
    await ctx.d1.prepare(`INSERT INTO commerce_orders
      (id,idempotency_key,buyer_user_id,app_id,seller_user_id,app_version,price_version,
       gross_cents,currency,lineage_snapshot_json,stripe_payment_intent_id,status,state_version,
       paid_at,fulfilled_at)
      VALUES ('ord_dispute','idem_dispute','usr_josh','dronehunter','usr_nate','1.0.0',1,
              1500,'usd','{}','pi_dispute','fulfilled',1,datetime('now'),datetime('now'))`).run();
    await ctx.d1.prepare(`INSERT INTO commerce_order_allocations
      (id,order_id,sequence,role,recipient_user_id,basis_points,amount_cents)
      VALUES ('alloc_maker_d','ord_dispute',0,'maker','usr_nate',9000,1350),
             ('alloc_pool_d','ord_dispute',1,'protocol_pool',NULL,1000,150)`).run();
    await ctx.d1.prepare(`INSERT INTO commerce_transfer_outbox
      (id,order_id,allocation_id,destination_user_id,amount_cents,currency,status,
       stripe_idempotency_key)
      VALUES ('cto_dispute','ord_dispute','alloc_maker_d','usr_nate',1350,'usd','succeeded','transfer:cto_dispute')`).run();
  });

  async function event(eventId: string, eventType: string, disputeId: string) {
    const payload = JSON.stringify({
      id: eventId, type: eventType, livemode: false,
      data: { object: { id: disputeId } }
    });
    await recordInboxEvent(ctx.d1, {
      eventId, eventType, livemode: false,
      payloadJson: payload, payloadSha256: await hashPayload(payload), stripeObjectId: disputeId
    });
  }

  function stripeDispute(id: string, status: string, amount = 1500) {
    return {
      ok: true,
      json: async () => ({
        id, object: 'dispute', amount, currency: 'usd', charge: 'ch_dispute',
        status, livemode: false, reason: 'fraudulent',
        created: Math.floor(Date.now() / 1000)
      })
    } as Response;
  }

  function disputeFetch(disputeResponse: Response) {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/charges/')) return {
        ok: true,
        json: async () => ({ id: 'ch_dispute', object: 'charge', payment_intent: 'pi_dispute' })
      } as Response;
      return disputeResponse;
    });
  }

  it('records an opened dispute and advances the order to disputed without moving money', async () => {
    await event('evt_dispute_open', 'charge.dispute.created', 'dp_open_1');
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_open', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_open_1', 'needs_response'))
    });
    expect(result).toMatchObject({ success: true, orderId: 'ord_dispute', status: 'disputed' });

    const order: any = await ctx.d1.prepare(`SELECT status FROM commerce_orders WHERE id='ord_dispute'`).first();
    expect(order.status).toBe('disputed');

    const obligations: any = await ctx.d1.prepare(`SELECT COUNT(*) AS n FROM commerce_recovery_obligations WHERE order_id='ord_dispute'`).first();
    expect(obligations.n).toBe(0);
  });

  it('opens a recovery obligation for the maker allocation when a dispute is lost', async () => {
    await event('evt_dispute_lost', 'charge.dispute.closed', 'dp_lost_1');
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_lost', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_lost_1', 'lost'))
    });
    expect(result).toMatchObject({ success: true, orderId: 'ord_dispute' });

    const obligation: any = await ctx.d1.prepare(`
      SELECT amount_cents, status, source_kind, original_outbox_id
      FROM commerce_recovery_obligations WHERE order_id='ord_dispute'
    `).first();
    expect(obligation).toMatchObject({
      amount_cents: 1350,
      status: 'pending',
      source_kind: 'dispute',
      original_outbox_id: 'cto_dispute'
    });

    const dispute: any = await ctx.d1.prepare(`SELECT status FROM commerce_disputes WHERE stripe_dispute_id='dp_lost_1'`).first();
    expect(dispute.status).toBe('lost');
  });

  it('claws back the CONTRIBUTOR allocation too when a dispute is lost (money conservation)', async () => {
    // Regression for the seam bug: a lost dispute must recover from every payable
    // role — maker, ancestor, AND contributor — not just maker/ancestor. Add a
    // contributor allocation (+ its completed transfer) to the disputed order.
    await ctx.d1.prepare(`INSERT INTO commerce_order_allocations
      (id,order_id,sequence,role,recipient_user_id,basis_points,amount_cents)
      VALUES ('alloc_contrib_d','ord_dispute',2,'contributor','usr_sam',2000,300)`).run();
    await ctx.d1.prepare(`INSERT INTO commerce_transfer_outbox
      (id,order_id,allocation_id,destination_user_id,amount_cents,currency,status,stripe_idempotency_key)
      VALUES ('cto_dispute_contrib','ord_dispute','alloc_contrib_d','usr_sam',300,'usd','succeeded','transfer:cto_dispute_contrib')`).run();

    await event('evt_dispute_lost_c', 'charge.dispute.closed', 'dp_lost_c');
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_lost_c', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_lost_c', 'lost'))
    });
    expect(result).toMatchObject({ success: true, orderId: 'ord_dispute' });

    // A recovery obligation must exist for the contributor allocation (300c).
    const contribObligation: any = await ctx.d1.prepare(`
      SELECT amount_cents, status, source_kind, original_outbox_id
      FROM commerce_recovery_obligations
      WHERE order_id='ord_dispute' AND allocation_id='alloc_contrib_d'
    `).first();
    expect(contribObligation).toMatchObject({
      amount_cents: 300,
      status: 'pending',
      source_kind: 'dispute',
      original_outbox_id: 'cto_dispute_contrib'
    });

    // The protocol pool is never paid, so it never gets a recovery obligation.
    const poolObligation: any = await ctx.d1.prepare(`
      SELECT COUNT(*) AS n FROM commerce_recovery_obligations
      WHERE order_id='ord_dispute' AND allocation_id='alloc_pool_d'
    `).first();
    expect(poolObligation.n).toBe(0);
  });

  it('is idempotent: reprocessing a lost dispute does not open a second obligation', async () => {
    await event('evt_dispute_lost_a', 'charge.dispute.closed', 'dp_lost_2');
    await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_lost_a', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_lost_2', 'lost'))
    });

    // A second delivery for the same dispute (e.g. a redelivered webhook).
    await event('evt_dispute_lost_b', 'charge.dispute.closed', 'dp_lost_2');
    await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_lost_b', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_lost_2', 'lost'))
    });

    const count: any = await ctx.d1.prepare(`
      SELECT COUNT(*) AS n FROM commerce_recovery_obligations WHERE source_id='dp_lost_2'
    `).first();
    expect(count.n).toBe(1);
  });

  it('reverts the order to fulfilled when a dispute is won', async () => {
    await event('evt_dispute_open_2', 'charge.dispute.created', 'dp_win_1');
    await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_open_2', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_win_1', 'needs_response'))
    });
    const disputed: any = await ctx.d1.prepare(`SELECT status FROM commerce_orders WHERE id='ord_dispute'`).first();
    expect(disputed.status).toBe('disputed');

    await event('evt_dispute_won', 'charge.dispute.closed', 'dp_win_1');
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_won', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_win_1', 'won'))
    });
    expect(result).toMatchObject({ success: true, status: 'fulfilled' });

    const order: any = await ctx.d1.prepare(`SELECT status FROM commerce_orders WHERE id='ord_dispute'`).first();
    expect(order.status).toBe('fulfilled');

    const obligations: any = await ctx.d1.prepare(`SELECT COUNT(*) AS n FROM commerce_recovery_obligations WHERE order_id='ord_dispute'`).first();
    expect(obligations.n).toBe(0);
  });
});
