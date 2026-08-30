// Functions API: /api/deploy
// Truthful Deployment Lifecycle Control Plane
// Invariants:
// 1. Apps must reach a verified deployment before appearing 'active'.
// 2. Publication sets 'draft' (or 'source_ready'), NEVER 'active'.
// 3. RIG runtime detection inspects the committed source tree at the pinned commit OID.
// 4. Fail-closed deployment: when no live RIG provider/runner is available,
//    or container execution/smoke check fails, records honest failure evidence in D1; NEVER fakes active or success.

import * as path from 'node:path';
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
  hasGitObject
} from '../../src/lib/gitsmith/gitStorage';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

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
      LEFT JOIN repositories r ON r.app_id = a.id OR r.slug = a.id
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

    if (!appId) {
      return json({ success: false, error: 'appId is required' }, 400);
    }

    // 1. Check if application listing exists
    const appListing = await env.DB.prepare(`
      SELECT id, name, creator_id, version, deployment_state, deployment_error
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

      // If no files provided in request, check if canonical repo exists to read committed tree
      if (files.length === 0) {
        const repository = await env.DB.prepare(`
          SELECT r.id, r.storage_key, rf.commit_oid AS headCommitOid
          FROM repositories r
          LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
          WHERE r.app_id = ? OR r.slug = ?
        `).bind(appId, appId).first();

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

    // Action: Deploy lifecycle (source -> detect -> plan -> honestly fail closed)
    if (action === 'deploy' || action === 'promote') {
      const timestamp = new Date().toISOString();

      // Step 1: Check canonical GITSMITH repository & commit on disk
      const repository = await env.DB.prepare(`
        SELECT r.id, r.slug, r.status, r.default_ref, r.storage_key,
               rf.commit_oid AS headCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
        WHERE r.app_id = ? OR r.slug = ?
      `).bind(appId, appId).first();

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

      // Step 2: Transition to source_ready
      await env.DB.prepare(`
        UPDATE app_listings SET
          deployment_state = 'source_ready',
          active_commit_oid = ?
        WHERE id = ?
      `).bind(commitOid, appId).run();

      // Step 3: Detect project type & build plan strictly from committed tree
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

      // Update plan in DB
      await env.DB.prepare(`
        UPDATE app_listings SET
          detected_project_type = ?,
          deployment_plan_json = ?
        WHERE id = ?
      `).bind(plan.detectedType, JSON.stringify(plan), appId).run();

      // Step 4: Fail closed honestly: Deployment pipeline is not commissioned
      const failClosedError = "Deployment pipeline is not yet commissioned. No application can be promoted to 'active' until (1) a RIG deploy-build job builds and smoke-tests the pinned commit, and (2) hostname-to-container serving is provisioned.";
      const evidence = {
        stage: 'promotion',
        timestamp,
        details: 'Fail-closed execution: Per-commit container builds and hostname-to-container serving are not yet commissioned.',
        detectedType: plan.detectedType,
        plan,
        repositoryId: repository.id,
        commitOid,
        error: failClosedError
      };

      await env.DB.prepare(`
        UPDATE app_listings SET
          deployment_state = 'source_ready',
          deployment_error = ?,
          deployment_evidence_json = ?
        WHERE id = ?
      `).bind(failClosedError, JSON.stringify(evidence), appId).run();

      return json({
        success: false,
        appId,
        deploymentState: 'source_ready',
        error: failClosedError,
        evidence,
        plan
      }, 503);
    }

    return json({ success: false, error: `Unsupported deployment action '${action}'` }, 400);
  } catch (err: any) {
    return json({ success: false, error: err.message || 'Deployment execution failed' }, 500);
  }
};

