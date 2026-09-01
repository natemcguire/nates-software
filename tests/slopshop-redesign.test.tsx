import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { SlopshopView } from '../src/views/SlopshopView';
import { AuthContext, AuthUser } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';

const mockUser: AuthUser = {
  id: 'usr_nate123',
  username: 'nate',
  displayName: 'Nate',
  avatar: '🤠',
  role: 'maker',
  isSuperAdmin: false
};

const createMockAuthContext = (user: AuthUser | null) => ({
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
  requireAuth: vi.fn()
});

const renderSlopshop = (user: AuthUser | null = mockUser) => {
  const authCtx = createMockAuthContext(user);
  return renderToString(
    <AuthContext.Provider value={authCtx}>
      <AlertProvider>
        <SlopshopView />
      </AlertProvider>
    </AuthContext.Provider>
  );
};

describe('SlopshopView Approved One-Loop Dev Environment UX', () => {
  it('renders the 5-stage loop rail with correct names, subtitles, and back labels', () => {
    const html = renderSlopshop();

    // 5 Stages
    expect(html).toContain('Fork');
    expect(html).toContain('Copy an app to your namespace');
    expect(html).toContain('via GITSMITH forge');

    expect(html).toContain('Slop');
    expect(html).toContain('Change it with an AI agent, in the terminal');
    expect(html).toContain('this is the work');

    expect(html).toContain('Run');
    expect(html).toContain('Boot your fork and watch it live');
    expect(html).toContain('RIG runtime');

    expect(html).toContain('Push');
    expect(html).toContain('Send your commits back with proof');
    expect(html).toContain('to GITSMITH');

    expect(html).toContain('Publish');
    expect(html).toContain('List your version for sale');
    expect(html).toContain('you keep 70%');
  });

  it('renders the 2-column work area: terminal on the left and RIG run panel on the right', () => {
    const html = renderSlopshop();

    // Left Column: Terminal Panel
    expect(html).toContain('Terminal —');
    expect(html).toContain('(your fork)');
    expect(html).toContain('Nate&#x27;s Software Command Guide &amp; Emulator');
    expect(html).toContain('Local mode is a browser command emulator');

    // Right Column: Run Panel (RIG folded in)
    expect(html).toContain('Run — your fork, live');
    expect(html).toContain('not running — do the Run step');
    expect(html).toContain('port');
    expect(html).toContain('mem');
    expect(html).toContain('status');
  });

  it('renders the 70 / 20 / 10 automated settlement ledger note once', () => {
    const html = renderSlopshop();

    expect(html).toContain('When your fork sells, the split is settled automatically:');
    expect(html).toContain('70%');
    expect(html).toContain('you');
    expect(html).toContain('20%');
    expect(html).toContain('up the fork lineage');
    expect(html).toContain('10%');
    expect(html).toContain('protocol');
    expect(html).toContain('A root app with no ancestors is 90 / 10.');
  });

  it('renders dynamic primary actions and 3-cell status bar', () => {
    const html = renderSlopshop();

    // Initial Stage 0 (Fork) Actions
    expect(html).toContain('Fork nate/dronehunter');
    expect(html).toContain('Pick another app');

    // Status bar cells
    expect(html).toContain('Step 1 of 5 · Fork');
    expect(html).toContain('Fork copies the app to your namespace. GITSMITH is the git backend.');
    expect(html).toContain('GITSMITH:');
  });

  it('displays authenticated username when logged in and draft handle when logged out', () => {
    const loggedInHtml = renderSlopshop(mockUser);
    expect(loggedInHtml).toContain('signed in as @nate');

    const loggedOutHtml = renderSlopshop(null);
    expect(loggedOutHtml).toContain('(editable draft handle)');
    expect(loggedOutHtml).not.toContain('signed in as @');
  });
});
