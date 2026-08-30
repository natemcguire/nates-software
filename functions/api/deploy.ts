// Functions API: /api/deploy
// Truthful Deployment Lifecycle Control Plane
// Invariants:
// 1. Apps must reach a verified deployment before appearing 'active'.
// 2. Publication sets 'draft' (or 'source_ready'), NEVER 'active'.
// 3. RIG runtime detection inspects the committed source tree at the pinned commit OID.
// 4. Real build of the pinned commit in a hardened container via the RIG provider gateway.
// 5. Real smoke/health check verifies real HTTP 200 before promotion.
// 6. Real promotion inserts deployment_revisions row and sets app_listings.deployment_state='active'.
// 7. Fail-closed deployment: records honest failure evidence in D1; NEVER fakes active or success.

import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { requireAuth } from './_auth';
import {
  detectRigRuntime,
  getHonestDeploymentMessage,
  AppDeploymentState,
  APP_DEPLOYMENT_STATES
} from '../../src/lib/deploymentLifecycle';
import {
  listCommitFiles,
  readCommitFileContent,
  hasGitObject,
  archiveAuthoritativeCommit
} from '../../src/lib/gitsmith/gitStorage';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const digest = (value: Buffer | string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    if (!env?.DB) {
      return json({ success: false, error: 'Database service is unavailable' }, 503);
    }

    const url = new URL(request.url);
    const appId = String(url.searchParams.get('appId') || url.searchParams.get('app') || '').trim();

    if (!appId) {
      return json({
        success: true,
        service: 'RIG Deployment Lifecycle Control Plane',
        states: APP_DEPLOYMENT_STATES,
        rule: 'Apps must reach a verified deployment before appearing active.'
      });
    }

    const listing = await env.DB.prepare(`
      SELECT 
        a.id, a.name, a.version, a.listing_status AS listingStatus,
        a.deployment_state AS deploymentState, a.deployment_error AS deploymentError,
        a.deployment_evidence_json AS deploymentEvidenceJson,
        a.detected_project_type AS detectedProjectType,
        a.deployment_plan_json AS deploymentPlanJson,
        a.active_deployment_id AS activeDeploymentId,
        a.active_commit_oid AS activeCommitOid,
        r.id AS repositoryId, r.default_ref AS defaultRef,
        dr.status AS revisionStatus, dr.url AS deploymentUrl, dr.deployed_at AS deployedAt
      FROM app_listings a
      LEFT JOIN repositories r ON r.id = a.repository_id OR r.app_id = a.id OR r.slug = a.id
      LEFT JOIN deployment_revisions dr ON dr.id = a.active_deployment_id
      WHERE a.id = ?
    `).bind(appId).first();

    if (!listing) {
      return json({ success: false, error: `Application '${appId}' not found in catalog` }, 404);
    }

    const state = (listing.deploymentState || 'draft') as AppDeploymentState;
    const honest = getHonestDeploymentMessage({
      id: listing.id,
      name: listing.name,
      deploymentState: state,
      deploymentError: listing.deploymentError
    });

    let evidence: any = null;
    try { if (listing.deploymentEvidenceJson) evidence = JSON.parse(listing.deploymentEvidenceJson); } catch {}

    let plan: any = null;
    try { if (listing.deploymentPlanJson) plan = JSON.parse(listing.deploymentPlanJson); } catch {}

    const isVerifiedActive = state === 'active' && Boolean(listing.activeDeploymentId && listing.revisionStatus === 'healthy');

    return json({
      success: true,
      appId: listing.id,
      name: listing.name,
      version: listing.version,
      listingStatus: listing.listingStatus,
      deploymentState: state,
      isVerifiedActive,
      deploymentError: listing.deploymentError,
      deploymentEvidence: evidence,
      detectedProjectType: listing.detectedProjectType,
      deploymentPlan: plan,
      activeDeploymentId: listing.activeDeploymentId,
      activeCommitOid: listing.activeCommitOid,
      activeUrl: isVerifiedActive ? (listing.deploymentUrl || `https://${listing.id}.nates-software.com`) : null,
      honestMessage: honest
    });
  } catch (err: any) {
    return json({ success: false, error: err.message || 'Failed to query deployment lifecycle' }, 500);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  let targetAppId = '';
  let activeBuildRunId = '';
  let targetRepoId = '';
  let targetCommitOid = '';
  let targetPlan: any = null;

  try {
    if (!env?.DB) {
      return json({ success: false, error: 'Database service is unavailable' }, 503);
    }

    const auth = await requireAuth(request, env);
    if (auth.errorResponse || !auth.user) {
      return auth.errorResponse || json({ success: false, error: 'Authentication required' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'deploy').trim();
    const appId = String(body.appId || body.id || '').trim();
    targetAppId = appId;

    if (!appId) {
      return json({ success: false, error: 'appId is required' }, 400);
    }

    // 1. Check if application listing exists
    const appListing = await env.DB.prepare(`
      SELECT id, name, creator_id, version, deployment_state, deployment_error, repository_id
      FROM app_listings WHERE id = ?
    `).bind(appId).first();

    if (!appListing) {
      return json({ success: false, error: `App listing '${appId}' not found` }, 404);
    }

    // Authorization check
    if (appListing.creator_id !== auth.user.id && auth.user.role !== 'super_admin') {
      return json({ success: false, error: 'Forbidden: you do not own this application listing' }, 403);
    }

    const reposRoot = env?.GITSMITH_REPOS_ROOT || process.env.GITSMITH_REPOS_ROOT || path.resolve(process.cwd(), '.gitsmith-repos');

    // Action: Plan only
    if (action === 'plan') {
      let files: string[] = Array.isArray(body.files) ? body.files : [];
      let fileContents: Record<string, string> = typeof body.fileContents === 'object' && body.fileContents !== null ? body.fileContents : {};

      // If no files provided in request, read committed tree from canonical repo
      if (files.length === 0) {
        const repository = await env.DB.prepare(`
          SELECT r.id, r.storage_key, rf.commit_oid AS headCommitOid
          FROM repositories r
          LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
          WHERE r.id = ? OR r.app_id = ? OR r.slug = ?
        `).bind(appListing.repository_id || appId, appId, appId).first();

        if (repository && repository.headCommitOid) {
          const storageKey = repository.storage_key || `repositories/${repository.id}`;
          files = listCommitFiles(reposRoot, storageKey, repository.headCommitOid);
          const manifestCandidates = ['package.json', 'Dockerfile', 'requirements.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'slop.json', 'deploy.json', 'rig.json', 'app.json', 'manifest.json', 'wrangler.toml'];
          for (const m of manifestCandidates) {
            const found = files.find(f => f.toLowerCase() === m.toLowerCase() || f.toLowerCase().endsWith(`/${m.toLowerCase()}`));
            if (found) {
              const content = readCommitFileContent(reposRoot, storageKey, repository.headCommitOid, found);
              if (content !== null) fileContents[found] = content;
            }
          }
        }
      }

      const detection = detectRigRuntime(files, fileContents);

      if (!detection.isDeployable || !detection.plan) {
        return json({
          success: false,
          isDeployable: false,
          detectedType: detection.detectedType,
          error: detection.error || 'Unsupported project type',
          reasons: detection.reasons
        }, 400);
      }

      return json({
        success: true,
        isDeployable: true,
        detectedType: detection.plan.detectedType,
        plan: detection.plan,
        reasons: detection.reasons
      });
    }

    // Action: Deploy lifecycle (source -> detect -> plan -> build -> smoke -> promote -> serve)
    if (action === 'deploy' || action === 'promote') {
      const timestamp = new Date().toISOString();

      // Step 1: Check canonical GITSMITH repository & commit on disk
      const repository = await env.DB.prepare(`
        SELECT r.id, r.slug, r.status, r.default_ref, r.storage_key,
               rf.commit_oid AS headCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
        WHERE r.id = ? OR r.app_id = ? OR r.slug = ?
      `).bind(appListing.repository_id || appId, appId, appId).first();

      const storageKey = repository?.storage_key || `repositories/${repository?.id}`;
      const commitOid = repository?.headCommitOid;

      if (!repository || !commitOid || !hasGitObject(reposRoot, storageKey, commitOid)) {
        // No canonical GITSMITH repo/commit exists -> remain draft / fail closed
        const errorMsg = `No deployable revision exists for ${appListing.name}. Source has not been imported into GITSMITH and built by RIG.`;
        const evidence = {
          stage: 'source_verification',
          timestamp,
          details: 'A canonical repository and commit must exist in GITSMITH before candidate build.',
          repositoryId: repository?.id || null,
          commitOid: commitOid || null
        };

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'draft',
            deployment_error = ?,
            deployment_evidence_json = ?
          WHERE id = ?
        `).bind(errorMsg, JSON.stringify(evidence), appId).run();

        return json({
          success: false,
          appId,
          deploymentState: 'draft',
          error: errorMsg,
          evidence
        }, 422);
      }

      targetRepoId = repository.id;
      targetCommitOid = commitOid;

      // Step 2: Detect project type & build plan strictly from committed tree
      const committedFiles = listCommitFiles(reposRoot, storageKey, commitOid);

      if (committedFiles.length === 0) {
        const errorMsg = `Deployment failed for ${appListing.name}: No committed files found in repository tree at ${commitOid.slice(0, 8)}.`;
        const evidence = {
          stage: 'detection',
          timestamp,
          details: 'The committed source tree is empty.',
          repositoryId: repository.id,
          commitOid
        };

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?,
            detected_project_type = 'unsupported'
          WHERE id = ?
        `).bind(errorMsg, JSON.stringify(evidence), appId).run();

        return json({
          success: false,
          appId,
          deploymentState: 'failed',
          error: errorMsg,
          evidence
        }, 422);
      }

      const manifestFilesToRead = [
        'slop.json', 'deploy.json', 'rig.json', 'app.json', 'manifest.json',
        'package.json', 'Dockerfile', 'dockerfile', 'requirements.txt',
        'pyproject.toml', 'Cargo.toml', 'go.mod', 'wrangler.toml'
      ];

      const committedContents: Record<string, string> = {};
      for (const file of manifestFilesToRead) {
        const matched = committedFiles.find(f => f.toLowerCase() === file.toLowerCase() || f.toLowerCase().endsWith(`/${file.toLowerCase()}`));
        if (matched) {
          const content = readCommitFileContent(reposRoot, storageKey, commitOid, matched);
          if (content !== null) {
            committedContents[matched] = content;
          }
        }
      }

      const detection = detectRigRuntime(committedFiles, committedContents);

      if (!detection.isDeployable || !detection.plan) {
        const errorMsg = `Deployment failed for ${appListing.name}: Unsupported project type.`;
        const evidence = {
          stage: 'detection',
          timestamp,
          details: detection.error || 'No recognized project configuration found.',
          reasons: detection.reasons,
          repositoryId: repository.id,
          commitOid
        };

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?,
            detected_project_type = 'unsupported'
          WHERE id = ?
        `).bind(errorMsg, JSON.stringify(evidence), appId).run();

        return json({
          success: false,
          appId,
          deploymentState: 'failed',
          error: errorMsg,
          evidence
        }, 422);
      }

      const plan = detection.plan;
      targetPlan = plan;

      // Step 3: Transition to building state & record build run
      const buildRunId = `br_${crypto.randomUUID().replace(/-/g, '')}`;
      activeBuildRunId = buildRunId;
      const runnerImageDigest = env?.RIG_VERIFICATION_IMAGE_DIGEST || 'node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
      const sourceArchive = archiveAuthoritativeCommit(reposRoot, storageKey, commitOid);
      const sourceManifestDigest = digest(sourceArchive);

      await env.DB.prepare(`
        INSERT INTO build_runs (
          id, repository_id, commit_oid, purpose, status, runner_image_digest,
          build_command, test_command, source_manifest_digest, started_at
        ) VALUES (?, ?, ?, 'release', 'running', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        buildRunId,
        repository.id,
        commitOid,
        runnerImageDigest,
        plan.buildCommand || 'none',
        plan.healthCommand || null,
        sourceManifestDigest
      ).run();

      await env.DB.prepare(`
        UPDATE app_listings SET
          deployment_state = 'building',
          detected_project_type = ?,
          deployment_plan_json = ?,
          active_commit_oid = ?
        WHERE id = ?
      `).bind(plan.detectedType, JSON.stringify(plan), commitOid, appId).run();

      // Step 4: Execute candidate build via RIG gateway (or injected executor)
      let buildResult: any;

      if (typeof env?.__RIG_DEPLOY_EXECUTOR === 'function') {
        buildResult = await env.__RIG_DEPLOY_EXECUTOR({
          appId,
          repositoryId: repository.id,
          commitOid,
          sourceArchive,
          plan,
          runnerImageDigest
        });
      } else if (env?.RIG_GATEWAY_URL && env?.RIG_GATEWAY_SERVICE_SECRET) {
        const gatewayUrl = new URL('/v1/build', env.RIG_GATEWAY_URL);
        const gatewayFetch = env.__RIG_GATEWAY_FETCH || fetch;
        const gatewayRes = await gatewayFetch(gatewayUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.RIG_GATEWAY_SERVICE_SECRET}`,
            'X-Rig-Owner-Id': auth.user.id
          },
          body: JSON.stringify({
            appId,
            repositoryId: repository.id,
            commitOid,
            plan,
            sourceArchiveBase64: sourceArchive.toString('base64'),
            runnerImageDigest
          })
        }).catch((err: any) => ({ ok: false, status: 503, json: async () => ({ error: err?.message || 'Gateway unreachable' }) }));

        if (!gatewayRes.ok) {
          const errBody = await gatewayRes.json().catch(() => ({ error: `RIG gateway returned ${gatewayRes.status}` }));
          buildResult = {
            success: false,
            exitCode: 1,
            output: errBody?.error || `RIG gateway returned ${gatewayRes.status}`,
            artifactDigest: '',
            artifactKind: 'bundle',
            smokeCheck: { passed: false, statusCode: gatewayRes.status, durationMs: 0, error: errBody?.error },
            durationMs: 0,
            error: errBody?.error || 'RIG gateway build failed'
          };
        } else {
          const gData = await gatewayRes.json();
          buildResult = gData.result;
        }
      } else {
        // Direct local execution using deployExecutor
        const { executeRigDeployBuild } = await import('../../src/lib/rig/deployExecutor');
        buildResult = await executeRigDeployBuild({
          appId,
          repositoryId: repository.id,
          commitOid,
          sourceArchive,
          plan,
          runnerImageDigest
        });
      }

      // Step 5: Evaluate build & smoke result
      if (!buildResult || !buildResult.success || buildResult.exitCode !== 0 || !buildResult.smokeCheck?.passed) {
        const errorMsg = buildResult?.error || buildResult?.smokeCheck?.error || `Build or smoke check failed for ${appListing.name}.`;
        const failureEvidence = {
          stage: (buildResult?.exitCode ?? 1) !== 0 ? 'build' : 'smoke_check',
          timestamp: new Date().toISOString(),
          details: errorMsg,
          detectedType: plan.detectedType,
          plan,
          repositoryId: repository.id,
          commitOid,
          buildRunId,
          exitCode: buildResult?.exitCode ?? 1,
          logs: [buildResult?.output || errorMsg],
          smokeCheck: buildResult?.smokeCheck
        };

        await env.DB.prepare(`
          UPDATE build_runs SET
            status = 'failed',
            result_digest = ?,
            exit_code = ?,
            duration_ms = ?,
            finished_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(buildResult?.artifactDigest || null, buildResult?.exitCode ?? 1, buildResult?.durationMs ?? 0, buildRunId).run();

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?
          WHERE id = ?
        `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

        return json({
          success: false,
          appId,
          deploymentState: 'failed',
          error: errorMsg,
          evidence: failureEvidence
        }, 422);
      }

      // Step 6: Handle Server vs Static applications
      const isServerApp = plan.detectedType === 'python' || plan.detectedType === 'rust' || plan.detectedType === 'go' ||
        (plan.detectedType === 'node' && buildResult.artifactKind !== 'static');

      if (isServerApp) {
        // Server apps: fail closed from active serving if hostname-to-container ingress is not provisioned
        const serverMessage = "Server applications require hostname-to-container ingress proxying which is not yet provisioned. Deployment remains built/deployable but cannot be promoted to active-served.";
        const serverEvidence = {
          stage: 'runtime',
          timestamp: new Date().toISOString(),
          details: serverMessage,
          detectedType: plan.detectedType,
          plan,
          repositoryId: repository.id,
          commitOid,
          buildRunId,
          artifactDigest: buildResult.artifactDigest,
          smokeCheck: buildResult.smokeCheck,
          logs: [buildResult.output]
        };

        await env.DB.prepare(`
          UPDATE build_runs SET
            status = 'passed',
            result_digest = ?,
            exit_code = 0,
            duration_ms = ?,
            finished_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(buildResult.artifactDigest, buildResult.durationMs, buildRunId).run();

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'deployable',
            deployment_error = ?,
            deployment_evidence_json = ?
          WHERE id = ?
        `).bind(serverMessage, JSON.stringify(serverEvidence), appId).run();

        return json({
          success: true,
          appId,
          deploymentState: 'deployable',
          isDeployable: true,
          buildRunId,
          artifactDigest: buildResult.artifactDigest,
          smokeCheck: buildResult.smokeCheck,
          evidence: serverEvidence,
          message: serverMessage
        });
      }

      // Step 7: Static App Promotion (real deployment_revisions row + R2 static publish + active state)
      // Enforce: active requires env.STORAGE present, non-empty static files, and all puts succeeding.
      if (!env?.STORAGE) {
        const errorMsg = `Deployment publication failed for ${appListing.name}: Artifact storage service (R2 STORAGE) is unavailable.`;
        const storageEvidence = {
          stage: 'storage_publication',
          timestamp: new Date().toISOString(),
          details: errorMsg,
          detectedType: plan.detectedType,
          plan,
          repositoryId: repository.id,
          commitOid,
          buildRunId,
          artifactDigest: buildResult.artifactDigest,
          smokeCheck: buildResult.smokeCheck
        };

        await env.DB.prepare(`
          UPDATE build_runs SET
            status = 'failed',
            result_digest = ?,
            exit_code = 1,
            duration_ms = ?,
            finished_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(buildResult.artifactDigest || null, buildResult.durationMs || 0, buildRunId).run();

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?
          WHERE id = ?
        `).bind(errorMsg, JSON.stringify(storageEvidence), appId).run();

        return json({
          success: false,
          appId,
          deploymentState: 'failed',
          error: errorMsg,
          evidence: storageEvidence
        }, 422);
      }

      if (!buildResult.staticFiles || buildResult.staticFiles.length === 0) {
        const errorMsg = `Deployment publication failed for ${appListing.name}: No static artifact files produced for storage publication.`;
        const storageEvidence = {
          stage: 'storage_publication',
          timestamp: new Date().toISOString(),
          details: errorMsg,
          detectedType: plan.detectedType,
          plan,
          repositoryId: repository.id,
          commitOid,
          buildRunId,
          artifactDigest: buildResult.artifactDigest,
          smokeCheck: buildResult.smokeCheck
        };

        await env.DB.prepare(`
          UPDATE build_runs SET
            status = 'failed',
            result_digest = ?,
            exit_code = 1,
            duration_ms = ?,
            finished_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(buildResult.artifactDigest || null, buildResult.durationMs || 0, buildRunId).run();

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?
          WHERE id = ?
        `).bind(errorMsg, JSON.stringify(storageEvidence), appId).run();

        return json({
          success: false,
          appId,
          deploymentState: 'failed',
          error: errorMsg,
          evidence: storageEvidence
        }, 422);
      }

      const revisionId = `rev_${crypto.randomUUID().replace(/-/g, '')}`;
      const deployedUrl = `https://${appId}.nates-software.com`;

      // Upload static files to R2 STORAGE
      try {
        for (const file of buildResult.staticFiles) {
          const contentBuffer = Buffer.from(file.contentBase64, 'base64');
          await env.STORAGE.put(`apps/${appId}/revisions/${revisionId}/${file.path}`, contentBuffer, {
            httpMetadata: { contentType: file.mediaType }
          });
          await env.STORAGE.put(`apps/${appId}/live/${file.path}`, contentBuffer, {
            httpMetadata: { contentType: file.mediaType }
          });
        }
      } catch (putErr: any) {
        const errorMsg = `Deployment publication failed for ${appListing.name}: Storage upload failed (${putErr?.message || 'unknown storage error'}).`;
        const storageEvidence = {
          stage: 'storage_publication',
          timestamp: new Date().toISOString(),
          details: errorMsg,
          error: putErr?.message || String(putErr),
          detectedType: plan.detectedType,
          plan,
          repositoryId: repository.id,
          commitOid,
          buildRunId,
          artifactDigest: buildResult.artifactDigest,
          smokeCheck: buildResult.smokeCheck
        };

        await env.DB.prepare(`
          UPDATE build_runs SET
            status = 'failed',
            result_digest = ?,
            exit_code = 1,
            duration_ms = ?,
            finished_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(buildResult.artifactDigest || null, buildResult.durationMs || 0, buildRunId).run();

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?
          WHERE id = ?
        `).bind(errorMsg, JSON.stringify(storageEvidence), appId).run();

        return json({
          success: false,
          appId,
          deploymentState: 'failed',
          error: errorMsg,
          evidence: storageEvidence
        }, 422);
      }

      // Insert build_artifacts
      const artifactId = `art_${crypto.randomUUID().replace(/-/g, '')}`;
      const totalSizeBytes = buildResult.staticFiles?.reduce((acc: number, f: any) => acc + (f.sizeBytes || 0), 0) || 0;

      await env.DB.prepare(`
        INSERT INTO build_artifacts (id, build_run_id, kind, r2_key, sha256, media_type, size_bytes)
        VALUES (?, ?, 'bundle', ?, ?, 'application/x-tar', ?)
      `).bind(
        artifactId,
        buildRunId,
        `apps/${appId}/revisions/${revisionId}`,
        buildResult.artifactDigest,
        totalSizeBytes
      ).run();

      // Update build_runs
      await env.DB.prepare(`
        UPDATE build_runs SET
          status = 'passed',
          result_digest = ?,
          exit_code = 0,
          duration_ms = ?,
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(buildResult.artifactDigest, buildResult.durationMs, buildRunId).run();

      // Calculate next revision number
      const revRow: any = await env.DB.prepare(`
        SELECT COALESCE(MAX(revision_number), 0) + 1 AS nextRev
        FROM deployment_revisions
        WHERE app_id = ? AND environment = 'production'
      `).bind(appId).first();
      const revisionNumber = revRow?.nextRev || 1;

      // Supersede previous active revisions
      await env.DB.prepare(`
        UPDATE deployment_revisions SET status = 'superseded'
        WHERE app_id = ? AND environment = 'production' AND status = 'healthy'
      `).bind(appId).run();

      // Insert real deployment_revisions row
      await env.DB.prepare(`
        INSERT INTO deployment_revisions (
          id, app_id, repository_id, commit_oid, build_run_id, environment,
          revision_number, status, url, runtime_config_digest, deployed_by_user_id, deployed_at
        ) VALUES (?, ?, ?, ?, ?, 'production', ?, 'healthy', ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        revisionId,
        appId,
        repository.id,
        commitOid,
        buildRunId,
        revisionNumber,
        deployedUrl,
        buildResult.artifactDigest,
        auth.user.id
      ).run();

      // Promote app_listings to 'active'
      const promotionEvidence = {
        stage: 'promotion',
        timestamp: new Date().toISOString(),
        details: 'Real RIG candidate build, HTTP smoke verification, and R2 byte storage succeeded. Revision promoted to active.',
        detectedType: plan.detectedType,
        plan,
        repositoryId: repository.id,
        commitOid,
        buildRunId,
        deploymentRevisionId: revisionId,
        artifactDigest: buildResult.artifactDigest,
        smokeCheck: buildResult.smokeCheck,
        logs: [buildResult.output]
      };

      await env.DB.prepare(`
        UPDATE app_listings SET
          deployment_state = 'active',
          active_deployment_id = ?,
          active_commit_oid = ?,
          deployment_error = NULL,
          deployment_evidence_json = ?
        WHERE id = ?
      `).bind(revisionId, commitOid, JSON.stringify(promotionEvidence), appId).run();

      return json({
        success: true,
        appId,
        deploymentState: 'active',
        isVerifiedActive: true,
        activeDeploymentId: revisionId,
        activeCommitOid: commitOid,
        activeUrl: deployedUrl,
        artifactDigest: buildResult.artifactDigest,
        smokeCheck: buildResult.smokeCheck,
        evidence: promotionEvidence
      });
    }

    return json({ success: false, error: `Unsupported deployment action '${action}'` }, 400);
  } catch (err: any) {
    const errorMsg = err?.message || 'Deployment execution failed';
    const failureEvidence = {
      stage: 'execution_error',
      timestamp: new Date().toISOString(),
      details: errorMsg,
      error: String(err?.stack || err?.message || err),
      appId: targetAppId || null,
      repositoryId: targetRepoId || null,
      commitOid: targetCommitOid || null,
      buildRunId: activeBuildRunId || null,
      plan: targetPlan || null
    };

    if (env?.DB && targetAppId) {
      try {
        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?
          WHERE id = ?
        `).bind(errorMsg, JSON.stringify(failureEvidence), targetAppId).run();
      } catch {}

      if (activeBuildRunId) {
        try {
          await env.DB.prepare(`
            UPDATE build_runs SET
              status = 'failed',
              exit_code = 1,
              finished_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(activeBuildRunId).run();
        } catch {}
      }
    }

    return json({
      success: false,
      appId: targetAppId || undefined,
      deploymentState: 'failed',
      error: errorMsg,
      evidence: failureEvidence
    }, 500);
  }
};
