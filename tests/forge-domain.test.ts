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
  constantTimeTokenCompare,
  isValidRefPolicyEntry,
  isValidRefPolicies
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

  it('selects the most specific matching ref policy regardless of input order', () => {
    const broadAllow = {
      refPattern: 'refs/heads/*',
      requireSignedCommits: false,
      requirePassingBuild: true,
      minimumApprovals: 0,
      allowForcePush: true,
      allowDelete: true
    };
    const specificDeny = {
      refPattern: 'refs/heads/release/*',
      requireSignedCommits: false,
      requirePassingBuild: true,
      minimumApprovals: 1,
      allowForcePush: false,
      allowDelete: false
    };
    const exactMain = {
      refPattern: 'refs/heads/main',
      requireSignedCommits: true,
      requirePassingBuild: true,
      minimumApprovals: 2,
      allowForcePush: false,
      allowDelete: false
    };
    const exactRelease10 = {
      refPattern: 'refs/heads/release/1.0',
      requireSignedCommits: true,
      requirePassingBuild: true,
      minimumApprovals: 3,
      allowForcePush: false,
      allowDelete: false
    };

    // Pattern matches
    expect(refPatternMatches(broadAllow.refPattern, 'refs/heads/topic')).toBe(true);
    expect(refPatternMatches(specificDeny.refPattern, 'refs/heads/release/1.0')).toBe(true);
    expect(refPatternMatches(specificDeny.refPattern, 'refs/heads/feature/xyz')).toBe(false);

    // Overlapping: broad allow + specific deny -> specific deny wins regardless of array/D1 row order
    expect(selectRefPolicy([broadAllow, specificDeny], 'refs/heads/release/1.0')).toEqual(specificDeny);
    expect(selectRefPolicy([specificDeny, broadAllow], 'refs/heads/release/1.0')).toEqual(specificDeny);

    // Exact match wins over prefix wildcard regardless of array order
    expect(selectRefPolicy([broadAllow, exactMain], 'refs/heads/main')).toEqual(exactMain);
    expect(selectRefPolicy([exactMain, broadAllow], 'refs/heads/main')).toEqual(exactMain);

    // Exact match on release branch wins over release wildcard and broad wildcard
    expect(selectRefPolicy([broadAllow, specificDeny, exactRelease10], 'refs/heads/release/1.0')).toEqual(exactRelease10);
    expect(selectRefPolicy([exactRelease10, broadAllow, specificDeny], 'refs/heads/release/1.0')).toEqual(exactRelease10);

    // Non-overlapping case: single matching policy honored
    expect(selectRefPolicy([specificDeny], 'refs/heads/release/2.0')).toEqual(specificDeny);
    expect(selectRefPolicy([specificDeny], 'refs/heads/feature/foo')).toBeNull();
    expect(selectRefPolicy([broadAllow], 'refs/heads/feature/foo')).toEqual(broadAllow);

    // Conservative tie-breaking when patterns are identical: deny wins over allow
    const duplicatePatternAllow = { ...broadAllow, refPattern: 'refs/heads/feature/*' };
    const duplicatePatternDeny = { ...specificDeny, refPattern: 'refs/heads/feature/*' };
    expect(selectRefPolicy([duplicatePatternAllow, duplicatePatternDeny], 'refs/heads/feature/abc')).toEqual(duplicatePatternDeny);
    expect(selectRefPolicy([duplicatePatternDeny, duplicatePatternAllow], 'refs/heads/feature/abc')).toEqual(duplicatePatternDeny);
  });

  it('combines equal-specificity policies per operation with deny-wins semantics', () => {
    const policyA = {
      refPattern: 'main',
      allowForcePush: true,
      allowDelete: false,
      requireSignedCommits: false,
      requirePassingBuild: false,
      minimumApprovals: 0
    };
    const policyB = {
      refPattern: 'refs/heads/main',
      allowForcePush: false,
      allowDelete: true,
      requireSignedCommits: false,
      requirePassingBuild: false,
      minimumApprovals: 0
    };

    // Equal specificity: 'main' vs 'refs/heads/main' -> deny wins for BOTH force-push and delete
    const result = selectRefPolicy([policyA, policyB], 'refs/heads/main');
    expect(result).not.toBeNull();
    expect(result?.allowForcePush).toBe(false);
    expect(result?.allowDelete).toBe(false);

    // Reversed input order produces identical deny-wins result
    const resultReversed = selectRefPolicy([policyB, policyA], 'refs/heads/main');
    expect(resultReversed).not.toBeNull();
    expect(resultReversed?.allowForcePush).toBe(false);
    expect(resultReversed?.allowDelete).toBe(false);

    // Strictest requirements also win in equal-specificity merge
    const policyC = {
      refPattern: 'main',
      allowForcePush: true,
      allowDelete: true,
      requireSignedCommits: true,
      requirePassingBuild: false,
      minimumApprovals: 3
    };
    const policyD = {
      refPattern: 'refs/heads/main',
      allowForcePush: true,
      allowDelete: true,
      requireSignedCommits: false,
      requirePassingBuild: true,
      minimumApprovals: 1
    };
    const strictResult = selectRefPolicy([policyC, policyD], 'refs/heads/main');
    expect(strictResult).not.toBeNull();
    expect(strictResult?.requireSignedCommits).toBe(true);
    expect(strictResult?.requirePassingBuild).toBe(true);
    expect(strictResult?.minimumApprovals).toBe(3);
    expect(strictResult?.allowForcePush).toBe(true);
    expect(strictResult?.allowDelete).toBe(true);
  });

  it('validates ref policy entries and ref policy lists strictly', () => {
    const completeEntry = {
      refPattern: 'refs/heads/main',
      allowForcePush: false,
      allowDelete: false,
      requireSignedCommits: false,
      requirePassingBuild: false,
      minimumApprovals: 0
    };
    expect(isValidRefPolicyEntry(completeEntry)).toBe(true);
    expect(isValidRefPolicyEntry({ ...completeEntry, allowForcePush: true, allowDelete: 0 })).toBe(true);
    expect(isValidRefPolicyEntry({ ...completeEntry, allowForcePush: 1, allowDelete: false })).toBe(true);
    expect(isValidRefPolicyEntry({ ...completeEntry, requireSignedCommits: 1, requirePassingBuild: true, minimumApprovals: 2 })).toBe(true);

    // Incomplete entries (missing any required column) must fail closed
    expect(isValidRefPolicyEntry({ refPattern: 'refs/heads/main' })).toBe(false);
    expect(isValidRefPolicyEntry({ refPattern: 'refs/heads/*', allowForcePush: true, allowDelete: false })).toBe(false);
    expect(isValidRefPolicyEntry({ refPattern: 'refs/heads/*', allowForcePush: 1, allowDelete: 0 })).toBe(false);
    expect(isValidRefPolicyEntry({ refPattern: 'refs/heads/*', requireSignedCommits: true, requirePassingBuild: 1, minimumApprovals: 2 })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, allowForcePush: undefined })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, allowDelete: undefined })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, requireSignedCommits: undefined })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, requirePassingBuild: undefined })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, minimumApprovals: undefined })).toBe(false);

    // Malformed entries
    expect(isValidRefPolicyEntry(null)).toBe(false);
    expect(isValidRefPolicyEntry({})).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, refPattern: '' })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, refPattern: '   ' })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, refPattern: 123 })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, allowForcePush: 'yes' })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, allowDelete: 42 })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, requireSignedCommits: 'invalid' })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, requirePassingBuild: 'bad' })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, minimumApprovals: -1 })).toBe(false);
    expect(isValidRefPolicyEntry({ ...completeEntry, minimumApprovals: NaN })).toBe(false);

    // Lists
    expect(isValidRefPolicies([])).toBe(true);
    expect(isValidRefPolicies([completeEntry])).toBe(true);
    expect(isValidRefPolicies([{ refPattern: 'refs/heads/main' }])).toBe(false);
    expect(isValidRefPolicies([{}])).toBe(false);
    expect(isValidRefPolicies([completeEntry, {}])).toBe(false);
    expect(isValidRefPolicies([completeEntry, { refPattern: 'refs/heads/main' }])).toBe(false);
    expect(isValidRefPolicies('not-an-array')).toBe(false);
    expect(isValidRefPolicies(null)).toBe(false);
  });
});
