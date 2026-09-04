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

describe('GITSMITH CAS merge-landing (gateway-complete-merge)', () => {
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

  const storage = {
    store: new Map<string, Uint8Array>(),
    async put(key: string, value: Uint8Array) { this.store.set(key, value); return { key }; },
    async get(key: string) {
      const bytes = this.store.get(key);
      if (!bytes) return null;
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
  };

  async function seedEvidenceBundleForApproval(mergeAttemptId: string) {
    const attempt: any = await d1Ctx.d1.prepare(`
      SELECT ma.id, ma.result_commit_oid AS resultCommitOid, mj.target_repository_id AS repositoryId
      FROM merge_attempts ma JOIN merge_jobs mj ON mj.id = ma.merge_job_id
      WHERE ma.id = ?
    `).bind(mergeAttemptId).first();
    if (!attempt) return;
    const existing = await d1Ctx.d1.prepare(`
      SELECT id FROM build_runs WHERE merge_attempt_id = ? AND status = 'passed' AND evidence_bundle_r2_key IS NOT NULL
    `).bind(mergeAttemptId).first();
    if (existing) return;
    const buildId = `build-auto-${mergeAttemptId}`;
    const bytes = new TextEncoder().encode(JSON.stringify({ logs: 'ok', mergeAttemptId }));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    const r2Key = `verification-evidence/${buildId}/auto.json`;
    const sha256 = `sha256:${hex}`;
    await storage.put(r2Key, bytes);
    await d1Ctx.d1.prepare(`INSERT INTO build_runs
      (id,repository_id,commit_oid,merge_attempt_id,purpose,status,runner_image_digest,build_command,test_command,source_manifest_digest,
       evidence_bundle_r2_key,evidence_bundle_sha256,evidence_bundle_recorded_at)
      VALUES (?,?,?,?,'verification','passed',?,'npm run build','npm test',?,?,?,CURRENT_TIMESTAMP)`)
      .bind(buildId, attempt.repositoryId, attempt.resultCommitOid, mergeAttemptId,
        `node@sha256:${'c'.repeat(64)}`, `sha256:${'d'.repeat(64)}`, r2Key, sha256).run();
  }

  const postInbox = async (body: any) => {
    let payload = body;
    if (body && typeof body === 'object' && body.action === 'approve' && body.messageId &&
        body.reviewedTargetOid === undefined && body.reviewedSourceOid === undefined) {
      const row: any = await d1Ctx.d1.prepare(`
        SELECT ma.id AS mergeAttemptId, ma.input_target_oid AS inputTargetOid, ma.result_commit_oid AS resultCommitOid
        FROM inbox_messages m JOIN merge_attempts ma ON ma.id = m.merge_attempt_id
        WHERE m.id = ?
      `).bind(body.messageId).first();
      if (row) {
        payload = { ...body, reviewedTargetOid: row.inputTargetOid, reviewedSourceOid: row.resultCommitOid };
        await seedEvidenceBundleForApproval(row.mergeAttemptId);
      }
    }
    return inboxApi.onRequestPost({
      request: new Request('http://localhost/api/inbox', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload)
      }),
      env: { DB: d1Ctx.d1, GITSMITH_REPOS_ROOT: tempRoot, STORAGE: storage as any }
    });
  };

  it('merge lands → merge_attempts/merge_jobs/inbox_messages transition to landed', async () => {
    const repoId = 'repo-p3b-land-1';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const oldOid = createRealGitCommit(init.repoPath, 'Merge base');
    const resultOid = createRealGitCommit(init.repoPath, 'Approved result', oldOid);

    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: resultOid, operation: 'create', idempotencyKey: 'seed-land'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?,'usr_nate','p3b-land','private','refs/heads/main',?,'active')`).bind(repoId, storageKey).run();
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

    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-land').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-land').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('msg-p3b-land').first('is_merged')).toBe(1);
  });

  it('merge goes stale → merge_attempts/merge_jobs/inbox_messages transition to stale', async () => {
    const repoId = 'repo-p3b-stale-1';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const expectedOid = createRealGitCommit(init.repoPath, 'Expected base');
    const divergedOid = createRealGitCommit(init.repoPath, 'Diverged concurrent commit', expectedOid);
    const resultOid = createRealGitCommit(init.repoPath, 'Candidate', expectedOid);

    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: divergedOid, operation: 'create', idempotencyKey: 'seed-stale'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?,'usr_nate','p3b-stale','private','refs/heads/main',?,'active')`).bind(repoId, storageKey).run();
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

    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-stale').first('status')).toBe('stale');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-stale').first('status')).toBe('stale');
    expect(await d1Ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('msg-p3b-stale').first('is_merged')).toBe(0);
  });

  it('idempotent replay of gateway-complete-merge (landed) does not error or change state', async () => {
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
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?,'usr_nate','p3b-replay','private','refs/heads/main',?,'active')`).bind(repoId, storageKey).run();
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

    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-replay').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-replay').first('status')).toBe('landed');
  });

  it('end-to-end: inbox approve -> outbox dispatcher processes merge.approved -> lands via CAS', async () => {
    const repoId = 'repo-p3b-e2e-land';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const baseOid = createRealGitCommit(init.repoPath, 'Base commit');
    const resultOid = createRealGitCommit(init.repoPath, 'PR commit', baseOid);

    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: baseOid, operation: 'create', idempotencyKey: 'seed-e2e'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?,'dronehunter','usr_nate','p3b-e2e-land','private','refs/heads/main',?,'active')`).bind(repoId, storageKey).run();
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

    const approveRes = await postInbox({
      action: 'approve',
      messageId: 'msg-p3b-e2e',
      comment: 'Approved for landing'
    });
    expect(approveRes.status).toBe(200);

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

    expect(readAuthoritativeRef(tempRoot, storageKey, 'refs/heads/main')).toBe(resultOid);
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-e2e').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-e2e').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('msg-p3b-e2e').first('is_merged')).toBe(1);
  });

  it('end-to-end: inbox approve -> diverged ref -> outbox dispatcher detects CAS stale', async () => {
    const repoId = 'repo-p3b-e2e-stale';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const baseOid = createRealGitCommit(init.repoPath, 'Base commit');
    const resultOid = createRealGitCommit(init.repoPath, 'PR candidate', baseOid);

    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: baseOid, operation: 'create', idempotencyKey: 'seed-e2e-stale'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?,'dronehunter','usr_nate','p3b-e2e-stale','private','refs/heads/main',?,'active')`).bind(repoId, storageKey).run();
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

    const approveRes = await postInbox({
      action: 'approve',
      messageId: 'msg-p3b-e2e-stale',
      comment: 'Approved'
    });
    expect(approveRes.status).toBe(200);

    const concurrentOid = createRealGitCommit(init.repoPath, 'Concurrent push on main', baseOid);
    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: baseOid,
      newOid: concurrentOid, operation: 'update', idempotencyKey: 'concurrent-push'
    });

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

    expect(readAuthoritativeRef(tempRoot, storageKey, 'refs/heads/main')).toBe(concurrentOid);
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-e2e-stale').first('status')).toBe('stale');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-e2e-stale').first('status')).toBe('stale');
    expect(await d1Ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('msg-p3b-e2e-stale').first('is_merged')).toBe(0);
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
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?,'usr_nate','p3b-replay-stale','private','refs/heads/main',?,'active')`).bind(repoId, storageKey).run();
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
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-rep-stale').first('status')).toBe('stale');

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
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-rep-stale').first('status')).toBe('stale');
  });

  it('multiple attempts on same repo: landing one and staling another properly isolates state', async () => {
    const repoId = 'repo-p3b-multi';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const baseOid = createRealGitCommit(init.repoPath, 'Base');
    const result1Oid = createRealGitCommit(init.repoPath, 'PR 1', baseOid);
    const result2Oid = createRealGitCommit(init.repoPath, 'PR 2', baseOid);

    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: baseOid, operation: 'create', idempotencyKey: 'seed-multi'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?,'usr_nate','p3b-multi','private','refs/heads/main',?,'active')`).bind(repoId, storageKey).run();
    await d1Ctx.d1.prepare(`INSERT INTO repository_refs
      (repository_id,ref_name,commit_oid,version) VALUES (?,'refs/heads/main',?,1)`).bind(repoId, baseOid).run();

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

    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-multi-1').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-multi-2').first('status')).toBe('stale');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-multi-1').first('status')).toBe('landed');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-multi-2').first('status')).toBe('stale');
  });

  it('abort / 409 conflict on landing attempt does not modify merge_attempts/merge_jobs state', async () => {
    const repoId = 'repo-p3b-abort';
    const storageKey = `repositories/${repoId}`;
    const init = initBareRepo(tempRoot, { storageKey });
    const oldOid = createRealGitCommit(init.repoPath, 'Merge base');
    const resultOid = createRealGitCommit(init.repoPath, 'Approved result', oldOid);

    updateAuthoritativeRefCas(tempRoot, {
      storageKey, refName: 'refs/heads/main', expectedOldOid: null,
      newOid: oldOid, operation: 'create', idempotencyKey: 'seed-abort'
    });

    await d1Ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?,'usr_nate','p3b-abort','private','refs/heads/main',?,'active')`).bind(repoId, storageKey).run();
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

    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-p3b-abort').first('status')).toBe('approved');
    expect(await d1Ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-p3b-abort').first('status')).toBe('landing');
  });
});
