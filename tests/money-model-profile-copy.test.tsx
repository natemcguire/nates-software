import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { ProfileView } from '../src/views/ProfileView';
import { AuthContext, AuthUser } from '../src/context/AuthContext';

// ProfileView fetches profile data asynchronously and only renders the
// "Sales, Royalties & Contributor Grants" tab once isLoading is false and the
// viewer owns the profile. There's no jsdom in this suite (SSR-only, mirrors
// the pattern in tests/slopshop-redesign.test.tsx), so we can't await a real
// fetch + re-render here. Instead we assert directly against the component
// source for the money-split copy the E3 task rewrites — this is the same
// technique slopshop-redesign.test.tsx uses for click-/state-gated branches.

const componentSourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/views/ProfileView.tsx'
);
const componentSource = readFileSync(componentSourcePath, 'utf-8');

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

describe('ProfileView money-model copy (E3): no leftover 70/20/10 split language', () => {
  it('renders (initial SSR pass) without throwing', () => {
    const authCtx = createMockAuthContext(mockUser);
    const html = renderToString(
      <AuthContext.Provider value={authCtx}>
        <ProfileView />
      </AuthContext.Provider>
    );
    expect(html).toBeTruthy();
  });

  it('source: no fixed 70/20/10 money-split copy anywhere in ProfileView', () => {
    for (const banned of ['70 / 20 / 10', 'your 70%', '(70%)', '(20%)', 'protocol liquidity']) {
      expect(componentSource, `component source should not contain "${banned}"`).not.toContain(banned);
    }
  });

  it('source: "Total earned" banner label no longer states a fixed percentage split', () => {
    expect(componentSource).toContain('Total earned · your sales + royalties from forks');
    expect(componentSource).not.toContain('Total earned · your 70% + 20% from forks');
  });

  it('source: sales/lineage breakdown line drops the fixed percentages', () => {
    expect(componentSource).toMatch(/from your sales · [\s\S]{0,80}from forks of your apps/);
    expect(componentSource).not.toContain('from your sales (70%)');
    expect(componentSource).not.toContain('from forks of your apps (20%)');
  });

  it('source: Stripe payout label no longer states a fixed percentage split', () => {
    expect(componentSource).toContain('Get paid via Stripe:');
    expect(componentSource).not.toContain('Get paid via Stripe (your 70% + 20% from forks):');
  });
});
