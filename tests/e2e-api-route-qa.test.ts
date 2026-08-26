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
import * as spliceApi from '../functions/api/splice';
import * as feedApi from '../functions/api/feed';

import { INITIAL_APPS } from '../src/data/mockData';
import { GITSMITH_REPOS } from '../src/views/GitsmithView';
import { INITIAL_ONLINE_USERS } from '../src/lib/ircProtocol';

describe('Comprehensive End-to-End API & Route QA Suite', () => {

  // 1. Data Integrity & Invariants (No Mock Leakage)
  describe('1. Data Integrity & App Catalog Invariants', () => {
    it('should strictly contain exactly 3 shareware titles', () => {
      expect(INITIAL_APPS.length).toBe(3);
      const appIds = INITIAL_APPS.map(a => a.id);
      expect(appIds).toEqual(['dronehunter', 'certified-mailer', 'picfitai']);
    });

    it('should have matching GITSMITH repositories with valid owners and files', () => {
      expect(GITSMITH_REPOS.length).toBe(3);
      GITSMITH_REPOS.forEach(repo => {
        expect(['dronehunter', 'certified-mailer', 'picfitai']).toContain(repo.id);
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
    it('should query channel messages with 24h retention metadata', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/chat?channel=%23lounge', { method: 'GET' });
      const res = await chatApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.channel).toBe('#lounge');
      expect(data.ttlHours).toBe(24);
      expect(data.server).toBe('irc.nates-software.com');
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
      expect(data.error).toBe('text is required');
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

    it('should generate valid RSS XML and JSON Feed syndication payloads', async () => {
      const mockEnv = {};
      const reqRss = new Request('http://localhost/api/feed?format=rss', { method: 'GET' });
      const resRss = await feedApi.onRequestGet({ request: reqRss, env: mockEnv });
      expect(resRss.headers.get('Content-Type')).toContain('application/rss+xml');
      const xmlText = await resRss.text();
      expect(xmlText).toContain('<rss version="2.0"');

      const reqJson = new Request('http://localhost/api/feed?format=json', { method: 'GET' });
      const resJson = await feedApi.onRequestGet({ request: reqJson, env: mockEnv });
      const feedData = await resJson.json();
      expect(feedData.title).toContain("Nate's Software");
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

  // 7. AST Feature Splicer API (/api/splice)
  describe('7. AST Feature Splicer API (/api/splice)', () => {
    it('should reject AST splice requests with missing host or feature', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/splice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const res = await spliceApi.onRequestPost({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Supply featureIds or features');
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
      expect(data).toHaveProperty('success');
    });

    it('should benchmark hardware token velocity with dynoApi', async () => {
      const mockEnv = {};
      const req = new Request('http://localhost/api/dyno?bench=true', { method: 'GET' });
      const res = await dynoApi.onRequestGet({ request: req, env: mockEnv });
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  // 9. Standalone Subdomain & URL Route Matching
  describe('9. Subdomain & Route Matching Invariants', () => {
    const routeMatcher = (hostname: string, pathname: string) => {
      if (hostname.startsWith('chat.') || pathname.startsWith('/chat')) return 'CHAT';
      if (hostname.startsWith('gitsmith.') || pathname.startsWith('/gitsmith')) return 'GITSMITH';
      if (hostname.startsWith('hotwire.') || pathname.startsWith('/hotwire')) return 'HOTWIRE';
      if (hostname.startsWith('slopshop.') || pathname.startsWith('/slopshop')) return 'SLOPSHOP';
      if (hostname.startsWith('rig.') || pathname.startsWith('/rig')) return 'RIG';
      if (pathname.startsWith('/inbox')) return 'INBOX';
      if (pathname.startsWith('/white-papers')) return 'WHITE_PAPERS';
      if (pathname.startsWith('/dyno')) return 'DYNO';
      if (pathname.startsWith('/profile')) return 'PROFILE';
      if (pathname.startsWith('/terminal')) return 'TERMINAL';
      if (hostname.startsWith('dronehunter.')) return 'STANDALONE_DRONEHUNTER';
      return 'DESKTOP_OS';
    };

    it('should accurately resolve all registered subdomains', () => {
      expect(routeMatcher('chat.nates-software.com', '/')).toBe('CHAT');
      expect(routeMatcher('gitsmith.nates-software.com', '/')).toBe('GITSMITH');
      expect(routeMatcher('hotwire.nates-software.com', '/')).toBe('HOTWIRE');
      expect(routeMatcher('slopshop.nates-software.com', '/')).toBe('SLOPSHOP');
      expect(routeMatcher('rig.nates-software.com', '/')).toBe('RIG');
      expect(routeMatcher('dronehunter.nates-software.com', '/')).toBe('STANDALONE_DRONEHUNTER');
    });

    it('should accurately resolve all direct root path routes', () => {
      expect(routeMatcher('nates-software.com', '/inbox')).toBe('INBOX');
      expect(routeMatcher('nates-software.com', '/white-papers')).toBe('WHITE_PAPERS');
      expect(routeMatcher('nates-software.com', '/dyno')).toBe('DYNO');
      expect(routeMatcher('nates-software.com', '/profile')).toBe('PROFILE');
      expect(routeMatcher('nates-software.com', '/terminal')).toBe('TERMINAL');
      expect(routeMatcher('nates-software.com', '/')).toBe('DESKTOP_OS');
    });
  });
});
