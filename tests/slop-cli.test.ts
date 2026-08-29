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
  runSlopCli
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
    it('should measure local AI hardware velocity', () => {
      const res = handleDyno(false);
      expect(res.success).toBe(true);
      expect(res.command).toBe('dyno');
      expect(res.data.tokensPerSec).toBeGreaterThan(100);
      expect(res.data.grade).toContain('Grade A+');
    });

    it('should run extended benchmark passes when benchFlag is true', () => {
      const res = handleDyno(true);
      expect(res.success).toBe(true);
      expect(res.data.tokensPerSec).toBe(168.2);
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
    });
  });

  describe('runSlopCli router', () => {
    it('should route all commands cleanly', () => {
      expect(runSlopCli(['init', 'test-app']).success).toBe(true);
      expect(runSlopCli(['fork', 'nate/dronehunter']).success).toBe(true);
      expect(runSlopCli(['test']).success).toBe(true);
      expect(runSlopCli(['push']).command).toBe('push');
      expect(runSlopCli(['drop', 'dronehunter']).success).toBe(true);
      expect(runSlopCli(['publish', 'dronehunter']).success).toBe(true);
      expect(runSlopCli(['dyno', '--bench']).success).toBe(true);
      expect(runSlopCli(['status']).success).toBe(true);
      expect(runSlopCli(['list']).success).toBe(true);
      expect(runSlopCli(['shelf']).success).toBe(true);
      expect(runSlopCli(['login']).success).toBe(true);
      expect(runSlopCli(['help']).success).toBe(true);
    });

    it('should handle unknown command with error', () => {
      const res = runSlopCli(['invalid-unknown-cmd']);
      expect(res.success).toBe(false);
      expect(res.message).toContain('Unknown command');
    });
  });
});
