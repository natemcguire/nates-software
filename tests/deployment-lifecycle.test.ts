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

describe('Authoritative Deployment Lifecycle Suite', () => {
  let ctx: TestD1Context;
  let tempDir: string;
  let reposRoot: string;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    tempDir = path.join('/tmp', `gitsmith-deploy-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    reposRoot = path.join(tempDir, 'repos');
    fs.mkdirSync(reposRoot, { recursive: true });
    process.env.GITSMITH_REPOS_ROOT = reposRoot;
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

      // Check D1 record: listing_status is active (in catalog), but deployment_state is draft!
      const listing = await ctx.d1.prepare(`
        SELECT id, listing_status, deployment_state, deployment_error, active_deployment_id FROM app_listings WHERE id = ?
      `).bind(data.id).first<any>();

      expect(listing.listing_status).toBe('active');
      expect(listing.deployment_state).toBe('draft');
      expect(listing.active_deployment_id).toBeNull();
      expect(listing.deployment_error).toContain('No deployable revision exists');
    });

    it('should reset deployment_state and clear active_deployment_id when republishing an active listing', async () => {
      // Setup existing user and app that was previously active
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_bob', 'bob', 'Bob Maker', 'user')
      `).run();
      const token = 'token_bob_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_bob', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      // 1. Insert app_listings first with active_deployment_id NULL
      await ctx.d1.prepare(`
        INSERT INTO app_listings (
          id, name, tagline, description, creator_id, version, license, price, storage,
          tags, screenshots, binaries, listing_status, deployment_state, active_deployment_id, active_commit_oid
        ) VALUES (
          'active-republish-app', 'Active Republish App', 'Tag', 'Desc', 'usr_bob', '1.0.0', 'MIT', '$10', 'None',
          '[]', '[]', '{}', 'active', 'active', NULL, 'oid_previous_commit_456'
        )
      `).run();

      // 2. Insert repository referencing app_listings
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_bob_1', 'active-republish-app', 'usr_bob', 'active-republish-app', 'public', 'sha1', 'refs/heads/main', 'repositories/active-republish-app', 'active')
      `).run();

      // 3. Insert build_run referencing repository
      await ctx.d1.prepare(`
        INSERT INTO build_runs (id, repository_id, commit_oid, purpose, status, runner_image_digest, build_command, source_manifest_digest, exit_code, started_at, finished_at)
        VALUES ('br_bob_1', 'repo_bob_1', 'oid_previous_commit_456', 'verification', 'passed', 'sha256:image', 'npm run build', 'sha256:manifest', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run();

      // 4. Insert deployment_revisions referencing app_listings, repository, build_run, user
      await ctx.d1.prepare(`
        INSERT INTO deployment_revisions (id, app_id, repository_id, commit_oid, build_run_id, environment, revision_number, status, runtime_config_digest, deployed_by_user_id, deployed_at)
        VALUES ('rev_previous_active_123', 'active-republish-app', 'repo_bob_1', 'oid_previous_commit_456', 'br_bob_1', 'production', 1, 'healthy', 'sha256:config', 'usr_bob', CURRENT_TIMESTAMP)
      `).run();

      // 5. Update app_listings to reference deployment_revision
      await ctx.d1.prepare(`
        UPDATE app_listings SET active_deployment_id = 'rev_previous_active_123' WHERE id = 'active-republish-app'
      `).run();

      // Verify app was active
      const before = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, active_commit_oid FROM app_listings WHERE id = 'active-republish-app'
      `).first<any>();
      expect(before.deployment_state).toBe('active');
      expect(before.active_deployment_id).toBe('rev_previous_active_123');

      // Republish a new version (1.1.0)
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
      const data: any = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify that deployment_state has been reset to draft and active_deployment_id is cleared
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
  // 5. COMMITTED SOURCE INSPECTION & RUNTIME DETECTION
  // ==========================================================================
  describe('5. Committed Source Tree Inspection vs Request Metadata', () => {
    it('should detect project type directly from the committed Git tree when files are omitted from request', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_python_dev', 'pydev', 'Python Dev', 'user')
      `).run();
      const token = 'token_pydev_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_python_dev', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      // Create a real bare repo on disk with committed Python source
      const storageKey = 'repositories/python-demo-app';
      const { commitOid } = createCommittedRepo(storageKey, {
        'requirements.txt': 'fastapi==0.110.0\nuvicorn==0.28.0\n',
        'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/")\ndef root(): return {"ok": True}\n'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('python-demo-app', 'Python Demo App', 'Tag', 'Desc', 'usr_python_dev', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_py_1', 'python-demo-app', 'usr_python_dev', 'python-demo-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_py_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      // Call /api/deploy with NO files provided in request body
      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'python-demo-app'
          // files omitted! Must read from committed git tree
        })
      });

      const res = await deployApi.onRequestPost({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
      const data: any = await res.json();

      // RIG pipeline is uncommissioned, so it should fail closed at promotion stage with 503,
      // but project type MUST be detected as python from the committed tree!
      expect(res.status).toBe(503);
      expect(data.deploymentState).toBe('source_ready');
      expect(data.error).toContain('Deployment pipeline is not yet commissioned');
      expect(data.evidence.detectedType).toBe('python');
      expect(data.evidence.plan.startCommand).toBe('python main.py');

      const app = await ctx.d1.prepare(`
        SELECT detected_project_type, deployment_plan_json FROM app_listings WHERE id = 'python-demo-app'
      `).first<any>();
      expect(app.detected_project_type).toBe('python');
    });

    it('should fail closed when committed tree contains unsupported files, even if request provides fake index.html', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_haskell_dev', 'hsdev', 'Haskell Dev', 'user')
      `).run();
      const token = 'token_hsdev_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_haskell_dev', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      // Create a real bare repo on disk with unsupported source
      const storageKey = 'repositories/unsupported-repo';
      const { commitOid } = createCommittedRepo(storageKey, {
        'Main.hs': 'main = putStrLn "Hello"\n',
        'project.cabal': 'name: unsupported\n'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('unsupported-app', 'Unsupported App', 'Tag', 'Desc', 'usr_haskell_dev', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_hs_1', 'unsupported-app', 'usr_haskell_dev', 'unsupported-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_hs_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      // Caller tries to bypass unsupported detection by passing fake files: ['index.html']
      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'unsupported-app',
          files: ['index.html'] // fake caller metadata! Must be ignored in favor of committed tree.
        })
      });

      const res = await deployApi.onRequestPost({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
      const data: any = await res.json();

      expect(res.status).toBe(422);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('failed');
      expect(data.error).toContain('Unsupported project type');
      expect(data.evidence.stage).toBe('detection');

      const app = await ctx.d1.prepare(`
        SELECT deployment_state, detected_project_type FROM app_listings WHERE id = 'unsupported-app'
      `).first<any>();
      expect(app.deployment_state).toBe('failed');
      expect(app.detected_project_type).toBe('unsupported');
    });
  });

  // ==========================================================================
  // 5. FAIL-CLOSED DEPLOYMENT & PROMOTION (HONEST UNCOMMISSIONED PIPELINE)
  // ==========================================================================
  describe('5. Fail-Closed Deployment & Promotion Invariant', () => {
    it('should fail closed with 503 and truthful message on deploy action, landing in source_ready with evidence', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_node_dev', 'nodedev', 'Node Developer', 'user')
      `).run();
      const token = 'token_node_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_node_dev', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/node-failclosed-app';
      const { commitOid } = createCommittedRepo(storageKey, {
        'package.json': JSON.stringify({ name: 'node-failclosed-app', scripts: { start: 'node server.js' } }),
        'server.js': 'console.log("Starting server");\n'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('node-failclosed-app', 'Node FailClosed App', 'Tag', 'Desc', 'usr_node_dev', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_fc_1', 'node-failclosed-app', 'usr_node_dev', 'node-failclosed-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_fc_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'deploy',
          appId: 'node-failclosed-app'
        })
      });

      const res = await deployApi.onRequestPost({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
      const data: any = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('source_ready');
      expect(data.error).toBe(
        "Deployment pipeline is not yet commissioned. No application can be promoted to 'active' until (1) a RIG deploy-build job builds and smoke-tests the pinned commit, and (2) hostname-to-container serving is provisioned."
      );
      expect(data.evidence.stage).toBe('promotion');
      expect(data.evidence.detectedType).toBe('node');
      expect(data.evidence.commitOid).toBe(commitOid);

      // Verify D1 state: source_ready, active_deployment_id is NULL, active_commit_oid is set
      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id, active_commit_oid, deployment_error, deployment_evidence_json FROM app_listings WHERE id = 'node-failclosed-app'
      `).first<any>();
      expect(app.deployment_state).toBe('source_ready');
      expect(app.active_deployment_id).toBeNull();
      expect(app.active_commit_oid).toBe(commitOid);
      expect(app.deployment_error).toContain('Deployment pipeline is not yet commissioned');

      // GET /api/deploy query verifies app is NOT active
      const getReq = new Request('https://nates-software.com/api/deploy?appId=node-failclosed-app');
      const getRes = await deployApi.onRequestGet({ request: getReq, env: { DB: ctx.d1 } });
      const getData: any = await getRes.json();

      expect(getData.isVerifiedActive).toBe(false);
      expect(getData.deploymentState).toBe('source_ready');
      expect(getData.activeUrl).toBeNull();
      expect(getData.activeDeploymentId).toBeNull();
      expect(getData.activeCommitOid).toBe(commitOid);
      expect(getData.honestMessage.headline).toBe('Source repository is ready for Node FailClosed App.');
      expect(getData.honestMessage.subtext).toContain('Deployment pipeline is not yet commissioned');
    });

    it('should fail closed with 503 and truthful message on promote action as well', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name, role) VALUES ('usr_prom_dev', 'promdev', 'Promote Developer', 'user')
      `).run();
      const token = 'token_prom_123';
      const tokenHash = await hashSessionToken(token);
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_prom_dev', datetime('now', '+1 hour'))
      `).bind(tokenHash).run();

      const storageKey = 'repositories/promote-failclosed-app';
      const { commitOid } = createCommittedRepo(storageKey, {
        'package.json': JSON.stringify({ name: 'promote-failclosed-app', scripts: { start: 'node server.js' } }),
        'server.js': 'console.log("Starting server");\n'
      });

      await ctx.d1.prepare(`
        INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, deployment_state)
        VALUES ('promote-failclosed-app', 'Promote FailClosed App', 'Tag', 'Desc', 'usr_prom_dev', 'v1.0.0', 'MIT', '$10', 'None', '[]', '[]', '{}', 'draft')
      `).run();
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, app_id, owner_user_id, slug, visibility, object_format, default_ref, storage_key, status)
        VALUES ('repo_prom_1', 'promote-failclosed-app', 'usr_prom_dev', 'promote-failclosed-app', 'public', 'sha1', 'refs/heads/main', ?, 'active')
      `).bind(storageKey).run();
      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid)
        VALUES ('repo_prom_1', 'refs/heads/main', ?)
      `).bind(commitOid).run();

      const req = new Request('https://nates-software.com/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'promote',
          appId: 'promote-failclosed-app'
        })
      });

      const res = await deployApi.onRequestPost({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
      const data: any = await res.json();

      expect(res.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.deploymentState).toBe('source_ready');
      expect(data.error).toContain('Deployment pipeline is not yet commissioned');

      const app = await ctx.d1.prepare(`
        SELECT deployment_state, active_deployment_id FROM app_listings WHERE id = 'promote-failclosed-app'
      `).first<any>();
      expect(app.deployment_state).toBe('source_ready');
      expect(app.active_deployment_id).toBeNull();
    });

    it('should guarantee no code path sets active and no active listings exist without verified revision', async () => {
      const activeRows = await ctx.d1.prepare(`
        SELECT id, deployment_state, active_deployment_id FROM app_listings WHERE deployment_state = 'active'
      `).all<any>();

      expect(activeRows.results).toEqual([]);
    });
  });
});

