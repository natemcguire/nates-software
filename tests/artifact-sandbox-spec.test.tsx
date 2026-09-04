import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { MarkdownRenderer } from '../src/components/MarkdownRenderer';
import { ArtifactSandbox } from '../src/components/ArtifactSandbox';
import { AuthProvider } from '../src/context/AuthContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { AlertProvider } from '../src/context/AlertContext';
import { AppListing } from '../src/data/mockData';

describe('Marketplace Phase C-render: Markdown & ArtifactSandbox UI', () => {
  const sampleApp: AppListing = {
    id: 'custom-idea',
    name: 'DroneHunter 95',
    tagline: 'Retro Duck Hunt Arcade Game',
    description: 'Arcade browser game',
    author: 'nate',
    authorAvatar: '🎯',
    version: 'v1.0.0',
    upvotes: 42,
    forkCount: 3,
    tags: ['Games', 'Shareware'],
    screenshots: ['screenshots/hero.png', 'https://example.com/shot2.jpg'],
    comments: [],
    repositoryId: 'repo_dronehunter_123',
    repoSlug: 'nate/dronehunter',
    hasCanonicalRepo: true,
    isRepoActive: true
  };

  const renderSandbox = (app: AppListing = sampleApp) =>
    renderToString(
      <AlertProvider>
        <AuthProvider>
          <CatalogProvider>
            <ArtifactSandbox app={app} />
          </CatalogProvider>
        </AuthProvider>
      </AlertProvider>
    );

  it('MarkdownRenderer safely converts Markdown to formatted HTML', () => {
    const md = '# Idea Pitch\n\n**Revenue share:** 50% up for grabs.\n\n- Feature 1\n- Feature 2\n\n[Docs](https://nates.software)';
    const html = renderToString(<MarkdownRenderer content={md} />);

    expect(html).toContain('<h1');
    expect(html).toContain('Idea Pitch</h1>');
    expect(html).toContain('<strong>Revenue share:</strong>');
    expect(html).toContain('<li>Feature 1</li>');
    expect(html).toContain('<li>Feature 2</li>');
    expect(html).toContain('href="https://nates.software"');
  });

  it('ArtifactSandbox renders the "Spec" tab with Win95 aesthetic', () => {
    const html = renderSandbox();

    // Verify Tab Switcher contains Live App, Spec, Shots, Comments
    expect(html).toContain('Live App');
    expect(html).toContain('Spec');
    expect(html).toContain('Shots');
    expect(html).toContain('Comments');
    expect(html).toContain('btn-w95');
  });

  // The contributor-grant CREATE surface (publish-time grantable_bps input,
  // grant-recording at merge-approve) was removed when contributors were
  // dropped from the money model. grantable_bps itself remains a historical
  // column — apps with a pre-existing nonzero value still render this
  // read-only badge; new drops never set it, so it never appears for them.
  describe('legacy grantable_bps badge (read-only historical display)', () => {
    const badgeBaseApp: AppListing = {
      id: 'app_test_badge',
      name: 'Badge Test App',
      tagline: 'Testing contributor upside badge',
      description: 'Long description',
      author: 'nate',
      authorAvatar: '🎯',
      version: 'v1.0.0',
      upvotes: 10,
      forkCount: 2,
      tags: ['Utility'],
      screenshots: ['https://example.com/shot.png'],
      comments: [],
      price: 15
    };

    it('renders the "Up to 90% of every sale available to contributors" badge when grantable_bps is 9000', () => {
      const html = renderSandbox({ ...badgeBaseApp, grantable_bps: 9000, grantableBps: 8000 });
      expect(html).toContain('Up to 90% of every sale available to contributors');
    });

    it('renders the "Up to 50% of every sale available to contributors" badge when grantable_bps is 5000', () => {
      const html = renderSandbox({ ...badgeBaseApp, grantable_bps: 5000, grantableBps: 5000 });
      expect(html).toContain('Up to 50% of every sale available to contributors');
    });

    it('does NOT render the contributor upside badge when grantable_bps is 0 or undefined', () => {
      const html = renderSandbox({ ...badgeBaseApp, grantable_bps: 0, grantableBps: 0 });
      expect(html).not.toContain('available to contributors');
    });
  });
});
