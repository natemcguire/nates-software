// Spec E — Approval/merge integrity (security-grade subset)
// Verifies the reviewer-saw-OID confirmation gate added on top of the existing
// CAS + fast-forward ancestry checks in functions/api/inbox.ts. This is fail-closed
// security code: no approval may proceed without evidence the reviewer actually saw
// matching the current merge attempt's OIDs.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import * as inboxApi from '../functions/api/inbox';
import { initBareRepo, updateAuthoritativeRefCas } from '../src/lib/gitsmith/gitStorage';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

const authHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' };

describe('Spec E — INBOX approval reviewer-saw-OID confirmation gate', () => {
  let ctx: TestD1Context;
  let tempDir: string;
  let reposRoot: string;
  const storageKey = 'repositories/repo-e-verify';

  let baseOid: string;
  let headOid: string;
  let divergedTargetOid: string;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    tempDir = path.join('/tmp', `gitsmith-e-verify-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    reposRoot = path.join(tempDir, 'repos');
    fs.mkdirSync(reposRoot, { recursive: true });
    process.env.GITSMITH_REPOS_ROOT = reposRoot;

    const initRes = initBareRepo(reposRoot, { storageKey, objectFormat: 'sha1', defaultRef: 'refs/heads/main' });
    const workTree = path.join(tempDir, 'worktree');
    fs.mkdirSync(workTree, { recursive: true });
    execFileSync('git', ['init', workTree], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Reviewer Tester'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'reviewer@nates.software'], { cwd: workTree, stdio: 'pipe' });

    fs.writeFileSync(path.join(workTree, 'README.md'), '# base\n');
    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'base commit'], { cwd: workTree, stdio: 'pipe' });
    baseOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    fs.writeFileSync(path.join(workTree, 'feature.ts'), 'export const x = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feature commit'], { cwd: workTree, stdio: 'pipe' });
    headOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    execFileSync('git', ['remote', 'add', 'origin', initRes.repoPath], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/feature'], { cwd: workTree, stdio: 'pipe' });

    // Divergent target: branch off base, add an unrelated commit, so target has moved.
    execFileSync('git', ['checkout', baseOid], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['checkout', '-b', 'divergent'], { cwd: workTree, stdio: 'pipe' });
    fs.writeFileSync(path.join(workTree, 'UPSTREAM.md'), 'concurrent upstream change\n');
    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'concurrent upstream commit'], { cwd: workTree, stdio: 'pipe' });
    divergedTargetOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/divergent'], { cwd: workTree, stdio: 'pipe' });

    const casInit = updateAuthoritativeRefCas(reposRoot, {
      storageKey, refName: 'refs/heads/main', newOid: baseOid, expectedOldOid: null, operation: 'create'
    });
    expect(casInit.success).toBe(true);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function seedProposal(opts: {
    repoId: string; jobId: string; attemptId: string; messageId: string;
    inputTargetOid: string; resultCommitOid: string; attemptStatus?: string; jobStatus?: string;
  }) {
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?, 'dronehunter','usr_nate',?, 'public','refs/heads/main',?, 'active')`)
      .bind(opts.repoId, `nate/${opts.repoId}`, storageKey).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES (?, ?, 'refs/heads/main','usr_sam', ?, ?)`)
      .bind(opts.jobId, opts.repoId, opts.jobStatus || 'preview_ready', `idem-${opts.jobId}`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES (?, ?, 1, ?, ?, 'tool-v1','policy-v1', ?)`)
      .bind(opts.attemptId, opts.jobId, opts.inputTargetOid, opts.resultCommitOid, opts.attemptStatus || 'preview_ready').run();
    await ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,feature_ref,cas_new_sha,is_merged,unread,message_kind,merge_attempt_id)
      VALUES (?, 'usr_nate','usr_sam','feat: PR','Preview','Please review','refs/heads/feature',?,0,1,'proposal',?)`)
      .bind(opts.messageId, opts.resultCommitOid, opts.attemptId).run();
  }

  function approveRequest(body: unknown) {
    return inboxApi.onRequestPost({
      request: new Request('http://localhost/api/inbox', {
        method: 'POST', headers: authHeaders, body: JSON.stringify(body)
      }),
      env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot }
    });
  }

  // -------------------------------------------------------------------------
  // 1. Approval blocked without loaded evidence (missing reviewedTargetOid/reviewedSourceOid)
  // -------------------------------------------------------------------------
  it('fails closed with 422 when reviewedTargetOid and reviewedSourceOid are absent (evidence not confirmed)', async () => {
    await seedProposal({
      repoId: 'repo-e1', jobId: 'job-e1', attemptId: 'attempt-e1', messageId: 'msg-e1',
      inputTargetOid: baseOid, resultCommitOid: headOid
    });

    const res = await approveRequest({ action: 'approve', messageId: 'msg-e1', comment: 'Approving blind.' });
    expect(res.status).toBe(422);
    const data: any = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('reviewedTargetOid');

    // No outbox event, no state change — the world was not mutated on a blind approval attempt.
    const outboxEvent = await ctx.d1.prepare("SELECT * FROM forge_outbox_events WHERE aggregate_id='attempt-e1'").first();
    expect(outboxEvent).toBeNull();
    const attemptRow: any = await ctx.d1.prepare("SELECT status FROM merge_attempts WHERE id='attempt-e1'").first();
    expect(attemptRow.status).toBe('preview_ready');
  });

  it('fails closed with 422 when only one of reviewedTargetOid/reviewedSourceOid is provided', async () => {
    await seedProposal({
      repoId: 'repo-e2', jobId: 'job-e2', attemptId: 'attempt-e2', messageId: 'msg-e2',
      inputTargetOid: baseOid, resultCommitOid: headOid
    });

    const res = await approveRequest({
      action: 'approve', messageId: 'msg-e2', comment: 'Partial evidence.',
      reviewedTargetOid: baseOid
      // reviewedSourceOid intentionally omitted
    });
    expect(res.status).toBe(422);
    const data: any = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('reviewedSourceOid');
  });

  // -------------------------------------------------------------------------
  // 2. Approval blocked on OID drift (reviewer saw stale evidence)
  // -------------------------------------------------------------------------
  it('fails closed with 409 when the submitted reviewed OIDs have drifted from the current merge attempt', async () => {
    await seedProposal({
      repoId: 'repo-e3', jobId: 'job-e3', attemptId: 'attempt-e3', messageId: 'msg-e3',
      inputTargetOid: baseOid, resultCommitOid: headOid
    });

    // Reviewer submits OIDs that do not match the attempt's current input/result OIDs
    // (e.g. they loaded evidence for a different or earlier version of the attempt).
    const res = await approveRequest({
      action: 'approve', messageId: 'msg-e3', comment: 'Approving with stale OIDs.',
      reviewedTargetOid: 'f'.repeat(40),
      reviewedSourceOid: headOid
    });
    expect(res.status).toBe(409);
    const data: any = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('drifted');

    const outboxEvent = await ctx.d1.prepare("SELECT * FROM forge_outbox_events WHERE aggregate_id='attempt-e3'").first();
    expect(outboxEvent).toBeNull();
    const attemptRow: any = await ctx.d1.prepare("SELECT status FROM merge_attempts WHERE id='attempt-e3'").first();
    expect(attemptRow.status).toBe('preview_ready');
  });

  it('fails closed with 409 when reviewedSourceOid does not match the current result commit OID', async () => {
    await seedProposal({
      repoId: 'repo-e4', jobId: 'job-e4', attemptId: 'attempt-e4', messageId: 'msg-e4',
      inputTargetOid: baseOid, resultCommitOid: headOid
    });

    const res = await approveRequest({
      action: 'approve', messageId: 'msg-e4', comment: 'Stale source OID.',
      reviewedTargetOid: baseOid,
      reviewedSourceOid: 'a'.repeat(40)
    });
    expect(res.status).toBe(409);
    const data: any = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('drifted');
  });

  // -------------------------------------------------------------------------
  // 3. FF merge succeeds when reviewed OIDs match and ancestry is a clean fast-forward
  // -------------------------------------------------------------------------
  it('approves and queues landing when reviewed OIDs exactly match a fast-forward-able attempt', async () => {
    await seedProposal({
      repoId: 'repo-e5', jobId: 'job-e5', attemptId: 'attempt-e5', messageId: 'msg-e5',
      inputTargetOid: baseOid, resultCommitOid: headOid
    });

    const res = await approveRequest({
      action: 'approve', messageId: 'msg-e5', comment: 'Reviewed and approved.',
      reviewedTargetOid: baseOid,
      reviewedSourceOid: headOid
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.approvalStatus).toBe('approved');
    expect(data.outboxEventId).toBe('merge_land_attempt-e5');

    const outboxEvent: any = await ctx.d1.prepare("SELECT payload FROM forge_outbox_events WHERE id='merge_land_attempt-e5'").first();
    expect(outboxEvent).toBeDefined();
    const payload = JSON.parse(outboxEvent.payload);
    expect(payload.expectedTargetOid).toBe(baseOid);
    expect(payload.resultCommitOid).toBe(headOid);
  });

  // -------------------------------------------------------------------------
  // 4. Non-FF (divergent) merge fails closed even with matching reviewed OIDs
  // -------------------------------------------------------------------------
  it('fails closed with 409 for a divergent (non-fast-forward) attempt even when reviewed OIDs match exactly', async () => {
    await seedProposal({
      repoId: 'repo-e6', jobId: 'job-e6', attemptId: 'attempt-e6', messageId: 'msg-e6',
      inputTargetOid: divergedTargetOid, resultCommitOid: headOid
    });

    // Reviewer correctly submits the OIDs they saw (no drift) — but the underlying
    // history is divergent, so the pre-existing fast-forward ancestry gate must still
    // fail closed. The new reviewer-saw-OID gate does NOT weaken this check.
    const res = await approveRequest({
      action: 'approve', messageId: 'msg-e6', comment: 'Reviewed but branch has diverged.',
      reviewedTargetOid: divergedTargetOid,
      reviewedSourceOid: headOid
    });
    expect(res.status).toBe(409);
    const data: any = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('divergent');

    const outboxEvent = await ctx.d1.prepare("SELECT * FROM forge_outbox_events WHERE aggregate_id='attempt-e6'").first();
    expect(outboxEvent).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 5. Gateway/repository unavailable fails closed even when reviewed OIDs match exactly
  // -------------------------------------------------------------------------
  it('fails closed with 409 when repository storage is unavailable, even with matching reviewed OIDs', async () => {
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES ('repo-e7','dronehunter','usr_nate','nate/repo-e7','public','refs/heads/main','repositories/does-not-exist-on-disk','active')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-e7','repo-e7','refs/heads/main','usr_sam','preview_ready','idem-job-e7')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-e7','job-e7',1,?,?, 'tool-v1','policy-v1','preview_ready')`).bind(baseOid, headOid).run();
    await ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,feature_ref,cas_new_sha,is_merged,unread,message_kind,merge_attempt_id)
      VALUES ('msg-e7','usr_nate','usr_sam','feat: PR','Preview','Please review','refs/heads/feature',?,0,1,'proposal','attempt-e7')`)
      .bind(headOid).run();

    const res = await approveRequest({
      action: 'approve', messageId: 'msg-e7', comment: 'Repo storage unavailable.',
      reviewedTargetOid: baseOid,
      reviewedSourceOid: headOid
    });
    expect(res.status).toBe(409);
    const data: any = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('unavailable for lineage verification');

    const outboxEvent = await ctx.d1.prepare("SELECT * FROM forge_outbox_events WHERE aggregate_id='attempt-e7'").first();
    expect(outboxEvent).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Rejections are exempt from the evidence-confirmation gate (only approvals are gated).
  // -------------------------------------------------------------------------
  it('does not require reviewedTargetOid/reviewedSourceOid for rejections', async () => {
    await seedProposal({
      repoId: 'repo-e8', jobId: 'job-e8', attemptId: 'attempt-e8', messageId: 'msg-e8',
      inputTargetOid: baseOid, resultCommitOid: headOid
    });

    const res = await approveRequest({
      action: 'reject', messageId: 'msg-e8', comment: 'Not ready yet, needs more tests.'
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.approvalStatus).toBe('rejected');
  });
});
