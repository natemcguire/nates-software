import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { GitsmithView, mapCanonicalRepository } from '../src/views/GitsmithView';
import { AuthProvider } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';

describe('GITSMITH Real Repos, File Browser & Readiness Honesty', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const renderComponent = () =>
    renderToString(
      <AuthProvider>
        <AlertProvider>
          <GitsmithView />
        </AlertProvider>
      </AuthProvider>
    );

  it('initializes in loading state and does not leak bundled fixture repos by default', () => {
    const html = renderComponent();

    // Must show truthful loading message
    expect(html).toContain('LOADING CANONICAL FORGE');
    expect(html).toContain('Loading the forge');

    // Must not show bundled fixture repositories on initial render
    expect(html).not.toContain('nate/dronehunter');
    expect(html).not.toContain('nate/certified-mailer');
    expect(html).not.toContain('nate/wallart');
    expect(html).not.toContain('nate/american-gardener');
    expect(html).not.toContain('Bundled Showcase');
  });

  it('maps unpushed repositories honestly without claiming active ref readiness', () => {
    const mapped = mapCanonicalRepository({
      id: 'repo_empty',
      slug: 'brand-new-repo',
      ownerUserId: 'usr_nate',
      ownerUsername: 'nate',
      visibility: 'public',
      status: 'active',
      defaultRef: 'refs/heads/main',
      defaultCommitOid: null
    });

    expect(mapped.status).toBe('source not pushed');
    expect(mapped.lastCommit.sha).toBe('No projected ref');
    expect(mapped.lastCommit.message).toBe('Source not pushed yet');
    expect(mapped.tags).toContain('source not pushed');
    expect(mapped.description).toContain('Gateway state: source not pushed');
  });

  it('maps provisioned repositories with valid ref tip accurately', () => {
    const mapped = mapCanonicalRepository({
      id: 'repo_pushed',
      slug: 'awesome-tool',
      ownerUserId: 'usr_alice',
      ownerUsername: 'alice',
      visibility: 'public',
      status: 'active',
      defaultRef: 'refs/heads/main',
      defaultCommitOid: 'abcdef0123456789abcdef0123456789abcdef01',
      forkCount: 2
    });

    expect(mapped.status).toBe('active');
    expect(mapped.lastCommit.sha).toBe('abcdef012345');
    expect(mapped.lastCommit.message).toBe('Authoritative default-ref projection');
    expect(mapped.forks).toBe(2);
    expect(mapped.tags).toContain('active');
  });

  it('ensures synthetic README fallback is eliminated and never generated', () => {
    // Check that the legacy fallback string is nowhere in the rendered output
    const html = renderComponent();

    expect(html).not.toContain('Canonical repository metadata is loaded from the control plane');
    expect(html).not.toContain('File browsing requires a commissioned GITSMITH object gateway');
  });
});

