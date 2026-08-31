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
});
