import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AuthContext, AuthUser } from '../src/context/AuthContext';
import { AuthModal } from '../src/components/AuthModal';
import { DesktopTaskbar } from '../src/components/DesktopTaskbar';
import { AlertProvider } from '../src/context/AlertContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { useWindowManager } from '../src/hooks/useWindowManager';
import { AppInner, resolveAppRoute } from '../src/App';

const mockUser: AuthUser = {
  id: 'usr_alice123',
  username: 'alice_maker',
  displayName: 'Alice Maker',
  avatar: '👩‍💻',
  role: 'maker',
  isSuperAdmin: false
};

const createMockAuthContext = (
  user: AuthUser | null,
  isAuthModalOpen = false,
  authModalTab: 'login' | 'register' = 'login',
  actionDescription: string | null = null,
  openAuthModalMock = vi.fn(),
  requireAuthMock = vi.fn()
) => ({
  user,
  isAuthenticated: Boolean(user),
  isSuperAdmin: user?.role === 'super_admin',
  isAuthModalOpen,
  authModalTab,
  actionDescription,
  openAuthModal: openAuthModalMock,
  closeAuthModal: vi.fn(),
  login: vi.fn().mockResolvedValue({ success: true }),
  register: vi.fn().mockResolvedValue({ success: true }),
  logout: vi.fn().mockResolvedValue(undefined),
  requireAuth: requireAuthMock
});

