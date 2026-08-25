import { describe, it, expect } from 'vitest';
import { executeCasMerge, CASMergeRequest } from '../src/lib/gitsmithDomain';

describe('GITSMITH Atomic Compare-And-Swap (CAS) Merge Engine', () => {
  it('should succeed when remote head matches expected ancestor SHA', () => {
    const req: CASMergeRequest = {
      ref: 'refs/heads/main',
      expectedOldSha: '5c030af',
      newSha: '8f4a21e',
      committer: 'nate',
      signatureVerified: true
    };
    const result = executeCasMerge('5c030af', req);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newHeadSha).toBe('8f4a21e');
    }
  });

  it('should reject non-fast-forward push and require rebase', () => {
    const req: CASMergeRequest = {
      ref: 'refs/heads/main',
      expectedOldSha: '5c030af',
      newSha: '8f4a21e',
      committer: 'nate',
      signatureVerified: true
    };
    const result = executeCasMerge('diverged999', req);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('CAS atomic rejection');
    }
  });

  it('should reject invalid ref path', () => {
    const req: CASMergeRequest = {
      ref: 'invalid-ref-without-prefix',
      expectedOldSha: '5c030af',
      newSha: '8f4a21e',
      committer: 'nate',
      signatureVerified: true
    };
    const result = executeCasMerge('5c030af', req);
    expect(result.success).toBe(false);
  });
});
