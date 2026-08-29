import { describe, it, expect } from 'vitest';
import {
  handleInit,
  handleFork,
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

describe('SLOP CLI — "Go Fork, and Multiply" Developer Loop', () => {

  describe('slop init [name]', () => {
    it('should initialize project with zero prompts and configure git remote slop', () => {
      const res = handleInit(['my-awesome-game', '--title=My Awesome Game', '--price=20']);
      expect(res.success).toBe(true);
      expect(res.command).toBe('init');
      expect(res.data.appId).toBe('my-awesome-game');
      expect(res.data.name).toBe('My Awesome Game');
      expect(res.data.price).toBe(20);
      expect(res.data.remoteUrl).toContain('ssh://git@gitsmith.nates-software.com:2222/nate/my-awesome-game.git');
    });

    it('should default cleanly without arguments', () => {
      const res = handleInit();
      expect(res.success).toBe(true);
      expect(res.command).toBe('init');
      expect(res.data.price).toBe(15);
      expect(res.data.remoteUrl).toBeDefined();
    });
  });

  describe('slop fork <slug>', () => {
    it('should fork default slug (nate/dronehunter) into isolated worktree', () => {
      const res = handleFork();
      expect(res.success).toBe(true);
      expect(res.command).toBe('fork');
      expect(res.data.slug).toBe('nate/dronehunter');
      expect(res.data.appId).toBe('dronehunter');
      expect(res.data.port).toBeGreaterThanOrEqual(3001);
      expect(res.data.memoryCapMb).toBe(256);
      expect(res.data.worktreePath).toContain('/tmp/slop-dronehunter-');
      expect(res.message).not.toContain('agy');
      const engineInstructions = getEngineStartInstructions(res.data.worktreePath);
      expect(engineInstructions).toContainEqual(expect.stringContaining('Antigravity (AGY)'));
      expect(engineInstructions).toContainEqual(expect.stringContaining('Claude Code'));
      expect(engineInstructions).toContainEqual(expect.stringContaining('Aider'));
      expect(engineInstructions).toContainEqual(expect.stringContaining('Cursor / VS Code'));
    });

    it('should fork custom app slug into isolated worktree', () => {
      const res = handleFork('nate/certified-mailer');
      expect(res.success).toBe(true);
      expect(res.data.slug).toBe('nate/certified-mailer');
      expect(res.data.appId).toBe('certified-mailer');
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
    it('should package app and queue for 12:01 AM UTC daily drop', () => {
      const res = handleDrop(['dronehunter', '--name=DroneHunter 95', '--price=15']);
      expect(res.success).toBe(true);
      expect(res.command).toBe('drop');
      expect(res.data.appId).toBe('dronehunter');
      expect(res.data.priceCents).toBe(1500);
      expect(res.data.batch).toBe(85);
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

    it('should run multi-repetition benchmark and compute reproducible verification', async () => {
      const res = await handleDyno(['--task=neutral_cli_arg_parser', '--solve', '--bench', '--quiet']);
      expect(res.success).toBe(true);
      expect(res.data.run.repetition).toBe(2);
      expect(res.data.run.verification_status).toBe('reproducible');
      expect(res.data.summary.dynoScore).toBe(1000);
    });

    it('should handle non-existent task key with honest error', async () => {
      const res = await handleDyno(['--task=non_existent_fixture', '--quiet']);
      expect(res.success).toBe(false);
      expect(res.message).toContain('not found');
    });
  });

  describe('slop status', () => {
    it('should inspect micro-containers, memory limits, and active ports', () => {
      const res = handleStatus();
      expect(res.success).toBe(true);
      expect(res.command).toBe('status');
      expect(res.data.containers.length).toBeGreaterThan(0);
      expect(res.data.availablePorts.length).toBeGreaterThan(0);
    });
  });

  describe('slop list', () => {
    it('should query 12:01 AM daily drops board', () => {
      const res = handleList();
      expect(res.success).toBe(true);
      expect(res.command).toBe('list');
      expect(res.data.drops.length).toBe(3);
      expect(res.data.batch).toBe(84);
    });
  });

  describe('slop shelf', () => {
    it('should display owned software titles and cryptographic license keys', () => {
      const res = handleShelf();
      expect(res.success).toBe(true);
      expect(res.command).toBe('shelf');
      expect(res.data.totalOwned).toBe(3);
    });
  });

  describe('slop login', () => {
    it('should authenticate maker handle and SSH public key', () => {
      const res = handleLogin();
      expect(res.success).toBe(true);
      expect(res.command).toBe('login');
      expect(res.data.handle).toBe('@nate');
      expect(res.data.username).toBe('nate');
      expect(res.data.isVerified).toBe(true);
    });
  });

  describe('slop help', () => {
    it('should output help manual and command index', () => {
      const res = printHelp();
      expect(res.success).toBe(true);
      expect(res.message).toContain('Go Fork, and Multiply');
      expect(res.message).toContain('slop init');
      expect(res.message).toContain('slop fork');
      expect(res.message).toContain('slop push');
      expect(res.message).toContain('slop dyno');
    });
  });

  describe('runSlopCli router', () => {
    it('should route all commands cleanly', async () => {
      expect((await runSlopCli(['init', 'test-app'])).success).toBe(true);
      expect((await runSlopCli(['fork', 'nate/dronehunter'])).success).toBe(true);
      expect((await runSlopCli(['test'])).success).toBe(true);
      expect((await runSlopCli(['push'])).command).toBe('push');
      expect((await runSlopCli(['drop', 'dronehunter'])).success).toBe(true);
      expect((await runSlopCli(['publish', 'dronehunter'])).success).toBe(true);
      const dynoRes = await runSlopCli(['dyno', '--task=neutral_cli_arg_parser', '--solve', '--quiet']);
      expect(dynoRes.success).toBe(true);
      expect((await runSlopCli(['status'])).success).toBe(true);
      expect((await runSlopCli(['list'])).success).toBe(true);
      expect((await runSlopCli(['shelf'])).success).toBe(true);
      expect((await runSlopCli(['login'])).success).toBe(true);
      expect((await runSlopCli(['help'])).success).toBe(true);
    });

    it('should handle unknown command with error', async () => {
      const res = await runSlopCli(['invalid-unknown-cmd']);
      expect(res.success).toBe(false);
      expect(res.message).toContain('Unknown command');
    });
  });
});
