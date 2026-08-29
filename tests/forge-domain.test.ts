import { describe, expect, it } from 'vitest';
import {
  canTransitionMergeJob,
  isCasRefUpdateValid,
  refPatternMatches,
  repositoryRoleAllows,
  selectRefPolicy,
  validateForkOrigin,
  validateRepositorySlug,
  isValidRepositorySlug,
  validateGitOid,
  isValidGitOid,
  isGitOidCompatibleWithObjectFormat,
  validateGitRef,
  isValidGitRef,
  buildRepositoryStorageKey,
  constantTimeTokenCompare
} from '../src/lib/forgeDomain';

const oid = 'a'.repeat(40);
const nextOid = 'b'.repeat(40);
const sha256Oid = 'c'.repeat(64);

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

  it('validates repository slugs correctly (lowercase only)', () => {
    expect(isValidRepositorySlug('my-cool-app')).toBe(true);
    expect(isValidRepositorySlug('wallart_pro.v2')).toBe(true);
    expect(isValidRepositorySlug('app123')).toBe(true);

    // Uppercase rejected
    expect(isValidRepositorySlug('App123')).toBe(false);
    expect(validateRepositorySlug('App123').valid).toBe(false);
    expect(isValidRepositorySlug('MyRepo')).toBe(false);

    expect(validateRepositorySlug('').valid).toBe(false);
    expect(validateRepositorySlug('-leading-dash').valid).toBe(false);
    expect(validateRepositorySlug('.leading-dot').valid).toBe(false);
    expect(validateRepositorySlug('trailing-dot.').valid).toBe(false);
    expect(validateRepositorySlug('repo.git').valid).toBe(false);
    expect(validateRepositorySlug('repo.lock').valid).toBe(false);
    expect(validateRepositorySlug('repo..double-dot').valid).toBe(false);
    expect(validateRepositorySlug('has spaces').valid).toBe(false);
  });

  it('validates full 40-char SHA-1 and 64-char SHA-256 Git OIDs', () => {
    expect(isValidGitOid(oid)).toBe(true);
    expect(isValidGitOid(sha256Oid)).toBe(true);
    expect(validateGitOid(oid).valid).toBe(true);
    expect(validateGitOid(sha256Oid).valid).toBe(true);

    expect(isValidGitOid('5c030af')).toBe(false); // short SHA rejected
    expect(validateGitOid('5c030af').valid).toBe(false);
    expect(isValidGitOid('not-a-sha-hash')).toBe(false);
    expect(validateGitOid('not-a-sha-hash').valid).toBe(false);
    expect(isValidGitOid('')).toBe(false);
    expect(validateGitOid('').valid).toBe(false);
    expect(isValidGitOid(null)).toBe(false);
    expect(validateGitOid(null).valid).toBe(false);
    expect(isGitOidCompatibleWithObjectFormat(oid, 'sha1')).toBe(true);
    expect(isGitOidCompatibleWithObjectFormat(sha256Oid, 'sha256')).toBe(true);
    expect(isGitOidCompatibleWithObjectFormat(sha256Oid, 'sha1')).toBe(false);
  });

  it('validates canonical Git ref paths', () => {
    expect(isValidGitRef('refs/heads/main')).toBe(true);
    expect(validateGitRef('refs/heads/main').valid).toBe(true);
    expect(validateGitRef('refs/heads/main').namespace).toBe('refs/heads');
    expect(isValidGitRef('refs/heads/feature/branch-1')).toBe(true);
    expect(isValidGitRef('refs/tags/v1.0.0')).toBe(true);

    expect(isValidGitRef('heads/main')).toBe(false);
    expect(validateGitRef('heads/main').valid).toBe(false);
    expect(isValidGitRef('refs/heads/')).toBe(false);
    expect(isValidGitRef('refs/heads/main.lock')).toBe(false);
    expect(isValidGitRef('refs/heads//main')).toBe(false);
    expect(isValidGitRef('refs/heads/main..test')).toBe(false);
    expect(isValidGitRef('refs/heads/has space')).toBe(false);
  });

  it('generates immutable id-based storage keys', () => {
    expect(buildRepositoryStorageKey('repo_12345')).toBe('repositories/repo_12345');
    expect(() => buildRepositoryStorageKey('')).toThrow();
  });

  it('performs constant-time token comparisons safely', () => {
    expect(constantTimeTokenCompare('secret_token_123', 'secret_token_123')).toBe(true);
    expect(constantTimeTokenCompare('secret_token_123', 'secret_token_456')).toBe(false);
    expect(constantTimeTokenCompare('short', 'much_longer_token')).toBe(false);
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
