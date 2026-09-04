import { describe, it, expect } from 'vitest';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

    const selfForkErrors = validateForkOrigin({
      ...validOrigin,
      childRepositoryId: 'usr_nate/dronehunter'
    });
    expect(selfForkErrors).toContain('A repository cannot fork itself.');
  });

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

  it('Step 3: should create a structured local fork without contacting the remote gateway', async () => {
    const srcRoot = join(tmpdir(), `slopfix-fw-${Date.now().toString(36)}`);
    const src = join(srcRoot, 'dronehunter');
    mkdirSync(src, { recursive: true });
    execSync(`git -c init.defaultBranch=main init "${src}"`, { stdio: 'pipe' });
    writeFileSync(join(src, 'index.html'), '<!doctype html><title>Drone Hunter</title>');
    execSync(`git -C "${src}" add -A && git -C "${src}" -c user.name=Fixture -c user.email=fixture@test -c commit.gpgsign=false commit -m seed`, { stdio: 'pipe' });

    const forkRes = await handleFork(src, { local: true });
    try {
      expect(forkRes.success).toBe(true);
      expect(forkRes.command).toBe('fork');
      expect(forkRes.data.worktreePath).toContain(`${tmpdir()}/slop-dronehunter-`);
    } finally {
      if (forkRes.success) rmSync(forkRes.data.worktreePath, { recursive: true, force: true });
      rmSync(srcRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it('Step 5: should enforce strict merge-job state machine transitions', () => {
    const job = createMergeJob({
      targetRepositoryId: 'dronehunter',
      sourceRepositoryId: 'dronehunter-mod',
      sourceRefName: 'refs/features/radar/5c030af',
      baseCommitOid: oid1
    });

    expect(job.status).toBe('queued');

    const prepJob = transitionMergeJob(job, 'preparing');
    expect(prepJob.status).toBe('preparing');

    const runJob = transitionMergeJob(prepJob, 'running');
    expect(runJob.status).toBe('running');

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

    expect(canTransitionMergeJob('landed', 'running')).toBe(false);
    expect(() => transitionMergeJob(landedJob, 'running')).toThrow();
  });

  it('Step 8: should validate CAS compare-and-swap update against real remote head', () => {
    expect(isCasRefUpdateValid({
      currentOid: oid1,
      expectedOldOid: oid1,
      newOid: oid2
    })).toBe(true);

    expect(isCasRefUpdateValid({
      currentOid: oid2,
      expectedOldOid: oid1,
      newOid: oid2
    })).toBe(false);
  });
});
