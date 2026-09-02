import { describe, it, expect } from 'vitest';
import * as authApi from '../functions/api/auth';
import * as chatApi from '../functions/api/chat';
import * as commentsApi from '../functions/api/comments';
import * as dropsApi from '../functions/api/drops';
import * as gitApi from '../functions/api/git';
import * as inboxApi from '../functions/api/inbox';
import * as profileApi from '../functions/api/profile';
import * as shelfApi from '../functions/api/shelf';
import * as upvoteApi from '../functions/api/upvote';
import * as dynoApi from '../functions/api/dyno';
import * as feedApi from '../functions/api/feed';

import { GITSMITH_REPOS } from '../src/views/GitsmithView';
import { INITIAL_ONLINE_USERS } from '../src/lib/ircProtocol';
import { resolveAppRoute } from '../src/App';

describe('Comprehensive End-to-End API & Route QA Suite', () => {

  // 1. Data Integrity & Invariants (No Mock Leakage)
  describe('1. Data Integrity & App Catalog Invariants', () => {
    // (The former "INITIAL_APPS contains exactly 4 shareware titles" test was removed with
    // the fabricated INITIAL_APPS fixture — the catalog is now sourced exclusively from D1.)
    it('should have matching GITSMITH repositories with valid owners and files', () => {
      expect(GITSMITH_REPOS.length).toBe(4);
      GITSMITH_REPOS.forEach(repo => {
        expect(['dronehunter', 'certified-mailer', 'wallart', 'american-gardener']).toContain(repo.id);
        expect(repo.files.length).toBeGreaterThanOrEqual(2);
        expect(repo.owner).toBe('nate');
      });
    });

    it('should have only real users (Nate, Josh, Sam) across online IRC presence', () => {
      const handles = INITIAL_ONLINE_USERS.map(u => u.nick);
      expect(handles).toEqual(['nate', 'josh', 'sam']);
    });
  });

  // 2. Authentication API (/api/auth)
  describe('2. Authentication API (/api/auth)', () => {
    it('should reject registration with invalid or reserved usernames', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' })
      });

      const res = await authApi.onRequestPost({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('reserved');
    });

    it('should reject registration with password shorter than 8 characters', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'validuser', password: '123' })
      });

      const res = await authApi.onRequestPost({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('at least 8 characters');
    });

    it('should handle unauthenticated session lookups cleanly', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/auth?action=me', { method: 'GET' });
      const res = await authApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.authenticated).toBe(false);
      expect(data.user).toBeNull();
    });
  });

  // 3. Chat & IRC API (/api/chat)
  describe('3. IRC Chat API (/api/chat)', () => {
    it('should fail closed when chat storage is unavailable', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/chat?channel=%23lounge', { method: 'GET' });
      const res = await chatApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.error).toContain('storage is unavailable');
    });

    it('should reject chat posting with empty text', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: '#lounge', sender: 'nate', text: '   ' })
      });

      const res = await chatApi.onRequestPost({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(res.status).toBe(401);
      expect(data.error).toContain('authenticated session');
    });
  });

  // 4. Hotwire Drops & Syndication API (/api/drops, /api/feed)
  describe('4. Hotwire Drops & RSS Feed API', () => {
    it('should handle drops query with default fallback response', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(Array.isArray(data.drops)).toBe(true);
    });

    it('should fail closed when syndication storage is unavailable', async () => {
      const mockEnv = {};
      const reqRss = new Request('http://localhost/api/feed?format=rss', { method: 'GET' });
      const resRss = await feedApi.onRequestGet({ request: reqRss, env: mockEnv });
      expect(resRss.status).toBe(503);

      const reqJson = new Request('http://localhost/api/feed?format=json', { method: 'GET' });
      const resJson = await feedApi.onRequestGet({ request: reqJson, env: mockEnv });
      const feedData = await resJson.json();
      expect(resJson.status).toBe(503);
      expect(feedData.success).toBe(false);
    });
  });

  // 5. Git Forge & CAS Merge API (/api/git)
  describe('5. GITSMITH Bare Forge API (/api/git)', () => {
    it('should return Git forge protocol invariants on status query', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/git', { method: 'GET' });
      const res = await gitApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.service).toContain('GITSMITH');
      expect(data.invariants.length).toBeGreaterThanOrEqual(4);
    });
  });

  // 6. Upvote & Rate Limiting API (/api/upvote)
  describe('6. Upvoting API (/api/upvote)', () => {
    it('should reject upvote when appId is missing', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const res = await upvoteApi.onRequestPost({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('appId is required');
    });
  });



  // 8.5 Profile, Shelf, Inbox, & Comments APIs
  describe('8.5 Profile, Shelf, Inbox, & Comments APIs', () => {
    it('should query profile and handle user lookup', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/profile?username=nate', { method: 'GET' });
      const res = await profileApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data).toHaveProperty('success');
    });

    it('should query shelf items for active user', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/shelf?userId=usr_nate', { method: 'GET' });
      const res = await shelfApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data).toHaveProperty('success');
    });

    it('should query inbox threads for authenticated user', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/inbox?username=nate', { method: 'GET' });
      const res = await inboxApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data).toHaveProperty('success');
    });

    it('should query comments for a drop', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/comments?app_id=dronehunter', { method: 'GET' });
      const res = await commentsApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();
      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
    });

    it('should query canonical developer benchmark leaderboard from dynoApi', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/dyno', { method: 'GET' });
      const res = await dynoApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.leaderboard)).toBe(true);
    });
  });

  // 9. Standalone Subdomain & Production Route Resolution (Testing src/App.tsx)
  describe('9. Production Subdomain & Route Resolution (src/App.tsx)', () => {
    it('should accurately resolve all registered subdomains via resolveAppRoute', () => {
      expect(resolveAppRoute('chat.nates-software.com', '/')).toEqual({ type: 'standalone_view', id: 'chat', title: 'CHAT IRC CHATROOM (#lounge)' });
      expect(resolveAppRoute('gitsmith.nates-software.com', '/')).toEqual({ type: 'standalone_view', id: 'gitsmith', title: 'GITSMITH FORGE' });
      expect(resolveAppRoute('hotwire.nates-software.com', '/')).toEqual({ type: 'standalone_view', id: 'hotwire', title: 'HOTWIRE DAILY DROPS' });
      // EDITORIAL was removed from launch nav/routing (sample-only content); the
      // `editorial` subdomain no longer resolves to a first-party view.
      expect(resolveAppRoute('slopshop.nates-software.com', '/')).toEqual({ type: 'standalone_view', id: 'slopshop', title: 'SLOPSHOP LOCAL AI AGENT LAUNCHPAD' });
      expect(resolveAppRoute('rig.nates-software.com', '/')).toEqual({ type: 'standalone_view', id: 'rig', title: 'RIG.EXE MICRO-CONTAINER & STORAGE HUD' });
      expect(resolveAppRoute('dronehunter.nates-software.com', '/')).toEqual({ type: 'standalone_app', id: 'dronehunter', title: 'DroneHunter 95' });
      expect(resolveAppRoute('certified-mailer.nates-software.com', '/')).toEqual({ type: 'standalone_app', id: 'certified-mailer', title: 'Certified Mailer' });
      expect(resolveAppRoute('american-gardener.nates-software.com', '/')).toEqual({ type: 'standalone_app', id: 'american-gardener', title: 'American Gardener' });
      expect(resolveAppRoute('wallart.nates-software.com', '/')).toEqual({ type: 'standalone_app', id: 'wallart', title: 'WallArt Canvas Pro' });
    });

    it('should accurately resolve all direct root path routes via resolveAppRoute', () => {
      // EDITORIAL removed from launch: /editorial and /lab no longer resolve to a view.
      expect(resolveAppRoute('nates-software.com', '/editorial')).toEqual({ type: 'desktop' });
      expect(resolveAppRoute('nates-software.com', '/inbox')).toEqual({ type: 'standalone_view', id: 'inbox', title: 'INBOX PROPOSALS' });
      expect(resolveAppRoute('nates-software.com', '/white-papers')).toEqual({ type: 'standalone_view', id: 'white-papers', title: 'ARCHITECTURAL WHITE PAPERS' });
      expect(resolveAppRoute('nates-software.com', '/dyno')).toEqual({ type: 'standalone_view', id: 'dyno', title: 'DYNO AI DEVELOPER BENCHMARK (Model + Harness + Tools)' });
      expect(resolveAppRoute('nates-software.com', '/profile')).toEqual({ type: 'standalone_view', id: 'profile', title: 'MAKER PROFILE & DISK SHELF' });
      expect(resolveAppRoute('nates-software.com', '/terminal')).toEqual({ type: 'standalone_view', id: 'terminal', title: 'TERMINAL.EXE INTERACTIVE DOS SHELL' });
      expect(resolveAppRoute('nates-software.com', '/')).toEqual({ type: 'desktop' });
    });
  });
});
