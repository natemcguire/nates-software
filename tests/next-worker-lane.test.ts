import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { initBareRepo } from '../src/lib/gitsmith/gitStorage';
import { hashSessionToken } from '../functions/api/_session';
import * as deployApi from '../functions/api/deploy';
import {
  startCodeBuild
} from '../functions/api/_aws';
import {
  NSW_BUILD_NEXT_BUILDSPEC,
  NSW_DEPLOY_NEXT_BUILDSPEC
} from '../functions/api/_buildspecs';
import { createMemoryR2Bucket } from './aws-controlplane-deploy.test';
import { execFileSync } from 'node:child_process';

describe('Phase 2: Next.js (SSR) -> Cloudflare Worker Lane (origin_kind=worker)', () => {
  let ctx: TestD1Context;
  let tempDir: string;
  let reposRoot: string;
  let storage: any;

  const AWS_CREDS = {
    AWS_ACCESS_KEY_ID: 'AKIA_NSW_TEST_KEY_123',
    AWS_SECRET_ACCESS_KEY: 'secret_nsw_test_secret_456',
    AWS_REGION: 'us-east-2',
    AWS_ACCOUNT_ID: '777772815966',
    AWS_S3_BUILD_BUCKET: 'nsw-build-sources-777772815966',
    NSW_ARTIFACT_BUCKET: 'nsw-build-artifacts-777772815966',
    AWS_CODEBUILD_PROJECT: 'nsw-build',
    AWS_CODEBUILD_DEPLOY_PROJECT: 'nsw-deploy',
    CF_ACCOUNT_ID: '4219a576830c72b0e6e4ca358e61473a'
  };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    tempDir = path.join('/tmp', `next-worker-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    reposRoot = path.join(tempDir, 'repos');
    fs.mkdirSync(reposRoot, { recursive: true });
    process.env.GITSMITH_REPOS_ROOT = reposRoot;
    storage = createMemoryR2Bucket();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
    delete process.env.GITSMITH_REPOS_ROOT;
  });

  function createCommittedRepo(storageKey: string, files: Record<string, string>): { commitOid: string; repoPath: string } {
    const initRes = initBareRepo(reposRoot, {
      storageKey,
      objectFormat: 'sha1',
      defaultRef: 'refs/heads/main'
    });
    expect(initRes.success).toBe(true);

    const workTree = path.join(tempDir, `wt-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(workTree, { recursive: true });

    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(workTree, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
    }

    const env = {
      ...process.env,
      GIT_DIR: initRes.repoPath,
      GIT_WORK_TREE: workTree,
      GIT_AUTHOR_NAME: 'Next Lane Tester',
      GIT_AUTHOR_EMAIL: 'next@nates-software.com',
      GIT_COMMITTER_NAME: 'Next Lane Tester',
      GIT_COMMITTER_EMAIL: 'next@nates-software.com'
    };

    execFileSync('git', ['add', '.'], { env });
    execFileSync('git', ['commit', '-m', 'Add Next.js app source'], { env });
    const commitOid = execFileSync('git', ['rev-parse', 'HEAD'], { env }).toString().trim();

    return { commitOid, repoPath: initRes.repoPath };
  }

  // ==========================================================================
  // 1. Buildspec Drift Tests
  // ==========================================================================
  describe('1. Buildspec Drift Invariants', () => {
    it('NSW_BUILD_NEXT_BUILDSPEC matches infra/codebuild/nsw-build-next.yml byte-for-byte', () => {
      const filePath = path.resolve(__dirname, '../infra/codebuild/nsw-build-next.yml');
      const fileContent = fs.readFileSync(filePath, 'utf8');
      expect(NSW_BUILD_NEXT_BUILDSPEC).toBe(fileContent);
    });

    it('NSW_DEPLOY_NEXT_BUILDSPEC matches infra/codebuild/nsw-deploy-next.yml byte-for-byte', () => {
      const filePath = path.resolve(__dirname, '../infra/codebuild/nsw-deploy-next.yml');
      const fileContent = fs.readFileSync(filePath, 'utf8');
      expect(NSW_DEPLOY_NEXT_BUILDSPEC).toBe(fileContent);
    });

    it('NSW_DEPLOY_NEXT_BUILDSPEC contains SMOKE_OK=1, post-loop fail-closed exit guard, and NO_WORKER_URL guard (Fix #4)', () => {
      expect(NSW_DEPLOY_NEXT_BUILDSPEC).toContain('SMOKE_OK=1');
      expect(NSW_DEPLOY_NEXT_BUILDSPEC).toContain('if [ "${SMOKE_OK:-0}" != "1" ]; then echo "SMOKE_FAILED: worker never returned 200"; exit 1; fi');
      expect(NSW_DEPLOY_NEXT_BUILDSPEC).toContain('if [ -z "$WORKER_URL" ]; then echo "NO_WORKER_URL: wrangler deploy produced no workers.dev URL"; exit 1; fi');
    });

    it('NSW_DEPLOY_NEXT_BUILDSPEC removes extracted wrangler configs and regenerates platform-owned wrangler.jsonc (Fix #2)', () => {
      expect(NSW_DEPLOY_NEXT_BUILDSPEC).toContain('rm -f /tmp/app/wrangler.jsonc /tmp/app/wrangler.toml /tmp/app/wrangler.json');
      expect(NSW_DEPLOY_NEXT_BUILDSPEC).toContain('cat > /tmp/app/wrangler.jsonc <<JSON');
      expect(NSW_DEPLOY_NEXT_BUILDSPEC).toContain('"name": "nsw-app-${APP_ID}"');
      expect(NSW_DEPLOY_NEXT_BUILDSPEC).toContain('"main": ".open-next/worker.js"');
    });

    it('NSW_BUILD_NEXT_BUILDSPEC notes wrangler.jsonc is for dry-run size gate only and regenerated downstream (Fix #2)', () => {
      expect(NSW_BUILD_NEXT_BUILDSPEC).toContain('# Platform writes wrangler.jsonc for the dry-run size gate only;');
      expect(NSW_BUILD_NEXT_BUILDSPEC).toContain('# it is discarded and regenerated downstream in the trusted deploy stage.');
    });
  });

  // ==========================================================================
  // 2. startCodeBuild buildspecOverride Tests
  // ==========================================================================
  describe('2. startCodeBuild buildspecOverride inclusion/omission', () => {
    it('includes buildspecOverride in payload when provided and non-empty', async () => {
      let interceptedPayload: any = null;
      const mockFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        interceptedPayload = JSON.parse(await req.text());
        return Response.json({ build: { id: 'nsw-build:test-build-1', buildStatus: 'IN_PROGRESS' } });
      };

      const res = await startCodeBuild(
        { ...AWS_CREDS, __AWS_FETCH: mockFetch },
        {
          projectName: 'nsw-build',
          buildspecOverride: NSW_BUILD_NEXT_BUILDSPEC,
          envOverrides: {
            APP_ID: 'my-next-app',
            COMMIT_OID: 'a'.repeat(40)
          }
        }
      );

      expect(res.success).toBe(true);
      expect(interceptedPayload).toBeDefined();
      expect(interceptedPayload.buildspecOverride).toBe(NSW_BUILD_NEXT_BUILDSPEC);
      expect(interceptedPayload.projectName).toBe('nsw-build');
    });

    it('omits buildspecOverride property from payload when omitted or empty (byte-identical container callers)', async () => {
      let interceptedPayload: any = null;
      const mockFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        interceptedPayload = JSON.parse(await req.text());
        return Response.json({ build: { id: 'nsw-build:test-build-2', buildStatus: 'IN_PROGRESS' } });
      };

      const res = await startCodeBuild(
        { ...AWS_CREDS, __AWS_FETCH: mockFetch },
        {
          projectName: 'nsw-build',
          envOverrides: {
            APP_ID: 'my-container-app',
            COMMIT_OID: 'b'.repeat(40),
            ECR_REPO: 'nsw/my-container-app'
          }
        }
      );

      expect(res.success).toBe(true);
      expect(interceptedPayload).toBeDefined();
      expect('buildspecOverride' in interceptedPayload).toBe(false);
      expect(Object.keys(interceptedPayload)).toEqual(['projectName', 'environmentVariablesOverride']);
    });
  });

  // ==========================================================================
  // 3. D1 CHECK Schema Acceptance
  // ==========================================================================
  describe('3. D1 Schema Check for origin_kind=worker and detected_project_type=next-worker', () => {
    it('accepts origin_kind=worker and detected_project_type=next-worker on app_listings', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_d1_test', 'd1tester', 'D1 Tester', 'user')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO app_listings (
          id, name, tagline, description, creator_id, version, license, price, storage,
          tags, screenshots, binaries, deployment_state, origin_kind, detected_project_type
        ) VALUES (
          'd1-next-app', 'Next App', 'Tag', 'Desc', 'usr_d1_test', '1.0.0', 'MIT', '$0', 'None',
          '[]', '[]', '{}', 'building', 'worker', 'next-worker'
        )
      `).run();

      const row = await ctx.d1.prepare(`
        SELECT origin_kind, detected_project_type, deployment_state FROM app_listings WHERE id = 'd1-next-app'
      `).first<any>();

      expect(row.origin_kind).toBe('worker');
      expect(row.detected_project_type).toBe('next-worker');
      expect(row.deployment_state).toBe('building');
    });
  });

  // ==========================================================================
  // 4. POST /api/deploy Dispatch (Next Lane)
  // ==========================================================================
  describe('4. POST /api/deploy Next Lane Dispatch', () => {
    const appId = 'my-ssr-next-app';
    const storageKey = `repositories/${appId}`;
    let commitOid: string;
    let makerToken: string;

    beforeEach(async () => {
      makerToken = 'session_maker_next_123';
      const tokenHash = await hashSessionToken(makerToken);

      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_next_maker', 'nextmaker', 'Next Maker', 'user')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_next_maker', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      await ctx.d1.prepare(`
        INSERT INTO app_listings (
          id, name, tagline, description, creator_id, version, license, price, storage,
          tags, screenshots, binaries, deployment_state
        ) VALUES (
          ?, 'SSR Next App', 'Tag', 'Desc', 'usr_next_maker', '1.0.0', 'MIT', '$0', 'None',
          '[]', '[]', '{}', 'draft'
        )
      `).bind(appId).run();

      const repo = createCommittedRepo(storageKey, {
        'package.json': JSON.stringify({
          name: 'my-ssr-next-app',
          dependencies: { next: '^15.0.0', react: '^19.0.0' }
        }),
        'next.config.js': 'module.exports = {};\n',
        'app/page.tsx': 'export default function Home() { return <h1>SSR Next</h1>; }\n'
      });
      commitOid = repo.commitOid;

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_next_1', ?, 'usr_next_maker', ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(appId, appId, storageKey).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_next_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();
    });

    it('stages source to S3, calls startCodeBuild with NSW_BUILD_NEXT_BUILDSPEC, sets origin_kind=worker, and returns 202 building', async () => {
      let s3Uploaded = false;
      let codeBuildPayload: any = null;

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (req.method === 'PUT' && req.url.includes('.s3.')) {
          s3Uploaded = true;
          return new Response('', { status: 200, headers: { etag: '"s3-etag-123"' } });
        }

        if (target === 'CodeBuild_20161006.StartBuild') {
          codeBuildPayload = JSON.parse(await req.text());
          return Response.json({
            build: {
              id: 'nsw-build:next-build-uuid-0001',
              buildStatus: 'IN_PROGRESS'
            }
          });
        }

        return new Response('Not found', { status: 404 });
      };

      const postReq = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${makerToken}`
        },
        body: JSON.stringify({ action: 'deploy', appId })
      });

      const res = await deployApi.onRequestPost({
        request: postReq,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });

      const data: any = await res.json();
      expect(res.status).toBe(202);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('building');
      expect(data.codeBuildId).toBe('nsw-build:next-build-uuid-0001');
      expect(s3Uploaded).toBe(true);

      // Verify CodeBuild StartBuild parameters
      expect(codeBuildPayload).toBeDefined();
      expect(codeBuildPayload.projectName).toBe('nsw-build');
      expect(codeBuildPayload.buildspecOverride).toBe(NSW_BUILD_NEXT_BUILDSPEC);

      const envMap = Object.fromEntries(codeBuildPayload.environmentVariablesOverride.map((e: any) => [e.name, e.value]));
      expect(envMap.APP_ID).toBe(appId);
      expect(envMap.COMMIT_OID).toBe(commitOid);
      expect(envMap.SOURCE_BUCKET).toBe('nsw-build-sources-777772815966');
      expect(envMap.ARTIFACT_BUCKET).toBe('nsw-build-artifacts-777772815966');
      expect(envMap.ECR_REPO).toBeUndefined(); // Next lane has NO ECR

      // Verify D1 state
      const appListing = await ctx.d1.prepare(`
        SELECT deployment_state, origin_kind, detected_project_type FROM app_listings WHERE id = ?
      `).bind(appId).first<any>();
      expect(appListing.deployment_state).toBe('building');
      expect(appListing.origin_kind).toBe('worker');
      expect(appListing.detected_project_type).toBe('next-worker');

      const buildRun = await ctx.d1.prepare(`
        SELECT build_command, runner_image_digest, status FROM build_runs WHERE repository_id = 'repo_next_1'
      `).first<any>();
      expect(buildRun.build_command).toBe('nsw-build-next');
      expect(buildRun.runner_image_digest).toBe('nsw-build:next-build-uuid-0001');
      expect(buildRun.status).toBe('running');
    });
  });

  // ==========================================================================
  // 5. Lazy-finalize Stage 1: Next Lane candidate build SUCCEEDED (Skip ECR)
  // ==========================================================================
  describe('5. Lazy-finalize Stage 1 (Next candidate build SUCCEEDED -> trigger nsw-deploy-next)', () => {
    const appId = 'lazy-next-candidate-app';
    const codeBuildId = 'nsw-build:next-candidate-uuid-1111';
    const commitOid = 'f01234567890abcdef1234567890abcdef123456';

    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_lazy_next', 'lazynext', 'Lazy Next', 'user')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO app_listings (
          id, name, tagline, description, creator_id, version, license, price, storage,
          tags, screenshots, binaries, deployment_state, origin_kind, detected_project_type
        ) VALUES (
          ?, 'Lazy Next App', 'Tag', 'Desc', 'usr_lazy_next', '1.0.0', 'MIT', '$0', 'None',
          '[]', '[]', '{}', 'building', 'worker', 'next-worker'
        )
      `).bind(appId).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_lazy_next_1', ?, 'usr_lazy_next', ?, 'public', 'sha1', 'refs/heads/main', 'repositories/lazy-next', 'active')
      `).bind(appId, appId).run();

      await ctx.d1.prepare(`
        INSERT INTO build_runs (
          id, repository_id, commit_oid, purpose, status, runner_image_digest,
          build_command, source_manifest_digest, started_at
        ) VALUES (
          'br_next_build_1', 'repo_lazy_next_1', ?, 'release', 'running', ?,
          'nsw-build-next', 'sha256:nextmanifest1', CURRENT_TIMESTAMP
        )
      `).bind(commitOid, codeBuildId).run();
    });

    it('skips ECR describeEcrImages, marks build passed with S3 tarball digest, and dispatches nsw-deploy-next', async () => {
      let ecrCalled = false;
      let deployDispatchedPayload: any = null;

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'AmazonEC2ContainerRegistry_V20150921.DescribeImages') {
          ecrCalled = true;
          return Response.json({ imageDetails: [] });
        }

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: codeBuildId,
              buildStatus: 'SUCCEEDED',
              currentPhase: 'COMPLETED'
            }]
          });
        }

        if (target === 'CodeBuild_20161006.StartBuild') {
          deployDispatchedPayload = JSON.parse(await req.text());
          return Response.json({
            build: {
              id: 'nsw-deploy:next-deploy-uuid-2222',
              buildStatus: 'IN_PROGRESS'
            }
          });
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: {
          DB: ctx.d1,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('building');
      expect(data.originKind).toBe('worker');
      expect(ecrCalled).toBe(false); // ECR MUST NEVER BE CALLED

      // Verify deploy startCodeBuild payload
      expect(deployDispatchedPayload).toBeDefined();
      expect(deployDispatchedPayload.projectName).toBe('nsw-deploy');
      expect(deployDispatchedPayload.buildspecOverride).toBe(NSW_DEPLOY_NEXT_BUILDSPEC);

      const envMap = Object.fromEntries(deployDispatchedPayload.environmentVariablesOverride.map((e: any) => [e.name, e.value]));
      expect(envMap.APP_ID).toBe(appId);
      expect(envMap.COMMIT_OID).toBe(commitOid);
      expect(envMap.CF_ACCOUNT_ID).toBe('4219a576830c72b0e6e4ca358e61473a');
      expect(envMap.ARTIFACT_BUCKET).toBe('nsw-build-artifacts-777772815966');

      // Verify D1 build_runs updates
      const buildRun = await ctx.d1.prepare(`SELECT status, result_digest FROM build_runs WHERE id = 'br_next_build_1'`).first<any>();
      expect(buildRun.status).toBe('passed');
      expect(buildRun.result_digest).toBe(`s3://nsw-build-artifacts-777772815966/${appId}/${commitOid}/opennext.tar`);

      const deployRun = await ctx.d1.prepare(`SELECT build_command, status, runner_image_digest FROM build_runs WHERE build_command = 'nsw-deploy-next'`).first<any>();
      expect(deployRun).toBeDefined();
      expect(deployRun.status).toBe('running');
      expect(deployRun.runner_image_digest).toBe('nsw-deploy:next-deploy-uuid-2222');
    });
  });

  // ==========================================================================
  // 6. Lazy-finalize Stage 2: Next Lane deploy SUCCEEDED (Active Promotion)
  // ==========================================================================
  describe('6. Lazy-finalize Stage 2 (nsw-deploy-next SUCCEEDED -> promote active with origin_kind=worker)', () => {
    const appId = 'promote-next-app';
    const deployCodeBuildId = 'nsw-deploy:next-deploy-uuid-3333';
    const commitOid = 'e01234567890abcdef1234567890abcdef123456';
    const workerUrl = `https://nsw-app-${appId}.nate-mcguire.workers.dev`;

    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_prom_next', 'promnext', 'Prom Next', 'user')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO app_listings (
          id, name, tagline, description, creator_id, version, license, price, storage,
          tags, screenshots, binaries, deployment_state, origin_kind, detected_project_type
        ) VALUES (
          ?, 'Promote Next App', 'Tag', 'Desc', 'usr_prom_next', '1.0.0', 'MIT', '$0', 'None',
          '[]', '[]', '{}', 'building', 'worker', 'next-worker'
        )
      `).bind(appId).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_prom_next_1', ?, 'usr_prom_next', ?, 'public', 'sha1', 'refs/heads/main', 'repositories/prom-next', 'active')
      `).bind(appId, appId).run();

      await ctx.d1.prepare(`
        INSERT INTO build_runs (
          id, repository_id, commit_oid, purpose, status, runner_image_digest,
          build_command, test_command, source_manifest_digest, started_at
        ) VALUES (
          'br_prom_deploy_1', 'repo_prom_next_1', ?, 'release', 'running', ?,
          'nsw-deploy-next', 'worker', 's3://artifacts/opennext.tar', CURRENT_TIMESTAMP
        )
      `).bind(commitOid, deployCodeBuildId).run();
    });

    it('promotes app to active with origin_kind=worker and creates healthy deployment_revisions row', async () => {
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: deployCodeBuildId,
              buildStatus: 'SUCCEEDED',
              currentPhase: 'COMPLETED',
              exportedEnvironmentVariables: [
                { name: 'DEPLOYED_WORKER_URL', value: workerUrl }
              ]
            }]
          });
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: {
          DB: ctx.d1,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('active');
      expect(data.originKind).toBe('worker');
      expect(data.originRef).toBe(workerUrl);
      expect(data.isVerifiedActive).toBe(true);

      // Verify D1 app_listings
      const listing = await ctx.d1.prepare(`
        SELECT deployment_state, origin_kind, origin_ref, active_deployment_id, active_commit_oid
        FROM app_listings WHERE id = ?
      `).bind(appId).first<any>();

      expect(listing.deployment_state).toBe('active');
      expect(listing.origin_kind).toBe('worker');
      expect(listing.origin_ref).toBe(workerUrl);
      expect(listing.active_commit_oid).toBe(commitOid);
      expect(listing.active_deployment_id).toBeDefined();

      // Verify deployment_revisions row
      const rev = await ctx.d1.prepare(`
        SELECT * FROM deployment_revisions WHERE app_id = ? AND id = ?
      `).bind(appId, listing.active_deployment_id).first<any>();

      expect(rev).toBeDefined();
      expect(rev.status).toBe('healthy');
      expect(rev.url).toBe(workerUrl);
      expect(rev.runtime_config_digest).toBe('worker');
    });

    it('fails closed when deploy SUCCEEDED but has no worker URL', async () => {
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: deployCodeBuildId,
              buildStatus: 'SUCCEEDED',
              currentPhase: 'COMPLETED',
              exportedEnvironmentVariables: []
            }]
          });
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: {
          DB: ctx.d1,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.deploymentState).toBe('failed');
      expect(data.lastDeployError).toContain('no DEPLOYED_WORKER_URL was found');

      const listing = await ctx.d1.prepare(`
        SELECT deployment_state, deployment_error FROM app_listings WHERE id = ?
      `).bind(appId).first<any>();

      expect(listing.deployment_state).toBe('failed');
      expect(listing.deployment_error).toContain('no DEPLOYED_WORKER_URL was found');
    });
  });
});
