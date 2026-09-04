import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AuthContext, AuthUser } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { HotwireView } from '../src/views/HotwireView';
import { SlopshopView } from '../src/views/SlopshopView';
import { generateFeatureManifest } from '../src/lib/slopshopDomain';
import * as mockData from '../src/data/mockData';

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


describe('Codex #8: HOTWIRE never ships fabricated "Verified Maker" profiles', () => {
  it('no longer exports a fabricated MAKER_PROFILES fixture from mockData', () => {
    expect((mockData as any).MAKER_PROFILES).toBeUndefined();
  });

  it('renders an honest offline/unavailable maker leaderboard instead of synthetic profiles when the live catalog is not authoritative', () => {
    const originalFetch = globalThis.fetch;
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

    expect(html).not.toContain('Sam Altman');
    expect(html).not.toContain('Streak Champion');
    expect(html).not.toContain('Master Builder');
    expect(html).not.toContain('Marine telemetry engineer');
    expect(html).not.toContain('Open source enthusiast and WASM accounting hacker');
    expect(html).not.toContain('Demo / Seed Profiles');
  });
});

describe('Codex #9: logged-out UI shows @guest, never impersonates @nate', () => {
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
