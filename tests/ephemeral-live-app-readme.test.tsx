import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { EphemeralLiveApp } from '../src/components/EphemeralLiveApp';
import { AppListing } from '../src/data/mockData';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('NSW-55: Live Sandbox for source_ready repos renders the README', () => {
  const baseApp: AppListing = {
    id: 'app_readme_test',
    name: 'README Test App',
    tagline: 'Testing honest sandbox README rendering',
    description: 'Long description',
    author: 'nate',
    authorAvatar: '🎯',
    version: 'v1.0.0',
    upvotes: 0,
    forkCount: 0,
    tags: ['Utility'],
    screenshots: [],
    comments: [],
    deploymentState: 'source_ready',
    hasCanonicalRepo: true,
    repoSlug: 'nate/readme-test-app',
    repositoryId: 'repo_readme_test'
  };

  it('shows the honest deployment surface (not an iframe) for source_ready with no live URL', () => {
    const html = renderToString(<EphemeralLiveApp app={baseApp} />);

    expect(html).toContain('honest-deployment-surface');
    expect(html).not.toContain('<iframe');
  });

  it('renders the README panel container (pre-fetch SSR state: not-yet-fetched) when the listing has a linked repository', () => {
    const html = renderToString(<EphemeralLiveApp app={baseApp} />);

    expect(html).toContain('sandbox-readme-block');
    expect(html).toContain('README ·');
    expect(html).toContain(baseApp.repoSlug!);
    // useEffect never runs during renderToString, and readmeLoading's own
    // useState initial value is false (only flipped true inside the effect),
    // so SSR exposes the pre-fetch "nothing loaded yet" branch, not "loading".
    expect(html).toContain('readme-unavailable');
    expect(html).toContain('No README.md found in this repository.');
  });

  it('still renders the deployment lifecycle metadata block alongside the README panel', () => {
    const html = renderToString(<EphemeralLiveApp app={baseApp} />);

    expect(html).toContain('DEPLOYMENT LIFECYCLE');
    expect(html).toContain('deployment-evidence-box');
    expect(html).toContain('Awaiting repository intake');
  });

  it('does NOT render the README panel when the listing has no linked repository', () => {
    const noRepoApp: AppListing = {
      ...baseApp,
      hasCanonicalRepo: false,
      repoSlug: null,
      repositoryId: null
    };
    const html = renderToString(<EphemeralLiveApp app={noRepoApp} />);

    expect(html).not.toContain('sandbox-readme-block');
    expect(html).toContain('honest-deployment-surface');
  });

  it('does NOT render the README panel when the deployment is actually live (iframe branch)', () => {
    const liveApp: AppListing = {
      ...baseApp,
      deploymentState: 'active',
      activeDeploymentId: 'dep_123',
      liveUrl: 'https://readme-test-app.nates-software.com'
    };
    const html = renderToString(<EphemeralLiveApp app={liveApp} />);

    expect(html).toContain('<iframe');
    expect(html).not.toContain('sandbox-readme-block');
  });

  describe('source: fetch shape matches the documented /api/repo-file interface (owner+slug, same-origin GET)', () => {
    const source = readFileSync(path.join(repoRoot, 'src/components/EphemeralLiveApp.tsx'), 'utf-8');

    it('builds the README request from owner=<handle>&slug=<slug>&path=README.md', () => {
      expect(source).toContain('/api/repo-file?owner=');
      expect(source).toContain('&slug=');
      expect(source).toContain("path=${encodeURIComponent('README.md')}");
    });

    it('treats a 200 response body as raw markdown text (matches repo-file.ts, which returns raw bytes, not {content} JSON)', () => {
      expect(source).toMatch(/res\.ok[\s\S]{0,80}res\.text\(\)/);
    });

    it('fails honestly on a non-ok response or thrown error, without fabricating content', () => {
      expect(source).toContain('setReadmeUnavailable(true)');
      expect(source).toContain('README unavailable.');
    });

    it('reuses the shared MarkdownRenderer component to render fetched README content', () => {
      expect(source).toContain("import { MarkdownRenderer } from './MarkdownRenderer';");
      expect(source).toContain('<MarkdownRenderer content={readmeContent} />');
    });
  });
});
