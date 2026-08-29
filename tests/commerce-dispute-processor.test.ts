import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { hashPayload, recordInboxEvent } from '../src/lib/commerce/stripeInbox';
import { processStripeInboxEvent } from '../src/lib/commerce/eventProcessor';

describe('Commerce P4 authoritative dispute processor', () => {
  let ctx: TestD1Context;
  const env = { STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_LIVEMODE: 'false' };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();

    // Seed test users
    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name)
      VALUES ('usr_buyer', 'buyer_user_123', 'Buyer'),
             ('usr_ancestor1', 'anc1_user', 'Ancestor 1'),
             ('usr_ancestor2', 'anc2_user', 'Ancestor 2')
    `).run();


    // Seed standard root order ($15.00, maker 90% = $13.50, pool 10% = $1.50)
    await ctx.d1.prepare(`
      INSERT INTO commerce_orders
        (id, idempotency_key, buyer_user_id, app_id, seller_user_id, app_version, price_version,
         gross_cents, currency, lineage_snapshot_json, stripe_payment_intent_id, status, state_version,
         paid_at, fulfilled_at)
      VALUES ('ord_dispute', 'idem_dispute', 'usr_buyer', 'dronehunter', 'usr_nate', '1.0.0', 1,
              1500, 'usd', '{}', 'pi_dispute', 'fulfilled', 1, datetime('now'), datetime('now'))
    `).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_order_allocations
        (id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents)
      VALUES ('alloc_maker', 'ord_dispute', 0, 'maker', 'usr_nate', 9000, 1350),
             ('alloc_pool', 'ord_dispute', 1, 'protocol_pool', NULL, 1000, 150)
    `).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_licenses
        (id, order_id, app_id, owner_user_id, license_key_hash, license_key_last4, status)
      VALUES ('lic_dispute', 'ord_dispute', 'dronehunter', 'usr_buyer', ?, 'ABCD', 'active')
    `).bind('a'.repeat(64)).run();

    await ctx.d1.prepare(`
      INSERT INTO commerce_transfer_outbox
        (id, order_id, allocation_id, destination_user_id, amount_cents, currency, status,
         stripe_idempotency_key)
      VALUES ('cto_dispute', 'ord_dispute', 'alloc_maker', 'usr_nate', 1350, 'usd', 'pending', 'transfer:cto_dispute')
    `).run();
  });

  async function recordDisputeEvent(
    eventId: string,
    disputeId: string,
    eventType = 'charge.dispute.created',
    livemode = false
  ) {
    const payload = JSON.stringify({
      id: eventId,
      type: eventType,
      livemode,
      data: { object: { id: disputeId } }
    });
    await recordInboxEvent(ctx.d1, {
      eventId,
      eventType,
      livemode,
      payloadJson: payload,
      payloadSha256: await hashPayload(payload),
      stripeObjectId: disputeId
    });
  }

  function mockStripeDispute(
    id: string,
    status = 'needs_response',
    amount = 1500,
    overrides: Record<string, unknown> = {}
  ) {
    return {
      id,
      object: 'dispute',
      amount,
      currency: 'usd',
      charge: 'ch_dispute',
      payment_intent: 'pi_dispute',
      status,
      livemode: false,
      reason: 'fraudulent',
      created: 1724918400,
      evidence_details: {
        due_by: 1725523200,
        has_evidence: false,
        submission_count: 0
      },
      ...overrides
    };
  }

  function mockStripePaymentIntent(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pi_dispute',
      object: 'payment_intent',
      amount: 1500,
      currency: 'usd',
      latest_charge: 'ch_dispute',
      livemode: false,
      status: 'succeeded',
      ...overrides
    };
  }

  function createStripeFetch(disputeObj: any, piObj: any = mockStripePaymentIntent()) {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/payment_intents/')) {
        return {
          ok: true,
          status: 200,
          json: async () => piObj
        } as Response;
      }
      if (url.includes('/disputes/')) {
        return {
          ok: true,
          status: 200,
          json: async () => disputeObj
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) } as Response;
    });
  }

  // ==========================================================================
  // 1. EVENT SIGNAL SUPPORT (created, updated, closed, funds withdrawn/reinstated)
  // ==========================================================================
  describe('1. Event Signal Handling', () => {
    it.each([
      'charge.dispute.created',
      'charge.dispute.updated',
      'charge.dispute.closed',
      'charge.dispute.funds_withdrawn',
      'charge.dispute.funds_reinstated'
    ])('successfully processes event signal %s', async (eventType) => {
      const eventId = `evt_${eventType.replace(/\./g, '_')}`;
      const disputeId = 'dp_signal_test';
      await recordDisputeEvent(eventId, disputeId, eventType);

      const status = eventType === 'charge.dispute.closed' ? 'won' : 'under_review';
      const dispute = mockStripeDispute(disputeId, status);
      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(dispute)
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe('ord_dispute');

      // Verify inbox marked processed
      const inboxRow: any = await ctx.d1.prepare('SELECT status FROM stripe_event_inbox WHERE event_id = ?').bind(eventId).first();
      expect(inboxRow.status).toBe('processed');

      // Verify observation appended
      const obs: any = await ctx.d1.prepare('SELECT * FROM commerce_dispute_observations WHERE event_id = ?').bind(eventId).first();
      expect(obs).toBeTruthy();
      expect(obs.observed_status).toBe(status);
    });
  });

  // ==========================================================================
  // 2. WARNING / INQUIRY LIFECYCLE
  // ==========================================================================
  describe('2. Warning / Inquiry Lifecycle', () => {
    it('records warning inquiry without revoking license or changing order status', async () => {
      const eventId = 'evt_dispute_warn';
      const disputeId = 'dp_warning_1';
      await recordDisputeEvent(eventId, disputeId, 'charge.dispute.created');

      const dispute = mockStripeDispute(disputeId, 'warning_needs_response');
      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(dispute)
      });

      expect(result).toMatchObject({ success: true, orderId: 'ord_dispute', status: 'warning_needs_response' });

      // Order should remain fulfilled
      const order: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = "ord_dispute"').first();
      expect(order.status).toBe('fulfilled');

      // License should remain active
      const lic: any = await ctx.d1.prepare('SELECT status, revoked_at FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(lic.status).toBe('active');
      expect(lic.revoked_at).toBeNull();

      // Dispute record should be created
      const disp: any = await ctx.d1.prepare('SELECT * FROM commerce_disputes WHERE stripe_dispute_id = ?').bind(disputeId).first();
      expect(disp.status).toBe('warning_needs_response');
      expect(disp.closed_at).toBeNull();
    });

    it('handles warning_closed correctly', async () => {
      const eventId = 'evt_warn_closed';
      const disputeId = 'dp_warning_closed';
      await recordDisputeEvent(eventId, disputeId, 'charge.dispute.closed');

      const dispute = mockStripeDispute(disputeId, 'warning_closed');
      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(dispute)
      });

      expect(result.success).toBe(true);

      const disp: any = await ctx.d1.prepare('SELECT status, closed_at FROM commerce_disputes WHERE stripe_dispute_id = ?').bind(disputeId).first();
      expect(disp.status).toBe('warning_closed');
      expect(disp.closed_at).toBeTruthy();
    });
  });

  // ==========================================================================
  // 3. ACTIVE DISPUTE (needs_response, under_review): LICENSE REVOCATION
  // ==========================================================================
  describe('3. Active Dispute & License Revocation', () => {
    it('revokes license and marks order disputed on needs_response', async () => {
      const eventId = 'evt_needs_resp';
      const disputeId = 'dp_needs_resp';
      await recordDisputeEvent(eventId, disputeId, 'charge.dispute.created');

      const dispute = mockStripeDispute(disputeId, 'needs_response');
      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(dispute)
      });

      expect(result).toMatchObject({ success: true, orderId: 'ord_dispute', status: 'disputed' });

      // Order should transition to disputed
      const order: any = await ctx.d1.prepare('SELECT status, state_version FROM commerce_orders WHERE id = "ord_dispute"').first();
      expect(order.status).toBe('disputed');
      expect(order.state_version).toBe(2);

      // License should be revoked
      const lic: any = await ctx.d1.prepare('SELECT status, revoked_at FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(lic.status).toBe('revoked');
      expect(lic.revoked_at).toBeTruthy();

      // Audit event logged
      const audit: any = await ctx.d1.prepare('SELECT event_type, details_json FROM commerce_order_events WHERE order_id = "ord_dispute"').first();
      expect(audit.event_type).toBe('order_disputed');
    });

    it('transitions from needs_response to under_review monotonically', async () => {
      // 1. Initial needs_response
      const event1 = 'evt_step_1';
      const disputeId = 'dp_step_test';
      await recordDisputeEvent(event1, disputeId, 'charge.dispute.created');
      await processStripeInboxEvent(ctx.d1, env, event1, {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'needs_response'))
      });

      // 2. Updated to under_review
      const event2 = 'evt_step_2';
      await recordDisputeEvent(event2, disputeId, 'charge.dispute.updated');
      const result2 = await processStripeInboxEvent(ctx.d1, env, event2, {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'under_review'))
      });

      expect(result2.success).toBe(true);

      const disp: any = await ctx.d1.prepare('SELECT status FROM commerce_disputes WHERE stripe_dispute_id = ?').bind(disputeId).first();
      expect(disp.status).toBe('under_review');

      // Check both observations are persisted
      const observations: any = await ctx.d1.prepare('SELECT observed_status FROM commerce_dispute_observations ORDER BY observed_at').all();
      expect(observations.results).toEqual([
        { observed_status: 'needs_response' },
        { observed_status: 'under_review' }
      ]);
    });
  });

  // ==========================================================================
  // 4. LOST DISPUTE & EXACT RECOVERY OBLIGATIONS (NO DOUBLE RECOVERY)
  // ==========================================================================
  describe('4. Lost Dispute & Recovery Obligations', () => {
    it('creates exact recovery obligation for maker on lost root dispute without refunds', async () => {
      const eventId = 'evt_lost_full';
      const disputeId = 'dp_lost_full';
      await recordDisputeEvent(eventId, disputeId, 'charge.dispute.closed');

      const dispute = mockStripeDispute(disputeId, 'lost', 1500);
      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(dispute)
      });

      expect(result.success).toBe(true);

      // Order should be disputed and license revoked
      const order: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = "ord_dispute"').first();
      expect(order.status).toBe('disputed');
      const lic: any = await ctx.d1.prepare('SELECT status, revoked_at FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(lic.status).toBe('revoked');
      expect(lic.revoked_at).toBeTruthy();

      // Exactly ONE recovery obligation for maker ($13.50), none for protocol pool
      const obligations: any = await ctx.d1.prepare('SELECT * FROM commerce_recovery_obligations WHERE order_id = "ord_dispute"').all();
      expect(obligations.results).toHaveLength(1);
      const ob = obligations.results![0];
      expect(ob.source_kind).toBe('dispute');
      expect(ob.source_id).toBe(disputeId);
      expect(ob.allocation_id).toBe('alloc_maker');
      expect(ob.amount_cents).toBe(1350);
      expect(ob.currency).toBe('usd');
      expect(ob.status).toBe('pending');
      expect(ob.original_outbox_id).toBe('cto_dispute');
    });

    it('creates recovery obligations for maker and all ancestors on a fork sale', async () => {
      // Create fork order: $30.00 total
      // Maker (70%): $21.00 (2100 cents)
      // Ancestor 1 (10%): $3.00 (300 cents)
      // Ancestor 2 (10%): $3.00 (300 cents)
      // Protocol pool (10%): $3.00 (300 cents)
      const orderId = 'ord_fork_dispute';
      const piId = 'pi_fork_dispute';
      const grossCents = 3000;

      await ctx.d1.prepare(`
        INSERT INTO commerce_orders
          (id, idempotency_key, buyer_user_id, app_id, seller_user_id, app_version, price_version,
           gross_cents, currency, lineage_snapshot_json, stripe_payment_intent_id, status, state_version,
           paid_at, fulfilled_at)
        VALUES (?, 'idem_fork_d', 'usr_buyer', 'dronehunter', 'usr_nate', '1.0.0', 1,
                ?, 'usd', '{}', ?, 'fulfilled', 1, datetime('now'), datetime('now'))
      `).bind(orderId, grossCents, piId).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations
          (id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents)
        VALUES ('f_alloc_maker', ?, 0, 'maker', 'usr_nate', 7000, 2100),
               ('f_alloc_anc1', ?, 1, 'ancestor', 'usr_ancestor1', 1000, 300),
               ('f_alloc_anc2', ?, 2, 'ancestor', 'usr_ancestor2', 1000, 300),
               ('f_alloc_pool', ?, 3, 'protocol_pool', NULL, 1000, 300)
      `).bind(orderId, orderId, orderId, orderId).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_licenses
          (id, order_id, app_id, owner_user_id, license_key_hash, license_key_last4, status)
        VALUES ('lic_fork_d', ?, 'dronehunter', 'usr_buyer', ?, 'FFFF', 'active')
      `).bind(orderId, 'b'.repeat(64)).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_transfer_outbox
          (id, order_id, allocation_id, destination_user_id, amount_cents, currency, status, stripe_idempotency_key)
        VALUES ('cto_f_maker', ?, 'f_alloc_maker', 'usr_nate', 2100, 'usd', 'pending', 'transfer:cto_f_maker'),
               ('cto_f_anc1', ?, 'f_alloc_anc1', 'usr_ancestor1', 300, 'usd', 'pending', 'transfer:cto_f_anc1'),
               ('cto_f_anc2', ?, 'f_alloc_anc2', 'usr_ancestor2', 300, 'usd', 'pending', 'transfer:cto_f_anc2')
      `).bind(orderId, orderId, orderId).run();

      const eventId = 'evt_fork_lost';
      const disputeId = 'dp_fork_lost';
      await recordDisputeEvent(eventId, disputeId, 'charge.dispute.closed');

      const dispute = mockStripeDispute(disputeId, 'lost', 3000, {
        payment_intent: piId,
        charge: 'ch_fork'
      });
      const pi = mockStripePaymentIntent({
        id: piId,
        amount: 3000,
        latest_charge: 'ch_fork'
      });

      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(dispute, pi)
      });

      expect(result.success).toBe(true);

      const obligations: any = await ctx.d1.prepare(`
        SELECT allocation_id, amount_cents, original_outbox_id FROM commerce_recovery_obligations
        WHERE order_id = ? ORDER BY amount_cents DESC
      `).bind(orderId).all();

      expect(obligations.results).toHaveLength(3); // Maker + Anc1 + Anc2 (pool skipped)
      expect(obligations.results).toEqual([
        { allocation_id: 'f_alloc_maker', amount_cents: 2100, original_outbox_id: 'cto_f_maker' },
        { allocation_id: 'f_alloc_anc1', amount_cents: 300, original_outbox_id: 'cto_f_anc1' },
        { allocation_id: 'f_alloc_anc2', amount_cents: 300, original_outbox_id: 'cto_f_anc2' }
      ]);
    });

    it('creates recovery obligations ONLY for unrefunded exposure when partial refund occurred', async () => {
      // Seed prior refund inbox event for FK validity
      await recordInboxEvent(ctx.d1, {
        eventId: 'evt_refund_prior',
        eventType: 'refund.updated',
        livemode: false,
        payloadJson: '{}',
        payloadSha256: await hashPayload('{}'),
        stripeObjectId: 're_partial_prior'
      });

      // Simulate prior partial refund of $5.00 (500 cents)
      // Refund allocation was: maker $4.50 (450 cents), pool $0.50 (50 cents)
      await ctx.d1.prepare(`
        UPDATE commerce_orders SET refunded_cents = 500 WHERE id = 'ord_dispute'
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_refunds
          (id, stripe_refund_id, order_id, stripe_charge_id, amount_cents, currency, status,
           authoritative_json, first_event_id, last_event_id, finalized_at)
        VALUES ('crf_partial', 're_partial_prior', 'ord_dispute', 'ch_dispute', 500, 'usd', 'succeeded',
                '{}', 'evt_refund_prior', 'evt_refund_prior', datetime('now'))
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_refund_allocations
          (id, refund_id, allocation_id, sequence, amount_cents)
        VALUES ('cra_p_0', 'crf_partial', 'alloc_maker', 0, 450),
               ('cra_p_1', 'crf_partial', 'alloc_pool', 1, 50)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_recovery_obligations
          (id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
           source_event_id, amount_cents, currency, status)
        VALUES ('cro_prior_ref', 'ord_dispute', 'refund', 're_partial_prior', 'alloc_maker', 'cto_dispute',
                'evt_refund_prior', 450, 'usd', 'pending')
      `).run();

      // Now dispute is lost for remaining balance
      const eventId = 'evt_lost_after_partial';
      const disputeId = 'dp_lost_partial';
      await recordDisputeEvent(eventId, disputeId, 'charge.dispute.closed');

      const dispute = mockStripeDispute(disputeId, 'lost', 1000);
      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(dispute)
      });

      expect(result.success).toBe(true);

      // Verify recovery obligations:
      // Prior refund: 450 cents
      // New dispute obligation: 900 cents
      // Total maker recovery = 1350 cents (EXACTLY maker amount, NO double recovery)
      const obligations: any = await ctx.d1.prepare(`
        SELECT source_kind, source_id, amount_cents FROM commerce_recovery_obligations
        WHERE order_id = 'ord_dispute' ORDER BY created_at
      `).all();

      expect(obligations.results).toHaveLength(2);
      expect(obligations.results![0]).toEqual({ source_kind: 'refund', source_id: 're_partial_prior', amount_cents: 450 });
      expect(obligations.results![1]).toEqual({ source_kind: 'dispute', source_id: disputeId, amount_cents: 900 });

      const totalMakerRecovered: any = await ctx.d1.prepare(`
        SELECT SUM(amount_cents) as total FROM commerce_recovery_obligations
        WHERE order_id = 'ord_dispute' AND allocation_id = 'alloc_maker'
      `).first();
      expect(totalMakerRecovered.total).toBe(1350);
    });

    it('creates NO recovery obligations when order is already fully refunded', async () => {
      // Seed prior full refund inbox event for FK validity
      await recordInboxEvent(ctx.d1, {
        eventId: 'evt_ref_full',
        eventType: 'refund.updated',
        livemode: false,
        payloadJson: '{}',
        payloadSha256: await hashPayload('{}'),
        stripeObjectId: 're_full_prior'
      });

      // Simulate full refund ($15.00)
      await ctx.d1.prepare(`
        UPDATE commerce_orders SET refunded_cents = 1500, status = 'refunded' WHERE id = 'ord_dispute'
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_recovery_obligations
          (id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
           source_event_id, amount_cents, currency, status)
        VALUES ('cro_full_ref', 'ord_dispute', 'refund', 're_full_prior', 'alloc_maker', 'cto_dispute',
                'evt_ref_full', 1350, 'usd', 'pending')
      `).run();


      const eventId = 'evt_lost_already_refunded';
      const disputeId = 'dp_lost_after_full';
      await recordDisputeEvent(eventId, disputeId, 'charge.dispute.closed');

      const dispute = mockStripeDispute(disputeId, 'lost', 1500);
      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(dispute)
      });

      expect(result.success).toBe(true);

      // No additional recovery obligations should be created
      const obligations: any = await ctx.d1.prepare(`
        SELECT * FROM commerce_recovery_obligations WHERE source_id = ?
      `).bind(disputeId).all();
      expect(obligations.results).toHaveLength(0);
    });

    it('handles duplicate delivery of lost dispute idempotently without duplicate obligations', async () => {
      const event1 = 'evt_lost_dup_1';
      const disputeId = 'dp_lost_dup';
      await recordDisputeEvent(event1, disputeId, 'charge.dispute.closed');

      await processStripeInboxEvent(ctx.d1, env, event1, {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'lost'))
      });

      // Second delivery for same lost dispute
      const event2 = 'evt_lost_dup_2';
      await recordDisputeEvent(event2, disputeId, 'charge.dispute.closed');

      const result2 = await processStripeInboxEvent(ctx.d1, env, event2, {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'lost'))
      });

      expect(result2).toMatchObject({ success: true, duplicate: true });

      // Still only 1 recovery obligation in total
      const obligations: any = await ctx.d1.prepare(`
        SELECT * FROM commerce_recovery_obligations WHERE order_id = 'ord_dispute'
      `).all();
      expect(obligations.results).toHaveLength(1);
    });
  });

  // ==========================================================================
  // 5. WON DISPUTE RESTORATION RULES & CONSTRAINTS
  // ==========================================================================
  describe('5. Won Dispute Restoration Rules', () => {
    it('restores fulfilled order and active license when won and no other disputes exist', async () => {
      // First, open dispute and revoke license
      const event1 = 'evt_open_for_won';
      const disputeId = 'dp_won_test';
      await recordDisputeEvent(event1, disputeId, 'charge.dispute.created');
      await processStripeInboxEvent(ctx.d1, env, event1, {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'needs_response'))
      });

      // Verify revoked
      let lic: any = await ctx.d1.prepare('SELECT status FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(lic.status).toBe('revoked');

      // Now dispute is won
      const event2 = 'evt_won_step';
      await recordDisputeEvent(event2, disputeId, 'charge.dispute.closed');
      const result2 = await processStripeInboxEvent(ctx.d1, env, event2, {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'won'))
      });

      expect(result2).toMatchObject({ success: true, orderId: 'ord_dispute', status: 'fulfilled' });

      // Order should be restored to fulfilled
      const order: any = await ctx.d1.prepare('SELECT status, state_version FROM commerce_orders WHERE id = "ord_dispute"').first();
      expect(order.status).toBe('fulfilled');
      expect(order.state_version).toBe(3);

      // License should be restored to active (revoked_at cleared)
      lic = await ctx.d1.prepare('SELECT status, revoked_at FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(lic.status).toBe('active');
      expect(lic.revoked_at).toBeNull();

      // Audit event
      const audit: any = await ctx.d1.prepare('SELECT details_json FROM commerce_order_events WHERE id = ?').bind(`coe_dispute_${event2}`).first();
      const details = JSON.parse(audit.details_json);
      expect(details.restored).toBe(true);
    });

    it('does NOT restore license if another dispute on the order is still under review', async () => {
      // Open dispute 1
      await recordDisputeEvent('evt_d1_open', 'dp_multi_1');
      await processStripeInboxEvent(ctx.d1, env, 'evt_d1_open', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute('dp_multi_1', 'needs_response'))
      });

      // Open dispute 2
      await recordDisputeEvent('evt_d2_open', 'dp_multi_2');
      await processStripeInboxEvent(ctx.d1, env, 'evt_d2_open', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute('dp_multi_2', 'under_review'))
      });

      // Dispute 1 is won, but dispute 2 is still under_review
      await recordDisputeEvent('evt_d1_won', 'dp_multi_1', 'charge.dispute.closed');
      const resultWon = await processStripeInboxEvent(ctx.d1, env, 'evt_d1_won', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute('dp_multi_1', 'won'))
      });

      expect(resultWon.success).toBe(true);

      // Order must remain disputed and license must remain revoked!
      const order: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = "ord_dispute"').first();
      expect(order.status).toBe('disputed');
      const lic: any = await ctx.d1.prepare('SELECT status FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(lic.status).toBe('revoked');

      // Now Dispute 2 is won
      await recordDisputeEvent('evt_d2_won', 'dp_multi_2', 'charge.dispute.closed');
      const resultWon2 = await processStripeInboxEvent(ctx.d1, env, 'evt_d2_won', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute('dp_multi_2', 'won'))
      });

      expect(resultWon2.success).toBe(true);

      // NOW order and license are restored!
      const finalOrder: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = "ord_dispute"').first();
      expect(finalOrder.status).toBe('fulfilled');
      const finalLic: any = await ctx.d1.prepare('SELECT status, revoked_at FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(finalLic.status).toBe('active');
      expect(finalLic.revoked_at).toBeNull();
    });

    it('does NOT restore license if another dispute on the order was LOST', async () => {
      // Dispute 1 was lost
      await recordDisputeEvent('evt_d1_lost', 'dp_lost_one');
      await processStripeInboxEvent(ctx.d1, env, 'evt_d1_lost', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute('dp_lost_one', 'lost'))
      });

      // Dispute 2 was open
      await recordDisputeEvent('evt_d2_open', 'dp_two_open');
      await processStripeInboxEvent(ctx.d1, env, 'evt_d2_open', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute('dp_two_open', 'needs_response'))
      });

      // Dispute 2 is won
      await recordDisputeEvent('evt_d2_won', 'dp_two_open', 'charge.dispute.closed');
      await processStripeInboxEvent(ctx.d1, env, 'evt_d2_won', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute('dp_two_open', 'won'))
      });

      // Because Dispute 1 was lost, order must remain disputed and license revoked!
      const order: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = "ord_dispute"').first();
      expect(order.status).toBe('disputed');
      const lic: any = await ctx.d1.prepare('SELECT status FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(lic.status).toBe('revoked');
    });

    it('does NOT restore license if order is fully refunded', async () => {
      // Open dispute
      await recordDisputeEvent('evt_open_ref', 'dp_ref_test');
      await processStripeInboxEvent(ctx.d1, env, 'evt_open_ref', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute('dp_ref_test', 'needs_response'))
      });

      // Fully refund order
      await ctx.d1.prepare('UPDATE commerce_orders SET refunded_cents = 1500, status = "refunded" WHERE id = "ord_dispute"').run();
      await ctx.d1.prepare('UPDATE commerce_licenses SET status = "refunded" WHERE order_id = "ord_dispute"').run();

      // Dispute is won
      await recordDisputeEvent('evt_won_ref', 'dp_ref_test', 'charge.dispute.closed');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_won_ref', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute('dp_ref_test', 'won'))
      });

      expect(result.success).toBe(true);

      // Order should remain refunded
      const order: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = "ord_dispute"').first();
      expect(order.status).toBe('refunded');
      // License should remain refunded
      const lic: any = await ctx.d1.prepare('SELECT status FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(lic.status).toBe('refunded');
    });
  });

  // ==========================================================================
  // 6. MONOTONIC STATUS & ANTI-REGRESSION GUARDS
  // ==========================================================================
  describe('6. Monotonic Status Guards', () => {
    it('prevents terminal won dispute from regressing to needs_response on out-of-order webhook', async () => {
      const disputeId = 'dp_mono_won';
      await recordDisputeEvent('evt_won_first', disputeId, 'charge.dispute.closed');
      await processStripeInboxEvent(ctx.d1, env, 'evt_won_first', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'won'))
      });

      // Out of order needs_response event arrives
      await recordDisputeEvent('evt_stale_open', disputeId, 'charge.dispute.created');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_stale_open', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'needs_response'))
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);

      // Dispute in D1 must still be won
      const disp: any = await ctx.d1.prepare('SELECT status FROM commerce_disputes WHERE stripe_dispute_id = ?').bind(disputeId).first();
      expect(disp.status).toBe('won');
    });

    it('prevents terminal lost dispute from regressing on out-of-order webhook', async () => {
      const disputeId = 'dp_mono_lost';
      await recordDisputeEvent('evt_lost_first', disputeId, 'charge.dispute.closed');
      await processStripeInboxEvent(ctx.d1, env, 'evt_lost_first', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'lost'))
      });

      // Out of order under_review arrives
      await recordDisputeEvent('evt_stale_review', disputeId, 'charge.dispute.updated');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_stale_review', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'under_review'))
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);

      const disp: any = await ctx.d1.prepare('SELECT status FROM commerce_disputes WHERE stripe_dispute_id = ?').bind(disputeId).first();
      expect(disp.status).toBe('lost');
    });

    it('prevents terminal won dispute from flipping to lost on subsequent delivery', async () => {
      const disputeId = 'dp_mono_flip_won';
      await recordDisputeEvent('evt_won_flip', disputeId, 'charge.dispute.closed');
      await processStripeInboxEvent(ctx.d1, env, 'evt_won_flip', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'won'))
      });

      // Stale or conflicting lost event arrives
      await recordDisputeEvent('evt_lost_flip', disputeId, 'charge.dispute.closed');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_lost_flip', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'lost'))
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);

      const disp: any = await ctx.d1.prepare('SELECT status FROM commerce_disputes WHERE stripe_dispute_id = ?').bind(disputeId).first();
      expect(disp.status).toBe('won');
    });

    it('prevents formal active dispute from regressing to inquiry warning status', async () => {
      const disputeId = 'dp_mono_active_inquiry';
      await recordDisputeEvent('evt_active_first', disputeId, 'charge.dispute.created');
      await processStripeInboxEvent(ctx.d1, env, 'evt_active_first', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'needs_response'))
      });

      // Stale inquiry arrives
      await recordDisputeEvent('evt_stale_inquiry', disputeId, 'charge.dispute.created');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_stale_inquiry', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'warning_needs_response'))
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);

      const disp: any = await ctx.d1.prepare('SELECT status FROM commerce_disputes WHERE stripe_dispute_id = ?').bind(disputeId).first();
      expect(disp.status).toBe('needs_response');
    });

    it('prevents warning_closed from regressing to open inquiry status', async () => {
      const disputeId = 'dp_mono_warn_closed';
      await recordDisputeEvent('evt_warn_cls', disputeId, 'charge.dispute.closed');
      await processStripeInboxEvent(ctx.d1, env, 'evt_warn_cls', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'warning_closed'))
      });

      // Stale open inquiry arrives
      await recordDisputeEvent('evt_warn_open', disputeId, 'charge.dispute.created');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_warn_open', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'warning_needs_response'))
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);

      const disp: any = await ctx.d1.prepare('SELECT status FROM commerce_disputes WHERE stripe_dispute_id = ?').bind(disputeId).first();
      expect(disp.status).toBe('warning_closed');
    });
  });

  // ==========================================================================
  // 7. TAMPER RESISTANCE & VALIDATION BOUNDARIES
  // ==========================================================================
  describe('7. Tamper Resistance & Environment Boundaries', () => {
    it('fails terminal on invalid dispute ID prefix', async () => {
      await recordDisputeEvent('evt_bad_id', 'invalid_id_format');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_bad_id');
      expect(result).toMatchObject({ success: false, terminal: true });
    });

    it('releases claim as retryable when STRIPE_SECRET_KEY is missing', async () => {
      await recordDisputeEvent('evt_no_key', 'dp_no_key');
      const result = await processStripeInboxEvent(ctx.d1, { ...env, STRIPE_SECRET_KEY: '' }, 'evt_no_key');
      expect(result).toMatchObject({ success: false, retryable: true });
    });

    it('fails terminal on livemode mismatch between dispute and inbox / env', async () => {
      await recordDisputeEvent('evt_live_mismatch', 'dp_live_mismatch');
      const dispute = mockStripeDispute('dp_live_mismatch', 'needs_response', 1500, { livemode: true });
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_live_mismatch', {
        stripeFetchOverride: createStripeFetch(dispute)
      });
      expect(result).toMatchObject({ success: false, terminal: true });
      expect(result.error).toMatch(/livemode/i);
    });

    it('fails terminal on currency mismatch', async () => {
      await recordDisputeEvent('evt_curr_mismatch', 'dp_curr_mismatch');
      const dispute = mockStripeDispute('dp_curr_mismatch', 'needs_response', 1500, { currency: 'eur' });
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_curr_mismatch', {
        stripeFetchOverride: createStripeFetch(dispute)
      });
      expect(result).toMatchObject({ success: false, terminal: true });
    });

    it('fails terminal on charge mismatch between dispute and PaymentIntent', async () => {
      await recordDisputeEvent('evt_ch_mismatch', 'dp_ch_mismatch');
      const dispute = mockStripeDispute('dp_ch_mismatch', 'needs_response', 1500, { charge: 'ch_different' });
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_ch_mismatch', {
        stripeFetchOverride: createStripeFetch(dispute)
      });
      expect(result).toMatchObject({ success: false, terminal: true });
    });

    it('fails terminal when Stripe returns 404', async () => {
      await recordDisputeEvent('evt_404', 'dp_not_found');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_404', {
        stripeFetchOverride: vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'No such dispute' } })
        } as Response)
      });
      expect(result).toMatchObject({ success: false, terminal: true });
    });

    it('releases claim as retryable when Stripe returns 500', async () => {
      await recordDisputeEvent('evt_500', 'dp_stripe_500');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_500', {
        stripeFetchOverride: vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ error: { message: 'Internal Stripe error' } })
        } as Response)
      });
      expect(result).toMatchObject({ success: false, retryable: true });
    });


    it('fails terminal on economic conflict with existing dispute record', async () => {

      const disputeId = 'dp_conflict_test';
      await recordDisputeEvent('evt_conf_1', disputeId, 'charge.dispute.created');
      await processStripeInboxEvent(ctx.d1, env, 'evt_conf_1', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'needs_response', 1500))
      });

      // Second event arrives with different amount for same dispute ID
      await recordDisputeEvent('evt_conf_2', disputeId, 'charge.dispute.updated');
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_conf_2', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'under_review', 1000))
      });

      expect(result).toMatchObject({ success: false, terminal: true });
      expect(result.error).toMatch(/conflict/i);
    });

    it('creates partial recovery obligations when dispute is for partial order amount', async () => {
      // Order gross is 1500 (maker 1350, pool 150)
      // Lost dispute is for 1000 cents (2/3 of order)
      const disputeId = 'dp_partial_amount';
      await recordDisputeEvent('evt_part_lost', disputeId, 'charge.dispute.closed');
      const dispute = mockStripeDispute(disputeId, 'lost', 1000);
      const result = await processStripeInboxEvent(ctx.d1, env, 'evt_part_lost', {
        stripeFetchOverride: createStripeFetch(dispute)
      });

      expect(result.success).toBe(true);

      // Maker target for 1000 cents (90%) = 900 cents
      const obligations: any = await ctx.d1.prepare(`
        SELECT allocation_id, amount_cents FROM commerce_recovery_obligations
        WHERE order_id = 'ord_dispute'
      `).all();

      expect(obligations.results).toHaveLength(1);
      expect(obligations.results![0]).toEqual({
        allocation_id: 'alloc_maker',
        amount_cents: 900
      });
    });

    it('tracks complete dispute progression with append-only observations and audit events', async () => {
      const disputeId = 'dp_full_progression';

      // 1. Warning
      await recordDisputeEvent('evt_p1', disputeId, 'charge.dispute.created');
      await processStripeInboxEvent(ctx.d1, env, 'evt_p1', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'warning_needs_response'))
      });

      // 2. Needs response
      await recordDisputeEvent('evt_p2', disputeId, 'charge.dispute.created');
      await processStripeInboxEvent(ctx.d1, env, 'evt_p2', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'needs_response'))
      });

      // 3. Under review
      await recordDisputeEvent('evt_p3', disputeId, 'charge.dispute.updated');
      await processStripeInboxEvent(ctx.d1, env, 'evt_p3', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'under_review'))
      });

      // 4. Won
      await recordDisputeEvent('evt_p4', disputeId, 'charge.dispute.closed');
      await processStripeInboxEvent(ctx.d1, env, 'evt_p4', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'won'))
      });

      // Assert all 4 observations recorded
      const observations: any = await ctx.d1.prepare(`
        SELECT event_id, observed_status, LENGTH(authoritative_sha256) AS sha_len
        FROM commerce_dispute_observations
        WHERE dispute_id = ?
        ORDER BY observed_at ASC
      `).bind(`cdp_${disputeId}`).all();

      expect(observations.results).toHaveLength(4);
      expect(observations.results).toEqual([
        { event_id: 'evt_p1', observed_status: 'warning_needs_response', sha_len: 64 },
        { event_id: 'evt_p2', observed_status: 'needs_response', sha_len: 64 },
        { event_id: 'evt_p3', observed_status: 'under_review', sha_len: 64 },
        { event_id: 'evt_p4', observed_status: 'won', sha_len: 64 }
      ]);

      // Assert order is restored to fulfilled and license active
      const order: any = await ctx.d1.prepare('SELECT status FROM commerce_orders WHERE id = "ord_dispute"').first();
      expect(order.status).toBe('fulfilled');
      const lic: any = await ctx.d1.prepare('SELECT status, revoked_at FROM commerce_licenses WHERE order_id = "ord_dispute"').first();
      expect(lic.status).toBe('active');
      expect(lic.revoked_at).toBeNull();
    });

    it('passes complete foreign key integrity check after complex dispute workflows', async () => {
      // Execute a dispute workflow
      const disputeId = 'dp_fk_check';
      await recordDisputeEvent('evt_fk_open', disputeId, 'charge.dispute.created');
      await processStripeInboxEvent(ctx.d1, env, 'evt_fk_open', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'needs_response'))
      });

      await recordDisputeEvent('evt_fk_lost', disputeId, 'charge.dispute.closed');
      await processStripeInboxEvent(ctx.d1, env, 'evt_fk_lost', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'lost'))
      });

      // Assert no foreign key violations
      const violations = ctx.runForeignKeyCheck();
      expect(violations).toEqual([]);
    });

    it('handles multiple consecutive partial lost disputes correctly without over-recovering', async () => {
      // 1. First partial lost dispute: 500 cents
      const disp1 = 'dp_multi_lost_1';
      await recordDisputeEvent('evt_ml_1', disp1, 'charge.dispute.closed');
      const res1 = await processStripeInboxEvent(ctx.d1, env, 'evt_ml_1', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disp1, 'lost', 500))
      });
      expect(res1.success).toBe(true);

      // Maker (90%) gets 450 cents
      let obligations: any = await ctx.d1.prepare(`
        SELECT source_id, amount_cents FROM commerce_recovery_obligations WHERE order_id = 'ord_dispute'
      `).all();
      expect(obligations.results).toHaveLength(1);
      expect(obligations.results[0]).toEqual({ source_id: disp1, amount_cents: 450 });

      // 2. Second partial lost dispute: 500 cents
      const disp2 = 'dp_multi_lost_2';
      await recordDisputeEvent('evt_ml_2', disp2, 'charge.dispute.closed');
      const res2 = await processStripeInboxEvent(ctx.d1, env, 'evt_ml_2', {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disp2, 'lost', 500))
      });
      expect(res2.success).toBe(true);

      // Cumulative lost = 1000 cents -> Maker target = 900 cents, prior = 450 cents, delta = 450 cents
      obligations = await ctx.d1.prepare(`
        SELECT source_id, amount_cents FROM commerce_recovery_obligations WHERE order_id = 'ord_dispute' ORDER BY created_at
      `).all();
      expect(obligations.results).toHaveLength(2);
      expect(obligations.results[1]).toEqual({ source_id: disp2, amount_cents: 450 });

      // Total recovered is 900 cents
      const totalMaker: any = await ctx.d1.prepare(`
        SELECT SUM(amount_cents) as total FROM commerce_recovery_obligations
        WHERE order_id = 'ord_dispute' AND allocation_id = 'alloc_maker'
      `).first();
      expect(totalMaker.total).toBe(900);
    });

    it('extracts dispute ID when provided in event.data.object.dispute field', async () => {
      const eventId = 'evt_dispute_nested_id';
      const disputeId = 'dp_nested_id_test';
      const payload = JSON.stringify({
        id: eventId,
        type: 'charge.dispute.created',
        livemode: false,
        data: { object: { id: 'ch_some_charge', dispute: disputeId } }
      });
      await recordInboxEvent(ctx.d1, {
        eventId,
        eventType: 'charge.dispute.created',
        livemode: false,
        payloadJson: payload,
        payloadSha256: await hashPayload(payload),
        stripeObjectId: 'ch_some_charge'
      });

      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'needs_response'))
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe('ord_dispute');

      const disp: any = await ctx.d1.prepare('SELECT stripe_dispute_id FROM commerce_disputes WHERE stripe_dispute_id = ?').bind(disputeId).first();
      expect(disp.stripe_dispute_id).toBe(disputeId);
    });

    it('rejects dispute advancement when order is in requires_payment status', async () => {
      await ctx.d1.prepare(`UPDATE commerce_orders SET status = 'requires_payment' WHERE id = 'ord_dispute'`).run();

      const eventId = 'evt_dispute_req_pay';
      const disputeId = 'dp_req_pay';
      await recordDisputeEvent(eventId, disputeId, 'charge.dispute.created');

      const result = await processStripeInboxEvent(ctx.d1, env, eventId, {
        stripeFetchOverride: createStripeFetch(mockStripeDispute(disputeId, 'needs_response'))
      });

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.error).toMatch(/cannot advance order from state 'requires_payment'/i);
    });
  });
});


