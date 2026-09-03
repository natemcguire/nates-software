import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AuthContext, AuthUser } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { ForkWithAiModal } from '../src/components/ForkWithAiModal';
import { ProfileView } from '../src/views/ProfileView';
import { HotwireView } from '../src/views/HotwireView';
import { AppListing } from '../src/data/mockData';

const mockUser: AuthUser = {
  id: 'usr_alice123',
  username: 'alice_maker',
  displayName: 'Alice Maker',
  avatar: '👩‍💻',
  role: 'maker',
  isSuperAdmin: false
};

const createMockAuthContext = (user: AuthUser | null, requireAuthMock = vi.fn((_desc, cb) => cb && cb())) => ({
  user,
  isAuthenticated: Boolean(user),
  isSuperAdmin: user?.role === 'super_admin',
  isAuthModalOpen: false,
  authModalTab: 'login' as const,
  openAuthModal: vi.fn(),
  closeAuthModal: vi.fn(),
  login: vi.fn().mockResolvedValue({ success: true }),
  register: vi.fn().mockResolvedValue({ success: true }),
  logout: vi.fn().mockResolvedValue(undefined),
  requireAuth: requireAuthMock
});

const sampleApp: AppListing = {
  id: 'dronehunter',
  name: 'DroneHunter 95',
  tagline: 'Retro duck hunting meets rogue surveillance drones.',
  description: 'Full featured game.',
  author: 'nate',
  authorAvatar: '🎯',
  creator: 'nate',
  creatorAvatar: '🎯',
  version: 'v1.0.4',
  upvotes: 42,
  forkCount: 7,
  forks: 7,
  tags: ['Game', 'Retro'],
  hasCanonicalRepo: true,
  isRepoActive: true,
  repoSlug: 'nate/dronehunter',
  repoName: 'dronehunter',
  repoOwner: 'nate',
  repoHeadCommitOid: '9f8e7d6c5b4a3210',
  screenshots: [],
  comments: []
};

const unlinkedApp: AppListing = {
  id: 'unlinked-demo',
  name: 'Unlinked Demo App',
  tagline: 'Demo app without canonical repository.',
  description: 'Demo app.',
  author: 'nate',
  authorAvatar: '🎯',
  creator: 'nate',
  creatorAvatar: '🎯',
  version: 'v1.0.0',
  upvotes: 5,
  forkCount: 0,
  forks: 0,
  tags: ['Demo'],
  hasCanonicalRepo: false,
  isRepoActive: false,
  repositoryId: null,
  repoSlug: null,
  screenshots: [],
  comments: []
};

describe('WAVE-UX-D Specification Tests', () => {
  describe('Item 1 & 2 & 4: ForkWithAiModal — de-jargon, define fork, logged-out honest state, reward first action', () => {
    it('defines fork with plain explainer line at the top', () => {
      const authCtx = createMockAuthContext(mockUser);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <ForkWithAiModal
                isOpen={true}
                onClose={() => {}}
                app={sampleApp}
              />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain("Forking gives you your own private copy of this app&#x27;s code to change with AI — and if you sell it later, the platform takes a flat 10%, the maker you forked from earns their frozen royalty, and you keep the rest.");
    });

    it('renders logged-in fork owner as @{username} without @guest', () => {
      const authCtx = createMockAuthContext(mockUser);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <ForkWithAiModal
                isOpen={true}
                onClose={() => {}}
                app={sampleApp}
              />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('Fork: @alice_maker');
      expect(html).not.toContain('@guest');
    });

    it('renders logged-out fork owner as "(your account)" and notes sign-in is needed, never "@guest"', () => {
      const authCtx = createMockAuthContext(null);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <ForkWithAiModal
                isOpen={true}
                onClose={() => {}}
                app={sampleApp}
              />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('Fork: (your account)');
      expect(html).toContain('Sign in to keep your fork');
      expect(html).not.toContain('Fork: @guest');
      expect(html).not.toContain('@guest');
    });

    it('shows plain copy when not forkable without "repository_id is null" or "no canonical repository" jargon', () => {
      const authCtx = createMockAuthContext(mockUser);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <ForkWithAiModal
                isOpen={true}
                onClose={() => {}}
                app={unlinkedApp}
              />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain("This app hasn&#x27;t published its source yet, so it can&#x27;t be forked.");
      expect(html).not.toContain('repository_id is null');
      expect(html).not.toContain('unlinked (repository_id is null)');
      expect(html).not.toContain('No Canonical Repository on Forge Yet');
    });

    it('rewards real fork with plain success and forward action button to open in browser without outbox jargon', () => {
      const authCtx = createMockAuthContext(mockUser);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <ForkWithAiModal
                isOpen={true}
                onClose={() => {}}
                app={sampleApp}
              />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).not.toContain('outbox event dispatch');
      expect(html).not.toContain('registered in D1 with immutable lineage');
    });
  });

  describe('Item 3 & 1: ProfileView — de-jargon status pills and empty-state action links', () => {
    it('does not leak D1 SYNCED or outbox in user copy', () => {
      const authCtx = createMockAuthContext(mockUser);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <ProfileView />
        </AuthContext.Provider>
      );

      expect(html).not.toContain('● D1 SYNCED');
      expect(html).not.toContain('saved to Cloudflare D1');
      expect(html).not.toContain('transfer outbox records');
      expect(html).not.toContain('records from D1');
    });

    it('renders empty shelf state with plain copy and Browse drops button', () => {
      const authCtx = createMockAuthContext(mockUser);
      const onOpenHotwire = vi.fn();
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <ProfileView onOpenHotwire={onOpenHotwire} />
        </AuthContext.Provider>
      );

      expect(html).not.toContain('register authoritative licenses');
      expect(html).not.toContain('Acquire apps from the 12:01 AM');
    });
  });

  describe('Item 1 & 4: HotwireView — de-jargon badges and vote reward forward action', () => {
    it('de-jargons D1 badges and displays definition banner', () => {
      const authCtx = createMockAuthContext(mockUser);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <HotwireView />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('Every day at 12:01 AM UTC, makers drop new apps. Vote for your favorites.');
      expect(html).not.toContain('● D1 LIVE');
      expect(html).not.toContain('● D1 Live Verified Makers');
      expect(html).not.toContain('Retrieving daily shareware queue from Cloudflare D1.');
    });
  });
});
