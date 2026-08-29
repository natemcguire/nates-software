import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashPayload, recordInboxEvent } from '../src/lib/commerce/stripeInbox';
import { processStripeInboxEvent } from '../src/lib/commerce/eventProcessor';

describe('Commerce P4 authoritative refund processor', () => {
  let ctx: TestD1Context;
  const env = { STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_LIVEMODE: 'false' };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
    await ctx.d1.prepare(`INSERT INTO commerce_orders
      (id,idempotency_key,buyer_user_id,app_id,seller_user_id,app_version,price_version,
       gross_cents,currency,lineage_snapshot_json,stripe_payment_intent_id,status,state_version,
       paid_at,fulfilled_at)
      VALUES ('ord_refund','idem_refund','usr_josh','dronehunter','usr_nate','1.0.0',1,
              1500,'usd','{}','pi_refund','fulfilled',1,datetime('now'),datetime('now'))`).run();
    await ctx.d1.prepare(`INSERT INTO commerce_order_allocations
      (id,order_id,sequence,role,recipient_user_id,basis_points,amount_cents)
      VALUES ('alloc_maker','ord_refund',0,'maker','usr_nate',9000,1350),
             ('alloc_pool','ord_refund',1,'protocol_pool',NULL,1000,150)`).run();
    await ctx.d1.prepare(`INSERT INTO commerce_licenses
      (id,order_id,app_id,owner_user_id,license_key_hash,license_key_last4,status)
      VALUES ('lic_refund','ord_refund','dronehunter','usr_josh',?, 'ABCD','active')`)
      .bind('a'.repeat(64)).run();
    await ctx.d1.prepare(`INSERT INTO commerce_transfer_outbox
      (id,order_id,allocation_id,destination_user_id,amount_cents,currency,status,
       stripe_idempotency_key)
      VALUES ('cto_refund','ord_refund','alloc_maker','usr_nate',1350,'usd','pending','transfer:cto_refund')`).run();
  });

  async function event(eventId: string, refundId: string) {
    const payload = JSON.stringify({
      id: eventId, type: 'refund.updated', livemode: false,
      data: { object: { id: refundId } }
    });
    await recordInboxEvent(ctx.d1, {
      eventId, eventType: 'refund.updated', livemode: false,
      payloadJson: payload, payloadSha256: await hashPayload(payload), stripeObjectId: refundId
    });
  }

  function stripeRefund(id: string, amount: number, status = 'succeeded') {
    return {
      ok: true,
      json: async () => ({
        id, object: 'refund', amount, charge: 'ch_refund', payment_intent: 'pi_refund',
        currency: 'usd', status, livemode: false, reason: 'requested_by_customer'
      })
    } as Response;
  }

  function stripeFetch(refundResponse: Response, piOverrides: Record<string, unknown> = {}) {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/payment_intents/')) return {
        ok: true,
        json: async () => ({
          id: 'pi_refund', object: 'payment_intent', amount: 1500, currency: 'usd',
          latest_charge: 'ch_refund', livemode: false, ...piOverrides
        })
      } as Response;
      return refundResponse;
    });
  }

  it('persists an exact partial refund and maker recovery obligation atomically', async () => {
    await event('evt_refund_1', 're_partial_1');
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_refund_1', {
      stripeFetchOverride: stripeFetch(stripeRefund('re_partial_1', 500))
    });
    expect(result).toMatchObject({ success: true, orderId: 'ord_refund', status: 'fulfilled' });

    const order: any = await ctx.d1.prepare(`SELECT status,refunded_cents FROM commerce_orders WHERE id='ord_refund'`).first();
    expect(order).toMatchObject({ status: 'fulfilled', refunded_cents: 500 });
    const allocations: any = await ctx.d1.prepare(`SELECT sequence,amount_cents FROM commerce_refund_allocations ORDER BY sequence`).all();
    expect(allocations.results).toEqual([{ sequence: 0, amount_cents: 450 }, { sequence: 1, amount_cents: 50 }]);
    const recovery: any = await ctx.d1.prepare(`SELECT amount_cents,status,original_outbox_id FROM commerce_recovery_obligations`).first();
    expect(recovery).toMatchObject({ amount_cents: 450, status: 'pending', original_outbox_id: 'cto_refund' });
  });

  it('uses cumulative targets across partial refunds and revokes only at full refund', async () => {
    await event('evt_refund_a', 're_partial_a');
    await processStripeInboxEvent(ctx.d1, env, 'evt_refund_a', {
      stripeFetchOverride: stripeFetch(stripeRefund('re_partial_a', 499))
    });
    await event('evt_refund_b', 're_partial_b');
    await processStripeInboxEvent(ctx.d1, env, 'evt_refund_b', {
      stripeFetchOverride: stripeFetch(stripeRefund('re_partial_b', 1001))
    });

    const order: any = await ctx.d1.prepare(`SELECT status,refunded_cents FROM commerce_orders WHERE id='ord_refund'`).first();
    expect(order).toMatchObject({ status: 'refunded', refunded_cents: 1500 });
    const license: any = await ctx.d1.prepare(`SELECT status,revoked_at FROM commerce_licenses WHERE order_id='ord_refund'`).first();
    expect(license.status).toBe('refunded');
    expect(license.revoked_at).toBeTruthy();
    const totals: any = await ctx.d1.prepare(`SELECT allocation_id,SUM(amount_cents) total
      FROM commerce_refund_allocations GROUP BY allocation_id ORDER BY allocation_id`).all();
    expect(totals.results).toEqual([
      { allocation_id: 'alloc_maker', total: 1350 },
      { allocation_id: 'alloc_pool', total: 150 }
    ]);
  });

  it('records non-succeeded authoritative state without changing economics', async () => {
    await event('evt_refund_pending', 're_pending');
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_refund_pending', {
      stripeFetchOverride: stripeFetch(stripeRefund('re_pending', 500, 'pending'))
    });
    expect(result).toMatchObject({ success: true, status: 'pending' });
    const order: any = await ctx.d1.prepare(`SELECT refunded_cents FROM commerce_orders WHERE id='ord_refund'`).first();
    expect(order.refunded_cents).toBe(0);
  });

  it('rejects event payload authority and mismatched live mode', async () => {
    await event('evt_refund_live', 're_live');
    const response = stripeRefund('re_live', 500);
    const body = await response.json();
    const result = await processStripeInboxEvent(ctx.d1, env, 'evt_refund_live', {
      stripeFetchOverride: stripeFetch({ ok: true, json: async () => body } as Response, { livemode: true })
    });
    expect(result).toMatchObject({ success: false, terminal: true });
    const row: any = await ctx.d1.prepare(`SELECT status FROM stripe_event_inbox WHERE event_id='evt_refund_live'`).first();
    expect(row.status).toBe('terminal_failure');
  });
});
