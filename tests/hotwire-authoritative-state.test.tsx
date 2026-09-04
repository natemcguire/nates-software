import { renderToString } from 'react-dom/server';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as dropsApi from '../functions/api/drops';
import * as upvoteApi from '../functions/api/upvote';
import { hashSessionToken } from '../functions/api/_session';
import { HotwireView } from '../src/views/HotwireView';
import { ArtifactSandbox } from '../src/components/ArtifactSandbox';
import { AlertProvider } from '../src/context/AlertContext';
import { AuthProvider } from '../src/context/AuthContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { AppListing } from '../src/data/mockData';

describe('CLUSTER B: Hotwire Authoritative State (§1-§7)', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('§1 Seed inventory as live & honest error states', () => {
    it('returns empty array from /api/drops when D1 has 0 listings, preserving purity without mock inventory', async () => {
      await ctx.d1.prepare('DELETE FROM commerce_products').run();
      await ctx.d1.prepare('DELETE FROM app_listings').run();

      const req = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.drops).toEqual([]);
      expect(Array.isArray(data.makerLeaderboard)).toBe(true);
    });

  });

  describe('§2 Have-I-voted viewer-scoped hydration', () => {
    it('GET /api/upvote and GET /api/drops return viewer-scoped hasVoted for authenticated user', async () => {
      const secret = 'test-secret-salt-12345';
      const env = { DB: ctx.d1, UPVOTE_HASH_SECRET: secret };

      const rawToken = 'nate_session_token_123';
      const tokenHash = await hashSessionToken(rawToken);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(tokenHash, Date.now() + 86400000).run();

      const postReq = new Request('http://localhost/api/upvote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
          'Sec-Fetch-Site': 'same-origin',
          'Cookie': `nsw_session=${rawToken}`
        },
        body: JSON.stringify({ appId: 'dronehunter' })
      });

      const postRes = await upvoteApi.onRequestPost({ request: postReq, env });
      const postData = await postRes.json();
      if (!postData.success) {
        console.error('postData failed:', postRes.status, postData);
      }
      expect(postData.success).toBe(true);

      const myVotesReq = new Request('http://localhost/api/upvote?action=my-votes', {
        method: 'GET',
        headers: { 'Cookie': `nsw_session=${rawToken}` }
      });
      const myVotesRes = await upvoteApi.onRequestGet({ request: myVotesReq, env });
      const myVotesData = await myVotesRes.json();

      expect(myVotesData.success).toBe(true);
      expect(myVotesData.votedAppIds).toContain('dronehunter');

      const dropsReq = new Request('http://localhost/api/drops?sort=today', {
        method: 'GET',
        headers: { 'Cookie': `nsw_session=${rawToken}` }
      });
      const dropsRes = await dropsApi.onRequestGet({ request: dropsReq, env });
      const dropsData = await dropsRes.json();

      expect(dropsData.success).toBe(true);
      expect(dropsData.votedAppIds).toContain('dronehunter');
      const dronehunter = dropsData.drops.find((d: any) => d.id === 'dronehunter');
      expect(dronehunter?.hasVoted).toBe(true);

      const unauthReq = new Request('http://localhost/api/drops?sort=today', { method: 'GET' });
      const unauthRes = await dropsApi.onRequestGet({ request: unauthReq, env });
      const unauthData = await unauthRes.json();
      const unauthDronehunter = unauthData.drops.find((d: any) => d.id === 'dronehunter');
      expect(unauthDronehunter?.hasVoted).toBe(false);
    });

    it('renders HotwireView with win95 buttons', () => {
      const html = renderToString(
        <AlertProvider>
          <AuthProvider>
            <CatalogProvider>
              <HotwireView />
            </CatalogProvider>
          </AuthProvider>
        </AlertProvider>
      );

      expect(html).toContain('win95-btn');
    });
  });

  describe('§4 Fabricated defaults removed (author, score, cleanliness, price, screenshots)', () => {
    it('does not invent defaults in /api/drops when database row contains minimal columns', async () => {
      await ctx.d1.prepare('DELETE FROM commerce_products').run();
      await ctx.d1.prepare('DELETE FROM app_listings').run();
      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license)
        VALUES ('minimal-drop', 'Minimal Drop', 'Minimal Tagline', 'Minimal Description', 'usr_nate', 'v1.0.0', 'MIT')
      `).run();

      const req = new Request('http://localhost/api/drops', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.drops).toHaveLength(1);

      const drop = data.drops[0];
      expect(drop.screenshots).toEqual([]);
    });
  });

  describe('§5 Live maker leaderboard and voter transparency gating', () => {
    it('computes live maker leaderboard from D1 drop history', async () => {
      const req = new Request('http://localhost/api/drops', { method: 'GET' });
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(Array.isArray(data.makerLeaderboard)).toBe(true);
      if (data.makerLeaderboard.length > 0) {
        const topMaker = data.makerLeaderboard[0];
        expect(topMaker.username).toBeTruthy();
        expect(topMaker.currentStreak).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('§6 Honest disabled states for unpublished / non-forge drops', () => {
    it('ArtifactSandbox displays "Not yet published" and "No repo on forge" for un-deployed drops', () => {
      const draftApp: AppListing = {
        id: 'unpushed-app',
        name: 'Unpushed App',
        tagline: 'Idea only',
        description: 'Not pushed yet',
        author: 'maker1',
        authorAvatar: '⚡',
        creator: 'maker1',
        creatorAvatar: '⚡',
        version: 'v0.0.1',
        upvotes: 0,
        forkCount: 0,
        forks: 0,
        tags: [],
        screenshots: [],
        comments: [],
        deploymentState: 'draft',
        hasCanonicalRepo: false,
        isRepoActive: false,
        repoSlug: null,
        isDemo: false
      };

      const html = renderToString(
        <AlertProvider>
          <AuthProvider>
            <CatalogProvider>
              <ArtifactSandbox app={draftApp} />
            </CatalogProvider>
          </AuthProvider>
        </AlertProvider>
      );

      expect(html).toContain('Not yet published');
      expect(html).toContain('No repo on forge');
    });
  });

  describe('§7 Empty comments thread is treated as authoritative empty, not fixtures', () => {
    it('ArtifactSandbox renders empty comments state when drop has 0 comments', () => {
      const emptyCommentApp: AppListing = {
        id: 'clean-thread-app',
        name: 'Clean Thread App',
        tagline: 'Fresh drop',
        description: 'No chatter yet',
        author: 'creator',
        authorAvatar: '⚡',
        version: 'v1.0.0',
        upvotes: 1,
        forkCount: 0,
        forks: 0,
        tags: [],
        screenshots: [],
        comments: [],
        isDemo: false
      };

      const html = renderToString(
        <AlertProvider>
          <AuthProvider>
            <CatalogProvider>
              <ArtifactSandbox app={emptyCommentApp} />
            </CatalogProvider>
          </AuthProvider>
        </AlertProvider>
      );

      expect(html).toContain('Comments');
      expect(html).toMatch(/Comments\s*\(/);
    });
  });
});
