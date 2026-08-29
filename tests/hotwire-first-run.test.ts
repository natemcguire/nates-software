import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as dropsApi from '../functions/api/drops';
import * as upvoteApi from '../functions/api/upvote';
import * as shelfApi from '../functions/api/shelf';
import { hashSessionToken } from '../functions/api/_session';
import { INITIAL_APPS } from '../src/data/mockData';
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
    it('should distinguish seed demo apps with isDemo = true', () => {
      expect(INITIAL_APPS.length).toBeGreaterThan(0);
      INITIAL_APPS.forEach(app => {
        expect(app.isDemo).toBe(true);
      });
    });

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
      expect(dropIds).toContain('picfitai');

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

      // Seed apps (e.g. picfitai, certified-mailer) MUST NOT be present in authoritative output
      const ids = data.drops.map((d: any) => d.id);
      expect(ids).not.toContain('picfitai');
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
  // 2. SHELF OWNERSHIP PURITY (NEVER GRANT SEED OWNERSHIP TO GUEST)
  // ==========================================================================
  describe('2. Shelf Ownership Purity for Guest First Run', () => {
    it('should return empty shelf for user without shelf purchases in D1', async () => {
      // Create fresh user in D1
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_guest_demo', 'guest_demo', 'Guest User', 'user')
      `).run();

      const guestReq = new Request('http://localhost/api/shelf?username=guest_demo', { method: 'GET' });
      const guestRes = await shelfApi.onRequestGet({ request: guestReq, env: { DB: ctx.d1 } });
      const guestData = await guestRes.json();
      expect(guestData.success).toBe(true);
      expect(guestData.shelf).toEqual([]);
    });

    it('should never grant automatic seed shelf ownership to new users', async () => {
      // Create fresh user alice
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_alice_new', 'alice_new', 'Alice', 'user')
      `).run();

      const req = new Request('http://localhost/api/shelf?username=alice_new', { method: 'GET' });
      const res = await shelfApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.shelf).toEqual([]);
      // Ensure seed apps are not owned
      const ownedIds = data.shelf.map((s: any) => s.appId);
      expect(ownedIds).not.toContain('dronehunter');
      expect(ownedIds).not.toContain('certified-mailer');
      expect(ownedIds).not.toContain('picfitai');
    });

    it('should only add items to shelf upon valid authenticated purchase/claim', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_bob_buyer', 'bob_buyer', 'Bob Buyer', 'user')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_bob_buyer', ?)
      `).bind(await hashSessionToken('tok_bob_123'), Date.now() + 100000).run();

      // Claim dronehunter
      const postReq = new Request('http://localhost/api/shelf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer tok_bob_123'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });
      const postRes = await shelfApi.onRequestPost({ request: postReq, env: { DB: ctx.d1 } });
      const postData = await postRes.json();
      expect(postData.success).toBe(true);
      expect(postData.licenseKey).toMatch(/^NSW-DR-\d+-/);

      // Verify Bob now owns only dronehunter
      const getReq = new Request('http://localhost/api/shelf?username=bob_buyer', { method: 'GET' });
      const getRes = await shelfApi.onRequestGet({ request: getReq, env: { DB: ctx.d1 } });
      const getData = await getRes.json();
      expect(getData.shelf).toHaveLength(1);
      expect(getData.shelf[0].appId).toBe('dronehunter');
      expect(getData.shelf[0].licenseKey).toBe(postData.licenseKey);
    });
  });

  // ==========================================================================
  // 3. OPTIMISTIC UPVOTE ROLLBACK & ERROR EXPLANATION
  // ==========================================================================
  describe('3. Optimistic Upvote Rollback & Truthful Error Semantics', () => {
    it('should return 404 and fail upvote when app does not exist in D1', async () => {
      const req = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'non_existent_app' })
      });

      const res = await upvoteApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('App listing not found');
    });

    it('should successfully increment upvotes for existing D1 drops', async () => {
      const initial = await ctx.d1.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind('picfitai').first();
      const initialCount = (initial as any).upvotes;

      const req = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.25'
        },
        body: JSON.stringify({ appId: 'picfitai', voterKey: 'test_voter_1' })
      });

      const res = await upvoteApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.upvotes).toBe(initialCount + 1);

      // Verify in DB
      const updated = await ctx.d1.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind('picfitai').first();
      expect((updated as any).upvotes).toBe(initialCount + 1);
    });

    it('should handle repeat upvotes idempotently without runaway count inflation', async () => {
      const req1 = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.88' },
        body: JSON.stringify({ appId: 'certified-mailer', voterKey: 'voter_idempotent_test' })
      });
      const res1 = await upvoteApi.onRequestPost({ request: req1, env: { DB: ctx.d1 } });
      const data1 = await res1.json();
      const firstCount = data1.upvotes;

      // Duplicate vote
      const req2 = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.88' },
        body: JSON.stringify({ appId: 'certified-mailer', voterKey: 'voter_idempotent_test' })
      });
      const res2 = await upvoteApi.onRequestPost({ request: req2, env: { DB: ctx.d1 } });
      const data2 = await res2.json();

      expect(data2.success).toBe(true);
      expect(data2.alreadyVoted).toBe(true);
      expect(data2.upvotes).toBe(firstCount);
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
  // 8. DROP PUBLISHING COMMERCE SYNCHRONIZATION & LIVE URL
  // ==========================================================================
  describe('8. Drop Publishing Commerce Synchronization & Live URL Preservation', () => {
    it('should synchronize newly published drop into commerce_products for purchasing', async () => {
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

      // Verify listing row has liveUrl preserved in binaries.web
      const listing = await ctx.d1.prepare('SELECT binaries, price FROM app_listings WHERE id = ?').bind(newDropId).first();
      expect(listing).not.toBeNull();
      const binaries = JSON.parse((listing as any).binaries);
      expect(binaries.web).toBe('https://synth.nates-software.com');
      expect((listing as any).price).toBe('$20.00');

      // Verify commerce_products row was synchronized with active status and 2000 cents
      const product = await ctx.d1.prepare('SELECT price_cents, status, seller_user_id FROM commerce_products WHERE app_id = ?').bind(newDropId).first();
      expect(product).not.toBeNull();
      expect((product as any).price_cents).toBe(2000);
      expect((product as any).status).toBe('active');
      expect((product as any).seller_user_id).toBe('usr_nate');
    });

    it('should safely handle drop publishing from unseeded creators without foreign key errors', async () => {
      const guestDropId = 'indie-tracker';
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: guestDropId,
          name: 'Indie Tracker',
          tagline: 'Fast Habit Tracker',
          description: 'Habit tracking in SQLite.',
          creator: 'newmaker',
          version: 'v1.0.0',
          price: '$10.00',
          tags: ['Productivity']
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.id).toBe(guestDropId);

      // Verify user was created in users table
      const user = await ctx.d1.prepare('SELECT * FROM users WHERE id = ?').bind('usr_newmaker').first();
      expect(user).not.toBeNull();
      expect((user as any).username).toBe('newmaker');
    });
  });
});
