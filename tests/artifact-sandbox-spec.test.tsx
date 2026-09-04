import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { MarkdownRenderer } from '../src/components/MarkdownRenderer';
import { ArtifactSandbox } from '../src/components/ArtifactSandbox';
import { AuthProvider } from '../src/context/AuthContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { AlertProvider } from '../src/context/AlertContext';
import { AppListing } from '../src/data/mockData';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

    expect(html).toContain('Live App');
    expect(html).toContain('Spec');
    expect(html).toContain('Shots');
    expect(html).toContain('Comments');
    expect(html).toContain('btn-w95');
  });

  describe('NSW-59: Spec tab falls back to README.md when spec.md is missing', () => {
    // activeTab defaults to 'preview' with no prop to force 'spec', so the spec
    // tab's JSX (including the empty-state copy) is never in a plain SSR render
    // tree — assert on source content instead, same pattern as
    // tests/money-model-copy-sweep.test.ts uses for other copy sweeps.
    const source = readFileSync(path.join(repoRoot, 'src/components/ArtifactSandbox.tsx'), 'utf-8');

    it('empty-state copy mentions BOTH spec.md and README.md, not spec.md alone', () => {
      expect(source).toContain('No Idea Specification Found');
      expect(source).toMatch(/does not have a <code>spec\.md<\/code> or <code>README\.md<\/code> committed/);
      expect(source).toMatch(/Commit either file to the main branch/);
      // the old copy singled out spec.md as the only committable fix; that's no longer true
      expect(source).not.toContain('Commit a <code>spec.md</code> to the main branch');
    });

    it('source: spec-tab loader tries spec.md first, then falls back to README.md on 404, and only clears content when BOTH 404', () => {
      expect(source).toContain("tryLoad('spec.md')");
      expect(source).toContain("tryLoad('README.md')");
      expect(source).toMatch(/specResult\s*!==\s*'not_found'/);
      expect(source).toContain("readmeResult === 'not_found'");
    });
  });

  describe('NSW-56: Lineage DAG modal de-jargoned', () => {
    // showLineageModal starts false and only flips true on a click, which SSR
    // (renderToString) cannot simulate — so the modal's own JSX isn't in the
    // default render tree. Assert on source content, same pattern as
    // tests/money-model-copy-sweep.test.ts uses for other copy sweeps.
    const source = readFileSync(path.join(repoRoot, 'src/components/ArtifactSandbox.tsx'), 'utf-8');

    it('renamed the modal title from "Immutable Lineage DAG" to "Fork family tree"', () => {
      expect(source).not.toContain('Immutable Lineage DAG');
      expect(source).toContain('Fork family tree');
    });

    it('renamed "Root Author" to "Original maker"', () => {
      expect(source).not.toContain('Root Author');
      expect(source).toContain('Original maker');
    });

    it('replaced hardcoded "Lineage Ancestry Depth: Genesis (Generation 0)" with a plain-English, depth-aware line', () => {
      expect(source).not.toContain('Lineage Ancestry Depth');
      expect(source).not.toContain('Genesis (Generation 0)');
      expect(source).toContain('This is an original — nobody upstream');
      expect(source).toContain('Built on ${app.forkDepth} app');
    });

    it('renamed "N Registered Forks" to "Forks so far: N"', () => {
      expect(source).not.toContain('Registered Forks');
      expect(source).toContain('Forks so far: {app.forkCount}');
    });

    it('kept the "How a sale splits" paragraph verbatim', () => {
      expect(source).toContain('How a sale splits');
      expect(source).toContain(
        "sells their version, and the money splits on its own: <strong>10%</strong> to the platform, @{app.author || app.creator} earns the royalty they set for building the original (frozen at fork time), and whoever sold it keeps the rest."
      );
    });

    it('DAG-view close button now reads plain "Close"', () => {
      expect(source).not.toContain('Close DAG View');
      expect(source).toMatch(/>\s*Close\s*<\/button>/);
    });
  });

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
