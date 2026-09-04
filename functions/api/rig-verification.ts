type D1Database = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };
type R2Bucket = { put(key: string, value: any, options?: any): Promise<any>; get(key: string): Promise<any> };

interface VerificationEnv {
  DB?: D1Database;
  STORAGE?: R2Bucket;
  RIG_GATEWAY_SERVICE_SECRET?: string;
  GITSMITH_GATEWAY_URL?: string;
  GITSMITH_GATEWAY_TOKEN?: string;
  __GITSMITH_GATEWAY_FETCH?: typeof fetch;
}

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function buildEvidenceBundle(input: {
  buildRunId: string;
  mergeAttemptId: string;
  mergeJobId: string;
  repositoryId: string;
  status: 'passed' | 'failed' | 'timed_out';
  exitCode: number;
  durationMs: number;
  resultDigest: string | null;
  logs: string;
  testReport: unknown;
  isolationAttestation: unknown;
  runtimeIdentity: unknown;
  artifactDigests: Array<{ id: string; kind: string; r2Key: string; sha256: string }>;
  completedAt: string;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    buildRunId: input.buildRunId,
    mergeAttemptId: input.mergeAttemptId,
    mergeJobId: input.mergeJobId,
    repositoryId: input.repositoryId,
    status: input.status,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    resultDigest: input.resultDigest,
    logs: input.logs,
    testReport: input.testReport,
    artifactDigests: input.artifactDigests,
    networkPolicy: input.isolationAttestation,
    runtimeIdentity: input.runtimeIdentity,
    completedAt: input.completedAt
  };
}

