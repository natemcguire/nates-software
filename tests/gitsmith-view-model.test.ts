import { describe, expect, it } from 'vitest';
import { mapCanonicalRepository } from '../src/views/GitsmithView';

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
});
