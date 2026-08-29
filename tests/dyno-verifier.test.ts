import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import { onRequestGet, onRequestPost } from '../functions/api/dyno-verifier';

const workerSecret = 'dyno-worker-secret-for-tests-1234567890';
const hex = (char: string) => char.repeat(64);

async function sha(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('DYNO trusted reproduction verifier', () => {
  let ctx: TestD1Context;
  const storage = {
    head: async (key: string) => key === 'traces/run.json'
      ? { key, customMetadata: { sha256: hex('d') } }
      : null,
    delete: async (_key: string) => undefined
  };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await ctx.d1.batch([
      ctx.d1.prepare(`INSERT INTO dyno_suites
        (id, slug, version, name, methodology_markdown, task_manifest_digest, grader_version, status)
        VALUES ('suite_dyno_neutral_2026', 'dyno-standard-dev', '2026.1', 'DYNO', 'method', ?, 'grader-v1', 'active')`).bind(hex('a')),
      ctx.d1.prepare(`INSERT INTO dyno_subjects
        (id, model_provider, model_id, model_version, model_config, agent_harness, harness_version, tool_manifest)
        VALUES ('subject_test', 'provider', 'model', 'revision-1', ?, 'harness', '1.0', ?)`)
        .bind(JSON.stringify({ temperature: 0 }), JSON.stringify(['read', 'exec'])),
      ctx.d1.prepare(`INSERT INTO dyno_environments
        (id, os_name, os_version, architecture, container_image_digest, runtime_manifest, network_policy)
        VALUES ('environment_test', 'Linux', '1', 'x64', ?, ?, 'none')`)
        .bind(hex('b'), JSON.stringify({ node: '25' })),
      ctx.d1.prepare(`INSERT INTO dyno_runs
        (id, suite_id, subject_id, environment_id, submitted_by_user_id, repetition,
         randomization_seed, status, verification_status, runner_attestation_digest,
         raw_trace_r2_key, raw_trace_sha256)
        VALUES ('run_verifier_test', 'suite_dyno_neutral_2026', 'subject_test', 'environment_test',
          'usr_nate', 1, 'seed-1', 'completed', 'unverified', ?, 'traces/run.json', ?)`)
        .bind(hex('c'), hex('d'))
    ]);
  });

  const userPost = (body: unknown) => onRequestPost({
    request: new Request('http://localhost/api/dyno-verifier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
      body: JSON.stringify(body)
    }),
    env: { DB: ctx.d1, STORAGE: storage }
  });

  const workerPost = (body: unknown, overrides: Record<string, unknown> = {}) => onRequestPost({
    request: new Request('http://localhost/api/dyno-verifier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerSecret}` },
      body: JSON.stringify(body)
    }),
    env: { DB: ctx.d1, STORAGE: storage, DYNO_VERIFIER_ENABLED: 'true', DYNO_WORKER_SECRET: workerSecret, ...overrides }
  });

  it('queues an owner-bound reproduction pinned to the complete replay identity', async () => {
    const response = await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' });
    expect(response.status).toBe(202);
    const body: any = await response.json();
    expect(body.job.status).toBe('queued');
    expect(body.job.replay_identity_digest).toMatch(/^[a-f0-9]{64}$/);

    const row: any = await ctx.d1.prepare('SELECT * FROM dyno_verifier_jobs WHERE id = ?').bind(body.job.id).first();
    expect(row.requested_by_user_id).toBe('usr_nate');
    expect(row.source_trace_digest).toBe(hex('d'));
    expect(row.requested_class).toBe('reproduced');
  });

  it('is idempotent for the same run and replay identity', async () => {
    const first: any = await (await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' })).json();
    const second: any = await (await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' })).json();
    expect(second.job.id).toBe(first.job.id);
    const count: any = await ctx.d1.prepare('SELECT count(*) AS n FROM dyno_verifier_jobs').first();
    expect(count.n).toBe(1);
  });

  it('fails closed when source trace evidence is absent', async () => {
    await ctx.d1.prepare("UPDATE dyno_runs SET raw_trace_r2_key = NULL WHERE id = 'run_verifier_test'").run();
    const response = await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' });
    expect(response.status).toBe(409);
    expect((await response.json() as any).error).toContain('source trace is unavailable');
  });

  it('requires a commissioned worker and a valid dedicated secret', async () => {
    await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' });
    const disabled = await onRequestPost({
      request: new Request('http://localhost/api/dyno-verifier', {
        method: 'POST', headers: { Authorization: `Bearer ${workerSecret}` },
        body: JSON.stringify({ action: 'worker.claim', workerId: 'worker_test' })
      }),
      env: { DB: ctx.d1, DYNO_WORKER_SECRET: workerSecret }
    });
    expect(disabled.status).toBe(503);

    const wrong = await onRequestPost({
      request: new Request('http://localhost/api/dyno-verifier', {
        method: 'POST', headers: { Authorization: `Bearer ${'x'.repeat(workerSecret.length)}` },
        body: JSON.stringify({ action: 'worker.claim', workerId: 'worker_test' })
      }),
      env: { DB: ctx.d1, DYNO_VERIFIER_ENABLED: 'true', DYNO_WORKER_SECRET: workerSecret }
    });
    expect(wrong.status).toBe(401);
  });

  it('leases once and promotes only after result evidence is bound to the exact job', async () => {
    await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' });
    const claimResponse = await workerPost({ action: 'worker.claim', workerId: 'worker_test' });
    const claim: any = (await claimResponse.json()).job;
    expect(claim.claimToken).toMatch(/^claim_/);

    const second: any = await (await workerPost({ action: 'worker.claim', workerId: 'worker_other' })).json();
    expect(second.job).toBeNull();

    const resultDigest = hex('e');
    const binding = await sha({
      jobId: claim.id,
      runId: claim.run_id,
      replayIdentityDigest: claim.replay_identity_digest,
      resultDigest,
      workerId: 'worker_test'
    });
    const completed = await workerPost({
      action: 'worker.complete',
      jobId: claim.id,
      claimToken: claim.claimToken,
      replayIdentityDigest: claim.replay_identity_digest,
      resultDigest,
      resultAttestationDigest: hex('f'),
      resultBindingDigest: binding
    });
    expect(completed.status).toBe(200);

    const run: any = await ctx.d1.prepare("SELECT verification_status, evaluation_class FROM dyno_runs WHERE id = 'run_verifier_test'").first();
    expect(run.verification_status).toBe('reproducible');
    expect(run.evaluation_class).toBe('reproduced');
  });

  it('does not promote evidence with an invalid result binding', async () => {
    await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' });
    const claim: any = (await (await workerPost({ action: 'worker.claim', workerId: 'worker_test' })).json()).job;
    const response = await workerPost({
      action: 'worker.complete', jobId: claim.id, claimToken: claim.claimToken,
      replayIdentityDigest: claim.replay_identity_digest, resultDigest: hex('e'),
      resultAttestationDigest: hex('f'), resultBindingDigest: hex('0')
    });
    expect(response.status).toBe(400);
    const run: any = await ctx.d1.prepare("SELECT verification_status FROM dyno_runs WHERE id = 'run_verifier_test'").first();
    expect(run.verification_status).toBe('unverified');
  });

  it('reclaims an expired lease with a new claim token', async () => {
    const queued: any = await (await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' })).json();
    await ctx.d1.prepare(`UPDATE dyno_verifier_jobs SET status = 'leased', claim_token = 'claim_expired',
      lease_expires_at = datetime('now', '-1 minute') WHERE id = ?`).bind(queued.job.id).run();
    const reclaimed: any = await (await workerPost({ action: 'worker.claim', workerId: 'worker_reclaimer' })).json();
    expect(reclaimed.job.id).toBe(queued.job.id);
    expect(reclaimed.job.claimToken).not.toBe('claim_expired');
  });

  it('dead-letters an inconclusive job after its bounded final attempt', async () => {
    const queued: any = await (await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' })).json();
    await ctx.d1.prepare('UPDATE dyno_verifier_jobs SET max_attempts = 1 WHERE id = ?').bind(queued.job.id).run();
    const claim: any = (await (await workerPost({ action: 'worker.claim', workerId: 'worker_test' })).json()).job;
    const failed = await workerPost({
      action: 'worker.fail', jobId: claim.id, claimToken: claim.claimToken, errorCode: 'provider_unavailable'
    });
    expect((await failed.json() as any).status).toBe('dead_letter');
    const row: any = await ctx.d1.prepare('SELECT status, dead_lettered_at, claim_token FROM dyno_verifier_jobs WHERE id = ?').bind(claim.id).first();
    expect(row.status).toBe('dead_letter');
    expect(row.dead_lettered_at).toBeTruthy();
    expect(row.claim_token).toBeNull();
  });

  it('releases a claim when pinned trace evidence disappears', async () => {
    await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' });
    const response = await workerPost(
      { action: 'worker.claim', workerId: 'worker_test' },
      { STORAGE: { head: async () => null } }
    );
    expect(response.status).toBe(409);
    const row: any = await ctx.d1.prepare('SELECT status, claim_token, last_error_code FROM dyno_verifier_jobs').first();
    expect(row.status).toBe('retryable_failure');
    expect(row.claim_token).toBeNull();
    expect(row.last_error_code).toBe('trace_evidence_missing');
  });

  it('deletes the R2 object before clearing its key and retains only audit digests', async () => {
    const deleted: string[] = [];
    const response = await onRequestPost({
      request: new Request('http://localhost/api/dyno-verifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify({ action: 'delete_trace', runId: 'run_verifier_test' })
      }),
      env: { DB: ctx.d1, STORAGE: { delete: async (key: string) => { deleted.push(key); } } }
    });
    expect(response.status).toBe(200);
    expect(deleted).toEqual(['traces/run.json']);
    const run: any = await ctx.d1.prepare("SELECT raw_trace_r2_key, raw_trace_sha256 FROM dyno_runs WHERE id = 'run_verifier_test'").first();
    expect(run.raw_trace_r2_key).toBeNull();
    expect(run.raw_trace_sha256).toBe(hex('d'));
    const audit: any = await ctx.d1.prepare("SELECT r2_key, status, deletion_receipt_digest FROM dyno_trace_retention_requests WHERE run_id = 'run_verifier_test'").first();
    expect(audit.r2_key).toBeNull();
    expect(audit.status).toBe('deleted');
    expect(audit.deletion_receipt_digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps the trace key when object deletion fails', async () => {
    await expect(onRequestPost({
      request: new Request('http://localhost/api/dyno-verifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify({ action: 'delete_trace', runId: 'run_verifier_test' })
      }),
      env: { DB: ctx.d1, STORAGE: { delete: async () => { throw new Error('r2 unavailable'); } } }
    })).rejects.toThrow('r2 unavailable');
    const run: any = await ctx.d1.prepare("SELECT raw_trace_r2_key FROM dyno_runs WHERE id = 'run_verifier_test'").first();
    expect(run.raw_trace_r2_key).toBe('traces/run.json');
  });

  it('returns only owner-visible verifier job detail', async () => {
    const queued: any = await (await userPost({ action: 'request_reproduction', runId: 'run_verifier_test' })).json();
    const response = await onRequestGet({
      request: new Request(`http://localhost/api/dyno-verifier?id=${queued.job.id}`, {
        headers: { Authorization: 'Bearer test_token_nate' }
      }),
      env: { DB: ctx.d1 }
    });
    expect(response.status).toBe(200);
    expect((await response.json() as any).job.source_trace_r2_key).toBeUndefined();
  });
});
