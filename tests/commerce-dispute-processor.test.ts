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

  function disputeFetch(disputeResponse: Response, paymentIntentId = 'pi_dispute') {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/charges/')) return {
        ok: true,
        json: async () => ({ id: 'ch_dispute', object: 'charge', payment_intent: paymentIntentId })
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
    // role — maker, ancestor, AND contributor — not just maker/ancestor. Use a dedicated
    // order (gross_cents is immutable once an order exists) whose allocations conserve
    // gross_cents exactly (maker 1350 + pool 150 + contributor 300 = 1800), matching the
    // same conservation invariant calculateRefundAllocationDelta enforces for refunds.
    await ctx.d1.prepare(`INSERT INTO commerce_orders
      (id,idempotency_key,buyer_user_id,app_id,seller_user_id,app_version,price_version,
       gross_cents,currency,lineage_snapshot_json,stripe_payment_intent_id,status,state_version,
       paid_at,fulfilled_at)
      VALUES ('ord_dispute_contrib','idem_dispute_contrib','usr_josh','dronehunter','usr_nate','1.0.0',1,
              1800,'usd','{}','pi_dispute_contrib','fulfilled',1,datetime('now'),datetime('now'))`).run();
    await ctx.d1.prepare(`INSERT INTO commerce_order_allocations
      (id,order_id,sequence,role,recipient_user_id,basis_points,amount_cents)
      VALUES ('alloc_maker_dc','ord_dispute_contrib',0,'maker','usr_nate',7500,1350),
             ('alloc_pool_dc','ord_dispute_contrib',1,'protocol_pool',NULL,833,150),
             ('alloc_contrib_dc','ord_dispute_contrib',2,'contributor','usr_sam',1667,300)`).run();
    await ctx.d1.prepare(`INSERT INTO commerce_transfer_outbox
      (id,order_id,allocation_id,destination_user_id,amount_cents,currency,status,stripe_idempotency_key)
      VALUES ('cto_dispute_maker_dc','ord_dispute_contrib','alloc_maker_dc','usr_nate',1350,'usd','succeeded','transfer:cto_dispute_maker_dc'),
             ('cto_dispute_contrib','ord_dispute_contrib','alloc_contrib_dc','usr_sam',300,'usd','succeeded','transfer:cto_dispute_contrib')`).run();

    // A FULL dispute on this order is 1800 (its fully-conserved gross_cents).
    await event('evt_dispute_lost_c', 'charge.dispute.closed', 'dp_lost_c');
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_lost_c', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_lost_c', 'lost', 1800), 'pi_dispute_contrib')
    });
    expect(result).toMatchObject({ success: true, orderId: 'ord_dispute_contrib' });

    // A recovery obligation must exist for the contributor allocation (300c).
    const contribObligation: any = await ctx.d1.prepare(`
      SELECT amount_cents, status, source_kind, original_outbox_id
      FROM commerce_recovery_obligations
      WHERE order_id='ord_dispute_contrib' AND allocation_id='alloc_contrib_dc'
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
      WHERE order_id='ord_dispute_contrib' AND allocation_id='alloc_pool_dc'
    `).first();
    expect(poolObligation.n).toBe(0);

    // Money conservation: maker + contributor recovery must sum to exactly the payable
    // portion of the full dispute (pool's 150c share needs no recovery — never paid out).
    const total: any = await ctx.d1.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS total FROM commerce_recovery_obligations
      WHERE order_id='ord_dispute_contrib'
    `).first();
    expect(total.total).toBe(1650);
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

  // Regression for Codex Critical #1: a PARTIAL Stripe dispute (dispute.amount strictly
  // less than order gross_cents) must claw back EXACTLY its own amount, pro-rata across
  // the payable allocations — never the allocations' full frozen amounts.
  it('claws back EXACTLY the partial dispute amount, pro-rata, never the full frozen allocations (money conservation)', async () => {
    // gross 2000: maker 1200, ancestor 400, contributor 200, protocol_pool 200.
    await ctx.d1.prepare(`INSERT INTO commerce_orders
      (id,idempotency_key,buyer_user_id,app_id,seller_user_id,app_version,price_version,
       gross_cents,currency,lineage_snapshot_json,stripe_payment_intent_id,status,state_version,
       paid_at,fulfilled_at)
      VALUES ('ord_dispute_partial','idem_dispute_partial','usr_josh','dronehunter','usr_nate','1.0.0',1,
              2000,'usd','{}','pi_dispute_partial','fulfilled',1,datetime('now'),datetime('now'))`).run();
    await ctx.d1.prepare(`INSERT INTO commerce_order_allocations
      (id,order_id,sequence,role,recipient_user_id,basis_points,amount_cents)
      VALUES ('alloc_maker_p','ord_dispute_partial',0,'maker','usr_nate',6000,1200),
             ('alloc_ancestor_p','ord_dispute_partial',1,'ancestor','usr_josh',2000,400),
             ('alloc_contrib_p','ord_dispute_partial',2,'contributor','usr_sam',1000,200),
             ('alloc_pool_p','ord_dispute_partial',3,'protocol_pool',NULL,1000,200)`).run();
    await ctx.d1.prepare(`INSERT INTO commerce_transfer_outbox
      (id,order_id,allocation_id,destination_user_id,amount_cents,currency,status,stripe_idempotency_key)
      VALUES ('cto_maker_p','ord_dispute_partial','alloc_maker_p','usr_nate',1200,'usd','succeeded','transfer:cto_maker_p'),
             ('cto_ancestor_p','ord_dispute_partial','alloc_ancestor_p','usr_josh',400,'usd','succeeded','transfer:cto_ancestor_p'),
             ('cto_contrib_p','ord_dispute_partial','alloc_contrib_p','usr_sam',200,'usd','succeeded','transfer:cto_contrib_p')`).run();

    // Stripe reports a PARTIAL lost dispute: 500c of the 2000c order.
    await event('evt_dispute_partial', 'charge.dispute.closed', 'dp_partial_1');
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_partial', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_partial_1', 'lost', 500), 'pi_dispute_partial')
    });
    expect(result).toMatchObject({ success: true, orderId: 'ord_dispute_partial' });

    const obligations: any = await ctx.d1.prepare(`
      SELECT allocation_id, amount_cents FROM commerce_recovery_obligations
      WHERE order_id='ord_dispute_partial' ORDER BY allocation_id
    `).all();

    // The over-claw bug would have opened obligations for the FULL frozen amounts
    // (1200 + 400 + 200 = 1800). The fix must claw back a pro-rata SLICE of the 500c
    // dispute — never the allocations' full amounts, and never protocol_pool.
    for (const row of obligations.results as any[]) {
      expect(row.allocation_id).not.toBe('alloc_pool_p');
    }

    // Exact deterministic pro-rata split of 500c weighted by each allocation's own
    // frozen amount (1200:400:200, i.e. 60%:20%:10% of the 2000c gross):
    // maker 300c, ancestor 100c, contributor 50c — summing to 450c of REAL recovery.
    const byAllocation = new Map((obligations.results as any[]).map((row) => [row.allocation_id, row.amount_cents]));
    expect(byAllocation.get('alloc_maker_p')).toBe(300);
    expect(byAllocation.get('alloc_ancestor_p')).toBe(100);
    expect(byAllocation.get('alloc_contrib_p')).toBe(50);

    const payableTotal = (obligations.results as any[]).reduce((sum, row) => sum + row.amount_cents, 0);
    expect(payableTotal).toBe(450);
    expect(payableTotal).toBeLessThan(1800); // strictly less than the over-claw bug's total

    // The core conservation assertion: sum of ALL pro-rata deltas — the 450c of real
    // payable recovery PLUS protocol_pool's implicit (uninserted, since it was never
    // paid out) 50c share of the same 10% basis-point cut — equals EXACTLY the
    // dispute's own amount, 500c. Nothing more, nothing less.
    const poolImplicitShare = 500 - payableTotal;
    expect(poolImplicitShare).toBe(50);
    expect(payableTotal + poolImplicitShare).toBe(500);

    // No allocation may be clawed back beyond its own frozen amount.
    expect(byAllocation.get('alloc_maker_p')).toBeLessThanOrEqual(1200);
    expect(byAllocation.get('alloc_ancestor_p')).toBeLessThanOrEqual(400);
    expect(byAllocation.get('alloc_contrib_p')).toBeLessThanOrEqual(200);
  });

  // Regression for Codex High #3: winning ONE dispute must not clear the order back to
  // 'fulfilled' while ANOTHER dispute on the same order is still open/unresolved.
  it('does NOT revert the order to fulfilled when another dispute is still open', async () => {
    // Dispute A opens first, advancing the order to 'disputed'.
    await event('evt_dispute_a_open', 'charge.dispute.created', 'dp_a');
    await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_a_open', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_a', 'needs_response'))
    });

    // Dispute B also opens against the SAME order (e.g. a second card network dispute).
    await event('evt_dispute_b_open', 'charge.dispute.created', 'dp_b');
    const bResult = await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_b_open', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_b', 'needs_response'))
    });
    expect(bResult).toMatchObject({ success: true, orderId: 'ord_dispute' });

    const disputed: any = await ctx.d1.prepare(`SELECT status FROM commerce_orders WHERE id='ord_dispute'`).first();
    expect(disputed.status).toBe('disputed');

    // Dispute A now closes WON. Dispute B is still 'needs_response' (unresolved).
    await event('evt_dispute_a_won', 'charge.dispute.closed', 'dp_a');
    const wonResult = await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_a_won', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_a', 'won'))
    });
    expect(wonResult).toMatchObject({ success: true, orderId: 'ord_dispute' });
    // The buggy code would report 'fulfilled' unconditionally here.
    expect(wonResult.status).not.toBe('fulfilled');

    // The order must STILL be 'disputed' — dispute B remains unresolved.
    const order: any = await ctx.d1.prepare(`SELECT status FROM commerce_orders WHERE id='ord_dispute'`).first();
    expect(order.status).toBe('disputed');

    // The dispute_won audit event was still durably recorded for dispute A.
    const wonEvent: any = await ctx.d1.prepare(`
      SELECT COUNT(*) AS n FROM commerce_order_events
      WHERE order_id='ord_dispute' AND event_type='dispute_won'
    `).first();
    expect(wonEvent.n).toBe(1);

    // Now dispute B also resolves WON — only now should the order revert to fulfilled.
    await event('evt_dispute_b_won', 'charge.dispute.closed', 'dp_b');
    const finalResult = await processStripeInboxEvent(ctx.d1, env, 'evt_dispute_b_won', {
      stripeFetchOverride: disputeFetch(stripeDispute('dp_b', 'won'))
    });
    expect(finalResult).toMatchObject({ success: true, status: 'fulfilled' });
    const finalOrder: any = await ctx.d1.prepare(`SELECT status FROM commerce_orders WHERE id='ord_dispute'`).first();
    expect(finalOrder.status).toBe('fulfilled');
  });
});
