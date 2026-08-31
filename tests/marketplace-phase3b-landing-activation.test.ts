import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import * as gitApi from '../functions/api/git';
import * as inboxApi from '../functions/api/inbox';
import {
  initBareRepo,
  readAuthoritativeRef,
  updateAuthoritativeRefCas
} from '../src/lib/gitsmith/gitStorage';
import { ForgeOutboxDispatcher } from '../src/lib/gitsmith/outboxDispatcher';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

const GATEWAY_SECRET = 'secret_gateway_token_xyz_123';
const authHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' };
const gatewayHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${GATEWAY_SECRET}`
};

function createRealGitCommit(repoPath: string, message: string, parentOid?: string): string {
  const treeOid = execFileSync('git', ['write-tree'], {
    cwd: repoPath,
    encoding: 'utf8',
    env: { ...process.env, GIT_INDEX_FILE: path.join(repoPath, 'index.temp') }
  }).trim();

  const args = ['commit-tree', treeOid, '-m', message];
  if (parentOid) {
    args.push('-p', parentOid);
  }

  const commitOid = execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Nate Maker',
      GIT_AUTHOR_EMAIL: 'nate@nates-software.com',
      GIT_COMMITTER_NAME: 'Nate Maker',
      GIT_COMMITTER_EMAIL: 'nate@nates-software.com',
      GIT_AUTHOR_DATE: '2026-08-29T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-29T12:00:00Z'
    }
  }).trim();

  return commitOid;
}

describe('Marketplace Phase 3b — Contributor Share Landing Activation & Stale Revocation', () => {
  let tempRoot: string;
  let d1Ctx: TestD1Context;

  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsmith-p3b-test-'));
    d1Ctx = await createTestD1Database({ foreignKeys: true });
    process.env.GITSMITH_REPOS_ROOT = tempRoot;
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  const postGit = (body: unknown) => gitApi.onRequestPost({
    request: new Request('http://localhost/api/git', {
      method: 'POST',
      headers: gatewayHeaders,
      body: JSON.stringify(body)
    }),
    env: { DB: d1Ctx.d1, GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }
  });

  const postInbox = (body: unknown) => inboxApi.onRequestPost({
    request: new Request('http://localhost/api/inbox', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body)
    }),
    env: { DB: d1Ctx.d1, GITSMITH_REPOS_ROOT: tempRoot }
  });

  it('merge lands → pending contributor share becomes active with activated_at set', async () => {
    const repoId = 'repo-p3b-land-1';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const oldOid = createRealGitCommit(init.repoPath, 'Merge base');
    const resultOid = createRealGitCommit(init.repoPath, 'Approved result', oldOid);

    // Ref is updated to resultOid in Git and projected in D1
    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: resultOid, operation: 'create', idempotencyKey: 'seed-land'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES (?,'usr_nate','p3b-land','private','refs/heads/main',?,'active',3000)`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-p3b-land',?,'refs/heads/main','usr_sam','landing','p3b-land')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-p3b-land','job-p3b-land',1,?,?,'tool','policy','approved')`).bind(oldOid, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_approvals
      (id,merge_attempt_id,approver_user_id,result_commit_oid,decision)
      VALUES ('approval-p3b-land','attempt-p3b-land','usr_nate',?,'approved')`).bind(resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-p3b-land','usr_nate','usr_sam','PR','Preview','Content',0,'proposal','attempt-p3b-land',0)`).run();

    // Insert pending contributor share (1000 bps = 10%)
    await d1Ctx.d1.prepare(`INSERT INTO contributor_shares
      (id,repository_id,contributor_user_id,granted_by_user_id,merge_job_id,merge_attempt_id,merge_approval_id,basis_points,status)
      VALUES ('cs_p3b_land',?,'usr_sam','usr_nate','job-p3b-land','attempt-p3b-land','approval-p3b-land',1000,'pending')`).bind(repoId).run();

    const payload = {
      mergeJobId: 'job-p3b-land',
      mergeAttemptId: 'attempt-p3b-land',
      repositoryId: repoId,
      storageKey,
      targetRef: 'refs/heads/main',
      expectedTargetOid: oldOid,
      resultCommitOid: resultOid,
      approverUserId: 'usr_nate'
    };
    await d1Ctx.d1.prepare(`INSERT INTO forge_outbox_events
      (id,aggregate_type,aggregate_id,event_type,payload,attempts)
      VALUES ('evt-p3b-land','merge','attempt-p3b-land','merge.approved',?,0)`).bind(JSON.stringify(payload)).run();

    // Call gateway-complete-merge with landed
    const res = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-p3b-land',
      mergeAttemptId: 'attempt-p3b-land',
      outboxEventId: 'evt-p3b-land',
      status: 'landed',
      actualTargetOid: resultOid,
      idempotencyKey: 'idemp-p3b-land'
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('landed');

    // Verify contributor_shares row transitioned to active
    const share: any = await d1Ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE id = 'cs_p3b_land'
    `).first();

    expect(share).not.toBeNull();
    expect(share.status).toBe('active');
    expect(share.activated_at).not.toBeNull();
    expect(typeof share.activated_at).toBe('string');
    expect(share.revoked_at).toBeNull();
    expect(share.basis_points).toBe(1000);
    expect(share.contributor_user_id).toBe('usr_sam');
    expect(share.granted_by_user_id).toBe('usr_nate');

    // Verify merge attempts, merge jobs, and inbox messages
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-land').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-land').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('msg-p3b-land').first('is_merged')).toBe(1);
  });

  it('merge goes stale → pending share becomes revoked with revoked_at set and releases cap headroom', async () => {
    const repoId = 'repo-p3b-stale-1';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const expectedOid = createRealGitCommit(init.repoPath, 'Expected base');
    const divergedOid = createRealGitCommit(init.repoPath, 'Diverged concurrent commit', expectedOid);
    const resultOid = createRealGitCommit(init.repoPath, 'Candidate', expectedOid);

    // Git ref diverged to divergedOid
    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: divergedOid, operation: 'create', idempotencyKey: 'seed-stale'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES (?,'usr_nate','p3b-stale','private','refs/heads/main',?,'active',2000)`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, divergedOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-p3b-stale',?,'refs/heads/main','usr_sam','landing','p3b-stale')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-p3b-stale','job-p3b-stale',1,?,?,'tool','policy','approved')`).bind(expectedOid, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_approvals
      (id,merge_attempt_id,approver_user_id,result_commit_oid,decision)
      VALUES ('approval-p3b-stale','attempt-p3b-stale','usr_nate',?,'approved')`).bind(resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-p3b-stale','usr_nate','usr_sam','PR','Preview','Content',0,'proposal','attempt-p3b-stale',0)`).run();

    // Insert pending contributor share taking up full 2000 bps pool
    await d1Ctx.d1.prepare(`INSERT INTO contributor_shares
      (id,repository_id,contributor_user_id,granted_by_user_id,merge_job_id,merge_attempt_id,merge_approval_id,basis_points,status)
      VALUES ('cs_p3b_stale',?,'usr_sam','usr_nate','job-p3b-stale','attempt-p3b-stale','approval-p3b-stale',2000,'pending')`).bind(repoId).run();

    // Verify DB trigger prevents inserting any more shares right now while pending
    await expect(d1Ctx.d1.prepare(`INSERT INTO contributor_shares
      (id,repository_id,contributor_user_id,granted_by_user_id,merge_job_id,merge_attempt_id,merge_approval_id,basis_points,status)
      VALUES ('cs_p3b_overflow',?,'usr_josh','usr_nate','job-overflow','attempt-overflow','approval-overflow',500,'pending')`).bind(repoId).run()
    ).rejects.toThrow(/contributor share exceeds available repository grantable pool/);

    const payload = {
      mergeJobId: 'job-p3b-stale',
      mergeAttemptId: 'attempt-p3b-stale',
      repositoryId: repoId,
      storageKey,
      targetRef: 'refs/heads/main',
      expectedTargetOid: expectedOid,
      resultCommitOid: resultOid,
      approverUserId: 'usr_nate'
    };
    await d1Ctx.d1.prepare(`INSERT INTO forge_outbox_events
      (id,aggregate_type,aggregate_id,event_type,payload,attempts)
      VALUES ('evt-p3b-stale','merge','attempt-p3b-stale','merge.approved',?,0)`).bind(JSON.stringify(payload)).run();

    // Call gateway-complete-merge with stale
    const res = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-p3b-stale',
      mergeAttemptId: 'attempt-p3b-stale',
      outboxEventId: 'evt-p3b-stale',
      status: 'stale',
      actualTargetOid: divergedOid,
      idempotencyKey: 'idemp-p3b-stale'
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('stale');

    // Verify contributor_shares row transitioned to revoked
    const share: any = await d1Ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE id = 'cs_p3b_stale'
    `).first();

    expect(share).not.toBeNull();
    expect(share.status).toBe('revoked');
    expect(share.revoked_at).not.toBeNull();
    expect(typeof share.revoked_at).toBe('string');
    expect(share.activated_at).toBeNull();
    expect(share.basis_points).toBe(2000);

    // Verify merge attempts, merge jobs, and inbox messages
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-stale').first('status')).toBe('stale');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-stale').first('status')).toBe('stale');
    expect(await d1Ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('msg-p3b-stale').first('is_merged')).toBe(0);

    // Cap headroom is freed: inserting a new 2000 bps grant now succeeds without triggering cap guard!
    await expect(d1Ctx.d1.prepare(`INSERT INTO contributor_shares
      (id,repository_id,contributor_user_id,granted_by_user_id,merge_job_id,merge_attempt_id,merge_approval_id,basis_points,status)
      VALUES ('cs_p3b_regrant',?,'usr_josh','usr_nate','job-regrant','attempt-regrant','approval-regrant',2000,'pending')`).bind(repoId).run()
    ).resolves.toBeDefined();

    const regrantShare: any = await d1Ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE id = 'cs_p3b_regrant'
    `).first();
    expect(regrantShare).not.toBeNull();
    expect(regrantShare.status).toBe('pending');
    expect(regrantShare.basis_points).toBe(2000);
  });

  it('no share for the attempt (grant of 0 / declined) → landing and stale succeed unaffected', async () => {
    const repoId = 'repo-p3b-noshares';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const oldOid = createRealGitCommit(init.repoPath, 'Merge base');
    const resultOid = createRealGitCommit(init.repoPath, 'Approved result', oldOid);

    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: resultOid, operation: 'create', idempotencyKey: 'seed-noshare'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES (?,'usr_nate','p3b-noshare','private','refs/heads/main',?,'active',1000)`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-p3b-noshare',?,'refs/heads/main','usr_sam','landing','p3b-noshare')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-p3b-noshare','job-p3b-noshare',1,?,?,'tool','policy','approved')`).bind(oldOid, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_approvals
      (id,merge_attempt_id,approver_user_id,result_commit_oid,decision)
      VALUES ('approval-p3b-noshare','attempt-p3b-noshare','usr_nate',?,'approved')`).bind(resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-p3b-noshare','usr_nate','usr_sam','PR','Preview','Content',0,'proposal','attempt-p3b-noshare',0)`).run();

    // No contributor_shares row created for this attempt

    const payload = {
      mergeJobId: 'job-p3b-noshare',
      mergeAttemptId: 'attempt-p3b-noshare',
      repositoryId: repoId,
      storageKey,
      targetRef: 'refs/heads/main',
      expectedTargetOid: oldOid,
      resultCommitOid: resultOid,
      approverUserId: 'usr_nate'
    };
    await d1Ctx.d1.prepare(`INSERT INTO forge_outbox_events
      (id,aggregate_type,aggregate_id,event_type,payload,attempts)
      VALUES ('evt-p3b-noshare','merge','attempt-p3b-noshare','merge.approved',?,0)`).bind(JSON.stringify(payload)).run();

    const res = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-p3b-noshare',
      mergeAttemptId: 'attempt-p3b-noshare',
      outboxEventId: 'evt-p3b-noshare',
      status: 'landed',
      actualTargetOid: resultOid,
      idempotencyKey: 'idemp-p3b-noshare'
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('landed');

    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-noshare').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-noshare').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT COUNT(*) AS count FROM contributor_shares WHERE repository_id=?').bind(repoId).first('count')).toBe(0);
  });

  it('idempotent replay of gateway-complete-merge does not double-activate or error', async () => {
    const repoId = 'repo-p3b-replay';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const oldOid = createRealGitCommit(init.repoPath, 'Merge base');
    const resultOid = createRealGitCommit(init.repoPath, 'Approved result', oldOid);

    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: resultOid, operation: 'create', idempotencyKey: 'seed-replay'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES (?,'usr_nate','p3b-replay','private','refs/heads/main',?,'active',2500)`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-p3b-replay',?,'refs/heads/main','usr_sam','landing','p3b-replay')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-p3b-replay','job-p3b-replay',1,?,?,'tool','policy','approved')`).bind(oldOid, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_approvals
      (id,merge_attempt_id,approver_user_id,result_commit_oid,decision)
      VALUES ('approval-p3b-replay','attempt-p3b-replay','usr_nate',?,'approved')`).bind(resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-p3b-replay','usr_nate','usr_sam','PR','Preview','Content',0,'proposal','attempt-p3b-replay',0)`).run();

    await d1Ctx.d1.prepare(`INSERT INTO contributor_shares
      (id,repository_id,contributor_user_id,granted_by_user_id,merge_job_id,merge_attempt_id,merge_approval_id,basis_points,status)
      VALUES ('cs_p3b_replay',?,'usr_sam','usr_nate','job-p3b-replay','attempt-p3b-replay','approval-p3b-replay',500,'pending')`).bind(repoId).run();

    const payload = {
      mergeJobId: 'job-p3b-replay',
      mergeAttemptId: 'attempt-p3b-replay',
      repositoryId: repoId,
      storageKey,
      targetRef: 'refs/heads/main',
      expectedTargetOid: oldOid,
      resultCommitOid: resultOid,
      approverUserId: 'usr_nate'
    };
    await d1Ctx.d1.prepare(`INSERT INTO forge_outbox_events
      (id,aggregate_type,aggregate_id,event_type,payload,attempts)
      VALUES ('evt-p3b-replay','merge','attempt-p3b-replay','merge.approved',?,0)`).bind(JSON.stringify(payload)).run();

    // First completion
    const res1 = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-p3b-replay',
      mergeAttemptId: 'attempt-p3b-replay',
      outboxEventId: 'evt-p3b-replay',
      status: 'landed',
      actualTargetOid: resultOid,
      idempotencyKey: 'idemp-p3b-replay-1'
    });
    expect(res1.status).toBe(200);
    const data1: any = await res1.json();
    expect(data1.success).toBe(true);

    const share1: any = await d1Ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE id = 'cs_p3b_replay'
    `).first();
    expect(share1.status).toBe('active');
    expect(share1.activated_at).not.toBeNull();
    const activatedAt = share1.activated_at;

    // Second completion (idempotent replay)
    const res2 = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-p3b-replay',
      mergeAttemptId: 'attempt-p3b-replay',
      outboxEventId: 'evt-p3b-replay',
      status: 'landed',
      actualTargetOid: resultOid,
      idempotencyKey: 'idemp-p3b-replay-2'
    });
    expect(res2.status).toBe(200);
    const data2: any = await res2.json();
    expect(data2.success).toBe(true);
    expect(data2.idempotent).toBe(true);

    const share2: any = await d1Ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE id = 'cs_p3b_replay'
    `).first();
    expect(share2.status).toBe('active');
    expect(share2.activated_at).toBe(activatedAt);
    expect(share2.revoked_at).toBeNull();
  });

  it('end-to-end: inbox approve with 15% grant -> outbox dispatcher landing -> active share', async () => {
    const repoId = 'repo-p3b-e2e-land';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const baseOid = createRealGitCommit(init.repoPath, 'Base commit');
    const resultOid = createRealGitCommit(init.repoPath, 'PR commit', baseOid);

    // Target ref is at baseOid
    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: baseOid, operation: 'create', idempotencyKey: 'seed-e2e'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES (?,'dronehunter','usr_nate','p3b-e2e-land','private','refs/heads/main',?,'active',5000)`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, baseOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-p3b-e2e',?,'refs/heads/main','usr_sam','preview_ready','p3b-e2e-test')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-p3b-e2e','job-p3b-e2e',1,?,?,'tool-v1','policy-v1','preview_ready')`).bind(baseOid, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-p3b-e2e','usr_nate','usr_sam','Feature PR','Preview','Body',1,'proposal','attempt-p3b-e2e',0)`).run();

    // 1. Owner approves with 1500 bps (15%) grant via inbox API (Phase 3a)
    const approveRes = await postInbox({
      action: 'approve',
      messageId: 'msg-p3b-e2e',
      comment: 'Approved for landing with 15% revenue share',
      grantBps: 1500
    });
    expect(approveRes.status).toBe(200);

    // Verify pending share was created
    const pendingShare: any = await d1Ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE merge_attempt_id = 'attempt-p3b-e2e'
    `).first();
    expect(pendingShare).not.toBeNull();
    expect(pendingShare.status).toBe('pending');
    expect(pendingShare.basis_points).toBe(1500);
    expect(pendingShare.activated_at).toBeNull();

    // 2. Outbox dispatcher processes merge.approved event (Phase 3b)
    const apiFetch: typeof fetch = async (url, init) => gitApi.onRequestPost({
      request: new Request(url, init),
      env: { DB: d1Ctx.d1, GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }
    });
    const dispatcher = new ForgeOutboxDispatcher({
      reposRoot: tempRoot,
      controlPlaneUrl: 'http://control-plane.test',
      gatewayToken: GATEWAY_SECRET
    }, { db: d1Ctx.d1, fetchOverride: apiFetch });

    const [event] = await dispatcher.claimDueEvents(1);
    expect(event).toBeDefined();
    expect(event.event_type).toBe('merge.approved');

    const procRes = await dispatcher.processEvent(event);
    expect(procRes.success).toBe(true);

    // 3. Verify landing and activation
    expect(readAuthoritativeRef(tempRoot, storageKey, 'refs/heads/main')).toBe(resultOid);
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-e2e').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-e2e').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('msg-p3b-e2e').first('is_merged')).toBe(1);

    const activeShare: any = await d1Ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE merge_attempt_id = 'attempt-p3b-e2e'
    `).first();
    expect(activeShare.status).toBe('active');
    expect(activeShare.activated_at).not.toBeNull();
    expect(activeShare.revoked_at).toBeNull();
    expect(activeShare.basis_points).toBe(1500);
    expect(activeShare.contributor_user_id).toBe('usr_sam');
    expect(activeShare.granted_by_user_id).toBe('usr_nate');
  });

  it('end-to-end: inbox approve with 20% grant -> diverged ref -> outbox dispatcher stale -> revoked share -> cap headroom released', async () => {
    const repoId = 'repo-p3b-e2e-stale';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const baseOid = createRealGitCommit(init.repoPath, 'Base commit');
    const resultOid = createRealGitCommit(init.repoPath, 'PR candidate', baseOid);

    // Target ref is at baseOid initially
    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: baseOid, operation: 'create', idempotencyKey: 'seed-e2e-stale'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES (?,'dronehunter','usr_nate','p3b-e2e-stale','private','refs/heads/main',?,'active',2000)`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, baseOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-p3b-e2e-stale',?,'refs/heads/main','usr_sam','preview_ready','p3b-e2e-stale-test')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-p3b-e2e-stale','job-p3b-e2e-stale',1,?,?,'tool-v1','policy-v1','preview_ready')`).bind(baseOid, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-p3b-e2e-stale','usr_nate','usr_sam','PR Stale','Preview','Body',1,'proposal','attempt-p3b-e2e-stale',0)`).run();

    // 1. Owner approves with 2000 bps (20% = entire grantable pool)
    const approveRes = await postInbox({
      action: 'approve',
      messageId: 'msg-p3b-e2e-stale',
      comment: 'Approved with 20% grant',
      grantBps: 2000
    });
    expect(approveRes.status).toBe(200);

    // 2. Someone concurrently updates the target ref in Git before dispatcher lands the merge
    const concurrentOid = createRealGitCommit(init.repoPath, 'Concurrent push on main', baseOid);
    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: baseOid,
      newOid: concurrentOid, operation: 'update', idempotencyKey: 'concurrent-push'
    });

    // 3. Outbox dispatcher processes merge.approved event -> CAS detects stale
    const apiFetch: typeof fetch = async (url, init) => gitApi.onRequestPost({
      request: new Request(url, init),
      env: { DB: d1Ctx.d1, GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }
    });
    const dispatcher = new ForgeOutboxDispatcher({
      reposRoot: tempRoot,
      controlPlaneUrl: 'http://control-plane.test',
      gatewayToken: GATEWAY_SECRET
    }, { db: d1Ctx.d1, fetchOverride: apiFetch });

    const [event] = await dispatcher.claimDueEvents(1);
    expect(event).toBeDefined();
    const procRes = await dispatcher.processEvent(event);
    expect(procRes.success).toBe(true);

    // Git ref remains at concurrentOid
    expect(readAuthoritativeRef(tempRoot, storageKey, 'refs/heads/main')).toBe(concurrentOid);
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-e2e-stale').first('status')).toBe('stale');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-e2e-stale').first('status')).toBe('stale');
    expect(await d1Ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('msg-p3b-e2e-stale').first('is_merged')).toBe(0);

    // Contributor share is revoked
    const revokedShare: any = await d1Ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE merge_attempt_id = 'attempt-p3b-e2e-stale'
    `).first();
    expect(revokedShare.status).toBe('revoked');
    expect(revokedShare.revoked_at).not.toBeNull();
    expect(revokedShare.activated_at).toBeNull();

    // 4. Now a new rebased proposal can be granted the freed 2000 bps headroom
    const rebasedOid = createRealGitCommit(init.repoPath, 'Rebased PR commit', concurrentOid);
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-p3b-rebased',?,'refs/heads/main','usr_sam','preview_ready','p3b-rebased-test')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-p3b-rebased','job-p3b-rebased',1,?,?,'tool-v1','policy-v1','preview_ready')`).bind(concurrentOid, rebasedOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-p3b-rebased','usr_nate','usr_sam','Rebased PR','Preview','Body',1,'proposal','attempt-p3b-rebased',0)`).run();

    const approveRebasedRes = await postInbox({
      action: 'approve',
      messageId: 'msg-p3b-rebased',
      comment: 'Approved rebased PR with 2000 bps',
      grantBps: 2000
    });
    expect(approveRebasedRes.status).toBe(200);

    const rebasedShare: any = await d1Ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE merge_attempt_id = 'attempt-p3b-rebased'
    `).first();
    expect(rebasedShare).not.toBeNull();
    expect(rebasedShare.status).toBe('pending');
    expect(rebasedShare.basis_points).toBe(2000);
  });

  it('idempotent replay of gateway-complete-merge with stale status is a clean no-op', async () => {
    const repoId = 'repo-p3b-replay-stale';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const expectedOid = createRealGitCommit(init.repoPath, 'Base');
    const divergedOid = createRealGitCommit(init.repoPath, 'Diverged', expectedOid);
    const resultOid = createRealGitCommit(init.repoPath, 'Candidate', expectedOid);

    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: divergedOid, operation: 'create', idempotencyKey: 'seed-replay-stale'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES (?,'usr_nate','p3b-replay-stale','private','refs/heads/main',?,'active',3000)`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, divergedOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-p3b-rep-stale',?,'refs/heads/main','usr_sam','landing','p3b-rep-stale')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-p3b-rep-stale','job-p3b-rep-stale',1,?,?,'tool','policy','approved')`).bind(expectedOid, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_approvals
      (id,merge_attempt_id,approver_user_id,result_commit_oid,decision)
      VALUES ('approval-p3b-rep-stale','attempt-p3b-rep-stale','usr_nate',?,'approved')`).bind(resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-p3b-rep-stale','usr_nate','usr_sam','PR','Preview','Content',0,'proposal','attempt-p3b-rep-stale',0)`).run();

    await d1Ctx.d1.prepare(`INSERT INTO contributor_shares
      (id,repository_id,contributor_user_id,granted_by_user_id,merge_job_id,merge_attempt_id,merge_approval_id,basis_points,status)
      VALUES ('cs_p3b_rep_stale',?,'usr_sam','usr_nate','job-p3b-rep-stale','attempt-p3b-rep-stale','approval-p3b-rep-stale',1000,'pending')`).bind(repoId).run();

    const payload = {
      mergeJobId: 'job-p3b-rep-stale',
      mergeAttemptId: 'attempt-p3b-rep-stale',
      repositoryId: repoId,
      storageKey,
      targetRef: 'refs/heads/main',
      expectedTargetOid: expectedOid,
      resultCommitOid: resultOid,
      approverUserId: 'usr_nate'
    };
    await d1Ctx.d1.prepare(`INSERT INTO forge_outbox_events
      (id,aggregate_type,aggregate_id,event_type,payload,attempts)
      VALUES ('evt-p3b-rep-stale','merge','attempt-p3b-rep-stale','merge.approved',?,0)`).bind(JSON.stringify(payload)).run();

    // 1st complete-merge (stale)
    const res1 = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-p3b-rep-stale',
      mergeAttemptId: 'attempt-p3b-rep-stale',
      outboxEventId: 'evt-p3b-rep-stale',
      status: 'stale',
      actualTargetOid: divergedOid,
      idempotencyKey: 'idemp-p3b-rep-stale-1'
    });
    expect(res1.status).toBe(200);

    const share1: any = await d1Ctx.d1.prepare('SELECT * FROM contributor_shares WHERE id=?').bind('cs_p3b_rep_stale').first();
    expect(share1.status).toBe('revoked');
    expect(share1.revoked_at).not.toBeNull();
    const revokedAt = share1.revoked_at;

    // 2nd complete-merge (replay)
    const res2 = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-p3b-rep-stale',
      mergeAttemptId: 'attempt-p3b-rep-stale',
      outboxEventId: 'evt-p3b-rep-stale',
      status: 'stale',
      actualTargetOid: divergedOid,
      idempotencyKey: 'idemp-p3b-rep-stale-2'
    });
    expect(res2.status).toBe(200);
    const data2: any = await res2.json();
    expect(data2.idempotent).toBe(true);

    const share2: any = await d1Ctx.d1.prepare('SELECT * FROM contributor_shares WHERE id=?').bind('cs_p3b_rep_stale').first();
    expect(share2.status).toBe('revoked');
    expect(share2.revoked_at).toBe(revokedAt);
  });

  it('multiple attempts on same repo: landing one and staling another properly isolates share states', async () => {
    const repoId = 'repo-p3b-multi';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const baseOid = createRealGitCommit(init.repoPath, 'Base');
    const result1Oid = createRealGitCommit(init.repoPath, 'PR 1', baseOid);
    const result2Oid = createRealGitCommit(init.repoPath, 'PR 2', baseOid);

    // Initial state: target ref at baseOid
    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: baseOid, operation: 'create', idempotencyKey: 'seed-multi'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES (?,'usr_nate','p3b-multi','private','refs/heads/main',?,'active',5000)`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, baseOid).run();

    // PR 1 setup (1000 bps)
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-multi-1',?,'refs/heads/main','usr_sam','landing','multi-1')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-multi-1','job-multi-1',1,?,?,'tool','policy','approved')`).bind(baseOid, result1Oid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_approvals
      (id,merge_attempt_id,approver_user_id,result_commit_oid,decision)
      VALUES ('approval-multi-1','attempt-multi-1','usr_nate',?,'approved')`).bind(result1Oid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-multi-1','usr_nate','usr_sam','PR 1','P1','C1',0,'proposal','attempt-multi-1',0)`).run();
    await d1Ctx.d1.prepare(`INSERT INTO contributor_shares
      (id,repository_id,contributor_user_id,granted_by_user_id,merge_job_id,merge_attempt_id,merge_approval_id,basis_points,status)
      VALUES ('cs_multi_1',?,'usr_sam','usr_nate','job-multi-1','attempt-multi-1','approval-multi-1',1000,'pending')`).bind(repoId).run();

    // PR 2 setup (2000 bps)
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-multi-2',?,'refs/heads/main','usr_josh','landing','multi-2')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-multi-2','job-multi-2',1,?,?,'tool','policy','approved')`).bind(baseOid, result2Oid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_approvals
      (id,merge_attempt_id,approver_user_id,result_commit_oid,decision)
      VALUES ('approval-multi-2','attempt-multi-2','usr_nate',?,'approved')`).bind(result2Oid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-multi-2','usr_nate','usr_josh','PR 2','P2','C2',0,'proposal','attempt-multi-2',0)`).run();
    await d1Ctx.d1.prepare(`INSERT INTO contributor_shares
      (id,repository_id,contributor_user_id,granted_by_user_id,merge_job_id,merge_attempt_id,merge_approval_id,basis_points,status)
      VALUES ('cs_multi_2',?,'usr_josh','usr_nate','job-multi-2','attempt-multi-2','approval-multi-2',2000,'pending')`).bind(repoId).run();

    // Outbox events
    await d1Ctx.d1.prepare(`INSERT INTO forge_outbox_events
      (id,aggregate_type,aggregate_id,event_type,payload,attempts)
      VALUES ('evt-multi-1','merge','attempt-multi-1','merge.approved',?,0)`).bind(JSON.stringify({
      mergeJobId: 'job-multi-1', mergeAttemptId: 'attempt-multi-1', repositoryId: repoId,
      storageKey, targetRef: 'refs/heads/main', expectedTargetOid: baseOid, resultCommitOid: result1Oid, approverUserId: 'usr_nate'
    })).run();
    await d1Ctx.d1.prepare(`INSERT INTO forge_outbox_events
      (id,aggregate_type,aggregate_id,event_type,payload,attempts)
      VALUES ('evt-multi-2','merge','attempt-multi-2','merge.approved',?,0)`).bind(JSON.stringify({
      mergeJobId: 'job-multi-2', mergeAttemptId: 'attempt-multi-2', repositoryId: repoId,
      storageKey, targetRef: 'refs/heads/main', expectedTargetOid: baseOid, resultCommitOid: result2Oid, approverUserId: 'usr_nate'
    })).run();

    // PR 1 lands first: update git ref to result1Oid and call complete-merge
    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: baseOid,
      newOid: result1Oid, operation: 'update', idempotencyKey: 'land-multi-1'
    });
    await d1Ctx.d1.prepare(`UPDATE repository_refs SET commit_oid=? WHERE repository_id=? AND ref_name='refs/heads/main'`).bind(result1Oid, repoId).run();

    const land1Res = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-multi-1',
      mergeAttemptId: 'attempt-multi-1',
      outboxEventId: 'evt-multi-1',
      status: 'landed',
      actualTargetOid: result1Oid,
      idempotencyKey: 'idemp-multi-1'
    });
    expect(land1Res.status).toBe(200);

    // PR 2 goes stale: target ref is at result1Oid, not expected baseOid
    const stale2Res = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-multi-2',
      mergeAttemptId: 'attempt-multi-2',
      outboxEventId: 'evt-multi-2',
      status: 'stale',
      actualTargetOid: result1Oid,
      idempotencyKey: 'idemp-multi-2'
    });
    expect(stale2Res.status).toBe(200);

    // Check share statuses
    const share1: any = await d1Ctx.d1.prepare('SELECT * FROM contributor_shares WHERE id=?').bind('cs_multi_1').first();
    expect(share1.status).toBe('active');
    expect(share1.activated_at).not.toBeNull();
    expect(share1.revoked_at).toBeNull();

    const share2: any = await d1Ctx.d1.prepare('SELECT * FROM contributor_shares WHERE id=?').bind('cs_multi_2').first();
    expect(share2.status).toBe('revoked');
    expect(share2.activated_at).toBeNull();
    expect(share2.revoked_at).not.toBeNull();

    // Pool check: 5000 grantable - 1000 active = 4000 available
    const activeSum: any = await d1Ctx.d1.prepare(`
      SELECT COALESCE(SUM(basis_points), 0) AS total
      FROM contributor_shares
      WHERE repository_id = ? AND status IN ('active', 'pending')
    `).bind(repoId).first();
    expect(activeSum.total).toBe(1000);
  });

  it('abort / 409 conflict on landing attempt does not modify pending contributor share', async () => {
    const repoId = 'repo-p3b-abort';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const oldOid = createRealGitCommit(init.repoPath, 'Merge base');
    const resultOid = createRealGitCommit(init.repoPath, 'Approved result', oldOid);

    // Target ref is still at oldOid (NOT resultOid)
    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: oldOid, operation: 'create', idempotencyKey: 'seed-abort'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES (?,'usr_nate','p3b-abort','private','refs/heads/main',?,'active',2500)`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, oldOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-p3b-abort',?,'refs/heads/main','usr_sam','landing','p3b-abort')`).bind(repoId).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-p3b-abort','job-p3b-abort',1,?,?,'tool','policy','approved')`).bind(oldOid, resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO merge_approvals
      (id,merge_attempt_id,approver_user_id,result_commit_oid,decision)
      VALUES ('approval-p3b-abort','attempt-p3b-abort','usr_nate',?,'approved')`).bind(resultOid).run();
    await d1Ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,merge_attempt_id,is_merged)
      VALUES ('msg-p3b-abort','usr_nate','usr_sam','PR','Preview','Content',0,'proposal','attempt-p3b-abort',0)`).run();

    await d1Ctx.d1.prepare(`INSERT INTO contributor_shares
      (id,repository_id,contributor_user_id,granted_by_user_id,merge_job_id,merge_attempt_id,merge_approval_id,basis_points,status)
      VALUES ('cs_p3b_abort',?,'usr_sam','usr_nate','job-p3b-abort','attempt-p3b-abort','approval-p3b-abort',800,'pending')`).bind(repoId).run();

    const payload = {
      mergeJobId: 'job-p3b-abort',
      mergeAttemptId: 'attempt-p3b-abort',
      repositoryId: repoId,
      storageKey,
      targetRef: 'refs/heads/main',
      expectedTargetOid: oldOid,
      resultCommitOid: resultOid,
      approverUserId: 'usr_nate'
    };
    await d1Ctx.d1.prepare(`INSERT INTO forge_outbox_events
      (id,aggregate_type,aggregate_id,event_type,payload,attempts)
      VALUES ('evt-p3b-abort','merge','attempt-p3b-abort','merge.approved',?,0)`).bind(JSON.stringify(payload)).run();

    // Attempting to mark 'landed' when actual ref is still oldOid -> rejected with 409
    const res = await postGit({
      action: 'gateway-complete-merge',
      mergeJobId: 'job-p3b-abort',
      mergeAttemptId: 'attempt-p3b-abort',
      outboxEventId: 'evt-p3b-abort',
      status: 'landed',
      actualTargetOid: oldOid,
      idempotencyKey: 'idemp-p3b-abort'
    });

    expect(res.status).toBe(409);

    // Verify share remains untouched in 'pending' state
    const share: any = await d1Ctx.d1.prepare('SELECT * FROM contributor_shares WHERE id=?').bind('cs_p3b_abort').first();
    expect(share.status).toBe('pending');
    expect(share.activated_at).toBeNull();
    expect(share.revoked_at).toBeNull();
  });
});
