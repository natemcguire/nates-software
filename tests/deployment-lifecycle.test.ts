import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import {
  APP_DEPLOYMENT_STATES,
  canTransitionDeploymentState,
  isValidDeploymentState,
  detectRigRuntime,
  getHonestDeploymentMessage
} from '../src/lib/deploymentLifecycle';
import { hashSessionToken } from '../functions/api/_session';
import * as dropsApi from '../functions/api/drops';
import * as deployApi from '../functions/api/deploy';

describe('Authoritative Deployment Lifecycle Suite', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  // ==========================================================================
  // 1. STATE MODEL & D1 SCHEMA INTEGRITY
  // ==========================================================================
  describe('1. State Model & D1 Schema Integrity', () => {
    it('should define all authoritative deployment states', () => {
      expect(APP_DEPLOYMENT_STATES).toEqual([
        'draft',
        'source_ready',
        'building',
        'deployable',
        'active',
        'failed',
        'retired'
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
      expect(isValidDeploymentState('unknown')).toBe(false);
      expect(isValidDeploymentState('')).toBe(false);
      expect(isValidDeploymentState(null)).toBe(false);
    });

    it('should govern legal and illegal lifecycle transitions', () => {
      // draft -> source_ready (repo/commit created)
      expect(canTransitionDeploymentState('draft', 'source_ready')).toBe(true);
      // source_ready -> building (RIG candidate build)
      expect(canTransitionDeploymentState('source_ready', 'building')).toBe(true);
      // building -> deployable (build passed)
      expect(canTransitionDeploymentState('building', 'deployable')).toBe(true);
      // building -> failed (build failed)
      expect(canTransitionDeploymentState('building', 'failed')).toBe(true);
      // deployable -> active (promoted + healthy)
      expect(canTransitionDeploymentState('deployable', 'active')).toBe(true);
      // active -> retired
      expect(canTransitionDeploymentState('active', 'retired')).toBe(true);
      // failed -> source_ready (re-trigger with new commit)
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
  });

  // ==========================================================================
  // 2. PUBLICATION INVARIANT: CATALOG PUBLICATION != ACTIVE DEPLOYMENT
  // ==========================================================================
  describe('2. Publication Invariant (Catalog Listing != Active Deployment)', () => {
    it('should set deployment_state to draft upon new drop publication', async () => {
      // Create session for user
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

      // Check D1 record: listing_status is active (in catalog), but deployment_state is draft!
      const listing = await ctx.d1.prepare(`
        SELECT id, listing_status, deployment_state, deployment_error FROM app_listings WHERE id = ?
      `).bind(data.id).first<any>();

      expect(listing.listing_status).toBe('active');
      expect(listing.deployment_state).toBe('draft');
      expect(listing.deployment_error).toContain('No deployable revision exists');
    });

    it('should return deployment lifecycle fields in GET /api/drops', async () => {
      const req = new Request('https://nates-software.com/api/drops?sort=newest');
      const res = await dropsApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
      const data: any = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.drops)).toBe(true);

      const gardener = data.drops.find((d: any) => d.id === 'american-gardener');
      expect(gardener).toBeDefined();
      expect(gardener.deploymentState).toBe('draft');
      expect(gardener.deploymentError).toContain('No deployable revision exists for American Gardener');
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
  // 4. RIG RUNTIME DETECTION & MANIFEST OVERRIDES
  // ==========================================================================
  describe('4. RIG Runtime Detection & Manifest Overrides', () => {
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

    it('should detect Python projects from requirements.txt or pyproject.toml', () => {
      const reqFiles = ['requirements.txt', 'main.py'];
      const reqResult = detectRigRuntime(reqFiles);
      expect(reqResult.isDeployable).toBe(true);
      expect(reqResult.detectedType).toBe('python');
      expect(reqResult.plan?.buildCommand).toBe('pip install -r requirements.txt');
      expect(reqResult.plan?.startCommand).toBe('python main.py');
      expect(reqResult.plan?.port).toBe(8000);

      const pyprojectFiles = ['pyproject.toml', 'app.py'];
      const pyprojectResult = detectRigRuntime(pyprojectFiles);
      expect(pyprojectResult.isDeployable).toBe(true);
      expect(pyprojectResult.detectedType).toBe('python');
      expect(pyprojectResult.plan?.startCommand).toBe('python app.py');
    });

    it('should detect Rust projects from Cargo.toml and extract binary name', () => {
      const files = ['Cargo.toml', 'src/main.rs'];
      const contents = {
        'Cargo.toml': `[package]\nname = "fast_vector"\nversion = "0.1.0"`
      };

      const result = detectRigRuntime(files, contents);
      expect(result.isDeployable).toBe(true);
      expect(result.detectedType).toBe('rust');
      expect(result.plan?.buildCommand).toBe('cargo build --release');
      expect(result.plan?.startCommand).toBe('./target/release/fast_vector');
      expect(result.plan?.port).toBe(8080);
    });

    it('should detect Go projects from go.mod', () => {
      const files = ['go.mod', 'main.go'];
      const result = detectRigRuntime(files);
      expect(result.isDeployable).toBe(true);
      expect(result.detectedType).toBe('go');
      expect(result.plan?.buildCommand).toBe('go build -o app .');
      expect(result.plan?.startCommand).toBe('./app');
      expect(result.plan?.port).toBe(8080);
    });

    it('should detect static web projects from index.html', () => {
      const files = ['index.html', 'styles.css', 'app.js'];
      const result = detectRigRuntime(files);
      expect(result.isDeployable).toBe(true);
      expect(result.detectedType).toBe('static');
      expect(result.plan?.port).toBe(80);
      expect(result.plan?.memoryMb).toBe(128);
    });

    it('should apply manifest overrides from slop.json / deploy.json', () => {
      const files = ['package.json', 'slop.json'];
      const contents = {
        'package.json': JSON.stringify({ name: 'node-override' }),
        'slop.json': JSON.stringify({
          buildCommand: 'pnpm build:prod',
          startCommand: 'pnpm serve --port 4000',
          port: 4000,
          healthEndpoint: '/healthz',
          memoryMb: 192,
          env: { NODE_ENV: 'production' },
          volumes: [{ mountPath: '/data', persistence: 'persistent' }]
        })
      };

      const result = detectRigRuntime(files, contents);
      expect(result.isDeployable).toBe(true);
      expect(result.detectedType).toBe('node');
      expect(result.plan?.buildCommand).toBe('pnpm build:prod');
      expect(result.plan?.startCommand).toBe('pnpm serve --port 4000');
      expect(result.plan?.port).toBe(4000);
      expect(result.plan?.healthEndpoint).toBe('/healthz');
      expect(result.plan?.memoryMb).toBe(192);
      expect(result.plan?.env?.NODE_ENV).toBe('production');
      expect(result.plan?.volumes?.[0]?.mountPath).toBe('/data');
      expect(result.plan?.manifestApplied).toBe(true);
    });

    it('should return honest error for unsupported project types', () => {
      const files = ['random_script.rb', 'data.csv', 'notes.txt'];
      const result = detectRigRuntime(files);

      expect(result.isDeployable).toBe(false);
      expect(result.detectedType).toBe('unsupported');
      expect(result.error).toContain('Unsupported project type');
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 5. FAIL-CLOSED DEPLOYMENT LIFECYCLE EXECUTION
  // ==========================================================================
  describe('5. Fail-Closed Deployment Lifecycle Execution', () => {
    it('should fail closed when attempting to deploy an app without GITSMITH source', async () => {
      // Create session for usr_nate (creator of american-gardener)
      const token = 'token_nate_gardener';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      // Attempt deploy on american-gardener (which has no GITSMITH repo/commit)
      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'american-gardener'
        })
      });

      const res = await deployApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data: any = await res.json();

      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('draft');
      expect(data.error).toContain('No deployable revision exists for American Gardener');
      expect(data.evidence.stage).toBe('source_verification');

      // Verify D1 state
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, deployment_error FROM app_listings WHERE id = 'american-gardener'
      `).first<any>();
      expect(app.deployment_state).toBe('draft');
      expect(app.deployment_error).toContain('No deployable revision exists');
    });

    it('should fail closed with specific error when RIG backend is unconfigured', async () => {
      // Setup user + repository + commit in GITSMITH
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_dev', 'dev_user', 'Developer', 'user')
      `).run();
      const token = 'token_dev_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_dev', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();
      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('test-node-app', 'Test Node App', 'Tag', 'Desc', 'usr_dev', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_node_1', 'test-node-app', 'usr_dev', 'test-node-app', 'public', 'sha1', 'refs/heads/main', 'repositories/test-node-app', 'active')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_node_1', 'refs/heads/main', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0')
      `).run();

      // Trigger deploy without RIG_GATEWAY_URL configured
      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'test-node-app',
          files: ['package.json', 'index.js'],
          fileContents: {
            'package.json': JSON.stringify({ name: 'test-node-app', scripts: { start: 'node index.js' } })
          }
        })
      });

      const res = await deployApi.onRequestPost({ request: req, env: { DB: ctx.d1 } });
      const data: any = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('RIG provider gateway is not configured or Docker daemon is unreachable');
      expect(data.evidence.stage).toBe('build');

      // Verify D1 state is failed, NOT active
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, deployment_error, detected_project_type FROM app_listings WHERE id = 'test-node-app'
      `).first<any>();
      expect(app.deployment_state).toBe('failed');
      expect(app.deployment_error).toContain('RIG provider gateway is not configured');
      expect(app.detected_project_type).toBe('node');

      // Verify build_runs record was written with failed status
      const buildRun = await ctx.d1.prepare(`
        SELECT status, exit_code, build_command FROM build_runs WHERE repository_id = 'repo_node_1'
      `).first<any>();
      expect(buildRun).toBeDefined();
      expect(buildRun.status).toBe('failed');
      expect(buildRun.exit_code).toBe(1);
    });

    it('should promote to active only when real RIG provider verifies candidate build', async () => {
      // Setup user + repository + commit in GITSMITH
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_dev2', 'dev_user2', 'Developer 2', 'user')
      `).run();
      const token = 'token_dev2_456';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_dev2', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();
      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('test-verified-app', 'Test Verified App', 'Tag', 'Desc', 'usr_dev2', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_ver_1', 'test-verified-app', 'usr_dev2', 'test-verified-app', 'public', 'sha1', 'refs/heads/main', 'repositories/test-verified-app', 'active')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_ver_1', 'refs/heads/main', 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0')
      `).run();

      // Mock production RIG gateway provider capability probe response
      const mockFetch = async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/capabilities')) {
          return new Response(JSON.stringify({
            apiVersion: 1,
            provider: 'docker',
            liveContainers: true,
            ephemeralCleanup: true,
            authRequired: true,
            limits: { maxMemoryMb: 256, maxTtlSeconds: 3600 },
            isolation: { nonRoot: true, readOnlyRootfs: true, noDockerSocketMount: true }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      };

      const env = {
        DB: ctx.d1,
        RIG_GATEWAY_URL: 'https://rig-gateway.internal:3000',
        RIG_GATEWAY_SERVICE_SECRET: 'super-secret-service-token-that-is-longer-than-32-chars',
        __RIG_GATEWAY_FETCH: mockFetch
      };

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'test-verified-app',
          files: ['package.json', 'index.js'],
          fileContents: {
            'package.json': JSON.stringify({ name: 'test-verified-app', scripts: { start: 'node index.js' } })
          }
        })
      });

      const res = await deployApi.onRequestPost({ request: req, env });
      const data: any = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deploymentState).toBe('active');
      expect(data.activeUrl).toBe('https://test-verified-app.nates-software.com');

      // Verify D1 state is now active with active_deployment_id and active_commit_oid
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, active_commit_oid FROM app_listings WHERE id = 'test-verified-app'
      `).first<any>();
      expect(app.deployment_state).toBe('active');
      expect(app.active_deployment_id).toBe(data.deploymentRevisionId);
      expect(app.active_commit_oid).toBe('f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0');

      // Verify deployment_revisions record exists with status healthy
      const rev = await ctx.d1.prepare(`
        SELECT status, environment, url FROM deployment_revisions WHERE id = ?
      `).bind(data.deploymentRevisionId).first<any>();
      expect(rev.status).toBe('healthy');
      expect(rev.environment).toBe('production');
      expect(rev.url).toBe('https://test-verified-app.nates-software.com');
    });
  });
});
