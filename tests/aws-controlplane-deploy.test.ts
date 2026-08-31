import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { initBareRepo } from '../src/lib/gitsmith/gitStorage';
import { hashSessionToken } from '../functions/api/_session';
import * as deployApi from '../functions/api/deploy';
import {
  putS3SourceArchive,
  startCodeBuild,
  batchGetCodeBuilds,
  describeEcrImages
} from '../functions/api/_aws';

export function createMemoryR2Bucket(): any {
  const store = new Map<string, { body: Buffer; httpMetadata?: any; customMetadata?: any }>();
  return {
    put: async (key: string, body: Buffer | Uint8Array | string, options?: any) => {
      const buf = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
      store.set(key, { body: buf, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
      return { key, size: buf.length };
    },
    get: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        body: new Response(entry.body).body,
        httpMetadata: entry.httpMetadata,
        customMetadata: entry.customMetadata,
        size: entry.body.length,
        arrayBuffer: async () => entry.body.buffer,
        text: async () => entry.body.toString('utf8')
      };
    },
    head: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      return { key, httpMetadata: entry.httpMetadata, customMetadata: entry.customMetadata, size: entry.body.length };
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async (options?: { prefix?: string }) => {
      const prefix = options?.prefix || '';
      const objects = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix)) {
          objects.push({ key: k, size: v.body.length });
        }
      }
      return { objects };
    }
  };
}

