import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

describe('Migration 0029: Contributor Revenue Sharing Schema & Invariants', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  describe('1. repositories.grantable_bps column', () => {
    it('defaults to 0 on existing and new repository records', async () => {
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key, status)
        VALUES ('repo_g1', 'usr_nate', 'g1-repo', 'storage_g1', 'active')
      `).run();

      const repo = await ctx.d1.prepare('SELECT id, grantable_bps FROM repositories WHERE id = ?')
        .bind('repo_g1').first<{ id: string; grantable_bps: number }>();
      expect(repo?.grantable_bps).toBe(0);
    });

    it.each([0, 1, 500, 1000, 7000, 9000, 10000])(
      'accepts valid grantable_bps value: %i',
      async (bps) => {
        await ctx.d1.prepare(`
          INSERT INTO repositories (id, owner_user_id, slug, storage_key, grantable_bps)
          VALUES (?, 'usr_nate', ?, ?, ?)
        `).bind(`repo_bps_${bps}`, `slug-${bps}`, `storage-${bps}`, bps).run();

        const row = await ctx.d1.prepare('SELECT grantable_bps FROM repositories WHERE id = ?')
          .bind(`repo_bps_${bps}`).first<{ grantable_bps: number }>();
        expect(row?.grantable_bps).toBe(bps);
      }
    );

    it.each([-1, -500, 10001, 20000])(
      'rejects out-of-range grantable_bps value: %i',
      async (invalidBps) => {
        await expect(
          ctx.d1.prepare(`
            INSERT INTO repositories (id, owner_user_id, slug, storage_key, grantable_bps)
            VALUES (?, 'usr_nate', ?, ?, ?)
          `).bind(`repo_bps_bad_${invalidBps}`, `slug-bad-${invalidBps}`, `storage-bad-${invalidBps}`, invalidBps).run()
        ).rejects.toThrow(/CHECK constraint failed/);
      }
    );
  });

  describe('2. contributor_shares schema constraints', () => {
    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key, grantable_bps)
        VALUES ('repo_cs_test', 'usr_nate', 'cs-repo', 'storage_cs_test', 5000)
      `).run();
    });

    it('defaults status to pending with null timestamps', async () => {
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (
          id, repository_id, contributor_user_id, granted_by_user_id, basis_points
        ) VALUES ('cs_default', 'repo_cs_test', 'usr_sam', 'usr_nate', 1500)
      `).run();

      const share = await ctx.d1.prepare('SELECT * FROM contributor_shares WHERE id = ?')
        .bind('cs_default').first<any>();
      expect(share?.status).toBe('pending');
      expect(share?.basis_points).toBe(1500);
      expect(share?.activated_at).toBeNull();
      expect(share?.revoked_at).toBeNull();
      expect(share?.created_at).toBeTruthy();
    });

    it('rejects pending row with non-null timestamps (#4)', async () => {
      // Pending with activated_at
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at
          ) VALUES ('cs_bad_p_act', 'repo_cs_test', 'usr_sam', 'usr_nate', 1000, 'pending', CURRENT_TIMESTAMP)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // Pending with revoked_at
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, revoked_at
          ) VALUES ('cs_bad_p_rev', 'repo_cs_test', 'usr_sam', 'usr_nate', 1000, 'pending', CURRENT_TIMESTAMP)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('rejects active row without activated_at or with revoked_at (#4)', async () => {
      // Active without activated_at
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at
          ) VALUES ('cs_bad_act_no_time', 'repo_cs_test', 'usr_sam', 'usr_nate', 1000, 'active', NULL)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // Active with revoked_at
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at, revoked_at
          ) VALUES ('cs_bad_act_rev', 'repo_cs_test', 'usr_sam', 'usr_nate', 1000, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('rejects revoked row without revoked_at or with activated_at (#4)', async () => {
      // Revoked without revoked_at
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, revoked_at
          ) VALUES ('cs_bad_rev_no_time', 'repo_cs_test', 'usr_sam', 'usr_nate', 1000, 'revoked', NULL)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // Revoked with activated_at
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at, revoked_at
          ) VALUES ('cs_bad_rev_act', 'repo_cs_test', 'usr_sam', 'usr_nate', 1000, 'revoked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('rejects self-grant where contributor_user_id == granted_by_user_id', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id, basis_points
          ) VALUES ('cs_self_grant', 'repo_cs_test', 'usr_nate', 'usr_nate', 1000)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it.each([0, -1, -100, 10001, 20000])(
      'rejects invalid basis_points: %i',
      async (invalidBps) => {
        await expect(
          ctx.d1.prepare(`
            INSERT INTO contributor_shares (
              id, repository_id, contributor_user_id, granted_by_user_id, basis_points
            ) VALUES (?, 'repo_cs_test', 'usr_sam', 'usr_nate', ?)
          `).bind(`cs_bad_bps_${invalidBps}`, invalidBps).run()
        ).rejects.toThrow(/CHECK constraint failed|contributor share exceeds available repository grantable pool/);
      }
    );

    it('rejects invalid status values', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status
          ) VALUES ('cs_bad_status', 'repo_cs_test', 'usr_sam', 'usr_nate', 1000, 'in_progress')
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('enforces UNIQUE constraint on merge_attempt_id', async () => {
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (
          id, repository_id, contributor_user_id, granted_by_user_id,
          merge_attempt_id, basis_points
        ) VALUES ('cs_att1', 'repo_cs_test', 'usr_sam', 'usr_nate', 'attempt_alpha', 1000)
      `).run();

      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id,
            merge_attempt_id, basis_points
          ) VALUES ('cs_att2', 'repo_cs_test', 'usr_josh', 'usr_nate', 'attempt_alpha', 500)
        `).run()
      ).rejects.toThrow(/UNIQUE constraint failed/);
    });

    it('allows multiple rows with NULL merge_attempt_id', async () => {
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (
          id, repository_id, contributor_user_id, granted_by_user_id,
          merge_attempt_id, basis_points
        ) VALUES
          ('cs_null1', 'repo_cs_test', 'usr_sam', 'usr_nate', NULL, 1000),
          ('cs_null2', 'repo_cs_test', 'usr_josh', 'usr_nate', NULL, 500)
      `).run();

      const count = await ctx.d1.prepare('SELECT count(*) as c FROM contributor_shares WHERE repository_id = ?')
        .bind('repo_cs_test').first<number>('c');
      expect(count).toBe(2);
    });

    describe('BEFORE DELETE guard on contributor_shares (#2)', () => {
      it('blocks physical deletion of pending share and keeps merge_attempt_id occupied', async () => {
        await ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id,
            merge_attempt_id, basis_points, status
          ) VALUES ('cs_del_pend', 'repo_cs_test', 'usr_sam', 'usr_nate', 'att_del_pend', 1000, 'pending')
        `).run();

        await expect(
          ctx.d1.prepare('DELETE FROM contributor_shares WHERE id = ?').bind('cs_del_pend').run()
        ).rejects.toThrow(/contributor_shares rows cannot be deleted; use revocation/);

        // Attempt second insert with same merge_attempt_id -> must fail UNIQUE check because original row is preserved
        await expect(
          ctx.d1.prepare(`
            INSERT INTO contributor_shares (
              id, repository_id, contributor_user_id, granted_by_user_id,
              merge_attempt_id, basis_points, status
            ) VALUES ('cs_swap_pend', 'repo_cs_test', 'usr_josh', 'usr_nate', 'att_del_pend', 500, 'pending')
          `).run()
        ).rejects.toThrow(/UNIQUE constraint failed/);
      });

      it('blocks physical deletion of active share and keeps merge_attempt_id occupied', async () => {
        await ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id,
            merge_attempt_id, basis_points, status, activated_at
          ) VALUES ('cs_del_act', 'repo_cs_test', 'usr_sam', 'usr_nate', 'att_del_act', 1000, 'active', CURRENT_TIMESTAMP)
        `).run();

        await expect(
          ctx.d1.prepare('DELETE FROM contributor_shares WHERE id = ?').bind('cs_del_act').run()
        ).rejects.toThrow(/contributor_shares rows cannot be deleted; use revocation/);

        // Attempt second insert with same merge_attempt_id -> must fail UNIQUE check
        await expect(
          ctx.d1.prepare(`
            INSERT INTO contributor_shares (
              id, repository_id, contributor_user_id, granted_by_user_id,
              merge_attempt_id, basis_points, status
            ) VALUES ('cs_swap_act', 'repo_cs_test', 'usr_josh', 'usr_nate', 'att_del_act', 500, 'pending')
          `).run()
        ).rejects.toThrow(/UNIQUE constraint failed/);
      });

      it('blocks physical deletion of revoked share and keeps merge_attempt_id occupied', async () => {
        await ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id,
            merge_attempt_id, basis_points, status, revoked_at
          ) VALUES ('cs_del_rev', 'repo_cs_test', 'usr_sam', 'usr_nate', 'att_del_rev', 1000, 'revoked', CURRENT_TIMESTAMP)
        `).run();

        await expect(
          ctx.d1.prepare('DELETE FROM contributor_shares WHERE id = ?').bind('cs_del_rev').run()
        ).rejects.toThrow(/contributor_shares rows cannot be deleted; use revocation/);

        // Attempt second insert with same merge_attempt_id -> must fail UNIQUE check
        await expect(
          ctx.d1.prepare(`
            INSERT INTO contributor_shares (
              id, repository_id, contributor_user_id, granted_by_user_id,
              merge_attempt_id, basis_points, status
            ) VALUES ('cs_swap_rev', 'repo_cs_test', 'usr_josh', 'usr_nate', 'att_del_rev', 500, 'pending')
          `).run()
        ).rejects.toThrow(/UNIQUE constraint failed/);
      });
    });
  });

  describe('3. contributor_shares triggers', () => {
    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key, grantable_bps)
        VALUES ('repo_trig_test', 'usr_nate', 'trig-repo', 'storage_trig_test', 5000)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (
          id, repository_id, contributor_user_id, granted_by_user_id,
          merge_job_id, merge_attempt_id, merge_approval_id, basis_points, status
        ) VALUES (
          'cs_trig', 'repo_trig_test', 'usr_sam', 'usr_nate',
          'mj_0', 'att_0', 'map_0', 1200, 'pending'
        )
      `).run();
    });

    it('economics-immutable trigger prevents modification of economic columns and provenance (#3)', async () => {
      // basis_points
      await expect(
        ctx.d1.prepare('UPDATE contributor_shares SET basis_points = 2000 WHERE id = ?')
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // contributor_user_id
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET contributor_user_id = 'usr_josh' WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // granted_by_user_id
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET granted_by_user_id = 'usr_josh' WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // repository_id
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET repository_id = 'repo_other' WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // merge_attempt_id
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET merge_attempt_id = 'att_new' WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // merge_job_id (#3)
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET merge_job_id = 'mj_rewritten' WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET merge_job_id = NULL WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // merge_approval_id (#3)
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET merge_approval_id = 'map_rewritten' WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET merge_approval_id = NULL WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);
    });

    it('status forward-only trigger allows pending -> active transition with non-null activated_at', async () => {
      await ctx.d1.prepare(`
        UPDATE contributor_shares
        SET status = 'active', activated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind('cs_trig').run();

      const share = await ctx.d1.prepare('SELECT status, activated_at FROM contributor_shares WHERE id = ?')
        .bind('cs_trig').first<any>();
      expect(share?.status).toBe('active');
      expect(share?.activated_at).toBeTruthy();
    });

    it('status forward-only trigger rejects pending -> active without activated_at (#4)', async () => {
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'active' WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow();
    });

    it('status forward-only trigger allows pending -> revoked transition with non-null revoked_at', async () => {
      await ctx.d1.prepare(`
        UPDATE contributor_shares
        SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind('cs_trig').run();

      const share = await ctx.d1.prepare('SELECT status, revoked_at FROM contributor_shares WHERE id = ?')
        .bind('cs_trig').first<any>();
      expect(share?.status).toBe('revoked');
      expect(share?.revoked_at).toBeTruthy();
    });

    it('status forward-only trigger rejects pending -> revoked without revoked_at (#4)', async () => {
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'revoked' WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow();
    });

    it('status forward-only trigger blocks active -> revoked and active -> pending', async () => {
      // Activate share first
      await ctx.d1.prepare("UPDATE contributor_shares SET status = 'active', activated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind('cs_trig').run();

      // Attempt active -> revoked
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);

      // Attempt active -> pending
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'pending', activated_at = NULL WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);
    });

    it('status forward-only trigger blocks revoked -> active and revoked -> pending', async () => {
      // Revoke share first
      await ctx.d1.prepare("UPDATE contributor_shares SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind('cs_trig').run();

      // Attempt revoked -> active
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'active', activated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);

      // Attempt revoked -> pending
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'pending', revoked_at = NULL WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);
    });

    it('freezes timestamps once set (#4)', async () => {
      // Activate share first
      await ctx.d1.prepare("UPDATE contributor_shares SET status = 'active', activated_at = '2026-08-31 12:00:00' WHERE id = ?")
        .bind('cs_trig').run();

      // Rewriting activated_at on active share must fail
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET activated_at = '2026-08-31 13:00:00' WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // Nulling activated_at on active share must fail
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET activated_at = NULL WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // Setting revoked_at on active share must fail (#4)
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);
    });

    it('rejects setting timestamps on a pending share without status transition (#4)', async () => {
      // Setting activated_at while keeping status = pending
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET activated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);

      // Setting revoked_at while keeping status = pending
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind('cs_trig').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);
    });
  });

  describe('4. Widened commerce_order_allocations and related triggers', () => {
    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key)
        VALUES ('repo_ord_test', 'usr_nate', 'ord-repo', 'storage_ord_test')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json, status
        ) VALUES (
          'cord_full_test', 'checkout-full', 'usr_sam', 'dronehunter', 'usr_nate',
          'v1.0.0', 1, 3000, 'usd', '{}', 'fulfilled'
        )
      `).run();
    });

    it('accepts maker, ancestor, protocol_pool, and contributor rows with valid recipient constraints', async () => {
      // Maker
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, source_repository_id, basis_points, amount_cents
        ) VALUES ('coa_m', 'cord_full_test', 0, 'maker', 'usr_nate', 'repo_ord_test', 7000, 2100)
      `).run();

      // Ancestor
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, source_repository_id, lineage_depth, basis_points, amount_cents
        ) VALUES ('coa_a', 'cord_full_test', 1, 'ancestor', 'usr_josh', 'repo_ord_test', 1, 1000, 300)
      `).run();

      // Contributor
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, source_repository_id, basis_points, amount_cents
        ) VALUES ('coa_c', 'cord_full_test', 2, 'contributor', 'usr_sam', 'repo_ord_test', 1000, 300)
      `).run();

      // Protocol Pool (requires recipient_user_id IS NULL)
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES ('coa_p', 'cord_full_test', 3, 'protocol_pool', NULL, 1000, 300)
      `).run();

      const allocs = await ctx.d1.prepare('SELECT role, recipient_user_id, amount_cents FROM commerce_order_allocations WHERE order_id = ? ORDER BY sequence')
        .bind('cord_full_test').all<any>();

      expect(allocs.results?.map(a => a.role)).toEqual(['maker', 'ancestor', 'contributor', 'protocol_pool']);
      expect(allocs.results?.reduce((sum, a) => sum + a.amount_cents, 0)).toBe(3000);
    });

    it('rejects contributor allocation if recipient_user_id IS NULL', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO commerce_order_allocations (
            id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
          ) VALUES ('coa_c_null', 'cord_full_test', 0, 'contributor', NULL, 1000, 300)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('rejects protocol_pool allocation if recipient_user_id IS NOT NULL', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO commerce_order_allocations (
            id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
          ) VALUES ('coa_p_notnull', 'cord_full_test', 0, 'protocol_pool', 'usr_nate', 1000, 300)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('rejects unknown role values', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO commerce_order_allocations (
            id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
          ) VALUES ('coa_invalid', 'cord_full_test', 0, 'arbitrary_role', 'usr_nate', 1000, 300)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('immutability triggers prevent update and delete on commerce_order_allocations', async () => {
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES ('coa_imm', 'cord_full_test', 0, 'contributor', 'usr_sam', 1000, 300)
      `).run();

      await expect(
        ctx.d1.prepare('UPDATE commerce_order_allocations SET amount_cents = 500 WHERE id = ?')
          .bind('coa_imm').run()
      ).rejects.toThrow(/commerce order allocations are immutable/);

      await expect(
        ctx.d1.prepare('DELETE FROM commerce_order_allocations WHERE id = ?')
          .bind('coa_imm').run()
      ).rejects.toThrow(/commerce order allocations are immutable/);
    });

    it('commerce_outbox_requires_fulfilled_allocation admits contributor transfers', async () => {
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES ('coa_out_c', 'cord_full_test', 0, 'contributor', 'usr_sam', 1000, 300)
      `).run();

      // Valid matching outbox row
      await ctx.d1.prepare(`
        INSERT INTO commerce_transfer_outbox (
          id, order_id, allocation_id, destination_user_id, amount_cents, currency
        ) VALUES ('out_c_valid', 'cord_full_test', 'coa_out_c', 'usr_sam', 300, 'usd')
      `).run();

      const outbox = await ctx.d1.prepare('SELECT id, destination_user_id, amount_cents FROM commerce_transfer_outbox WHERE id = ?')
        .bind('out_c_valid').first<any>();
      expect(outbox?.destination_user_id).toBe('usr_sam');
      expect(outbox?.amount_cents).toBe(300);

      // Mismatched destination user
      await expect(
        ctx.d1.prepare(`
          INSERT INTO commerce_transfer_outbox (
            id, order_id, allocation_id, destination_user_id, amount_cents, currency
          ) VALUES ('out_c_bad_dest', 'cord_full_test', 'coa_out_c', 'usr_josh', 300, 'usd')
        `).run()
      ).rejects.toThrow(/commerce outbox requires matching fulfilled allocation/);

      // Mismatched amount
      await expect(
        ctx.d1.prepare(`
          INSERT INTO commerce_transfer_outbox (
            id, order_id, allocation_id, destination_user_id, amount_cents, currency
          ) VALUES ('out_c_bad_amt', 'cord_full_test', 'coa_out_c', 'usr_sam', 500, 'usd')
        `).run()
      ).rejects.toThrow(/commerce outbox requires matching fulfilled allocation/);
    });

    it('commerce_recovery_matches_order_allocation admits contributor recovery obligations', async () => {
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES ('coa_rec_c', 'cord_full_test', 0, 'contributor', 'usr_sam', 1000, 300)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_transfer_outbox (
          id, order_id, allocation_id, destination_user_id, amount_cents, currency
        ) VALUES ('out_rec_c', 'cord_full_test', 'coa_rec_c', 'usr_sam', 300, 'usd')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO stripe_event_inbox (event_id, event_type, livemode, payload_json, payload_sha256)
        VALUES ('evt_rec_c', 'charge.refund.updated', 0, '{}', ?)
      `).bind('c'.repeat(64)).run();

      // Valid matching recovery obligation
      await ctx.d1.prepare(`
        INSERT INTO commerce_recovery_obligations (
          id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
          source_event_id, amount_cents, currency, status
        ) VALUES (
          'cro_c_valid', 'cord_full_test', 'refund', 're_999', 'coa_rec_c', 'out_rec_c',
          'evt_rec_c', 300, 'usd', 'pending'
        )
      `).run();

      const obligation = await ctx.d1.prepare('SELECT id, amount_cents FROM commerce_recovery_obligations WHERE id = ?')
        .bind('cro_c_valid').first<any>();
      expect(obligation?.amount_cents).toBe(300);

      // Amount exceeding frozen allocation amount must fail
      await expect(
        ctx.d1.prepare(`
          INSERT INTO commerce_recovery_obligations (
            id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
            source_event_id, amount_cents, currency, status
          ) VALUES (
            'cro_c_over', 'cord_full_test', 'refund', 're_999', 'coa_rec_c', 'out_rec_c',
            'evt_rec_c', 301, 'usd', 'pending'
          )
        `).run()
      ).rejects.toThrow(/recovery obligation must match a payable frozen allocation/);
    });
  });

});
