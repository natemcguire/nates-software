import { describe, expect, it } from 'vitest';
import {
  canTransitionMergeJob,
  isCasRefUpdateValid,
  refPatternMatches,
  repositoryRoleAllows,
  selectRefPolicy,
  validateForkOrigin
} from '../src/lib/forgeDomain';

const oid = 'a'.repeat(40);
const nextOid = 'b'.repeat(40);

describe('canonical forge domain invariants', () => {
  it('accepts an immutable, full-OID fork origin', () => {
    expect(validateForkOrigin({
      childRepositoryId: 'repo_child',
      parentRepositoryId: 'repo_parent',
      parentRefName: 'refs/heads/main',
      parentCommitOid: oid,
      childInitialCommitOid: oid,
      lineageRootRepositoryId: 'repo_root',
      depth: 2
    })).toEqual([]);
  });

  it('rejects self-forks, abbreviated OIDs, and invalid depths', () => {
    const errors = validateForkOrigin({
      childRepositoryId: 'repo_same',
      parentRepositoryId: 'repo_same',
      parentRefName: 'main',
      parentCommitOid: 'abc1234',
      childInitialCommitOid: 'def5678',
      lineageRootRepositoryId: '',
      depth: 0
    });
    expect(errors).toHaveLength(6);
  });

  it('requires the persisted current OID to match the expected OID', () => {
    expect(isCasRefUpdateValid({ currentOid: oid, expectedOldOid: oid, newOid: nextOid })).toBe(true);
    expect(isCasRefUpdateValid({ currentOid: nextOid, expectedOldOid: oid, newOid: nextOid })).toBe(false);
    expect(isCasRefUpdateValid({ currentOid: oid, expectedOldOid: oid, newOid: oid })).toBe(false);
  });

  it('allows retryable workflow transitions but keeps terminal states terminal', () => {
    expect(canTransitionMergeJob('queued', 'preparing')).toBe(true);
    expect(canTransitionMergeJob('preview_ready', 'landing')).toBe(true);
    expect(canTransitionMergeJob('stale', 'queued')).toBe(true);
    expect(canTransitionMergeJob('landed', 'queued')).toBe(false);
    expect(canTransitionMergeJob('cancelled', 'running')).toBe(false);
  });

  it('enforces repository roles without giving writers policy administration', () => {
    expect(repositoryRoleAllows('reader', 'read')).toBe(true);
    expect(repositoryRoleAllows('writer', 'push')).toBe(true);
    expect(repositoryRoleAllows('writer', 'manage_refs')).toBe(false);
    expect(repositoryRoleAllows('owner', 'manage_members')).toBe(true);
  });

  it('selects the most specific matching ref policy', () => {
    const broad = {
      refPattern: 'refs/heads/*',
      requireSignedCommits: false,
      requirePassingBuild: true,
      minimumApprovals: 0,
      allowForcePush: false,
      allowDelete: false
    };
    const main = { ...broad, refPattern: 'refs/heads/main', minimumApprovals: 2 };
    expect(refPatternMatches(broad.refPattern, 'refs/heads/topic')).toBe(true);
    expect(selectRefPolicy([broad, main], 'refs/heads/main')).toEqual(main);
  });
});
