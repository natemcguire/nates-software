import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { GitsmithView, mapCanonicalRepository } from '../src/views/GitsmithView';
import { AuthProvider } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';

describe('GITSMITH canonical repository view model', () => {
  it('maps only persisted control-plane fields and does not invent popularity or verification', () => {
    const mapped = mapCanonicalRepository({
      id: 'repo_123',
      slug: 'real-app',
      ownerUserId: 'usr_nate',
      ownerUsername: 'nate',
      visibility: 'public',
      status: 'active',
      defaultRef: 'refs/heads/main',
      defaultCommitOid: '0123456789abcdef0123456789abcdef01234567',
      forkCount: 4,
      objectFormat: 'sha1',
      updatedAt: '2026-08-29 20:00:00'
    });

    expect(mapped.source).toBe('canonical');
    expect(mapped.owner).toBe('nate');
    expect(mapped.branch).toBe('main');
    expect(mapped.lastCommit.sha).toBe('0123456789ab');
    expect(mapped.lastCommit.verified).toBe(false);
    expect(mapped.forks).toBe(4);
    expect(mapped.stars).toBeNull();
    expect(mapped.files).toEqual([]);
  });

  it('shows provisioning repositories without fabricating a ref', () => {
    const mapped = mapCanonicalRepository({
      id: 'repo_pending',
      slug: 'pending-app',
      ownerUserId: 'usr_nate',
      visibility: 'private',
      status: 'provisioning',
      defaultRef: 'refs/heads/main'
    });

    expect(mapped.lastCommit.sha).toBe('No projected ref');
    expect(mapped.status).toBe('provisioning');
    expect(mapped.visibility).toBe('private');
  });

  it('does not substitute bundled examples while the canonical forge is loading', () => {
    const html = renderToString(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(AlertProvider, null, React.createElement(GitsmithView))
      )
    );

    expect(html).toContain('LOADING CANONICAL FORGE');
    expect(html).toContain('Loading the forge');
    expect(html).toContain('SSH transport pending');
    expect(html).not.toContain('nate/dronehunter');
    expect(html).not.toContain('$35.00 / $50.00');
  });
});