describe('WAVE-UX-B Specification Tests', () => {
  describe('Item 1: F1 — Proactive contextual gating & actionDescription display in AuthModal', () => {
    it('renders actionDescription contextually in the modal header when provided', () => {
      const authCtx = createMockAuthContext(
        null,
        true,
        'login',
        'upvote this drop'
      );

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AuthModal />
        </AuthContext.Provider>
      );

      expect(html).toContain('Sign in to upvote this drop');
    });

    it('renders pre-formatted actionDescription directly without double "Sign in to"', () => {
      const authCtx = createMockAuthContext(
        null,
        true,
        'login',
        'Sign in to upvote this drop'
      );

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AuthModal />
        </AuthContext.Provider>
      );

      expect(html).toContain('Sign in to upvote this drop');
      expect(html).not.toContain('Sign in to Sign in to');
    });

    it('renders cleanly without actionDescription banner when actionDescription is null', () => {
      const authCtx = createMockAuthContext(
        null,
        true,
        'login',
        null
      );

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AuthModal />
        </AuthContext.Provider>
      );

      expect(html).not.toContain('Sign in to null');
      expect(html).toContain('Create an account to keep your forks, vote on drops, and get paid when you sell.');
    });
  });

  describe('Item 2: F4 — AuthModal value prop benefit line & retitled per tab', () => {
    it('retitles modal to "Join Nate\'s Software" on signup / register tab', () => {
      const authCtx = createMockAuthContext(
        null,
        true,
        'register'
      );

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AuthModal />
        </AuthContext.Provider>
      );

      expect(html).toContain("Join Nate&#x27;s Software");
      expect(html).not.toContain("NATE'S SOFTWARE SECURITY &amp; AUTHENTICATION");
    });

    it('retitles modal to "Welcome back" on login tab', () => {
      const authCtx = createMockAuthContext(
        null,
        true,
        'login'
      );

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AuthModal />
        </AuthContext.Provider>
      );

      expect(html).toContain('Welcome back');
      expect(html).not.toContain("NATE'S SOFTWARE SECURITY &amp; AUTHENTICATION");
    });

    it('renders the concrete benefit line at the top', () => {
      const authCtx = createMockAuthContext(
        null,
        true,
        'login'
      );

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AuthModal />
        </AuthContext.Provider>
      );

      expect(html).toContain('Create an account to keep your forks, vote on drops, and get paid when you sell.');
    });
  });

  describe('Item 3: C3 — Unify signup verb to "Create account"', () => {
    it('renders "Create account" in AuthModal tabs and submit button', () => {
      const authCtx = createMockAuthContext(null, true, 'register');

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AuthModal />
        </AuthContext.Provider>
      );

      expect(html).toContain('Create account');
      expect(html).not.toContain('Sign Up');
    });
  });

  describe('Item 4: F5 / #5 — Desktop wayfinding & greeting', () => {
    it('renders greeting and user identity on taskbar when logged in', () => {
      const authCtx = createMockAuthContext(mockUser);

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <DesktopTaskbar tabs={[]} onStartClick={() => {}} />
        </AuthContext.Provider>
      );

      expect(html).toContain('Welcome back,');
      expect(html).toContain('@Alice Maker');
      expect(html).toContain('👩‍💻');
      expect(html).not.toContain('Log In');
      expect(html).not.toContain('Create account');
    });

    it('renders desktop corner greeting when logged in', () => {
      const authCtx = createMockAuthContext(mockUser);

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <AppInner />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('Welcome back,');
      expect(html).toContain('@Alice Maker');
    });
  });

  describe('Item 5: #7 — Standalone-subdomain account widget', () => {
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      if (originalWindow) {
        (globalThis as any).window = originalWindow;
      } else {
        delete (globalThis as any).window;
      }
    });

    it('resolves standalone route correctly', () => {
      const route = resolveAppRoute('hotwire.nates-software.com', '/', '');
      expect(route.type).toBe('standalone_view');
      expect(route.id).toBe('hotwire');
    });

    it('renders AccountWidget in standalone route wrapper header when logged out', () => {
      (globalThis as any).window = {
        location: new URL('https://hotwire.nates-software.com'),
        innerWidth: 1440,
        innerHeight: 900
      };

      const authCtx = createMockAuthContext(null);

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <AppInner />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).not.toContain('STANDALONE ROUTE');
      expect(html).toContain('Log In');
      expect(html).toContain("Return to Nate&#x27;s Software Web OS");
    });

    it('renders AccountWidget with @username in standalone route wrapper header when logged in', () => {
      (globalThis as any).window = {
        location: new URL('https://hotwire.nates-software.com'),
        innerWidth: 1440,
        innerHeight: 900
      };

      const authCtx = createMockAuthContext(mockUser);

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <AppInner />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).not.toContain('STANDALONE ROUTE');
      expect(html).toContain('@Alice Maker');
      expect(html).toContain('👩‍💻');
      expect(html).not.toContain('Sign Up');
    });

    it('renders AccountWidget in standalone app header when viewing a dedicated app subdomain', () => {
      (globalThis as any).window = {
        location: new URL('https://dronehunter.nates-software.com'),
        innerWidth: 1440,
        innerHeight: 900
      };

      const authCtx = createMockAuthContext(mockUser);

      const html = renderToString(
        <AuthContext.Provider value={authCtx}>
          <AlertProvider>
            <CatalogProvider>
              <AppInner />
            </CatalogProvider>
          </AlertProvider>
        </AuthContext.Provider>
      );

      expect(html).toContain('@Alice Maker');
      expect(html).toContain("Return to Nate&#x27;s Software Web OS");
    });
  });

  describe('Item 6: #8 — Inbox window title reflects logged-in user', () => {
    function TestWindowManagerConsumer({ user }: { user: AuthUser | null }) {
      const { windows } = useWindowManager(user);
      return <div data-testid="inbox-title">{windows.inbox.title}</div>;
    }

    it('personalizes inbox window title with @{user.username}\'s inbox when logged in', () => {
      const html = renderToString(<TestWindowManagerConsumer user={mockUser} />);
      expect(html).toContain("INBOX — [@alice_maker&#x27;s inbox · 3-Pane Agent Mailbox]");
      expect(html).not.toContain('nate@natesoftware');
    });

    it('falls back to generic title when logged out without hardcoding owner handle', () => {
      const html = renderToString(<TestWindowManagerConsumer user={null} />);
      expect(html).toContain('INBOX — [Local Agent Mailbox · 3-Pane Observer]');
      expect(html).not.toContain('nate@natesoftware');
    });
  });
});
