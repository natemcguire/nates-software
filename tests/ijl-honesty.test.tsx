import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { TerminalView } from '../src/views/TerminalView';
import { ArtifactSandbox } from '../src/components/ArtifactSandbox';
import { EphemeralLiveApp } from '../src/components/EphemeralLiveApp';
import { AuthProvider, AuthContext, AuthContextType } from '../src/context/AuthContext';
import { CatalogProvider } from '../src/context/CatalogContext';
import { AlertProvider } from '../src/context/AlertContext';
import { AppListing } from '../src/data/mockData';

const mockUser = {
  id: 'usr_test_123',
  username: 'nate',
  displayName: 'Nate McGuire',
  avatar: '🎯',
  role: 'maker' as const,
  isSuperAdmin: true,
  createdAt: '2026-08-01T00:00:00Z'
};

function createMockAuthValue(user: any = mockUser): AuthContextType {
  return {
    user,
    isAuthenticated: Boolean(user),
    isSuperAdmin: Boolean(user?.isSuperAdmin),
    isAuthModalOpen: false,
    authModalTab: 'login' as const,
    login: vi.fn().mockResolvedValue({ success: true }),
    register: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue(undefined),
    openAuthModal: vi.fn(),
    closeAuthModal: vi.fn(),
    requireAuth: vi.fn((_desc, cb) => cb())
  };
}

describe('Spec I: TERMINAL Honesty', () => {
  it('renders local mode as a command guide & emulator with canned responses notices', () => {
    const html = renderToString(
      <AuthContext.Provider value={createMockAuthValue(mockUser)}>
        <TerminalView />
      </AuthContext.Provider>
    );

    expect(html).toContain('TERMINAL.EXE');
    expect(html).toContain('Switch to Command Guide / Emulator');
    expect(html).toContain('Command Guide &amp; Emulator');
    expect(html).toContain('canned responses');
    expect(html).toContain('no filesystem or process execution');
  });

  it('renders honest real terminal offline banner when gateway is not connected', () => {
    const html = renderToString(
      <AuthContext.Provider value={createMockAuthValue(mockUser)}>
        <TerminalView />
      </AuthContext.Provider>
    );

    expect(html).toContain('Ephemeral Terminal');
  });
});

describe('Spec L: Synthesized-link Fix in ArtifactSandbox', () => {
  const draftApp: AppListing = {
    id: 'my-draft-app',
    name: 'My Draft App',
    tagline: 'A draft app without active hosting',
    description: 'Work in progress',
    author: 'nate',
    authorAvatar: '⚡',
    version: 'v0.1.0',
    upvotes: 5,
    forkCount: 1,
    tags: ['Tools'],
    screenshots: [],
    comments: [],
    deploymentState: 'draft'
  };

  const activeApp: AppListing = {
    id: 'my-active-app',
    name: 'My Active App',
    tagline: 'A live app with verified host',
    description: 'Fully deployed',
    author: 'nate',
    authorAvatar: '🚀',
    version: 'v1.0.0',
    upvotes: 42,
    forkCount: 10,
    tags: ['Web'],
    screenshots: [],
    comments: [],
    deploymentState: 'active',
    activeDeploymentId: 'drev_123',
    liveUrl: 'https://my-active-app.custom-domain.com'
  };

  it('does NOT render synthesized subdomain link for draft app; renders deployment status', () => {
    const html = renderToString(
      <AlertProvider>
        <AuthProvider>
          <CatalogProvider>
            <ArtifactSandbox app={draftApp} />
          </CatalogProvider>
        </AuthProvider>
      </AlertProvider>
    );

    expect(html).not.toContain('href="https://my-draft-app.nates-software.com"');
    expect(html).toContain('Deployment status:');
    expect(html).toContain('draft');
    expect(html).toContain('Draft (Unpublished)');
    expect(html).toContain('Not yet published');
  });

  it('renders authoritative live URL for app with active deployment', () => {
    const html = renderToString(
      <AlertProvider>
        <AuthProvider>
          <CatalogProvider>
            <ArtifactSandbox app={activeApp} />
          </CatalogProvider>
        </AuthProvider>
      </AlertProvider>
    );

    expect(html).toContain('href="https://my-active-app.custom-domain.com"');
    expect(html).toContain('Open in New Window');
    expect(html).toContain('Launch Live App');
  });

  it('does not contain dead showAiModal legacy workflow with hardcoded github clones', () => {
    const html = renderToString(
      <AlertProvider>
        <AuthProvider>
          <CatalogProvider>
            <ArtifactSandbox app={draftApp} />
          </CatalogProvider>
        </AuthProvider>
      </AlertProvider>
    );

    expect(html).not.toContain('Local AI Agent Workflow ·');
    expect(html).not.toContain('github.com/natemcguire/my-draft-app.git');
  });
});

describe('Deployment-error surface does not leak a raw build stack trace', () => {
  const failedApp: AppListing = {
    id: 'broken-app',
    name: 'Broken App',
    tagline: 'A build that failed',
    description: 'Deploy blew up',
    author: 'nate',
    authorAvatar: '💥',
    version: 'v0.1.0',
    upvotes: 0,
    forkCount: 0,
    tags: ['Tools'],
    screenshots: [],
    comments: [],
    deploymentState: 'failed',
    deploymentError:
      'vinext: not found\n  at spawn (node:child_process:1234)\n  at buildStep (/workspace/build.js:88)\n  at async run (/workspace/build.js:200)'
  };

  it('shows only the first line of a multi-line build error, not the full trace', () => {
    const html = renderToString(
      <AlertProvider>
        <AuthProvider>
          <CatalogProvider>
            <EphemeralLiveApp app={failedApp} />
          </CatalogProvider>
        </AuthProvider>
      </AlertProvider>
    );
    expect(html).toContain('vinext: not found');
    expect(html).not.toContain('at spawn (node:child_process');
    expect(html).not.toContain('/workspace/build.js');
  });
});
