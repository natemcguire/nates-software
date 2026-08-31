import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { initBareRepo } from '../src/lib/gitsmith/gitStorage';
import { hashSessionToken } from '../functions/api/_session';
import * as deployApi from '../functions/api/deploy';
import {
  executeDataApiStatement,
  putSsmParameter,
  getSsmParameter,
  generateDbPassword,
  provisionAppDatabase,
  DEFAULT_NSW_DB_HOST
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

describe('Phase 5: Postgres Add-on AWS Control Plane Suite', () => {
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
    CF_ACCOUNT_ID: '4219a576830c72b0e6e4ca358e61473a',
    NSW_DB_CLUSTER_ARN: 'arn:aws:rds:us-east-2:777772815966:cluster:nsw-shared-pg',
    NSW_DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-2:777772815966:secret:rds!cluster-cec8ae29-5aab-461b-a1e9-edfc93ec9a3a-kBp7SZ',
    NSW_DB_HOST: 'nsw-shared-pg.cluster-cec8ae29-5aab-461b-a1e9-edfc93ec9a3a.us-east-2.rds.amazonaws.com'
  };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    tempDir = path.join('/tmp', `aws-postgres-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
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
  // 1. Password Generator & Identifier Safety
  // ==========================================================================
  describe('1. Password Generator & Identifier Safety', () => {
    it('generates 32+ character alphanumeric passwords strictly within [A-Za-z0-9]', () => {
      for (let i = 0; i < 50; i++) {
        const pw = generateDbPassword(32);
        expect(pw.length).toBe(32);
        expect(/^[A-Za-z0-9]{32}$/.test(pw)).toBe(true);
        expect(pw).not.toContain("'");
        expect(pw).not.toContain('"');
        expect(pw).not.toContain(';');
        expect(pw).not.toContain('@');
        expect(pw).not.toContain('/');
        expect(pw).not.toContain(':');
      }
    });

    it('rejects invalid appId identifiers in provisionAppDatabase', async () => {
      const res = await provisionAppDatabase(AWS_CREDS, 'invalid_app_ID!!');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid appId');
    });
  });

  // ==========================================================================
  // 2. SigV4 Protocol Verification: RDS Data API & SSM
  // ==========================================================================
  describe('2. SigV4 Protocol Verification (RDS Data API & SSM)', () => {
    it('RDS Data API: signs POST https://rds-data.us-east-2.amazonaws.com/Execute with rest-json (NO X-Amz-Target)', async () => {
      const capturedRequests: Request[] = [];
      const customFetch: typeof fetch = async (req) => {
        capturedRequests.push(req as Request);
        return Response.json({ records: [], numberOfRecordsUpdated: 1 });
      };

      const res = await executeDataApiStatement(
        { ...AWS_CREDS, __AWS_FETCH: customFetch, AWS_RDS_DATA_RETRY_DELAY_MS: 0 },
        {
          database: 'postgres',
          sql: 'SELECT 1'
        }
      );

      expect(res.success).toBe(true);
      expect(capturedRequests.length).toBe(1);

      const req = capturedRequests[0];
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://rds-data.us-east-2.amazonaws.com/Execute');
      expect(req.headers.get('content-type')).toBe('application/json');
      expect(req.headers.get('x-amz-target')).toBeNull();
      expect(req.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
      expect(req.headers.get('authorization')).toContain('us-east-2/rds-data/aws4_request');

      const body = JSON.parse(await req.text());
      expect(body.resourceArn).toBe(AWS_CREDS.NSW_DB_CLUSTER_ARN);
      expect(body.secretArn).toBe(AWS_CREDS.NSW_DB_SECRET_ARN);
      expect(body.sql).toBe('SELECT 1');
      expect(body.database).toBe('postgres');
    });

    it('SSM PutParameter: signs POST https://ssm.us-east-2.amazonaws.com/ with JSON-1.1 and X-Amz-Target: AmazonSSM.PutParameter', async () => {
      const capturedRequests: Request[] = [];
      const customFetch: typeof fetch = async (req) => {
        capturedRequests.push(req as Request);
        return Response.json({ Version: 1 });
      };

      const res = await putSsmParameter(
        { ...AWS_CREDS, __AWS_FETCH: customFetch },
        {
          name: '/nsw/apps/my-app/db-url',
          value: 'postgresql://app_my-app:secret@db.host:5432/app_my-app?sslmode=require',
          type: 'SecureString',
          overwrite: false
        }
      );

      expect(res.success).toBe(true);
      expect(capturedRequests.length).toBe(1);

      const req = capturedRequests[0];
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://ssm.us-east-2.amazonaws.com/');
      expect(req.headers.get('content-type')).toBe('application/x-amz-json-1.1');
      expect(req.headers.get('x-amz-target')).toBe('AmazonSSM.PutParameter');
      expect(req.headers.get('authorization')).toContain('us-east-2/ssm/aws4_request');

      const body = JSON.parse(await req.text());
      expect(body.Name).toBe('/nsw/apps/my-app/db-url');
      expect(body.Type).toBe('SecureString');
      expect(body.Overwrite).toBe(false);
    });

    it('SSM GetParameter: signs POST with X-Amz-Target: AmazonSSM.GetParameter', async () => {
      const capturedRequests: Request[] = [];
      const customFetch: typeof fetch = async (req) => {
        capturedRequests.push(req as Request);
        return Response.json({
          Parameter: {
            Name: '/nsw/apps/my-app/db-url',
            Type: 'SecureString',
            Value: 'postgresql://app_my-app:secret@db.host:5432/app_my-app?sslmode=require',
            Version: 1
          }
        });
      };

      const res = await getSsmParameter(
        { ...AWS_CREDS, __AWS_FETCH: customFetch },
        { name: '/nsw/apps/my-app/db-url', withDecryption: true }
      );

      expect(res.success).toBe(true);
      expect(res.exists).toBe(true);
      expect(res.value).toBe('postgresql://app_my-app:secret@db.host:5432/app_my-app?sslmode=require');
      expect(capturedRequests[0].headers.get('x-amz-target')).toBe('AmazonSSM.GetParameter');
    });
  });

  // ==========================================================================
  // 3. DDL Generation, Quoting, and Sequence
  // ==========================================================================
  describe('3. DDL Generation, Quoting, and Sequence in provisionAppDatabase', () => {
    it('executes exact single-statement DDL sequence with double-quoted identifiers', async () => {
      const appId = 'flask-notes-123';
      const expectedDbName = `"app_${appId}"`;
      const executedSqls: { database: string; sql: string }[] = [];
      let ssmPutPayload: any = null;

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';
        const bodyText = await req.clone().text();
        const body = bodyText ? JSON.parse(bodyText) : {};

        if (target === 'AmazonSSM.GetParameter') {
          return Response.json({ __type: 'ParameterNotFound' }, { status: 400 });
        }

        if (target === 'AmazonSSM.PutParameter') {
          ssmPutPayload = body;
          return Response.json({ Version: 1 });
        }

        // RDS Data API
        if (req.url.includes('/Execute')) {
          executedSqls.push({ database: body.database, sql: body.sql });
          return Response.json({ records: [], numberOfRecordsUpdated: 0 });
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await provisionAppDatabase(
        { ...AWS_CREDS, __AWS_FETCH: mockAwsFetch, AWS_RDS_DATA_RETRY_DELAY_MS: 0 },
        appId
      );

      expect(res.success).toBe(true);
      expect(res.secretPath).toBe(`/nsw/apps/${appId}/db-url`);
      expect(res.dbKind).toBe('postgres');
      expect(res.reused).toBe(false);

      // Verify sequence of 5 SQL statements
      expect(executedSqls.length).toBe(5);

      // 1. CREATE ROLE "app_<id>" LOGIN PASSWORD '<pw>' on database: 'postgres'
      expect(executedSqls[0].database).toBe('postgres');
      expect(executedSqls[0].sql).toMatch(new RegExp(`^CREATE ROLE ${expectedDbName} LOGIN PASSWORD '[A-Za-z0-9]{32}'$`));

      // 2. CREATE DATABASE "app_<id>" OWNER "app_<id>" on database: 'postgres'
      expect(executedSqls[1].database).toBe('postgres');
      expect(executedSqls[1].sql).toBe(`CREATE DATABASE ${expectedDbName} OWNER ${expectedDbName}`);

      // 3. REVOKE ALL ON DATABASE "app_<id>" FROM PUBLIC on database: 'postgres'
      expect(executedSqls[2].database).toBe('postgres');
      expect(executedSqls[2].sql).toBe(`REVOKE ALL ON DATABASE ${expectedDbName} FROM PUBLIC`);

      // 4. REVOKE ALL ON SCHEMA public FROM PUBLIC on database: "app_<id>"
      expect(executedSqls[3].database).toBe(`app_${appId}`);
      expect(executedSqls[3].sql).toBe('REVOKE ALL ON SCHEMA public FROM PUBLIC');

      // 5. GRANT ALL ON SCHEMA public TO "app_<id>" on database: "app_<id>"
      expect(executedSqls[4].database).toBe(`app_${appId}`);
      expect(executedSqls[4].sql).toBe(`GRANT ALL ON SCHEMA public TO ${expectedDbName}`);

      // Verify SSM PutParameter payload
      expect(ssmPutPayload).toBeDefined();
      expect(ssmPutPayload.Name).toBe(`/nsw/apps/${appId}/db-url`);
      expect(ssmPutPayload.Type).toBe('SecureString');
      expect(ssmPutPayload.Overwrite).toBe(false);
      expect(ssmPutPayload.Value).toMatch(new RegExp(`^postgresql://app_${appId}:[A-Za-z0-9]{32}@${DEFAULT_NSW_DB_HOST}:5432/app_${appId}\\?sslmode=require$`));
    });

    it('tolerates already exists (42710 for role, 42P04 for database) as success', async () => {
      const appId = 'existing-db-app';

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';
        const bodyText = await req.clone().text();
        const body = bodyText ? JSON.parse(bodyText) : {};

        if (target === 'AmazonSSM.GetParameter') {
          return Response.json({ __type: 'ParameterNotFound' }, { status: 400 });
        }
        if (target === 'AmazonSSM.PutParameter') {
          return Response.json({ Version: 1 });
        }
        if (req.url.includes('/Execute')) {
          if (body.sql.startsWith('CREATE ROLE')) {
            return Response.json({ message: 'ERROR: role "app_existing-db-app" already exists (42710)' }, { status: 400 });
          }
          if (body.sql.startsWith('CREATE DATABASE')) {
            return Response.json({ message: 'ERROR: database "app_existing-db-app" already exists (42P04)' }, { status: 400 });
          }
          return Response.json({ records: [] });
        }
        return new Response('Not found', { status: 404 });
      };

      const res = await provisionAppDatabase(
        { ...AWS_CREDS, __AWS_FETCH: mockAwsFetch, AWS_RDS_DATA_RETRY_DELAY_MS: 0 },
        appId
      );

      expect(res.success).toBe(true);
      expect(res.secretPath).toBe(`/nsw/apps/${appId}/db-url`);
    });
  });

  // ==========================================================================
  // 4. Idempotency Guard
  // ==========================================================================
  describe('4. Idempotency Guard', () => {
    it('skips role/db provisioning and reuses existing password when SSM parameter exists', async () => {
      const appId = 'reused-app';
      const existingDsn = `postgresql://app_${appId}:old_password_1234@${DEFAULT_NSW_DB_HOST}:5432/app_${appId}?sslmode=require`;
      let rdsCallsCount = 0;

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'AmazonSSM.GetParameter') {
          return Response.json({
            Parameter: {
              Name: `/nsw/apps/${appId}/db-url`,
              Value: existingDsn,
              Type: 'SecureString'
            }
          });
        }

        if (req.url.includes('/Execute')) {
          rdsCallsCount++;
          return Response.json({ records: [] });
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await provisionAppDatabase(
        { ...AWS_CREDS, __AWS_FETCH: mockAwsFetch, AWS_RDS_DATA_RETRY_DELAY_MS: 0 },
        appId
      );

      expect(res.success).toBe(true);
      expect(res.reused).toBe(true);
      expect(res.secretPath).toBe(`/nsw/apps/${appId}/db-url`);
      expect(rdsCallsCount).toBe(0); // Zero RDS Data API calls made!
    });
  });

  // ==========================================================================
  // 5. Resume from Scale-to-Zero & Retry Logic
  // ==========================================================================
  describe('5. Paused Cluster Resume & Retry Logic', () => {
    it('retries ~3x on DatabaseResumingException and succeeds when resume finishes', async () => {
      const appId = 'resume-test-app';
      let executeAttempts = 0;

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'AmazonSSM.GetParameter') {
          return Response.json({ __type: 'ParameterNotFound' }, { status: 400 });
        }
        if (target === 'AmazonSSM.PutParameter') {
          return Response.json({ Version: 1 });
        }

        if (req.url.includes('/Execute')) {
          executeAttempts++;
          if (executeAttempts < 3) {
            // First 2 calls fail with DatabaseResumingException
            return Response.json(
              {
                __type: 'DatabaseResumingException',
                message: 'Database cluster is resuming. Please retry in a few moments.'
              },
              { status: 400 }
            );
          }
          return Response.json({ records: [] });
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await provisionAppDatabase(
        { ...AWS_CREDS, __AWS_FETCH: mockAwsFetch, AWS_RDS_DATA_RETRY_DELAY_MS: 0, AWS_RDS_DATA_MAX_RETRIES: 3 },
        appId
      );

      expect(res.success).toBe(true);
      expect(executeAttempts).toBeGreaterThanOrEqual(3);
    });

    it('surfaces retryable failure when cluster is still resuming after max retries', async () => {
      const appId = 'stuck-resuming-app';

      const mockAwsFetch: typeof fetch = async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const target = req.headers.get('x-amz-target') || '';

        if (target === 'AmazonSSM.GetParameter') {
          return Response.json({ __type: 'ParameterNotFound' }, { status: 400 });
        }

        if (req.url.includes('/Execute')) {
          return Response.json(
            {
              __type: 'DatabaseResumingException',
              message: 'Database cluster is resuming.'
            },
            { status: 400 }
          );
        }

        return new Response('Not found', { status: 404 });
      };

      const res = await provisionAppDatabase(
        { ...AWS_CREDS, __AWS_FETCH: mockAwsFetch, AWS_RDS_DATA_RETRY_DELAY_MS: 0, AWS_RDS_DATA_MAX_RETRIES: 2 },
        appId
      );

      expect(res.success).toBe(false);
      expect(res.retryable).toBe(true);
      expect(res.isResuming).toBe(true);
      expect(res.error).toContain('resuming');
    });
  });

  // ==========================================================================
  // 6. Fail-Closed on Static Apps with postgres: true
  // ==========================================================================
  describe('6. Fail-Closed on Static Apps with postgres: true', () => {
    let makerToken: string;
    const staticAppId = 'static-postgres-attempt';

    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_static_dev', 'staticdev', 'Static Dev', 'user')
      `).run();
      makerToken = 'token_static_dev_123';
      const tokenHash = await hashSessionToken(makerToken);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_static_dev', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = `repositories/${staticAppId}`;
      const repoInfo = createCommittedRepo(storageKey, {
        'index.html': '<!DOCTYPE html><html><body><h1>Static</h1></body></html>',
        'slop.json': JSON.stringify({
          name: 'Static App With Postgres',
          postgres: true
        })
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'Static App', 'Tag', 'Desc', 'usr_static_dev', '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).bind(staticAppId).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_static_pg', ?, 'usr_static_dev', ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(staticAppId, staticAppId, storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_static_pg', 'refs/heads/main', ?)
      `).bind(repoInfo.commitOid).run();
    });

    it('fails closed (422) with honest error when static app has postgres: true, making zero AWS provisioning calls', async () => {
      let anyAwsCall = false;
      const mockAwsFetch: typeof fetch = async () => {
        anyAwsCall = true;
        return new Response('Not found', { status: 404 });
      };

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${makerToken}`
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
          __AWS_FETCH: mockAwsFetch
        }
      });

      const data: any = await res.json();
      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Postgres add-on is only supported for server/container applications');
      expect(anyAwsCall).toBe(false); // No AWS calls made!

      const app = await ctx.d1.prepare('SELECT deployment_state, db_kind, db_secret_path FROM app_listings WHERE id = ?').bind(staticAppId).first<any>();
      expect(app.deployment_state).toBe('failed');
      expect(app.db_kind).toBeNull();
      expect(app.db_secret_path).toBeNull();
    });
  });

  // ==========================================================================
  // 7. Full Lifecycle: Container App with Postgres (Provision -> Persist CAS -> Trigger nsw-deploy)
  // ==========================================================================
  describe('7. Full Lifecycle & Secret Hygiene', () => {
    let makerToken: string;
    let commitOid: string;
    const appId = 'flask-pg-app';

    beforeEach(async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_pg_dev', 'pgdev', 'PG Developer', 'user')
      `).run();
      makerToken = 'token_pg_dev_123';
      const tokenHash = await hashSessionToken(makerToken);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_pg_dev', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = `repositories/${appId}`;
      const repoInfo = createCommittedRepo(storageKey, {
        'requirements.txt': 'Flask==3.0.0\ngunicorn==21.2.0\npsycopg2-binary==2.9.9\n',
        'app.py': 'import os, psycopg2\nfrom flask import Flask\napp = Flask(__name__)\n',
        'slop.json': JSON.stringify({
          name: 'Flask Postgres App',
          postgres: true
        })
      });
      commitOid = repoInfo.commitOid;

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES (?, 'Flask Postgres App', 'Tag', 'Desc', 'usr_pg_dev', '1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).bind(appId).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_flask_pg_1', ?, 'usr_pg_dev', ?, 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(appId, appId, storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_flask_pg_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();
    });

    it('provisions DB, persists db columns under CAS, dispatches nsw-build, and passes DB_SECRET_PATH to nsw-deploy in later poll', async () => {
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

        // SSM GetParameter (first check -> not found)
        if (target === 'AmazonSSM.GetParameter') {
          return Response.json({ __type: 'ParameterNotFound' }, { status: 400 });
        }
        // SSM PutParameter
        if (target === 'AmazonSSM.PutParameter') {
          return Response.json({ Version: 1 });
        }
        // RDS Data API
        if (url.pathname.includes('/Execute')) {
          return Response.json({ records: [], numberOfRecordsUpdated: 0 });
        }
        // S3 PutObject
        if (req.method === 'PUT' && url.hostname.includes('.s3.')) {
          return new Response('', { status: 200 });
        }
        // CodeBuild StartBuild
        if (target === 'CodeBuild_20161006.StartBuild') {
          if (body?.projectName === 'nsw-build') {
            return Response.json({
              build: {
                id: 'nsw-build:build-uuid-9999',
                buildStatus: 'IN_PROGRESS'
              }
            });
          }
          if (body?.projectName === 'nsw-deploy') {
            return Response.json({
              build: {
                id: 'nsw-deploy:deploy-uuid-9999',
                buildStatus: 'IN_PROGRESS'
              }
            });
          }
        }
        // CodeBuild BatchGetBuilds
        if (target === 'CodeBuild_20161006.BatchGetBuilds') {
          return Response.json({
            builds: [{
              id: 'nsw-build:build-uuid-9999',
              buildStatus: 'SUCCEEDED',
              currentPhase: 'COMPLETED'
            }]
          });
        }
        // ECR DescribeImages
        if (target === 'AmazonEC2ContainerRegistry_V20150921.DescribeImages') {
          return Response.json({
            imageDetails: [{
              registryId: '777772815966',
              repositoryName: `nsw/${appId}`,
              imageDigest: 'sha256:45b23e288d0b1530d83352956650d239c7722ec1a3b043f3799d48dd6a8b8b56',
              imageTags: [commitOid]
            }]
          });
        }

        return new Response('Not found', { status: 404 });
      };

      // Step A: Trigger Deploy (POST /api/deploy)
      const deployReq = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${makerToken}`
        },
        body: JSON.stringify({ action: 'deploy', appId })
      });

      const postRes = await deployApi.onRequestPost({
        request: deployReq,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          ...AWS_CREDS,
          AWS_RDS_DATA_RETRY_DELAY_MS: 0,
          __AWS_FETCH: mockAwsFetch
        }
      });

      const postData: any = await postRes.json();
      expect(postRes.status).toBe(202);
      expect(postData.success).toBe(true);
      expect(postData.deploymentState).toBe('building');

      // Verify D1 state after POST /api/deploy: db columns are persisted under CAS
      const appRow = await ctx.d1.prepare(`
        SELECT deployment_state, db_kind, db_secret_path, db_provisioned_at, deployment_evidence_json
        FROM app_listings WHERE id = ?
      `).bind(appId).first<any>();

      expect(appRow.deployment_state).toBe('building');
      expect(appRow.db_kind).toBe('postgres');
      expect(appRow.db_secret_path).toBe(`/nsw/apps/${appId}/db-url`);
      expect(appRow.db_provisioned_at).toBeTruthy();

      // Step B: Later poll (GET /api/deploy) when candidate build SUCCEEDS -> triggers nsw-deploy
      const getRes = await deployApi.onRequestGet({
        request: new Request(`https://nates-software.com/api/deploy?appId=${appId}`),
        env: {
          DB: ctx.d1,
          ...AWS_CREDS,
          __AWS_FETCH: mockAwsFetch
        }
      });

      const getData: any = await getRes.json();
      expect(getRes.status).toBe(200);
      expect(getData.success).toBe(true);
      expect(getData.dbKind).toBe('postgres');
      expect(getData.dbSecretPath).toBe(`/nsw/apps/${appId}/db-url`);

      // Verify StartBuild for nsw-deploy received DB_SECRET_PATH in envOverrides
      const deployCbCall = awsCalls.find(c => c.target === 'CodeBuild_20161006.StartBuild' && c.body?.projectName === 'nsw-deploy');
      expect(deployCbCall).toBeDefined();
      expect(deployCbCall?.body.environmentVariablesOverride).toEqual([
        { name: 'APP_ID', value: appId, type: 'PLAINTEXT' },
        { name: 'COMMIT_OID', value: commitOid, type: 'PLAINTEXT' },
        { name: 'ECR_REPO', value: `nsw/${appId}`, type: 'PLAINTEXT' },
        { name: 'CF_ACCOUNT_ID', value: '4219a576830c72b0e6e4ca358e61473a', type: 'PLAINTEXT' },
        { name: 'INSTANCE_TYPE', value: 'lite', type: 'PLAINTEXT' },
        { name: 'DB_SECRET_PATH', value: `/nsw/apps/${appId}/db-url`, type: 'PLAINTEXT' }
      ]);

      // ======================================================================
      // Secret Hygiene Assertions:
      // DSN and CREATE ROLE ... PASSWORD must NEVER appear in:
      // 1. envOverrides
      // 2. deployment_evidence_json
      // 3. build_runs
      // ======================================================================
      const allCbOverrides = awsCalls
        .filter(c => c.target === 'CodeBuild_20161006.StartBuild')
        .flatMap(c => c.body?.environmentVariablesOverride || []);

      for (const override of allCbOverrides) {
        expect(override.value).not.toContain('postgresql://');
        expect(override.value).not.toContain('PASSWORD');
      }

      // Check D1 evidence JSON
      expect(appRow.deployment_evidence_json).not.toContain('postgresql://');
      expect(appRow.deployment_evidence_json).not.toContain('PASSWORD');

      // Check all build_runs rows
      const allBuildRuns = await ctx.d1.prepare('SELECT * FROM build_runs').all();
      for (const run of allBuildRuns.results || []) {
        const runStr = JSON.stringify(run);
        expect(runStr).not.toContain('postgresql://');
        expect(runStr).not.toContain('PASSWORD');
      }
    });
  });
});