async function tokenMatches(actual: string, expected: string): Promise<boolean> {
  if (!actual || !expected || expected.length < 32) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

async function authorize(request: Request, env: any): Promise<boolean> {
  const actual = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return tokenMatches(actual, String(env?.RIG_GATEWAY_SERVICE_SECRET || ''));
}

export const onRequestGet = async ({ request, env }: { request: Request; env: VerificationEnv }) => {
  if (!await authorize(request, env)) return json({ success: false, error: 'Unauthorized RIG verification worker.' }, 401);
  if (!env.DB) return json({ success: false, error: 'Verification workflow storage is unavailable.' }, 503);
  if (!env.GITSMITH_GATEWAY_URL || !env.GITSMITH_GATEWAY_TOKEN) {
    return json({ success: false, error: 'GITSMITH source transport is unavailable.' }, 503);
  }
  const url = new URL(request.url);
  const eventId = String(url.searchParams.get('eventId') || '').trim();
  const claimToken = String(url.searchParams.get('claimToken') || '').trim();
  if (!eventId || !claimToken) return json({ success: false, error: 'eventId and claimToken are required.' }, 400);
  const event = await env.DB.prepare(`
    SELECT payload FROM forge_outbox_events
    WHERE id = ? AND event_type = 'build.verification_requested'
      AND delivered_at IS NULL AND dead_lettered_at IS NULL
      AND claim_token = ? AND lease_expires_at > CURRENT_TIMESTAMP
  `).bind(eventId, claimToken).first();
  if (!event) return json({ success: false, error: 'Verification claim is invalid or expired.' }, 409);
  let pinned: any;
  try { pinned = JSON.parse(String(event.payload)); } catch { return json({ success: false, error: 'Pinned verification payload is malformed.' }, 500); }
  const storageKey = String(pinned.storageKey || '').trim();
  const commitOid = String(pinned.resultCommitOid || '').trim();
  if (!storageKey || !/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(commitOid)) {
    return json({ success: false, error: 'Pinned verification source identity is invalid.' }, 409);
  }
  const gatewayUrl = new URL('/api/gateway/archive', env.GITSMITH_GATEWAY_URL);
  gatewayUrl.searchParams.set('storageKey', storageKey);
  gatewayUrl.searchParams.set('commitOid', commitOid);
  const gatewayFetch = env.__GITSMITH_GATEWAY_FETCH || fetch;
  const upstream = await gatewayFetch(gatewayUrl, {
    headers: { Authorization: `Bearer ${env.GITSMITH_GATEWAY_TOKEN}` }
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body || upstream.headers.get('X-Gitsmith-Commit-Oid') !== commitOid) {
    return json({ success: false, error: 'Authoritative source archive is unavailable.' }, 502);
  }
  return new Response(upstream.body, { status: 200, headers: {
    'Content-Type': 'application/x-tar', 'Cache-Control': 'private, no-store',
    'X-Gitsmith-Commit-Oid': commitOid
  } });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: VerificationEnv }) => {
  if (!await authorize(request, env)) return json({ success: false, error: 'Unauthorized RIG verification worker.' }, 401);
  if (!env.DB) return json({ success: false, error: 'Verification workflow storage is unavailable.' }, 503);
  const body: any = await request.json().catch(() => ({}));
  const action = String(body.action || '');

  if (action === 'claim') {
    const leaseSeconds = Math.max(15, Math.min(Number(body.leaseSeconds) || 120, 900));
    const candidate = await env.DB.prepare(`
      SELECT event.id, event.payload, event.attempts
      FROM forge_outbox_events event
      JOIN build_runs build ON build.id = event.aggregate_id
      JOIN merge_attempts attempt ON attempt.id = build.merge_attempt_id
      JOIN merge_jobs job ON job.id = attempt.merge_job_id
      WHERE event.event_type = 'build.verification_requested'
        AND event.delivered_at IS NULL AND event.dead_lettered_at IS NULL
        AND (event.available_at IS NULL OR event.available_at <= CURRENT_TIMESTAMP)
        AND (event.lease_expires_at IS NULL OR event.lease_expires_at <= CURRENT_TIMESTAMP)
        AND event.attempts < 5 AND build.status = 'queued'
        AND attempt.status = 'preparing' AND job.status = 'queued'
      ORDER BY event.created_at ASC LIMIT 1
    `).first();
    if (!candidate) return json({ success: true, claim: null });
    const claimToken = `rig_claim_${crypto.randomUUID().replace(/-/g, '')}`;
    const result = await env.DB.prepare(`
      UPDATE forge_outbox_events SET claim_token = ?,
        lease_expires_at = datetime('now', '+' || ? || ' seconds'),
        available_at = datetime('now', '+' || ? || ' seconds'), attempts = attempts + 1
      WHERE id = ? AND delivered_at IS NULL
        AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
    `).bind(claimToken, leaseSeconds, leaseSeconds, candidate.id).run();
    if (Number(result?.meta?.changes || 0) !== 1) return json({ success: true, claim: null });
    let payload: any;
    try { payload = JSON.parse(String(candidate.payload)); }
    catch { return json({ success: false, error: 'Pinned verification payload is malformed.' }, 500); }
    await env.DB.prepare(`UPDATE build_runs SET status = 'running', started_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT aggregate_id FROM forge_outbox_events WHERE id = ?) AND status = 'queued'`).bind(candidate.id).run();
    return json({ success: true, claim: { eventId: candidate.id, claimToken, attempt: Number(candidate.attempts) + 1, payload } });
  }

  if (action === 'release') {
    const eventId = String(body.eventId || '').trim();
    const claimToken = String(body.claimToken || '').trim();
    const error = String(body.error || 'Transient RIG worker failure').slice(0, 1000);
    if (!eventId || !claimToken) return json({ success: false, error: 'eventId and claimToken are required.' }, 400);
    const event: any = await env.DB.prepare(`SELECT aggregate_id AS buildRunId, attempts FROM forge_outbox_events
      WHERE id = ? AND event_type = 'build.verification_requested' AND delivered_at IS NULL
        AND dead_lettered_at IS NULL AND claim_token = ?`).bind(eventId, claimToken).first();
    if (!event) return json({ success: false, error: 'Verification claim is invalid.' }, 409);
    const terminal = Number(event.attempts) >= 5;
    const statements = [
      env.DB.prepare(`UPDATE forge_outbox_events SET claim_token = NULL, lease_expires_at = NULL,
        available_at = datetime('now', '+' || ? || ' seconds'), last_error = ?,
        dead_lettered_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE dead_lettered_at END WHERE id = ? AND claim_token = ?`)
        .bind(Math.min(300, 5 * (2 ** Math.max(0, Number(event.attempts) - 1))), error, terminal ? 1 : 0, eventId, claimToken),
      env.DB.prepare(`UPDATE build_runs SET status = ?, started_at = CASE WHEN ? THEN started_at ELSE NULL END,
        finished_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ? AND status = 'running'`)
        .bind(terminal ? 'failed' : 'queued', terminal ? 1 : 0, terminal ? 1 : 0, event.buildRunId)
    ];
    if (terminal) {
      statements.push(
        env.DB.prepare(`UPDATE merge_attempts SET status='failed', failure_detail=?, finished_at=CURRENT_TIMESTAMP
          WHERE id=(SELECT merge_attempt_id FROM build_runs WHERE id=?) AND status='preparing'`).bind(error, event.buildRunId),
        env.DB.prepare(`UPDATE merge_jobs SET status='failed', failure_code='verification_worker_exhausted',
          updated_at=CURRENT_TIMESTAMP, completed_at=CURRENT_TIMESTAMP WHERE id=(SELECT attempt.merge_job_id FROM build_runs build
          JOIN merge_attempts attempt ON attempt.id=build.merge_attempt_id WHERE build.id=?) AND status='queued'`).bind(event.buildRunId)
      );
    }
    await env.DB.batch(statements);
    return json({ success: true, released: !terminal, deadLettered: terminal });
  }

  if (action === 'complete') {
    const eventId = String(body.eventId || '').trim();
    const claimToken = String(body.claimToken || '').trim();
    const status = String(body.status || '').trim();
    const resultDigest = String(body.resultDigest || '').trim();
    const exitCode = Number(body.exitCode);
    const durationMs = Number(body.durationMs);
    if (!eventId || !claimToken || !['passed', 'failed', 'timed_out'].includes(status)) {
      return json({ success: false, error: 'eventId, claimToken, and a terminal verification status are required.' }, 400);
    }
    if (status === 'passed' && (!SHA256_DIGEST.test(resultDigest) || exitCode !== 0)) {
      return json({ success: false, error: 'Passing verification requires a SHA-256 result digest and exit code 0.' }, 400);
    }
    if (!Number.isInteger(exitCode) || !Number.isInteger(durationMs) || durationMs < 0) {
      return json({ success: false, error: 'exitCode and non-negative integer durationMs are required.' }, 400);
    }
    const workflow = await env.DB.prepare(`
      SELECT event.payload, event.delivered_at AS deliveredAt, event.claim_token AS claimToken,
        build.id AS buildRunId, build.status AS buildStatus, build.commit_oid AS resultCommitOid,
        attempt.id AS mergeAttemptId, attempt.status AS attemptStatus,
        attempt.input_target_oid AS expectedTargetOid, job.id AS mergeJobId,
        job.status AS jobStatus, job.target_ref AS targetRef,
        job.requested_by_user_id AS requestedByUserId,
        repo.id AS repositoryId, repo.slug AS repositorySlug, repo.owner_user_id AS repositoryOwnerId
      FROM forge_outbox_events event
      JOIN build_runs build ON build.id = event.aggregate_id
      JOIN merge_attempts attempt ON attempt.id = build.merge_attempt_id
      JOIN merge_jobs job ON job.id = attempt.merge_job_id
      JOIN repositories repo ON repo.id = job.target_repository_id
      WHERE event.id = ? AND event.event_type = 'build.verification_requested'
    `).bind(eventId).first();
    if (!workflow) return json({ success: false, error: 'Verification event not found.' }, 404);
    if (workflow.deliveredAt) return json({ success: true, status: workflow.buildStatus, idempotent: true });
    if (workflow.claimToken !== claimToken) return json({ success: false, error: 'Verification claim is invalid or expired.' }, 409);
    if (workflow.buildStatus !== 'running' || workflow.attemptStatus !== 'preparing' || workflow.jobStatus !== 'queued') {
      return json({ success: false, error: 'Verification workflow is not in its claimable state.' }, 409);
    }
    let pinned: any;
    try { pinned = JSON.parse(String(workflow.payload)); }
    catch { return json({ success: false, error: 'Pinned verification payload is malformed.' }, 500); }
    if (pinned.buildRunId !== workflow.buildRunId || pinned.mergeAttemptId !== workflow.mergeAttemptId ||
        pinned.mergeJobId !== workflow.mergeJobId || pinned.repositoryId !== workflow.repositoryId ||
        pinned.resultCommitOid !== workflow.resultCommitOid || pinned.expectedTargetOid !== workflow.expectedTargetOid) {
      return json({ success: false, error: 'Verification completion does not match its pinned workflow.' }, 409);
    }

    const passed = status === 'passed';

    let evidenceBundleR2Key: string | null = null;
    let evidenceBundleSha256: string | null = null;
    let evidenceBundleSizeBytes = 0;
    if (passed) {
      if (!env.STORAGE || typeof env.STORAGE.put !== 'function') {
        return json({ success: false, error: 'Evidence storage (R2 STORAGE) is unavailable; passing verification cannot be marked reproducible.' }, 503);
      }
      const evidence = body.evidence && typeof body.evidence === 'object' ? body.evidence : {};
      const logs = typeof (evidence as any).logs === 'string' ? (evidence as any).logs : '';
      const existingArtifacts = await env.DB.prepare(`
        SELECT id, kind, r2_key AS r2Key, sha256 FROM build_artifacts WHERE build_run_id = ? ORDER BY created_at ASC, id ASC
      `).bind(workflow.buildRunId).all();
      const artifactDigests = (existingArtifacts.results || []).map((row: any) => ({
        id: row.id, kind: row.kind, r2Key: row.r2Key, sha256: row.sha256
      }));
      const completedAt = new Date().toISOString();
      const bundle = buildEvidenceBundle({
        buildRunId: workflow.buildRunId,
        mergeAttemptId: workflow.mergeAttemptId,
        mergeJobId: workflow.mergeJobId,
        repositoryId: workflow.repositoryId,
        status: status as 'passed' | 'failed' | 'timed_out',
        exitCode,
        durationMs,
        resultDigest: resultDigest || null,
        logs,
        testReport: (evidence as any).testReport ?? null,
        isolationAttestation: (evidence as any).isolationAttestation ?? null,
        runtimeIdentity: (evidence as any).runtimeIdentity ?? null,
        artifactDigests,
        completedAt
      });
      const bundleBytes = new TextEncoder().encode(JSON.stringify(bundle));
      evidenceBundleSizeBytes = bundleBytes.length;
      evidenceBundleSha256 = `sha256:${await sha256Hex(bundleBytes)}`;
      evidenceBundleR2Key = `verification-evidence/${workflow.buildRunId}/${eventId}.json`;
      try {
        await env.STORAGE.put(evidenceBundleR2Key, bundleBytes, {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: { sha256: evidenceBundleSha256, buildRunId: workflow.buildRunId, mergeAttemptId: workflow.mergeAttemptId }
        });
      } catch {
        return json({ success: false, error: 'Failed to persist the verification evidence bundle to R2; passing verification cannot be marked reproducible.' }, 503);
      }
    }

    const proposalId = `proposal:${workflow.mergeAttemptId}`;
    const statements = [
      env.DB.prepare(`UPDATE build_runs SET status = ?, result_digest = ?, exit_code = ?, duration_ms = ?,
        started_at = COALESCE(started_at, queued_at), finished_at = CURRENT_TIMESTAMP,
        evidence_bundle_r2_key = ?, evidence_bundle_sha256 = ?,
        evidence_bundle_recorded_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE id = ? AND status = 'running'`)
        .bind(status, resultDigest || null, exitCode, durationMs, evidenceBundleR2Key, evidenceBundleSha256, passed ? 1 : 0, workflow.buildRunId),
      env.DB.prepare(`UPDATE merge_attempts SET status = ?, failure_detail = ?, finished_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'preparing'`)
        .bind(passed ? 'preview_ready' : 'failed', passed ? null : `RIG verification ${status} (exit ${exitCode})`, workflow.mergeAttemptId),
      env.DB.prepare(`UPDATE merge_jobs SET status = ?, failure_code = ?, updated_at = CURRENT_TIMESTAMP,
        completed_at = CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END
        WHERE id = ? AND status = 'queued'`)
        .bind(passed ? 'preview_ready' : 'failed', passed ? null : `verification_${status}`, passed ? 1 : 0, workflow.mergeJobId),
      env.DB.prepare(`UPDATE forge_outbox_events SET delivered_at = CURRENT_TIMESTAMP,
        claim_token = NULL, lease_expires_at = NULL, last_error = NULL
        WHERE id = ? AND claim_token = ? AND delivered_at IS NULL`)
        .bind(eventId, claimToken)
    ];
    if (passed) {
      const content = `RIG verified merge attempt ${workflow.mergeAttemptId}\nTarget: ${workflow.repositorySlug} ${workflow.targetRef}\nCAS: ${workflow.expectedTargetOid} → ${workflow.resultCommitOid}\nEvidence: ${resultDigest}\nEvidence bundle: ${evidenceBundleSha256}`;
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO inbox_messages
        (id,user_id,sender_id,title,preview,content,feature_ref,cas_new_sha,is_merged,unread,message_kind,merge_attempt_id)
        VALUES (?,?,?,'Verified merge proposal',?,?,?, ?,0,1,'proposal',?)`)
        .bind(proposalId, workflow.repositoryOwnerId, workflow.requestedByUserId,
          content.slice(0, 160), content, workflow.targetRef, workflow.resultCommitOid, workflow.mergeAttemptId));
      statements.push(env.DB.prepare(`INSERT INTO build_artifacts
        (id, build_run_id, kind, r2_key, sha256, media_type, size_bytes)
        VALUES (?, ?, 'attestation', ?, ?, 'application/json', ?)`)
        .bind(`art_${crypto.randomUUID().replace(/-/g, '')}`, workflow.buildRunId,
          evidenceBundleR2Key, evidenceBundleSha256, evidenceBundleSizeBytes));
    }
    await env.DB.batch(statements);
    return json({ success: true, status, buildRunId: workflow.buildRunId,
      mergeAttemptStatus: passed ? 'preview_ready' : 'failed', proposalId: passed ? proposalId : null,
      evidenceBundleR2Key, evidenceBundleSha256, idempotent: false });
  }

  return json({ success: false, error: 'Unsupported RIG verification action.' }, 400);
};
