import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArtifactSandbox } from '../src/components/ArtifactSandbox';
import { AlertProvider } from '../src/context/AlertContext';
import { AuthProvider } from '../src/context/AuthContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import type { AppListing } from '../src/data/mockData';

const baseApp: AppListing = {
  id: 'buy-gate-app',
  name: 'Buy Gate App',
  tagline: 'Buy gate',
  description: 'Buy gate',
  author: 'maker',
  authorAvatar: 'B',
  version: 'v1.0.0',
  upvotes: 0,
  forkCount: 0,
  tags: [],
  screenshots: [],
  comments: [],
  price: 20,
  repositoryId: 'repo_buy_gate',
  repoSlug: 'maker/buy-gate-app',
  hasCanonicalRepo: true,
  isRepoActive: true,
  productStatus: 'active'
};

const renderApp = (app: AppListing) => renderToString(
  <AlertProvider>
    <AuthProvider>
      <CatalogProvider>
        <ArtifactSandbox app={app} />
      </CatalogProvider>
    </AuthProvider>
  </AlertProvider>
);

describe('ArtifactSandbox purchase gate', () => {
  it('enables purchase only for an active product with canonical forge source', () => {
    const html = renderApp(baseApp);
    expect(html).toContain('Purchase the listed source and license');
    expect(html).not.toContain('Showcase listing — it cannot be purchased.');
  });

  it.each([
    [{ isDemo: true }, 'Showcase listing — it cannot be purchased.'],
    [{ hasCanonicalRepo: false, repositoryId: null, repoSlug: null }, 'Source is not available on the forge yet.'],
    [{ productStatus: 'draft' as const }, 'This listing is draft and cannot be purchased yet.']
  ])('disables purchase for an unbuyable listing', (changes, reason) => {
    const html = renderApp({ ...baseApp, ...changes });
    expect(html).toContain('disabled=""');
    expect(html).toContain(reason);
  });
});
