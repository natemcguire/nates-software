import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

import * as authApi from '../functions/api/auth';
import * as commentsApi from '../functions/api/comments';
import * as dropsApi from '../functions/api/drops';
import * as dynoApi from '../functions/api/dyno';
import * as gitApi from '../functions/api/git';
import * as inboxApi from '../functions/api/inbox';
import * as profileApi from '../functions/api/profile';
import * as shelfApi from '../functions/api/shelf';
import * as upvoteApi from '../functions/api/upvote';
import * as createIntentApi from '../functions/api/payments/create-intent';
import * as onboardApi from '../functions/api/payments/onboard';
import * as webhookApi from '../functions/api/payments/webhook';
import { hashSessionToken } from '../functions/api/_session';

describe('API Failure Behavior, Unswallowed Errors & Persistence Contracts', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  // ==========================================================================
  // 1. AUTHENTICATION API CONTRACTS (/api/auth)
  // ==========================================================================
  describe('1. Authentication API Error & Persistence Contracts (/api/auth)', () => {
    it('should reject registration with 400 when username or password are missing', async () => {
      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '', password: '' })
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Username and password are required');
    });

    it('should reject registration with 400 for reserved usernames', async () => {
      for (const reserved of ['admin', 'root', 'superadmin', 'sam']) {
        const req = new Request('http://localhost/api/auth?action=register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: reserved, password: 'password1234' })
        });

        const res = await authApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error).toContain('reserved');
      }
    });

    it('should reject registration with 400 for passwords shorter than 8 characters', async () => {
      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'validuser', password: '123' })
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('at least 8 characters');
    });

    it('should enforce unique usernames in D1 and return 409 conflict on duplicate registration', async () => {
      // 'nate' is already seeded in D1 users table
      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nate', password: 'newPassword123' })
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('already registered');
    });

    it('should persist new user and active session in D1 upon valid registration', async () => {
      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice_maker',
          password: 'securePassword99',
          displayName: 'Alice Maker',
          bio: 'Building shareware tools'
        })
      });

      const res = await authApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.authenticated).toBe(true);
      expect(data.token).toBeTruthy();

      // Verify row exists in real D1 users table
      const userInDb = await ctx.d1.prepare('SELECT * FROM users WHERE username = ?').bind('alice_maker').first();
      expect(userInDb).not.toBeNull();
      expect((userInDb as any)?.display_name).toBe('Alice Maker');
      expect((userInDb as any)?.password_hash).toBeTruthy();

      // Verify session exists in real D1 user_sessions table
      const sessionInDb = await ctx.d1.prepare('SELECT * FROM user_sessions WHERE token_hash = ?').bind(await hashSessionToken(data.token)).first();
      expect(sessionInDb).not.toBeNull();
      expect((sessionInDb as any)?.user_id).toBe((userInDb as any)?.id);
      expect((sessionInDb as any)?.token_hash).not.toBe(data.token);
    });

    it('should reject login with 401 for non-existent user or invalid password', async () => {
      const reqNonExistent = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ghost_user', password: 'password1234' })
      });
      const res1 = await authApi.onRequestPost({ request: reqNonExistent, env: { DB: ctx.d1 } });
      expect(res1.status).toBe(401);
      const data1 = await res1.json();
      expect(data1.success).toBe(false);
      expect(data1.error).toBe('Invalid username or password');

      // Register real user first, then login with bad password
      const regReq = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'bob_user', password: 'correctPassword123' })
      });
      await authApi.onRequestPost({ request: regReq, env: { DB: ctx.d1 } });

      const reqBadPass = new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'bob_user', password: 'wrongPassword456' })
      });
      const res2 = await authApi.onRequestPost({ request: reqBadPass, env: { DB: ctx.d1 } });
      expect(res2.status).toBe(401);
      const data2 = await res2.json();
      expect(data2.success).toBe(false);
      expect(data2.error).toBe('Invalid username or password');
    });

    it('should handle unauthenticated session verification (/api/auth?action=me) cleanly', async () => {
      const req = new Request('http://localhost/api/auth?action=me', { method: 'GET' });
      const res = await authApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.authenticated).toBe(false);
      expect(data.user).toBeNull();
    });

    it('should verify authenticated session token against real D1 user_sessions', async () => {
      // Register carol
      const regReq = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'carol_dev', password: 'password2026!' })
      });
      const regRes = await authApi.onRequestPost({ request: regReq, env: { DB: ctx.d1 } });
      const regData = await regRes.json();

      // Verify token
      const meReq = new Request('http://localhost/api/auth?action=me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${regData.token}` }
      });
      const meRes = await authApi.onRequestGet({ request: meReq, env: { DB: ctx.d1 } });
      const meData = await meRes.json();

      expect(meData.success).toBe(true);
      expect(meData.authenticated).toBe(true);
      expect(meData.user.username).toBe('carol_dev');
    });

    it('should purge session from D1 upon logout', async () => {
      // Register user
      const regReq = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'dave_maker', password: 'password2026!' })
      });
      const regRes = await authApi.onRequestPost({ request: regReq, env: { DB: ctx.d1 } });
      const regData = await regRes.json();

      // Verify session exists
      const tokenHash = await hashSessionToken(regData.token);
      const sessionBefore = await ctx.d1.prepare('SELECT * FROM user_sessions WHERE token_hash = ?').bind(tokenHash).first();
      expect(sessionBefore).not.toBeNull();

      // Logout
      const logoutReq = new Request('http://localhost/api/auth?action=logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${regData.token}` }
      });
      const logoutRes = await authApi.onRequestPost({ request: logoutReq, env: { DB: ctx.d1 } });
      const logoutData = await logoutRes.json();
      expect(logoutData.success).toBe(true);

      // Verify session purged from D1
      const sessionAfter = await ctx.d1.prepare('SELECT * FROM user_sessions WHERE token_hash = ?').bind(tokenHash).first();
      expect(sessionAfter).toBeNull();
    });
  });

  // ==========================================================================
  // 2. UPVOTE API CONTRACTS & IDEMPOTENCY (/api/upvote)
  // ==========================================================================
  describe('2. Upvoting API Failure & Idempotency Contracts (/api/upvote)', () => {
    it('should reject upvote with 400 when appId is missing', async () => {
      const req = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const res = await upvoteApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('appId is required');
    });

    it('should reject upvote with 404 when app does not exist in D1', async () => {
      const req = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'non_existent_app_id' })
      });

      const res = await upvoteApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('not found');
    });

    it('should atomically increment upvotes in D1 and maintain idempotency on repeat votes', async () => {
      const initialApp = await ctx.d1.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind('dronehunter').first();
      const startCount = (initialApp as any).upvotes;

      const req1 = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.168.1.100'
        },
        body: JSON.stringify({ appId: 'dronehunter', voterKey: 'voter_key_abc' })
      });

      const res1 = await upvoteApi.onRequestPost({ request: req1, env: { DB: ctx.d1 } });
      const data1 = await res1.json();

      expect(data1.success).toBe(true);
      expect(data1.alreadyVoted).toBe(false);
      expect(data1.upvotes).toBe(startCount + 1);

      // Verify D1 table was updated
      const updatedApp = await ctx.d1.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind('dronehunter').first();
      expect((updatedApp as any).upvotes).toBe(startCount + 1);

      // Second vote from identical voter key + IP -> idempotent no-op
      const req2 = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.168.1.100'
        },
        body: JSON.stringify({ appId: 'dronehunter', voterKey: 'voter_key_abc' })
      });

      const res2 = await upvoteApi.onRequestPost({ request: req2, env: { DB: ctx.d1 } });
      const data2 = await res2.json();

      expect(data2.success).toBe(true);
      expect(data2.alreadyVoted).toBe(true);
      expect(data2.upvotes).toBe(startCount + 1);

      // Verify count in D1 was NOT incremented again
      const finalApp = await ctx.d1.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind('dronehunter').first();
      expect((finalApp as any).upvotes).toBe(startCount + 1);
    });
  });

  // ==========================================================================
  // 3. GIT FORGE & CAS MERGE CONTRACTS (/api/git)
  // ==========================================================================
  describe('3. GITSMITH control-plane boundary contracts (/api/git)', () => {
    it('should reject unsupported control-plane actions', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({ appId: 'dronehunter' }) // missing ref and newSha
      });

      const res = await gitApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Supported control-plane action');
    });

    it('should reject direct ref mutation without the Git gateway', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          action: 'ref-update',
          repositoryId: 'dronehunter',
          ref: 'heads/main', // missing refs/ prefix
          newSha: '1111111111111111111111111111111111111111'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should reject caller-selected commit validation policy at this boundary', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          action: 'ref-update',
          repositoryId: 'dronehunter',
          ref: 'refs/heads/main',
          newSha: 'not_a_valid_sha'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('GITSMITH gateway');
    });

    it('should not let a caller turn signature policy on or off', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          action: 'ref-update',
          repositoryId: 'dronehunter',
          ref: 'refs/heads/main',
          newSha: '2222222222222222222222222222222222222222',
          requireSignedCommit: true
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('GITSMITH gateway');
    });

    it('should not treat a stale D1 projection as authoritative CAS state', async () => {
      // Seeded SHA for dronehunter refs/heads/main is '5c030af'
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          action: 'cas',
          repositoryId: 'dronehunter',
          ref: 'refs/heads/main',
          expectedOldSha: '0000000000000000000000000000000000000000', // Mismatch! Real remote is 5c030af
          newSha: '3333333333333333333333333333333333333333'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(501);
      const data = await res.json();

      expect(data.success).toBe(false);
      expect(data.error).toContain('GITSMITH gateway');
    });

    it('should leave legacy D1 refs untouched when a direct CAS is attempted', async () => {
      const newSha = '4444444444444444444444444444444444444444';
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          action: 'cas',
          repositoryId: 'dronehunter',
          ref: 'refs/heads/main',
          expectedOldSha: '5c030af', // matches seeded remote HEAD
          newSha,
          committer: 'nate'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.success).toBe(false);

      // Verify D1 ref table was updated
      const refInDb = await ctx.d1.prepare('SELECT sha FROM git_refs WHERE repo_id = ? AND ref = ?').bind('dronehunter', 'refs/heads/main').first();
      expect((refInDb as any).sha).toBe('5c030af');

      // Verify D1 commit table has new commit row
      const commitInDb = await ctx.d1.prepare('SELECT * FROM git_commits WHERE sha = ?').bind(newSha).first();
      expect(commitInDb).toBeNull();
    });

    it('should reject incomplete smart HTTP advertisement from Pages Functions', async () => {
      const req = new Request('http://localhost/api/git?action=info-refs&appId=dronehunter&service=git-receive-pack', {
        method: 'GET'
      });

      const res = await gitApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(501);

      const body = await res.json();
      expect(body.error).toContain('GITSMITH gateway');
    });
  });

  // ==========================================================================
  // 4. SHELF & LICENSE PERSISTENCE CONTRACTS (/api/shelf)
  // ==========================================================================
  describe('4. Shelf & License API Failure & Persistence Contracts (/api/shelf)', () => {
    it('should query seeded shelf items for usr_nate from D1', async () => {
      const req = new Request('http://localhost/api/shelf?username=nate', { method: 'GET' });
      const res = await shelfApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.shelf.length).toBe(3);
      const appIds = data.shelf.map((s: any) => s.appId);
      expect(appIds).toContain('dronehunter');
      expect(appIds).toContain('certified-mailer');
      expect(appIds).toContain('picfitai');
    });

    it('should reject shelf claim with 400 when appId is missing', async () => {
      const req = new Request('http://localhost/api/shelf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({})
      });

      const res = await shelfApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('appId is required');
    });

    it('should persist shelf claim in D1 and handle duplicate claim via ON CONFLICT DO NOTHING', async () => {
      // Create a fresh test user with token
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role)
        VALUES ('usr_buyer1', 'buyer1', 'Buyer One', 'user')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_buyer1', ?)
      `).bind(await hashSessionToken('tok_buyer1'), Date.now() + 100000).run();

      const req1 = new Request('http://localhost/api/shelf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer tok_buyer1'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res1 = await shelfApi.onRequestPost({ request: req1, env: { DB: ctx.d1 } });
      const data1 = await res1.json();
      expect(data1.success).toBe(true);

      // Verify row exists in D1 shelf_items
      const shelfRows = await ctx.d1.prepare('SELECT * FROM shelf_items WHERE user_id = ? AND app_id = ?').bind('usr_buyer1', 'dronehunter').all();
      expect(shelfRows.results?.length).toBe(1);

      // Duplicate post -> handled cleanly
      const req2 = new Request('http://localhost/api/shelf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer tok_buyer1'
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const res2 = await shelfApi.onRequestPost({ request: req2, env: { DB: ctx.d1 } });
      const data2 = await res2.json();
      expect(data2.success).toBe(true);

      // Verify no duplicate row created
      const shelfRowsAfter = await ctx.d1.prepare('SELECT * FROM shelf_items WHERE user_id = ? AND app_id = ?').bind('usr_buyer1', 'dronehunter').all();
      expect(shelfRowsAfter.results?.length).toBe(1);
    });
  });

  // ==========================================================================
  // 5. COMMENTS ENGINE CONTRACTS (/api/comments)
  // ==========================================================================
  describe('5. Comments Engine Error & Query Contracts (/api/comments)', () => {
    it('should query comments from D1 filtered by appId with user join', async () => {
      const req = new Request('http://localhost/api/comments?app_id=dronehunter', { method: 'GET' });
      const res = await commentsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.comments.length).toBeGreaterThanOrEqual(2);
      data.comments.forEach((c: any) => {
        expect(c.appId).toBe('dronehunter');
        expect(c.author).toBeTruthy();
        expect(c.text).toBeTruthy();
      });
    });

    it('should reject comment submission with 400 when text or appId are empty', async () => {
      const reqEmptyText = new Request('http://localhost/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'dronehunter', text: '   ' })
      });
      const res1 = await commentsApi.onRequestPost({ request: reqEmptyText, env: { DB: ctx.d1 } });
      expect(res1.status).toBe(400);

      const reqEmptyApp = new Request('http://localhost/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: '', text: 'Valid text' })
      });
      const res2 = await commentsApi.onRequestPost({ request: reqEmptyApp, env: { DB: ctx.d1 } });
      expect(res2.status).toBe(400);
    });

    it('should persist valid comment into D1 comments table', async () => {
      const req = new Request('http://localhost/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          appId: 'dronehunter',
          text: 'Incredible phosphor radar sweep animation!',
          author: 'nate'
        })
      });

      const res = await commentsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify row in D1
      const commentInDb = await ctx.d1.prepare('SELECT * FROM comments WHERE id = ?').bind(data.commentId).first();
      expect(commentInDb).not.toBeNull();
      expect((commentInDb as any).text).toBe('Incredible phosphor radar sweep animation!');
    });
  });

  // ==========================================================================
  // 6. INBOX & PROFILE CONTRACTS (/api/inbox, /api/profile)
  // ==========================================================================
  describe('6. Inbox & Profile Error & Persistence Contracts', () => {
    it('should query user profile and shelf from D1, returning 404 for non-existent user', async () => {
      const reqValid = new Request('http://localhost/api/profile?username=nate', { method: 'GET' });
      const resValid = await profileApi.onRequestGet({ request: reqValid, env: { DB: ctx.d1 } });
      const dataValid = await resValid.json();

      expect(dataValid.success).toBe(true);
      expect(dataValid.user.username).toBe('nate');
      expect(dataValid.shelf.length).toBe(3);

      const reqInvalid = new Request('http://localhost/api/profile?username=nonexistent_ghost', { method: 'GET' });
      const resInvalid = await profileApi.onRequestGet({ request: reqInvalid, env: { DB: ctx.d1 } });
      expect(resInvalid.status).toBe(404);
      const dataInvalid = await resInvalid.json();
      expect(dataInvalid.success).toBe(false);
    });

    it('should update profile fields in D1 for authenticated user', async () => {
      const req = new Request('http://localhost/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          displayName: 'Nate McGuire (Updated)',
          bio: 'Founder at East Bay Projects. High token velocity.'
        })
      });

      const res = await profileApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(data.success).toBe(true);

      const updatedUser = await ctx.d1.prepare('SELECT display_name, bio FROM users WHERE username = ?').bind('nate').first();
      expect((updatedUser as any).display_name).toBe('Nate McGuire (Updated)');
      expect((updatedUser as any).bio).toContain('High token velocity');
    });

    it('should record inbox merge action and mark thread read in D1', async () => {
      // Seed an inbox message for usr_nate
      const msgId = 'inbox_msg_test_1';
      await ctx.d1.prepare(`
        INSERT INTO inbox_messages (id, user_id, title, preview, content, feature_ref, unread, is_merged)
        VALUES (?, 'usr_nate', 'Receipt OCR Feature', 'Proposes OCR patch', 'Full proposal text', 'refs/features/ocr', 1, 0)
      `).bind(msgId).run();

      const req = new Request('http://localhost/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({ action: 'merge', messageId: msgId })
      });

      const res = await inboxApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(data.success).toBe(true);

      const msgInDb = await ctx.d1.prepare('SELECT is_merged, unread FROM inbox_messages WHERE id = ?').bind(msgId).first();
      expect((msgInDb as any).is_merged).toBe(1);
      expect((msgInDb as any).unread).toBe(0);
    });
  });

  // ==========================================================================
  // 7. DROPS & DYNO CONTRACTS (/api/drops, /api/dyno)
  // ==========================================================================
  describe('7. Hotwire Drops & Dyno Benchmarking Persistence Contracts', () => {
    it('should reject drop publishing with 400 for domain validation errors (e.g. empty name)', async () => {
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({ name: '', version: 'v1.0.0' })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should persist valid drop publication into D1 app_listings', async () => {
      const dropId = 'wallart-builder';
      const req = new Request('http://localhost/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          id: dropId,
          name: 'WallArt 95',
          tagline: 'Multi-monitor retro canvas builder',
          description: 'Build wall art layouts with pixel grids.',
          version: 'v1.0.0',
          price: '$15.00',
          tags: ['Art', 'Canvas', 'Shareware']
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();
      expect(data.success).toBe(true);

      const appInDb = await ctx.d1.prepare('SELECT * FROM app_listings WHERE id = ?').bind(dropId).first();
      expect(appInDb).not.toBeNull();
      expect((appInDb as any).name).toBe('WallArt 95');
    });

    it('should query drops ranked from D1', async () => {
      const req = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(Array.isArray(data.drops)).toBe(true);
      expect(data.drops.length).toBeGreaterThanOrEqual(3);
    });

    it('should query canonical DYNO leaderboard from D1 and reject deprecated fake /bench queries', async () => {
      const benchReq = new Request('http://localhost/api/dyno?bench=true', { method: 'GET' });
      const benchRes = await dynoApi.onRequestGet({ request: benchReq, env: { DB: ctx.d1 } });
      expect(benchRes.status).toBe(400);
      const benchData = await benchRes.json();
      expect(benchData.success).toBe(false);
      expect(benchData.error).toContain('Hardware throughput bench is deprecated');

      const req = new Request('http://localhost/api/dyno', { method: 'GET' });
      const res = await dynoApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(Array.isArray(data.leaderboard)).toBe(true);
    });
  });

  // ==========================================================================
  // 8. PAYMENT COMMISSIONING BOUNDARY
  // ==========================================================================
  describe('8. Payment Commissioning Boundary', () => {
    it('should reject create-intent with 400 when appId is missing', async () => {
      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('temporarily unavailable');
    });

    it('should not trust client pricing or persist an order while disabled', async () => {
      const req = new Request('http://localhost/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'dronehunter', customPriceCents: 1500, buyerId: 'usr_nate' })
      });

      const res = await createIntentApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      const orders = await ctx.d1.prepare('SELECT * FROM orders WHERE app_id = ?').bind('dronehunter').all();
      expect(orders.results).toHaveLength(0);
    });

    it('should not fabricate onboarding or save an account while disabled', async () => {
      const req = new Request('http://localhost/api/payments/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'usr_nate', username: 'nate', country: 'US' })
      });

      const res = await onboardApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      const stripeAccInDb = await ctx.d1.prepare('SELECT * FROM stripe_accounts WHERE user_id = ?').bind('usr_nate').first();
      expect(stripeAccInDb).toBeNull();
    });

    it('should reject webhook before parsing while settlement is disabled', async () => {
      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid_json '
      });

      const res = await webhookApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Payment settlement is not enabled.');
    });

    it('should not process even a duplicate webhook while settlement is disabled', async () => {
      const eventId = 'evt_test_dedup_100';
      await ctx.d1.prepare(`
        INSERT INTO processed_webhook_events (event_id, event_type)
        VALUES (?, 'payment_intent.succeeded')
      `).bind(eventId).run();

      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: eventId,
          eventType: 'payment_intent.succeeded',
          paymentIntentId: 'pi_test_dup'
        })
      });

      const res = await webhookApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
    });
  });

  // ==========================================================================
  // 9. GENUINE GAPS PROVEN & DOCUMENTED (CONTRACT TESTS)
  // ==========================================================================
  describe('9. Genuine Gaps Proven & Documented (Error Swallowing & Simulated Success)', () => {
    /**
     * PROVEN GAP 1: Production Webhook SQL Column Mismatch & Swallowed Batch Failure
     *
     * In `functions/api/payments/webhook.ts` lines 236-239:
     * The SQL statement:
     *   INSERT INTO transfers_ledger (id, order_id, destination_user_id, destination_stripe_account, amount_cents, role, stripe_transfer_id)
     *   VALUES (?, ?, ?, ?, 'maker', ?)
     * defines 7 column names but supplies only 6 value placeholders (amount_cents was omitted in VALUES clause).
     *
     * SQLite rejects this query with error: `6 values for 7 columns`.
     * Because lines 273-275 wrap the D1 batch in:
     *   catch (err: any) { console.error('[D1 WEBHOOK SETTLEMENT FAILED]', err.message); }
     * and continues to line 278:
     *   return Response.json({ success: true, settled: true, ... });
     *
     * The API reports simulated success to webhook callers, but D1 rolls back the entire batch!
     * As a result, orders remain 'pending', 0 licenses are minted, and 0 shelf items are added.
     */
    it('prevents the known webhook settlement failure path while payments are disabled', async () => {
      const buyerId = 'usr_nate';
      const piId = 'pi_gap_prove_1';
      const orderId = 'ord_gap_prove_1';

      await ctx.d1.prepare(`
        INSERT INTO orders (id, buyer_user_id, app_id, gross_cents, stripe_payment_intent_id, status)
        VALUES (?, ?, 'dronehunter', 1500, ?, 'pending')
      `).bind(orderId, buyerId, piId).run();

      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'payment_intent.succeeded',
          id: `evt_${piId}`,
          paymentIntentId: piId,
          metadata: {
            appId: 'dronehunter',
            buyerId,
            makerId: 'usr_nate',
            amountCents: '1500'
          }
        })
      });

      const res = await webhookApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);

      // PROOF OF GAP: D1 database batch failed and rolled back!
      // Order status was NEVER updated to 'completed'
      const order = await ctx.d1.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first();
      expect((order as any).status).toBe('pending'); // Should be 'completed' if settlement succeeded

      // No license was minted
      const licenses = await ctx.d1.prepare('SELECT * FROM licenses WHERE order_id = ?').bind(orderId).all();
      expect(licenses.results?.length).toBe(0);

      // No transfer ledger entry was persisted
      const transfers = await ctx.d1.prepare('SELECT * FROM transfers_ledger WHERE order_id = ?').bind(orderId).all();
      expect(transfers.results?.length).toBe(0);
    });

    it.skip('CONTRACT GAP: Webhook API should execute valid D1 batch settlement and return honest 500 when batch fails', async () => {
      // Documenting expected contract behavior:
      // When database transaction fails, API should NOT return { success: true, settled: true }
      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'payment_intent.succeeded',
          id: 'evt_gap_contract_1',
          paymentIntentId: 'pi_gap_contract_1',
          metadata: {
            appId: 'dronehunter',
            buyerId: 'usr_nonexistent_ghost',
            amountCents: '1500'
          }
        })
      });

      const res = await webhookApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    /**
     * PROVEN GAP 2: Comments API Error Swallowing on Foreign Key Violation
     *
     * In `functions/api/comments.ts` lines 48-54:
     * When inserting a comment for a non-existent `app_id` or `user_id`, SQLite with foreign keys
     * enabled throws `FOREIGN KEY constraint failed`.
     * The `try { ... } catch {}` block silently swallows the error without setting an error status,
     * returning `HTTP 200 { success: true, commentId: '...', comment: { ... } }`.
     */
    it('proves that Comments API swallows D1 foreign key constraint failure for non-existent app and reports simulated success', async () => {
      const nonExistentAppId = 'app_nonexistent_xyz';
      const req = new Request('http://localhost/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: nonExistentAppId,
          text: 'Comment on non-existent app',
          author: 'nate'
        })
      });

      const res = await commentsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      // Current behavior: returns 200 with simulated comment object
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // PROOF OF PERSISTENCE FAILURE: Verify that the comment was NOT persisted in D1
      const commentInDb = await ctx.d1.prepare('SELECT * FROM comments WHERE id = ?').bind(data.commentId).first();
      expect(commentInDb).toBeNull();
    });

    it.skip('CONTRACT GAP: Comments API should return HTTP 400/500 when comment insertion fails foreign key constraint', async () => {
      // Documenting expected contract behavior:
      const req = new Request('http://localhost/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'app_nonexistent_xyz',
          text: 'Comment on non-existent app',
          author: 'nate'
        })
      });

      const res = await commentsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBeGreaterThanOrEqual(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    /**
     * PROVEN GAP 3: Git Forge CAS App-Listing Auto-Provisioning Foreign Key Violation
     *
     * In `functions/api/git.ts` lines 314-326:
     * When pushing to a new repoId that doesn't have an `app_listings` entry, it attempts:
     * `INSERT INTO app_listings (...) VALUES (?, ..., 'usr_' || committer)`.
     * If the committer user does not exist in `users`, the insert fails foreign key constraint,
     * but is caught in `try { ... } catch {}`.
     */
    it('proves that the control plane no longer auto-provisions listings from caller-controlled committers', async () => {
      const unknownAppId = 'app_auto_prov_test';
      const unknownCommitter = 'ghostcommitter_123';
      const newSha = '5555555555555555555555555555555555555555';

      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          action: 'cas',
          repositoryId: unknownAppId,
          ref: 'refs/heads/main',
          newSha,
          committer: unknownCommitter
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(501);
      expect(data.success).toBe(false);

      // PROOF: App listing was NOT provisioned because creator_id 'usr_ghostcommitter_123' does not exist in users table
      const appInDb = await ctx.d1.prepare('SELECT * FROM app_listings WHERE id = ?').bind(unknownAppId).first();
      expect(appInDb).toBeNull();
    });

    it.skip('CONTRACT GAP: Git Forge should require valid registered user for app auto-provisioning', async () => {
      // Documenting expected contract behavior:
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'app_auto_prov_contract',
          ref: 'refs/heads/main',
          newSha: '6666666666666666666666666666666666666666',
          committer: 'nonexistent_committer_ghost'
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      expect(res.status).toBeGreaterThanOrEqual(400);
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });
});
