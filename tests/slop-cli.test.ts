import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
import { existsSync, readFileSync, rmSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync, statSync, lstatSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import {
  handleInit,
  handleFork,
  handleMod,
  handlePush,
  handleDrop,
  handleDyno,
  handleTest,
  handleStatus,
  handleList,
  handleShelf,
  handleLogin,
  handleLogout,
  readStoredCredentials,
  writeStoredCredentials,
  deleteStoredCredentials,
  getCredentialsFilePath,
  resolveControlPlaneUrl,
  printHelp,
  runSlopCli,
  getEngineStartInstructions
} from '../bin/slop.ts';
import { createTestD1Database } from './fixtures/d1Harness';
import { generateSessionToken } from '../functions/api/auth';
import { hashSessionToken } from '../functions/api/_session';

const createdWorktrees: string[] = [];
const trackedFork = async (slugOrArgs?: string | string[], options?: any) => {
  const result = await handleFork(slugOrArgs, { local: true, ...(options || {}) });
  if (result.success && result.data?.worktreePath) createdWorktrees.push(result.data.worktreePath);
  return result;
};

afterEach(() => {
  for (const worktree of createdWorktrees.splice(0)) rmSync(worktree, { recursive: true, force: true });
});

// GLOBAL credential isolation: every test runs with XDG_CONFIG_HOME pinned to a
// fresh temp dir so the CLI can never read (or write) the developer's REAL
// ~/.config/slop/credentials. Without this, one persisted login on the machine —
// or one leaky login test — flips every "unauthenticated" honesty test into an
// authenticated one (this actually happened: a suite run wrote the real file and
// poisoned the next full run). The login-persistence block deeper in this file
// overrides HOME itself and deletes XDG_CONFIG_HOME; that still resolves inside
// its own temp HOME, so both layers stay isolated.
const globalOriginalXdg = process.env.XDG_CONFIG_HOME;
let globalXdgTemp: string | null = null;
beforeEach(() => {
  globalXdgTemp = mkdtempSync(join(tmpdir(), 'slop-test-xdg-'));
  process.env.XDG_CONFIG_HOME = globalXdgTemp;
});
afterEach(() => {
  if (globalOriginalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = globalOriginalXdg;
  if (globalXdgTemp) rmSync(globalXdgTemp, { recursive: true, force: true });
  globalXdgTemp = null;
});

describe('SLOP CLI — "Go Fork, and Multiply" Developer Loop', () => {

  describe('slop init [name]', () => {
    const originalSlopToken = process.env.SLOP_SESSION_TOKEN;
    const originalSessionToken = process.env.SESSION_TOKEN;
    const originalAuthToken = process.env.AUTH_TOKEN;

    beforeEach(() => {
      delete process.env.SLOP_SESSION_TOKEN;
      delete process.env.SESSION_TOKEN;
      delete process.env.AUTH_TOKEN;
    });

    afterEach(() => {
      if (originalSlopToken !== undefined) process.env.SLOP_SESSION_TOKEN = originalSlopToken;
      else delete process.env.SLOP_SESSION_TOKEN;
      if (originalSessionToken !== undefined) process.env.SESSION_TOKEN = originalSessionToken;
      else delete process.env.SESSION_TOKEN;
      if (originalAuthToken !== undefined) process.env.AUTH_TOKEN = originalAuthToken;
      else delete process.env.AUTH_TOKEN;
    });

    it('should initialize locally without inventing a hosted publication remote', async () => {
      const res = await handleInit(['my-awesome-game', '--title=My Awesome Game', '--price=20']);
      expect(res.success).toBe(true);
      expect(res.command).toBe('init');
      expect(res.data.appId).toBe('my-awesome-game');
      expect(res.data.name).toBe('My Awesome Game');
      expect(res.data.price).toBe(20);
      expect(res.data.remoteUrl).toBeNull();
      expect(res.data.remoteConfigured).toBe(false);
      expect(res.message).not.toContain('undefined');
    });

    it('should default cleanly without arguments', async () => {
      const res = await handleInit();
      expect(res.success).toBe(true);
      expect(res.command).toBe('init');
      expect(res.data.price).toBe(15);
      expect(res.data.remoteUrl).toBeNull();
    });

    it('should not fabricate a live repository or remote when unauthenticated', async () => {
      const res = await handleInit(['unauth-app']);
      expect(res.success).toBe(true);
      expect(res.data.remoteConfigured).toBe(false);
      expect(res.data.remoteUrl).toBeNull();
      expect(res.data.repositoryId).toBeNull();
    });

    it('should provision a live repository and configure the slop remote from gateway-readiness when authenticated', async () => {
      const tempDir = join(tmpdir(), `slop-init-auth-${Date.now().toString(36)}`);
      mkdirSync(tempDir, { recursive: true });
      execSync(`git -c init.defaultBranch=main init "${tempDir}"`, { stdio: 'pipe' });

      try {
        const calls: string[] = [];
        const mockFetch = async (url: string, init: any) => {
          calls.push(url);
          if (url.includes('/api/git?action=gateway-readiness')) {
            return Response.json({
              success: true,
              ready: true,
              transport: { protocol: 'ssh', configured: true, active: true, host: 'gitsmith-live.internal', port: 61022 }
            });
          }
          if (url.endsWith('/api/git')) {
            const body = JSON.parse(init.body);
            expect(body.action).toBe('create-repository');
            expect(body.appId).toBeUndefined();
            expect(init.headers.Authorization).toBe('Bearer live-init-token');
            return Response.json({
              success: true,
              repository: { id: 'repo_live_init', slug: body.slug, status: 'active', ownerUserId: 'usr_nate' }
            }, { status: 201 });
          }
          throw new Error(`Unexpected fetch URL: ${url}`);
        };

        const res = await handleInit(['live-init-app'], {
          cwd: tempDir,
          fetchImpl: mockFetch,
          sessionToken: 'live-init-token'
        });

        expect(res.success).toBe(true);
        expect(res.data.remoteConfigured).toBe(true);
        expect(res.data.remoteUrl).toBe('ssh://git@gitsmith-live.internal:61022/nate/live-init-app.git');
        expect(res.data.repositoryId).toBe('repo_live_init');

        const remoteUrl = execSync('git remote get-url slop', { cwd: tempDir, encoding: 'utf8' }).trim();
        expect(remoteUrl).toBe('ssh://git@gitsmith-live.internal:61022/nate/live-init-app.git');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should surface a clear error and not fabricate a remote when the control plane rejects the CLI token', async () => {
      const tempDir = join(tmpdir(), `slop-init-401-${Date.now().toString(36)}`);
      mkdirSync(tempDir, { recursive: true });
      execSync(`git -c init.defaultBranch=main init "${tempDir}"`, { stdio: 'pipe' });

      try {
        const mockFetch = async () => Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        const res = await handleInit(['rejected-app'], {
          cwd: tempDir,
          fetchImpl: mockFetch,
          sessionToken: 'stale-token'
        });

        expect(res.success).toBe(true);
        expect(res.data.remoteConfigured).toBe(false);
        expect(res.data.remoteError).toContain('slop login');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('slop fork <slug>', () => {
    const fixtureRepos: string[] = [];
    const seedFixtureRepo = (appId: string, files: Record<string, string>) => {
      const dir = join(tmpdir(), `slopfix-${appId}-${Date.now().toString(36)}-${Math.floor(process.hrtime()[1] % 1e6)}`);
      mkdirSync(dir, { recursive: true });
      execSync(`git -c init.defaultBranch=main init "${dir}"`, { stdio: 'pipe' });
      for (const [rel, content] of Object.entries(files)) {
        const full = join(dir, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
      execSync(`git -C "${dir}" add -A && git -C "${dir}" -c user.name=Fixture -c user.email=fixture@test -c commit.gpgsign=false commit -m seed`, { stdio: 'pipe' });
      fixtureRepos.push(dir);
      return dir;
    };
    afterEach(() => {
      for (const d of fixtureRepos.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    it('should fork default slug (nate/dronehunter) into isolated worktree', async () => {
      const src = seedFixtureRepo('dronehunter', {
        'index.html': '<!doctype html><title>Drone Hunter</title><h1>Drone Hunter</h1>',
        'assets/drone.png': 'PNG',
        'package.json': JSON.stringify({ name: 'dronehunter' })
      });
      const res = await trackedFork(src);
      expect(res.success).toBe(true);
      expect(res.command).toBe('fork');
      expect(res.data.port).toBeGreaterThanOrEqual(3001);
      expect(res.data.memoryCapMb).toBe(256);
      expect(existsSync(`${res.data.worktreePath}/index.html`)).toBe(true);
      expect(existsSync(`${res.data.worktreePath}/assets/drone.png`)).toBe(true);
      expect(existsSync(`${res.data.worktreePath}/package.json`)).toBe(true);
      expect(readFileSync(`${res.data.worktreePath}/index.html`, 'utf8')).toContain('Drone Hunter');
      expect(res.message).not.toContain('agy');
      const engineInstructions = getEngineStartInstructions(res.data.worktreePath);
      expect(engineInstructions).toContainEqual(expect.stringContaining('Antigravity (AGY)'));
      expect(engineInstructions).toContainEqual(expect.stringContaining('Claude Code'));
      expect(engineInstructions).toContainEqual(expect.stringContaining('Aider'));
      expect(engineInstructions).toContainEqual(expect.stringContaining('Cursor / VS Code'));
    }, 15_000);

    it('should fork custom app slug into isolated worktree', async () => {
      const src = seedFixtureRepo('certified-mailer', {
        'index.html': '<!doctype html><title>Certified Mailer</title>',
        'package.json': JSON.stringify({ name: 'certified-mailer' })
      });
      const res = await trackedFork(src);
      expect(res.success).toBe(true);
      expect(existsSync(`${res.data.worktreePath}/index.html`)).toBe(true);
    });

    it('should reject unknown titles without inventing a starter project', async () => {
      const res = await handleFork('nate/unknown-title', { local: true });
      expect(res.success).toBe(false);
      expect(res.message).toContain('no placeholder fork was created');
      expect(existsSync(res.data.worktreePath)).toBe(false);
    });

    it('points an already-forked user to GITSMITH instead of dead-ending on a 409', async () => {
      const mockFetch = async () => Response.json({ success: false, error: 'A repository with this slug already exists for this user.' }, { status: 409 });
      const res = await handleFork('nate/american-gardener', {
        fetchImpl: mockFetch,
        sessionToken: 'live-token',
        controlPlaneUrl: 'https://nates-software.com'
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain('GITSMITH');
      expect(res.message).toContain('already have a fork');
      expect(existsSync(res.data.worktreePath)).toBe(false);
    });

    it('tells a rejected CLI session to regenerate its token on a 401', async () => {
      const mockFetch = async () => Response.json({ success: false, error: 'Unauthorized: Valid authenticated session required' }, { status: 401 });
      const res = await handleFork('nate/american-gardener', {
        fetchImpl: mockFetch,
        sessionToken: 'stale-token',
        controlPlaneUrl: 'https://nates-software.com'
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain('slop login');
      expect(res.message.toLowerCase()).toContain('expired or revoked');
    });

    it('should succeed when forking an empty canonical repository without fabricating source files', async () => {
      const emptyCanonicalDir = join(tmpdir(), `test-empty-canonical-${Date.now().toString(36)}`);
      mkdirSync(emptyCanonicalDir, { recursive: true });
      execSync(`git init "${emptyCanonicalDir}"`, { stdio: 'pipe' });

      try {
        const res = await trackedFork(emptyCanonicalDir);
        expect(res.success).toBe(true);
        expect(res.command).toBe('fork');
        expect(res.data.isEmptyRepo).toBe(true);
        expect(res.data.templateApplied).toBeNull();
        expect(res.data.isRealWorktree).toBe(true);
        expect(res.message).toContain('Forked empty repository');

        const worktree = res.data.worktreePath;
        expect(existsSync(worktree)).toBe(true);
        expect(existsSync(join(worktree, '.git'))).toBe(true);

        expect(existsSync(join(worktree, 'package.json'))).toBe(false);
        expect(existsSync(join(worktree, 'index.html'))).toBe(false);
        expect(existsSync(join(worktree, 'server.mjs'))).toBe(false);
        expect(existsSync(join(worktree, 'README.md'))).toBe(false);

        const remotes = execSync('git remote', { cwd: worktree, encoding: 'utf8' });
        expect(remotes).toContain('slop');
      } finally {
        rmSync(emptyCanonicalDir, { recursive: true, force: true });
      }
    });

    it('should scaffold starter template when user explicitly passes --template flag against empty repo', async () => {
      const emptyCanonicalDir = join(tmpdir(), `test-empty-template-${Date.now().toString(36)}`);
      mkdirSync(emptyCanonicalDir, { recursive: true });
      execSync(`git init "${emptyCanonicalDir}"`, { stdio: 'pipe' });

      try {
        const res = await trackedFork([emptyCanonicalDir, '--template=dronehunter']);
        expect(res.success).toBe(true);
        expect(res.data.templateApplied).toBe('dronehunter');

        const worktree = res.data.worktreePath;
        expect(existsSync(worktree)).toBe(true);
        expect(existsSync(join(worktree, '.git'))).toBe(true);
        expect(existsSync(join(worktree, 'package.json'))).toBe(true);
        expect(existsSync(join(worktree, 'index.html'))).toBe(true);
        expect(existsSync(join(worktree, 'server.mjs'))).toBe(true);
        expect(readFileSync(join(worktree, 'index.html'), 'utf8')).toContain('Drone Hunter');
      } finally {
        rmSync(emptyCanonicalDir, { recursive: true, force: true });
      }
    });

    it('should scaffold minimal starter when user explicitly passes --template minimal against empty repo', async () => {
      const emptyCanonicalDir = join(tmpdir(), `test-empty-minimal-${Date.now().toString(36)}`);
      mkdirSync(emptyCanonicalDir, { recursive: true });
      execSync(`git init "${emptyCanonicalDir}"`, { stdio: 'pipe' });

      try {
        const res = await trackedFork([emptyCanonicalDir, '--template=minimal']);
        expect(res.success).toBe(true);
        expect(res.data.templateApplied).toBe('minimal');

        const worktree = res.data.worktreePath;
        expect(existsSync(worktree)).toBe(true);
        expect(existsSync(join(worktree, '.git'))).toBe(true);
        expect(existsSync(join(worktree, 'package.json'))).toBe(true);
        expect(existsSync(join(worktree, 'index.html'))).toBe(true);
        expect(existsSync(join(worktree, 'README.md'))).toBe(true);
      } finally {
        rmSync(emptyCanonicalDir, { recursive: true, force: true });
      }
    });

    it('should truthfully fork an empty repo named dronehunter with NO --template and scaffold ONLY when --template is passed', async () => {
      const emptyDronehunterDir = join(tmpdir(), `test-empty-dh-${Date.now().toString(36)}`, 'dronehunter');
      mkdirSync(emptyDronehunterDir, { recursive: true });
      execSync(`git init "${emptyDronehunterDir}"`, { stdio: 'pipe' });

      try {
        const resEmpty = await trackedFork(emptyDronehunterDir);
        expect(resEmpty.success).toBe(true);
        expect(resEmpty.data.isEmptyRepo).toBe(true);
        expect(resEmpty.data.templateApplied).toBeNull();
        expect(resEmpty.message).toContain('Forked empty repository');

        const emptyWorktree = resEmpty.data.worktreePath;
        expect(existsSync(emptyWorktree)).toBe(true);
        expect(existsSync(join(emptyWorktree, '.git'))).toBe(true);
        expect(existsSync(join(emptyWorktree, 'package.json'))).toBe(false);
        expect(existsSync(join(emptyWorktree, 'index.html'))).toBe(false);
        expect(existsSync(join(emptyWorktree, 'server.mjs'))).toBe(false);
        expect(existsSync(join(emptyWorktree, 'README.md'))).toBe(false);

        const resScaffolded = await trackedFork([emptyDronehunterDir, '--template=dronehunter']);
        expect(resScaffolded.success).toBe(true);
        expect(resScaffolded.data.templateApplied).toBe('dronehunter');

        const scaffoldedWorktree = resScaffolded.data.worktreePath;
        expect(existsSync(scaffoldedWorktree)).toBe(true);
        expect(existsSync(join(scaffoldedWorktree, '.git'))).toBe(true);
        expect(existsSync(join(scaffoldedWorktree, 'package.json'))).toBe(true);
        expect(existsSync(join(scaffoldedWorktree, 'index.html'))).toBe(true);
        expect(existsSync(join(scaffoldedWorktree, 'server.mjs'))).toBe(true);
        expect(readFileSync(join(scaffoldedWorktree, 'index.html'), 'utf8')).toContain('Drone Hunter');
      } finally {
        rmSync(join(emptyDronehunterDir, '..'), { recursive: true, force: true });
      }
    });

    it('should preserve content when forking an existing content repository', async () => {
      const contentCanonicalDir = join(tmpdir(), `test-content-repo-${Date.now().toString(36)}`);
      mkdirSync(contentCanonicalDir, { recursive: true });
      execSync(`git init "${contentCanonicalDir}"`, { stdio: 'pipe' });
      writeFileSync(join(contentCanonicalDir, 'README.md'), '# Sovereign App Source\n');
      writeFileSync(join(contentCanonicalDir, 'package.json'), JSON.stringify({ name: 'sovereign-app', version: '1.0.0' }));
      execSync(`git -C "${contentCanonicalDir}" add -A && git -C "${contentCanonicalDir}" -c user.name=Test -c user.email=test@test.com commit -m "initial commit"`, { stdio: 'pipe' });

      try {
        const res = await trackedFork(contentCanonicalDir);
        expect(res.success).toBe(true);
        expect(res.data.isEmptyRepo).toBe(false);
        expect(res.data.templateApplied).toBeNull();

        const worktree = res.data.worktreePath;
        expect(existsSync(join(worktree, 'README.md'))).toBe(true);
        expect(readFileSync(join(worktree, 'README.md'), 'utf8')).toContain('Sovereign App Source');
      } finally {
        rmSync(contentCanonicalDir, { recursive: true, force: true });
      }
    });
  });

  describe('slop test', () => {
    it('should run and pass shareware verification checks before pushing', () => {
      const res = handleTest();
      expect(res.success).toBe(true);
      expect(res.command).toBe('test');
      expect(res.data.passedProofs).toBe(4);
      expect(res.data.totalProofs).toBe(4);
    });
  });

  describe('slop push', () => {
    it('should truthfully fail when remote is unreachable without claiming false CAS success', () => {
      // Hermetic: build a throwaway repo whose `slop` remote points at a dead
      // address. Previously this test ran bare handlePush() from the developer
      // checkout's cwd — which meant it depended on that checkout's real `slop`
      // remote and, once that remote pointed at the LIVE forge, the test was
      // actually pushing this entire repository to production on every run.
      // Tests must never touch a real remote.
      const pushTempDir = mkdtempSync(join(tmpdir(), 'slop-push-unreachable-'));
      const originalCwd = process.cwd();
      try {
        execSync(`git -C "${pushTempDir}" init -q -b main`, { stdio: 'pipe' });
        writeFileSync(join(pushTempDir, 'README.md'), '# temp');
        execSync(`git -C "${pushTempDir}" add -A && git -C "${pushTempDir}" -c user.name=Test -c user.email=test@test.com commit -qm init`, { stdio: 'pipe' });
        execSync(`git -C "${pushTempDir}" remote add slop ssh://git@127.0.0.1:1/nobody/nowhere.git`, { stdio: 'pipe' });
        process.chdir(pushTempDir);
        const res = handlePush();
        expect(res.command).toBe('push');
        expect(res.success).toBe(false);
        expect(res.data.casVerified).toBe(false);
        expect(res.data.pushedGit).toBe(false);
        expect(res.message).toContain('Push failed');
      } finally {
        process.chdir(originalCwd);
        rmSync(pushTempDir, { recursive: true, force: true });
      }
    });
  });

  describe('slop drop / slop publish', () => {
    const originalSlopToken = process.env.SLOP_SESSION_TOKEN;
    const originalSessionToken = process.env.SESSION_TOKEN;
    const originalAuthToken = process.env.AUTH_TOKEN;

    beforeEach(() => {
      delete process.env.SLOP_SESSION_TOKEN;
      delete process.env.SESSION_TOKEN;
      delete process.env.AUTH_TOKEN;
    });

    afterEach(() => {
      if (originalSlopToken !== undefined) process.env.SLOP_SESSION_TOKEN = originalSlopToken;
      else delete process.env.SLOP_SESSION_TOKEN;
      if (originalSessionToken !== undefined) process.env.SESSION_TOKEN = originalSessionToken;
      else delete process.env.SESSION_TOKEN;
      if (originalAuthToken !== undefined) process.env.AUTH_TOKEN = originalAuthToken;
      else delete process.env.AUTH_TOKEN;
    });

    it('should never claim a queued drop without an authenticated CLI session', async () => {
      const res = await handleDrop(['dronehunter', '--name=DroneHunter 95', '--price=15']);
      expect(res.success).toBe(false);
      expect(res.command).toBe('drop');
      expect(res.data.appId).toBe('dronehunter');
      expect(res.data.priceCents).toBe(1500);
      expect(res.data.queued).toBe(false);
      expect(res.data.liveUrl).toBeNull();
      expect(res.message).toContain('slop login');
    });

    it('should POST the real drop payload with Bearer auth and report only a true success:true response', async () => {
      let capturedUrl = '';
      let capturedInit: any = null;
      const mockFetch = async (url: string, init: any) => {
        capturedUrl = url;
        capturedInit = init;
        return Response.json({
          success: true,
          id: 'dronehunter',
          deploymentState: 'source_ready',
          repositoryId: 'repo_abc123',
          repositoryProvisioned: false,
          productStatus: 'active',
          batchWindow: { start: '2026-09-02T00:01:00.000Z', end: '2026-09-03T00:01:00.000Z' },
          message: 'Drop published successfully to Cloudflare D1'
        });
      };

      const res = await handleDrop(
        ['dronehunter', '--name=DroneHunter 95', '--price=15', '--version=v2.1.0', '--royaltyBps=1500'],
        { fetchImpl: mockFetch, sessionToken: 'real-drop-token' }
      );

      expect(capturedUrl).toBe('https://nates-software.com/api/drops');
      expect(capturedInit.method).toBe('POST');
      expect(capturedInit.headers.Authorization).toBe('Bearer real-drop-token');
      const body = JSON.parse(capturedInit.body);
      expect(body).toMatchObject({
        id: 'dronehunter',
        name: 'DroneHunter 95',
        version: 'v2.1.0',
        price: 15,
        royaltyBps: 1500
      });

      expect(res.success).toBe(true);
      expect(res.command).toBe('drop');
      expect(res.data.queued).toBe(true);
      expect(res.data.published).toBe(true);
      expect(res.data.deployed).toBe(true);
      expect(res.data.repositoryId).toBe('repo_abc123');
      expect(res.data.batch).toEqual({ start: '2026-09-02T00:01:00.000Z', end: '2026-09-03T00:01:00.000Z' });
    });

    it('should fail closed and never report success when the control plane returns success:false', async () => {
      const mockFetch = async () => Response.json({ success: false, error: 'version must match semver' }, { status: 400 });

      const res = await handleDrop(
        ['dronehunter', '--name=DroneHunter 95'],
        { fetchImpl: mockFetch, sessionToken: 'real-drop-token' }
      );

      expect(res.success).toBe(false);
      expect(res.data.queued).toBe(false);
      expect(res.data.published).toBe(false);
      expect(res.message).toContain('version must match semver');
    });

    it('should surface a clear "run slop login" message on 401 and not claim success', async () => {
      const mockFetch = async () => Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });

      const res = await handleDrop(
        ['dronehunter', '--name=DroneHunter 95'],
        { fetchImpl: mockFetch, sessionToken: 'expired-token' }
      );

      expect(res.success).toBe(false);
      expect(res.data.queued).toBe(false);
      expect(res.message).toContain('slop login');
    });
  });

  describe('slop dyno', () => {
    it('should execute real baseline task evaluation and return truthful scores', async () => {
      const res = await handleDyno(['--task=neutral_cli_arg_parser', '--quiet']);
      expect(res.success).toBe(true);
      expect(res.command).toBe('dyno');
      expect(res.data.summary.totalTasks).toBe(1);
      expect(res.data.run.runner_attestation_digest).toHaveLength(64);
      expect(res.data.run.raw_trace_sha256).toHaveLength(64);
      expect(res.data.run.status).toBe('completed');
    });

    it('should execute reference calibration suite with 1000 score and Grade S', async () => {
      const res = await handleDyno(['--task=neutral_cli_arg_parser', '--solve', '--quiet']);
      expect(res.success).toBe(true);
      expect(res.data.summary.dynoScore).toBe(1000);
      expect(res.data.summary.grade).toContain('Grade S');
      expect(res.data.summary.tasksPassed).toBe(1);
    });

    it('should run multi-repetition benchmark without self-promoting verification', async () => {
      const res = await handleDyno(['--task=neutral_cli_arg_parser', '--solve', '--bench', '--quiet']);
      expect(res.success).toBe(true);
      expect(res.data.run.repetition).toBe(2);
      expect(res.data.run.verification_status).toBe('unverified');
      expect(res.data.summary.dynoScore).toBe(1000);
    });

    it('should handle non-existent task key with honest error', async () => {
      const res = await handleDyno(['--task=non_existent_fixture', '--quiet']);
      expect(res.success).toBe(false);
      expect(res.message).toContain('not found');
    });
  });

  describe('slop status', () => {
    it('should truthfully report an empty local control plane when no provider is connected', () => {
      const res = handleStatus();
      expect(res.success).toBe(true);
      expect(res.command).toBe('status');
      expect(res.data.containers).toEqual([]);
      expect(res.data.availablePorts.length).toBeGreaterThan(0);
      expect(res.message).toContain('provider disconnected');
    });
  });

  describe('slop list', () => {
    it('should fail closed until canonical HOTWIRE transport is configured', () => {
      const res = handleList();
      expect(res.success).toBe(false);
      expect(res.command).toBe('list');
      expect(res.data.drops).toEqual([]);
    });
  });

  describe('slop shelf', () => {
    it('should never fabricate owned titles without an authenticated session', () => {
      const res = handleShelf();
      expect(res.success).toBe(false);
      expect(res.command).toBe('shelf');
      expect(res.data.totalOwned).toBe(0);
    });
  });

  describe('slop login, logout, and stored credentials', () => {
    const originalHome = process.env.HOME;
    const originalXdg = process.env.XDG_CONFIG_HOME;
    const originalSlopToken = process.env.SLOP_SESSION_TOKEN;
    const originalSessionToken = process.env.SESSION_TOKEN;
    const originalAuthToken = process.env.AUTH_TOKEN;
    let tempHome: string;

    beforeEach(() => {
      tempHome = join(tmpdir(), `test-slop-home-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
      mkdirSync(tempHome, { recursive: true });
      process.env.HOME = tempHome;
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.SLOP_SESSION_TOKEN;
      delete process.env.SESSION_TOKEN;
      delete process.env.AUTH_TOKEN;
    });

    afterEach(() => {
      rmSync(tempHome, { recursive: true, force: true });
      if (originalHome !== undefined) process.env.HOME = originalHome;
      else delete process.env.HOME;
      if (originalXdg !== undefined) process.env.XDG_CONFIG_HOME = originalXdg;
      else delete process.env.XDG_CONFIG_HOME;
      if (originalSlopToken !== undefined) process.env.SLOP_SESSION_TOKEN = originalSlopToken;
      else delete process.env.SLOP_SESSION_TOKEN;
      if (originalSessionToken !== undefined) process.env.SESSION_TOKEN = originalSessionToken;
      else delete process.env.SESSION_TOKEN;
      if (originalAuthToken !== undefined) process.env.AUTH_TOKEN = originalAuthToken;
      else delete process.env.AUTH_TOKEN;
    });

    it('should return null when reading non-existent stored credentials', () => {
      expect(readStoredCredentials()).toBeNull();
    });

    it('should write and read stored credentials round-trip', () => {
      writeStoredCredentials({
        sessionToken: 'test-token-abc',
        username: 'nate',
        expiresAt: Date.now() + 3600 * 1000
      });

      const creds = readStoredCredentials();
      expect(creds).not.toBeNull();
      expect(creds?.sessionToken).toBe('test-token-abc');
      expect(creds?.username).toBe('nate');
      expect(existsSync(getCredentialsFilePath())).toBe(true);
    });

    it('should respect XDG_CONFIG_HOME when configured', () => {
      const customXdg = join(tempHome, 'custom-xdg');
      process.env.XDG_CONFIG_HOME = customXdg;

      const path = getCredentialsFilePath();
      expect(path).toBe(join(customXdg, 'slop', 'credentials'));

      writeStoredCredentials({
        sessionToken: 'xdg-token-xyz',
        username: 'josh',
        expiresAt: Date.now() + 3600 * 1000
      });

      expect(existsSync(join(customXdg, 'slop', 'credentials'))).toBe(true);
      expect(readStoredCredentials()?.username).toBe('josh');
    });

    it('should return null if stored credentials are expired', () => {
      writeStoredCredentials({
        sessionToken: 'expired-token-123',
        username: 'nate',
        expiresAt: Date.now() - 1000
      });

      expect(readStoredCredentials()).toBeNull();
    });

    it('should delete stored credentials file on deleteStoredCredentials', () => {
      writeStoredCredentials({
        sessionToken: 'delete-me',
        username: 'nate',
        expiresAt: Date.now() + 3600 * 1000
      });
      expect(existsSync(getCredentialsFilePath())).toBe(true);

      const deleted = deleteStoredCredentials();
      expect(deleted).toBe(true);
      expect(existsSync(getCredentialsFilePath())).toBe(false);
      expect(readStoredCredentials()).toBeNull();
    });

    it('should fail slop login when no token is provided in non-interactive mode', async () => {
      const res = await handleLogin([], { nonInteractive: true });
      expect(res.success).toBe(false);
      expect(res.command).toBe('login');
      expect(res.message).toContain('No CLI token provided');
      expect(readStoredCredentials()).toBeNull();
    });

    it('should reject invalid CLI token and not write credentials file', async () => {
      const ctx = await createTestD1Database({ foreignKeys: true });

      const res = await handleLogin(['--token', 'invalid-token-value'], { env: { DB: ctx.d1 } });
      expect(res.success).toBe(false);
      expect(res.command).toBe('login');
      expect(res.message).toContain('Invalid or expired CLI token');
      expect(readStoredCredentials()).toBeNull();
    });

    it('should authenticate with valid --token flag, write credentials file, and return user info', async () => {
      const ctx = await createTestD1Database({ foreignKeys: true });

      const rawToken = generateSessionToken();
      const tokenHash = await hashSessionToken(rawToken);
      const expiresAt = Date.now() + 90 * 24 * 3600 * 1000;
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(tokenHash, expiresAt).run();

      const res = await handleLogin(['--token', rawToken], { env: { DB: ctx.d1 } });
      expect(res.success).toBe(true);
      expect(res.command).toBe('login');
      expect(res.data.authenticated).toBe(true);
      expect(res.data.username).toBe('nate');
      expect(res.message).toContain('Logged in as @nate');

      const creds = readStoredCredentials();
      expect(creds).not.toBeNull();
      expect(creds?.sessionToken).toBe(rawToken);
      expect(creds?.username).toBe('nate');
    });

    it('should authenticate with --token=<token> syntax', async () => {
      const ctx = await createTestD1Database({ foreignKeys: true });

      const rawToken = generateSessionToken();
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(rawToken), Date.now() + 90 * 24 * 3600 * 1000).run();

      const res = await handleLogin([`--token=${rawToken}`], { env: { DB: ctx.d1 } });
      expect(res.success).toBe(true);
      expect(res.data.username).toBe('nate');
      expect(readStoredCredentials()?.sessionToken).toBe(rawToken);
    });

    it('should delete credentials and report logged out on slop logout', async () => {
      const ctx = await createTestD1Database({ foreignKeys: true });

      writeStoredCredentials({
        sessionToken: 'test-token-to-logout',
        username: 'nate',
        expiresAt: Date.now() + 3600 * 1000
      });
      expect(readStoredCredentials()).not.toBeNull();

      const res = await handleLogout([], { env: { DB: ctx.d1 } });
      expect(res.success).toBe(true);
      expect(res.command).toBe('logout');
      expect(res.message).toContain('Logged out @nate');
      expect(readStoredCredentials()).toBeNull();
    });

    it('should resolve stored credentials token for fork authentication when env is unset', async () => {
      const ctx = await createTestD1Database({ foreignKeys: true });

      const rawToken = generateSessionToken();
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(rawToken), Date.now() + 90 * 24 * 3600 * 1000).run();

      writeStoredCredentials({
        sessionToken: rawToken,
        username: 'nate',
        expiresAt: Date.now() + 90 * 24 * 3600 * 1000
      });

      expect(readStoredCredentials()?.sessionToken).toBe(rawToken);
    });

    it('should use stored credentials token for fork request Authorization header when env vars are unset', async () => {
      const rawToken = 'my_stored_cli_session_token_123';
      writeStoredCredentials({
        sessionToken: rawToken,
        username: 'nate',
        expiresAt: Date.now() + 90 * 24 * 3600 * 1000
      });

      let capturedAuthHeader: string | null = null;
      const mockFetch = async (_url: string, init: any) => {
        capturedAuthHeader = init.headers?.Authorization || null;
        return Response.json({
          success: true,
          repository: {
            id: 'repo_child_123',
            name: 'dronehunter',
            slug: 'nate/dronehunter',
            ownerUserId: 'usr_nate',
            ownerUsername: 'nate',
            defaultBranch: 'main'
          },
          cloneUrl: 'https://nates-software.com/git/nate/dronehunter.git',
          worktreePath: join(tempHome, 'test-fork-wt')
        });
      };

      delete process.env.SLOP_SESSION_TOKEN;
      delete process.env.SESSION_TOKEN;
      delete process.env.AUTH_TOKEN;

      await handleFork('nate/dronehunter', {
        fetchImpl: mockFetch,
        local: false
      });

      expect(capturedAuthHeader).toBe(`Bearer ${rawToken}`);
    });

    it('should NEVER return sessionToken or raw token in handleLogin result data', async () => {
      const ctx = await createTestD1Database({ foreignKeys: true });
      const rawToken = generateSessionToken();
      const expiresAt = Date.now() + 3600 * 1000;
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(rawToken), expiresAt).run();

      const res = await handleLogin(['--token', rawToken], { env: { DB: ctx.d1 } });
      expect(res.success).toBe(true);
      expect(res.data.sessionToken).toBeUndefined();
      expect(res.data.token).toBeUndefined();
      expect(res.data.user).toBeUndefined();
      expect(JSON.stringify(res.data)).not.toContain(rawToken);
      expect(JSON.stringify(res)).not.toContain(rawToken);
      expect(res.data).toEqual({
        authenticated: true,
        username: 'nate',
        expiresAt
      });
    });

    it('should reject writing over a pre-existing symlink at the credentials path', () => {
      const credPath = getCredentialsFilePath();
      const credDir = dirname(credPath);
      mkdirSync(credDir, { recursive: true });

      const decoyFile = join(tempHome, 'decoy-target.txt');
      writeFileSync(decoyFile, 'sensitive decoy content');
      symlinkSync(decoyFile, credPath);

      expect(() => {
        writeStoredCredentials({
          sessionToken: 'attacker-token',
          username: 'attacker',
          expiresAt: Date.now() + 3600 * 1000
        });
      }).toThrow(/symbolic link/i);

      expect(readFileSync(decoyFile, 'utf8')).toBe('sensitive decoy content');
    });

    it('should reject writeStoredCredentials when the credentials directory is a symlink', () => {
      const credPath = getCredentialsFilePath();
      const credDir = dirname(credPath);
      const parentDir = dirname(credDir);
      mkdirSync(parentDir, { recursive: true });

      const fakeTargetDir = join(tempHome, 'fake-target-dir');
      mkdirSync(fakeTargetDir, { recursive: true });
      symlinkSync(fakeTargetDir, credDir);

      expect(() => {
        writeStoredCredentials({
          sessionToken: 'attacker-token',
          username: 'attacker',
          expiresAt: Date.now() + 3600 * 1000
        });
      }).toThrow(/symbolic link/i);
    });

    it('should write credentials with 0600 file permissions and 0700 dir permissions', () => {
      writeStoredCredentials({
        sessionToken: 'secure-token-perm',
        username: 'nate',
        expiresAt: Date.now() + 3600 * 1000
      });

      const credPath = getCredentialsFilePath();
      const credDir = dirname(credPath);

      const fileStat = statSync(credPath);
      const dirStat = statSync(credDir);

      if (process.platform !== 'win32') {
        expect(fileStat.mode & 0o777).toBe(0o600);
        expect(dirStat.mode & 0o777).toBe(0o700);
      }
      expect(fileStat.isFile()).toBe(true);
      expect(lstatSync(credPath).isSymbolicLink()).toBe(false);
    });

    it('should store the real server session expiry timestamp, not a synthesized 90 days', async () => {
      const ctx = await createTestD1Database({ foreignKeys: true });
      const rawToken = generateSessionToken();
      const realExpiry = Date.now() + 14 * 24 * 3600 * 1000;

      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(rawToken), realExpiry).run();

      const res = await handleLogin(['--token', rawToken], { env: { DB: ctx.d1 } });
      expect(res.success).toBe(true);
      expect(res.data.expiresAt).toBe(realExpiry);

      const creds = readStoredCredentials();
      expect(creds?.expiresAt).toBe(realExpiry);
    });

    it('should reject http:// control-plane URL by default in login and fork', async () => {
      const insecureUrl = 'http://attacker-controlled.com';

      const loginRes = await handleLogin(['--token', 'any-token'], { controlPlaneUrl: insecureUrl });
      expect(loginRes.success).toBe(false);
      expect(loginRes.message).toContain('HTTPS is required');

      const forkRes = await handleFork('nate/dronehunter', { controlPlaneUrl: insecureUrl, local: false });
      expect(forkRes.success).toBe(false);
      expect(forkRes.message).toContain('HTTPS is required');
    });

    it('should permit http:// control-plane URL when SLOP_INSECURE=1 is set', () => {
      const origInsecure = process.env.SLOP_INSECURE;
      try {
        process.env.SLOP_INSECURE = '1';
        const resolved = resolveControlPlaneUrl('http://localhost:8787');
        expect(resolved).toBe('http://localhost:8787');
      } finally {
        if (origInsecure !== undefined) process.env.SLOP_INSECURE = origInsecure;
        else delete process.env.SLOP_INSECURE;
      }
    });

    it('should read CLI token from non-TTY stdin stream when no flags or env are provided', async () => {
      const ctx = await createTestD1Database({ foreignKeys: true });
      const rawToken = generateSessionToken();
      const expiresAt = Date.now() + 3600 * 1000;
      await ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at)
        VALUES (?, 'usr_nate', ?)
      `).bind(await hashSessionToken(rawToken), expiresAt).run();

      const pipedStdin = Readable.from([`${rawToken}\n`]);

      const res = await handleLogin([], {
        stdin: pipedStdin,
        isTTY: false,
        env: { DB: ctx.d1 }
      });

      expect(res.success).toBe(true);
      expect(res.data.username).toBe('nate');
      expect(readStoredCredentials()?.sessionToken).toBe(rawToken);
    });
  });

  describe('slop mod <package-or-manifest>', () => {
    it('should show error and usage when invoked without arguments', async () => {
      const res = await handleMod([]);
      expect(res.success).toBe(false);
      expect(res.command).toBe('mod');
      expect(res.message).toContain('Usage: slop mod');
    });

    it('should fail cleanly when manifest is not found', async () => {
      const res = await handleMod(['non-existent-manifest-path.json']);
      expect(res.success).toBe(false);
      expect(res.command).toBe('mod');
      expect(res.message).toContain('Failed to resolve feature package manifest');
    });
  });

  describe('slop help', () => {
    it('should output help manual and command index', () => {
      const res = printHelp();
      expect(res.success).toBe(true);
      expect(res.message).toContain('Go Fork, and Multiply');
      expect(res.message).toContain('slop init');
      expect(res.message).toContain('slop fork');
      expect(res.message).toContain('slop mod');
      expect(res.message).toContain('slop push');
      expect(res.message).toContain('slop dyno');
    });
  });

  describe('runSlopCli router', () => {
    it('should route all commands cleanly', async () => {
      expect((await runSlopCli(['init', 'test-app'])).success).toBe(true);
      const routerForkSrc = join(tmpdir(), `slopfix-router-${Date.now().toString(36)}`);
      mkdirSync(routerForkSrc, { recursive: true });
      execSync(`git -c init.defaultBranch=main init "${routerForkSrc}"`, { stdio: 'pipe' });
      writeFileSync(join(routerForkSrc, 'index.html'), '<!doctype html><title>Drone Hunter</title>');
      execSync(`git -C "${routerForkSrc}" add -A && git -C "${routerForkSrc}" -c user.name=Fixture -c user.email=fixture@test -c commit.gpgsign=false commit -m seed`, { stdio: 'pipe' });
      createdWorktrees.push(routerForkSrc);
      const routedFork = await runSlopCli(['fork', routerForkSrc, '--local']);
      if (routedFork.success && routedFork.data?.worktreePath) createdWorktrees.push(routedFork.data.worktreePath);
      expect(routedFork.success).toBe(true);
      expect((await runSlopCli(['mod'])).command).toBe('mod');
      expect((await runSlopCli(['test'])).success).toBe(true);
      expect((await runSlopCli(['push'])).command).toBe('push');
      expect((await runSlopCli(['drop', 'dronehunter'])).success).toBe(false);
      expect((await runSlopCli(['publish', 'dronehunter'])).success).toBe(false);
      const dynoRes = await runSlopCli(['dyno', '--task=neutral_cli_arg_parser', '--solve', '--quiet']);
      expect(dynoRes.success).toBe(true);
      expect((await runSlopCli(['status'])).success).toBe(true);
      expect((await runSlopCli(['list'])).success).toBe(false);
      expect((await runSlopCli(['shelf'])).success).toBe(false);
      expect((await runSlopCli(['login'])).success).toBe(false);
      expect((await runSlopCli(['help'])).success).toBe(true);
    }, 15_000);

    it('should handle unknown command with error', async () => {
      const res = await runSlopCli(['invalid-unknown-cmd']);
      expect(res.success).toBe(false);
      expect(res.message).toContain('Unknown command');
    });
  });
});
