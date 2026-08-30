import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  printHelp,
  runSlopCli,
  getEngineStartInstructions
} from '../bin/slop.ts';

const createdWorktrees: string[] = [];
const trackedFork = (slugOrArgs?: string | string[], options?: any) => {
  const result = handleFork(slugOrArgs, options);
  if (result.success && result.data?.worktreePath) createdWorktrees.push(result.data.worktreePath);
  return result;
};

afterEach(() => {
  for (const worktree of createdWorktrees.splice(0)) rmSync(worktree, { recursive: true, force: true });
});

describe('SLOP CLI — "Go Fork, and Multiply" Developer Loop', () => {

  describe('slop init [name]', () => {
    it('should initialize locally without inventing a hosted publication remote', () => {
      const res = handleInit(['my-awesome-game', '--title=My Awesome Game', '--price=20']);
      expect(res.success).toBe(true);
      expect(res.command).toBe('init');
      expect(res.data.appId).toBe('my-awesome-game');
      expect(res.data.name).toBe('My Awesome Game');
      expect(res.data.price).toBe(20);
      expect(res.data.remoteUrl).toBeNull();
      expect(res.data.remoteConfigured).toBe(false);
    });

    it('should default cleanly without arguments', () => {
      const res = handleInit();
      expect(res.success).toBe(true);
      expect(res.command).toBe('init');
      expect(res.data.price).toBe(15);
      expect(res.data.remoteUrl).toBeNull();
    });
  });

  describe('slop fork <slug>', () => {
    it('should fork default slug (nate/dronehunter) into isolated worktree', () => {
      const res = trackedFork();
      expect(res.success).toBe(true);
      expect(res.command).toBe('fork');
      expect(res.data.slug).toBe('nate/dronehunter');
      expect(res.data.appId).toBe('dronehunter');
      expect(res.data.port).toBeGreaterThanOrEqual(3001);
      expect(res.data.memoryCapMb).toBe(256);
      expect(res.data.worktreePath).toContain(`${tmpdir()}/slop-dronehunter-`);
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

    it('should fork custom app slug into isolated worktree', () => {
      const res = trackedFork('nate/certified-mailer');
      expect(res.success).toBe(true);
      expect(res.data.slug).toBe('nate/certified-mailer');
      expect(res.data.appId).toBe('certified-mailer');
    });

    it('should reject unknown titles without inventing a starter project', () => {
      const res = handleFork('nate/unknown-title');
      expect(res.success).toBe(false);
      expect(res.message).toContain('no placeholder fork was created');
      expect(existsSync(res.data.worktreePath)).toBe(false);
    });

    it('should succeed when forking an empty canonical repository without fabricating source files', () => {
      const emptyCanonicalDir = join(tmpdir(), `test-empty-canonical-${Date.now().toString(36)}`);
      mkdirSync(emptyCanonicalDir, { recursive: true });
      execSync(`git init "${emptyCanonicalDir}"`, { stdio: 'pipe' });

      try {
        const res = trackedFork(emptyCanonicalDir);
        expect(res.success).toBe(true);
        expect(res.command).toBe('fork');
        expect(res.data.isEmptyRepo).toBe(true);
        expect(res.data.templateApplied).toBeNull();
        expect(res.data.isRealWorktree).toBe(true);
        expect(res.message).toContain('Forked empty repository');

        const worktree = res.data.worktreePath;
        expect(existsSync(worktree)).toBe(true);
        expect(existsSync(join(worktree, '.git'))).toBe(true);

        // TRUTHFULNESS GUARANTEE: Never fabricate source into an empty repo!
        expect(existsSync(join(worktree, 'package.json'))).toBe(false);
        expect(existsSync(join(worktree, 'index.html'))).toBe(false);
        expect(existsSync(join(worktree, 'server.mjs'))).toBe(false);
        expect(existsSync(join(worktree, 'README.md'))).toBe(false);

        // Verify publication remote configured
        const remotes = execSync('git remote', { cwd: worktree, encoding: 'utf8' });
        expect(remotes).toContain('slop');
      } finally {
        rmSync(emptyCanonicalDir, { recursive: true, force: true });
      }
    });

    it('should scaffold starter template when user explicitly passes --template flag against empty repo', () => {
      const emptyCanonicalDir = join(tmpdir(), `test-empty-template-${Date.now().toString(36)}`);
      mkdirSync(emptyCanonicalDir, { recursive: true });
      execSync(`git init "${emptyCanonicalDir}"`, { stdio: 'pipe' });

      try {
        const res = trackedFork([emptyCanonicalDir, '--template=dronehunter']);
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

    it('should scaffold minimal starter when user explicitly passes --template minimal against empty repo', () => {
      const emptyCanonicalDir = join(tmpdir(), `test-empty-minimal-${Date.now().toString(36)}`);
      mkdirSync(emptyCanonicalDir, { recursive: true });
      execSync(`git init "${emptyCanonicalDir}"`, { stdio: 'pipe' });

      try {
        const res = trackedFork([emptyCanonicalDir, '--template=minimal']);
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

    it('should truthfully fork an empty repo named dronehunter with NO --template and scaffold ONLY when --template is passed', () => {
      const emptyDronehunterDir = join(tmpdir(), `test-empty-dh-${Date.now().toString(36)}`, 'dronehunter');
      mkdirSync(emptyDronehunterDir, { recursive: true });
      execSync(`git init "${emptyDronehunterDir}"`, { stdio: 'pipe' });

      try {
        // Without --template: must NOT auto-scaffold just because the repo is named dronehunter
        const resEmpty = trackedFork(emptyDronehunterDir);
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

        // With explicit --template dronehunter: must scaffold
        const resScaffolded = trackedFork([emptyDronehunterDir, '--template=dronehunter']);
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

    it('should preserve content when forking an existing content repository', () => {
      const contentCanonicalDir = join(tmpdir(), `test-content-repo-${Date.now().toString(36)}`);
      mkdirSync(contentCanonicalDir, { recursive: true });
      execSync(`git init "${contentCanonicalDir}"`, { stdio: 'pipe' });
      writeFileSync(join(contentCanonicalDir, 'README.md'), '# Sovereign App Source\n');
      writeFileSync(join(contentCanonicalDir, 'package.json'), JSON.stringify({ name: 'sovereign-app', version: '1.0.0' }));
      execSync(`git -C "${contentCanonicalDir}" add -A && git -C "${contentCanonicalDir}" -c user.name=Test -c user.email=test@test.com commit -m "initial commit"`, { stdio: 'pipe' });

      try {
        const res = trackedFork(contentCanonicalDir);
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
      const res = handlePush();
      expect(res.command).toBe('push');
      expect(res.success).toBe(false);
      expect(res.data.casVerified).toBe(false);
      expect(res.data.pushedGit).toBe(false);
      expect(res.message).toContain('Push failed');
    });
  });

  describe('slop drop / slop publish', () => {
    it('should never claim a queued drop without configured HOTWIRE transport', () => {
      const res = handleDrop(['dronehunter', '--name=DroneHunter 95', '--price=15']);
      expect(res.success).toBe(false);
      expect(res.command).toBe('drop');
      expect(res.data.appId).toBe('dronehunter');
      expect(res.data.priceCents).toBe(1500);
      expect(res.data.queued).toBe(false);
      expect(res.data.liveUrl).toBeNull();
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

  describe('slop login', () => {
    it('should fail closed while CLI device authentication is unavailable', () => {
      const res = handleLogin();
      expect(res.success).toBe(false);
      expect(res.command).toBe('login');
      expect(res.data.authenticated).toBe(false);
      expect(res.data.profile).toBeNull();
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
      const routedFork = await runSlopCli(['fork', 'nate/dronehunter']);
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
