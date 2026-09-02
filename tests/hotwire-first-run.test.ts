import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as dropsApi from '../functions/api/drops';
import * as upvoteApi from '../functions/api/upvote';
import * as shelfApi from '../functions/api/shelf';
import * as readinessApi from '../functions/api/product-readiness';
import { hashSessionToken } from '../functions/api/_session';
import {
  getCurrentBatchWindow,
  getTimeToNextDrop,
  isBatchRollover,
  rankDrops
} from '../src/lib/hotwireBackend';
import { validateDropSubmission } from '../src/lib/hotwireDomain';

describe('HOTWIRE Guest First Run, Catalog Purity & Truthful Invariants', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. LIVE CATALOG VS DEMO DATA DISTINCTION & NO SEED MERGING
  // ==========================================================================
  describe('1. Live Catalog Rows Distinct from Demo Data & Authoritative Purity', () => {
    // (The former "seed demo apps have isDemo=true" test was removed with the fabricated
    // INITIAL_APPS fixture — the catalog is now sourced exclusively from D1. The live
    // authoritative-purity tests below are the real coverage.)
    it('should return authoritative live D1 drops without injecting fake seed apps', async () => {
      const req = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.drops)).toBe(true);

      // Verify that drops from D1 have creator, version, moddabilityScore, etc.
      const dropIds = data.drops.map((d: any) => d.id);
      expect(dropIds).toContain('dronehunter');
      expect(dropIds).toContain('certified-mailer');
      expect(dropIds).toContain('american-gardener');

      // Verify none of the items carry fabricated unpersisted demo tags
      data.drops.forEach((d: any) => {
        expect(d.name).toBeTruthy();
        expect(d.version).toBeTruthy();
        expect(d.creator).toBeTruthy();
      });
    });

    it('should never merge unpersisted seed apps into an authoritative response with new items', async () => {
      // Clear seeded apps from D1 to simulate a freshly purged D1 with only 1 custom app
      await ctx.d1.prepare('DELETE FROM commerce_products').run();
      await ctx.d1.prepare('DELETE FROM app_listings').run();
      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
        VALUES ('solitaire-95', 'Solitaire 95', 'Classic Card Game', 'Klondike Solitaire', 'usr_nate', 'v1.0.0', 'MIT', '$5', '/data/solitaire.sqlite', '["Card", "Retro"]', '[]', '{}')
      `).run();

      const req = new Request('http://localhost/api/drops?sort=newest', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.drops).toHaveLength(1);
      expect(data.drops[0].id).toBe('solitaire-95');

      // Seed apps (e.g. certified-mailer) MUST NOT be present in authoritative output
      const ids = data.drops.map((d: any) => d.id);
      expect(ids).not.toContain('certified-mailer');
    });

    it('should return empty list when live D1 has zero drops, preserving empty authoritative state', async () => {
      await ctx.d1.prepare('DELETE FROM commerce_products').run();
      await ctx.d1.prepare('DELETE FROM app_listings').run();

      const req = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.drops).toEqual([]);
    });
  });

  // ==========================================================================
  // 2. Shelf Ownership Purity for Guest First Run
  // ==========================================================================
  describe('2. Shelf Ownership Purity for Guest First Run', () => {
    it('should return empty shelf for user without shelf purchases in D1', async () => {
      // Create fresh user in D1 with session
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_guest_demo', 'guest_demo', 'Guest User', 'user')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_guest_demo', ?)
      `).bind(await hashSessionToken('tok_guest_demo'), Date.now() + 100000).run();

      const guestReq = new Request('http://localhost/api/shelf', {
        method: 'GET',
        headers: { Authorization: 'Bearer tok_guest_demo' }
      });
      const guestRes = await shelfApi.onRequestGet({ request: guestReq, env: { DB: ctx.d1 } });
      const guestData = await guestRes.json();
      expect(guestData.success).toBe(true);
      expect(guestData.shelf).toEqual([]);
    });

    it('should never grant automatic seed shelf ownership to new users', async () => {
      // Create fresh user alice with session
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_alice_new', 'alice_new', 'Alice', 'user')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_alice_new', ?)
      `).bind(await hashSessionToken('tok_alice_new'), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/shelf', {
        method: 'GET',
        headers: { Authorization: 'Bearer tok_alice_new' }
      });
      const res = await shelfApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.shelf).toEqual([]);
      // Ensure seed apps are not owned
      const ownedIds = data.shelf.map((s: any) => s.appId);
      expect(ownedIds).not.toContain('dronehunter');
      expect(ownedIds).not.toContain('certified-mailer');
    });

    it('should reject direct minting and return canonical commerce licenses for authenticated user', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_bob_buyer', 'bob_buyer', 'Bob Buyer', 'user')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_bob_buyer', ?)
      `).bind(await hashSessionToken('tok_bob_123'), Date.now() + 100000).run();

      // Direct POST minting is disabled
      const postReq = new Request('http://localhost/api/shelf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer tok_bob_123'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });
      const postRes = await shelfApi.onRequestPost({ request: postReq, env: { DB: ctx.d1 } });
      expect(postRes.status).toBe(405);

      // Seed a fulfilled order and its authoritative commerce license.
      await ctx.d1.prepare(`
        INSERT INTO commerce_orders (
          id, idempotency_key, buyer_user_id, app_id, seller_user_id,
          app_version, price_version, gross_cents, currency, lineage_snapshot_json, status
        ) VALUES (
          'order_bob_1', 'idem_bob_1', 'usr_bob_buyer', 'dronehunter', 'usr_nate',
          'v1.0.0', 1, 1500, 'usd', '[]', 'fulfilled'
        )
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO commerce_licenses
          (id, order_id, app_id, owner_user_id, license_key_hash, license_key_last4, status)
        VALUES
          ('license_bob_1', 'order_bob_1', 'dronehunter', 'usr_bob_buyer',
           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '44A1', 'active')
      `).run();

      // Verify Bob now owns only dronehunter with safe masked key
      const getReq = new Request('http://localhost/api/shelf', {
        method: 'GET',
        headers: { Authorization: 'Bearer tok_bob_123' }
      });
      const getRes = await shelfApi.onRequestGet({ request: getReq, env: { DB: ctx.d1 } });
      const getData = await getRes.json();
      expect(getData.shelf).toHaveLength(1);
      expect(getData.shelf[0].appId).toBe('dronehunter');
      expect(getData.shelf[0].licenseKeyLast4).toBe('44A1');
      expect(getData.shelf[0].maskedKey).toBe('NSW-DR-••••-44A1');
    });
  });

  // ==========================================================================
  // 3. OPTIMISTIC UPVOTE ROLLBACK & ERROR EXPLANATION
  // ==========================================================================
  describe('3. Optimistic Upvote Rollback & Truthful Error Semantics', () => {
    it('requires a real authenticated account and ignores caller-invented voter identity', async () => {
      const response = await upvoteApi.onRequestPost({
        request: new Request('http://localhost/api/upvote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: 'wallart', voterKey: 'invented-voter' })
        }),
        env: { DB: ctx.d1 }
      });
      expect(response.status).toBe(401);
    });

    it('should return 404 and fail upvote when app does not exist in D1', async () => {
      const req = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify({ appId: 'non_existent_app' })
      });

      const res = await upvoteApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('App listing not found');
    });

    it('should successfully increment upvotes for existing D1 drops', async () => {
      const initial = await ctx.d1.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind('wallart').first();
      const initialCount = (initial as any).upvotes;

      const req = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test_token_nate'
        },
        body: JSON.stringify({ appId: 'wallart', voterKey: 'ignored-caller-value' })
      });

      const res = await upvoteApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.upvotes).toBe(initialCount + 1);

      // Verify in DB
      const updated = await ctx.d1.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind('wallart').first();
      expect((updated as any).upvotes).toBe(initialCount + 1);
    });

    it('should handle repeat upvotes idempotently without runaway count inflation', async () => {
      const req1 = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify({ appId: 'certified-mailer', voterKey: 'first-invented-value' })
      });
      const res1 = await upvoteApi.onRequestPost({ request: req1, env: { DB: ctx.d1 } });
      const data1 = await res1.json();
      const firstCount = data1.upvotes;

      // Duplicate vote
      const req2 = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify({ appId: 'certified-mailer', voterKey: 'different-invented-value' })
      });
      const res2 = await upvoteApi.onRequestPost({ request: req2, env: { DB: ctx.d1 } });
      const data2 = await res2.json();

      expect(data2.success).toBe(true);
      expect(data2.alreadyVoted).toBe(true);
      expect(data2.upvotes).toBe(firstCount);
    });

    it('should handle concurrent upvote attempts safely without double incrementing', async () => {
      const initial = await ctx.d1.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind('dronehunter').first();
      const initialCount = (initial as any).upvotes;

      // Two concurrent requests with identical voter key
      const createReq = () => new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const [res1, res2] = await Promise.all([
        upvoteApi.onRequestPost({ request: createReq(), env: { DB: ctx.d1 } }),
        upvoteApi.onRequestPost({ request: createReq(), env: { DB: ctx.d1 } })
      ]);

      const data1 = await res1.json();
      const data2 = await res2.json();

      expect(data1.success).toBe(true);
      expect(data2.success).toBe(true);

      // Exactly one request was a new vote, the other was alreadyVoted
      const alreadyVotedFlags = [data1.alreadyVoted, data2.alreadyVoted];
      expect(alreadyVotedFlags).toContain(false);
      expect(alreadyVotedFlags).toContain(true);

      // Verify DB count only incremented by 1
      const finalApp = await ctx.d1.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind('dronehunter').first();
      expect((finalApp as any).upvotes).toBe(initialCount + 1);
    });
  });

  // ==========================================================================
  // 4. DROP SUBMISSION VALIDATION & PERSISTENCE FAILURE INTEGRITY
  // ==========================================================================
  describe('4. Drop Submission Validation & Persistence Failure Contracts', () => {
    it('should reject invalid drop submissions with validation errors (e.g. short name or bad semver)', () => {
      const invalidName = validateDropSubmission({ name: 'ab', version: 'v1.0.0' });
      expect(invalidName.valid).toBe(false);
      expect(invalidName.errors[0]).toContain('at least 3 characters');

      const invalidVersion = validateDropSubmission({ name: 'Valid App', version: 'not-semver' });
      expect(invalidVersion.valid).toBe(false);
      expect(invalidVersion.errors[0]).toContain('valid semver');

      const validSubmission = validateDropSubmission({ name: 'Valid App', version: 'v1.2.0' });
      expect(validSubmission.valid).toBe(true);
      expect(validSubmission.errors).toHaveLength(0);
    });

    it('should return 400 when submitting invalid drop payload to /api/drops', async () => {
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({ name: '', version: 'bad' })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('should persist valid drop publication into D1 and return batch window metadata', async () => {
      const dropId = 'retro-paint-95';
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: dropId,
          name: 'Retro Paint 95',
          tagline: 'Pixel Art Editor with Canvas & Web Audio',
          description: 'Single-file local art studio.',
          version: 'v1.0.0',
          price: '$19.00',
          tags: ['Art', 'Canvas', 'Retro', 'Shareware']
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.id).toBe(dropId);
      expect(data.batchWindow).toBeDefined();
      expect(data.batchWindow.batchId).toMatch(/^drop-\d{4}-\d{2}-\d{2}$/);

      // Verify row persisted in D1
      const appInDb = await ctx.d1.prepare('SELECT * FROM app_listings WHERE id = ?').bind(dropId).first();
      expect(appInDb).not.toBeNull();
      expect((appInDb as any).name).toBe('Retro Paint 95');
      expect((appInDb as any).version).toBe('v1.0.0');

      // SECURITY (Codex #5): hostname is the router's authoritative host-match
      // column. It must be persisted at creation time, not left NULL relying
      // on the router's `OR id = ?` fallback.
      expect((appInDb as any).hostname).toBe(dropId);
    });

    // SECURITY (Codex #5): RESERVED_APP_IDS must be enforced at the DB/creation
    // BOUNDARY (the drops.ts POST handler itself), not only inside the pure
    // validateDropSubmission() function tested above. This proves the actual
    // HTTP endpoint refuses to write a reserved id/hostname to app_listings —
    // the id becomes <id>.nates-software.com, so a maker registering a
    // reserved word could otherwise impersonate the first-party app shell
    // (e.g. inbox/chat/admin.nates-software.com).
    it('should reject a reserved app id at the /api/drops POST endpoint with 400 and write nothing to app_listings', async () => {
      for (const reservedId of ['inbox', 'chat', 'admin', 'ADMIN', 'Api']) {
        const req = new Request('http://localhost/api/drops', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
          body: JSON.stringify({
            id: reservedId,
            name: 'Impersonation Attempt',
            version: 'v1.0.0',
            price: '$15.00'
          })
        });

        const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error).toContain('reserved');

        const row = await ctx.d1.prepare('SELECT id FROM app_listings WHERE lower(id) = ?').bind(reservedId.toLowerCase()).first();
        expect(row).toBeNull();
      }
    });

    // Migration 0035: the reserved-name rule is also a DB-level invariant, so
    // it holds even for a write path that bypasses drops.ts entirely (a
    // future admin tool, a raced/alternate insert, or a bulk import) — the
    // trigger, not application code, is the final backstop.
    it('should have the DB trigger (migration 0035) reject a reserved id/hostname on a raw INSERT that bypasses the app layer entirely', async () => {
      await expect(
        ctx.d1.prepare(`
          INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, hostname)
          VALUES ('inbox', 'Fake Inbox', 'x', 'x', 'usr_nate', 'v1.0.0', 'MIT', '$1.00', 'x', '[]', '[]', '{}', 'inbox')
        `).run()
      ).rejects.toThrow();

      const row = await ctx.d1.prepare("SELECT id FROM app_listings WHERE id = 'inbox'").first();
      expect(row).toBeNull();
    });

    it('POST /api/drops always persists a non-reserved hostname equal to the drop id, never relying on a NULL-hostname router fallback', async () => {
      // Documents the actual non-null invariant for hostname: it is not a
      // trigger-level NOT NULL guard (see migration 0035's header for why —
      // SQLite BEFORE INSERT triggers on a real table can't assign computed
      // defaults into NEW), it's enforced at the write boundary in
      // functions/api/drops.ts, which always binds hostname = dropId.
      const dropId = 'hostname-invariant-app';
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({ id: dropId, name: 'Hostname Invariant App', version: 'v1.0.0', price: '$5.00' })
      });
      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);

      const row = await ctx.d1.prepare('SELECT hostname FROM app_listings WHERE id = ?').bind(dropId).first();
      expect((row as any).hostname).toBe(dropId);
    });
  });

  // ==========================================================================
  // 5. 12:01 AM UTC DAILY DROP PROTOCOL INTEGRITY
  // ==========================================================================
  describe('5. 12:01 AM UTC Daily Drop Protocol & Batch Identity', () => {
    it('should compute correct batch window spanning 00:01:00 UTC to 00:01:00 UTC next day', () => {
      const testDate = new Date('2026-08-29T10:30:00.000Z');
      const batch = getCurrentBatchWindow(testDate);

      expect(batch.batchId).toBe('drop-2026-08-29');
      expect(batch.windowStart.toISOString()).toBe('2026-08-29T00:01:00.000Z');
      expect(batch.windowEnd.toISOString()).toBe('2026-08-30T00:01:00.000Z');
      expect(batch.isCurrent).toBe(true);
    });

    it('should compute exact countdown string to next 12:01 AM UTC cutoff', () => {
      // 1 hour before 00:01:00 UTC cutoff
      const testTime = new Date('2026-08-29T23:01:00.000Z');
      const countdown = getTimeToNextDrop(testTime);

      expect(countdown.hours).toBe(1);
      expect(countdown.minutes).toBe(0);
      expect(countdown.seconds).toBe(0);
      expect(countdown.countdown).toBe('01h 00m 00s');
    });

    it('should detect batch rollover when crossing the 12:01 AM UTC boundary', () => {
      const beforeMidnight = new Date('2026-08-29T00:00:50.000Z');
      const afterRollover = new Date('2026-08-29T00:01:10.000Z');

      expect(isBatchRollover(beforeMidnight, afterRollover)).toBe(true);
    });

    it('should rank drops deterministically using Hotwire composite scoring', () => {
      const now = new Date('2026-08-29T12:00:00.000Z');
      const drops = [
        { id: 'low-app', name: 'Low', upvotes: 5, forks: 0, createdAt: now },
        { id: 'high-app', name: 'High', upvotes: 250, forks: 45, creatorStreak: 14, createdAt: now },
        { id: 'mid-app', name: 'Mid', upvotes: 80, forks: 12, creatorStreak: 3, createdAt: now }
      ];

      const ranked = rankDrops(drops, { now });
      expect(ranked[0].id).toBe('high-app');
      expect(ranked[0].rankingMetrics.rank).toBe(1);
      expect(ranked[1].id).toBe('mid-app');
      expect(ranked[1].rankingMetrics.rank).toBe(2);
      expect(ranked[2].id).toBe('low-app');
      expect(ranked[2].rankingMetrics.rank).toBe(3);
    });
  });

  // ==========================================================================
  // 6. BATCH WINDOW FILTERING & DISCOVERY INTEGRITY
  // ==========================================================================
  describe('6. Batch Window Filtering & Multi-Batch Discovery', () => {
    it('should filter drops by specific batch window (today, yesterday, archive)', async () => {
      await ctx.d1.prepare('DELETE FROM commerce_products').run();
      await ctx.d1.prepare('DELETE FROM app_listings').run();

      const now = new Date();
      const currentBatch = getCurrentBatchWindow(now);
      const yesterdayStart = new Date(currentBatch.windowStart.getTime() - (20 * 60 * 60 * 1000)).toISOString();
      const olderArchived = new Date(currentBatch.windowStart.getTime() - (72 * 60 * 60 * 1000)).toISOString();
      const todayDrop = new Date(currentBatch.windowStart.getTime() + (2 * 60 * 60 * 1000)).toISOString();

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, created_at)
        VALUES 
        ('today-app', 'Today App', 'Built today', 'Desc', 'usr_nate', 'v1.0.0', 'MIT', '$15', '/data/app.sqlite', '["Art"]', '[]', '{}', ?),
        ('yesterday-app', 'Yesterday App', 'Built yesterday', 'Desc', 'usr_nate', 'v1.0.0', 'MIT', '$15', '/data/app.sqlite', '["Art"]', '[]', '{}', ?),
        ('archive-app', 'Archive App', 'Built long ago', 'Desc', 'usr_nate', 'v1.0.0', 'MIT', '$15', '/data/app.sqlite', '["Art"]', '[]', '{}', ?)
      `).bind(todayDrop, yesterdayStart, olderArchived).run();

      // Query today batch
      const reqToday = new Request('http://localhost/api/drops?batch=today', { method: 'GET' });
      const resToday = await dropsApi.onRequestGet({ request: reqToday, env: { DB: ctx.d1 } });
      const dataToday = await resToday.json();
      expect(dataToday.success).toBe(true);
      expect(dataToday.drops).toHaveLength(1);
      expect(dataToday.drops[0].id).toBe('today-app');

      // Query yesterday batch
      const reqYesterday = new Request('http://localhost/api/drops?batch=yesterday', { method: 'GET' });
      const resYesterday = await dropsApi.onRequestGet({ request: reqYesterday, env: { DB: ctx.d1 } });
      const dataYesterday = await resYesterday.json();
      expect(dataYesterday.success).toBe(true);
      expect(dataYesterday.drops).toHaveLength(1);
      expect(dataYesterday.drops[0].id).toBe('yesterday-app');

      // Query archive
      const reqArchive = new Request('http://localhost/api/drops?batch=archive', { method: 'GET' });
      const resArchive = await dropsApi.onRequestGet({ request: reqArchive, env: { DB: ctx.d1 } });
      const dataArchive = await resArchive.json();
      expect(dataArchive.success).toBe(true);
      expect(dataArchive.drops.map((d: any) => d.id)).toContain('archive-app');
      expect(dataArchive.drops.map((d: any) => d.id)).toContain('yesterday-app');
      expect(dataArchive.drops.map((d: any) => d.id)).not.toContain('today-app');
    });

    it('should include SQLite CURRENT_TIMESTAMP rows in the active daily batch', async () => {
      const currentBatch = getCurrentBatchWindow(new Date());
      // During the one-minute interval before rollover, CURRENT_TIMESTAMP still
      // belongs to the prior batch, so explicitly use SQLite's canonical text
      // format for an instant safely inside the computed active window.
      const insideBatch = new Date(currentBatch.windowStart.getTime() + 60_000)
        .toISOString()
        .replace('T', ' ')
        .replace('.000Z', '');
      await ctx.d1.prepare(`
        INSERT INTO app_listings
          (id, name, tagline, description, creator_id, version, created_at)
        VALUES ('sqlite-date-drop', 'SQLite Date Drop', 'Current batch', 'Date format proof', 'usr_nate', 'v1.0.0', ?)
      `).bind(insideBatch).run();

      const req = new Request('http://localhost/api/drops?batch=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(data.drops.map((drop: any) => drop.id)).toContain('sqlite-date-drop');
    });

    it('should return empty list when querying a batch window with no drops', async () => {
      const reqYesterday = new Request('http://localhost/api/drops?batch=yesterday', { method: 'GET' });
      const resYesterday = await dropsApi.onRequestGet({ request: reqYesterday, env: { DB: ctx.d1 } });
      const dataYesterday = await resYesterday.json();
      expect(dataYesterday.success).toBe(true);
      expect(dataYesterday.batch).toBe('yesterday');
    });
  });

  // ==========================================================================
  // 7. LIVE MAKER STREAKS LEADERBOARD
  // ==========================================================================
  describe('7. Live Maker Streaks Leaderboard from D1 Drops History', () => {
    it('should calculate live maker leaderboard with streaks and badge tiers', async () => {
      const req = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(Array.isArray(data.makerLeaderboard)).toBe(true);
      expect(data.makerLeaderboard.length).toBeGreaterThan(0);

      const nateMaker = data.makerLeaderboard.find((m: any) => m.username === 'nate');
      expect(nateMaker).toBeDefined();
      expect(nateMaker.displayName).toBe('Nate McGuire');
      expect(nateMaker.currentStreak).toBeGreaterThanOrEqual(1);
      expect(nateMaker.badgeInfo).toBeDefined();
      expect(nateMaker.badgeInfo.tier).toBeDefined();
      expect(nateMaker.totalDrops).toBeGreaterThanOrEqual(3);
    });
  });

  // ==========================================================================
  // 8. DROP PUBLISHING COMMERCE SYNCHRONIZATION & AUTH HARDENING
  // ==========================================================================
  describe('8. Drop Publishing Commerce Synchronization, Auth & Security Hardening', () => {
    it('should synchronize newly published drop into commerce_products AND honestly provision a real repository (Fix 1: never fake "active")', async () => {
      const newDropId = 'retro-synth-95';
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: newDropId,
          name: 'Retro Synth 95',
          tagline: '8-Bit Chiptune Synthesizer',
          description: 'Local audio workstation.',
          version: 'v1.0.0',
          price: '$20.00',
          liveUrl: 'https://synth.nates-software.com',
          tags: ['Audio', 'Synth', 'Music']
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      // Honest response contract: caller can see the real resulting state
      // without a second round-trip.
      expect(data.productStatus).toBe('draft');
      expect(data.repositoryProvisioned).toBe(true);
      expect(typeof data.repositoryId).toBe('string');

      // Verify listing row has liveUrl preserved in binaries.web
      const listing = await ctx.d1.prepare('SELECT binaries, price, repository_id FROM app_listings WHERE id = ?').bind(newDropId).first();
      expect(listing).not.toBeNull();
      const binaries = JSON.parse((listing as any).binaries);
      expect(binaries.web).toBe('https://synth.nates-software.com');
      expect((listing as any).price).toBe('$20.00');
      expect((listing as any).repository_id).toBe(data.repositoryId);

      // Fix 1 (HOTWIRE #6): commerce_products must be synchronized, but its
      // status must HONESTLY reflect readiness — this drop has no deployable
      // commit yet, so it is 'draft', never a fake 'active'.
      const product = await ctx.d1.prepare('SELECT price_cents, status, seller_user_id, repository_id FROM commerce_products WHERE app_id = ?').bind(newDropId).first();
      expect(product).not.toBeNull();
      expect((product as any).price_cents).toBe(2000);
      expect((product as any).status).toBe('draft');
      expect((product as any).seller_user_id).toBe('usr_nate');
      expect((product as any).repository_id).toBe(data.repositoryId);

      // Fix 1: a real repositories row was provisioned transactionally,
      // server-owned by the authenticated session — never a fake/absent link.
      const repo = await ctx.d1.prepare('SELECT id, app_id, owner_user_id, status FROM repositories WHERE id = ?').bind(data.repositoryId).first();
      expect(repo).not.toBeNull();
      expect((repo as any).app_id).toBe(newDropId);
      expect((repo as any).owner_user_id).toBe('usr_nate');
      // No git objects/commits exist yet for a freshly-provisioned repo, so
      // 'provisioning' (not 'active') is the honest status.
      expect((repo as any).status).toBe('provisioning');
    });

    it('coordinates with GET /api/product-readiness: a freshly-published drop reads back as honestly "draft", never "buyable"', async () => {
      const dropId = 'readiness-coordination-drop';
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: dropId,
          name: 'Readiness Coordination Drop',
          version: 'v1.0.0',
          price: '$12.00'
        })
      });
      const postRes = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData.productStatus).toBe('draft');

      const readinessReq = new Request(`http://localhost/api/product-readiness?appId=${dropId}`, { method: 'GET' });
      const readinessRes = await readinessApi.onRequestGet({ request: readinessReq, env: { DB: ctx.d1 } });
      expect(readinessRes.status).toBe(200);
      const readinessData = await readinessRes.json();

      expect(readinessData.success).toBe(true);
      expect(readinessData.readiness.product.exists).toBe(true);
      expect(readinessData.readiness.product.active).toBe(false);
      expect(readinessData.readiness.repository.exists).toBe(true);
      // A freshly-provisioned repo has no commit -> not 'active' -> not forkable either.
      expect(readinessData.readiness.repository.active).toBe(false);
      expect(readinessData.readiness.overall).toBe('draft');
    });

    it('should reject unauthenticated drop publishing with 401 Unauthorized', async () => {
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Unauth Synth',
          version: 'v1.0.0',
          price: '$15.00'
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Unauthorized');
    });

    it('should reject cross-origin cookie-authenticated drop submissions with 403 Forbidden', async () => {
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken('cookie_csrf_token'), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': 'nsw_session=cookie_csrf_token',
          'Origin': 'https://malicious-site.com'
        },
        body: JSON.stringify({
          name: 'CSRF Drop',
          version: 'v1.0.0'
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Forbidden');
    });

    it('should derive creator strictly from authenticated session and prevent creator spoofing', async () => {
      // Create session for user sam (usr_sam)
      const samToken = 'tok_sam_spoof_test';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_sam', ?)
      `).bind(await hashSessionToken(samToken), Date.now() + 100000).run();

      const dropId = 'sam-secret-tool';
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${samToken}`
        },
        body: JSON.stringify({
          id: dropId,
          name: 'Sam Secret Tool',
          tagline: 'Spoofing attempt',
          description: 'Testing creator identity binding.',
          creator: 'nate', // Attacker attempts to spoof nate
          version: 'v1.0.0',
          price: '$30.00'
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify creator_id is bound strictly to authenticated usr_sam
      const listing = await ctx.d1.prepare('SELECT creator_id FROM app_listings WHERE id = ?').bind(dropId).first();
      expect((listing as any).creator_id).toBe('usr_sam');

      // Verify commerce_products seller_user_id is bound to usr_sam
      const product = await ctx.d1.prepare('SELECT seller_user_id, price_cents FROM commerce_products WHERE app_id = ?').bind(dropId).first();
      expect((product as any).seller_user_id).toBe('usr_sam');
      expect((product as any).price_cents).toBe(3000);

      // Verify no fake user was created
      const fakeUser = await ctx.d1.prepare('SELECT * FROM users WHERE username = ?').bind('fake_maker_spoofed').first();
      expect(fakeUser).toBeNull();
    });

    it('should prevent one maker from overwriting another maker existing listing ID', async () => {
      // dronehunter is owned by usr_nate
      const samToken = 'tok_sam_collision';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_sam', ?)
      `).bind(await hashSessionToken(samToken), Date.now() + 100000).run();

      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${samToken}`
        },
        body: JSON.stringify({
          id: 'dronehunter', // Existing app owned by usr_nate
          name: 'DroneHunter Hijack',
          tagline: 'Attempting to hijack existing listing',
          description: 'Should be rejected with 403',
          version: 'v9.9.9',
          price: '$50.00'
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('owned by another maker');

      // Verify original listing was untouched
      const original = await ctx.d1.prepare('SELECT name, creator_id FROM app_listings WHERE id = ?').bind('dronehunter').first();
      expect((original as any).name).toBe('DroneHunter 95');
      expect((original as any).creator_id).toBe('usr_nate');
    });

    it('should keep listing ownership and commerce seller aligned if ownership changes after the preflight check', async () => {
      const samToken = 'tok_sam_race';
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_sam', ?)
      `).bind(await hashSessionToken(samToken), Date.now() + 100000).run();

      // Simulate the race window: the preflight observes no owner, while the
      // atomic conditional statements execute against the already-claimed ID.
      const raceDb = {
        ...ctx.d1,
        prepare: (query: string) => {
          const statement = ctx.d1.prepare(query);
          if (/SELECT id, creator_id FROM app_listings WHERE id/.test(query)) {
            return { ...statement, bind: () => ({ ...statement, first: async () => null }) };
          }
          return statement;
        },
        batch: ctx.d1.batch.bind(ctx.d1)
      };

      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${samToken}` },
        body: JSON.stringify({
          id: 'dronehunter',
          name: 'Racing Hijack',
          version: 'v9.9.9',
          price: '$99.00'
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: raceDb } });
      expect(res.status).toBe(409);

      const listing = await ctx.d1.prepare('SELECT creator_id, name FROM app_listings WHERE id = ?').bind('dronehunter').first();
      const product = await ctx.d1.prepare('SELECT seller_user_id, price_cents FROM commerce_products WHERE app_id = ?').bind('dronehunter').first();
      expect((listing as any).creator_id).toBe('usr_nate');
      expect((listing as any).name).toBe('DroneHunter 95');
      expect((product as any).seller_user_id).toBe('usr_nate');
      expect((product as any).price_cents).toBe(1500);

      // Fix 1 regression guard: the race loser (usr_sam) must NOT end up with
      // an orphaned repository row. The repository INSERT is guarded by
      // "WHERE EXISTS (listing owned by creatorId)" specifically so that a
      // lost ownership race can't silently commit a repo owned by the loser
      // inside the same D1 batch/transaction (D1 only rolls back on a thrown
      // statement error, not on a 0-row conditional write).
      const orphanedRepos = await ctx.d1.prepare(
        `SELECT id FROM repositories WHERE app_id = 'dronehunter' AND owner_user_id = 'usr_sam'`
      ).all();
      expect(orphanedRepos.results || []).toHaveLength(0);
    });

    it('should allow the original creator to update their own drop listing ID', async () => {
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid_test_token' // usr_nate
        },
        body: JSON.stringify({
          id: 'dronehunter',
          name: 'DroneHunter 95 Pro Updated',
          tagline: 'Updated tagline by creator',
          description: 'Updated description.',
          version: 'v2.0.0',
          price: '$25.00'
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const updated = await ctx.d1.prepare('SELECT name, version, price FROM app_listings WHERE id = ?').bind('dronehunter').first();
      expect((updated as any).name).toBe('DroneHunter 95 Pro Updated');
      expect((updated as any).version).toBe('v2.0.0');
      expect((updated as any).price).toBe('$25.00');

      const updatedProduct = await ctx.d1.prepare('SELECT price_cents FROM commerce_products WHERE app_id = ?').bind('dronehunter').first();
      expect((updatedProduct as any).price_cents).toBe(2500);
    });

    it('should reject invalid drop ID and price formats with 400', async () => {
      // Invalid ID
      const reqBadId = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: 'bad id with spaces & symbols!',
          name: 'Bad ID App',
          version: 'v1.0.0'
        })
      });
      const resBadId = await dropsApi.onRequestPost({ request: reqBadId, env: { DB: ctx.d1 } });
      expect(resBadId.status).toBe(400);

      // Invalid Price
      const reqBadPrice = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: 'valid-id',
          name: 'Valid App',
          version: 'v1.0.0',
          price: 'not_a_valid_price'
        })
      });
      const resBadPrice = await dropsApi.onRequestPost({ request: reqBadPrice, env: { DB: ctx.d1 } });
      expect(resBadPrice.status).toBe(400);
    });

    it('should atomically roll back listing and never report success if commerce synchronization fails', async () => {
      // Mock D1 batch failure
      const originalBatch = ctx.d1.batch.bind(ctx.d1);
      ctx.d1.batch = vi.fn().mockRejectedValue(new Error('Commerce synchronization transaction failed'));

      const failDropId = 'atomic-fail-drop';
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: failDropId,
          name: 'Atomic Fail Drop',
          version: 'v1.0.0',
          price: '$15.00'
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to process drop submission');

      ctx.d1.batch = originalBatch;
    });

    it('should cascade delete drop_upvotes when an app listing is deleted', async () => {
      const cascadeAppId = 'cascade-vote-drop';
      // Insert test drop
      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version)
        VALUES (?, 'Cascade Vote Drop', 'Tagline', 'Desc', 'usr_nate', 'v1.0.0')
      `).bind(cascadeAppId).run();

      // Cast an upvote for cascade-vote-drop
      const voteReq = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify({ appId: cascadeAppId })
      });
      const voteRes = await upvoteApi.onRequestPost({ request: voteReq, env: { DB: ctx.d1 } });
      const voteData = await voteRes.json();
      expect(voteData.success).toBe(true);

      // Verify upvote exists in drop_upvotes
      const votesBefore = await ctx.d1.prepare('SELECT count(*) AS c FROM drop_upvotes WHERE app_id = ?').bind(cascadeAppId).first('c');
      expect(Number(votesBefore)).toBe(1);

      // Delete app listing
      await ctx.d1.prepare('DELETE FROM app_listings WHERE id = ?').bind(cascadeAppId).run();

      // Verify drop_upvotes was cascaded
      const votesAfter = await ctx.d1.prepare('SELECT count(*) AS c FROM drop_upvotes WHERE app_id = ?').bind(cascadeAppId).first('c');
      expect(Number(votesAfter)).toBe(0);

      // Verify foreign keys remain clean
      expect(ctx.runForeignKeyCheck()).toEqual([]);
    });
  });
});
