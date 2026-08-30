import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import {
  APP_DEPLOYMENT_STATES,
  canTransitionDeploymentState,
  isValidDeploymentState,
  detectRigRuntime,
  getHonestDeploymentMessage
} from '../src/lib/deploymentLifecycle';
import { initBareRepo } from '../src/lib/gitsmith/gitStorage';
import { hashSessionToken } from '../functions/api/_session';
import * as dropsApi from '../functions/api/drops';
import * as deployApi from '../functions/api/deploy';
import * as serveApi from '../functions/api/serve';
import * as serveRoute from '../functions/serve/[app]/[[path]]';

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

describe('Authoritative Deployment Lifecycle Suite', () => {
  let ctx: TestD1Context;
  let tempDir: string;
  let reposRoot: string;
  let storage: any;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    tempDir = path.join('/tmp', `gitsmith-deploy-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    reposRoot = path.join(tempDir, 'repos');
    fs.mkdirSync(reposRoot, { recursive: true });
    process.env.GITSMITH_REPOS_ROOT = reposRoot;
    storage = createMemoryR2Bucket();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  // Helper to create a bare repository with real committed files
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

    // Push to bare repo
    execFileSync('git', ['remote', 'add', 'origin', initRes.repoPath], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: workTree, stdio: 'pipe' });

    return { commitOid, repoPath: initRes.repoPath };
  }

  // ==========================================================================
  // 1. STATE MODEL & D1 SCHEMA INTEGRITY
  // ==========================================================================
  describe('1. State Model & D1 Schema Integrity', () => {
    it('should define all authoritative deployment states including client_demo', () => {
      expect(APP_DEPLOYMENT_STATES).toEqual([
        'draft',
        'source_ready',
        'building',
        'deployable',
        'active',
        'failed',
        'retired',
        'client_demo'
      ]);
    });

    it('should validate valid and invalid deployment state strings', () => {
      expect(isValidDeploymentState('draft')).toBe(true);
      expect(isValidDeploymentState('source_ready')).toBe(true);
      expect(isValidDeploymentState('building')).toBe(true);
      expect(isValidDeploymentState('deployable')).toBe(true);
      expect(isValidDeploymentState('active')).toBe(true);
      expect(isValidDeploymentState('failed')).toBe(true);
      expect(isValidDeploymentState('retired')).toBe(true);
      expect(isValidDeploymentState('client_demo')).toBe(true);
      expect(isValidDeploymentState('unknown')).toBe(false);
      expect(isValidDeploymentState('')).toBe(false);
      expect(isValidDeploymentState(null)).toBe(false);
    });

    it('should govern legal and illegal lifecycle transitions', () => {
      expect(canTransitionDeploymentState('draft', 'source_ready')).toBe(true);
      expect(canTransitionDeploymentState('source_ready', 'building')).toBe(true);
      expect(canTransitionDeploymentState('building', 'deployable')).toBe(true);
      expect(canTransitionDeploymentState('building', 'failed')).toBe(true);
      expect(canTransitionDeploymentState('deployable', 'active')).toBe(true);
      expect(canTransitionDeploymentState('active', 'retired')).toBe(true);
      expect(canTransitionDeploymentState('failed', 'source_ready')).toBe(true);

      // Illegal jumps: draft cannot jump directly to active without build and promotion
      expect(canTransitionDeploymentState('draft', 'active')).toBe(false);
      expect(canTransitionDeploymentState('draft', 'deployable')).toBe(false);
      expect(canTransitionDeploymentState('building', 'active')).toBe(false);
    });

    it('should enforce CHECK constraints on app_listings deployment_state in D1', async () => {
      const app = await ctx.d1.prepare(`
        SELECT id, deployment_state, deployment_error FROM app_listings WHERE id = 'american-gardener'
      `).first<{ id: string; deployment_state: string; deployment_error: string }>();

      expect(app).toBeDefined();
      expect(app?.deployment_state).toBe('draft');
      expect(app?.deployment_error).toContain('No deployable revision exists for American Gardener');

      // Reject illegal deployment_state value in SQLite
      await expect(
        ctx.d1.prepare(`
          UPDATE app_listings SET deployment_state = 'invalid_bogus_state' WHERE id = 'american-gardener'
        `).run()
      ).rejects.toThrow(/CHECK constraint failed/);
    });

    it('should ensure no migration seeds active without an active_deployment_id', async () => {
      const activeWithoutRevision = await ctx.d1.prepare(`
        SELECT id, deployment_state, active_deployment_id
        FROM app_listings
        WHERE deployment_state = 'active' AND (active_deployment_id IS NULL OR trim(active_deployment_id) = '')
      `).all();

      expect(activeWithoutRevision.results).toEqual([]);

      // Verify seed client-side demos are marked client_demo, NOT active
      const demos = await ctx.d1.prepare(`
        SELECT id, deployment_state, active_deployment_id
        FROM app_listings
        WHERE id IN ('dronehunter', 'certified-mailer', 'wallart')
      `).all<any>();

      expect(demos.results?.length).toBe(3);
      demos.results?.forEach(d => {
        expect(d.deployment_state).toBe('client_demo');
        expect(d.active_deployment_id).toBeNull();
      });
    });
  });

  // ==========================================================================
  // 2. PUBLICATION INVARIANT & REPUBLISH RESET
  // ==========================================================================
  describe('2. Publication Invariant & Republish Reset', () => {
    it('should set deployment_state to draft upon new drop publication', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_alice', 'alice', 'Alice Maker', 'user')
      `).run();
      const token = 'token_alice_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_alice', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const req = new Request('https://nates-software.com/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: 'Super App',
          tagline: 'Brand new shareware application',
          description: 'A new application submitted to the catalog.',
          version: '1.0.0',
          price: '$20',
          storage: 'Local SQLite'
        })
      });

      const res = await dropsApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data: any = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('draft');

      const listing = await ctx.d1.prepare(`
        SELECT id, listing_status, deployment_state, deployment_error, active_deployment_id FROM app_listings WHERE id = ?
      `).bind(data.id).first<any>();

      expect(listing.listing_status).toBe('active');
      expect(listing.deployment_state).toBe('draft');
      expect(listing.active_deployment_id).toBeNull();
      expect(listing.deployment_error).toContain('No deployable revision exists');
    });

    it('should reset deployment_state and clear active_deployment_id when republishing an active listing', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_bob', 'bob', 'Bob Maker', 'user')
      `).run();
      const token = 'token_bob_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_bob', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      await ctx.d1.prepare(`
        INSERT INTO app_listings (
          id, name, tagline, description, creator_id, version, license, price, storage,
          tags, screenshots, binaries, listing_status, deployment_state, active_deployment_id, active_commit_oid
        ) VALUES (
          'active-republish-app', 'Active Republish App', 'Tag', 'Desc', 'usr_bob', '1.0.0', 'MIT', '$10', 'None',
          '[]', '[]', '{}', 'active', 'active', NULL, 'oid_previous_commit_456'
        )
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_bob_1', 'active-republish-app', 'usr_bob', 'active-republish-app', 'public', 'sha1', 'refs/heads/main', 'repositories/active-republish-app', 'active')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest, exit_code, started_at, finished_at)
        VALUES ('br_bob_1', 'repo_bob_1', 'oid_previous_commit_456', 'verification', 'passed', 'sha256:image', 'npm run build', 'sha256:manifest', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO deployment_revisions (id, app_id, repository_id, commit_oid, build_run_id, environment, revision_number, status, runtime_config_digest, deployed_by_user_id, deployed_at)
        VALUES ('rev_previous_active_123', 'active-republish-app', 'repo_bob_1', 'oid_previous_commit_456', 'br_bob_1', 'production', 1, 'healthy', 'sha256:config', 'usr_bob', CURRENT_TIMESTAMP)
      `).run();

      await ctx.d1.prepare(`
        UPDATE app_listings SET active_deployment_id = 'rev_previous_active_123' WHERE id = 'active-republish-app'
      `).run();

      const before = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, active_commit_oid FROM app_listings WHERE id = 'active-republish-app'
      `).first<any>();
      expect(before.deployment_state).toBe('active');
      expect(before.active_deployment_id).toBe('rev_previous_active_123');

      const republishReq = new Request('https://nates-software.com/api/drops', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          id: 'active-republish-app',
          name: 'Active Republish App',
          version: '1.1.0',
          tagline: 'Updated tagline for v1.1.0',
          price: '$15'
        })
      });

      const res = await dropsApi.onRequestPost({ request: republishReq, env: { DB: ctx.d1 } });
      expect(res.status).toBe(200);

      const after = await ctx.d1.prepare(`
        SELECT version, deployment_state, active_deployment_id, active_commit_oid, deployment_error
        FROM app_listings WHERE id = 'active-republish-app'
      `).first<any>();

      expect(after.version).toBe('1.1.0');
      expect(after.deployment_state).toBe('draft');
      expect(after.active_deployment_id).toBeNull();
      expect(after.active_commit_oid).toBeNull();
      expect(after.deployment_error).toContain('No deployable revision exists');
    });
  });

  // ==========================================================================
  // 3. HONEST ERROR SURFACE
  // ==========================================================================
  describe('3. Honest Error Surface vs Generic Fallback', () => {
    it('should produce specific honest message for app with no deployable revision', () => {
      const message = getHonestDeploymentMessage({
        id: 'american-gardener',
        name: 'American Gardener',
        deploymentState: 'draft',
        deploymentError: 'No deployable revision exists for American Gardener. Source has not been imported into GITSMITH and built by RIG.'
      });

      expect(message.headline).toBe('No deployable revision exists for American Gardener.');
      expect(message.subtext).toContain('Source has not been imported into GITSMITH and built by RIG.');
      expect(message.state).toBe('draft');
      expect(message.guidance.length).toBeGreaterThan(0);
      expect(message.guidance[0]).toContain('git remote add gitsmith');
    });

    it('should produce specific error message and evidence for failed deployment', () => {
      const message = getHonestDeploymentMessage({
        id: 'bad-app',
        name: 'Bad App',
        deploymentState: 'failed',
        deploymentError: 'Candidate build failed: Cargo.toml parse error at line 14.'
      });

      expect(message.headline).toBe('Deployment failed for Bad App.');
      expect(message.subtext).toBe('Candidate build failed: Cargo.toml parse error at line 14.');
      expect(message.state).toBe('failed');
    });

    it('should produce honest message for client_demo state', () => {
      const message = getHonestDeploymentMessage({
        id: 'wallart',
        name: 'WallArt Canvas Pro',
        deploymentState: 'client_demo'
      });

      expect(message.headline).toContain('running as a client-side demo');
      expect(message.subtext).toContain('without a backend deployment revision');
      expect(message.state).toBe('client_demo');
    });

    it('should return honest diagnostic payload from GET /api/deploy', async () => {
      const req = new Request('https://nates-software.com/api/deploy?appId=american-gardener');
      const res = await deployApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data: any = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.appId).toBe('american-gardener');
      expect(data.deploymentState).toBe('draft');
      expect(data.isVerifiedActive).toBe(false);
      expect(data.honestMessage.headline).toBe('No deployable revision exists for American Gardener.');
      expect(data.honestMessage.subtext).toContain('Source has not been imported into GITSMITH and built by RIG.');
    });
  });

  // ==========================================================================
  // 4. RIG RUNTIME DETECTION & COMMITTED SOURCE INSPECTION
  // ==========================================================================
  describe('4. RIG Runtime Detection & Committed Source Inspection', () => {
    it('should detect Node.js projects from package.json', () => {
      const files = ['package.json', 'src/index.js'];
      const contents = {
        'package.json': JSON.stringify({
          name: 'my-node-app',
          scripts: { start: 'node src/index.js', build: 'tsc' }
        })
      };

      const result = detectRigRuntime(files, contents);
      expect(result.isDeployable).toBe(true);
      expect(result.detectedType).toBe('node');
      expect(result.plan?.buildCommand).toBe('npm run build');
      expect(result.plan?.startCommand).toBe('npm start');
      expect(result.plan?.port).toBe(3000);
      expect(result.plan?.memoryMb).toBe(256);
    });

    it('should detect Dockerfile projects and extract exposed port', () => {
      const files = ['Dockerfile', 'app.bin'];
      const contents = {
        'Dockerfile': `FROM alpine:latest\nEXPOSE 9000\nCMD ["/app.bin"]`
      };

      const result = detectRigRuntime(files, contents);
      expect(result.isDeployable).toBe(true);
      expect(result.detectedType).toBe('docker');
      expect(result.plan?.port).toBe(9000);
      expect(result.plan?.buildCommand).toContain('docker build');
    });

    it('should detect static web projects from index.html', () => {
      const files = ['index.html', 'styles.css', 'app.js'];
      const result = detectRigRuntime(files);
      expect(result.isDeployable).toBe(true);
      expect(result.detectedType).toBe('static');
      expect(result.plan?.port).toBe(80);
      expect(result.plan?.memoryMb).toBe(128);
    });

    it('should fail closed when committed tree contains unsupported files', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_hs_dev', 'hsdev', 'Haskell Dev', 'user')
      `).run();
      const token = 'token_hs_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_hs_dev', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/unsupported-repo';
      const { commitOid } = createCommittedRepo(storageKey, {
        'Main.hs': 'main = putStrLn "Hello"\n',
        'project.cabal': 'name: unsupported\n'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('unsupported-app', 'Unsupported App', 'Tag', 'Desc', 'usr_hs_dev', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_hs_1', 'unsupported-app', 'usr_hs_dev', 'unsupported-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_hs_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'unsupported-app',
          files: ['index.html'] // fake caller metadata should be ignored!
        })
      });

      const res = await deployApi.onRequestPost({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
      const data: any = await res.json();

      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Unsupported project type');
      expect(data.evidence.stage).toBe('detection');
    });
  });

  // ==========================================================================
  // 5. REAL RIG BUILD -> SMOKE -> PROMOTE -> SERVE PIPELINE (PHASE 3)
  // ==========================================================================
  describe('5. Real RIG Build -> Smoke -> Promote -> Serve Pipeline', () => {
    it('should build, smoke-test, promote static app to active with real deployment_revisions row and serve from R2', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_gardener', 'gardener', 'Gardener Maker', 'user')
      `).run();
      const token = 'token_gardener_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_gardener', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/american-gardener';
      const { commitOid } = createCommittedRepo(storageKey, {
        'index.html': '<!DOCTYPE html><html><head><title>American Gardener</title></head><body><h1>Gardening Assistant</h1></body></html>',
        'styles.css': 'body { background: #2d5a27; color: white; }',
        'app.js': 'console.log("American Gardener loaded");'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('american-gardener-app', 'American Gardener App', 'Tag', 'Desc', 'usr_gardener', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_ag_1', 'american-gardener-app', 'usr_gardener', 'american-gardener-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_ag_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      // Trigger deploy action
      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'american-gardener-app'
        })
      });

      // Mock only the external RIG gateway build boundary with real static artifact evidence
      const mockExternalRigGatewayBuild = async (params: any) => {
        expect(params.appId).toBe('american-gardener-app');
        expect(params.commitOid).toBe(commitOid);
        expect(params.plan.detectedType).toBe('static');

        return {
          success: true,
          exitCode: 0,
          output: '[RIG] Static entrypoint index.html verified. Smoke test passed.',
          artifactDigest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          artifactKind: 'static',
          staticFiles: [
            {
              path: 'index.html',
              contentBase64: Buffer.from('<!DOCTYPE html><html><head><title>American Gardener</title></head><body><h1>Gardening Assistant</h1></body></html>').toString('base64'),
              mediaType: 'text/html; charset=utf-8',
              sizeBytes: 104,
              sha256: 'sha256:indexhash123'
            },
            {
              path: 'styles.css',
              contentBase64: Buffer.from('body { background: #2d5a27; }').toString('base64'),
              mediaType: 'text/css; charset=utf-8',
              sizeBytes: 30,
              sha256: 'sha256:csshash123'
            }
          ],
          smokeCheck: {
            passed: true,
            statusCode: 200,
            durationMs: 15,
            responseSnippet: '<!DOCTYPE html><html><head><title>American Gardener</title>'
          },
          durationMs: 120
        };
      };

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          __RIG_DEPLOY_EXECUTOR: mockExternalRigGatewayBuild
        }
      });

      const data: any = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('active');
      expect(data.isVerifiedActive).toBe(true);
      expect(data.activeDeploymentId).toBeDefined();
      expect(data.activeCommitOid).toBe(commitOid);
      expect(data.artifactDigest).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(data.smokeCheck.passed).toBe(true);

      // Verify D1 records
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, active_commit_oid, deployment_error, deployment_evidence_json
        FROM app_listings WHERE id = 'american-gardener-app'
      `).first<any>();

      expect(app.deployment_state).toBe('active');
      expect(app.active_deployment_id).toBe(data.activeDeploymentId);
      expect(app.active_commit_oid).toBe(commitOid);
      expect(app.deployment_error).toBeNull();

      const rev = await ctx.d1.prepare(`
        SELECT id, app_id, repository_id, commit_oid, status, environment, revision_number, url, runtime_config_digest
        FROM deployment_revisions WHERE id = ?
      `).bind(data.activeDeploymentId).first<any>();

      expect(rev).toBeDefined();
      expect(rev.app_id).toBe('american-gardener-app');
      expect(rev.status).toBe('healthy');
      expect(rev.environment).toBe('production');
      expect(rev.revision_number).toBe(1);
      expect(rev.runtime_config_digest).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

      const buildRun = await ctx.d1.prepare(`
        SELECT id, status, exit_code, result_digest FROM build_runs WHERE repository_id = 'repo_ag_1'
      `).first<any>();
      expect(buildRun.status).toBe('passed');
      expect(buildRun.exit_code).toBe(0);
      expect(buildRun.result_digest).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

      // Verify GET /api/deploy query verifies app IS verified active
      const getReq = new Request('https://nates-software.com/api/deploy?appId=american-gardener-app');
      const getRes = await deployApi.onRequestGet({ request: getReq, env: { DB: ctx.d1 } });
      const getData: any = await getRes.json();

      expect(getData.isVerifiedActive).toBe(true);
      expect(getData.deploymentState).toBe('active');
      expect(getData.activeDeploymentId).toBe(data.activeDeploymentId);
      expect(getData.activeUrl).toBe('https://american-gardener-app.nates-software.com');

      // Verify serving via /api/serve from R2 STORAGE
      const serveReq = new Request('https://nates-software.com/api/serve?app=american-gardener-app&path=index.html');
      const serveRes = await serveApi.onRequestGet({ request: serveReq, env: { DB: ctx.d1, STORAGE: storage } });
      expect(serveRes.status).toBe(200);
      expect(serveRes.headers.get('Content-Type')).toContain('text/html');
      const htmlText = await serveRes.text();
      expect(htmlText).toContain('American Gardener');

      // Verify direct route /serve/american-gardener-app/index.html
      const directServeRes = await serveRoute.onRequestGet({
        params: { app: 'american-gardener-app', path: 'index.html' },
        env: { DB: ctx.d1, STORAGE: storage }
      });
      expect(directServeRes.status).toBe(200);
      const directText = await directServeRes.text();
      expect(directText).toContain('American Gardener');
    });

    it('should fail closed when candidate container build fails, recording real stderr and preventing active state', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_broken', 'broken', 'Broken Maker', 'user')
      `).run();
      const token = 'token_broken_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_broken', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/broken-build-app';
      const { commitOid } = createCommittedRepo(storageKey, {
        'package.json': JSON.stringify({ name: 'broken-app', scripts: { build: 'tsc --noEmit', start: 'node index.js' } }),
        'index.ts': 'const invalid: number = "cannot assign string to number";'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('broken-app', 'Broken Build App', 'Tag', 'Desc', 'usr_broken', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_brk_1', 'broken-app', 'usr_broken', 'broken-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_brk_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'broken-app'
        })
      });

      // Mock only the external RIG gateway build boundary to report build failure
      const mockFailingRigBuild = async () => ({
        success: false,
        exitCode: 2,
        output: 'error TS2322: Type "string" is not assignable to type "number".\nFound 1 error.',
        artifactDigest: '',
        artifactKind: 'bundle',
        smokeCheck: { passed: false, statusCode: 0, durationMs: 0, error: 'Build failed before smoke check' },
        durationMs: 450,
        error: 'Build command failed with exit code 2: error TS2322: Type "string" is not assignable to type "number".'
      });

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          __RIG_DEPLOY_EXECUTOR: mockFailingRigBuild
        }
      });

      const data: any = await res.json();

      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Build command failed with exit code 2');
      expect(data.evidence.stage).toBe('build');
      expect(data.evidence.exitCode).toBe(2);

      // Verify D1 records: failed state, active_deployment_id IS NULL
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, deployment_error, deployment_evidence_json
        FROM app_listings WHERE id = 'broken-app'
      `).first<any>();

      expect(app.deployment_state).toBe('failed');
      expect(app.active_deployment_id).toBeNull();
      expect(app.deployment_error).toContain('Build command failed with exit code 2');

      const buildRun = await ctx.d1.prepare(`
        SELECT status, exit_code FROM build_runs WHERE repository_id = 'repo_brk_1'
      `).first<any>();
      expect(buildRun.status).toBe('failed');
      expect(buildRun.exit_code).toBe(2);

      // Verify no deployment_revisions were created
      const revs = await ctx.d1.prepare(`
        SELECT count(*) AS c FROM deployment_revisions WHERE app_id = 'broken-app'
      `).first<any>('c');
      expect(revs).toBe(0);

      // Verify GET /api/deploy returns failed state
      const getRes = await deployApi.onRequestGet({
        request: new Request('https://nates-software.com/api/deploy?appId=broken-app'),
        env: { DB: ctx.d1 }
      });
      const getData: any = await getRes.json();
      expect(getData.deploymentState).toBe('failed');
      expect(getData.isVerifiedActive).toBe(false);
      expect(getData.activeUrl).toBeNull();
    });

    it('should fail closed when smoke check fails even if build command succeeds', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_smoke_fail', 'smokefail', 'Smoke Fail Maker', 'user')
      `).run();
      const token = 'token_smoke_fail_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_smoke_fail', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/smoke-fail-app';
      const { commitOid } = createCommittedRepo(storageKey, {
        'package.json': JSON.stringify({ name: 'smoke-fail-app', scripts: { build: 'echo "Built"', start: 'node app.js' } }),
        'app.js': 'console.log("No index.html generated");'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('smoke-fail-app', 'Smoke Fail App', 'Tag', 'Desc', 'usr_smoke_fail', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_smk_1', 'smoke-fail-app', 'usr_smoke_fail', 'smoke-fail-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_smk_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'smoke-fail-app'
        })
      });

      // Build succeeds but smoke check fails
      const mockSmokeFailingRigBuild = async () => ({
        success: false,
        exitCode: 0,
        output: 'Build completed successfully.',
        artifactDigest: 'sha256:incomplete_digest',
        artifactKind: 'bundle',
        smokeCheck: {
          passed: false,
          statusCode: 500,
          durationMs: 80,
          error: 'Smoke check probe failed: HTTP 500 Internal Server Error'
        },
        durationMs: 250,
        error: 'Smoke check probe failed: HTTP 500 Internal Server Error'
      });

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          __RIG_DEPLOY_EXECUTOR: mockSmokeFailingRigBuild
        }
      });

      const data: any = await res.json();

      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Smoke check probe failed');
      expect(data.evidence.stage).toBe('smoke_check');

      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id FROM app_listings WHERE id = 'smoke-fail-app'
      `).first<any>();
      expect(app.deployment_state).toBe('failed');
      expect(app.active_deployment_id).toBeNull();
    });

    it('should transition server apps to deployable with truthful evidence when ingress proxying is unprovisioned', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_mailer', 'mailer', 'Mailer Maker', 'user')
      `).run();
      const token = 'token_mailer_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_mailer', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/certified-mailer';
      const { commitOid } = createCommittedRepo(storageKey, {
        'requirements.txt': 'fastapi==0.110.0\nuvicorn==0.28.0\n',
        'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/healthz")\ndef health(): return {"status": "ok"}\n'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('certified-mailer-app', 'Certified Mailer App', 'Tag', 'Desc', 'usr_mailer', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_cm_1', 'certified-mailer-app', 'usr_mailer', 'certified-mailer-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_cm_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'certified-mailer-app'
        })
      });

      // Server app build succeeds with artifact digest
      const mockServerRigBuild = async (params: any) => {
        expect(params.plan.detectedType).toBe('python');
        return {
          success: true,
          exitCode: 0,
          output: '[RIG] Python dependencies installed. Verified entrypoint main.py.',
          artifactDigest: 'sha256:python_artifact_digest_123',
          artifactKind: 'bundle',
          smokeCheck: {
            passed: true,
            statusCode: 200,
            durationMs: 25,
            responseSnippet: 'Verified entrypoint main.py for python'
          },
          durationMs: 500
        };
      };

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          __RIG_DEPLOY_EXECUTOR: mockServerRigBuild
        }
      });

      const data: any = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('deployable');
      expect(data.isDeployable).toBe(true);
      expect(data.message).toContain('Server applications require hostname-to-container ingress proxying');

      // Verify D1 records: deployable state, active_deployment_id is NULL (never fakes active without serve)
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, deployment_error FROM app_listings WHERE id = 'certified-mailer-app'
      `).first<any>();

      expect(app.deployment_state).toBe('deployable');
      expect(app.active_deployment_id).toBeNull();
      expect(app.deployment_error).toContain('Server applications require hostname-to-container ingress proxying');

      // Verify build_runs was recorded as passed with real digest
      const buildRun = await ctx.d1.prepare(`
        SELECT status, exit_code, result_digest FROM build_runs WHERE repository_id = 'repo_cm_1'
      `).first<any>();
      expect(buildRun.status).toBe('passed');
      expect(buildRun.exit_code).toBe(0);
      expect(buildRun.result_digest).toBe('sha256:python_artifact_digest_123');
    });

    it('should refuse activation and fail closed when R2 STORAGE is absent, leaving no healthy revision and deployment_state=failed', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_nostorage', 'nostorage', 'No Storage Maker', 'user')
      `).run();
      const token = 'token_nostorage_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nostorage', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/no-storage-app';
      const { commitOid } = createCommittedRepo(storageKey, {
        'index.html': '<h1>No Storage App</h1>',
        'styles.css': 'body { color: red; }'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('no-storage-app', 'No Storage App', 'Tag', 'Desc', 'usr_nostorage', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_ns_1', 'no-storage-app', 'usr_nostorage', 'no-storage-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_ns_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'no-storage-app'
        })
      });

      const mockStaticBuild = async () => ({
        success: true,
        exitCode: 0,
        output: 'Build & smoke succeeded',
        artifactDigest: 'sha256:nostorage_digest_123',
        artifactKind: 'static',
        staticFiles: [
          {
            path: 'index.html',
            contentBase64: Buffer.from('<h1>No Storage App</h1>').toString('base64'),
            mediaType: 'text/html; charset=utf-8',
            sizeBytes: 23,
            sha256: 'sha256:ns_index'
          }
        ],
        smokeCheck: { passed: true, statusCode: 200, durationMs: 10, responseSnippet: '<h1>No Storage App</h1>' },
        durationMs: 100
      });

      // Execute with STORAGE undefined in env
      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: undefined,
          GITSMITH_REPOS_ROOT: reposRoot,
          __RIG_DEPLOY_EXECUTOR: mockStaticBuild
        }
      });

      const data: any = await res.json();

      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Artifact storage service (R2 STORAGE) is unavailable');
      expect(data.evidence.stage).toBe('storage_publication');

      // Verify D1: failed state, active_deployment_id is NULL, no revisions inserted
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, deployment_error, deployment_evidence_json
        FROM app_listings WHERE id = 'no-storage-app'
      `).first<any>();

      expect(app.deployment_state).toBe('failed');
      expect(app.active_deployment_id).toBeNull();
      expect(app.deployment_error).toContain('Artifact storage service (R2 STORAGE) is unavailable');

      const revCount = await ctx.d1.prepare(`
        SELECT count(*) AS c FROM deployment_revisions WHERE app_id = 'no-storage-app'
      `).first<any>('c');
      expect(revCount).toBe(0);

      const buildRun = await ctx.d1.prepare(`
        SELECT status, exit_code FROM build_runs WHERE repository_id = 'repo_ns_1'
      `).first<any>();
      expect(buildRun.status).toBe('failed');
      expect(buildRun.exit_code).toBe(1);
    });

    it('should refuse activation and fail closed when R2 STORAGE.put fails during publication', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_putfail', 'putfail', 'Put Fail Maker', 'user')
      `).run();
      const token = 'token_putfail_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_putfail', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/put-fail-app';
      const { commitOid } = createCommittedRepo(storageKey, {
        'index.html': '<h1>Put Fail App</h1>'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('put-fail-app', 'Put Fail App', 'Tag', 'Desc', 'usr_putfail', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_pf_1', 'put-fail-app', 'usr_putfail', 'put-fail-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_pf_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'put-fail-app'
        })
      });

      const mockStaticBuild = async () => ({
        success: true,
        exitCode: 0,
        output: 'Build & smoke succeeded',
        artifactDigest: 'sha256:putfail_digest_123',
        artifactKind: 'static',
        staticFiles: [
          {
            path: 'index.html',
            contentBase64: Buffer.from('<h1>Put Fail App</h1>').toString('base64'),
            mediaType: 'text/html; charset=utf-8',
            sizeBytes: 22,
            sha256: 'sha256:pf_index'
          }
        ],
        smokeCheck: { passed: true, statusCode: 200, durationMs: 10, responseSnippet: '<h1>Put Fail App</h1>' },
        durationMs: 100
      });

      const failingStorage = {
        put: async () => {
          throw new Error('R2 write quota exceeded / network timeout');
        },
        get: async () => null
      };

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: failingStorage,
          GITSMITH_REPOS_ROOT: reposRoot,
          __RIG_DEPLOY_EXECUTOR: mockStaticBuild
        }
      });

      const data: any = await res.json();

      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Storage upload failed');
      expect(data.evidence.stage).toBe('storage_publication');

      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, deployment_error
        FROM app_listings WHERE id = 'put-fail-app'
      `).first<any>();

      expect(app.deployment_state).toBe('failed');
      expect(app.active_deployment_id).toBeNull();
      expect(app.deployment_error).toContain('Storage upload failed');

      const revCount = await ctx.d1.prepare(`
        SELECT count(*) AS c FROM deployment_revisions WHERE app_id = 'put-fail-app'
      `).first<any>('c');
      expect(revCount).toBe(0);
    });

    it('should persist thrown failures as deployment_state=failed in D1 with evidence and mark build_run failed instead of sticking in building', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_crash', 'crash', 'Crash Maker', 'user')
      `).run();
      const token = 'token_crash_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_crash', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/crash-app';
      const { commitOid } = createCommittedRepo(storageKey, {
        'index.html': '<h1>Crash App</h1>'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('crash-app', 'Crash App', 'Tag', 'Desc', 'usr_crash', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_cr_1', 'crash-app', 'usr_crash', 'crash-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_cr_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'crash-app'
        })
      });

      // Executor throws an unhandled exception (e.g. docker daemon panic / SIGPIPE)
      const mockThrowingRigBuild = async () => {
        throw new Error('Docker daemon connection reset by peer during build execution');
      };

      const res = await deployApi.onRequestPost({
        request: req,
        env: {
          DB: ctx.d1,
          STORAGE: storage,
          GITSMITH_REPOS_ROOT: reposRoot,
          __RIG_DEPLOY_EXECUTOR: mockThrowingRigBuild
        }
      });

      const data: any = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Docker daemon connection reset by peer');
      expect(data.evidence.stage).toBe('execution_error');

      // CRITICAL INVARIANT: App listing must NOT be left in 'building' or 'running'!
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, deployment_error, deployment_evidence_json
        FROM app_listings WHERE id = 'crash-app'
      `).first<any>();

      expect(app.deployment_state).toBe('failed');
      expect(app.active_deployment_id).toBeNull();
      expect(app.deployment_error).toContain('Docker daemon connection reset by peer');

      const buildRun = await ctx.d1.prepare(`
        SELECT status, exit_code FROM build_runs WHERE repository_id = 'repo_cr_1'
      `).first<any>();
      expect(buildRun.status).toBe('failed');
      expect(buildRun.exit_code).toBe(1);

      const revCount = await ctx.d1.prepare(`
        SELECT count(*) AS c FROM deployment_revisions WHERE app_id = 'crash-app'
      `).first<any>('c');
      expect(revCount).toBe(0);
    });

    it('should strictly enforce that active state requires a real healthy deployment revision', async () => {
      // Query all listings marked active
      const activeRows = await ctx.d1.prepare(`
        SELECT a.id, a.deployment_state, a.active_deployment_id, dr.id AS revisionId, dr.status AS revisionStatus
        FROM app_listings a
        LEFT JOIN deployment_revisions dr ON dr.id = a.active_deployment_id
        WHERE a.deployment_state = 'active'
      `).all<any>();

      activeRows.results?.forEach(row => {
        expect(row.active_deployment_id).not.toBeNull();
        expect(row.active_deployment_id).toBeTruthy();
        expect(row.revisionId).toBe(row.active_deployment_id);
        expect(row.revisionStatus).toBe('healthy');
      });
    });
  });
});
