

import { createHash } from 'node:crypto';
import { requireAuth } from './_auth';
import {
  detectRigRuntime,
  getHonestDeploymentMessage,
  AppDeploymentState,
  APP_DEPLOYMENT_STATES
} from '../../src/lib/deploymentLifecycle';
import {
  putS3SourceArchive,
  startCodeBuild,
  batchGetCodeBuilds,
  createEcrRepository,
  describeEcrImages,
  provisionAppDatabase,
  DEFAULT_AWS_ACCOUNT_ID,
  DEFAULT_AWS_S3_BUILD_BUCKET,
  DEFAULT_NSW_ARTIFACT_BUCKET,
  DEFAULT_AWS_CODEBUILD_PROJECT,
  DEFAULT_AWS_CODEBUILD_DEPLOY_PROJECT,
  DEFAULT_CF_ACCOUNT_ID,
  APP_ID_REGEX,
  COMMIT_OID_REGEX
} from './_aws';
import {
  NSW_BUILD_NEXT_BUILDSPEC,
  NSW_DEPLOY_NEXT_BUILDSPEC
} from './_buildspecs';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function extractWorkerUrl(cbBuild: any): string | null {
  if (!cbBuild) return null;

  
  if (Array.isArray(cbBuild.exportedEnvironmentVariables)) {
    const item = cbBuild.exportedEnvironmentVariables.find(
      (v: any) => v.name === 'DEPLOYED_WORKER_URL' || v.name === 'WORKER_URL'
    );
    if (item?.value && typeof item.value === 'string' && item.value.trim().startsWith('https://')) {
      return item.value.trim();
    }
  }

  
  if (Array.isArray(cbBuild.environment?.environmentVariables)) {
    const item = cbBuild.environment.environmentVariables.find(
      (v: any) => v.name === 'DEPLOYED_WORKER_URL' || v.name === 'WORKER_URL'
    );
    if (item?.value && typeof item.value === 'string' && item.value.trim().startsWith('https://')) {
      return item.value.trim();
    }
  }

  
  if (Array.isArray(cbBuild.phases)) {
    for (const phase of cbBuild.phases) {
      if (Array.isArray(phase.contexts)) {
        for (const ctx of phase.contexts) {
          if (typeof ctx.message === 'string') {
            const match = ctx.message.match(/https:\/\/nsw-app-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/);
            if (match) return match[0];
          }
        }
      }
    }
  }

  return null;
}

const digest = (value: Buffer | string | Uint8Array): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

function parseTimestampMs(val: any): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return val < 1e11 ? Math.floor(val * 1000) : Math.floor(val);
  }
  if (typeof val === 'string') {
    const num = Number(val);
    if (!isNaN(num) && num > 0) {
      return num < 1e11 ? Math.floor(num * 1000) : Math.floor(num);
    }
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return parsed;
  }
  if (val instanceof Date) {
    return val.getTime();
  }
  return null;
}

interface CommitVerification {
  exists: boolean;
  files: string[];
  manifestContents: Record<string, string>;
  error?: string;
}

const DEFAULT_MANIFEST_CANDIDATES = [
  'slop.json', 'deploy.json', 'rig.json', 'app.json', 'manifest.json',
  'package.json', 'next.config.js', 'next.config.mjs', 'next.config.ts',
  'Dockerfile', 'dockerfile', 'requirements.txt',
  'pyproject.toml', 'Cargo.toml', 'go.mod', 'wrangler.toml', 'index.html', 'index.htm'
];

