import { describe, it, expect } from 'vitest';
import {
  handleFork,
  handlePush,
  handleMod,
  handleDyno,
  handleTest,
  handleStatus,
  handleList,
  handleShelf,
  handleLogin,
  printHelp,
  runSlopCli
} from '../bin/slop.ts';

describe('SLOP CLI Core Command Handlers', () => {

  describe('slop fork <slug>', () => {
    it('should fork default slug (nate/dronehunter) into isolated worktree with SQLite volume', () => {
      const res = handleFork();
      expect(res.success).toBe(true);
      expect(res.command).toBe('fork');
      expect(res.data.slug).toBe('nate/dronehunter');
      expect(res.data.appId).toBe('dronehunter');
      expect(res.data.port).toBeGreaterThanOrEqual(3001);
      expect(res.data.memoryCapMb).toBe(256);
      expect(res.data.sqlitePath).toBe('/data/dronehunter.sqlite');
      expect(res.data.worktreePath).toContain('/tmp/slop-dronehunter-');
    });

    it('should fork custom app slug into isolated worktree', () => {
      const res = handleFork('nate/certified-mailer');
      expect(res.success).toBe(true);
      expect(res.data.slug).toBe('nate/certified-mailer');
      expect(res.data.appId).toBe('certified-mailer');
      expect(res.data.sqlitePath).toBe('/data/certified-mailer.sqlite');
    });
  });

  describe('slop push', () => {
    it('should run test proofs, verify single-file SQLite WAL, and push CAS ref', () => {
      const res = handlePush();
      expect(res.success).toBe(true);
      expect(res.command).toBe('push');
      expect(res.data.testsPassed).toBe(true);
      expect(res.data.walVerified).toBe(true);
      expect(res.data.sha).toBe('5c030af');
      expect(res.data.deployTimeSec).toBeLessThan(5);
    });
  });

  describe('slop mod <feature>', () => {
    it('should splice known preset feature (feat_dronehunter_scores)', () => {
      const res = handleMod('feat_dronehunter_scores');
      expect(res.success).toBe(true);
      expect(res.command).toBe('mod');
      expect(res.data.feature.id).toBe('feat_dronehunter_scores');
      expect(res.data.astNodesAdded).toBe(16);
      expect(res.data.cleanlinessScore).toBe(99.8);
      expect(res.data.tablesCreated).toContain('high_scores');
    });

    it('should splice feature using short alias (dronehunter-scores)', () => {
      const res = handleMod('dronehunter-scores');
      expect(res.success).toBe(true);
      expect(res.data.feature.id).toBe('feat_dronehunter_scores');
    });

    it('should splice pdf-raster feature (pdf-rasterizer)', () => {
      const res = handleMod('pdf-rasterizer');
      expect(res.success).toBe(true);
      expect(res.data.feature.id).toBe('feat_pdf_raster');
      expect(res.data.tablesCreated).toContain('pdf_raster_caches');
    });

    it('should dynamically create and weld valid custom feature mod', () => {
      const res = handleMod('custom-soundtrack');
      expect(res.success).toBe(true);
      expect(res.data.feature.id).toBe('feat_custom-soundtrack');
    });

    it('should fail gracefully when feature identifier is missing', () => {
      const res = handleMod(undefined);
      expect(res.success).toBe(false);
      expect(res.message).toContain('Feature identifier required');
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

  describe('slop test', () => {
    it('should run and pass all sovereign verification proofs', () => {
      const res = handleTest();
      expect(res.success).toBe(true);
      expect(res.command).toBe('test');
      expect(res.data.passedProofs).toBe(5);
      expect(res.data.totalProofs).toBe(5);
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
      expect(res.message).toContain('Official SLOP CLI');
      expect(res.message).toContain('slop fork');
      expect(res.message).toContain('slop push');
      expect(res.message).toContain('slop mod');
    });
  });

  describe('runSlopCli router', () => {
    it('should route all commands cleanly', () => {
      expect(runSlopCli(['fork', 'nate/dronehunter']).success).toBe(true);
      expect(runSlopCli(['push']).success).toBe(true);
      expect(runSlopCli(['mod', 'feat_dronehunter_scores']).success).toBe(true);
      expect(runSlopCli(['dyno', '--bench']).success).toBe(true);
      expect(runSlopCli(['test']).success).toBe(true);
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
