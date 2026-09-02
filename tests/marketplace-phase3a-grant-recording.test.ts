import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import * as inboxApi from '../functions/api/inbox';
import { AuthProvider } from '../src/context/AuthContext';
import { InboxView } from '../src/views/InboxView';
import { initBareRepo } from '../src/lib/gitsmith/gitStorage';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

const authHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' };
const ownMessage = (id: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: 'usr_nate', sender_id: 'usr_sam', title: 'Message', preview: 'Preview',
  content: 'Body', unread: 1, message_kind: 'proposal', ...extra
});

describe('Marketplace Phase 3a — Contributor Grant Recording at Approve-and-Merge', () => {
  let ctx: TestD1Context;
  let tempDir: string;
  let reposRoot: string;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    tempDir = path.join('/tmp', `gitsmith-p3a-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    reposRoot = path.join(tempDir, 'repos');
    fs.mkdirSync(reposRoot, { recursive: true });
    process.env.GITSMITH_REPOS_ROOT = reposRoot;
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function setupTestRepo(storageKey: string) {
    const initRes = initBareRepo(reposRoot, { storageKey, objectFormat: 'sha1', defaultRef: 'refs/heads/main' });
    const workTree = path.join(tempDir, `wt-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(workTree, { recursive: true });
    execFileSync('git', ['init', workTree], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'tester@nates.software'], { cwd: workTree, stdio: 'pipe' });

    fs.writeFileSync(path.join(workTree, 'file.txt'), 'base content\n');
    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: workTree, stdio: 'pipe' });
    const baseOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    fs.writeFileSync(path.join(workTree, 'file.txt'), 'base content\nfeature content\n');
    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feature'], { cwd: workTree, stdio: 'pipe' });
    const headOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    execFileSync('git', ['remote', 'add', 'origin', initRes.repoPath], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: workTree, stdio: 'pipe' });

    return { baseOid, headOid };
  }

  async function insertMessage(row: Record<string, unknown>) {
    await ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,feature_ref,merge_attempt_id,is_merged,in_reply_to_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))`).bind(
      row.id, row.user_id, row.sender_id ?? null, row.title, row.preview, row.content,
      row.unread ?? 1, row.message_kind ?? 'proposal', row.feature_ref ?? null,
      row.merge_attempt_id ?? null, row.is_merged ?? 0, row.in_reply_to_id ?? null, row.created_at ?? null
    ).run();
  }

  // Minimal in-memory R2 mock so the signed evidence-bundle approval gate
  // (Fix 1, RIG spec) can be satisfied by this pre-existing grant-recording suite.
  const storage = {
    store: new Map<string, Uint8Array>(),
    async put(key: string, value: Uint8Array) { this.store.set(key, value); return { key }; },
    async get(key: string) {
      const bytes = this.store.get(key);
      if (!bytes) return null;
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
  };

  // Seeds a passing build_runs row + matching signed R2 evidence bundle for
  // a merge attempt, so a subsequent 'approve' satisfies the Fix 1 gate.
  async function seedEvidenceBundleForApproval(mergeAttemptId: string) {
    const attempt: any = await ctx.d1.prepare(`
      SELECT ma.id, ma.result_commit_oid AS resultCommitOid, mj.target_repository_id AS repositoryId
      FROM merge_attempts ma JOIN merge_jobs mj ON mj.id = ma.merge_job_id
      WHERE ma.id = ?
    `).bind(mergeAttemptId).first();
    if (!attempt) return;
    const existing = await ctx.d1.prepare(`
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
    await ctx.d1.prepare(`INSERT INTO build_runs
      (id,repository_id,commit_oid,merge_attempt_id,purpose,status,runner_image_digest,build_command,test_command,source_manifest_digest,
       evidence_bundle_r2_key,evidence_bundle_sha256,evidence_bundle_recorded_at)
      VALUES (?,?,?,?,'verification','passed',?,'npm run build','npm test',?,?,?,CURRENT_TIMESTAMP)`)
      .bind(buildId, attempt.repositoryId, attempt.resultCommitOid, mergeAttemptId,
        `node@sha256:${'c'.repeat(64)}`, `sha256:${'d'.repeat(64)}`, r2Key, sha256).run();
  }

  const get = (url = 'http://localhost/api/inbox', authenticated = true) => inboxApi.onRequestGet({
    request: new Request(url, authenticated ? { headers: authHeaders } : undefined),
    env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot, STORAGE: storage as any }
  });

  // Auto-fills the reviewer-saw-OID confirmation fields for 'approve' actions from the
  // merge attempt's current OIDs, unless the test already specified them (so tests that
  // intentionally probe the evidence gate itself can still override/omit), and seeds a
  // matching signed evidence bundle so pre-existing tests satisfy the Fix 1 approval gate.
  const post = async (body: any) => {
    let payload = body;
    if (body && typeof body === 'object' && body.action === 'approve' && body.messageId &&
        body.reviewedTargetOid === undefined && body.reviewedSourceOid === undefined) {
      const row: any = await ctx.d1.prepare(`
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
      request: new Request('http://localhost/api/inbox', { method: 'POST', headers: authHeaders, body: JSON.stringify(payload) }),
      env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot, STORAGE: storage as any }
    });
  };

  it('approve with 10% (1000 bps) grant records a pending contributor_shares row', async () => {
    const { baseOid, headOid } = setupTestRepo('repositories/repo-grant-10');
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-grant-10','dronehunter','usr_nate','nate/grant-10','private','refs/heads/main','repositories/repo-grant-10','active',2500)`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-grant-10','repo-grant-10','refs/heads/main','usr_sam','preview_ready','grant-10-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-grant-10','job-grant-10',1,?,?, 'tool-v1','policy-v1','preview_ready')`)
      .bind(baseOid, headOid).run();
    await insertMessage(ownMessage('msg-grant-10', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-grant-10'
    }));

    // Check diff endpoint returns grantableBps and grantedBps
    const diffRes = await get('http://localhost/api/inbox?action=diff&proposalId=msg-grant-10');
    expect(diffRes.status).toBe(200);
    const diffData: any = await diffRes.json();
    expect(diffData.grantableBps).toBe(2500);
    expect(diffData.grantedBps).toBe(0);
    expect(diffData.remainingGrantableBps).toBe(2500);

    // Approve with 1000 bps (10%)
    const approveRes = await post({
      action: 'approve',
      messageId: 'msg-grant-10',
      comment: 'LGTM! Great work on this contribution.',
      grantBps: 1000
    });
    expect(approveRes.status).toBe(200);
    const approveData: any = await approveRes.json();
    expect(approveData.success).toBe(true);
    expect(approveData.approvalStatus).toBe('approved');
    expect(approveData.grantBps).toBe(1000);

    // Verify contributor_shares row
    const share: any = await ctx.d1.prepare(`
      SELECT * FROM contributor_shares WHERE merge_attempt_id = ?
    `).bind('attempt-grant-10').first();

    expect(share).not.toBeNull();
    expect(share.id).toMatch(/^cs_/);
    expect(share.repository_id).toBe('repo-grant-10');
    expect(share.contributor_user_id).toBe('usr_sam');
    expect(share.granted_by_user_id).toBe('usr_nate');
    expect(share.merge_job_id).toBe('job-grant-10');
    expect(share.merge_attempt_id).toBe('attempt-grant-10');
    expect(share.basis_points).toBe(1000);
    expect(share.status).toBe('pending');
    expect(share.activated_at).toBeNull();
    expect(share.revoked_at).toBeNull();

    const approval: any = await ctx.d1.prepare(`
      SELECT * FROM merge_approvals WHERE merge_attempt_id = ?
    `).bind('attempt-grant-10').first();
    expect(approval).not.toBeNull();
    expect(share.merge_approval_id).toBe(approval.id);

    // Verify outbox event and merge job status
    expect(await ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-grant-10').first('status')).toBe('landing');
    expect(await ctx.d1.prepare('SELECT count(*) AS c FROM forge_outbox_events WHERE aggregate_id=?').bind('attempt-grant-10').first('c')).toBe(1);

    // Verify diff endpoint reflects the newly granted bps
    const diffAfter = await (await get('http://localhost/api/inbox?action=diff&proposalId=msg-grant-10')).json();
    expect(diffAfter.grantedBps).toBe(1000);
    expect(diffAfter.remainingGrantableBps).toBe(1500);
  });

  it('cap breach: rejects grant exceeding grantable_bps with 422', async () => {
    const { baseOid, headOid } = setupTestRepo('repositories/repo-cap-breach');
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-cap-breach','dronehunter','usr_nate','nate/cap-breach','private','refs/heads/main','repositories/repo-cap-breach','active',1000)`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-cap-breach','repo-cap-breach','refs/heads/main','usr_sam','preview_ready','cap-breach-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-cap-breach','job-cap-breach',1,?,?, 'tool-v1','policy-v1','preview_ready')`)
      .bind(baseOid, headOid).run();
    await insertMessage(ownMessage('msg-cap-breach', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-cap-breach'
    }));

    // Attempting to grant 1500 bps when pool is 1000 bps
    const res = await post({
      action: 'approve',
      messageId: 'msg-cap-breach',
      grantBps: 1500
    });
    expect(res.status).toBe(422);
    const data: any = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('exceeds available repository grantable pool');

    // Ensure no contributor_shares or merge_approvals were written
    expect(await ctx.d1.prepare('SELECT count(*) AS c FROM contributor_shares WHERE repository_id=?').bind('repo-cap-breach').first('c')).toBe(0);
    expect(await ctx.d1.prepare('SELECT count(*) AS c FROM merge_approvals WHERE merge_attempt_id=?').bind('attempt-cap-breach').first('c')).toBe(0);
  });

  it('cap breach: accounts for already active and pending grants', async () => {
    const { baseOid, headOid } = setupTestRepo('repositories/repo-cap-sum');
    await ctx.d1.prepare(`INSERT OR IGNORE INTO users (id, username, display_name) VALUES ('usr_alice', 'alice', 'Alice')`).run();
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-cap-sum','dronehunter','usr_nate','nate/cap-sum','private','refs/heads/main','repositories/repo-cap-sum','active',2000)`).run();
    
    // Existing active grant of 1200 bps
    await ctx.d1.prepare(`INSERT INTO contributor_shares
      (id, repository_id, contributor_user_id, granted_by_user_id, merge_job_id, merge_attempt_id, basis_points, status, activated_at)
      VALUES ('cs_existing', 'repo-cap-sum', 'usr_alice', 'usr_nate', 'job_old', 'att_old', 1200, 'active', CURRENT_TIMESTAMP)`).run();

    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-cap-sum','repo-cap-sum','refs/heads/main','usr_sam','preview_ready','cap-sum-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-cap-sum','job-cap-sum',1,?,?, 'tool-v1','policy-v1','preview_ready')`)
      .bind(baseOid, headOid).run();
    await insertMessage(ownMessage('msg-cap-sum', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-cap-sum'
    }));

    // 1200 existing + 900 requested = 2100 > 2000 => 422
    const failRes = await post({
      action: 'approve',
      messageId: 'msg-cap-sum',
      grantBps: 900
    });
    expect(failRes.status).toBe(422);

    // 1200 existing + 800 requested = 2000 <= 2000 => 200
    const passRes = await post({
      action: 'approve',
      messageId: 'msg-cap-sum',
      grantBps: 800
    });
    expect(passRes.status).toBe(200);
  });

  it('rejects self-grant (contributor == owner) with 422', async () => {
    const { baseOid, headOid } = setupTestRepo('repositories/repo-self-grant');
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-self-grant','dronehunter','usr_nate','nate/self-grant','private','refs/heads/main','repositories/repo-self-grant','active',5000)`).run();
    // Requested by owner usr_nate
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-self-grant','repo-self-grant','refs/heads/main','usr_nate','preview_ready','self-grant-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-self-grant','job-self-grant',1,?,?, 'tool-v1','policy-v1','preview_ready')`)
      .bind(baseOid, headOid).run();
    await insertMessage(ownMessage('msg-self-grant', {
      user_id: 'usr_nate',
      sender_id: 'usr_nate',
      merge_attempt_id: 'attempt-self-grant'
    }));

    const res = await post({
      action: 'approve',
      messageId: 'msg-self-grant',
      grantBps: 500
    });
    expect(res.status).toBe(422);
    const data: any = await res.json();
    expect(data.error).toContain('cannot grant contributor shares to themselves');
    expect(await ctx.d1.prepare('SELECT count(*) AS c FROM contributor_shares WHERE repository_id=?').bind('repo-self-grant').first('c')).toBe(0);
  });

  it('replay approval (same merge_attempt_id): exact replay succeeds idempotently, differing replay returns 409 Conflict', async () => {
    const { baseOid, headOid } = setupTestRepo('repositories/repo-replay');
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-replay','dronehunter','usr_nate','nate/replay','private','refs/heads/main','repositories/repo-replay','active',3000)`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-replay','repo-replay','refs/heads/main','usr_sam','preview_ready','replay-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-replay','job-replay',1,?,?, 'tool-v1','policy-v1','preview_ready')`)
      .bind(baseOid, headOid).run();
    await insertMessage(ownMessage('msg-replay', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-replay'
    }));

    // First approval: grant 750 bps
    const res1 = await post({ action: 'approve', messageId: 'msg-replay', grantBps: 750 });
    expect(res1.status).toBe(200);
    const data1: any = await res1.json();
    expect(data1.grantBps).toBe(750);

    const shareBefore: any = await ctx.d1.prepare('SELECT * FROM contributor_shares WHERE merge_attempt_id=?').bind('attempt-replay').first();
    expect(shareBefore.basis_points).toBe(750);
    expect(shareBefore.status).toBe('pending');

    // Exact replay with same bps: succeeds idempotently with 200, reporting 750 bps
    const exactReplay = await post({ action: 'approve', messageId: 'msg-replay', grantBps: 750 });
    expect(exactReplay.status).toBe(200);
    const exactData: any = await exactReplay.json();
    expect(exactData.grantBps).toBe(750);

    // Replay approval with different bps (1500 bps): must return 409 Conflict
    const res2 = await post({ action: 'approve', messageId: 'msg-replay', grantBps: 1500 });
    expect(res2.status).toBe(409);
    const errData2: any = await res2.json();
    expect(errData2.error).toContain('already has a 750 bps (7.50%) grant');

    // Replay approval with 0 bps / omitted: must return 409 Conflict
    const res3 = await post({ action: 'approve', messageId: 'msg-replay' });
    expect(res3.status).toBe(409);
    const errData3: any = await res3.json();
    expect(errData3.error).toContain('already has a 750 bps (7.50%) grant');

    const shareAfter: any = await ctx.d1.prepare('SELECT * FROM contributor_shares WHERE merge_attempt_id=?').bind('attempt-replay').first();
    expect(shareAfter.id).toBe(shareBefore.id);
    expect(shareAfter.basis_points).toBe(750); // Untouched!
    expect(await ctx.d1.prepare('SELECT count(*) AS c FROM contributor_shares WHERE merge_attempt_id=?').bind('attempt-replay').first('c')).toBe(1);
  });

  it('late grant approval: initial approval with 0 bps, subsequent approval with 500 bps binds persisted merge_approval_id', async () => {
    const { baseOid, headOid } = setupTestRepo('repositories/repo-late-grant');
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-late-grant','dronehunter','usr_nate','nate/late-grant','private','refs/heads/main','repositories/repo-late-grant','active',2000)`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-late-grant','repo-late-grant','refs/heads/main','usr_sam','preview_ready','late-grant-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-late-grant','job-late-grant',1,?,?, 'tool-v1','policy-v1','preview_ready')`)
      .bind(baseOid, headOid).run();
    await insertMessage(ownMessage('msg-late-grant', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-late-grant'
    }));

    // First approval with no grant
    const res1 = await post({ action: 'approve', messageId: 'msg-late-grant' });
    expect(res1.status).toBe(200);

    const approvalRow: any = await ctx.d1.prepare('SELECT id FROM merge_approvals WHERE merge_attempt_id = ?')
      .bind('attempt-late-grant').first();
    expect(approvalRow).not.toBeNull();
    const persistedApprovalId = approvalRow.id;

    // Late grant on subsequent approval call
    const res2 = await post({ action: 'approve', messageId: 'msg-late-grant', grantBps: 500 });
    expect(res2.status).toBe(200);
    const data2: any = await res2.json();
    expect(data2.grantBps).toBe(500);

    const shareRow: any = await ctx.d1.prepare('SELECT * FROM contributor_shares WHERE merge_attempt_id = ?')
      .bind('attempt-late-grant').first();
    expect(shareRow).not.toBeNull();
    expect(shareRow.basis_points).toBe(500);
    expect(shareRow.merge_approval_id).toBe(persistedApprovalId);
  });

  it('concurrent interleaving: binds persisted merge_approvals.id atomically via subselect, not an orphaned id', async () => {
    const { baseOid, headOid } = setupTestRepo('repositories/repo-concurrent-bind');
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-concurrent-bind','dronehunter','usr_nate','nate/concurrent-bind','private','refs/heads/main','repositories/repo-concurrent-bind','active',2000)`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-concurrent-bind','repo-concurrent-bind','refs/heads/main','usr_sam','preview_ready','concurrent-bind-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-concurrent-bind','job-concurrent-bind',1,?,?, 'tool-v1','policy-v1','preview_ready')`)
      .bind(baseOid, headOid).run();
    await insertMessage(ownMessage('msg-concurrent-bind', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-concurrent-bind'
    }));

    // Simulate Request A having won the race and persisted an approval row first
    const preexistingApprovalId = 'appr_preexisting_winner_123';
    await ctx.d1.prepare(`
      INSERT INTO merge_approvals (id, merge_attempt_id, approver_user_id, result_commit_oid, decision, comment)
      VALUES (?, 'attempt-concurrent-bind', 'usr_nate', ?, 'approved', 'Pre-existing approval from request A')
    `).bind(preexistingApprovalId, headOid).run();

    // Now Request B arrives to approve with a positive grant (500 bps)
    const resB = await post({ action: 'approve', messageId: 'msg-concurrent-bind', grantBps: 500 });
    expect(resB.status).toBe(200);

    // Verify merge_approvals row still has the original winner ID (ON CONFLICT DO UPDATE didn't change ID)
    const persistedApproval: any = await ctx.d1.prepare(
      'SELECT id, decision FROM merge_approvals WHERE merge_attempt_id = ? AND approver_user_id = ?'
    ).bind('attempt-concurrent-bind', 'usr_nate').first();
    expect(persistedApproval.id).toBe(preexistingApprovalId);

    // Verify contributor_shares row bound to preexistingApprovalId via the atomic subselect (not an orphaned id)
    const share: any = await ctx.d1.prepare(
      'SELECT * FROM contributor_shares WHERE merge_attempt_id = ?'
    ).bind('attempt-concurrent-bind').first();
    expect(share).not.toBeNull();
    expect(share.merge_approval_id).toBe(preexistingApprovalId);
    expect(share.basis_points).toBe(500);
    expect(share.status).toBe('pending');
  });

  it('grant of 0 or absent succeeds with no contributor_shares row created', async () => {
    const { baseOid, headOid } = setupTestRepo('repositories/repo-no-grant');
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-no-grant','dronehunter','usr_nate','nate/no-grant','private','refs/heads/main','repositories/repo-no-grant','active',1000)`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-no-grant','repo-no-grant','refs/heads/main','usr_sam','preview_ready','no-grant-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-no-grant','job-no-grant',1,?,?, 'tool-v1','policy-v1','preview_ready')`)
      .bind(baseOid, headOid).run();
    await insertMessage(ownMessage('msg-no-grant', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-no-grant'
    }));

    const res = await post({ action: 'approve', messageId: 'msg-no-grant' });
    expect(res.status).toBe(200);
    expect(await ctx.d1.prepare('SELECT count(*) AS c FROM contributor_shares WHERE merge_attempt_id=?').bind('attempt-no-grant').first('c')).toBe(0);
    expect(await ctx.d1.prepare('SELECT count(*) AS c FROM merge_approvals WHERE merge_attempt_id=?').bind('attempt-no-grant').first('c')).toBe(1);
  });

  it('rejects grants attached to rejection with 422', async () => {
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-rej-grant','dronehunter','usr_nate','nate/rej-grant','private','refs/heads/main','repositories/repo-rej-grant','active',1000)`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-rej-grant','repo-rej-grant','refs/heads/main','usr_sam','preview_ready','rej-grant-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-rej-grant','job-rej-grant',1,'1111111111111111111111111111111111111111','2222222222222222222222222222222222222222', 'tool-v1','policy-v1','preview_ready')`).run();
    await insertMessage(ownMessage('msg-rej-grant', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-rej-grant'
    }));

    const res = await post({
      action: 'reject',
      messageId: 'msg-rej-grant',
      comment: 'Not quite ready.',
      grantBps: 500
    });
    expect(res.status).toBe(422);
    expect(await ctx.d1.prepare('SELECT count(*) AS c FROM contributor_shares WHERE repository_id=?').bind('repo-rej-grant').first('c')).toBe(0);
  });

  it('rejects invalid grant basis points format with 422', async () => {
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-inv-grant','dronehunter','usr_nate','nate/inv-grant','private','refs/heads/main','repositories/repo-inv-grant','active',1000)`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-inv-grant','repo-inv-grant','refs/heads/main','usr_sam','preview_ready','inv-grant-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-inv-grant','job-inv-grant',1,'1111111111111111111111111111111111111111','2222222222222222222222222222222222222222', 'tool-v1','policy-v1','preview_ready')`).run();
    await insertMessage(ownMessage('msg-inv-grant', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-inv-grant'
    }));

    const negativeRes = await post({ action: 'approve', messageId: 'msg-inv-grant', grantBps: -100 });
    expect(negativeRes.status).toBe(422);

    const nonIntRes = await post({ action: 'approve', messageId: 'msg-inv-grant', grantBps: 'invalid' });
    expect(nonIntRes.status).toBe(422);

    const over10000Res = await post({ action: 'approve', messageId: 'msg-inv-grant', grantBps: 15000 });
    expect(over10000Res.status).toBe(422);
  });

  it('rejects non-numeric, NaN, out-of-range, and conflicting percent/bps inputs with 422', async () => {
    const { baseOid, headOid } = setupTestRepo('repositories/repo-pct-guard');
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
      VALUES ('repo-pct-guard','dronehunter','usr_nate','nate/pct-guard','private','refs/heads/main','repositories/repo-pct-guard','active',3000)`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-pct-guard','repo-pct-guard','refs/heads/main','usr_sam','preview_ready','pct-guard-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-pct-guard','job-pct-guard',1,?,?, 'tool-v1','policy-v1','preview_ready')`)
      .bind(baseOid, headOid).run();
    await insertMessage(ownMessage('msg-pct-guard', {
      user_id: 'usr_nate',
      sender_id: 'usr_sam',
      merge_attempt_id: 'attempt-pct-guard'
    }));

    // grantPercent: "not-a-number" -> 422
    const nanRes = await post({ action: 'approve', messageId: 'msg-pct-guard', grantPercent: 'not-a-number' });
    expect(nanRes.status).toBe(422);
    const nanData: any = await nanRes.json();
    expect(nanData.error).toContain('grantPercent must be a number');

    // grantPercent: "abc" -> 422
    const abcRes = await post({ action: 'approve', messageId: 'msg-pct-guard', grantPercent: 'abc' });
    expect(abcRes.status).toBe(422);

    // grantPercent: -5 -> 422
    const negRes = await post({ action: 'approve', messageId: 'msg-pct-guard', grantPercent: -5 });
    expect(negRes.status).toBe(422);

    // grantPercent: 105 -> 422
    const over100Res = await post({ action: 'approve', messageId: 'msg-pct-guard', grantPercent: 105 });
    expect(over100Res.status).toBe(422);

    // Conflicting grantBps (500) and grantPercent (10% = 1000 bps) -> 422
    const conflictRes = await post({ action: 'approve', messageId: 'msg-pct-guard', grantBps: 500, grantPercent: 10 });
    expect(conflictRes.status).toBe(422);
    const conflictData: any = await conflictRes.json();
    expect(conflictData.error).toContain('conflict');

    // Valid grantPercent: 12.34% -> rounds to 1234 bps
    const validPctRes = await post({ action: 'approve', messageId: 'msg-pct-guard', grantPercent: 12.34 });
    expect(validPctRes.status).toBe(200);
    const validPctData: any = await validPctRes.json();
    expect(validPctData.grantBps).toBe(1234);

    const share: any = await ctx.d1.prepare('SELECT basis_points FROM contributor_shares WHERE merge_attempt_id = ?')
      .bind('attempt-pct-guard').first();
    expect(share.basis_points).toBe(1234);
  });

  describe('Database Triggers (Migration 0030)', () => {
    it('contributor_shares_cap_guard: DB trigger aborts direct insert that exceeds repository grantable_bps', async () => {
      await ctx.d1.prepare(`INSERT OR IGNORE INTO users (id, username, display_name) VALUES ('usr_alice', 'alice', 'Alice')`).run();
      await ctx.d1.prepare(`INSERT INTO repositories
        (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
        VALUES ('repo-trig-cap','dronehunter','usr_nate','nate/trig-cap','private','refs/heads/main','repositories/repo-trig-cap','active',1000)`).run();

      // First direct insert of 600 bps succeeds
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_trig_1', 'repo-trig-cap', 'usr_sam', 'usr_nate', 600, 'pending')
      `).run();

      // Second direct insert of 500 bps (total 1100 > 1000) is aborted by DB trigger
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
          VALUES ('cs_trig_2', 'repo-trig-cap', 'usr_alice', 'usr_nate', 500, 'pending')
        `).run()
      ).rejects.toThrow(/contributor share exceeds available repository grantable pool or repository does not exist/);

      // Third direct insert of 400 bps (total 600 + 400 = 1000 <= 1000) succeeds
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_trig_3', 'repo-trig-cap', 'usr_alice', 'usr_nate', 400, 'pending')
      `).run();

      const total: any = await ctx.d1.prepare(`
        SELECT SUM(basis_points) AS s FROM contributor_shares WHERE repository_id = 'repo-trig-cap' AND status IN ('active', 'pending')
      `).first();
      expect(total.s).toBe(1000);

      // Insert for non-existent repository is aborted by DB trigger
      await expect(
        ctx.d1.prepare(`
          INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
          VALUES ('cs_trig_bad_repo', 'repo-does-not-exist', 'usr_sam', 'usr_nate', 100, 'pending')
        `).run()
      ).rejects.toThrow(/contributor share exceeds available repository grantable pool or repository does not exist/);
    });

    it('repositories_grantable_no_strand: DB trigger aborts lowering grantable_bps below committed grants', async () => {
      await ctx.d1.prepare(`INSERT OR IGNORE INTO users (id, username, display_name) VALUES ('usr_alice', 'alice', 'Alice')`).run();
      await ctx.d1.prepare(`INSERT INTO repositories
        (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status,grantable_bps)
        VALUES ('repo-trig-strand','dronehunter','usr_nate','nate/trig-strand','private','refs/heads/main','repositories/repo-trig-strand','active',2500)`).run();

      // Commit 1500 bps in active and pending shares
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status, activated_at)
        VALUES ('cs_strand_1', 'repo-trig-strand', 'usr_sam', 'usr_nate', 1000, 'active', CURRENT_TIMESTAMP)
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO contributor_shares (id, repository_id, contributor_user_id, granted_by_user_id, basis_points, status)
        VALUES ('cs_strand_2', 'repo-trig-strand', 'usr_alice', 'usr_nate', 500, 'pending')
      `).run();

      // Attempting to lower grantable_bps to 1400 (< 1500 committed) is aborted by DB trigger
      await expect(
        ctx.d1.prepare(`UPDATE repositories SET grantable_bps = 1400 WHERE id = 'repo-trig-strand'`).run()
      ).rejects.toThrow(/repository grantable_bps cannot be lowered below committed grants/);

      // Lowering to exactly 1500 (= 1500 committed) succeeds
      await ctx.d1.prepare(`UPDATE repositories SET grantable_bps = 1500 WHERE id = 'repo-trig-strand'`).run();
      const updated: any = await ctx.d1.prepare(`SELECT grantable_bps FROM repositories WHERE id = 'repo-trig-strand'`).first();
      expect(updated.grantable_bps).toBe(1500);

      // Raising to 3000 succeeds
      await ctx.d1.prepare(`UPDATE repositories SET grantable_bps = 3000 WHERE id = 'repo-trig-strand'`).run();
      const raised: any = await ctx.d1.prepare(`SELECT grantable_bps FROM repositories WHERE id = 'repo-trig-strand'`).first();
      expect(raised.grantable_bps).toBe(3000);
    });
  });

  it('no longer renders the Reward Contributor UI inside the INBOX window (task #42)', () => {
    // The contributor-reward control lived in the cloud merge-proposal pane, which
    // was removed when INBOX became a single-purpose local agent-mailbox observer.
    // The grant-recording BACKEND (exercised throughout this file) is unchanged;
    // only its presence in the INBOX window is gone. This asserts that removal.
    const html = renderToString(React.createElement(AuthProvider, null, React.createElement(InboxView)));
    expect(html).toContain('Local Agent Mailbox');
    expect(html).not.toContain('Reward Contributor');
    expect(html).not.toContain('No Message Selected');
  });
});

