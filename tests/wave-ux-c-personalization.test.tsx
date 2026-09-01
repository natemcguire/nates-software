import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AuthContext, AuthUser } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { SlopshopView } from '../src/views/SlopshopView';
import { RigRuntimeView } from '../src/views/RigRuntimeView';
import { HotwireView } from '../src/views/HotwireView';
import { PostEditorView } from '../src/views/PostEditorView';
import { AppListing } from '../src/data/mockData';

const mockUser: AuthUser = {
  id: 'usr_alice123',
  username: 'alice_maker',
  displayName: 'Alice Maker',
  avatar: '👩‍💻',
  role: 'maker',
  isSuperAdmin: false
};

const createMockAuthContext = (user: AuthUser | null, requireAuthMock = vi.fn()) => ({
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

describe('WAVE-UX-C Personalization & Ownership Gating', () => {
  describe('Item 1: SLOPSHOP (#11) — SlopshopView personalization', () => {
    it('seeds makerHandle from authenticated user and shows signed in as badge', () => {
      const authCtx = createMockAuthContext(mockUser);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <SlopshopView />
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('value="@alice_maker"');
      expect(html).toContain('signed in as @');
      expect(html).toContain('alice_maker');
    });

    it('renders editable default when logged out without claiming the user is logged in', () => {
      const authCtx = createMockAuthContext(null);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <SlopshopView />
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('value="@nate"');
      expect(html).toContain('(editable draft handle)');
      expect(html).not.toContain('signed in as @nate');
    });
  });

  describe('Item 4: RIG (#15) — RigRuntimeView fleet personalization', () => {
    it('displays @{username}\'s fleet in HUD header when logged in', () => {
      const authCtx = createMockAuthContext(mockUser);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <RigRuntimeView />
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('alice_maker');
      expect(html).toContain('fleet');
      expect(html).not.toContain('Guest fleet');
    });

    it('displays Guest fleet in HUD header when logged out', () => {
      const authCtx = createMockAuthContext(null);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <RigRuntimeView />
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('Guest fleet');
      expect(html).not.toContain('alice_maker');
    });
  });

  describe('Item 5: HOTWIRE (#9, C2, E1) — HotwireView clarity, timezone note, and mine filter', () => {
    it('displays definition banner, local time countdown, and Mine filter tab when logged in', () => {
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

      // Definition banner
      expect(html).toContain('Every day at 12:01 AM UTC, makers drop new apps. Vote for your favorites.');
      // Local time & UTC note
      expect(html).toContain('local');
      expect(html).toContain('12:01 AM UTC');
      // Mine filter tab
      expect(html).toContain('Mine');
    });

    it('does not display Mine filter tab when logged out', () => {
      const authCtx = createMockAuthContext(null);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <HotwireView />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).not.toContain('●</span> Mine');
      expect(html).toContain('Every day at 12:01 AM UTC, makers drop new apps. Vote for your favorites.');
    });
  });

  describe('Item 6: POST EDITOR (#19) — PostEditorView maker identity and auth gating', () => {
    const sampleApp: AppListing = {
      id: 'app_sample',
      name: 'Sample Super App',
      tagline: 'A wonderful test app',
      description: 'Full description of sample app',
      author: 'alice_maker',
      authorAvatar: '👩‍💻',
      creator: 'alice_maker',
      creatorAvatar: '👩‍💻',
      version: 'v1.0.0',
      upvotes: 5,
      forkCount: 0,
      forks: 0,
      tags: ['Tool'],
      sqliteDatabase: '',
      sqliteSize: '',
      screenshots: [],
      comments: []
    };

    it('renders maker attribution in header and info tab', () => {
      const authCtx = createMockAuthContext(mockUser);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <PostEditorView
              app={sampleApp}
              initialTab="info"
              onSave={() => {}}
              onCancel={() => {}}
            />
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('Publishing as:');
      expect(html).toContain('alice_maker');
      expect(html).toContain('MAKER ATTRIBUTION');
      expect(html).toContain('(authenticated account)');
    });

    it('renders guest attribution when logged out', () => {
      const authCtx = createMockAuthContext(null);
      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <PostEditorView
              app={{ ...sampleApp, author: 'guest', creator: 'guest' }}
              initialTab="info"
              onSave={() => {}}
              onCancel={() => {}}
            />
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('Publishing as:');
      expect(html).toContain('guest');
      expect(html).toContain('Sign in to link drop to your verified profile.');
    });
  });
});
