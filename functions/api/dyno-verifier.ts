import { requireAuth } from './_auth';

const SHA256 = /^[a-f0-9]{64}$/i;
const ID = /^[a-zA-Z0-9_-]{4,128}$/;
const MAX_BODY_BYTES = 64 * 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

async function parseBody(request: Request): Promise<any> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new Error('payload_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('payload_too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid_json');
  }
}

async function workerAuthorized(request: Request, env: any): Promise<boolean> {
  const configured = String(env?.DYNO_WORKER_SECRET || '');
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (configured.length < 32 || supplied.length !== configured.length) return false;
  const [a, b] = await Promise.all([digest(configured), digest(supplied)]);
  return a === b;
}

async function loadReplayIdentity(db: any, runId: string): Promise<any | null> {
  return db.prepare(`
    SELECT r.id, r.submitted_by_user_id, r.verification_status, r.evaluation_class,
           r.randomization_seed, r.repetition, r.raw_trace_sha256, r.raw_trace_r2_key,
           r.runner_attestation_digest,
           su.id AS suite_id, su.version AS suite_version,
           su.task_manifest_digest, su.grader_version,
           s.id AS subject_id, s.model_provider, s.model_id, s.model_version,
           s.model_config, s.agent_harness, s.harness_version, s.tool_manifest,
           e.id AS environment_id, e.os_name, e.os_version, e.architecture,
           e.container_image_digest, e.runtime_manifest, e.network_policy
      FROM dyno_runs r
      JOIN dyno_suites su ON su.id = r.suite_id
      JOIN dyno_subjects s ON s.id = r.subject_id
      JOIN dyno_environments e ON e.id = r.environment_id
     WHERE r.id = ?
  `).bind(runId).first();
}

