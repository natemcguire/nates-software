// Spec RIG Fix 1 — signed, immutable R2 verification-evidence bundle.
// A completed passing RIG verification run must assemble ONE immutable bundle
// (logs + test report + artifact digests + network/isolation attestation +
// runtime identity + result digest), store it in R2 keyed by build/attempt id,
// and record its sha256 + R2 key on build_runs. INBOX approval must then load
// and re-verify that exact bundle before it may approve — failing closed if
// the bundle is missing, R2 is unavailable, or the recomputed digest mismatches.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import { onRequestPost as verificationPost } from '../functions/api/rig-verification';
import * as inboxApi from '../functions/api/inbox';
import { initBareRepo, updateAuthoritativeRefCas } from '../src/lib/gitsmith/gitStorage';

const secret = 'rig_worker_secret_'.padEnd(40, 'x');
const workerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` };
const authHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' };

// A minimal in-memory R2 mock: supports put/get/head, mirroring the shape
// used elsewhere in this suite (see dyno-verifier.test.ts).
class MemoryR2 {
  private store = new Map<string, { bytes: Uint8Array; customMetadata?: Record<string, string> }>();
  public failPut = false;
  public failGet = false;

  async put(key: string, value: Uint8Array, options?: any) {
    if (this.failPut) throw new Error('Simulated R2 put failure');
    this.store.set(key, { bytes: value, customMetadata: options?.customMetadata });
    return { key };
  }

  async get(key: string) {
    if (this.failGet) return null;
    const entry = this.store.get(key);
    if (!entry) return null;
    return { arrayBuffer: async () => entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength) };
  }

  async head(key: string) {
    const entry = this.store.get(key);
    return entry ? { key, customMetadata: entry.customMetadata } : null;
  }

  corrupt(key: string) {
    const entry = this.store.get(key);
    if (entry) entry.bytes = new TextEncoder().encode('{"tampered":true}');
  }

  delete(key: string) {
    this.store.delete(key);
  }
}

describe('RIG verification evidence bundle (Fix 1)', () => {
  let ctx: TestD1Context;
  let storage: MemoryR2;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    storage = new MemoryR2();
  });

  async function seedVerificationWorkflow(suffix: string) {
    const targetOid = 'a'.repeat(40);
    const resultOid = 'b'.repeat(40);
    const repoId = `repo-${suffix}`;
    const jobId = `job-${suffix}`;
    const attemptId = `attempt-${suffix}`;
    const buildId = `build-${suffix}`;
    const eventId = `verify-${suffix}`;
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES (?,'usr_nate',?,'private','refs/heads/main',?,'active')`).bind(repoId, suffix, `repositories/${repoId}`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,expected_target_oid,status,idempotency_key,active_attempt_number)
      VALUES (?,?,'refs/heads/main','usr_sam',?,'queued',?,1)`).bind(jobId, repoId, targetOid, `key-${suffix}`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES (?,?,1,?,?,'tool','policy','preparing')`).bind(attemptId, jobId, targetOid, resultOid).run();
    await ctx.d1.prepare(`INSERT INTO build_runs
      (id,repository_id,commit_oid,merge_attempt_id,purpose,status,runner_image_digest,build_command,test_command,source_manifest_digest)
      VALUES (?,?,?,?,'verification','queued',?,'npm run build','npm test',?)`)
      .bind(buildId, repoId, resultOid, attemptId, `node@sha256:${'c'.repeat(64)}`, `sha256:${'d'.repeat(64)}`).run();
    const payload = { buildRunId: buildId, mergeJobId: jobId, mergeAttemptId: attemptId,
      repositoryId: repoId, targetRef: 'refs/heads/main', sourceRef: 'refs/heads/feature',
      storageKey: `repositories/${repoId}`, expectedTargetOid: targetOid, resultCommitOid: resultOid };
    await ctx.d1.prepare(`INSERT INTO forge_outbox_events
      (id,aggregate_type,aggregate_id,event_type,payload,attempts)
      VALUES (?,'build',?,'build.verification_requested',?,0)`).bind(eventId, buildId, JSON.stringify(payload)).run();
    return { repoId, jobId, attemptId, buildId, eventId, resultOid, targetOid };
  }

  function post(body: unknown, env: any = {}) {
    return verificationPost({
      request: new Request('https://example.test/api/rig-verification', {
        method: 'POST', headers: workerHeaders, body: JSON.stringify(body)
      }),
      env: { DB: ctx.d1, RIG_GATEWAY_SERVICE_SECRET: secret, STORAGE: storage, ...env }
    });
  }

  async function claimEvent(seeded: Awaited<ReturnType<typeof seedVerificationWorkflow>>) {
    const claim: any = await (await post({ action: 'claim' })).json();
    expect(claim.claim.eventId).toBe(seeded.eventId);
    return claim.claim.claimToken as string;
  }

  const passingEvidence = {
    logs: 'npm run build\n> build ok\nnpm test\n> 42 passed',
    testReport: { passed: 42, failed: 0 },
    isolationAttestation: { containerRuntime: 'docker', networkMode: 'bridge', memoryLimit: '256m' },
    runtimeIdentity: { runnerImageDigest: `node@sha256:${'c'.repeat(64)}`, toolchainVersion: 'tool', testPolicyVersion: 'policy' }
  };

  describe('1. Bundle assembly on a completed passing verification', () => {
    it('stores one immutable evidence bundle in R2 and records its sha256 + key on build_runs', async () => {
      const seeded = await seedVerificationWorkflow('bundle-pass');
      const claimToken = await claimEvent(seeded);

      const res = await post({
        action: 'complete', eventId: seeded.eventId, claimToken, status: 'passed',
        resultDigest: `sha256:${'e'.repeat(64)}`, exitCode: 0, durationMs: 4200,
        evidence: passingEvidence
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.evidenceBundleR2Key).toBe(`verification-evidence/${seeded.buildId}/${seeded.eventId}.json`);
      expect(data.evidenceBundleSha256).toMatch(/^sha256:[a-f0-9]{64}$/);

      const row: any = await ctx.d1.prepare(`
        SELECT evidence_bundle_r2_key AS r2Key, evidence_bundle_sha256 AS sha256, evidence_bundle_recorded_at AS recordedAt
        FROM build_runs WHERE id = ?
      `).bind(seeded.buildId).first();
      expect(row.r2Key).toBe(data.evidenceBundleR2Key);
      expect(row.sha256).toBe(data.evidenceBundleSha256);
      expect(row.recordedAt).toBeTruthy();

      // The R2 object exists and its bytes hash to the recorded digest.
      const stored = await storage.get(row.r2Key);
      expect(stored).toBeTruthy();
      const bytes = new Uint8Array(await stored!.arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      expect(`sha256:${hex}`).toBe(row.sha256);

      // The bundle contains the full contract: logs, testReport, artifactDigests,
      // networkPolicy/isolationAttestation, runtimeIdentity, resultDigest.
      const bundle = JSON.parse(new TextDecoder().decode(bytes));
      expect(bundle.logs).toBe(passingEvidence.logs);
      expect(bundle.testReport).toEqual(passingEvidence.testReport);
      expect(bundle.networkPolicy).toEqual(passingEvidence.isolationAttestation);
      expect(bundle.runtimeIdentity).toEqual(passingEvidence.runtimeIdentity);
      expect(bundle.resultDigest).toBe(`sha256:${'e'.repeat(64)}`);
      expect(Array.isArray(bundle.artifactDigests)).toBe(true);

      // An 'attestation' build_artifacts row points at the bundle too.
      const artifact: any = await ctx.d1.prepare(`
        SELECT kind, r2_key AS r2Key, sha256 FROM build_artifacts WHERE build_run_id = ? AND kind = 'attestation'
      `).bind(seeded.buildId).first();
      expect(artifact.r2Key).toBe(row.r2Key);
      expect(artifact.sha256).toBe(row.sha256);
    });

    it('fails closed with 503 and does not advance the merge attempt when STORAGE is unavailable', async () => {
      const seeded = await seedVerificationWorkflow('bundle-nostorage');
      const claimToken = await claimEvent(seeded);

      const res = await post({
        action: 'complete', eventId: seeded.eventId, claimToken, status: 'passed',
        resultDigest: `sha256:${'e'.repeat(64)}`, exitCode: 0, durationMs: 1000,
        evidence: passingEvidence
      }, { STORAGE: undefined });
      expect(res.status).toBe(503);
      const data: any = await res.json();
      expect(data.success).toBe(false);

      // Nothing advanced: build_run is still running, no proposal was created.
      expect(await ctx.d1.prepare('SELECT status FROM build_runs WHERE id=?').bind(seeded.buildId).first('status')).toBe('running');
      expect(await ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind(seeded.jobId).first('status')).toBe('queued');
      expect(await ctx.d1.prepare('SELECT count(*) AS c FROM inbox_messages WHERE merge_attempt_id=?').bind(seeded.attemptId).first('c')).toBe(0);
    });

    it('fails closed with 503 when the R2 put itself fails', async () => {
      const seeded = await seedVerificationWorkflow('bundle-putfail');
      const claimToken = await claimEvent(seeded);
      storage.failPut = true;

      const res = await post({
        action: 'complete', eventId: seeded.eventId, claimToken, status: 'passed',
        resultDigest: `sha256:${'e'.repeat(64)}`, exitCode: 0, durationMs: 1000,
        evidence: passingEvidence
      });
      expect(res.status).toBe(503);
      expect(await ctx.d1.prepare('SELECT status FROM build_runs WHERE id=?').bind(seeded.buildId).first('status')).toBe('running');
    });

    it('does not require or store a bundle for a failed verification run', async () => {
      const seeded = await seedVerificationWorkflow('bundle-fail');
      const claimToken = await claimEvent(seeded);

      const res = await post({
        action: 'complete', eventId: seeded.eventId, claimToken, status: 'failed', exitCode: 1, durationMs: 500
      }, { STORAGE: undefined }); // even with STORAGE unavailable, a failed run must not be blocked by the evidence gate
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.evidenceBundleR2Key).toBeNull();
      const row: any = await ctx.d1.prepare('SELECT evidence_bundle_r2_key AS r2Key FROM build_runs WHERE id=?').bind(seeded.buildId).first();
      expect(row.r2Key).toBeNull();
    });
  });

  describe('2. INBOX approval fails closed on missing/mismatched evidence bundle', () => {
    let tempDir: string;
    let reposRoot: string;
    let baseOid: string;
    let headOid: string;
    const storageKey = 'repositories/repo-evidence-gate';

    beforeEach(() => {
      tempDir = path.join('/tmp', `gitsmith-evidence-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      reposRoot = path.join(tempDir, 'repos');
      fs.mkdirSync(reposRoot, { recursive: true });

      initBareRepo(reposRoot, { storageKey, objectFormat: 'sha1', defaultRef: 'refs/heads/main' });
      const workTree = path.join(tempDir, 'worktree');
      fs.mkdirSync(workTree, { recursive: true });
      execFileSync('git', ['init', workTree], { stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'Evidence Tester'], { cwd: workTree, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'evidence@nates.software'], { cwd: workTree, stdio: 'pipe' });

      fs.writeFileSync(path.join(workTree, 'README.md'), '# base\n');
      execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'base commit'], { cwd: workTree, stdio: 'pipe' });
      baseOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8' }).trim();

      fs.writeFileSync(path.join(workTree, 'feature.ts'), 'export const x = 1;\n');
      execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'feature commit'], { cwd: workTree, stdio: 'pipe' });
      headOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8' }).trim();

      execFileSync('git', ['remote', 'add', 'origin', path.join(reposRoot, storageKey)], { cwd: workTree, stdio: 'pipe' });
      execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/feature'], { cwd: workTree, stdio: 'pipe' });

      const casInit = updateAuthoritativeRefCas(reposRoot, {
        storageKey, refName: 'refs/heads/main', newOid: baseOid, expectedOldOid: null, operation: 'create'
      });
      expect(casInit.success).toBe(true);
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function seedApprovableProposal(suffix: string) {
      const repoId = `repo-evidence-${suffix}`;
      const jobId = `job-evidence-${suffix}`;
      const attemptId = `attempt-evidence-${suffix}`;
      const buildId = `build-evidence-${suffix}`;
      const messageId = `msg-evidence-${suffix}`;
      await ctx.d1.prepare(`INSERT INTO repositories
        (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
        VALUES (?, 'dronehunter','usr_nate',?, 'public','refs/heads/main',?, 'active')`)
        .bind(repoId, `nate/${repoId}`, storageKey).run();
      await ctx.d1.prepare(`INSERT INTO merge_jobs
        (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
        VALUES (?, ?, 'refs/heads/main','usr_sam', 'preview_ready', ?)`)
        .bind(jobId, repoId, `idem-${jobId}`).run();
      await ctx.d1.prepare(`INSERT INTO merge_attempts
        (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
        VALUES (?, ?, 1, ?, ?, 'tool-v1','policy-v1', 'preview_ready')`)
        .bind(attemptId, jobId, baseOid, headOid).run();
      await ctx.d1.prepare(`INSERT INTO inbox_messages
        (id,user_id,sender_id,title,preview,content,feature_ref,cas_new_sha,is_merged,unread,message_kind,merge_attempt_id)
        VALUES (?, 'usr_nate','usr_sam','feat: PR','Preview','Please review','refs/heads/feature',?,0,1,'proposal',?)`)
        .bind(messageId, headOid, attemptId).run();
      await ctx.d1.prepare(`INSERT INTO build_runs
        (id,repository_id,commit_oid,merge_attempt_id,purpose,status,runner_image_digest,build_command,test_command,source_manifest_digest)
        VALUES (?,?,?,?,'verification','passed',?,'npm run build','npm test',?)`)
        .bind(buildId, repoId, headOid, attemptId, `node@sha256:${'c'.repeat(64)}`, `sha256:${'d'.repeat(64)}`).run();
      return { repoId, jobId, attemptId, buildId, messageId };
    }

    function approveRequest(body: unknown, env: any = {}) {
      return inboxApi.onRequestPost({
        request: new Request('http://localhost/api/inbox', {
          method: 'POST', headers: authHeaders, body: JSON.stringify(body)
        }),
        env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot, STORAGE: storage, ...env }
      });
    }

    it('fails closed with 409 when no evidence bundle is recorded on the passing build_run', async () => {
      const seeded = await seedApprovableProposal('missing-bundle');
      // build_runs.evidence_bundle_r2_key / sha256 are left NULL — as if verification
      // predates the evidence-bundle requirement, or was never asked to produce one.
      const res = await approveRequest({
        action: 'approve', messageId: seeded.messageId, comment: 'Approving.',
        reviewedTargetOid: baseOid, reviewedSourceOid: headOid
      });
      expect(res.status).toBe(409);
      const data: any = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('evidence bundle');

      const attemptRow: any = await ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind(seeded.attemptId).first();
      expect(attemptRow.status).toBe('preview_ready');
      const outboxEvent = await ctx.d1.prepare('SELECT * FROM forge_outbox_events WHERE aggregate_id=?').bind(seeded.attemptId).first();
      expect(outboxEvent).toBeNull();
    });

    it('fails closed with 409 when the recorded bundle is missing from R2', async () => {
      const seeded = await seedApprovableProposal('r2-missing');
      await ctx.d1.prepare(`UPDATE build_runs SET evidence_bundle_r2_key = ?, evidence_bundle_sha256 = ? WHERE id = ?`)
        .bind('verification-evidence/nonexistent/nonexistent.json', `sha256:${'f'.repeat(64)}`, seeded.buildId).run();

      const res = await approveRequest({
        action: 'approve', messageId: seeded.messageId, comment: 'Approving.',
        reviewedTargetOid: baseOid, reviewedSourceOid: headOid
      });
      expect(res.status).toBe(409);
      const data: any = await res.json();
      expect(data.error).toContain('missing from R2');
    });

    it('fails closed with 409 when the R2 bytes no longer match the recorded digest (tampered evidence)', async () => {
      const seeded = await seedApprovableProposal('tampered');
      const key = `verification-evidence/${seeded.buildId}/evt.json`;
      const bytes = new TextEncoder().encode(JSON.stringify({ logs: 'original', resultDigest: 'sha256:' + 'a'.repeat(64) }));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      await storage.put(key, bytes);
      await ctx.d1.prepare(`UPDATE build_runs SET evidence_bundle_r2_key = ?, evidence_bundle_sha256 = ? WHERE id = ?`)
        .bind(key, `sha256:${hex}`, seeded.buildId).run();

      // Now tamper with the R2 object after the digest was recorded.
      storage.corrupt(key);

      const res = await approveRequest({
        action: 'approve', messageId: seeded.messageId, comment: 'Approving.',
        reviewedTargetOid: baseOid, reviewedSourceOid: headOid
      });
      expect(res.status).toBe(409);
      const data: any = await res.json();
      expect(data.error).toContain('does not match its recorded digest');
    });

    it('fails closed with 503 when evidence storage is unavailable at approval time', async () => {
      const seeded = await seedApprovableProposal('no-storage-at-approve');
      await ctx.d1.prepare(`UPDATE build_runs SET evidence_bundle_r2_key = ?, evidence_bundle_sha256 = ? WHERE id = ?`)
        .bind('verification-evidence/x/y.json', `sha256:${'a'.repeat(64)}`, seeded.buildId).run();

      const res = await approveRequest({
        action: 'approve', messageId: seeded.messageId, comment: 'Approving.',
        reviewedTargetOid: baseOid, reviewedSourceOid: headOid
      }, { STORAGE: undefined });
      expect(res.status).toBe(503);
    });

    it('approves successfully when a valid, matching evidence bundle is present in R2', async () => {
      const seeded = await seedApprovableProposal('valid-bundle');
      const key = `verification-evidence/${seeded.buildId}/evt.json`;
      const bytes = new TextEncoder().encode(JSON.stringify({ logs: 'all good', resultDigest: 'sha256:' + 'a'.repeat(64) }));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      await storage.put(key, bytes);
      await ctx.d1.prepare(`UPDATE build_runs SET evidence_bundle_r2_key = ?, evidence_bundle_sha256 = ? WHERE id = ?`)
        .bind(key, `sha256:${hex}`, seeded.buildId).run();

      const res = await approveRequest({
        action: 'approve', messageId: seeded.messageId, comment: 'Approving with valid evidence.',
        reviewedTargetOid: baseOid, reviewedSourceOid: headOid
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.approvalStatus).toBe('approved');
    });

    it('does not require an evidence bundle for rejections', async () => {
      const seeded = await seedApprovableProposal('reject-no-bundle');
      const res = await approveRequest({ action: 'reject', messageId: seeded.messageId, comment: 'Needs more work, not ready.' });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.approvalStatus).toBe('rejected');
    });
  });
});
