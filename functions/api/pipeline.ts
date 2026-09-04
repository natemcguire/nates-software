import { SlopshopPipelineEngine, FileModification } from '../../src/lib/slopshopPipeline';
import { requireAuth } from './_auth';
import { validateGitOid } from '../../src/lib/forgeDomain';
import { isValidImageDigest } from '../../src/lib/rigDomain';

type D1Database = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };

const apiError = (error: string, status: number) => Response.json({ success: false, error }, { status });
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

export const onRequestGet = async () => {
  return Response.json({
    success: true,
    service: 'SLOPSHOP AI Feature Modification Pipeline',
    status: 'online',
    mode: 'preflight_and_planning_only',
    stages: [
      '1. Target Package & Relative Path Validation',
      '2. Collision Detection (Paths, Routes, Exports, Schemas)',
      '3. Reversible Forward & Inverse Unified Patch Generation',
      '4. Deterministic SHA-256 Evidence Digest Computation',
      '5. Local Worktree Execution Blueprint Generation (Host Required for Landing/Revert)'
    ],
    landingPolicy: 'Edge runtime cannot execute Git. CAS landing and rollback must be executed on local host machine with cryptographic evidence.'
  });
};

export const onRequestPost = async ({ request, env }: { request: Request; env?: { DB?: D1Database; [key: string]: any } }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      appId,
      featureName,
      prompt,
      modifications,
      migrationSql,
      agentName,
      action
    } = body;

    if (action === 'request_verification') {
      const auth = await requireAuth(request, env || {});
      if (auth.errorResponse) return auth.errorResponse;
      if (!env?.DB) return apiError('Forge workflow storage is unavailable.', 503);
      const runnerImageDigest = String(env.RIG_VERIFICATION_IMAGE_DIGEST || '').trim();
      const toolchainVersion = String(env.RIG_TOOLCHAIN_VERSION || '').trim();
      const testPolicyVersion = String(env.RIG_TEST_POLICY_VERSION || '').trim();
      if (!isValidImageDigest(runnerImageDigest) || !toolchainVersion || !testPolicyVersion) {
        return apiError('RIG verification policy is not configured.', 503);
      }

      const targetRepositoryId = String(body.targetRepositoryId || '').trim();
      const targetRef = String(body.targetRef || 'refs/heads/main').trim();
      const sourceRef = String(body.sourceRef || '').trim();
      const idempotencyKey = String(body.idempotencyKey || '').trim();
      const sourceManifestDigest = String(body.sourceManifestDigest || '').trim();
      const buildCommand = String(body.buildCommand || '').trim();
      const testCommand = String(body.testCommand || '').trim();
      const instructions = String(body.instructions || '').trim();
      if (!targetRepositoryId || !sourceRef || !idempotencyKey || !buildCommand || !testCommand) {
        return apiError('targetRepositoryId, sourceRef, idempotencyKey, buildCommand, and testCommand are required.', 400);
      }
      if (!/^refs\/(heads|features)\/[a-zA-Z0-9._/-]+$/.test(targetRef) ||
          !/^refs\/(heads|features)\/[a-zA-Z0-9._/-]+$/.test(sourceRef)) {
        return apiError('targetRef and sourceRef must be canonical heads or feature refs.', 400);
      }
      if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) return apiError('idempotencyKey is invalid.', 400);
      if (!SHA256_DIGEST.test(sourceManifestDigest)) return apiError('sourceManifestDigest must be a SHA-256 digest.', 400);
      if (buildCommand.length > 1_000 || testCommand.length > 1_000 || instructions.length > 10_000 ||
          /[\0\r\n]/.test(buildCommand) || /[\0\r\n]/.test(testCommand)) {
        return apiError('Verification commands or instructions exceed the bounded request contract.', 400);
      }

      const existing = await env.DB.prepare(`
        SELECT mj.id AS mergeJobId, ma.id AS mergeAttemptId, br.id AS buildRunId,
          mj.status AS jobStatus, ma.status AS attemptStatus, br.status AS buildStatus
        FROM merge_jobs mj
        JOIN merge_attempts ma ON ma.merge_job_id = mj.id AND ma.attempt_number = 1
        JOIN build_runs br ON br.merge_attempt_id = ma.id AND br.purpose = 'verification'
        WHERE mj.requested_by_user_id = ? AND mj.idempotency_key = ?
      `).bind(auth.user!.id, idempotencyKey).first();
      if (existing) return Response.json({ success: true, verification: existing, idempotent: true }, { status: 200 });

      const repository = await env.DB.prepare(`
        SELECT r.id, r.status, r.owner_user_id AS ownerUserId, r.storage_key AS storageKey,
          CASE WHEN r.owner_user_id = ? THEN 'owner' ELSE member.role END AS memberRole,
          target.commit_oid AS targetOid, source.commit_oid AS resultOid
        FROM repositories r
        LEFT JOIN repository_members member ON member.repository_id = r.id AND member.user_id = ?
        LEFT JOIN repository_refs target ON target.repository_id = r.id AND target.ref_name = ?
        LEFT JOIN repository_refs source ON source.repository_id = r.id AND source.ref_name = ?
        WHERE r.id = ?
      `).bind(auth.user!.id, auth.user!.id, targetRef, sourceRef, targetRepositoryId).first();
      if (!repository) return apiError('Target repository not found.', 404);
      if (repository.status !== 'active') return apiError('Target repository is not active.', 409);
      if (!['owner', 'maintainer', 'writer'].includes(String(repository.memberRole || ''))) {
        return apiError('Write access to the target repository is required.', 403);
      }
      if (!repository.targetOid || !repository.resultOid) return apiError('Both targetRef and sourceRef must exist in the forge projection.', 409);
      if (repository.targetOid === repository.resultOid) return apiError('The source result already equals the target ref.', 409);
      for (const [name, oid] of [['targetOid', repository.targetOid], ['resultOid', repository.resultOid]]) {
        const validation = validateGitOid(String(oid), name);
        if (!validation.valid) return apiError(validation.error || `${name} is invalid.`, 409);
      }

      const mergeJobId = `merge_${crypto.randomUUID()}`;
      const mergeAttemptId = `attempt_${crypto.randomUUID()}`;
      const buildRunId = `build_${crypto.randomUUID()}`;
      const outboxEventId = `verify_${buildRunId}`;
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO merge_jobs
          (id,target_repository_id,target_ref,requested_by_user_id,expected_target_oid,status,idempotency_key,active_attempt_number)
          VALUES (?,?,?,?,?,'queued',?,1)`)
          .bind(mergeJobId, targetRepositoryId, targetRef, auth.user!.id, repository.targetOid, idempotencyKey),
        env.DB.prepare(`INSERT INTO merge_attempts
          (id,merge_job_id,attempt_number,input_target_oid,input_feature_oid,result_commit_oid,
           toolchain_version,test_policy_version,status,requested_instructions)
          VALUES (?,?,1,?,?,?, ?,?,'preparing',?)`)
          .bind(mergeAttemptId, mergeJobId, repository.targetOid, repository.resultOid,
            repository.resultOid, toolchainVersion, testPolicyVersion, instructions),
        env.DB.prepare(`INSERT INTO build_runs
          (id,repository_id,commit_oid,merge_attempt_id,purpose,status,runner_image_digest,
           build_command,test_command,source_manifest_digest)
          VALUES (?,?,?,?,'verification','queued',?,?,?,?)`)
          .bind(buildRunId, targetRepositoryId, repository.resultOid, mergeAttemptId,
            runnerImageDigest, buildCommand, testCommand, sourceManifestDigest),
        env.DB.prepare(`INSERT INTO forge_outbox_events
          (id,aggregate_type,aggregate_id,event_type,payload,attempts,created_at)
          VALUES (?,'build',?,'build.verification_requested',?,0,CURRENT_TIMESTAMP)`)
          .bind(outboxEventId, buildRunId, JSON.stringify({
            buildRunId, mergeJobId, mergeAttemptId, repositoryId: targetRepositoryId,
            storageKey: repository.storageKey,
            targetRef, sourceRef, expectedTargetOid: repository.targetOid,
            resultCommitOid: repository.resultOid, runnerImageDigest,
            buildCommand, testCommand, sourceManifestDigest,
            toolchainVersion, testPolicyVersion, requestedByUserId: auth.user!.id
          }))
      ]);
      return Response.json({
        success: true,
        verification: { mergeJobId, mergeAttemptId, buildRunId, outboxEventId,
          jobStatus: 'queued', attemptStatus: 'preparing', buildStatus: 'queued' },
        idempotent: false
      }, { status: 202 });
    }

    if (action === 'land' || action === 'revert') {
      return Response.json(
        {
          success: false,
          status: 'rejected_edge_runtime_unsupported',
          action,
          error: `Edge runtime cannot execute Git ${action} operations. In-browser and Cloudflare edge environments cannot invoke local shells or manipulate local git working trees. Execute ${action} operations locally on your host machine.`
        },
        { status: 400 }
      );
    }

    if (!appId || typeof appId !== 'string' || !featureName || typeof featureName !== 'string' || !prompt || typeof prompt !== 'string') {
      return Response.json(
        { success: false, error: 'appId, featureName, and prompt are required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(modifications) || modifications.length === 0) {
      return Response.json(
        { success: false, error: 'modifications must be a non-empty array with explicit file contents' },
        { status: 400 }
      );
    }
    const submittedMods = modifications as FileModification[];

    const engine = new SlopshopPipelineEngine(appId);

    const preflight = engine.preflightPipeline({
      appId,
      featureName,
      prompt,
      modifications: submittedMods,
      migrationSql,
      agentName
    });

    if (!preflight.success) {
      return Response.json(
        {
          success: false,
          status: preflight.status,
          error: preflight.message,
          validation: preflight.validation
        },
        { status: 400 }
      );
    }

    return Response.json({
      success: true,
      pipeline: 'SLOPSHOP AI Feature Modification Pipeline (Preflight)',
      status: preflight.status,
      appId: preflight.appId,
      featureName: preflight.featureName,
      validation: preflight.validation,
      diff: preflight.diff,
      inverseDiff: preflight.inverseDiff,
      evidenceDigest: preflight.evidenceDigest,
      message: preflight.message
    });
  } catch (err: any) {
    return Response.json(
      { success: false, error: 'Pipeline preflight failed: ' + (err.message || 'Unknown error') },
      { status: 500 }
    );
  }
};
