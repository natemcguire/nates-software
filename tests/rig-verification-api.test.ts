import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import { onRequestGet, onRequestPost } from '../functions/api/rig-verification';
import { validateArchiveEntries } from '../src/lib/rig/verificationWorker';

const secret = 'rig_worker_secret_'.padEnd(40, 'x');
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` };

describe('RIG verification worker control plane', () => {
  let ctx: TestD1Context;
  beforeEach(async () => { ctx = await createTestD1Database({ foreignKeys: true }); });

  async function seed(suffix: string) {
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
      VALUES (? ,?,'refs/heads/main','usr_sam',?,'queued',?,1)`).bind(jobId, repoId, targetOid, `key-${suffix}`).run();
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
    return { repoId, jobId, attemptId, buildId, eventId, resultOid };
  }

  // Minimal in-memory R2 mock so passing-verification evidence bundle writes
  // (Fix 1, RIG spec) succeed in these pre-existing worker-flow tests.
  const storage = {
    store: new Map<string, Uint8Array>(),
    async put(key: string, value: Uint8Array) { this.store.set(key, value); return { key }; },
    async get(key: string) {
      const bytes = this.store.get(key);
      if (!bytes) return null;
      return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
  };

  const post = (body: unknown, authorized = true) => onRequestPost({
    request: new Request('https://example.test/api/rig-verification', {
      method: 'POST', headers: authorized ? headers : { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }), env: { DB: ctx.d1, RIG_GATEWAY_SERVICE_SECRET: secret, STORAGE: storage as any }
  });

  it('requires the private worker credential', async () => {
    expect((await post({ action: 'claim' }, false)).status).toBe(401);
  });

  it('rejects traversal and absolute paths before archive extraction', () => {
    expect(() => validateArchiveEntries(['src/index.ts', 'package.json'])).not.toThrow();
    expect(() => validateArchiveEntries(['../escape'])).toThrow(/Unsafe archive/);
    expect(() => validateArchiveEntries(['/absolute'])).toThrow(/Unsafe archive/);
    expect(() => validateArchiveEntries(['safe/../../escape'])).toThrow(/Unsafe archive/);
  });

  it('claims once and advances only passing evidence to a preview-ready INBOX proposal', async () => {
    const seeded = await seed('pass');
    const claimResponse = await post({ action: 'claim' });
    const claim: any = await claimResponse.json();
    expect(claim.claim.eventId).toBe(seeded.eventId);
    expect((await post({ action: 'claim' }).then(response => response.json()) as any).claim).toBeNull();
    expect(await ctx.d1.prepare('SELECT status FROM build_runs WHERE id=?').bind(seeded.buildId).first('status')).toBe('running');

    const completion = await post({ action: 'complete', eventId: seeded.eventId,
      claimToken: claim.claim.claimToken, status: 'passed', resultDigest: `sha256:${'e'.repeat(64)}`,
      exitCode: 0, durationMs: 1234 });
    expect(completion.status).toBe(200);
    expect(await completion.json()).toMatchObject({ success: true, status: 'passed',
      mergeAttemptStatus: 'preview_ready', proposalId: `proposal:${seeded.attemptId}` });
    expect(await ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind(seeded.jobId).first('status')).toBe('preview_ready');
    expect(await ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind(seeded.attemptId).first('status')).toBe('preview_ready');
    expect(await ctx.d1.prepare('SELECT result_digest FROM build_runs WHERE id=?').bind(seeded.buildId).first('result_digest')).toBe(`sha256:${'e'.repeat(64)}`);
    expect(await ctx.d1.prepare('SELECT user_id FROM inbox_messages WHERE id=?').bind(`proposal:${seeded.attemptId}`).first('user_id')).toBe('usr_nate');
  });

  it('relays an exact authoritative archive only for a live claim', async () => {
    const seeded = await seed('source');
    const claim: any = await (await post({ action: 'claim' })).json();
    const archive = new Uint8Array([1, 2, 3, 4]);
    const source = await onRequestGet({
      request: new Request(`https://example.test/api/rig-verification?eventId=${seeded.eventId}&claimToken=${claim.claim.claimToken}`, {
        headers: { Authorization: `Bearer ${secret}` }
      }),
      env: { DB: ctx.d1, RIG_GATEWAY_SERVICE_SECRET: secret, GITSMITH_GATEWAY_URL: 'https://forge.test',
        GITSMITH_GATEWAY_TOKEN: 'forge-secret', __GITSMITH_GATEWAY_FETCH: async (input, init) => {
          expect(String(input)).toContain(`commitOid=${seeded.resultOid}`);
          expect((init?.headers as any).Authorization).toBe('Bearer forge-secret');
          return new Response(archive, { headers: { 'X-Gitsmith-Commit-Oid': seeded.resultOid } });
        } }
    });
    expect(source.status).toBe(200);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(archive);
  });

  it('records failed verification without creating an approvable proposal', async () => {
    const seeded = await seed('fail');
    const claim: any = await (await post({ action: 'claim' })).json();
    const completion = await post({ action: 'complete', eventId: seeded.eventId,
      claimToken: claim.claim.claimToken, status: 'failed', exitCode: 1, durationMs: 900 });
    expect(completion.status).toBe(200);
    expect(await ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind(seeded.jobId).first('status')).toBe('failed');
    expect(await ctx.d1.prepare('SELECT count(*) AS count FROM inbox_messages WHERE merge_attempt_id=?').bind(seeded.attemptId).first('count')).toBe(0);
  });
});
