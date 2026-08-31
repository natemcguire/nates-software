import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestD1Database,
  TestD1Context,
  CANONICAL_MIGRATIONS,
  getMigrationsDir
} from './fixtures/d1Harness';
import * as fs from 'fs';
import * as path from 'path';
import { calculateAllocations } from '../src/lib/commerceDomain';

describe('Local D1-Compatible SQLite Migration-Chain Integrity Suite', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  // ==========================================================================
  // 1. MIGRATION CHAIN EXECUTION & SCHEMA VERIFICATION
  // ==========================================================================
  describe('1. Migration Chain Sequence & Schema Generation', () => {
    it('should define the complete canonical migration chain', () => {
      expect(CANONICAL_MIGRATIONS).toEqual([
        '0001_production_schema.sql',
        '0002_webhook_idempotency_and_atomic_ledger.sql',
        '0006_canonical_forge_lineage.sql',
        '0007_dyno_real_world_benchmarks.sql',
        '0008_session_security.sql',
        '0009_durable_commerce.sql',
        '0010_commerce_processing.sql',
        '0011_commerce_money_movement.sql',
        '0012_commerce_refunds_disputes.sql',
        '0013_commerce_refund_finalization.sql',
        '0014_hotwire_votes.sql',
        '0016_inbox_live_integrity.sql',
        '0017_picfit_truthful_listing.sql',
        '0018_ephemeral_terminal_sessions.sql',
        '0019_forge_outbox_leasing.sql',
        '0020_dyno_certified_evaluations.sql',
        '0021_active_project_catalog.sql',
        '0022_deployment_lifecycle_states.sql',
        '0023_retire_picfit_listing.sql',
        '0024_canonical_repository_linkage.sql',
        '0025_app_origin_kind.sql',
        '0026_unique_hostname_index.sql',
        '0027_app_postgres_addon.sql',
        '0029_contributor_revenue_sharing.sql'
      ]);
    });

    it('should create all required tables across all migrations', () => {
      const tables = ctx.getTableNames();

      // Migration 0001 core tables
      expect(tables).toContain('users');
      expect(tables).toContain('user_sessions');
      expect(tables).toContain('app_listings');
      expect(tables).toContain('shelf_items');
      expect(tables).toContain('comments');
      expect(tables).toContain('comment_upvotes');
      expect(tables).toContain('chat_messages');
      expect(tables).toContain('inbox_messages');
      expect(tables).toContain('royalty_settlements');
      expect(tables).toContain('stripe_accounts');
      expect(tables).toContain('orders');
      expect(tables).toContain('transfers_ledger');
      expect(tables).toContain('licenses');
      expect(tables).toContain('git_repositories');
      expect(tables).toContain('git_refs');
      expect(tables).toContain('git_commits');

      // Migration 0002 tables
      expect(tables).toContain('processed_webhook_events');

      // Migration 0006 canonical forge tables
      expect(tables).toContain('repositories');
      expect(tables).toContain('repository_members');
      expect(tables).toContain('repository_ref_policies');
      expect(tables).toContain('repository_refs');
      expect(tables).toContain('repository_ref_events');
      expect(tables).toContain('repository_forks');
      expect(tables).toContain('feature_packages');
      expect(tables).toContain('feature_package_versions');
      expect(tables).toContain('merge_jobs');
      expect(tables).toContain('merge_attempts');
      expect(tables).toContain('merge_approvals');
      expect(tables).toContain('build_runs');
      expect(tables).toContain('build_artifacts');
      expect(tables).toContain('deployment_revisions');
      expect(tables).toContain('editorial_reviews');
      expect(tables).toContain('editorial_measurements');
      expect(tables).toContain('forge_outbox_events');
      expect(tables).toContain('forge_reconciliation_issues');

      // Migration 0007 DYNO benchmark tables
      expect(tables).toContain('dyno_suites');
      expect(tables).toContain('dyno_tasks');
      expect(tables).toContain('dyno_subjects');
      expect(tables).toContain('dyno_environments');
      expect(tables).toContain('dyno_runs');
      expect(tables).toContain('dyno_task_attempts');
      expect(tables).toContain('dyno_tool_events');
      expect(tables).toContain('dyno_grader_results');

      // Migration 0009 durable commerce tables
      expect(tables).toContain('commerce_products');
      expect(tables).toContain('commerce_orders');
      expect(tables).toContain('commerce_order_allocations');
      expect(tables).toContain('stripe_event_inbox');
      expect(tables).toContain('commerce_licenses');
      expect(tables).toContain('commerce_transfer_outbox');
      expect(tables).toContain('commerce_order_events');
      expect(tables).toContain('commerce_license_secrets');
      expect(tables).toContain('commerce_license_secret_events');
      expect(tables).toContain('commerce_transfer_attempts');
      expect(tables).toContain('commerce_reversal_outbox');
      expect(tables).toContain('commerce_reversal_attempts');
      expect(tables).toContain('commerce_refunds');
      expect(tables).toContain('commerce_disputes');
      expect(tables).toContain('commerce_refund_observations');
      expect(tables).toContain('commerce_dispute_observations');
      expect(tables).toContain('commerce_refund_allocations');
      expect(tables).toContain('commerce_recovery_obligations');

      // Migration 0014 Hotwire upvotes table
      expect(tables).toContain('drop_upvotes');
      // Migration 0018 ephemeral terminal sessions table
      expect(tables).toContain('terminal_session_tickets');
      // Migration 0029 contributor shares table
      expect(tables).toContain('contributor_shares');
    });

    it('should create views and triggers defined in migration 0006', () => {
      const views = ctx.getViewNames();
      expect(views).toContain('repository_lineage');

      const triggers = ctx.getTriggerNames();
      expect(triggers).toContain('repository_forks_immutable_update');
      expect(triggers).toContain('repository_forks_immutable_delete');
      expect(triggers).toContain('commerce_license_requires_fulfilled_order');
      expect(triggers).toContain('commerce_outbox_requires_fulfilled_allocation');
      expect(triggers).toContain('commerce_transfer_economics_immutable');
      expect(triggers).toContain('commerce_reversal_requires_succeeded_transfer');
      expect(triggers).toContain('commerce_transfer_attempt_success_requires_outbox_success');
      expect(triggers).toContain('commerce_refund_allocations_match_order');
      expect(triggers).toContain('commerce_reversal_cumulative_guard');
      expect(triggers).toContain('commerce_refund_finalization_guard');
      expect(triggers).toContain('commerce_refund_finalized_immutable');
      expect(triggers).toContain('contributor_shares_no_delete');
      expect(triggers).toContain('contributor_shares_economics_immutable');
      expect(triggers).toContain('contributor_shares_status_forward_only');
    });

    it('should create all unique indices across the migration chain', () => {
      const indices = ctx.getIndexNames();
      expect(indices).toContain('idx_licenses_order');
      expect(indices).toContain('idx_shelf_user_app');
      expect(indices).toContain('idx_transfers_order_role');
      expect(indices).toContain('idx_drop_upvotes_voter');
      expect(indices).toContain('idx_inbox_kind');
      expect(indices).toContain('idx_inbox_merge_attempt');
      expect(indices).toContain('idx_inbox_reply');
      expect(indices).toContain('idx_terminal_tickets_user_issued');
      expect(indices).toContain('idx_terminal_tickets_active');
      expect(indices).toContain('idx_contributor_shares_attempt');
      expect(indices).toContain('idx_contributor_shares_repo_status');
      expect(indices).toContain('idx_contributor_shares_contributor');
    });

    it('should upgrade the legacy runtime-created vote table without losing valid votes', async () => {
      const legacy = await createTestD1Database({
        foreignKeys: true,
        migrations: CANONICAL_MIGRATIONS.slice(
          0,
          CANONICAL_MIGRATIONS.indexOf('0014_hotwire_votes.sql')
        )
      });
      await legacy.d1.exec(`
        CREATE TABLE drop_upvotes (
          app_id TEXT NOT NULL,
          voter_hash TEXT NOT NULL,
          voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (app_id, voter_hash)
        );
        INSERT INTO drop_upvotes (app_id, voter_hash) VALUES
          ('dronehunter', 'valid-vote'),
          ('deleted-app', 'orphan-vote');
      `);

      const migration = fs.readFileSync(path.join(getMigrationsDir(), '0014_hotwire_votes.sql'), 'utf8');
      await legacy.d1.exec(migration);

      const votes = await legacy.d1.prepare('SELECT app_id, voter_hash FROM drop_upvotes ORDER BY voter_hash').all();
      expect(votes.results).toEqual([{ app_id: 'dronehunter', voter_hash: 'valid-vote' }]);
      const foreignKeys = legacy.rawDb.exec('PRAGMA foreign_key_list(drop_upvotes);');
      expect(foreignKeys[0]?.values.some(row => row[2] === 'app_listings' && row[6] === 'CASCADE')).toBe(true);
      expect(legacy.runForeignKeyCheck()).toEqual([]);
    });

    it('should migrate a populated database through 0029 using D1 deferred foreign keys with all child rows preserved', async () => {
      const legacy = await createTestD1Database({
        foreignKeys: true,
        migrations: CANONICAL_MIGRATIONS.slice(
          0,
          CANONICAL_MIGRATIONS.indexOf('0029_contributor_revenue_sharing.sql')
        )
      });

      // Populate fixture with fulfilled order, frozen allocation, and child table rows
      await legacy.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key, status)
        VALUES ('repo_pop_test', 'usr_nate', 'pop-repo', 'storage_pop', 'active')
      `).run();

      await legacy.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json, status
        ) VALUES (
          'cord_pop_1', 'chk_pop_1', 'usr_sam', 'dronehunter', 'usr_nate',
          'v1.0.0', 1, 3000, 'usd', '{}', 'fulfilled'
        )
      `).run();

      await legacy.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, source_repository_id, basis_points, amount_cents
        ) VALUES (
          'coa_pop_1', 'cord_pop_1', 0, 'maker', 'usr_nate', 'repo_pop_test', 9000, 2700
        )
      `).run();

      await legacy.d1.prepare(`
        INSERT INTO commerce_transfer_outbox (
          id, order_id, allocation_id, destination_user_id, amount_cents, currency
        ) VALUES (
          'cout_pop_1', 'cord_pop_1', 'coa_pop_1', 'usr_nate', 2700, 'usd'
        )
      `).run();

      await legacy.d1.prepare(`
        INSERT INTO stripe_event_inbox (event_id, event_type, livemode, payload_json, payload_sha256)
        VALUES ('evt_pop_1', 'charge.refund.updated', 0, '{}', ?)
      `).bind('a'.repeat(64)).run();

      await legacy.d1.prepare(`
        INSERT INTO commerce_refunds (
          id, stripe_refund_id, order_id, stripe_charge_id, amount_cents, currency, status,
          authoritative_json, first_event_id, last_event_id
        ) VALUES (
          're_pop_1', 'sr_pop_1', 'cord_pop_1', 'ch_pop_1', 2700, 'usd', 'succeeded',
          '{}', 'evt_pop_1', 'evt_pop_1'
        )
      `).run();

      await legacy.d1.prepare(`
        INSERT INTO commerce_refund_allocations (
          id, refund_id, allocation_id, sequence, amount_cents
        ) VALUES (
          'cra_pop_1', 're_pop_1', 'coa_pop_1', 0, 2700
        )
      `).run();

      await legacy.d1.prepare(`
        INSERT INTO commerce_recovery_obligations (
          id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
          source_event_id, amount_cents, currency, status
        ) VALUES (
          'cro_pop_1', 'cord_pop_1', 'refund', 're_pop_1', 'coa_pop_1', 'cout_pop_1',
          'evt_pop_1', 2700, 'usd', 'pending'
        )
      `).run();

      expect(legacy.runForeignKeyCheck()).toEqual([]);

      const migration = fs.readFileSync(path.join(getMigrationsDir(), '0029_contributor_revenue_sharing.sql'), 'utf8');
      await legacy.d1.exec(migration);

      expect(legacy.runForeignKeyCheck()).toEqual([]);

      // Verify all populated rows preserved with exact fidelity
      const alloc = await legacy.d1.prepare('SELECT * FROM commerce_order_allocations WHERE id = ?')
        .bind('coa_pop_1').first<any>();
      expect(alloc?.id).toBe('coa_pop_1');
      expect(alloc?.role).toBe('maker');
      expect(alloc?.amount_cents).toBe(2700);

      const outbox = await legacy.d1.prepare('SELECT * FROM commerce_transfer_outbox WHERE id = ?')
        .bind('cout_pop_1').first<any>();
      expect(outbox?.id).toBe('cout_pop_1');
      expect(outbox?.allocation_id).toBe('coa_pop_1');
      expect(outbox?.amount_cents).toBe(2700);

      const refundAlloc = await legacy.d1.prepare('SELECT * FROM commerce_refund_allocations WHERE id = ?')
        .bind('cra_pop_1').first<any>();
      expect(refundAlloc?.id).toBe('cra_pop_1');
      expect(refundAlloc?.allocation_id).toBe('coa_pop_1');
      expect(refundAlloc?.amount_cents).toBe(2700);

      const recovery = await legacy.d1.prepare('SELECT * FROM commerce_recovery_obligations WHERE id = ?')
        .bind('cro_pop_1').first<any>();
      expect(recovery?.id).toBe('cro_pop_1');
      expect(recovery?.allocation_id).toBe('coa_pop_1');
      expect(recovery?.amount_cents).toBe(2700);

      // Verify FK enforcement is active post-rebuild
      await expect(
        legacy.d1.prepare(`
          INSERT INTO commerce_transfer_outbox (
            id, order_id, allocation_id, destination_user_id, amount_cents, currency
          ) VALUES ('cout_bad_fk', 'cord_pop_1', 'nonexistent_alloc', 'usr_nate', 2700, 'usd')
        `).run()
      ).rejects.toThrow();

      // Verify 'contributor' allocation row can now be inserted (CHECK widened)
      await legacy.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, source_repository_id, basis_points, amount_cents
        ) VALUES ('coa_pop_contrib', 'cord_pop_1', 1, 'contributor', 'usr_sam', 'repo_pop_test', 1000, 300)
      `).run();

      const contribAlloc = await legacy.d1.prepare('SELECT * FROM commerce_order_allocations WHERE id = ?')
        .bind('coa_pop_contrib').first<any>();
      expect(contribAlloc?.id).toBe('coa_pop_contrib');
      expect(contribAlloc?.role).toBe('contributor');
      expect(contribAlloc?.recipient_user_id).toBe('usr_sam');
      expect(contribAlloc?.amount_cents).toBe(300);

      // Verify outbox trigger admits contributor transfer
      await legacy.d1.prepare(`
        INSERT INTO commerce_transfer_outbox (
          id, order_id, allocation_id, destination_user_id, amount_cents, currency
        ) VALUES ('cout_pop_contrib', 'cord_pop_1', 'coa_pop_contrib', 'usr_sam', 300, 'usd')
      `).run();

      const contribOutbox = await legacy.d1.prepare('SELECT * FROM commerce_transfer_outbox WHERE id = ?')
        .bind('cout_pop_contrib').first<any>();
      expect(contribOutbox?.id).toBe('cout_pop_contrib');
      expect(contribOutbox?.destination_user_id).toBe('usr_sam');
      expect(contribOutbox?.amount_cents).toBe(300);

      // Verify recovery trigger admits contributor recovery obligation
      await legacy.d1.prepare(`
        INSERT INTO commerce_recovery_obligations (
          id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
          source_event_id, amount_cents, currency, status
        ) VALUES (
          'cro_pop_contrib', 'cord_pop_1', 'refund', 're_pop_1', 'coa_pop_contrib', 'cout_pop_contrib',
          'evt_pop_1', 300, 'usd', 'pending'
        )
      `).run();

      const contribRecovery = await legacy.d1.prepare('SELECT * FROM commerce_recovery_obligations WHERE id = ?')
        .bind('cro_pop_contrib').first<any>();
      expect(contribRecovery?.id).toBe('cro_pop_contrib');
      expect(contribRecovery?.allocation_id).toBe('coa_pop_contrib');
      expect(contribRecovery?.amount_cents).toBe(300);

      // Verify DARK invariant: calculateAllocations emits NO contributor rows
      const allocCalc = calculateAllocations({
        grossCents: 3000,
        currency: 'usd',
        sellerUserId: 'usr_nate',
        repositoryId: 'repo_pop_test'
      });
      expect(allocCalc.allocations.some((a: any) => a.role === 'contributor')).toBe(false);

      // Verify final PRAGMA foreign_key_check is completely clean
      expect(legacy.runForeignKeyCheck()).toEqual([]);
    });
  });

  // ==========================================================================
  // 2. FOREIGN KEY CHECK ON SEEDED DATA
  // ==========================================================================
  describe('2. PRAGMA foreign_key_check Integrity', () => {
    it('should pass PRAGMA foreign_key_check with zero violations on clean migration chain', () => {
      const violations = ctx.runForeignKeyCheck();
      expect(violations).toEqual([]);
      expect(violations.length).toBe(0);
    });

    it('should verify all seed users are correctly populated and referenced', async () => {
      const users = await ctx.d1.prepare('SELECT id, username, role FROM users ORDER BY username').all();
      expect(users.results?.length).toBe(3);
      expect(users.results?.map((u: any) => u.username)).toEqual(['josh', 'nate', 'sam']);
    });

    it('should verify all seed app listings reference valid creator users', async () => {
      const apps = await ctx.d1.prepare(`
        SELECT a.id, a.name, a.creator_id, u.username
        FROM app_listings a
        JOIN users u ON a.creator_id = u.id
        WHERE a.listing_status = 'active'
        ORDER BY a.id
      `).all();

      expect(apps.results?.length).toBe(4);
      expect(apps.results?.map((a: any) => a.id)).toEqual(['american-gardener', 'certified-mailer', 'dronehunter', 'wallart']);
      apps.results?.forEach((a: any) => {
        expect(a.creator_id).toBe('usr_nate');
        expect(a.username).toBe('nate');
      });
    });

    it('should verify seed shelf items reference valid users and apps', async () => {
      const shelf = await ctx.d1.prepare(`
        SELECT s.id, s.user_id, s.app_id, u.username, a.name
        FROM shelf_items s
        JOIN users u ON s.user_id = u.id
        JOIN app_listings a ON s.app_id = a.id
      `).all();

      expect(shelf.results?.length).toBe(3);
    });

    it('should verify seed comments reference valid users and apps', async () => {
      const comments = await ctx.d1.prepare(`
        SELECT c.id, c.app_id, c.user_id, u.username, a.name
        FROM comments c
        JOIN users u ON c.user_id = u.id
        JOIN app_listings a ON c.app_id = a.id
      `).all();

      expect(comments.results?.length).toBe(3);
    });
  });

  // ==========================================================================
  // 3. FOREIGN KEY ENFORCEMENT & VIOLATION REJECTION
  // ==========================================================================
  describe('3. Foreign Key Enforcement (PRAGMA foreign_keys = ON)', () => {
    it('should reject user_sessions with non-existent user_id', async () => {
      await expect(
        ctx.d1.prepare('INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
          .bind('a'.repeat(64), 'nonexistent_user', Date.now() + 10000)
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject app_listings with non-existent creator_id', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO app_listings (id, name, tagline, description, creator_id, version)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind('app_orphan', 'Orphan App', 'tag', 'desc', 'nonexistent_user', '1.0.0')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject shelf_items with non-existent user_id or app_id', async () => {
      await expect(
        ctx.d1.prepare('INSERT INTO shelf_items (id, user_id, app_id, license_key) VALUES (?, ?, ?, ?)')
          .bind('sh_inv1', 'nonexistent_user', 'dronehunter', 'KEY-123')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);

      await expect(
        ctx.d1.prepare('INSERT INTO shelf_items (id, user_id, app_id, license_key) VALUES (?, ?, ?, ?)')
          .bind('sh_inv2', 'usr_nate', 'nonexistent_app', 'KEY-124')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject comments with non-existent user_id or app_id', async () => {
      await expect(
        ctx.d1.prepare('INSERT INTO comments (id, app_id, user_id, text) VALUES (?, ?, ?, ?)')
          .bind('c_inv1', 'nonexistent_app', 'usr_nate', 'Nice app')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);

      await expect(
        ctx.d1.prepare('INSERT INTO comments (id, app_id, user_id, text) VALUES (?, ?, ?, ?)')
          .bind('c_inv2', 'dronehunter', 'nonexistent_user', 'Nice app')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject comment_upvotes with non-existent comment_id or user_id', async () => {
      await expect(
        ctx.d1.prepare('INSERT INTO comment_upvotes (comment_id, user_id) VALUES (?, ?)')
          .bind('nonexistent_comment', 'usr_nate')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);

      await expect(
        ctx.d1.prepare('INSERT INTO comment_upvotes (comment_id, user_id) VALUES (?, ?)')
          .bind('c101', 'nonexistent_user')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject orders with non-existent buyer_user_id or app_id', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO orders (id, buyer_user_id, app_id, gross_cents, stripe_payment_intent_id)
          VALUES (?, ?, ?, ?, ?)
        `).bind('ord_inv1', 'nonexistent_user', 'dronehunter', 1500, 'pi_inv1')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);

      await expect(
        ctx.d1.prepare(`
          INSERT INTO orders (id, buyer_user_id, app_id, gross_cents, stripe_payment_intent_id)
          VALUES (?, ?, ?, ?, ?)
        `).bind('ord_inv2', 'usr_nate', 'nonexistent_app', 1500, 'pi_inv2')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject transfers_ledger referencing non-existent orders or users', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO transfers_ledger (id, order_id, destination_user_id, destination_stripe_account, amount_cents, role)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind('tr_inv1', 'nonexistent_order', 'usr_nate', 'acct_1', 1050, 'maker')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);

      // Create valid order first
      await ctx.d1.prepare(`
        INSERT INTO orders (id, buyer_user_id, app_id, gross_cents, stripe_payment_intent_id)
        VALUES ('ord_valid1', 'usr_nate', 'dronehunter', 1500, 'pi_valid1')
      `).run();

      await expect(
        ctx.d1.prepare(`
          INSERT INTO transfers_ledger (id, order_id, destination_user_id, destination_stripe_account, amount_cents, role)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind('tr_inv2', 'ord_valid1', 'nonexistent_user', 'acct_1', 1050, 'maker')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject repositories (0006) referencing non-existent owner_user_id', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO repositories (id, owner_user_id, slug, storage_key)
          VALUES (?, ?, ?, ?)
        `).bind('repo_inv', 'nonexistent_user', 'my-repo', 'key_inv')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject feature_packages (0006) referencing non-existent repository or user', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO feature_packages (id, repository_id, owner_user_id, slug, name)
          VALUES (?, ?, ?, ?, ?)
        `).bind('fp_inv', 'nonexistent_repo', 'usr_nate', 'feature-mod', 'Feature Mod')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject dyno_runs (0007) referencing non-existent suite, subject, or environment', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO dyno_runs (id, suite_id, subject_id, environment_id, randomization_seed)
          VALUES (?, ?, ?, ?, ?)
        `).bind('run_inv', 'nonexistent_suite', 'nonexistent_subject', 'nonexistent_env', 'seed_1')
          .run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should reject terminal_session_tickets (0018) referencing non-existent user_id', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO terminal_session_tickets (jti, user_id, issued_at, expires_at)
          VALUES ('jti_inv', 'nonexistent_user', 1000, 2000)
        `).run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  // ==========================================================================
  // 4. CASCADE DELETE INVARIANTS
  // ==========================================================================
  describe('4. Cascading Deletes Across Schema Relationships', () => {
    it('should cascade delete user_sessions, shelf_items, comments, inbox_messages when user is deleted', async () => {
      // Create a test user
      const testUserId = 'usr_cascade_test';
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES (?, 'cascadetest', 'Cascade Test User', 'user')
      `).bind(testUserId).run();

      // Add related records
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, ?, ?)
      `).bind('b'.repeat(64), testUserId, Date.now() + 10000).run();

      await ctx.d1.prepare(`
        INSERT INTO shelf_items (id, user_id, app_id, license_key)
        VALUES ('sh_cascade', ?, 'dronehunter', 'KEY-CASCADE')
      `).bind(testUserId).run();

      await ctx.d1.prepare(`
        INSERT INTO comments (id, app_id, user_id, text)
        VALUES ('c_cascade', 'dronehunter', ?, 'Testing cascade delete')
      `).bind(testUserId).run();

      await ctx.d1.prepare(`
        INSERT INTO comment_upvotes (comment_id, user_id)
        VALUES ('c101', ?)
      `).bind(testUserId).run();

      await ctx.d1.prepare(`
        INSERT INTO chat_messages (id, channel, user_id, text)
        VALUES ('msg_cascade', '#lounge', ?, 'Hello world')
      `).bind(testUserId).run();

      await ctx.d1.prepare(`
        INSERT INTO inbox_messages (id, user_id, title, preview, content)
        VALUES ('inbox_cascade', ?, 'Title', 'Preview', 'Content')
      `).bind(testUserId).run();

      await ctx.d1.prepare(`
        INSERT INTO stripe_accounts (user_id, stripe_account_id)
        VALUES (?, 'acct_cascade_123')
      `).bind(testUserId).run();

      await ctx.d1.prepare(`
        INSERT INTO terminal_session_tickets (jti, user_id, issued_at, expires_at)
        VALUES ('jti_cascade', ?, 1000, 2000)
      `).bind(testUserId).run();

      // Verify all child rows exist
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM user_sessions WHERE user_id = ?').bind(testUserId).first('c')).toBe(1);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM shelf_items WHERE user_id = ?').bind(testUserId).first('c')).toBe(1);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM comments WHERE user_id = ?').bind(testUserId).first('c')).toBe(1);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM comment_upvotes WHERE user_id = ?').bind(testUserId).first('c')).toBe(1);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM chat_messages WHERE user_id = ?').bind(testUserId).first('c')).toBe(1);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM inbox_messages WHERE user_id = ?').bind(testUserId).first('c')).toBe(1);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM stripe_accounts WHERE user_id = ?').bind(testUserId).first('c')).toBe(1);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM terminal_session_tickets WHERE user_id = ?').bind(testUserId).first('c')).toBe(1);

      // Delete parent user
      await ctx.d1.prepare('DELETE FROM users WHERE id = ?').bind(testUserId).run();

      // Verify all cascaded rows are automatically purged
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM user_sessions WHERE user_id = ?').bind(testUserId).first('c')).toBe(0);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM shelf_items WHERE user_id = ?').bind(testUserId).first('c')).toBe(0);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM comments WHERE user_id = ?').bind(testUserId).first('c')).toBe(0);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM comment_upvotes WHERE user_id = ?').bind(testUserId).first('c')).toBe(0);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM chat_messages WHERE user_id = ?').bind(testUserId).first('c')).toBe(0);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM inbox_messages WHERE user_id = ?').bind(testUserId).first('c')).toBe(0);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM stripe_accounts WHERE user_id = ?').bind(testUserId).first('c')).toBe(0);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM terminal_session_tickets WHERE user_id = ?').bind(testUserId).first('c')).toBe(0);

      // Verify foreign key integrity remains clean after cascade
      expect(ctx.runForeignKeyCheck()).toEqual([]);
    });

    it('should cascade delete transfers_ledger when order is deleted', async () => {
      await ctx.d1.prepare(`
        INSERT INTO orders (id, buyer_user_id, app_id, gross_cents, stripe_payment_intent_id)
        VALUES ('ord_casc1', 'usr_nate', 'dronehunter', 1500, 'pi_casc1')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO transfers_ledger (id, order_id, destination_user_id, destination_stripe_account, amount_cents, role)
        VALUES ('tr_casc1', 'ord_casc1', 'usr_nate', 'acct_1', 1050, 'maker')
      `).run();

      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM transfers_ledger WHERE order_id = ?').bind('ord_casc1').first('c')).toBe(1);

      await ctx.d1.prepare('DELETE FROM orders WHERE id = ?').bind('ord_casc1').run();

      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM transfers_ledger WHERE order_id = ?').bind('ord_casc1').first('c')).toBe(0);
      expect(ctx.runForeignKeyCheck()).toEqual([]);
    });

    it('should cascade delete dyno_task_attempts and dyno_tool_events when dyno_run is deleted', async () => {
      // Setup Dyno suite, task, subject, environment
      await ctx.d1.prepare(`
        INSERT INTO dyno_suites (id, slug, version, name, methodology_markdown, task_manifest_digest, grader_version)
        VALUES ('suite_1', 'core-bench', 'v1.0', 'Core Bench', '# Method', 'man_1', 'g1')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO dyno_tasks (id, suite_id, task_key, category, title, prompt_digest, fixture_digest, grader_manifest_digest, time_limit_seconds)
        VALUES ('task_1', 'suite_1', 't1', 'find_bug', 'Find Bug 1', 'pd1', 'fd1', 'gd1', 60)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO dyno_subjects (id, model_provider, model_id, agent_harness, harness_version, tool_manifest)
        VALUES ('subj_1', 'google', 'gemini-2.5-pro', 'agy', '2.0', 'tm1')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO dyno_environments (id, os_name, os_version, architecture, container_image_digest, runtime_manifest, network_policy)
        VALUES ('env_1', 'macos', '15.0', 'arm64', 'img_1', 'rt_1', 'none')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO dyno_runs (id, suite_id, subject_id, environment_id, randomization_seed)
        VALUES ('run_1', 'suite_1', 'subj_1', 'env_1', 'seed_100')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO dyno_task_attempts (id, run_id, task_id, attempt_number, status, duration_ms, started_at)
        VALUES ('att_1', 'run_1', 'task_1', 1, 'passed', 1200, datetime('now'))
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO dyno_tool_events (id, task_attempt_id, sequence_number, tool_name, started_offset_ms, input_digest)
        VALUES ('evt_1', 'att_1', 0, 'view_file', 100, 'in_1')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO dyno_grader_results (id, task_attempt_id, grader_key, grader_version, passed, score, max_score, evidence_digest)
        VALUES ('gr_1', 'att_1', 'gk1', 'v1', 1, 100, 100, 'ev_1')
      `).run();

      // Delete dyno_run
      await ctx.d1.prepare('DELETE FROM dyno_runs WHERE id = ?').bind('run_1').run();

      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM dyno_task_attempts WHERE run_id = ?').bind('run_1').first('c')).toBe(0);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM dyno_tool_events WHERE task_attempt_id = ?').bind('att_1').first('c')).toBe(0);
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM dyno_grader_results WHERE task_attempt_id = ?').bind('att_1').first('c')).toBe(0);
      expect(ctx.runForeignKeyCheck()).toEqual([]);
    });
  });

  // ==========================================================================
  // 5. IMMUTABILITY TRIGGERS & CHECK CONSTRAINTS
  // ==========================================================================
  describe('5. Database Triggers & Check Constraints', () => {
    it('should prevent mutation or deletion of repository_forks via SQLite triggers', async () => {
      // Create parent and child repositories
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key)
        VALUES ('repo_p', 'usr_nate', 'parent-repo', 'storage_p')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key)
        VALUES ('repo_c', 'usr_sam', 'child-fork', 'storage_c')
      `).run();

      // Insert fork lineage
      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES ('repo_c', 'repo_p', 'usr_sam', 'refs/heads/main', 'sha_p1', 'sha_c1', 'repo_p', 1)
      `).run();

      // Attempt UPDATE -> must be aborted by trigger
      await expect(
        ctx.d1.prepare('UPDATE repository_forks SET depth = 2 WHERE child_repository_id = ?')
          .bind('repo_c')
          .run()
      ).rejects.toThrow(/repository fork ancestry is immutable/);

      // Attempt DELETE -> must be aborted by trigger
      await expect(
        ctx.d1.prepare('DELETE FROM repository_forks WHERE child_repository_id = ?')
          .bind('repo_c')
          .run()
      ).rejects.toThrow(/repository fork ancestry is immutable/);
    });

    it('should enforce CHECK constraints on repository visibility and object format', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO repositories (id, owner_user_id, slug, storage_key, visibility)
          VALUES ('repo_inv_vis', 'usr_nate', 'slug-vis', 'key_vis', 'invalid_visibility')
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      await expect(
        ctx.d1.prepare(`
          INSERT INTO repositories (id, owner_user_id, slug, storage_key, object_format)
          VALUES ('repo_inv_fmt', 'usr_nate', 'slug-fmt', 'key_fmt', 'invalid_format')
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should enforce CHECK constraint preventing self-forks (child <> parent)', async () => {
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key)
        VALUES ('repo_self', 'usr_nate', 'self-repo', 'storage_self')
      `).run();

      await expect(
        ctx.d1.prepare(`
          INSERT INTO repository_forks (
            child_repository_id, parent_repository_id, forked_by_user_id,
            parent_ref_name, parent_commit_oid, child_initial_commit_oid,
            lineage_root_repository_id, depth
          ) VALUES ('repo_self', 'repo_self', 'usr_nate', 'refs/heads/main', 'sha1', 'sha1', 'repo_self', 1)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should enforce CHECK constraints on dyno task categories and positive weights/limits', async () => {
      await ctx.d1.prepare(`
        INSERT INTO dyno_suites (id, slug, version, name, methodology_markdown, task_manifest_digest, grader_version)
        VALUES ('suite_chk', 'chk-bench', 'v1.0', 'Check Bench', '# Method', 'man_chk', 'g1')
      `).run();

      // Invalid category
      await expect(
        ctx.d1.prepare(`
          INSERT INTO dyno_tasks (id, suite_id, task_key, category, title, prompt_digest, fixture_digest, grader_manifest_digest, time_limit_seconds)
          VALUES ('task_inv_cat', 'suite_chk', 'tk1', 'invalid_category', 'Title', 'pd', 'fd', 'gd', 60)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // Non-positive time limit (<= 0)
      await expect(
        ctx.d1.prepare(`
          INSERT INTO dyno_tasks (id, suite_id, task_key, category, title, prompt_digest, fixture_digest, grader_manifest_digest, time_limit_seconds)
          VALUES ('task_inv_time', 'suite_chk', 'tk2', 'find_bug', 'Title', 'pd', 'fd', 'gd', 0)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // Non-positive weight (<= 0)
      await expect(
        ctx.d1.prepare(`
          INSERT INTO dyno_tasks (id, suite_id, task_key, category, title, prompt_digest, fixture_digest, grader_manifest_digest, time_limit_seconds, weight)
          VALUES ('task_inv_wt', 'suite_chk', 'tk3', 'find_bug', 'Title', 'pd', 'fd', 'gd', 60, -1)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should freeze order economics and allocation rows', async () => {
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json
        ) VALUES ('cord_immutable', 'checkout-1', 'usr_sam', 'dronehunter', 'usr_nate',
                  'v1.0.0', 1, 1500, 'usd', '{}')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES ('calloc_immutable', 'cord_immutable', 0, 'maker', 'usr_nate', 9000, 1350)
      `).run();

      await expect(
        ctx.d1.prepare('UPDATE commerce_orders SET gross_cents = 1 WHERE id = ?')
          .bind('cord_immutable').run()
      ).rejects.toThrow(/commerce order economics are immutable/);
      await expect(
        ctx.d1.prepare("UPDATE commerce_orders SET repository_id = 'repo_new' WHERE id = ?")
          .bind('cord_immutable').run()
      ).rejects.toThrow(/commerce order economics are immutable/);
      await expect(
        ctx.d1.prepare('UPDATE commerce_order_allocations SET amount_cents = 1 WHERE id = ?')
          .bind('calloc_immutable').run()
      ).rejects.toThrow(/commerce order allocations are immutable/);
      await expect(
        ctx.d1.prepare('DELETE FROM commerce_order_allocations WHERE id = ?')
          .bind('calloc_immutable').run()
      ).rejects.toThrow(/commerce order allocations are immutable/);
    });

    it('should reject licenses and payout work unless the immutable fulfilled order matches', async () => {
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json, status
        ) VALUES ('cord_cancelled', 'checkout-cancelled', 'usr_sam', 'dronehunter', 'usr_nate',
                  'v1.0.0', 1, 1500, 'usd', '{}', 'cancelled')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES ('calloc_cancelled', 'cord_cancelled', 0, 'maker', 'usr_nate', 9000, 1350)
      `).run();

      await expect(ctx.d1.prepare(`
        INSERT INTO commerce_licenses
          (id, order_id, app_id, owner_user_id, license_key_hash, license_key_last4)
        VALUES ('clic_cancelled', 'cord_cancelled', 'dronehunter', 'usr_sam', ?, 'ABCD')
      `).bind('a'.repeat(64)).run()).rejects.toThrow(/commerce license requires matching fulfilled order/);

      await expect(ctx.d1.prepare(`
        INSERT INTO commerce_transfer_outbox
          (id, order_id, allocation_id, destination_user_id, amount_cents, currency)
        VALUES ('cout_cancelled', 'cord_cancelled', 'calloc_cancelled', 'usr_nate', 1350, 'usd')
      `).run()).rejects.toThrow(/commerce outbox requires matching fulfilled allocation/);
    });

    it('should enforce CHECK constraints on terminal_session_tickets (0018)', async () => {
      // expires_at <= issued_at must fail
      await expect(
        ctx.d1.prepare(`
          INSERT INTO terminal_session_tickets (jti, user_id, issued_at, expires_at)
          VALUES ('jti_bad_exp', 'usr_nate', 2000, 1000)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // redeemed_at < issued_at must fail
      await expect(
        ctx.d1.prepare(`
          INSERT INTO terminal_session_tickets (jti, user_id, issued_at, expires_at, redeemed_at)
          VALUES ('jti_bad_red', 'usr_nate', 2000, 3000, 1000)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // closed_at without redeemed_at must fail
      await expect(
        ctx.d1.prepare(`
          INSERT INTO terminal_session_tickets (jti, user_id, issued_at, expires_at, closed_at)
          VALUES ('jti_bad_close', 'usr_nate', 2000, 3000, 2500)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });
  });

  // ==========================================================================
  // 6. UNIQUE CONSTRAINTS & DEDUPLICATION LEDGER (0002)
  // ==========================================================================
  describe('6. Unique Constraints & Deduplication Ledger (0002)', () => {
    it('should enforce UNIQUE constraint on licenses(order_id)', async () => {
      await ctx.d1.prepare(`
        INSERT INTO orders (id, buyer_user_id, app_id, gross_cents, stripe_payment_intent_id)
        VALUES ('ord_uniq1', 'usr_nate', 'dronehunter', 1500, 'pi_uniq1')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO licenses (id, license_key, app_id, owner_user_id, order_id)
        VALUES ('lic_1', 'KEY-1', 'dronehunter', 'usr_nate', 'ord_uniq1')
      `).run();

      // Second license with identical order_id must fail unique constraint
      await expect(
        ctx.d1.prepare(`
          INSERT INTO licenses (id, license_key, app_id, owner_user_id, order_id)
          VALUES ('lic_2', 'KEY-2', 'dronehunter', 'usr_nate', 'ord_uniq1')
        `).run()
      ).rejects.toThrow(/UNIQUE constraint failed/);
    });

    it('should enforce UNIQUE constraint on shelf_items(user_id, app_id)', async () => {
      // usr_nate already owns dronehunter from seed data
      await expect(
        ctx.d1.prepare(`
          INSERT INTO shelf_items (id, user_id, app_id, license_key)
          VALUES ('shelf_dup', 'usr_nate', 'dronehunter', 'KEY-DUP')
        `).run()
      ).rejects.toThrow(/UNIQUE constraint failed/);
    });

    it('should enforce UNIQUE constraint on transfers_ledger(order_id, role)', async () => {
      await ctx.d1.prepare(`
        INSERT INTO orders (id, buyer_user_id, app_id, gross_cents, stripe_payment_intent_id)
        VALUES ('ord_uniq_role', 'usr_nate', 'dronehunter', 1500, 'pi_uniq_role')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO transfers_ledger (id, order_id, destination_user_id, destination_stripe_account, amount_cents, role)
        VALUES ('tr_r1', 'ord_uniq_role', 'usr_nate', 'acct_1', 1050, 'maker')
      `).run();

      // Second transfer for same order with role 'maker' must fail
      await expect(
        ctx.d1.prepare(`
          INSERT INTO transfers_ledger (id, order_id, destination_user_id, destination_stripe_account, amount_cents, role)
          VALUES ('tr_r2', 'ord_uniq_role', 'usr_nate', 'acct_1', 1050, 'maker')
        `).run()
      ).rejects.toThrow(/UNIQUE constraint failed/);
    });

    it('should enforce PRIMARY KEY deduplication on processed_webhook_events(event_id)', async () => {
      await ctx.d1.prepare(`
        INSERT INTO processed_webhook_events (event_id, event_type)
        VALUES ('evt_123', 'payment_intent.succeeded')
      `).run();

      // Duplicate event insert must fail
      await expect(
        ctx.d1.prepare(`
          INSERT INTO processed_webhook_events (event_id, event_type)
          VALUES ('evt_123', 'payment_intent.succeeded')
        `).run()
      ).rejects.toThrow(/UNIQUE constraint failed/);
    });

    it('should enforce deployment_state CHECK constraint on app_listings', async () => {
      // Valid deployment states: draft, source_ready, building, deployable, active, failed, retired, client_demo
      const valid = await ctx.d1.prepare(`
        SELECT id, deployment_state FROM app_listings WHERE id = 'american-gardener'
      `).first<{ id: string; deployment_state: string }>();
      expect(valid?.deployment_state).toBe('draft');

      // Invalid deployment state must fail CHECK constraint
      await expect(
        ctx.d1.prepare(`
          UPDATE app_listings SET deployment_state = 'invalid_state' WHERE id = 'american-gardener'
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should ensure no migration seeds active without an active_deployment_id', async () => {
      const activeWithoutRevision = await ctx.d1.prepare(`
        SELECT id, deployment_state, active_deployment_id
        FROM app_listings
        WHERE deployment_state = 'active' AND (active_deployment_id IS NULL OR trim(active_deployment_id) = '')
      `).all();
      expect(activeWithoutRevision.results).toEqual([]);

      // Verify that the seed demo entries are seeded as client_demo, NOT active
      const demos = await ctx.d1.prepare(`
        SELECT id, deployment_state, active_deployment_id
        FROM app_listings
        WHERE id IN ('dronehunter', 'certified-mailer', 'wallart')
      `).all<any>();
      expect(demos.results?.map(d => d.deployment_state)).toEqual(['client_demo', 'client_demo', 'client_demo']);
      demos.results?.forEach(d => expect(d.active_deployment_id).toBeNull());
    });

    it('should support explicit repository_id foreign key linkage (migration 0024)', async () => {
      // 1. Check column exists and is nullable
      const listing = await ctx.d1.prepare(`
        SELECT id, repository_id FROM app_listings WHERE id = 'wallart'
      `).first<{ id: string; repository_id: string | null }>();
      expect(listing).toBeDefined();
      expect(listing?.id).toBe('wallart');
      expect(listing?.repository_id).toBeNull();

      // 2. Reject non-existent repository_id under foreign key enforcement
      await expect(
        ctx.d1.prepare(`
          UPDATE app_listings SET repository_id = 'nonexistent_repo' WHERE id = 'wallart'
        `).run()
      ).rejects.toThrow(/FOREIGN KEY constraint failed/);

      // 3. Link valid repository
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key, status)
        VALUES ('repo_wallart', 'usr_nate', 'wallart', 'storage_wallart', 'active')
      `).run();

      await ctx.d1.prepare(`
        UPDATE app_listings SET repository_id = 'repo_wallart' WHERE id = 'wallart'
      `).run();

      const updated = await ctx.d1.prepare(`
        SELECT id, repository_id FROM app_listings WHERE id = 'wallart'
      `).first<{ id: string; repository_id: string | null }>();
      expect(updated?.repository_id).toBe('repo_wallart');

      expect(ctx.runForeignKeyCheck()).toEqual([]);
    });

    it('should support host resolution and origin dispatch metadata (migration 0025)', async () => {
      // 1. Verify columns exist and are populated with backfilled defaults
      const listing = await ctx.d1.prepare(`
        SELECT id, hostname, origin_kind, origin_ref FROM app_listings WHERE id = 'dronehunter'
      `).first<{ id: string; hostname: string; origin_kind: string; origin_ref: string | null }>();
      expect(listing).toBeDefined();
      expect(listing?.id).toBe('dronehunter');
      expect(listing?.hostname).toBe('dronehunter');
      expect(listing?.origin_kind).toBe('r2_static');
      expect(listing?.origin_ref).toBeNull();

      // 2. Reject invalid origin_kind values under CHECK constraint
      await expect(
        ctx.d1.prepare(`
          UPDATE app_listings SET origin_kind = 'invalid_kind' WHERE id = 'dronehunter'
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // 3. Accept valid origin_kind values
      for (const kind of ['r2_static', 'worker', 'cf_container', 'fargate_warm'] as const) {
        await ctx.d1.prepare(`
          UPDATE app_listings SET origin_kind = ? WHERE id = 'dronehunter'
        `).bind(kind).run();
        const updated = await ctx.d1.prepare(`
          SELECT origin_kind FROM app_listings WHERE id = 'dronehunter'
        `).first<{ origin_kind: string }>();
        expect(updated?.origin_kind).toBe(kind);
      }

      // Reset back to r2_static
      await ctx.d1.prepare(`
        UPDATE app_listings SET origin_kind = 'r2_static' WHERE id = 'dronehunter'
      `).run();

      // 4. Verify index on hostname exists
      const indices = ctx.getIndexNames();
      expect(indices.some(idx => idx === 'idx_app_listings_hostname' || idx === 'idx_app_listings_hostname_unique')).toBe(true);

      expect(ctx.runForeignKeyCheck()).toEqual([]);
    });

    it('should support Postgres add-on metadata (migration 0027)', async () => {
      // 1. Verify columns exist on app_listings
      const listing = await ctx.d1.prepare(`
        SELECT id, db_kind, db_secret_path, db_provisioned_at FROM app_listings WHERE id = 'dronehunter'
      `).first<{ id: string; db_kind: string | null; db_secret_path: string | null; db_provisioned_at: string | null }>();
      expect(listing).toBeDefined();
      expect(listing?.id).toBe('dronehunter');
      expect(listing?.db_kind).toBeNull();
      expect(listing?.db_secret_path).toBeNull();
      expect(listing?.db_provisioned_at).toBeNull();

      // 2. Reject invalid db_kind under CHECK constraint
      await expect(
        ctx.d1.prepare(`
          UPDATE app_listings SET db_kind = 'mysql' WHERE id = 'dronehunter'
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // 3. Accept valid postgres db_kind and secret path
      await ctx.d1.prepare(`
        UPDATE app_listings SET
          db_kind = 'postgres',
          db_secret_path = '/nsw/apps/dronehunter/db-url',
          db_provisioned_at = CURRENT_TIMESTAMP
        WHERE id = 'dronehunter'
      `).run();

      const updated = await ctx.d1.prepare(`
        SELECT db_kind, db_secret_path, db_provisioned_at FROM app_listings WHERE id = 'dronehunter'
      `).first<{ db_kind: string; db_secret_path: string; db_provisioned_at: string }>();
      expect(updated?.db_kind).toBe('postgres');
      expect(updated?.db_secret_path).toBe('/nsw/apps/dronehunter/db-url');
      expect(updated?.db_provisioned_at).toBeTruthy();

      expect(ctx.runForeignKeyCheck()).toEqual([]);
    });

    it('should support contributor revenue sharing schema and invariants (migration 0029)', async () => {
      // 1. Repositories grantable_bps column defaults to 0 and enforces [0, 10000]
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key, status)
        VALUES ('repo_contrib_test', 'usr_nate', 'contrib-repo', 'storage_contrib_test', 'active')
      `).run();

      const repo = await ctx.d1.prepare('SELECT id, grantable_bps FROM repositories WHERE id = ?')
        .bind('repo_contrib_test').first<{ id: string; grantable_bps: number }>();
      expect(repo?.grantable_bps).toBe(0);

      // Rejects grantable_bps < 0 or > 10000
      await expect(
        ctx.d1.prepare('UPDATE repositories SET grantable_bps = -1 WHERE id = ?')
          .bind('repo_contrib_test').run()
      ).rejects.toThrow(/CHECK constraint failed/);

      await expect(
        ctx.d1.prepare('UPDATE repositories SET grantable_bps = 10001 WHERE id = ?')
          .bind('repo_contrib_test').run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // Accepts valid grantable_bps
      await ctx.d1.prepare('UPDATE repositories SET grantable_bps = 2500 WHERE id = ?')
        .bind('repo_contrib_test').run();
      const updatedRepo = await ctx.d1.prepare('SELECT grantable_bps FROM repositories WHERE id = ?')
        .bind('repo_contrib_test').first<{ grantable_bps: number }>();
      expect(updatedRepo?.grantable_bps).toBe(2500);

      // 2. contributor_shares table constraints
      // Rejects contributor == granted_by (self-grant check)
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points)
          VALUES ('cs_self', 'repo_contrib_test', 'usr_nate', 'usr_nate', 500)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // Rejects basis_points <= 0 or > 10000
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points)
          VALUES ('cs_zero_bps', 'repo_contrib_test', 'usr_sam', 'usr_nate', 0)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points)
          VALUES ('cs_over_bps', 'repo_contrib_test', 'usr_sam', 'usr_nate', 10001)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // Inserts valid pending contributor share
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (
          id, repository_id, contributor_user_id, granted_by_user_id,
          merge_job_id, merge_attempt_id, merge_approval_id, basis_points
        ) VALUES (
          'cs_valid1', 'repo_contrib_test', 'usr_sam', 'usr_nate',
          'mj_1', 'matt_1', 'mapp_1', 1000
        )
      `).run();

      const share = await ctx.d1.prepare('SELECT * FROM contributor_shares WHERE id = ?')
        .bind('cs_valid1').first<any>();
      expect(share?.status).toBe('pending');
      expect(share?.basis_points).toBe(1000);
      expect(share?.activated_at).toBeNull();
      expect(share?.revoked_at).toBeNull();

      // Enforces UNIQUE(merge_attempt_id)
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (
            id, repository_id, contributor_user_id, granted_by_user_id,
            merge_job_id, merge_attempt_id, merge_approval_id, basis_points
          ) VALUES (
            'cs_dup_attempt', 'repo_contrib_test', 'usr_josh', 'usr_nate',
            'mj_2', 'matt_1', 'mapp_2', 500
          )
        `).run()
      ).rejects.toThrow(/UNIQUE constraint failed/);

      // BEFORE DELETE trigger prevents row deletion (#2)
      await expect(
        ctx.d1.prepare('DELETE FROM contributor_shares WHERE id = ?').bind('cs_valid1').run()
      ).rejects.toThrow(/contributor_shares rows cannot be deleted; use revocation/);

      // 3. contributor_shares triggers: economics-immutable & provenance freeze (#3)
      await expect(
        ctx.d1.prepare('UPDATE contributor_shares SET basis_points = 1500 WHERE id = ?')
          .bind('cs_valid1').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET contributor_user_id = 'usr_josh' WHERE id = ?")
          .bind('cs_valid1').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET granted_by_user_id = 'usr_josh' WHERE id = ?")
          .bind('cs_valid1').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET merge_attempt_id = 'matt_2' WHERE id = ?")
          .bind('cs_valid1').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET merge_job_id = 'mj_new' WHERE id = ?")
          .bind('cs_valid1').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET merge_approval_id = 'mapp_new' WHERE id = ?")
          .bind('cs_valid1').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // 4. contributor_shares triggers: status forward-only & timestamp coupling (#4)
      // Activating without activated_at must fail (#4)
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'active' WHERE id = ?")
          .bind('cs_valid1').run()
      ).rejects.toThrow();

      // pending -> active with activated_at is allowed
      await ctx.d1.prepare(`
        UPDATE contributor_shares SET status = 'active', activated_at = '2026-08-31 12:00:00' WHERE id = ?
      `).bind('cs_valid1').run();

      const activeShare = await ctx.d1.prepare('SELECT status, activated_at FROM contributor_shares WHERE id = ?')
        .bind('cs_valid1').first<any>();
      expect(activeShare?.status).toBe('active');
      expect(activeShare?.activated_at).toBeTruthy();

      // Rewriting activated_at must fail (#4)
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET activated_at = '2026-08-31 13:00:00' WHERE id = ?")
          .bind('cs_valid1').run()
      ).rejects.toThrow(/contributor share economics are immutable/);

      // active -> revoked must be rejected
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'revoked' WHERE id = ?")
          .bind('cs_valid1').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);

      // active -> pending must be rejected
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'pending' WHERE id = ?")
          .bind('cs_valid1').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);

      // Insert another pending share and test pending -> revoked
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (
          id, repository_id, contributor_user_id, granted_by_user_id,
          merge_job_id, merge_attempt_id, merge_approval_id, basis_points
        ) VALUES (
          'cs_valid2', 'repo_contrib_test', 'usr_josh', 'usr_nate',
          'mj_2', 'matt_2', 'mapp_2', 500
        )
      `).run();

      await ctx.d1.prepare(`
        UPDATE contributor_shares SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind('cs_valid2').run();

      const revokedShare = await ctx.d1.prepare('SELECT status, revoked_at FROM contributor_shares WHERE id = ?')
        .bind('cs_valid2').first<any>();
      expect(revokedShare?.status).toBe('revoked');
      expect(revokedShare?.revoked_at).toBeTruthy();

      // revoked -> active must be rejected
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'active' WHERE id = ?")
          .bind('cs_valid2').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);

      // revoked -> pending must be rejected
      await expect(
        ctx.d1.prepare("UPDATE contributor_shares SET status = 'pending' WHERE id = ?")
          .bind('cs_valid2').run()
      ).rejects.toThrow(/contributor share status transition is forward-only/);

      // 5. Widened commerce_order_allocations accepts 'contributor' role
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json, status
        ) VALUES ('cord_contrib', 'checkout-contrib', 'usr_sam', 'dronehunter', 'usr_nate',
                  'v1.0.0', 1, 2000, 'usd', '{}', 'fulfilled')
      `).run();

      // Insert maker allocation
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES ('calloc_maker', 'cord_contrib', 0, 'maker', 'usr_nate', 8000, 1600)
      `).run();

      // Insert contributor allocation
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, source_repository_id, basis_points, amount_cents
        ) VALUES ('calloc_contrib', 'cord_contrib', 1, 'contributor', 'usr_sam', 'repo_contrib_test', 1000, 200)
      `).run();

      // Insert protocol_pool allocation
      await ctx.d1.prepare(`
        INSERT INTO commerce_order_allocations (
          id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
        ) VALUES ('calloc_pool', 'cord_contrib', 2, 'protocol_pool', NULL, 1000, 200)
      `).run();

      // Verify recipient_user_id NULL check for contributor fails
      await expect(
        ctx.d1.prepare(`
          INSERT INTO commerce_order_allocations (
            id, order_id, sequence, role, recipient_user_id, basis_points, amount_cents
          ) VALUES ('calloc_contrib_null', 'cord_contrib', 3, 'contributor', NULL, 1000, 200)
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);

      // Verify allocations immutability triggers still active
      await expect(
        ctx.d1.prepare('UPDATE commerce_order_allocations SET amount_cents = 300 WHERE id = ?')
          .bind('calloc_contrib').run()
      ).rejects.toThrow(/commerce order allocations are immutable/);

      await expect(
        ctx.d1.prepare('DELETE FROM commerce_order_allocations WHERE id = ?')
          .bind('calloc_contrib').run()
      ).rejects.toThrow(/commerce order allocations are immutable/);

      // 6. commerce_outbox_requires_fulfilled_allocation accepts 'contributor' allocation
      await ctx.d1.prepare(`
        INSERT INTO commerce_transfer_outbox (
          id, order_id, allocation_id, destination_user_id, amount_cents, currency
        ) VALUES ('cout_contrib', 'cord_contrib', 'calloc_contrib', 'usr_sam', 200, 'usd')
      `).run();

      const outbox = await ctx.d1.prepare('SELECT id, destination_user_id, amount_cents FROM commerce_transfer_outbox WHERE id = ?')
        .bind('cout_contrib').first<any>();
      expect(outbox?.id).toBe('cout_contrib');
      expect(outbox?.destination_user_id).toBe('usr_sam');
      expect(outbox?.amount_cents).toBe(200);

      // 7. commerce_recovery_matches_order_allocation accepts 'contributor' allocation
      await ctx.d1.prepare(`
        INSERT INTO stripe_event_inbox (event_id, event_type, livemode, payload_json, payload_sha256)
        VALUES ('evt_refund_contrib', 'charge.refund.updated', 0, '{}', ?)
      `).bind('b'.repeat(64)).run();

      await ctx.d1.prepare(`
        INSERT INTO commerce_recovery_obligations (
          id, order_id, source_kind, source_id, allocation_id, original_outbox_id,
          source_event_id, amount_cents, currency, status
        ) VALUES (
          'cro_contrib', 'cord_contrib', 'refund', 're_123', 'calloc_contrib', 'cout_contrib',
          'evt_refund_contrib', 200, 'usd', 'pending'
        )
      `).run();

      const obligation = await ctx.d1.prepare('SELECT id, allocation_id, amount_cents FROM commerce_recovery_obligations WHERE id = ?')
        .bind('cro_contrib').first<any>();
      expect(obligation?.id).toBe('cro_contrib');
      expect(obligation?.allocation_id).toBe('calloc_contrib');
      expect(obligation?.amount_cents).toBe(200);

      expect(ctx.runForeignKeyCheck()).toEqual([]);
    });
  });
});