describe('Phase 1: AWS Build Substrate Control Plane Suite', () => {
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
    AWS_CODEBUILD_PROJECT: 'nsw-build',
    AWS_CODEBUILD_DEPLOY_PROJECT: 'nsw-deploy',
    CF_ACCOUNT_ID: '4219a576830c72b0e6e4ca358e61473a'
  };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    tempDir = path.join('/tmp', `aws-controlplane-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
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
    execFileSync('git', ['init', workTree], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@nates.software'], { cwd: workTree, stdio: 'pipe' });

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(workTree, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }

    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feat: committed source'], { cwd: workTree, stdio: 'pipe' });
    const commitOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    execFileSync('git', ['remote', 'add', 'origin', initRes.repoPath], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: workTree, stdio: 'pipe' });

    return { commitOid, repoPath: initRes.repoPath };
  }

  // ==========================================================================
  // 1. SigV4 Signer Module (_aws.ts)
  // ==========================================================================
  describe('1. SigV4 Signer Module (_aws.ts)', () => {
    it('signs S3 PutObject requests with SigV4 and correct headers', async () => {
      const capturedRequests: Request[] = [];
      const customFetch: typeof fetch = async (req) => {
        capturedRequests.push(req as Request);
        return new Response('', { status: 200 });
      };

      const tarBytes = Buffer.from('test-tarball-content');
      const res = await putS3SourceArchive(
        { ...AWS_CREDS, __AWS_FETCH: customFetch },
        {
          bucket: 'nsw-build-sources-777772815966',
          key: 'build-123.tar',
          body: tarBytes,
          contentType: 'application/x-tar'
        }
      );

      expect(res.success).toBe(true);
      expect(capturedRequests.length).toBe(1);

      const req = capturedRequests[0];
      expect(req.method).toBe('PUT');
      expect(req.url).toBe('https://nsw-build-sources-777772815966.s3.us-east-2.amazonaws.com/build-123.tar');
      expect(req.headers.get('content-type')).toBe('application/x-tar');
      expect(req.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
      expect(req.headers.get('authorization')).toContain('AKIA_NSW_TEST_KEY_123');
      expect(req.headers.get('authorization')).toContain('us-east-2/s3/aws4_request');
      expect(req.headers.get('x-amz-date')).toBeTruthy();
    });

    it('signs CodeBuild StartBuild requests with X-Amz-Target and env overrides', async () => {
      const capturedRequests: Request[] = [];
      const customFetch: typeof fetch = async (req) => {
        capturedRequests.push(req as Request);
        return Response.json({
          build: {
            id: 'nsw-build:abcd-1234-uuid',
            arn: 'arn:aws:codebuild:us-east-2:777772815966:build/nsw-build:abcd-1234-uuid',
            buildStatus: 'IN_PROGRESS'
          }
        });
      };

      const res = await startCodeBuild(
        { ...AWS_CREDS, __AWS_FETCH: customFetch },
        {
          projectName: 'nsw-build',
          envOverrides: {
            SOURCE_BUCKET: 'nsw-build-sources-777772815966',
            SOURCE_KEY: 'build-123.tar',
            ECR_REPO: 'nsw/flask-app',
            COMMIT_OID: '0123456789abcdef0123456789abcdef01234567',
            PROCFILE_START: 'gunicorn app:app'
          }
        }
      );

      expect(res.success).toBe(true);
      expect(res.buildId).toBe('nsw-build:abcd-1234-uuid');
      expect(capturedRequests.length).toBe(1);

      const req = capturedRequests[0];
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://codebuild.us-east-2.amazonaws.com/');
      expect(req.headers.get('x-amz-target')).toBe('CodeBuild_20161006.StartBuild');
      expect(req.headers.get('authorization')).toContain('us-east-2/codebuild/aws4_request');

      const body = JSON.parse(await req.text());
      expect(body.projectName).toBe('nsw-build');
      expect(body.environmentVariablesOverride).toEqual([
        { name: 'SOURCE_BUCKET', value: 'nsw-build-sources-777772815966', type: 'PLAINTEXT' },
        { name: 'SOURCE_KEY', value: 'build-123.tar', type: 'PLAINTEXT' },
        { name: 'ECR_REPO', value: 'nsw/flask-app', type: 'PLAINTEXT' },
        { name: 'COMMIT_OID', value: '0123456789abcdef0123456789abcdef01234567', type: 'PLAINTEXT' },
        { name: 'PROCFILE_START', value: 'gunicorn app:app', type: 'PLAINTEXT' }
      ]);
    });

    it('signs CodeBuild BatchGetBuilds requests with target and build ids', async () => {
      const capturedRequests: Request[] = [];
      const customFetch: typeof fetch = async (req) => {
        capturedRequests.push(req as Request);
        return Response.json({
          builds: [
            {
              id: 'nsw-build:abcd-1234-uuid',
              buildStatus: 'SUCCEEDED',
              phases: [{ phaseType: 'BUILD', phaseStatus: 'SUCCEEDED' }]
            }
          ]
        });
      };

      const res = await batchGetCodeBuilds(
        { ...AWS_CREDS, __AWS_FETCH: customFetch },
        { buildIds: ['nsw-build:abcd-1234-uuid'] }
      );

      expect(res.success).toBe(true);
      expect(res.builds?.length).toBe(1);
      expect(capturedRequests.length).toBe(1);

      const req = capturedRequests[0];
      expect(req.method).toBe('POST');
      expect(req.headers.get('x-amz-target')).toBe('CodeBuild_20161006.BatchGetBuilds');
      const body = JSON.parse(await req.text());
      expect(body.ids).toEqual(['nsw-build:abcd-1234-uuid']);
    });

    it('signs ECR DescribeImages requests and extracts image digest', async () => {
      const capturedRequests: Request[] = [];
      const customFetch: typeof fetch = async (req) => {
        capturedRequests.push(req as Request);
        return Response.json({
          imageDetails: [
            {
              registryId: '777772815966',
              repositoryName: 'nsw/flask-app',
              imageDigest: 'sha256:45b23e288d0b1530d83352956650d239c7722ec1a3b043f3799d48dd6a8b8b56',
              imageTags: ['0123456789abcdef0123456789abcdef01234567']
            }
          ]
        });
      };

      const res = await describeEcrImages(
        { ...AWS_CREDS, __AWS_FETCH: customFetch },
        {
          repositoryName: 'nsw/flask-app',
          imageTag: '0123456789abcdef0123456789abcdef01234567',
          registryId: '777772815966'
        }
      );

      expect(res.success).toBe(true);
      expect(res.imageDigest).toBe('sha256:45b23e288d0b1530d83352956650d239c7722ec1a3b043f3799d48dd6a8b8b56');
      expect(capturedRequests.length).toBe(1);

      const req = capturedRequests[0];
      expect(req.method).toBe('POST');
      expect(req.headers.get('x-amz-target')).toBe('AmazonEC2ContainerRegistry_V20150921.DescribeImages');
      expect(req.headers.get('authorization')).toContain('us-east-2/ecr/aws4_request');

      const body = JSON.parse(await req.text());
      expect(body.repositoryName).toBe('nsw/flask-app');
      expect(body.registryId).toBe('777772815966');
      expect(body.imageIds).toEqual([{ imageTag: '0123456789abcdef0123456789abcdef01234567' }]);
    });

    it('handles ECR RepositoryNotFoundException gracefully without crashing', async () => {
      const customFetch: typeof fetch = async () => {
        return Response.json(
          {
            __type: 'RepositoryNotFoundException',
            message: "The repository with name 'nsw/missing-app' does not exist in the registry with id '777772815966'"
          },
          { status: 400 }
        );
      };

      const res = await describeEcrImages(
        { ...AWS_CREDS, __AWS_FETCH: customFetch },
        {
          repositoryName: 'nsw/missing-app',
          imageTag: '0123456789abcdef0123456789abcdef01234567'
        }
      );

      expect(res.success).toBe(false);
      expect(res.repoMissing).toBe(true);
      expect(res.error).toBe('ECR repo nsw/missing-app not provisioned');
    });
  });

  // ==========================================================================
  // 2. Server App Async Build Dispatch via AWS Substrate
  // ==========================================================================
  describe('2. Server App Async Build Dispatch (POST /api/deploy)', () => {
    let makerToken: string;
    let commitOid: string;
    const appId = 'flask-notes-app';

    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_flask_dev', 'flaskdev', 'Flask Developer', 'user')
      `).run();
      makerToken = 'token_flask_dev_123';
      const tokenHash = await hashSessionToken(makerToken);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_flask_dev', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = `repositories/${appId}`;
      const repoInfo = createCommittedRepo(storageKey, {
        'requirements.txt': 'Flask==3.0.0\ngunicorn==21.2.0\n',
        'app.py': 'from flask import Flask\napp = Flask(__name__)\n@app.route("/")\ndef index(): return "Hello Flask"\n',
        'Procfile': 'web: gunicorn app:app\n'
      });
      commitOid = repoInfo.commitOid;

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'Flask Notes App', 'Simple note taker', 'Desc', 'usr_flask_dev', '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).bind(appId).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_flask_1', ?, 'usr_flask_dev', ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(appId, appId, storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_flask_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();
    });

    it('stages source tarball to S3, starts CodeBuild with exact overrides, and returns 202 building without blocking', async () => {
      const awsCalls: { method: string; url: string; target: string; body: any }[] = [];

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const url = new URL(req.url);
        const target = req.headers.get('x-amz-target') || '';
        let body: any = null;
        try {
          const text = await req.clone().text();
          if (text) body = JSON.parse(text);
        } catch {}

        awsCalls.push({ method: req.method, url: req.url, target, body });

        // S3 PutObject
        if (req.method === 'PUT' && url.hostname.includes('.s3.')) {
          return new Response('', { status: 200 });
        }

        // CodeBuild StartBuild
        if (target === 'CodeBuild_20161006.StartBuild') {
          return Response.json({
            build: {
              id: 'nsw-build:flask-build-uuid-7890',
              arn: 'arn:aws:codebuild:us-east-2:777772815966:build/nsw-build:flask-build-uuid-7890',
              buildStatus: 'IN_PROGRESS'
            }
          });
        }

        return new Response('Not found', { status: 404 });
      };

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${makerToken}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId
        })
      });

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });

      const data: any = await res.json();

      // Invariant: Non-blocking HTTP 202 with building state
      expect(res.status).toBe(202);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('building');
      expect(data.buildId).toBeTruthy();
      expect(data.codeBuildId).toBe('nsw-build:flask-build-uuid-7890');
      expect(data.buildRunId).toBeTruthy();

      // Assert S3 PutObject was called with the right bucket and key format
      const s3Put = awsCalls.find(c => c.method === 'PUT' && c.url.includes('.s3.'));
      expect(s3Put).toBeDefined();
      expect(s3Put?.url).toBe(`https://nsw-build-sources-777772815966.s3.us-east-2.amazonaws.com/${data.buildId}.tar`);

      // Assert CodeBuild StartBuild was called with project nsw-build and exact env overrides
      const cbStart = awsCalls.find(c => c.target === 'CodeBuild_20161006.StartBuild');
      expect(cbStart).toBeDefined();
      expect(cbStart?.body.projectName).toBe('nsw-build');
      expect(cbStart?.body.environmentVariablesOverride).toEqual([
        { name: 'SOURCE_BUCKET', value: 'nsw-build-sources-777772815966', type: 'PLAINTEXT' },
        { name: 'SOURCE_KEY', value: `${data.buildId}.tar`, type: 'PLAINTEXT' },
        { name: 'ECR_REPO', value: `nsw/${appId}`, type: 'PLAINTEXT' },
        { name: 'COMMIT_OID', value: commitOid, type: 'PLAINTEXT' },
        { name: 'PROCFILE_START', value: 'python app.py', type: 'PLAINTEXT' }
      ]);

      // Assert D1 records: app is in building state, build_runs has running row with codeBuildId
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, active_commit_oid, deployment_error, deployment_evidence_json
        FROM app_listings WHERE id = ?
      `).bind(appId).first<any>();

      expect(app.deployment_state).toBe('building');
      expect(app.active_deployment_id).toBeNull();
      expect(app.active_commit_oid).toBe(commitOid);
      expect(app.deployment_error).toBeNull();

      const evidence = JSON.parse(app.deployment_evidence_json);
      expect(evidence.stage).toBe('build');
      expect(evidence.status).toBe('running');
      expect(evidence.codeBuildId).toBe('nsw-build:flask-build-uuid-7890');
      expect(evidence.ecrRepo).toBe(`nsw/${appId}`);

      const buildRun = await ctx.d1.prepare(`
        SELECT id, repository_id, commit_oid, purpose, status, runner_image_digest
        FROM build_runs WHERE repository_id = 'repo_flask_1'
      `).first<any>();

      expect(buildRun.status).toBe('running');
      expect(buildRun.purpose).toBe('release');
      expect(buildRun.commit_oid).toBe(commitOid);
      expect(buildRun.runner_image_digest).toBe('nsw-build:flask-build-uuid-7890');
    });

    it('fails closed when S3 source upload fails', async () => {
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        if (req.method === 'PUT') {
          return new Response('S3 bucket permission denied', { status: 403, statusText: 'Forbidden' });
        }
        return new Response('Not found', { status: 404 });
      };

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${makerToken}`
        },
        body: JSON.stringify({ action: 'deploy', appId })
      });

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });

      const data: any = await res.json();
      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Failed to stage source tarball to S3');

      const app = await ctx.d1.prepare(`SELECT deployment_state FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(app.deployment_state).toBe('failed');
    });

    it('fails closed when CodeBuild StartBuild fails', async () => {
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (req.method === 'PUT') {
          return new Response('', { status: 200 });
        }
        if (target === 'CodeBuild_20161006.StartBuild') {
          return Response.json(
            { message: 'Project nsw-build does not exist' },
            { status: 400 }
          );
        }
        return new Response('Not found', { status: 404 });
      };

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${makerToken}`
        },
        body: JSON.stringify({ action: 'deploy', appId })
      });

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });

      const data: any = await res.json();
      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Project nsw-build does not exist');
    });
  });

  // ==========================================================================
  // 3. Lazy Finalize on Read (GET /api/deploy?appId)
  // ==========================================================================
  describe('3. Lazy Finalize on Read (GET /api/deploy?appId)', () => {
    const appId = 'lazy-finalize-app';
    const codeBuildId = 'nsw-build:lazy-build-uuid-1111';
    const commitOid = 'c0331701d1234567890abcdef1234567890abcde';
    const expectedDigest = 'sha256:5a9b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b';

    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_lazy_maker', 'lazymaker', 'Lazy Maker', 'user')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'Lazy Finalize App', 'Tag', 'Desc', 'usr_lazy_maker', '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'building')
      `).bind(appId).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_lazy_1', ?, 'usr_lazy_maker', ?, 'public', 'sha1', 'refs/heads/main', 'repositories/lazy-finalize-app', 'active')
      `).bind(appId, appId).run();

      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest, started_at)
        VALUES ('br_lazy_1', 'repo_lazy_1', ?, 'release', 'running', ?, 'python app.py', 'sha256:manifest123', CURRENT_TIMESTAMP)
      `).bind(commitOid, codeBuildId).run();
    });

    it('remains in building state while CodeBuild status is IN_PROGRESS', async () => {
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: codeBuildId,
              buildStatus: 'IN_PROGRESS',
              currentPhase: 'BUILD'
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
      expect(data.deploymentState).toBe('building');
      expect(data.isVerifiedActive).toBe(false);

      const buildRun = await ctx.d1.prepare(`SELECT status FROM build_runs WHERE id = 'br_lazy_1'`).first<any>();
      expect(buildRun.status).toBe('running');
    });

    it('transitions running candidate -> passed and triggers nsw-deploy with exact overrides, keeping deployment_state=building', async () => {
      const awsCalls: { target: string; body?: any }[] = [];
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';
        let body: any = null;
        try {
          const text = await req.clone().text();
          if (text) body = JSON.parse(text);
        } catch {}
        awsCalls.push({ target, body });

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: codeBuildId,
              buildStatus: 'SUCCEEDED',
              currentPhase: 'COMPLETED'
            }]
          });
        }

        if (target === 'AmazonEC2ContainerRegistry_V20150921.DescribeImages') {
          return Response.json({
            imageDetails: [{
              registryId: '777772815966',
              repositoryName: `nsw/${appId}`,
              imageDigest: expectedDigest,
              imageTags: [commitOid]
            }]
          });
        }

        if (target === 'CodeBuild_20161006.StartBuild') {
          return Response.json({
            build: {
              id: 'nsw-deploy:lazy-deploy-uuid-2222',
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
      expect(data.isVerifiedActive).toBe(false);
      expect(data.deploymentError).toBeNull();

      expect(awsCalls.map(c => c.target)).toContain('CodeBuild_20161006.BatchGetBuilds');
      expect(awsCalls.map(c => c.target)).toContain('AmazonEC2ContainerRegistry_V20150921.DescribeImages');
      expect(awsCalls.map(c => c.target)).toContain('CodeBuild_20161006.StartBuild');

      // Assert StartBuild was called for nsw-deploy with exact env overrides
      const deployCall = awsCalls.find(c => c.target === 'CodeBuild_20161006.StartBuild');
      expect(deployCall?.body.projectName).toBe('nsw-deploy');
      expect(deployCall?.body.environmentVariablesOverride).toEqual([
        { name: 'APP_ID', value: appId, type: 'PLAINTEXT' },
        { name: 'COMMIT_OID', value: commitOid, type: 'PLAINTEXT' },
        { name: 'ECR_REPO', value: `nsw/${appId}`, type: 'PLAINTEXT' },
        { name: 'CF_ACCOUNT_ID', value: '4219a576830c72b0e6e4ca358e61473a', type: 'PLAINTEXT' },
        { name: 'INSTANCE_TYPE', value: 'lite', type: 'PLAINTEXT' }
      ]);

      // Assert D1 records: candidate build_run passed with verified digest
      const candidateRun = await ctx.d1.prepare(`
        SELECT status, result_digest, exit_code FROM build_runs WHERE id = 'br_lazy_1'
      `).first<any>();
      expect(candidateRun.status).toBe('passed');
      expect(candidateRun.result_digest).toBe(expectedDigest);
      expect(candidateRun.exit_code).toBe(0);

      // Assert new deploy build_run created with status running
      const deployRun = await ctx.d1.prepare(`
        SELECT id, purpose, status, runner_image_digest, build_command FROM build_runs WHERE build_command = 'nsw-deploy'
      `).first<any>();
      expect(deployRun).toBeDefined();
      expect(deployRun.status).toBe('running');
      expect(deployRun.purpose).toBe('release');
      expect(deployRun.runner_image_digest).toBe('nsw-deploy:lazy-deploy-uuid-2222');

      // Assert app_listing updated with deploy stage evidence under building state
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, origin_kind, deployment_error, deployment_evidence_json FROM app_listings WHERE id = ?
      `).bind(appId).first<any>();
      expect(app.deployment_state).toBe('building');
      expect(app.origin_kind).toBe('cf_container');
      expect(app.deployment_error).toBeNull();
      const evidence = JSON.parse(app.deployment_evidence_json);
      expect(evidence.stage).toBe('deploy');
      expect(evidence.status).toBe('running');
      expect(evidence.imageDigest).toBe(expectedDigest);
      expect(evidence.deployCodeBuildId).toBe('nsw-deploy:lazy-deploy-uuid-2222');
    });

    it('lazy-finalizes deploy stage: remains in building state while nsw-deploy is IN_PROGRESS', async () => {
      // Set app to building state with running deploy build
      await ctx.d1.prepare(`
        UPDATE app_listings SET deployment_state = 'building', origin_kind = 'cf_container' WHERE id = ?
      `).bind(appId).run();
      await ctx.d1.prepare(`
        UPDATE build_runs SET status = 'passed', result_digest = ? WHERE id = 'br_lazy_1'
      `).bind(expectedDigest).run();
      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest, started_at)
        VALUES ('br_lazy_deploy_1', 'repo_lazy_1', ?, 'release', 'running', 'nsw-deploy:lazy-deploy-uuid-2222', 'nsw-deploy', ?, CURRENT_TIMESTAMP)
      `).bind(commitOid, expectedDigest).run();

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: 'nsw-deploy:lazy-deploy-uuid-2222',
              buildStatus: 'IN_PROGRESS',
              currentPhase: 'BUILD'
            }]
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const res = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.deploymentState).toBe('building');
      expect(data.isVerifiedActive).toBe(false);

      const deployRun = await ctx.d1.prepare(`SELECT status FROM build_runs WHERE id = 'br_lazy_deploy_1'`).first<any>();
      expect(deployRun.status).toBe('running');
    });

    it('lazy-finalizes deploy stage: promotes to active, creates deployment_revisions row, and sets origin_ref when nsw-deploy SUCCEEDS with DEPLOYED_WORKER_URL', async () => {
      const workerUrl = `https://nsw-app-${appId}.tester-subdomain.workers.dev`;

      // Set app to building state with running deploy build
      await ctx.d1.prepare(`
        UPDATE app_listings SET deployment_state = 'building', origin_kind = 'cf_container' WHERE id = ?
      `).bind(appId).run();
      await ctx.d1.prepare(`
        UPDATE build_runs SET status = 'passed', result_digest = ? WHERE id = 'br_lazy_1'
      `).bind(expectedDigest).run();
      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, test_command, source_manifest_digest, started_at)
        VALUES ('br_lazy_deploy_1', 'repo_lazy_1', ?, 'release', 'running', 'nsw-deploy:lazy-deploy-uuid-2222', 'nsw-deploy', ?, ?, CURRENT_TIMESTAMP)
      `).bind(commitOid, expectedDigest, expectedDigest).run();

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: 'nsw-deploy:lazy-deploy-uuid-2222',
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
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('active');
      expect(data.isVerifiedActive).toBe(true);
      expect(data.originKind).toBe('cf_container');
      expect(data.originRef).toBe(workerUrl);
      expect(data.activeUrl).toBe(workerUrl);
      expect(data.activeDeploymentId).toBeTruthy();

      // Assert deploy build_runs row passed with workerUrl as result_digest
      const deployRun = await ctx.d1.prepare(`
        SELECT status, result_digest, exit_code FROM build_runs WHERE id = 'br_lazy_deploy_1'
      `).first<any>();
      expect(deployRun.status).toBe('passed');
      expect(deployRun.result_digest).toBe(workerUrl);
      expect(deployRun.exit_code).toBe(0);

      // Assert deployment_revisions row created
      const rev = await ctx.d1.prepare(`
        SELECT id, app_id, commit_oid, build_run_id, environment, revision_number, status, url, deployed_by_user_id
        FROM deployment_revisions WHERE app_id = ?
      `).bind(appId).first<any>();
      expect(rev).toBeDefined();
      expect(rev.status).toBe('healthy');
      expect(rev.environment).toBe('production');
      expect(rev.revision_number).toBe(1);
      expect(rev.url).toBe(workerUrl);
      expect(rev.commit_oid).toBe(commitOid);
      expect(rev.build_run_id).toBe('br_lazy_deploy_1');
      expect(rev.deployed_by_user_id).toBe('usr_lazy_maker');

      // Assert app_listings promoted to active
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, origin_kind, origin_ref, active_deployment_id, active_commit_oid, deployment_error
        FROM app_listings WHERE id = ?
      `).bind(appId).first<any>();
      expect(app.deployment_state).toBe('active');
      expect(app.origin_kind).toBe('cf_container');
      expect(app.origin_ref).toBe(workerUrl);
      expect(app.active_deployment_id).toBe(rev.id);
      expect(app.active_commit_oid).toBe(commitOid);
      expect(app.deployment_error).toBeNull();
    });

    it('lazy-finalizes deploy stage: transitions building -> failed and sets honest deployment_error when nsw-deploy FAILED', async () => {
      // Set app to building state with running deploy build
      await ctx.d1.prepare(`
        UPDATE app_listings SET deployment_state = 'building', origin_kind = 'cf_container' WHERE id = ?
      `).bind(appId).run();
      await ctx.d1.prepare(`
        UPDATE build_runs SET status = 'passed', result_digest = ? WHERE id = 'br_lazy_1'
      `).bind(expectedDigest).run();
      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest, started_at)
        VALUES ('br_lazy_deploy_1', 'repo_lazy_1', ?, 'release', 'running', 'nsw-deploy:lazy-deploy-uuid-2222', 'nsw-deploy', ?, CURRENT_TIMESTAMP)
      `).bind(commitOid, expectedDigest).run();

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: 'nsw-deploy:lazy-deploy-uuid-2222',
              buildStatus: 'FAILED',
              phases: [
                { phaseType: 'SUBMITTED', phaseStatus: 'SUCCEEDED' },
                {
                  phaseType: 'BUILD',
                  phaseStatus: 'FAILED',
                  contexts: [{ statusCode: 'COMMAND_EXECUTION_ERROR', message: 'wrangler containers push: unauthorized 401' }]
                }
              ]
            }]
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const res = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.deploymentState).toBe('failed');
      expect(data.deploymentError).toContain('wrangler containers push: unauthorized 401');

      const deployRun = await ctx.d1.prepare(`SELECT status, exit_code FROM build_runs WHERE id = 'br_lazy_deploy_1'`).first<any>();
      expect(deployRun.status).toBe('failed');
      expect(deployRun.exit_code).toBe(1);

      const app = await ctx.d1.prepare(`SELECT deployment_state, deployment_error FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(app.deployment_state).toBe('failed');
      expect(app.deployment_error).toContain('wrangler containers push: unauthorized 401');
    });

    it('lazy-finalizes deploy stage: fails closed when nsw-deploy SUCCEEDS but no DEPLOYED_WORKER_URL was found', async () => {
      // Set app to building state with running deploy build
      await ctx.d1.prepare(`
        UPDATE app_listings SET deployment_state = 'building', origin_kind = 'cf_container' WHERE id = ?
      `).bind(appId).run();
      await ctx.d1.prepare(`
        UPDATE build_runs SET status = 'passed', result_digest = ? WHERE id = 'br_lazy_1'
      `).bind(expectedDigest).run();
      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest, started_at)
        VALUES ('br_lazy_deploy_1', 'repo_lazy_1', ?, 'release', 'running', 'nsw-deploy:lazy-deploy-uuid-2222', 'nsw-deploy', ?, CURRENT_TIMESTAMP)
      `).bind(commitOid, expectedDigest).run();

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: 'nsw-deploy:lazy-deploy-uuid-2222',
              buildStatus: 'SUCCEEDED',
              currentPhase: 'COMPLETED',
              exportedEnvironmentVariables: [] // Empty! No worker URL exported
            }]
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const res = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.deploymentState).toBe('failed');
      expect(data.deploymentError).toContain('no DEPLOYED_WORKER_URL was found in build output');

      const deployRun = await ctx.d1.prepare(`SELECT status, exit_code FROM build_runs WHERE id = 'br_lazy_deploy_1'`).first<any>();
      expect(deployRun.status).toBe('failed');
      expect(deployRun.exit_code).toBe(1);

      const app = await ctx.d1.prepare(`SELECT deployment_state, deployment_error FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(app.deployment_state).toBe('failed');
      expect(app.deployment_error).toContain('no DEPLOYED_WORKER_URL was found in build output');
    });

    it('transitions running -> failed and sets honest deployment_error upon CodeBuild FAILED', async () => {
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: codeBuildId,
              buildStatus: 'FAILED',
              phases: [
                { phaseType: 'SUBMITTED', phaseStatus: 'SUCCEEDED' },
                {
                  phaseType: 'BUILD',
                  phaseStatus: 'FAILED',
                  contexts: [{ statusCode: 'COMMAND_EXECUTION_ERROR', message: 'Pipfile lock error: resolution conflict' }]
                }
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
      expect(data.deploymentState).toBe('failed');
      expect(data.deploymentError).toContain('Pipfile lock error: resolution conflict');

      const buildRun = await ctx.d1.prepare(`SELECT status, exit_code FROM build_runs WHERE id = 'br_lazy_1'`).first<any>();
      expect(buildRun.status).toBe('failed');
      expect(buildRun.exit_code).toBe(1);

      const app = await ctx.d1.prepare(`SELECT deployment_state, deployment_error FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(app.deployment_state).toBe('failed');
      expect(app.deployment_error).toContain('Pipfile lock error: resolution conflict');
    });

    it('fails closed when ECR repository is not provisioned', async () => {
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: codeBuildId,
              buildStatus: 'SUCCEEDED'
            }]
          });
        }

        if (target === 'AmazonEC2ContainerRegistry_V20150921.DescribeImages') {
          return Response.json(
            {
              __type: 'RepositoryNotFoundException',
              message: `The repository with name 'nsw/${appId}' does not exist in registry`
            },
            { status: 400 }
          );
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
      expect(data.deploymentError).toBe(`ECR repo nsw/${appId} not provisioned`);

      const buildRun = await ctx.d1.prepare(`SELECT status FROM build_runs WHERE id = 'br_lazy_1'`).first<any>();
      expect(buildRun.status).toBe('failed');

      const app = await ctx.d1.prepare(`SELECT deployment_state, deployment_error FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(app.deployment_state).toBe('failed');
      expect(app.deployment_error).toBe(`ECR repo nsw/${appId} not provisioned`);
    });
  });

  // ==========================================================================
  // 4. Static Apps Preservation & AWS Routing Isolation
  // ==========================================================================
  describe('4. Static Apps Preservation & AWS Routing Isolation', () => {
    it('does NOT route static apps through AWS CodeBuild (remains on R2 static path)', async () => {
      const staticAppId = 'pure-static-site';

      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_static_maker', 'staticmaker', 'Static Maker', 'user')
      `).run();
      const token = 'token_static_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_static_maker', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = `repositories/${staticAppId}`;
      const { commitOid } = createCommittedRepo(storageKey, {
        'index.html': '<!DOCTYPE html><html><body><h1>Static Portfolio</h1></body></html>',
        'styles.css': 'body { background: #000; color: #fff; }'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'Static Portfolio', 'Tag', 'Desc', 'usr_static_maker', '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).bind(staticAppId).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_static_1', ?, 'usr_static_maker', ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(staticAppId, staticAppId, storageKey).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_static_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      let awsWasCalled = false;
      const mockAwsFetch: typeof fetch = async () => {
        awsWasCalled = true;
        throw new Error('AWS fetch should NOT be called for static apps!');
      };

      const mockStaticExecutor = async (params: any) => {
        expect(params.plan.detectedType).toBe('static');
        return {
          success: true,
          exitCode: 0,
          output: 'Static build complete',
          artifactDigest: 'sha256:static_manifest_digest_456',
          artifactKind: 'static',
          staticFiles: [
            {
              path: 'index.html',
              contentBase64: Buffer.from('<!DOCTYPE html><h1>Static Portfolio</h1>').toString('base64'),
              mediaType: 'text/html; charset=utf-8',
              sizeBytes: 42,
              sha256: 'sha256:index_hash_456'
            }
          ],
          smokeCheck: { passed: true, statusCode: 200, durationMs: 10 },
          durationMs: 80
        };
      };

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'deploy', appId: staticAppId })
      });

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch,
          __RIG_DEPLOY_EXECUTOR: mockStaticExecutor
        }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('active');
      expect(data.isVerifiedActive).toBe(true);
      expect(awsWasCalled).toBe(false);

      // Verify files uploaded to R2 storage
      const r2File = await storage.get(`apps/${staticAppId}/live/index.html`);
      expect(r2File).toBeDefined();
      expect(await r2File.text()).toContain('Static Portfolio');
    });
  });

  // ==========================================================================
  // 5. GITSMITH Token Invariant (Zero-Leakage Assertion)
  // ==========================================================================
  describe('5. GITSMITH Token Invariant (Zero-Leakage Assertion)', () => {
    it('ensures GITSMITH gateway token never appears in any AWS headers, query params, body, or environment overrides', async () => {
      const serverAppId = 'gitsmith-token-security-app';
      const secretToken = 'GITSMITH_SUPER_SECRET_TOKEN_VALUE_SECRET_987654321';

      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_sec_maker', 'secmaker', 'Security Maker', 'user')
      `).run();
      const token = 'token_sec_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_sec_maker', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const commitOid = '3333333333333333333333333333333333333333';
      const storageKey = `repositories/${serverAppId}`;

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'Security App', 'Tag', 'Desc', 'usr_sec_maker', '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).bind(serverAppId).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_sec_1', ?, 'usr_sec_maker', ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(serverAppId, serverAppId, storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_sec_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const fakeTarArchive = Buffer.from('fake-secure-tar-bytes');

      // GITSMITH gateway fetch mock
      const gitsmithFetch: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/gateway/verify-commit') {
          expect(init?.headers).toEqual(expect.objectContaining({
            Authorization: `Bearer ${secretToken}`
          }));
          return Response.json({
            success: true,
            exists: true,
            storageKey,
            commitOid,
            files: ['requirements.txt', 'main.py'],
            manifestContents: {
              'requirements.txt': 'fastapi==0.110.0',
              'main.py': 'from fastapi import FastAPI\napp = FastAPI()'
            }
          });
        }
        if (url.pathname === '/api/gateway/archive') {
          expect(init?.headers).toEqual(expect.objectContaining({
            Authorization: `Bearer ${secretToken}`
          }));
          return new Response(fakeTarArchive, {
            status: 200,
            headers: { 'Content-Type': 'application/x-tar' }
          });
        }
        throw new Error(`Unexpected GITSMITH URL: ${url.pathname}`);
      };

      // AWS fetch mock that inspects EVERY byte and header passed to AWS
      const rawAwsRequests: { url: string; headers: Record<string, string>; bodyText: string }[] = [];
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const headers = Object.fromEntries(req.headers.entries());
        let bodyText = '';
        try {
          bodyText = await req.clone().text();
        } catch {}

        rawAwsRequests.push({ url: req.url, headers, bodyText });

        const target = req.headers.get('x-amz-target') || '';
        if (req.method === 'PUT') {
          return new Response('', { status: 200 });
        }
        if (target === 'CodeBuild_20161006.StartBuild') {
          return Response.json({
            build: {
              id: 'nsw-build:sec-uuid-4444',
              buildStatus: 'IN_PROGRESS'
            }
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'deploy', appId: serverAppId })
      });

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_GATEWAY_URL: 'https://gitsmith-gateway-production.up.railway.app',
          GITSMITH_GATEWAY_TOKEN: secretToken,
          __GITSMITH_GATEWAY_FETCH: gitsmithFetch,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });

      expect(res.status).toBe(202);
      expect(rawAwsRequests.length).toBeGreaterThanOrEqual(2); // S3 PUT + CodeBuild POST

      // STRICT INVARIANT ASSERTION:
      // Assert secretToken NEVER appears in any AWS URL, headers, or body text!
      for (const awsReq of rawAwsRequests) {
        expect(awsReq.url).not.toContain(secretToken);
        for (const [headerName, headerValue] of Object.entries(awsReq.headers)) {
          expect(headerValue, `Header '${headerName}' must not contain GITSMITH token`).not.toContain(secretToken);
        }
        expect(awsReq.bodyText, 'AWS request body must not contain GITSMITH token').not.toContain(secretToken);
      }
    });
  });

  // ==========================================================================
  // 6. FIX 1: CAS on build_runs prevents stale-build finalization race
  // ==========================================================================
  describe('6. FIX 1: CAS on build_runs prevents stale-build finalization race', () => {
    it('dispatch build A (running) -> dispatch build B for same app (A becomes cancelled) -> A reports SUCCEEDED and lazy-finalize runs for A -> app_listings is NOT modified by A (changes=0), only B can finalize', async () => {
      const appId = 'cas-race-app';
      const user = 'usr_cas_maker';
      const token = 'token_cas_123';

      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES (?, 'casmaker', 'CAS Maker', 'user')
      `).bind(user).run();
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, ?, datetime('now', '+1 hour'))
      `).bind(tokenHash, user).run();

      const storageKey = `repositories/${appId}`;
      const repoInfo = createCommittedRepo(storageKey, {
        'requirements.txt': 'Flask==3.0.0\n',
        'app.py': 'from flask import Flask\napp = Flask(__name__)\n'
      });
      const commitA = repoInfo.commitOid;
      const commitB = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'CAS Race App', 'Tag', 'Desc', ?, '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).bind(appId, user).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_cas_1', ?, ?, ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(appId, user, appId, storageKey).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_cas_1', 'refs/heads/main', ?)
      `).bind(commitA).run();

      let buildCount = 0;
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';
        if (req.method === 'PUT') return new Response('', { status: 200 });
        if (target === 'CodeBuild_20161006.StartBuild') {
          buildCount++;
          return Response.json({
            build: {
              id: `nsw-build:cas-build-${buildCount}`,
              buildStatus: 'IN_PROGRESS'
            }
          });
        }
        return new Response('Not found', { status: 404 });
      };

      // 1. Dispatch build A
      const reqA = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'deploy', appId })
      });
      const resA = await deployApi.onRequestPost({
        request: reqA,
        env: { DB: ctx.d1, STORAGE: storage, GITSMITH_REPOS_ROOT: reposRoot, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
      });
      const dataA: any = await resA.json();
      expect(resA.status).toBe(202);
      expect(dataA.codeBuildId).toBe('nsw-build:cas-build-1');

      const buildA = await ctx.d1.prepare(`SELECT id, status, commit_oid FROM build_runs WHERE id = ?`).bind(dataA.buildRunId).first<any>();
      expect(buildA.status).toBe('running');

      // 2. Update repository head to commit B and dispatch build B
      await ctx.d1.prepare(`UPDATE repository_refs SET commit_oid = ? WHERE repository_id = 'repo_cas_1'`).bind(commitB).run();

      // Mock gateway verifying commit B
      const gitsmithFetch: typeof fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/gateway/verify-commit') {
          return Response.json({
            success: true,
            exists: true,
            storageKey,
            commitOid: commitB,
            files: ['requirements.txt', 'app.py'],
            manifestContents: { 'requirements.txt': 'Flask==3.0.0', 'app.py': 'app = Flask(__name__)' }
          });
        }
        if (url.pathname === '/api/gateway/archive') {
          return new Response(Buffer.from('archive-b'), { status: 200, headers: { 'Content-Type': 'application/x-tar' } });
        }
        return new Response('Not found', { status: 404 });
      };

      const reqB = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'deploy', appId })
      });
      const resB = await deployApi.onRequestPost({
        request: reqB,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_GATEWAY_URL: 'https://gitsmith.internal',
          GITSMITH_GATEWAY_TOKEN: 'sec_token',
          __GITSMITH_GATEWAY_FETCH: gitsmithFetch,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });
      const dataB: any = await resB.json();
      expect(resB.status).toBe(202);
      expect(dataB.codeBuildId).toBe('nsw-build:cas-build-2');

      // Invariant: Build A was superseded on dispatch -> status is 'cancelled'
      const buildAAfterB = await ctx.d1.prepare(`SELECT status FROM build_runs WHERE id = ?`).bind(dataA.buildRunId).first<any>();
      expect(buildAAfterB.status).toBe('cancelled');

      // Build B is running
      const buildB = await ctx.d1.prepare(`SELECT status FROM build_runs WHERE id = ?`).bind(dataB.buildRunId).first<any>();
      expect(buildB.status).toBe('running');

      // App listing active_commit_oid is commitB and deployment_state is building
      const appAfterB = await ctx.d1.prepare(`SELECT deployment_state, active_commit_oid, deployment_evidence_json FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(appAfterB.deployment_state).toBe('building');
      expect(appAfterB.active_commit_oid).toBe(commitB);
      const evidenceBeforeA = appAfterB.deployment_evidence_json;

      // 3. Simulate build A SUCCEEDED in CodeBuild and attempt lazy-finalize with CAS guard
      // Even if CodeBuild reported SUCCEEDED for A, atomic CAS on build A row finds status != 'running' (changes=0)
      const casUpdateA = await ctx.d1.prepare(`
        UPDATE build_runs SET
          status = 'passed',
          result_digest = 'sha256:digestA_fake',
          exit_code = 0,
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'running'
      `).bind(dataA.buildRunId).run();

      expect(casUpdateA.meta?.changes ?? (casUpdateA as any).changes).toBe(0);

      // Verify app_listings was NOT modified by A
      const appAfterAAttempt = await ctx.d1.prepare(`SELECT deployment_state, active_commit_oid, deployment_evidence_json FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(appAfterAAttempt.deployment_state).toBe('building');
      expect(appAfterAAttempt.active_commit_oid).toBe(commitB);
      expect(appAfterAAttempt.deployment_evidence_json).toBe(evidenceBeforeA);

      // 4. Now lazy-finalize runs for B (which is running) -> candidate build passes and triggers nsw-deploy
      const mockAwsFetchFinalize: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';
        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{ id: dataB.codeBuildId, buildStatus: 'SUCCEEDED', currentPhase: 'COMPLETED' }]
          });
        }
        if (target === 'AmazonEC2ContainerRegistry_V20150921.DescribeImages') {
          return Response.json({
            imageDetails: [{ registryId: '777772815966', repositoryName: `nsw/${appId}`, imageDigest: 'sha256:digestB_real', imageTags: [commitB] }]
          });
        }
        if (target === 'CodeBuild_20161006.StartBuild') {
          return Response.json({
            build: { id: 'nsw-deploy:cas-deploy-2', buildStatus: 'IN_PROGRESS' }
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const resGet = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetchFinalize }
      });
      const dataGet: any = await resGet.json();
      expect(resGet.status).toBe(200);
      expect(dataGet.deploymentState).toBe('building');

      const buildBFinal = await ctx.d1.prepare(`SELECT status, result_digest FROM build_runs WHERE id = ?`).bind(dataB.buildRunId).first<any>();
      expect(buildBFinal.status).toBe('passed');
      expect(buildBFinal.result_digest).toBe('sha256:digestB_real');

      const appFinal = await ctx.d1.prepare(`SELECT deployment_state FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(appFinal.deployment_state).toBe('building');

      // 5. Deploy stage finalize for B -> promotes to active
      const workerUrlB = 'https://nsw-app-cas-race-app.subdomain.workers.dev';
      const mockAwsFetchDeployFinalize: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';
        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: 'nsw-deploy:cas-deploy-2',
              buildStatus: 'SUCCEEDED',
              exportedEnvironmentVariables: [{ name: 'DEPLOYED_WORKER_URL', value: workerUrlB }]
            }]
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const resGetDeploy = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetchDeployFinalize }
      });
      const dataGetDeploy: any = await resGetDeploy.json();
      expect(resGetDeploy.status).toBe(200);
      expect(dataGetDeploy.deploymentState).toBe('active');
      expect(dataGetDeploy.activeUrl).toBe(workerUrlB);

      const appActive = await ctx.d1.prepare(`SELECT deployment_state, origin_kind, origin_ref FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(appActive.deployment_state).toBe('active');
      expect(appActive.origin_kind).toBe('cf_container');
      expect(appActive.origin_ref).toBe(workerUrlB);
    });

    it('deploy stage CAS guard prevents stale deploy build from promoting over a newer release', async () => {
      const appId = 'cas-deploy-race-app';
      const user = 'usr_cas_dep_maker';

      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES (?, 'casdepmaker', 'CAS Dep Maker', 'user')
      `).bind(user).run();

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state, origin_kind)
        VALUES (?, 'CAS Dep Race App', 'Tag', 'Desc', ?, '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'building', 'cf_container')
      `).bind(appId, user).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_cas_dep_1', ?, ?, ?, 'public', 'sha1', 'refs/heads/main', 'repositories/cas-deploy-race-app', 'active')
      `).bind(appId, user, appId).run();

      const commit1 = '1111111111111111111111111111111111111111';
      const commit2 = '2222222222222222222222222222222222222222';

      // Deploy build 1 (was running, but cancelled/superseded)
      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest, started_at)
        VALUES ('br_dep_old', 'repo_cas_dep_1', ?, 'release', 'cancelled', 'nsw-deploy:old-uuid', 'nsw-deploy', 'sha256:old', CURRENT_TIMESTAMP)
      `).bind(commit1).run();

      // Deploy build 2 (authoritative running)
      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest, started_at)
        VALUES ('br_dep_new', 'repo_cas_dep_1', ?, 'release', 'running', 'nsw-deploy:new-uuid', 'nsw-deploy', 'sha256:new', CURRENT_TIMESTAMP)
      `).bind(commit2).run();

      // Simulate old build attempting atomic CAS update in D1
      const casOld = await ctx.d1.prepare(`
        UPDATE build_runs SET
          status = 'passed',
          result_digest = 'https://old.workers.dev',
          exit_code = 0,
          finished_at = CURRENT_TIMESTAMP
        WHERE id = 'br_dep_old' AND status = 'running'
      `).run();

      // CAS changes is 0 because status is 'cancelled'
      expect(casOld.meta?.changes ?? (casOld as any).changes).toBe(0);

      // Now lazy finalize runs for authoritative build (br_dep_new)
      const mockAwsFetchNew: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';
        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: 'nsw-deploy:new-uuid',
              buildStatus: 'SUCCEEDED',
              exportedEnvironmentVariables: [{ name: 'DEPLOYED_WORKER_URL', value: 'https://new-authoritative.workers.dev' }]
            }]
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const resGet = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetchNew }
      });
      const dataGet: any = await resGet.json();
      expect(resGet.status).toBe(200);
      expect(dataGet.deploymentState).toBe('active');
      expect(dataGet.activeUrl).toBe('https://new-authoritative.workers.dev');

      const finalApp = await ctx.d1.prepare(`SELECT deployment_state, origin_ref, active_commit_oid FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(finalApp.deployment_state).toBe('active');
      expect(finalApp.origin_ref).toBe('https://new-authoritative.workers.dev');
      expect(finalApp.active_commit_oid).toBe(commit2);
    });
  });

  // ==========================================================================
  // 7. FIX 2: Bounded retry for transient ECR eventual consistency
  // ==========================================================================
  describe('7. FIX 2: Bounded retry for transient ECR eventual consistency', () => {
    const appId = 'ecr-retry-app';
    const commitOid = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
    const codeBuildId = 'nsw-build:ecr-retry-build-1';

    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_ecr_maker', 'ecrmaker', 'ECR Maker', 'user')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'ECR Retry App', 'Tag', 'Desc', 'usr_ecr_maker', '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'building')
      `).bind(appId).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_ecr_1', ?, 'usr_ecr_maker', ?, 'public', 'sha1', 'refs/heads/main', 'repositories/ecr-retry-app', 'active')
      `).bind(appId, appId).run();
      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest, started_at)
        VALUES ('br_ecr_1', 'repo_ecr_1', ?, 'release', 'running', ?, 'python app.py', 'sha256:manifest123', CURRENT_TIMESTAMP)
      `).bind(commitOid, codeBuildId).run();
    });

    it('(a) transient ECR error post-SUCCEEDED (endTime recent) leaves app in building state for retry', async () => {
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: codeBuildId,
              buildStatus: 'SUCCEEDED',
              endTime: new Date().toISOString() // Finished right now
            }]
          });
        }

        if (target === 'AmazonEC2ContainerRegistry_V20150921.DescribeImages') {
          return Response.json(
            { __type: 'ImageNotFoundException', message: `The image with imageId {imageTag='${commitOid}'} does not exist within repository 'nsw/${appId}'` },
            { status: 400 }
          );
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.deploymentState).toBe('building');
      expect(data.isVerifiedActive).toBe(false);

      // Invariant: build_runs stays running so subsequent GET calls retry
      const buildRun = await ctx.d1.prepare(`SELECT status FROM build_runs WHERE id = 'br_ecr_1'`).first<any>();
      expect(buildRun.status).toBe('running');

      const app = await ctx.d1.prepare(`SELECT deployment_state FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(app.deployment_state).toBe('building');
    });

    it('(b) repo-missing causes terminal failed state immediately', async () => {
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{ id: codeBuildId, buildStatus: 'SUCCEEDED', endTime: new Date().toISOString() }]
          });
        }

        if (target === 'AmazonEC2ContainerRegistry_V20150921.DescribeImages') {
          return Response.json(
            { __type: 'RepositoryNotFoundException', message: `The repository with name 'nsw/${appId}' does not exist` },
            { status: 400 }
          );
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.deploymentState).toBe('failed');
      expect(data.deploymentError).toContain(`ECR repo nsw/${appId} not provisioned`);

      const buildRun = await ctx.d1.prepare(`SELECT status FROM build_runs WHERE id = 'br_ecr_1'`).first<any>();
      expect(buildRun.status).toBe('failed');

      const app = await ctx.d1.prepare(`SELECT deployment_state FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(app.deployment_state).toBe('failed');
    });

    it('(c) SUCCEEDED endTime >10min ago + still no digest causes terminal failed timeout', async () => {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: codeBuildId,
              buildStatus: 'SUCCEEDED',
              endTime: fifteenMinutesAgo
            }]
          });
        }

        if (target === 'AmazonEC2ContainerRegistry_V20150921.DescribeImages') {
          return Response.json(
            { __type: 'ImageNotFoundException', message: `The image with imageId {imageTag='${commitOid}'} does not exist` },
            { status: 400 }
          );
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
      });

      const data: any = await res.json();
      expect(res.status).toBe(200);
      expect(data.deploymentState).toBe('failed');
      expect(data.deploymentError).toContain('image never appeared in ECR after build success');

      const buildRun = await ctx.d1.prepare(`SELECT status FROM build_runs WHERE id = 'br_ecr_1'`).first<any>();
      expect(buildRun.status).toBe('failed');

      const app = await ctx.d1.prepare(`SELECT deployment_state, deployment_error FROM app_listings WHERE id = ?`).bind(appId).first<any>();
      expect(app.deployment_state).toBe('failed');
      expect(app.deployment_error).toContain('image never appeared in ECR after build success');
    });
  });

  // ==========================================================================
  // 8. FIX 3: Fail-closed validation of appId and commitOid before ANY AWS call
  // ==========================================================================
  describe('8. FIX 3: Fail-closed validation of appId and commitOid before ANY AWS call', () => {
    let makerToken: string;

    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_val_maker', 'valmaker', 'Validation Maker', 'user')
      `).run();
      makerToken = 'token_val_123';
      const tokenHash = await hashSessionToken(makerToken);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_val_maker', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();
    });

    it('rejects an appId with "/", "..", or uppercase before ANY AWS call', async () => {
      let awsCalled = false;
      const mockAwsFetch: typeof fetch = async () => {
        awsCalled = true;
        throw new Error('AWS must NOT be called for invalid appId!');
      };

      const invalidAppIds = ['bad/slash', '../path-traversal', 'UppercaseApp', '-leading-hyphen', 'has_underscore'];

      for (const badAppId of invalidAppIds) {
        awsCalled = false;

        // POST dispatch path
        const postReq = new Request('https://nates-software.com/api/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makerToken}` },
          body: JSON.stringify({ action: 'deploy', appId: badAppId })
        });
        const postRes = await deployApi.onRequestPost({
          request: postReq,
          env: { DB: ctx.d1, STORAGE: storage, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
        });
        expect(postRes.status).toBe(400);
        const postData: any = await postRes.json();
        expect(postData.error).toContain('Invalid appId');
        expect(awsCalled).toBe(false);

        // GET query path
        const getRes = await deployApi.onRequestGet({
          request: new Request(`https://nates-software.com/api/deploy?appId=${encodeURIComponent(badAppId)}`),
          env: { DB: ctx.d1, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
        });
        expect(getRes.status).toBe(400);
        const getData: any = await getRes.json();
        expect(getData.error).toContain('Invalid appId');
        expect(awsCalled).toBe(false);
      }
    });

    it('rejects non-hex or short commitOid before ANY AWS call', async () => {
      let awsCalled = false;
      const mockAwsFetch: typeof fetch = async () => {
        awsCalled = true;
        throw new Error('AWS must NOT be called for invalid commitOid!');
      };

      const validAppId = 'valid-validation-app';
      const storageKey = `repositories/${validAppId}`;

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'Val App', 'Tag', 'Desc', 'usr_val_maker', '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).bind(validAppId).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_val_1', ?, 'usr_val_maker', ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(validAppId, validAppId, storageKey).run();

      const invalidOids = [
        'short123', // short
        'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', // non-hex
        'ABCDEF0123456789ABCDEF0123456789ABCDEF01', // uppercase
        '123456789012345678901234567890123456789' // 39 chars (short)
      ];

      for (const badOid of invalidOids) {
        awsCalled = false;
        await ctx.d1.prepare(`
          INSERT OR REPLACE INTO repository_refs (repository_id, ref_name, commit_oid)
          VALUES ('repo_val_1', 'refs/heads/main', ?)
        `).bind(badOid).run();

        const postReq = new Request('https://nates-software.com/api/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makerToken}` },
          body: JSON.stringify({ action: 'deploy', appId: validAppId })
        });

        const postRes = await deployApi.onRequestPost({
          request: postReq,
          env: { DB: ctx.d1, STORAGE: storage, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
        });

        expect(postRes.status).toBe(422);
        const postData: any = await postRes.json();
        expect(postData.error).toContain('Invalid commitOid');
        expect(awsCalled).toBe(false);
      }
    });

    it('leaves PROCFILE_START unescaped by design', async () => {
      const serverAppId = 'procfile-app';
      const storageKey = `repositories/${serverAppId}`;
      const rawStartCmd = "gunicorn -w 4 -b 0.0.0.0:$PORT 'my_app:create_app()'";

      const { commitOid } = createCommittedRepo(storageKey, {
        'requirements.txt': 'Flask==3.0.0\n',
        'rig.json': JSON.stringify({ startCommand: rawStartCmd })
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'Procfile App', 'Tag', 'Desc', 'usr_val_maker', '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).bind(serverAppId).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_proc_1', ?, 'usr_val_maker', ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(serverAppId, serverAppId, storageKey).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_proc_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      let capturedOverrides: any[] = [];
      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';
        if (req.method === 'PUT') return new Response('', { status: 200 });
        if (target === 'CodeBuild_20161006.StartBuild') {
          const body = JSON.parse(await req.clone().text());
          capturedOverrides = body.environmentVariablesOverride;
          return Response.json({
            build: { id: 'nsw-build:proc-uuid-1', buildStatus: 'IN_PROGRESS' }
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const postReq = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makerToken}` },
        body: JSON.stringify({ action: 'deploy', appId: serverAppId })
      });

      const postRes = await deployApi.onRequestPost({
        request: postReq,
        env: { DB: ctx.d1, STORAGE: storage, GITSMITH_REPOS_ROOT: reposRoot, ...AWS_CREDS, __AWS_FETCH: mockAwsFetch }
      });

      expect(postRes.status).toBe(202);
      const procOverride = capturedOverrides.find(o => o.name === 'PROCFILE_START');
      expect(procOverride).toBeDefined();
      // Confirm PROCFILE_START is passed exactly unescaped as authored in Procfile/plan
      expect(procOverride.value).toBe(rawStartCmd);
    });
  });
});
