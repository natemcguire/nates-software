import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AuthContext, AuthUser } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import { SlopshopView } from '../src/views/SlopshopView';
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

      expect(html).toContain('value="@guest"');
      expect(html).toContain('(editable draft handle)');
      expect(html).not.toContain('signed in as @nate');
      expect(html).not.toContain('signed in as @guest');
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