function replayCoordinate(run: any): Record<string, unknown> {
  return {
    runId: run.id,
    suite: [run.suite_id, run.suite_version, run.task_manifest_digest, run.grader_version],
    subject: [
      run.subject_id, run.model_provider, run.model_id, run.model_version,
      run.model_config, run.agent_harness, run.harness_version, run.tool_manifest
    ],
    environment: [
      run.environment_id, run.os_name, run.os_version, run.architecture,
      run.container_image_digest, run.runtime_manifest, run.network_policy
    ],
    execution: [run.randomization_seed, run.repetition],
    evidence: [run.raw_trace_sha256, run.runner_attestation_digest]
  };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  if (!env?.DB) return json({ success: false, error: 'DYNO verifier database is unavailable.' }, 503);
  const { user, errorResponse } = await requireAuth(request, env);
  if (errorResponse || !user) return errorResponse || json({ success: false, error: 'Unauthorized' }, 401);

  const id = new URL(request.url).searchParams.get('id');
  if (!id || !ID.test(id)) return json({ success: false, error: 'A valid verifier job id is required.' }, 400);

  const job = await env.DB.prepare(`
    SELECT id, run_id, ceremony_id, requested_by_user_id, requested_class,
           replay_identity_digest, source_trace_digest, status, attempt_count,
           max_attempts, available_at, lease_expires_at, worker_id,
           last_error_code, result_attestation_digest, result_digest,
           created_at, updated_at, completed_at, dead_lettered_at
      FROM dyno_verifier_jobs WHERE id = ?
  `).bind(id).first();
  if (!job || (job.requested_by_user_id !== user.id && user.role !== 'admin')) {
    return json({ success: false, error: 'Verifier job not found.' }, 404);
  }
  return json({ success: true, job });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  if (!env?.DB) return json({ success: false, error: 'DYNO verifier database is unavailable.' }, 503);

  let body: any;
  try {
    body = await parseBody(request);
  } catch (error: any) {
    return json({ success: false, error: error.message === 'payload_too_large' ? 'Payload exceeds 64KB.' : 'Invalid JSON payload.' }, error.message === 'payload_too_large' ? 413 : 400);
  }

  const action = String(body?.action || '');
  if (action.startsWith('worker.')) {
    if (env.DYNO_VERIFIER_ENABLED !== 'true') {
      return json({ success: false, error: 'DYNO verifier workers are not commissioned.' }, 503);
    }
    if (!(await workerAuthorized(request, env))) return json({ success: false, error: 'Invalid worker credentials.' }, 401);

    if (action === 'worker.claim') {
      const workerId = String(body.workerId || '').trim();
      if (!ID.test(workerId)) return json({ success: false, error: 'A valid workerId is required.' }, 400);
      const leaseSeconds = Math.max(30, Math.min(Number(body.leaseSeconds) || 120, 900));
      const candidate = await env.DB.prepare(`
        SELECT id FROM dyno_verifier_jobs
         WHERE requested_class = 'reproduced'
           AND status IN ('queued', 'retryable_failure', 'leased', 'running')
           AND attempt_count < max_attempts
           AND available_at <= CURRENT_TIMESTAMP
           AND (claim_token IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
         ORDER BY created_at ASC LIMIT 1
      `).first();
      if (!candidate) return json({ success: true, job: null }, 200);

      const claimToken = randomId('claim');
      const claimed = await env.DB.prepare(`
        UPDATE dyno_verifier_jobs
           SET status = 'leased', claim_token = ?, worker_id = ?, attempt_count = attempt_count + 1,
               lease_expires_at = datetime('now', '+' || ? || ' seconds'), updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND attempt_count < max_attempts
           AND status IN ('queued', 'retryable_failure', 'leased', 'running')
           AND available_at <= CURRENT_TIMESTAMP
           AND (claim_token IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
      `).bind(claimToken, workerId, leaseSeconds, candidate.id).run();
      if (!claimed?.meta?.changes) return json({ success: true, job: null }, 200);

      const job = await env.DB.prepare(`
        SELECT id, run_id, requested_class, replay_identity_digest, source_trace_digest,
               source_trace_r2_key, attempt_count, max_attempts, lease_expires_at
          FROM dyno_verifier_jobs WHERE id = ?
      `).bind(candidate.id).first();
      if (!env.STORAGE || typeof env.STORAGE.head !== 'function') {
        await env.DB.prepare(`UPDATE dyno_verifier_jobs SET status = 'retryable_failure',
          claim_token = NULL, lease_expires_at = NULL, last_error_code = 'trace_storage_unavailable',
          available_at = datetime('now', '+5 minutes'), updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND claim_token = ?`).bind(candidate.id, claimToken).run();
        return json({ success: false, error: 'DYNO trace storage is unavailable to the verifier.' }, 503);
      }
      const traceObject = await env.STORAGE.head(job.source_trace_r2_key);
      if (!traceObject || traceObject.customMetadata?.sha256 !== job.source_trace_digest) {
        await env.DB.prepare(`UPDATE dyno_verifier_jobs SET status = 'retryable_failure',
          claim_token = NULL, lease_expires_at = NULL, last_error_code = 'trace_evidence_missing',
          available_at = datetime('now', '+5 minutes'), updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND claim_token = ?`).bind(candidate.id, claimToken).run();
        return json({ success: false, error: 'Pinned DYNO trace evidence is missing or mismatched.' }, 409);
      }
      return json({ success: true, job: { ...job, claimToken } });
    }

    const jobId = String(body.jobId || '');
    const claimToken = String(body.claimToken || '');
    if (!ID.test(jobId) || !claimToken.startsWith('claim_')) {
      return json({ success: false, error: 'Valid jobId and claimToken are required.' }, 400);
    }
    const job = await env.DB.prepare(`SELECT * FROM dyno_verifier_jobs WHERE id = ?`).bind(jobId).first();
    if (!job || job.claim_token !== claimToken || !['leased', 'running'].includes(job.status)) {
      return json({ success: false, error: 'Claim token mismatch or job is not leased.' }, 409);
    }
    const liveLease = await env.DB.prepare(`SELECT CASE WHEN lease_expires_at > CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS live FROM dyno_verifier_jobs WHERE id = ?`).bind(jobId).first();
    if (!liveLease?.live) return json({ success: false, error: 'Verifier lease expired.' }, 409);

    if (action === 'worker.complete') {
      const replayIdentityDigest = String(body.replayIdentityDigest || '');
      const resultDigest = String(body.resultDigest || '');
      const resultAttestationDigest = String(body.resultAttestationDigest || '');
      if (replayIdentityDigest !== job.replay_identity_digest || !SHA256.test(resultDigest) || !SHA256.test(resultAttestationDigest)) {
        return json({ success: false, error: 'Result evidence does not match the leased replay identity.' }, 400);
      }
      const binding = await digest({ jobId, runId: job.run_id, replayIdentityDigest, resultDigest, workerId: job.worker_id });
      if (String(body.resultBindingDigest || '') !== binding) {
        return json({ success: false, error: 'Result binding digest is invalid.' }, 400);
      }
      const attemptId = randomId('verifyattempt');
      const claimTokenDigest = await digest(claimToken);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO dyno_verifier_attempts
          (id, job_id, attempt_number, worker_id, claim_token_digest, replay_identity_digest,
           status, result_digest, attestation_digest, started_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
          .bind(attemptId, job.id, job.attempt_count, job.worker_id, claimTokenDigest, replayIdentityDigest, resultDigest, resultAttestationDigest),
        env.DB.prepare(`UPDATE dyno_verifier_jobs SET status = 'succeeded', claim_token = NULL,
          lease_expires_at = NULL, result_digest = ?, result_attestation_digest = ?,
          completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND claim_token = ?`)
          .bind(resultDigest, resultAttestationDigest, job.id, claimToken),
        env.DB.prepare(`UPDATE dyno_runs SET verification_status = 'reproducible',
          evaluation_class = 'reproduced' WHERE id = ? AND verification_status = 'unverified'`)
          .bind(job.run_id)
      ]);
      return json({ success: true, jobId: job.id, status: 'succeeded' });
    }

    if (action === 'worker.fail') {
      const errorCode = String(body.errorCode || 'inconclusive').slice(0, 80);
      const dead = Number(job.attempt_count) >= Number(job.max_attempts);
      const nextStatus = dead ? 'dead_letter' : 'retryable_failure';
      const attemptId = randomId('verifyattempt');
      const claimTokenDigest = await digest(claimToken);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO dyno_verifier_attempts
          (id, job_id, attempt_number, worker_id, claim_token_digest, replay_identity_digest,
           status, error_code, started_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, 'inconclusive', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
          .bind(attemptId, job.id, job.attempt_count, job.worker_id, claimTokenDigest, job.replay_identity_digest, errorCode),
        env.DB.prepare(`UPDATE dyno_verifier_jobs SET status = ?, claim_token = NULL,
          lease_expires_at = NULL, last_error_code = ?,
          available_at = datetime('now', '+5 minutes'), updated_at = CURRENT_TIMESTAMP,
          dead_lettered_at = CASE WHEN ? = 'dead_letter' THEN CURRENT_TIMESTAMP ELSE NULL END
          WHERE id = ? AND claim_token = ?`)
          .bind(nextStatus, errorCode, nextStatus, job.id, claimToken)
      ]);
      return json({ success: true, jobId: job.id, status: nextStatus });
    }

    return json({ success: false, error: 'Unknown worker action.' }, 400);
  }

  const { user, errorResponse } = await requireAuth(request, env);
  if (errorResponse || !user) return errorResponse || json({ success: false, error: 'Unauthorized' }, 401);

  if (action === 'request_reproduction') {
    const runId = String(body.runId || '');
    if (!ID.test(runId)) return json({ success: false, error: 'A valid runId is required.' }, 400);
    const run = await loadReplayIdentity(env.DB, runId);
    if (!run || (run.submitted_by_user_id !== user.id && user.role !== 'admin')) {
      return json({ success: false, error: 'Benchmark run not found.' }, 404);
    }
    if (!SHA256.test(String(run.raw_trace_sha256 || '')) || !String(run.raw_trace_r2_key || '').trim()) {
      return json({ success: false, error: 'The source trace is unavailable; reproduction cannot be queued.' }, 409);
    }
    if (!env.STORAGE || typeof env.STORAGE.head !== 'function') {
      return json({ success: false, error: 'DYNO trace storage is unavailable.' }, 503);
    }
    const traceObject = await env.STORAGE.head(run.raw_trace_r2_key);
    if (!traceObject) {
      return json({ success: false, error: 'The source trace object is missing; reproduction cannot be queued.' }, 409);
    }
    const replayIdentityDigest = await digest(replayCoordinate(run));
    const jobId = randomId('verifyjob');
    await env.DB.prepare(`INSERT OR IGNORE INTO dyno_verifier_jobs
      (id, run_id, requested_by_user_id, requested_class, replay_identity_digest,
       source_trace_digest, source_trace_r2_key, status)
      VALUES (?, ?, ?, 'reproduced', ?, ?, ?, 'queued')`)
      .bind(jobId, run.id, user.id, replayIdentityDigest, run.raw_trace_sha256, run.raw_trace_r2_key).run();
    const job = await env.DB.prepare(`SELECT id, status, replay_identity_digest, created_at
      FROM dyno_verifier_jobs WHERE run_id = ? AND requested_class = 'reproduced' AND replay_identity_digest = ?`)
      .bind(run.id, replayIdentityDigest).first();
    return json({ success: true, job }, 202);
  }

  if (action === 'delete_trace') {
    const runId = String(body.runId || '');
    if (!ID.test(runId)) return json({ success: false, error: 'A valid runId is required.' }, 400);
    const run = await env.DB.prepare(`SELECT id, submitted_by_user_id, raw_trace_sha256, raw_trace_r2_key FROM dyno_runs WHERE id = ?`).bind(runId).first();
    if (!run || (run.submitted_by_user_id !== user.id && user.role !== 'admin')) return json({ success: false, error: 'Benchmark run not found.' }, 404);
    if (!run.raw_trace_r2_key) return json({ success: true, deleted: false, reason: 'Trace already absent.' });
    if (!env.STORAGE || typeof env.STORAGE.delete !== 'function') return json({ success: false, error: 'Trace storage is unavailable.' }, 503);

    await env.STORAGE.delete(run.raw_trace_r2_key);
    const receipt = await digest({ runId, traceDigest: run.raw_trace_sha256, deletedObject: true });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO dyno_trace_retention_requests
        (id, run_id, requested_by_user_id, trace_digest, r2_key, status, deletion_receipt_digest, completed_at)
        VALUES (?, ?, ?, ?, NULL, 'deleted', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(run_id) DO UPDATE SET r2_key = NULL, status = 'deleted',
          deletion_receipt_digest = excluded.deletion_receipt_digest, completed_at = CURRENT_TIMESTAMP`)
        .bind(randomId('retention'), run.id, user.id, run.raw_trace_sha256, receipt),
      env.DB.prepare(`UPDATE dyno_runs SET raw_trace_r2_key = NULL WHERE id = ? AND raw_trace_r2_key = ?`)
        .bind(run.id, run.raw_trace_r2_key)
    ]);
    return json({ success: true, deleted: true, traceDigest: run.raw_trace_sha256, deletionReceiptDigest: receipt });
  }

  return json({ success: false, error: 'Unknown action.' }, 400);
};
