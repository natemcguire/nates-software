import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { GitsmithView, mapCanonicalRepository } from '../src/views/GitsmithView';
import { formatProposalStatus } from '../src/lib/inboxDomain';
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
    expect(mapped.status).toBe('active');
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
    expect(mapped.lastCommit.message).toBe('Repository provisioning');
    expect(mapped.status).toBe('provisioning');
    expect(mapped.visibility).toBe('private');
  });

  it('shows unpushed repositories as source not pushed honestly, not ready', () => {
    const mapped = mapCanonicalRepository({
      id: 'repo_empty',
      slug: 'unpushed-app',
      ownerUserId: 'usr_nate',
      ownerUsername: 'nate',
      visibility: 'public',
      status: 'active',
      defaultRef: 'refs/heads/main',
      defaultCommitOid: null
    });

    expect(mapped.lastCommit.sha).toBe('No projected ref');
    expect(mapped.lastCommit.message).toBe('Source not pushed yet');
    expect(mapped.status).toBe('source not pushed');
    expect(mapped.description).toContain('Gateway state: source not pushed');
  });

  it('does not substitute bundled examples while the canonical forge is loading', () => {
    const html = renderToString(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(AlertProvider, null, React.createElement(GitsmithView))
      )
    );

    expect(html).toContain('Loading the forge');
    expect(html).not.toContain('nate/dronehunter');
    expect(html).not.toContain('Bundled Showcase');
    expect(html).not.toContain('$35.00 / $50.00');
  });
});

describe('INBOX Ref Landing Label & Semantics Honesty', () => {
  it('reflects fast-forward landing for landed proposals', () => {
    const status = formatProposalStatus({
      id: 'msg_1',
      category: 'proposals',
      from: 'Alice',
      fromAvatar: '👩‍💻',
      subject: 'Feature',
      time: 'now',
      body: 'Feature description',
      unread: false,
      featureRef: 'refs/heads/feature',
      isMerged: true,
      mergeStatus: 'landed'
    });

    expect(status.badgeLabel).toBe('Landed · Fast-forward landed by GITSMITH');
    expect(status.description).toContain('fast-forward landing');
    expect(status.isFastForward).toBe(true);
  });

  it('reflects fast-forward compare-and-swap for open landable proposals', () => {
    const status = formatProposalStatus({
      id: 'msg_2',
      category: 'proposals',
      from: 'Alice',
      fromAvatar: '👩‍💻',
      subject: 'Feature',
      time: 'now',
      body: 'Feature description',
      unread: false,
      featureRef: 'refs/heads/feature',
      mergeAttemptId: 'attempt_1',
      mergeStatus: 'preview_ready',
      approvalStatus: 'unreviewed'
    });

    expect(status.badgeLabel).toBe('Open · Fast-forward landable');
    expect(status.description).toContain('fast-forward compare-and-swap');
    expect(status.canApprove).toBe(true);
    expect(status.isFastForward).toBe(true);
  });
});