async function verifySourceCommit(
  env: any,
  storageKey: string,
  commitOid: string,
  manifestCandidates: string[] = DEFAULT_MANIFEST_CANDIDATES
): Promise<CommitVerification> {
  
  if (env?.GITSMITH_GATEWAY_URL && env?.GITSMITH_GATEWAY_TOKEN) {
    const gatewayUrl = new URL('/api/gateway/verify-commit', env.GITSMITH_GATEWAY_URL);
    const gatewayFetch: typeof fetch = env.__GITSMITH_GATEWAY_FETCH || fetch;
    try {
      const res = await gatewayFetch(gatewayUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.GITSMITH_GATEWAY_TOKEN}`
        },
        body: JSON.stringify({
          storageKey,
          commitOid,
          manifestCandidates
        })
      });

      if (!res.ok) {
        const errBody: any = await res.json().catch(() => ({}));
        return {
          exists: false,
          files: [],
          manifestContents: {},
          error: errBody?.error || `GITSMITH gateway returned HTTP ${res.status}`
        };
      }

      const data: any = await res.json();
      if (data?.success && data?.exists) {
        return {
          exists: true,
          files: Array.isArray(data.files) ? data.files : [],
          manifestContents: typeof data.manifestContents === 'object' && data.manifestContents ? data.manifestContents : {}
        };
      }

      return {
        exists: false,
        files: [],
        manifestContents: {},
        error: data?.error || `Commit ${commitOid.slice(0, 8)} not found on GITSMITH gateway.`
      };
    } catch (fetchErr: any) {
      return {
        exists: false,
        files: [],
        manifestContents: {},
        error: `GITSMITH gateway unreachable: ${fetchErr?.message || 'network error'}`
      };
    }
  }

  
  const reposRoot = env?.GITSMITH_REPOS_ROOT || (typeof process !== 'undefined' ? process.env?.GITSMITH_REPOS_ROOT : undefined);
  if (reposRoot) {
    try {
      const { hasGitObject, listCommitFiles, readCommitFileContent } = await import('../../src/lib/gitsmith/gitStorage');
      if (hasGitObject(reposRoot, storageKey, commitOid)) {
        const files = listCommitFiles(reposRoot, storageKey, commitOid);
        const manifestContents: Record<string, string> = {};
        for (const file of manifestCandidates) {
          const matched = files.find(f => f.toLowerCase() === file.toLowerCase() || f.toLowerCase().endsWith(`/${file.toLowerCase()}`));
          if (matched) {
            const content = readCommitFileContent(reposRoot, storageKey, commitOid, matched);
            if (content !== null) manifestContents[matched] = content;
          }
        }
        return { exists: true, files, manifestContents };
      }
    } catch {}
  }

  return {
    exists: false,
    files: [],
    manifestContents: {},
    error: 'GITSMITH gateway is not configured and no local repository exists'
  };
}

async function fetchSourceArchive(
  env: any,
  storageKey: string,
  commitOid: string
): Promise<{ archive: Buffer | null; error?: string }> {
  
  if (env?.GITSMITH_GATEWAY_URL && env?.GITSMITH_GATEWAY_TOKEN) {
    const gatewayUrl = new URL('/api/gateway/archive', env.GITSMITH_GATEWAY_URL);
    gatewayUrl.searchParams.set('storageKey', storageKey);
    gatewayUrl.searchParams.set('commitOid', commitOid);
    const gatewayFetch: typeof fetch = env.__GITSMITH_GATEWAY_FETCH || fetch;
    try {
      const res = await gatewayFetch(gatewayUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${env.GITSMITH_GATEWAY_TOKEN}`
        }
      });
      if (!res.ok) {
        const errBody: any = await res.json().catch(() => ({}));
        return {
          archive: null,
          error: errBody?.error || `GITSMITH gateway returned HTTP ${res.status} when retrieving source archive.`
        };
      }
      const arrayBuf = await res.arrayBuffer();
      return { archive: Buffer.from(arrayBuf) };
    } catch (err: any) {
      return { archive: null, error: `GITSMITH gateway unreachable: ${err?.message || 'network error'}` };
    }
  }

  
  const reposRoot = env?.GITSMITH_REPOS_ROOT || (typeof process !== 'undefined' ? process.env?.GITSMITH_REPOS_ROOT : undefined);
  if (reposRoot) {
    try {
      const { archiveAuthoritativeCommit } = await import('../../src/lib/gitsmith/gitStorage');
      const archive = archiveAuthoritativeCommit(reposRoot, storageKey, commitOid);
      return { archive };
    } catch (err: any) {
      return { archive: null, error: err?.message || 'Failed to archive local commit.' };
    }
  }

  return { archive: null, error: 'GITSMITH gateway is not configured and no local repository exists' };
}

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

    if (!APP_ID_REGEX.test(appId)) {
      return json({ success: false, error: `Invalid appId '${appId}': must match ^[a-z0-9][a-z0-9-]{0,62}$` }, 400);
    }

    const auth = await requireAuth(request, env);
    if (auth.errorResponse || !auth.user) {
      return auth.errorResponse || json({ success: false, error: 'Authentication required' }, 401);
    }

    const listing = await env.DB.prepare(`
      SELECT 
        a.id, a.name, a.version, a.creator_id AS creatorId, a.listing_status AS listingStatus,
        a.deployment_state AS deploymentState, a.deployment_error AS deploymentError,
        a.deployment_evidence_json AS deploymentEvidenceJson,
        a.detected_project_type AS detectedProjectType,
        a.deployment_plan_json AS deploymentPlanJson,
        a.active_deployment_id AS activeDeploymentId,
        a.active_commit_oid AS activeCommitOid,
        a.origin_kind AS originKind,
        a.origin_ref AS originRef,
        a.db_kind AS dbKind,
        a.db_secret_path AS dbSecretPath,
        a.db_provisioned_at AS dbProvisionedAt,
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

    if (listing.creatorId !== auth.user.id && auth.user.role !== 'super_admin') {
      return json({ success: false, error: 'Forbidden: you do not own this application listing' }, 403);
    }

    const isCurrentlyActive = listing.deploymentState === 'active' && Boolean(listing.activeDeploymentId && listing.revisionStatus === 'healthy');

    
    
    if (listing.repositoryId || appId) {
      try {
        const runningBuild = await env.DB.prepare(`
          SELECT id, repository_id, commit_oid, purpose, status, runner_image_digest,
                 build_command, test_command, source_manifest_digest, started_at
          FROM build_runs
          WHERE (repository_id = ? OR repository_id = ?) AND status = 'running'
          ORDER BY started_at DESC LIMIT 1
        `).bind(listing.repositoryId || appId, appId).first();

        if (runningBuild && runningBuild.runner_image_digest) {
          const commitOid = runningBuild.commit_oid;
          if (!COMMIT_OID_REGEX.test(commitOid)) {
            const errorMsg = `Invalid commitOid '${commitOid}': must match ^[a-f0-9]{40}([a-f0-9]{24})?$`;
            const failureEvidence = {
              stage: 'build',
              status: 'failed',
              details: errorMsg,
              lastDeployError: errorMsg,
              codeBuildId: runningBuild.runner_image_digest,
              commitOid,
              timestamp: new Date().toISOString()
            };

            const casRes = await env.DB.prepare(`
              UPDATE build_runs SET
                status = 'failed',
                exit_code = 1,
                finished_at = CURRENT_TIMESTAMP
              WHERE id = ? AND status = 'running'
            `).bind(runningBuild.id).run();

            const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
            if (changes > 0) {
              if (isCurrentlyActive) {
                await env.DB.prepare(`
                  UPDATE app_listings SET
                    deployment_evidence_json = ?
                  WHERE id = ?
                `).bind(JSON.stringify(failureEvidence), appId).run();

                listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
              } else {
                await env.DB.prepare(`
                  UPDATE app_listings SET
                    deployment_state = 'failed',
                    deployment_error = ?,
                    deployment_evidence_json = ?
                  WHERE id = ?
                `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

                listing.deploymentState = 'failed';
                listing.deploymentError = errorMsg;
                listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
              }
            }
          } else {
            const codeBuildId = runningBuild.runner_image_digest;
            
            
            
            
            
            const isDeployStage = runningBuild.build_command === 'nsw-deploy' ||
              runningBuild.build_command === 'nsw-deploy-next' ||
              codeBuildId.startsWith('nsw-deploy:') ||
              codeBuildId.startsWith('nsw-deploy') ||
              (env?.AWS_CODEBUILD_DEPLOY_PROJECT && codeBuildId.startsWith(env.AWS_CODEBUILD_DEPLOY_PROJECT + ':'));

            const isNextLane = runningBuild.build_command === 'nsw-build-next' ||
              runningBuild.build_command === 'nsw-deploy-next';

            const batchRes = await batchGetCodeBuilds(env, { buildIds: [codeBuildId] });

            if (batchRes.success && Array.isArray(batchRes.builds) && batchRes.builds.length > 0) {
              const cbBuild = batchRes.builds[0];
              const buildStatus = cbBuild.buildStatus;

              if (isDeployStage) {
                
                
                
                if (buildStatus === 'SUCCEEDED') {
                  const workerUrl = extractWorkerUrl(cbBuild);
                  if (!workerUrl) {
                    const errorMsg = isNextLane
                      ? 'nsw-deploy-next succeeded but no DEPLOYED_WORKER_URL was found in build output'
                      : 'nsw-deploy succeeded but no DEPLOYED_WORKER_URL was found in build output';
                    const failureEvidence = {
                      stage: 'deploy',
                      status: 'failed',
                      details: errorMsg,
                      lastDeployError: errorMsg,
                      codeBuildId,
                      commitOid,
                      timestamp: new Date().toISOString()
                    };

                    const casRes = await env.DB.prepare(`
                      UPDATE build_runs SET
                        status = 'failed',
                        exit_code = 1,
                        finished_at = CURRENT_TIMESTAMP
                      WHERE id = ? AND status = 'running'
                    `).bind(runningBuild.id).run();

                    const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
                    if (changes > 0) {
                      if (isCurrentlyActive) {
                        await env.DB.prepare(`
                          UPDATE app_listings SET
                            deployment_evidence_json = ?
                          WHERE id = ?
                        `).bind(JSON.stringify(failureEvidence), appId).run();

                        listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                      } else {
                        await env.DB.prepare(`
                          UPDATE app_listings SET
                            deployment_state = 'failed',
                            deployment_error = ?,
                            deployment_evidence_json = ?
                          WHERE id = ?
                        `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

                        listing.deploymentState = 'failed';
                        listing.deploymentError = errorMsg;
                        listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                      }
                    }
                  } else {
                    
                    const casRes = await env.DB.prepare(`
                      UPDATE build_runs SET
                        status = 'passed',
                        result_digest = ?,
                        exit_code = 0,
                        finished_at = CURRENT_TIMESTAMP
                      WHERE id = ? AND status = 'running'
                    `).bind(workerUrl, runningBuild.id).run();

                    const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
                    if (changes > 0) {
                      const targetOriginKind = isNextLane ? 'worker' : 'cf_container';
                      const revRow: any = await env.DB.prepare(`
                        SELECT COALESCE(MAX(revision_number), 0) + 1 AS nextRev
                        FROM deployment_revisions
                        WHERE app_id = ? AND environment = 'production'
                      `).bind(appId).first();
                      const revisionNumber = revRow?.nextRev || 1;
                      const revisionId = `rev_${crypto.randomUUID().replace(/-/g, '')}`;

                      
                      await env.DB.prepare(`
                        INSERT INTO deployment_revisions (
                          id, app_id, repository_id, commit_oid, build_run_id, environment,
                          revision_number, status, url, runtime_config_digest, deployed_by_user_id, deployed_at
                        ) VALUES (?, ?, ?, ?, ?, 'production', ?, 'healthy', ?, ?, ?, CURRENT_TIMESTAMP)
                      `).bind(
                        revisionId,
                        appId,
                        listing.repositoryId || appId,
                        commitOid,
                        runningBuild.id,
                        revisionNumber,
                        workerUrl,
                        runningBuild.test_command || runningBuild.source_manifest_digest || targetOriginKind,
                        listing.creatorId || 'system'
                      ).run();

                      const promotionEvidence = {
                        stage: 'deploy',
                        status: 'passed',
                        details: isNextLane
                          ? 'nsw-deploy-next succeeded. Next.js OpenNext Worker deployed and runtime smoke verified.'
                          : 'nsw-deploy succeeded. CF Container Worker deployed and runtime smoke verified.',
                        codeBuildId,
                        workerUrl,
                        commitOid,
                        deploymentRevisionId: revisionId,
                        timestamp: new Date().toISOString()
                      };

                      
                      
                      
                      
                      
                      
                      
                      const oldActiveId = listing.activeDeploymentId || null;
                      const flipRes = oldActiveId
                        ? await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_state = 'active',
                              origin_kind = ?,
                              origin_ref = ?,
                              active_deployment_id = ?,
                              active_commit_oid = ?,
                              deployment_error = NULL,
                              deployment_evidence_json = ?
                            WHERE id = ? AND (active_deployment_id = ? OR active_deployment_id IS NULL)
                          `).bind(targetOriginKind, workerUrl, revisionId, commitOid, JSON.stringify(promotionEvidence), appId, oldActiveId).run()
                        : await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_state = 'active',
                              origin_kind = ?,
                              origin_ref = ?,
                              active_deployment_id = ?,
                              active_commit_oid = ?,
                              deployment_error = NULL,
                              deployment_evidence_json = ?
                            WHERE id = ? AND active_deployment_id IS NULL
                          `).bind(targetOriginKind, workerUrl, revisionId, commitOid, JSON.stringify(promotionEvidence), appId).run();

                      const flipChanges = flipRes?.meta?.changes ?? (flipRes as any)?.changes ?? 0;

                      
                      if (flipChanges > 0) {
                        await env.DB.prepare(`
                          UPDATE deployment_revisions SET status = 'superseded'
                          WHERE app_id = ? AND environment = 'production' AND status = 'healthy' AND id != ?
                        `).bind(appId, revisionId).run();

                        listing.deploymentState = 'active';
                        listing.originKind = targetOriginKind;
                        listing.originRef = workerUrl;
                        listing.activeDeploymentId = revisionId;
                        listing.activeCommitOid = commitOid;
                        listing.deploymentError = null;
                        listing.deploymentEvidenceJson = JSON.stringify(promotionEvidence);
                        listing.revisionStatus = 'healthy';
                        listing.deploymentUrl = workerUrl;
                      }
                    }
                  }
                } else if (
                  buildStatus === 'FAILED' ||
                  buildStatus === 'FAULT' ||
                  buildStatus === 'TIMED_OUT' ||
                  buildStatus === 'STOPPED'
                ) {
                  const failedPhase = cbBuild.phases?.find((p: any) => p.phaseStatus === 'FAILED');
                  const phaseCtx = failedPhase?.contexts?.[0]?.message || failedPhase?.phaseType || buildStatus;
                  const errorMsg = `CodeBuild deploy failed: ${phaseCtx}`;
                  const failureEvidence = {
                    stage: 'deploy',
                    status: 'failed',
                    details: errorMsg,
                    lastDeployError: errorMsg,
                    codeBuildId,
                    buildStatus,
                    phases: cbBuild.phases,
                    timestamp: new Date().toISOString()
                  };

                  const casRes = await env.DB.prepare(`
                    UPDATE build_runs SET
                      status = 'failed',
                      exit_code = 1,
                      finished_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND status = 'running'
                  `).bind(runningBuild.id).run();

                  const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
                  if (changes > 0) {
                    if (isCurrentlyActive) {
                      await env.DB.prepare(`
                        UPDATE app_listings SET
                          deployment_evidence_json = ?
                        WHERE id = ?
                      `).bind(JSON.stringify(failureEvidence), appId).run();

                      listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                    } else {
                      await env.DB.prepare(`
                        UPDATE app_listings SET
                          deployment_state = 'failed',
                          deployment_error = ?,
                          deployment_evidence_json = ?
                        WHERE id = ?
                      `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

                      listing.deploymentState = 'failed';
                      listing.deploymentError = errorMsg;
                      listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                    }
                  }
                }
              } else {
                
                
                
                if (buildStatus === 'SUCCEEDED') {
                  if (isNextLane) {
                    
                    const artifactBucket = env?.NSW_ARTIFACT_BUCKET || env?.AWS_S3_BUILD_BUCKET || DEFAULT_NSW_ARTIFACT_BUCKET;
                    const artifactDigest = `s3://${artifactBucket}/${appId}/${commitOid}/opennext.tar`;

                    const casRes = await env.DB.prepare(`
                      UPDATE build_runs SET
                        status = 'passed',
                        result_digest = ?,
                        exit_code = 0,
                        finished_at = CURRENT_TIMESTAMP
                      WHERE id = ? AND status = 'running'
                    `).bind(artifactDigest, runningBuild.id).run();

                    const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
                    if (changes > 0) {
                      const deployProject = env?.AWS_CODEBUILD_DEPLOY_PROJECT || DEFAULT_AWS_CODEBUILD_DEPLOY_PROJECT || 'nsw-deploy';
                      const cfAccountId = env?.CF_ACCOUNT_ID || DEFAULT_CF_ACCOUNT_ID || '4219a576830c72b0e6e4ca358e61473a';
                      const deployStart = await startCodeBuild(env, {
                        projectName: deployProject,
                        project: deployProject,
                        buildspecOverride: NSW_DEPLOY_NEXT_BUILDSPEC,
                        envOverrides: {
                          APP_ID: appId,
                          COMMIT_OID: commitOid,
                          CF_ACCOUNT_ID: cfAccountId,
                          ARTIFACT_BUCKET: artifactBucket
                        }
                      });

                      if (!deployStart.success || !deployStart.buildId) {
                        const errorMsg = `Failed to trigger deploy in CodeBuild: ${deployStart.error || 'unknown deploy dispatch error'}`;
                        const failureEvidence = {
                          stage: 'deploy_dispatch',
                          status: 'failed',
                          details: errorMsg,
                          lastDeployError: errorMsg,
                          buildCodeBuildId: codeBuildId,
                          commitOid,
                          timestamp: new Date().toISOString()
                        };

                        if (isCurrentlyActive) {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(JSON.stringify(failureEvidence), appId).run();

                          listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                        } else {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_state = 'failed',
                              deployment_error = ?,
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

                          listing.deploymentState = 'failed';
                          listing.deploymentError = errorMsg;
                          listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                        }
                      } else {
                        const deployCodeBuildId = deployStart.buildId;
                        const deployRunId = `br_dep_${crypto.randomUUID().replace(/-/g, '')}`;

                        await env.DB.prepare(`
                          INSERT INTO build_runs (
                            id, repository_id, commit_oid, purpose, status, runner_image_digest,
                            build_command, test_command, source_manifest_digest, started_at
                          ) VALUES (?, ?, ?, 'release', 'running', ?, 'nsw-deploy-next', ?, ?, CURRENT_TIMESTAMP)
                        `).bind(
                          deployRunId,
                          listing.repositoryId || appId,
                          commitOid,
                          deployCodeBuildId,
                          artifactDigest,
                          artifactDigest
                        ).run();

                        const deployingEvidence = {
                          stage: 'deploy',
                          status: 'running',
                          details: 'Candidate Next.js OpenNext build succeeded; nsw-deploy-next triggered.',
                          buildCodeBuildId: codeBuildId,
                          deployCodeBuildId,
                          commitOid,
                          timestamp: new Date().toISOString()
                        };

                        if (isCurrentlyActive) {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(JSON.stringify(deployingEvidence), appId).run();

                          listing.deploymentEvidenceJson = JSON.stringify(deployingEvidence);
                        } else {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_state = 'building',
                              origin_kind = 'worker',
                              deployment_error = NULL,
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(JSON.stringify(deployingEvidence), appId).run();

                          listing.deploymentState = 'building';
                          listing.originKind = 'worker';
                          listing.deploymentError = null;
                          listing.deploymentEvidenceJson = JSON.stringify(deployingEvidence);
                        }
                      }
                    }
                  } else {
                    const ecrRepo = `nsw/${appId}`;
                    const accountId = env?.AWS_ACCOUNT_ID || DEFAULT_AWS_ACCOUNT_ID;
                    const ecrRes = await describeEcrImages(env, {
                      repositoryName: ecrRepo,
                      imageTag: commitOid,
                      registryId: accountId
                    });

                  if (ecrRes.repoMissing) {
                    const errorMsg = `ECR repo ${ecrRepo} not provisioned`;
                    const failureEvidence = {
                      stage: 'build',
                      status: 'failed',
                      details: errorMsg,
                      lastDeployError: errorMsg,
                      codeBuildId,
                      commitOid,
                      ecrRepo,
                      timestamp: new Date().toISOString()
                    };

                    const casRes = await env.DB.prepare(`
                      UPDATE build_runs SET
                        status = 'failed',
                        exit_code = 1,
                        finished_at = CURRENT_TIMESTAMP
                      WHERE id = ? AND status = 'running'
                    `).bind(runningBuild.id).run();

                    const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
                    if (changes > 0) {
                      if (isCurrentlyActive) {
                        await env.DB.prepare(`
                          UPDATE app_listings SET
                            deployment_evidence_json = ?
                          WHERE id = ?
                        `).bind(JSON.stringify(failureEvidence), appId).run();

                        listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                      } else {
                        await env.DB.prepare(`
                          UPDATE app_listings SET
                            deployment_state = 'failed',
                            deployment_error = ?,
                            deployment_evidence_json = ?
                          WHERE id = ?
                        `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

                        listing.deploymentState = 'failed';
                        listing.deploymentError = errorMsg;
                        listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                      }
                    }
                  } else if (ecrRes.success && ecrRes.imageDigest) {
                    
                    const imageDigest = ecrRes.imageDigest;

                    if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) {
                      const errorMsg = `Invalid ECR image digest format: ${imageDigest}`;
                      const failureEvidence = {
                        stage: 'deploy_dispatch',
                        status: 'failed',
                        details: errorMsg,
                        lastDeployError: errorMsg,
                        codeBuildId,
                        commitOid,
                        ecrRepo,
                        imageDigest,
                        timestamp: new Date().toISOString()
                      };

                      const casRes = await env.DB.prepare(`
                        UPDATE build_runs SET
                          status = 'failed',
                          exit_code = 1,
                          finished_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND status = 'running'
                      `).bind(runningBuild.id).run();

                      const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
                      if (changes > 0) {
                        if (isCurrentlyActive) {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(JSON.stringify(failureEvidence), appId).run();

                          listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                        } else {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_state = 'failed',
                              deployment_error = ?,
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

                          listing.deploymentState = 'failed';
                          listing.deploymentError = errorMsg;
                          listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                        }
                      }
                    } else {
                      const casRes = await env.DB.prepare(`
                        UPDATE build_runs SET
                          status = 'passed',
                          result_digest = ?,
                          exit_code = 0,
                          finished_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND status = 'running'
                      `).bind(imageDigest, runningBuild.id).run();

                      const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
                      if (changes > 0) {
                        
                        const deployProject = env?.AWS_CODEBUILD_DEPLOY_PROJECT || DEFAULT_AWS_CODEBUILD_DEPLOY_PROJECT || 'nsw-deploy';
                        const cfAccountId = env?.CF_ACCOUNT_ID || DEFAULT_CF_ACCOUNT_ID || '4219a576830c72b0e6e4ca358e61473a';
                        const deployEnvOverrides: Record<string, string> = {
                          APP_ID: appId,
                          COMMIT_OID: commitOid,
                          ECR_REPO: ecrRepo,
                          IMAGE_DIGEST: imageDigest,
                          CF_ACCOUNT_ID: cfAccountId,
                          INSTANCE_TYPE: 'lite'
                        };
                        if (listing.dbSecretPath) {
                          deployEnvOverrides.DB_SECRET_PATH = listing.dbSecretPath;
                        }

                        const deployStart = await startCodeBuild(env, {
                          projectName: deployProject,
                          project: deployProject,
                          envOverrides: deployEnvOverrides
                        });

                      if (!deployStart.success || !deployStart.buildId) {
                        const errorMsg = `Failed to trigger deploy in CodeBuild: ${deployStart.error || 'unknown deploy dispatch error'}`;
                        const failureEvidence = {
                          stage: 'deploy_dispatch',
                          status: 'failed',
                          details: errorMsg,
                          lastDeployError: errorMsg,
                          buildCodeBuildId: codeBuildId,
                          commitOid,
                          ecrRepo,
                          imageDigest,
                          timestamp: new Date().toISOString()
                        };

                        if (isCurrentlyActive) {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(JSON.stringify(failureEvidence), appId).run();

                          listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                        } else {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_state = 'failed',
                              deployment_error = ?,
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

                          listing.deploymentState = 'failed';
                          listing.deploymentError = errorMsg;
                          listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                        }
                      } else {
                        const deployCodeBuildId = deployStart.buildId;
                        const deployRunId = `br_dep_${crypto.randomUUID().replace(/-/g, '')}`;

                        await env.DB.prepare(`
                          INSERT INTO build_runs (
                            id, repository_id, commit_oid, purpose, status, runner_image_digest,
                            build_command, test_command, source_manifest_digest, started_at
                          ) VALUES (?, ?, ?, 'release', 'running', ?, 'nsw-deploy', ?, ?, CURRENT_TIMESTAMP)
                        `).bind(
                          deployRunId,
                          listing.repositoryId || appId,
                          commitOid,
                          deployCodeBuildId,
                          imageDigest,
                          imageDigest
                        ).run();

                        const deployingEvidence = {
                          stage: 'deploy',
                          status: 'running',
                          details: 'Candidate container build succeeded and verified in ECR; nsw-deploy triggered.',
                          buildCodeBuildId: codeBuildId,
                          deployCodeBuildId,
                          ecrRepo,
                          commitOid,
                          imageDigest,
                          timestamp: new Date().toISOString()
                        };

                        if (isCurrentlyActive) {
                          
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(JSON.stringify(deployingEvidence), appId).run();

                          listing.deploymentEvidenceJson = JSON.stringify(deployingEvidence);
                        } else {
                          
                          
                          
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_state = 'building',
                              origin_kind = 'cf_container',
                              deployment_error = NULL,
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(JSON.stringify(deployingEvidence), appId).run();

                          listing.deploymentState = 'building';
                          listing.originKind = 'cf_container';
                          listing.deploymentError = null;
                          listing.deploymentEvidenceJson = JSON.stringify(deployingEvidence);
                        }
                      }
                    }
                  }
                } else {
                    
                    
                    const endMs = parseTimestampMs(cbBuild.endTime) ?? parseTimestampMs(runningBuild.started_at) ?? Date.now();
                    const elapsedMs = Date.now() - endMs;
                    const TEN_MINUTES_MS = 10 * 60 * 1000;

                    if (elapsedMs > TEN_MINUTES_MS) {
                      const errorMsg = 'image never appeared in ECR after build success';
                      const failureEvidence = {
                        stage: 'build',
                        status: 'failed',
                        details: errorMsg,
                        lastDeployError: errorMsg,
                        codeBuildId,
                        commitOid,
                        ecrRepo,
                        ecrError: ecrRes.error,
                        endTime: cbBuild.endTime,
                        elapsedMs,
                        timestamp: new Date().toISOString()
                      };

                      const casRes = await env.DB.prepare(`
                        UPDATE build_runs SET
                          status = 'failed',
                          exit_code = 1,
                          finished_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND status = 'running'
                      `).bind(runningBuild.id).run();

                      const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
                      if (changes > 0) {
                        if (isCurrentlyActive) {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(JSON.stringify(failureEvidence), appId).run();

                          listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                        } else {
                          await env.DB.prepare(`
                            UPDATE app_listings SET
                              deployment_state = 'failed',
                              deployment_error = ?,
                              deployment_evidence_json = ?
                            WHERE id = ?
                          `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

                          listing.deploymentState = 'failed';
                          listing.deploymentError = errorMsg;
                          listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                        }
                      }
                    } else {
                      
                    }
                  }
                }
              } else if (
                buildStatus === 'FAILED' ||
                buildStatus === 'FAULT' ||
                buildStatus === 'TIMED_OUT' ||
                buildStatus === 'STOPPED'
              ) {
                  const failedPhase = cbBuild.phases?.find((p: any) => p.phaseStatus === 'FAILED');
                  const phaseCtx = failedPhase?.contexts?.[0]?.message || failedPhase?.phaseType || buildStatus;
                  const errorMsg = `CodeBuild candidate build failed: ${phaseCtx}`;
                  const failureEvidence = {
                    stage: 'build',
                    status: 'failed',
                    details: errorMsg,
                    lastDeployError: errorMsg,
                    codeBuildId,
                    buildStatus,
                    phases: cbBuild.phases,
                    timestamp: new Date().toISOString()
                  };

                  const casRes = await env.DB.prepare(`
                    UPDATE build_runs SET
                      status = 'failed',
                      exit_code = 1,
                      finished_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND status = 'running'
                  `).bind(runningBuild.id).run();

                  const changes = casRes?.meta?.changes ?? (casRes as any)?.changes ?? 0;
                  if (changes > 0) {
                    if (isCurrentlyActive) {
                      await env.DB.prepare(`
                        UPDATE app_listings SET
                          deployment_evidence_json = ?
                        WHERE id = ?
                      `).bind(JSON.stringify(failureEvidence), appId).run();

                      listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                    } else {
                      await env.DB.prepare(`
                        UPDATE app_listings SET
                          deployment_state = 'failed',
                          deployment_error = ?,
                          deployment_evidence_json = ?
                        WHERE id = ?
                      `).bind(errorMsg, JSON.stringify(failureEvidence), appId).run();

                      listing.deploymentState = 'failed';
                      listing.deploymentError = errorMsg;
                      listing.deploymentEvidenceJson = JSON.stringify(failureEvidence);
                    }
                  }
                }
              }
            }
          }
        }
      } catch {}
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

    const lastDeployError = evidence?.status === 'failed'
      ? (evidence.lastDeployError || evidence.details || evidence.error || null)
      : (evidence?.lastDeployError || null);

    return json({
      success: true,
      appId: listing.id,
      name: listing.name,
      version: listing.version,
      listingStatus: listing.listingStatus,
      deploymentState: state,
      originKind: listing.originKind || (state === 'active' && listing.originRef ? 'cf_container' : 'r2_static'),
      originRef: listing.originRef || null,
      dbKind: listing.dbKind || null,
      dbSecretPath: listing.dbSecretPath || null,
      dbProvisionedAt: listing.dbProvisionedAt || null,
      isVerifiedActive,
      deploymentError: listing.deploymentError,
      lastDeployError,
      deploymentEvidence: evidence,
      detectedProjectType: listing.detectedProjectType,
      deploymentPlan: plan,
      activeDeploymentId: listing.activeDeploymentId,
      activeCommitOid: listing.activeCommitOid,
      activeUrl: isVerifiedActive ? (listing.deploymentUrl || listing.originRef || `https://${listing.id}.nates-software.com`) : null,
      honestMessage: honest
    });
  } catch (err: any) {
    console.error('[DEPLOY] lifecycle query error:', err?.message || err);
    return json({ success: false, error: 'Failed to query deployment lifecycle' }, 500);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  let targetAppId = '';
  let activeBuildRunId = '';
  let targetRepoId = '';
  let targetCommitOid = '';
  let targetPlan: any = null;
  let isCurrentlyActive = false;

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

    if (!APP_ID_REGEX.test(appId)) {
      return json({ success: false, error: `Invalid appId '${appId}': must match ^[a-z0-9][a-z0-9-]{0,62}$` }, 400);
    }

    
    const appListing = await env.DB.prepare(`
      SELECT 
        a.id, a.name, a.creator_id, a.version, a.deployment_state, a.deployment_error, a.repository_id,
        a.active_deployment_id, a.origin_ref, a.origin_kind, a.active_commit_oid,
        a.db_kind, a.db_secret_path, a.db_provisioned_at,
        dr.status AS revisionStatus
      FROM app_listings a
      LEFT JOIN deployment_revisions dr ON dr.id = a.active_deployment_id
      WHERE a.id = ?
    `).bind(appId).first();

    if (!appListing) {
      return json({ success: false, error: `App listing '${appId}' not found` }, 404);
    }

    
    if (appListing.creator_id !== auth.user.id && auth.user.role !== 'super_admin') {
      return json({ success: false, error: 'Forbidden: you do not own this application listing' }, 403);
    }

    isCurrentlyActive = appListing.deployment_state === 'active' && Boolean(appListing.active_deployment_id && appListing.revisionStatus === 'healthy');

    
    if (action === 'plan') {
      let files: string[] = Array.isArray(body.files) ? body.files : [];
      let fileContents: Record<string, string> = typeof body.fileContents === 'object' && body.fileContents !== null ? body.fileContents : {};

      
      if (files.length === 0) {
        const repository = await env.DB.prepare(`
          SELECT r.id, r.storage_key, rf.commit_oid AS headCommitOid
          FROM repositories r
          LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
          WHERE r.id = ? OR r.app_id = ? OR r.slug = ?
        `).bind(appListing.repository_id || appId, appId, appId).first();

        if (repository && repository.headCommitOid) {
          const storageKey = repository.storage_key || `repositories/${repository.id}`;
          const verified = await verifySourceCommit(env, storageKey, repository.headCommitOid);
          if (verified.exists) {
            files = verified.files;
            fileContents = verified.manifestContents;
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

    
    if (action === 'deploy' || action === 'promote') {
      const timestamp = new Date().toISOString();

      
      const repository = await env.DB.prepare(`
        SELECT r.id, r.slug, r.status, r.default_ref, r.storage_key,
               rf.commit_oid AS headCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
        WHERE r.id = ? OR r.app_id = ? OR r.slug = ?
      `).bind(appListing.repository_id || appId, appId, appId).first();

      const storageKey = repository?.storage_key || `repositories/${repository?.id}`;
      const commitOid = repository?.headCommitOid;

      if (!repository || !commitOid) {
        
        const errorMsg = `No deployable revision exists for ${appListing.name}. Source has not been imported into GITSMITH and built by RIG.`;
        const evidence = {
          stage: 'source_verification',
          status: 'failed',
          timestamp,
          details: 'A canonical repository and commit must exist in GITSMITH before candidate build.',
          lastDeployError: errorMsg,
          repositoryId: repository?.id || null,
          commitOid: commitOid || null
        };

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(evidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence
          }, 422);
        }

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

      if (!COMMIT_OID_REGEX.test(commitOid)) {
        const errorMsg = `Invalid commitOid '${commitOid}': must match ^[a-f0-9]{40}([a-f0-9]{24})?$`;
        const evidence = {
          stage: 'source_verification',
          status: 'failed',
          timestamp,
          details: errorMsg,
          lastDeployError: errorMsg,
          repositoryId: repository.id,
          commitOid
        };

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(evidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence
          }, 422);
        }

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?
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

      
      const sourceVerify = await verifySourceCommit(env, storageKey, commitOid);

      if (!sourceVerify.exists) {
        
        const errorMsg = `No deployable revision exists for ${appListing.name}. Source has not been imported into GITSMITH and built by RIG.`;
        const evidence = {
          stage: 'source_verification',
          status: 'failed',
          timestamp,
          details: sourceVerify.error || 'A canonical repository and commit must exist in GITSMITH before candidate build.',
          lastDeployError: errorMsg,
          repositoryId: repository.id,
          commitOid
        };

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(evidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence
          }, 422);
        }

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

      
      const committedFiles = sourceVerify.files;

      if (committedFiles.length === 0) {
        const errorMsg = `Deployment failed for ${appListing.name}: No committed files found in repository tree at ${commitOid.slice(0, 8)}.`;
        const evidence = {
          stage: 'detection',
          status: 'failed',
          timestamp,
          details: 'The committed source tree is empty.',
          lastDeployError: errorMsg,
          repositoryId: repository.id,
          commitOid
        };

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(evidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence
          }, 422);
        }

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

      const detection = detectRigRuntime(committedFiles, sourceVerify.manifestContents);

      if (!detection.isDeployable || !detection.plan) {
        const errorMsg = `Deployment failed for ${appListing.name}: Unsupported project type.`;
        const evidence = {
          stage: 'detection',
          status: 'failed',
          timestamp,
          details: detection.error || 'No recognized project configuration found.',
          lastDeployError: errorMsg,
          reasons: detection.reasons,
          repositoryId: repository.id,
          commitOid
        };

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(evidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence
          }, 422);
        }

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

      const isNextWorker = plan.detectedType === 'next-worker';
      const isServerApp = plan.detectedType === 'python' ||
        plan.detectedType === 'rust' ||
        plan.detectedType === 'go' ||
        plan.detectedType === 'docker' ||
        (plan.detectedType === 'node' && plan.startCommand !== 'static-pages-runtime');

      
      
      if (plan.postgres && !isServerApp) {
        const errorMsg = `Deployment failed for ${appListing.name}: Postgres add-on is only supported for server/container applications (cf_container), not static applications.`;
        const evidence = {
          stage: 'detection',
          status: 'failed',
          timestamp,
          details: errorMsg,
          lastDeployError: errorMsg,
          repositoryId: repository.id,
          commitOid,
          plan
        };

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(evidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence
          }, 422);
        }

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?,
            detected_project_type = ?
          WHERE id = ?
        `).bind(errorMsg, JSON.stringify(evidence), plan.detectedType, appId).run();

        return json({
          success: false,
          appId,
          deploymentState: 'failed',
          error: errorMsg,
          evidence
        }, 422);
      }

      
      if (isNextWorker) {
        
        await env.DB.prepare(`
          UPDATE build_runs SET
            status = 'cancelled',
            finished_at = CURRENT_TIMESTAMP
          WHERE (repository_id = ? OR repository_id = ?) AND status = 'running'
        `).bind(repository.id, appId).run();

        
        const buildId = crypto.randomUUID();
        const buildRunId = `br_${buildId.replace(/-/g, '')}`;
        activeBuildRunId = buildRunId;

        const archiveResult = await fetchSourceArchive(env, storageKey, commitOid);
        if (!archiveResult.archive) {
          const errorMsg = `Deployment failed for ${appListing.name}: Unable to fetch source archive from GITSMITH gateway (${archiveResult.error || 'unknown error'}).`;
          const evidence = {
            stage: 'source_archive',
            status: 'failed',
            timestamp,
            details: archiveResult.error || 'Authoritative source archive could not be retrieved.',
            lastDeployError: errorMsg,
            repositoryId: repository.id,
            commitOid
          };

          if (isCurrentlyActive) {
            await env.DB.prepare(`
              UPDATE app_listings SET
                deployment_evidence_json = ?
              WHERE id = ?
            `).bind(JSON.stringify(evidence), appId).run();

            return json({
              success: false,
              appId,
              deploymentState: 'active',
              error: errorMsg,
              lastDeployError: errorMsg,
              evidence
            }, 422);
          }

          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_state = 'failed',
              deployment_error = ?,
              deployment_evidence_json = ?
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

        const sourceArchive = archiveResult.archive;
        const sourceManifestDigest = digest(sourceArchive);
        const s3Bucket = env?.AWS_S3_BUILD_BUCKET || DEFAULT_AWS_S3_BUILD_BUCKET;
        const artifactBucket = env?.NSW_ARTIFACT_BUCKET || env?.AWS_S3_BUILD_BUCKET || DEFAULT_NSW_ARTIFACT_BUCKET;
        const s3Key = `${buildId}.tar`;
        const codebuildProject = env?.AWS_CODEBUILD_PROJECT || DEFAULT_AWS_CODEBUILD_PROJECT;

        
        const s3Result = await putS3SourceArchive(env, {
          bucket: s3Bucket,
          key: s3Key,
          body: sourceArchive,
          contentType: 'application/x-tar'
        });

        if (!s3Result.success) {
          const errorMsg = `Deployment failed for ${appListing.name}: Failed to stage source tarball to S3 (${s3Result.error || 'upload error'}).`;
          const failureEvidence = {
            stage: 'source_staging',
            status: 'failed',
            timestamp: new Date().toISOString(),
            details: errorMsg,
            lastDeployError: errorMsg,
            repositoryId: repository.id,
            commitOid,
            s3Bucket,
            s3Key
          };

          if (isCurrentlyActive) {
            await env.DB.prepare(`
              UPDATE app_listings SET
                deployment_evidence_json = ?
              WHERE id = ?
            `).bind(JSON.stringify(failureEvidence), appId).run();

            return json({
              success: false,
              appId,
              deploymentState: 'active',
              error: errorMsg,
              lastDeployError: errorMsg,
              evidence: failureEvidence
            }, 422);
          }

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

        
        const cbResult = await startCodeBuild(env, {
          projectName: codebuildProject,
          buildspecOverride: NSW_BUILD_NEXT_BUILDSPEC,
          envOverrides: {
            SOURCE_BUCKET: s3Bucket,
            SOURCE_KEY: s3Key,
            APP_ID: appId,
            COMMIT_OID: commitOid,
            ARTIFACT_BUCKET: artifactBucket
          }
        });

        if (!cbResult.success || !cbResult.buildId) {
          const errorMsg = `Deployment failed for ${appListing.name}: Failed to start CodeBuild build (${cbResult.error || 'start build error'}).`;
          const failureEvidence = {
            stage: 'build_dispatch',
            status: 'failed',
            timestamp: new Date().toISOString(),
            details: errorMsg,
            lastDeployError: errorMsg,
            repositoryId: repository.id,
            commitOid,
            projectName: codebuildProject
          };

          if (isCurrentlyActive) {
            await env.DB.prepare(`
              UPDATE app_listings SET
                deployment_evidence_json = ?
              WHERE id = ?
            `).bind(JSON.stringify(failureEvidence), appId).run();

            return json({
              success: false,
              appId,
              deploymentState: 'active',
              error: errorMsg,
              lastDeployError: errorMsg,
              evidence: failureEvidence
            }, 422);
          }

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

        const codeBuildId = cbResult.buildId;

        await env.DB.prepare(`
          INSERT INTO build_runs (
            id, repository_id, commit_oid, purpose, status, runner_image_digest,
            build_command, test_command, source_manifest_digest, started_at
          ) VALUES (?, ?, ?, 'release', 'running', ?, 'nsw-build-next', ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          buildRunId,
          repository.id,
          commitOid,
          codeBuildId,
          plan.healthCommand || null,
          sourceManifestDigest
        ).run();

        const buildingEvidence = {
          stage: 'build',
          status: 'running',
          timestamp: new Date().toISOString(),
          details: `Candidate Next.js OpenNext build dispatched to AWS CodeBuild (${codeBuildId}).`,
          buildId,
          codeBuildId,
          commitOid,
          sourceBucket: s3Bucket,
          sourceKey: s3Key,
          plan
        };

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              detected_project_type = ?,
              deployment_plan_json = ?,
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(
            plan.detectedType,
            JSON.stringify(plan),
            JSON.stringify(buildingEvidence),
            appId
          ).run();

          return json({
            success: true,
            appId,
            deploymentState: 'active',
            buildId,
            codeBuildId,
            buildRunId,
            commitOid,
            message: `Candidate Next.js OpenNext build dispatched to AWS CodeBuild (${codeBuildId})`
          }, 202);
        } else {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_state = 'building',
              origin_kind = 'worker',
              detected_project_type = ?,
              deployment_plan_json = ?,
              active_commit_oid = ?,
              deployment_error = NULL,
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(
            plan.detectedType,
            JSON.stringify(plan),
            commitOid,
            JSON.stringify(buildingEvidence),
            appId
          ).run();

          return json({
            success: true,
            appId,
            deploymentState: 'building',
            buildId,
            codeBuildId,
            buildRunId,
            commitOid,
            message: `Candidate Next.js OpenNext build dispatched to AWS CodeBuild (${codeBuildId})`
          }, 202);
        }
      }

      
      if (isServerApp) {
        
        let dbSecretPath: string | null = appListing.db_secret_path || null;
        if (plan.postgres) {
          const dbResult = await provisionAppDatabase(env, appId);
          if (!dbResult.success) {
            const errorMsg = `Deployment failed for ${appListing.name}: Failed to provision database (${dbResult.error || 'provisioning error'}).`;
            const failureEvidence = {
              stage: 'database_provisioning',
              status: 'failed',
              timestamp: new Date().toISOString(),
              details: errorMsg,
              lastDeployError: errorMsg,
              repositoryId: repository.id,
              commitOid
            };

            if (isCurrentlyActive) {
              await env.DB.prepare(`
                UPDATE app_listings SET
                  deployment_evidence_json = ?
                WHERE id = ?
              `).bind(JSON.stringify(failureEvidence), appId).run();

              return json({
                success: false,
                appId,
                deploymentState: 'active',
                error: errorMsg,
                lastDeployError: errorMsg,
                evidence: failureEvidence
              }, 422);
            }

            await env.DB.prepare(`
              UPDATE app_listings SET
                deployment_state = 'failed',
                deployment_error = ?,
                deployment_evidence_json = ?,
                detected_project_type = ?
              WHERE id = ?
            `).bind(errorMsg, JSON.stringify(failureEvidence), plan.detectedType, appId).run();

            return json({
              success: false,
              appId,
              deploymentState: 'failed',
              error: errorMsg,
              evidence: failureEvidence
            }, 422);
          }

          dbSecretPath = dbResult.secretPath || `/nsw/apps/${appId}/db-url`;

          
          await env.DB.prepare(`
            UPDATE app_listings SET
              db_kind = 'postgres',
              db_secret_path = ?,
              db_provisioned_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(dbSecretPath, appId).run();
        }

        
        await env.DB.prepare(`
          UPDATE build_runs SET
            status = 'cancelled',
            finished_at = CURRENT_TIMESTAMP
          WHERE (repository_id = ? OR repository_id = ?) AND status = 'running'
        `).bind(repository.id, appId).run();

        
        const buildId = crypto.randomUUID();
        const buildRunId = `br_${buildId.replace(/-/g, '')}`;
        activeBuildRunId = buildRunId;

        const archiveResult = await fetchSourceArchive(env, storageKey, commitOid);
        if (!archiveResult.archive) {
          const errorMsg = `Deployment failed for ${appListing.name}: Unable to fetch source archive from GITSMITH gateway (${archiveResult.error || 'unknown error'}).`;
          const evidence = {
            stage: 'source_archive',
            status: 'failed',
            timestamp,
            details: archiveResult.error || 'Authoritative source archive could not be retrieved.',
            lastDeployError: errorMsg,
            repositoryId: repository.id,
            commitOid
          };

          if (isCurrentlyActive) {
            await env.DB.prepare(`
              UPDATE app_listings SET
                deployment_evidence_json = ?
              WHERE id = ?
            `).bind(JSON.stringify(evidence), appId).run();

            return json({
              success: false,
              appId,
              deploymentState: 'active',
              error: errorMsg,
              lastDeployError: errorMsg,
              evidence
            }, 422);
          }

          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_state = 'failed',
              deployment_error = ?,
              deployment_evidence_json = ?
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

        const sourceArchive = archiveResult.archive;
        const sourceManifestDigest = digest(sourceArchive);
        const s3Bucket = env?.AWS_S3_BUILD_BUCKET || DEFAULT_AWS_S3_BUILD_BUCKET;
        const s3Key = `${buildId}.tar`;
        const ecrRepo = `nsw/${appId}`;
        const codebuildProject = env?.AWS_CODEBUILD_PROJECT || DEFAULT_AWS_CODEBUILD_PROJECT;
        const procfileStart = plan.startCommand || plan.buildCommand || '';

        
        const s3Result = await putS3SourceArchive(env, {
          bucket: s3Bucket,
          key: s3Key,
          body: sourceArchive,
          contentType: 'application/x-tar'
        });

        if (!s3Result.success) {
          const errorMsg = `Deployment failed for ${appListing.name}: Failed to stage source tarball to S3 (${s3Result.error || 'upload error'}).`;
          const failureEvidence = {
            stage: 'source_staging',
            status: 'failed',
            timestamp: new Date().toISOString(),
            details: errorMsg,
            lastDeployError: errorMsg,
            repositoryId: repository.id,
            commitOid,
            s3Bucket,
            s3Key
          };

          if (isCurrentlyActive) {
            await env.DB.prepare(`
              UPDATE app_listings SET
                deployment_evidence_json = ?
              WHERE id = ?
            `).bind(JSON.stringify(failureEvidence), appId).run();

            return json({
              success: false,
              appId,
              deploymentState: 'active',
              error: errorMsg,
              lastDeployError: errorMsg,
              evidence: failureEvidence
            }, 422);
          }

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

        
        const ecrResult = await createEcrRepository(env, {
          repositoryName: ecrRepo
        });

        if (!ecrResult.success) {
          const errorMsg = `Deployment failed for ${appListing.name}: Failed to provision ECR repository (${ecrResult.error || 'ECR repository provisioning error'}).`;
          const failureEvidence = {
            stage: 'ecr_provisioning',
            status: 'failed',
            timestamp: new Date().toISOString(),
            details: errorMsg,
            lastDeployError: errorMsg,
            repositoryId: repository.id,
            commitOid,
            ecrRepo
          };

          if (isCurrentlyActive) {
            await env.DB.prepare(`
              UPDATE app_listings SET
                deployment_evidence_json = ?
              WHERE id = ?
            `).bind(JSON.stringify(failureEvidence), appId).run();

            return json({
              success: false,
              appId,
              deploymentState: 'active',
              error: errorMsg,
              lastDeployError: errorMsg,
              evidence: failureEvidence
            }, 422);
          }

          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_state = 'failed',
              deployment_error = ?,
              deployment_evidence_json = ?,
              detected_project_type = ?
            WHERE id = ?
          `).bind(errorMsg, JSON.stringify(failureEvidence), plan.detectedType, appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'failed',
            error: errorMsg,
            evidence: failureEvidence
          }, 422);
        }

        
        const cbResult = await startCodeBuild(env, {
          projectName: codebuildProject,
          envOverrides: {
            SOURCE_BUCKET: s3Bucket,
            SOURCE_KEY: s3Key,
            ECR_REPO: ecrRepo,
            COMMIT_OID: commitOid,
            PROCFILE_START: procfileStart
          }
        });

        if (!cbResult.success || !cbResult.buildId) {
          const errorMsg = `Deployment failed for ${appListing.name}: Failed to start CodeBuild build (${cbResult.error || 'start build error'}).`;
          const failureEvidence = {
            stage: 'build_dispatch',
            status: 'failed',
            timestamp: new Date().toISOString(),
            details: errorMsg,
            lastDeployError: errorMsg,
            repositoryId: repository.id,
            commitOid,
            projectName: codebuildProject
          };

          if (isCurrentlyActive) {
            await env.DB.prepare(`
              UPDATE app_listings SET
                deployment_evidence_json = ?
              WHERE id = ?
            `).bind(JSON.stringify(failureEvidence), appId).run();

            return json({
              success: false,
              appId,
              deploymentState: 'active',
              error: errorMsg,
              lastDeployError: errorMsg,
              evidence: failureEvidence
            }, 422);
          }

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

        const codeBuildId = cbResult.buildId;

        await env.DB.prepare(`
          INSERT INTO build_runs (
            id, repository_id, commit_oid, purpose, status, runner_image_digest,
            build_command, test_command, source_manifest_digest, started_at
          ) VALUES (?, ?, ?, 'release', 'running', ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          buildRunId,
          repository.id,
          commitOid,
          codeBuildId,
          procfileStart || 'none',
          plan.healthCommand || null,
          sourceManifestDigest
        ).run();

        const buildingEvidence = {
          stage: 'build',
          status: 'running',
          timestamp: new Date().toISOString(),
          details: `Candidate container build dispatched to AWS CodeBuild (${codeBuildId}).`,
          buildId,
          codeBuildId,
          ecrRepo,
          commitOid,
          sourceBucket: s3Bucket,
          sourceKey: s3Key,
          plan
        };

        if (isCurrentlyActive) {
          
          
          
          await env.DB.prepare(`
            UPDATE app_listings SET
              detected_project_type = ?,
              deployment_plan_json = ?,
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(
            plan.detectedType,
            JSON.stringify(plan),
            JSON.stringify(buildingEvidence),
            appId
          ).run();

          return json({
            success: true,
            appId,
            deploymentState: 'active',
            buildId,
            codeBuildId,
            buildRunId,
            commitOid,
            ecrRepo,
            message: `Candidate container build dispatched to AWS CodeBuild (${codeBuildId})`
          }, 202);
        } else {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_state = 'building',
              origin_kind = 'cf_container',
              detected_project_type = ?,
              deployment_plan_json = ?,
              active_commit_oid = ?,
              deployment_error = NULL,
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(
            plan.detectedType,
            JSON.stringify(plan),
            commitOid,
            JSON.stringify(buildingEvidence),
            appId
          ).run();

          return json({
            success: true,
            appId,
            deploymentState: 'building',
            buildId,
            codeBuildId,
            buildRunId,
            commitOid,
            ecrRepo,
            message: `Candidate container build dispatched to AWS CodeBuild (${codeBuildId})`
          }, 202);
        }
      }

      
      
      await env.DB.prepare(`
        UPDATE build_runs SET
          status = 'cancelled',
          finished_at = CURRENT_TIMESTAMP
        WHERE (repository_id = ? OR repository_id = ?) AND status = 'running'
      `).bind(repository.id, appId).run();

      const buildRunId = `br_${crypto.randomUUID().replace(/-/g, '')}`;
      activeBuildRunId = buildRunId;
      const runnerImageDigest = env?.RIG_VERIFICATION_IMAGE_DIGEST || 'node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';

      const archiveResult = await fetchSourceArchive(env, storageKey, commitOid);
      if (!archiveResult.archive) {
        const errorMsg = `Deployment failed for ${appListing.name}: Unable to fetch source archive from GITSMITH gateway (${archiveResult.error || 'unknown error'}).`;
        const evidence = {
          stage: 'source_archive',
          status: 'failed',
          timestamp,
          details: archiveResult.error || 'Authoritative source archive could not be retrieved.',
          lastDeployError: errorMsg,
          repositoryId: repository.id,
          commitOid
        };

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(evidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence
          }, 422);
        }

        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'failed',
            deployment_error = ?,
            deployment_evidence_json = ?
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

      const sourceArchive = archiveResult.archive;
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

      if (isCurrentlyActive) {
        await env.DB.prepare(`
          UPDATE app_listings SET
            detected_project_type = ?,
            deployment_plan_json = ?
          WHERE id = ?
        `).bind(plan.detectedType, JSON.stringify(plan), appId).run();
      } else {
        await env.DB.prepare(`
          UPDATE app_listings SET
            deployment_state = 'building',
            detected_project_type = ?,
            deployment_plan_json = ?,
            active_commit_oid = ?
          WHERE id = ?
        `).bind(plan.detectedType, JSON.stringify(plan), commitOid, appId).run();
      }

      
      let buildResult: any;

      if (typeof env?.__RIG_DEPLOY_EXECUTOR === 'function') {
        buildResult = await env.__RIG_DEPLOY_EXECUTOR({
          appId,
          repositoryId: repository.id,
          storageKey,
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
            storageKey,
            commitOid,
            plan,
            sourceArchiveBase64: sourceArchive.toString('base64'),
            runnerImageDigest
          })
        }).catch((err: any) => ({ ok: false, status: 503, json: async () => ({ error: err?.message || 'Gateway unreachable' }) }));

        const gData = await gatewayRes.json().catch(() => null);
        if (gData?.result) {
          buildResult = gData.result;
        } else {
          const errMsg = gData?.error || `RIG gateway returned ${gatewayRes.status}`;
          buildResult = {
            success: false,
            exitCode: 1,
            output: errMsg,
            artifactDigest: '',
            artifactKind: 'bundle',
            smokeCheck: { passed: false, statusCode: gatewayRes.status, durationMs: 0, error: errMsg },
            durationMs: 0,
            error: errMsg
          };
        }
      } else {
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

      
      if (!buildResult || !buildResult.success || buildResult.exitCode !== 0 || !buildResult.smokeCheck?.passed) {
        const errorMsg = buildResult?.error || buildResult?.smokeCheck?.error || `Build or smoke check failed for ${appListing.name}.`;
        const failureEvidence = {
          stage: (buildResult?.exitCode ?? 1) !== 0 ? 'build' : 'smoke_check',
          status: 'failed',
          timestamp: new Date().toISOString(),
          details: errorMsg,
          lastDeployError: errorMsg,
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

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(failureEvidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence: failureEvidence
          }, 422);
        }

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

      
      
      if (!env?.STORAGE) {
        const errorMsg = `Deployment publication failed for ${appListing.name}: Artifact storage service (R2 STORAGE) is unavailable.`;
        const storageEvidence = {
          stage: 'storage_publication',
          status: 'failed',
          timestamp: new Date().toISOString(),
          details: errorMsg,
          lastDeployError: errorMsg,
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

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(storageEvidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence: storageEvidence
          }, 422);
        }

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
          status: 'failed',
          timestamp: new Date().toISOString(),
          details: errorMsg,
          lastDeployError: errorMsg,
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

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(storageEvidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence: storageEvidence
          }, 422);
        }

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
          status: 'failed',
          timestamp: new Date().toISOString(),
          details: errorMsg,
          lastDeployError: errorMsg,
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

        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(storageEvidence), appId).run();

          return json({
            success: false,
            appId,
            deploymentState: 'active',
            error: errorMsg,
            lastDeployError: errorMsg,
            evidence: storageEvidence
          }, 422);
        }

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

      
      await env.DB.prepare(`
        UPDATE build_runs SET
          status = 'passed',
          result_digest = ?,
          exit_code = 0,
          duration_ms = ?,
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(buildResult.artifactDigest, buildResult.durationMs, buildRunId).run();

      
      const revRow: any = await env.DB.prepare(`
        SELECT COALESCE(MAX(revision_number), 0) + 1 AS nextRev
        FROM deployment_revisions
        WHERE app_id = ? AND environment = 'production'
      `).bind(appId).first();
      const revisionNumber = revRow?.nextRev || 1;

      
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

      const promotionEvidence = {
        stage: 'promotion',
        status: 'passed',
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

      
      
      
      
      
      
      
      const oldActiveId = appListing.active_deployment_id || null;
      const flipRes = oldActiveId
        ? await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_state = 'active',
              origin_kind = 'r2_static',
              active_deployment_id = ?,
              active_commit_oid = ?,
              deployment_error = NULL,
              deployment_evidence_json = ?
            WHERE id = ? AND (active_deployment_id = ? OR active_deployment_id IS NULL)
          `).bind(revisionId, commitOid, JSON.stringify(promotionEvidence), appId, oldActiveId).run()
        : await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_state = 'active',
              origin_kind = 'r2_static',
              active_deployment_id = ?,
              active_commit_oid = ?,
              deployment_error = NULL,
              deployment_evidence_json = ?
            WHERE id = ? AND active_deployment_id IS NULL
          `).bind(revisionId, commitOid, JSON.stringify(promotionEvidence), appId).run();

      const flipChanges = flipRes?.meta?.changes ?? (flipRes as any)?.changes ?? 0;

      
      if (flipChanges > 0) {
        await env.DB.prepare(`
          UPDATE deployment_revisions SET status = 'superseded'
          WHERE app_id = ? AND environment = 'production' AND status = 'healthy' AND id != ?
        `).bind(appId, revisionId).run();
      }

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
      status: 'failed',
      timestamp: new Date().toISOString(),
      details: errorMsg,
      lastDeployError: errorMsg,
      error: String(err?.stack || err?.message || err),
      appId: targetAppId || null,
      repositoryId: targetRepoId || null,
      commitOid: targetCommitOid || null,
      buildRunId: activeBuildRunId || null,
      plan: targetPlan || null
    };

    if (env?.DB && targetAppId) {
      try {
        if (isCurrentlyActive) {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(JSON.stringify(failureEvidence), targetAppId).run();
        } else {
          await env.DB.prepare(`
            UPDATE app_listings SET
              deployment_state = 'failed',
              deployment_error = ?,
              deployment_evidence_json = ?
            WHERE id = ?
          `).bind(errorMsg, JSON.stringify(failureEvidence), targetAppId).run();
        }
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

    
    
    
    const { error: _stack, ...clientEvidence } = failureEvidence as any;
    console.error('[DEPLOY] execution error:', String(err?.stack || err?.message || err));
    return json({
      success: false,
      appId: targetAppId || undefined,
      deploymentState: isCurrentlyActive ? 'active' : 'failed',
      error: errorMsg,
      lastDeployError: errorMsg,
      evidence: clientEvidence
    }, 500);
  }
};
