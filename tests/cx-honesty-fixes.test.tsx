// Codex external review findings #6, #8, #9 (spec-CX-honesty):
//   #6 Orphaned PaymentIntent recovery — covered in commerce-create-intent.test.ts
//      (see "6B. Orphaned PaymentIntent recovery on 'creating' retry").
//   #8 HOTWIRE must never render fabricated "Verified Maker" profiles on the
//      real production surface.
//   #9 Logged-out UI must never impersonate @nate; it must show @guest / a
//      not-signed-in state until a real authenticated session exists.
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AuthContext, AuthUser } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { HotwireView } from '../src/views/HotwireView';
import { SlopshopView } from '../src/views/SlopshopView';
import { MarketingWindow } from '../src/views/MarketingWindow';
import { generateFeatureManifest } from '../src/lib/slopshopDomain';
import * as mockData from '../src/data/mockData';

const mockUser: AuthUser = {
  id: 'usr_alice123',
  username: 'alice_maker',
  displayName: 'Alice Maker',
  avatar: '👩‍💻',
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

const noop = () => {};

describe('Codex #8: HOTWIRE never ships fabricated "Verified Maker" profiles', () => {
  it('no longer exports a fabricated MAKER_PROFILES fixture from mockData', () => {
    // The fabricated fixture (invented streak days, fork counts, and an
    // unrelated real person's name presented as a "verified" account) has
    // been removed entirely from the production data module.
    expect((mockData as any).MAKER_PROFILES).toBeUndefined();
  });

  it('renders an honest offline/unavailable maker leaderboard instead of synthetic profiles when the live catalog is not authoritative', () => {
    const originalFetch = globalThis.fetch;
    // Force the catalog fetch to fail so CatalogProvider sets isAuthoritativeLive=false
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network unreachable'));

    let html = '';
    try {
      html = renderToString(
        <AlertProvider>
          <AuthContext.Provider value={createMockAuthContext(null)}>
            <CatalogProvider>
              <HotwireView />
            </CatalogProvider>
          </AuthContext.Provider>
        </AlertProvider>
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    // No fabricated maker names, invented streak badges, or fake bios ever render.
    expect(html).not.toContain('Sam Altman');
    expect(html).not.toContain('Streak Champion');
    expect(html).not.toContain('Master Builder');
    expect(html).not.toContain('Marine telemetry engineer');
    expect(html).not.toContain('Open source enthusiast and WASM accounting hacker');
    expect(html).not.toContain('Demo / Seed Profiles');
  });
});

describe('Codex #9: logged-out UI shows @guest, never impersonates @nate', () => {
  it('MarketingWindow "My Profile" badge shows @guest when logged out, never @nate', () => {
    const html = renderToString(
      <AuthContext.Provider value={createMockAuthContext(null)}>
        <MarketingWindow
          onOpenHotwire={noop}
          onOpenSlopshop={noop}
          onOpenRig={noop}
          onOpenGitsmith={noop}
          onOpenInbox={noop}
          onOpenProfile={noop}
          onOpenWhitepapers={noop}
          onDismiss={noop}
        />
      </AuthContext.Provider>
    );

    expect(html).not.toContain('@nate');
    expect(html).toContain('@guest');
  });

  it('MarketingWindow shows the real authenticated handle when logged in', () => {
    const html = renderToString(
      <AuthContext.Provider value={createMockAuthContext(mockUser)}>
        <MarketingWindow
          onOpenHotwire={noop}
          onOpenSlopshop={noop}
          onOpenRig={noop}
          onOpenGitsmith={noop}
          onOpenInbox={noop}
          onOpenProfile={noop}
          onOpenWhitepapers={noop}
          onDismiss={noop}
        />
      </AuthContext.Provider>
    );

    expect(html).toContain('@alice_maker');
    expect(html).not.toContain('@guest');
  });

  it('SlopshopView draft maker handle defaults to @guest (not @nate) when logged out', () => {
    const html = renderToString(
      <AuthContext.Provider value={createMockAuthContext(null)}>
        <AlertProvider>
          <SlopshopView />
        </AlertProvider>
      </AuthContext.Provider>
    );

    expect(html).toContain('value="@guest"');
    expect(html).not.toContain('value="@nate"');
  });

  it('generateFeatureManifest defaults to @guest, not @nate, when no maker handle is supplied', () => {
    const manifest = generateFeatureManifest({
      coordinate: { appId: 'dronehunter', repoOwner: 'guest', repoSlug: 'dronehunter' } as any,
      feature: { id: 'test-feature', name: 'Test Feature', prompt: 'do the thing' } as any,
      agent: 'agy'
    });

    expect(JSON.stringify(manifest)).not.toContain('@nate');
  });
});
