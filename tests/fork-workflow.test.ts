import { describe, it, expect } from 'vitest';
import {
  validateForkOrigin,
  createMergeJob,
  transitionMergeJob,
  canTransitionMergeJob,
  isCasRefUpdateValid
} from '../src/lib/forgeDomain';
import { handleFork } from '../bin/slop.ts';
import * as gitApi from '../functions/api/git';

const oid1 = 'a'.repeat(40);
const oid2 = 'b'.repeat(40);

describe('Real Fork Workflow (8-Step Canonical Execution)', () => {
  // Step 1 & 4: Repository and ref schema + Lineage edges pinned to immutable commits
  it('Step 1 & 4: should validate immutable fork origins and reject invalid or self-referential forks', () => {
    const validOrigin = {
      childRepositoryId: 'usr_josh/dronehunter-mod',
      parentRepositoryId: 'usr_nate/dronehunter',
      parentRefName: 'refs/heads/main',
      parentCommitOid: oid1,
      childInitialCommitOid: oid2,
      lineageRootRepositoryId: 'usr_nate/dronehunter',
      depth: 1
    };

    const errors = validateForkOrigin(validOrigin);
    expect(errors.length).toBe(0);

    // Reject self fork
    const selfForkErrors = validateForkOrigin({
      ...validOrigin,
      childRepositoryId: 'usr_nate/dronehunter'
    });
    expect(selfForkErrors).toContain('A repository cannot fork itself.');
  });

  // Step 2: Git transport must be provided by a real gateway, not simulated by D1.
  it('Step 2: should reject partial Git Smart HTTP at the control-plane boundary', async () => {
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ sha: oid1 }),
            all: async () => ({ results: [] })
          })
        })
      }
    };

    const req = new Request('https://nates.software/api/git?service=git-receive-pack&appId=dronehunter', { method: 'GET' });
    const res = await gitApi.onRequestGet({ request: req, env: mockEnv });

    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('GITSMITH gateway');
  });

  // Step 3: slop clone, fork, and push with truthful failure handling
  it('Step 3: should create a structured local fork without contacting the remote gateway', () => {
    const forkRes = handleFork('nate/dronehunter');
    expect(forkRes.success).toBe(true);
    expect(forkRes.command).toBe('fork');
    expect(forkRes.data.worktreePath).toContain('/tmp/slop-dronehunter-');
  }, 15_000);

  // Step 5: Merge-job state machine transitions
  it('Step 5: should enforce strict merge-job state machine transitions', () => {
    const job = createMergeJob({
      targetRepositoryId: 'dronehunter',
      sourceRepositoryId: 'dronehunter-mod',
      sourceRefName: 'refs/features/radar/5c030af',
      baseCommitOid: oid1
    });

    expect(job.status).toBe('queued');

    // Valid transitions
    const prepJob = transitionMergeJob(job, 'preparing');
    expect(prepJob.status).toBe('preparing');

    const runJob = transitionMergeJob(prepJob, 'running');
    expect(runJob.status).toBe('running');

    // Step 7: Preview artifacts and explicit approval
    const previewJob = transitionMergeJob(runJob, 'preview_ready', {
      previewUrl: 'https://preview-radar.nates-software.com',
      evidenceDigest: 'sha256:8f4a21e901'
    });
    expect(previewJob.status).toBe('preview_ready');
    expect(previewJob.previewUrl).toBe('https://preview-radar.nates-software.com');

    const landJob = transitionMergeJob(previewJob, 'landing');
    expect(landJob.status).toBe('landing');

    const landedJob = transitionMergeJob(landJob, 'landed');
    expect(landedJob.status).toBe('landed');

    // Reject illegal transition (e.g. landed -> running)
    expect(canTransitionMergeJob('landed', 'running')).toBe(false);
    expect(() => transitionMergeJob(landedJob, 'running')).toThrow();
  });

  // Step 8: CAS ref landing against real remote head
  it('Step 8: should validate CAS compare-and-swap update against real remote head', () => {
    // Current remote head is oid1, expected old is oid1 -> OK
    expect(isCasRefUpdateValid({
      currentOid: oid1,
      expectedOldOid: oid1,
      newOid: oid2
    })).toBe(true);

    // Stale head: current remote is oid2, expected old is oid1 -> REJECT
    expect(isCasRefUpdateValid({
      currentOid: oid2,
      expectedOldOid: oid1,
      newOid: oid2
    })).toBe(false);
  });
});
