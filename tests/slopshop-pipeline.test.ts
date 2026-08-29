import { describe, it, expect } from 'vitest';
import { SlopshopPipelineEngine } from '../src/lib/slopshopPipeline';
import { onRequestGet, onRequestPost } from '../functions/api/pipeline';

describe('SLOPSHOP AI Feature Modification Pipeline', () => {
  const engine = new SlopshopPipelineEngine('dronehunter');

  describe('1. Worktree & Target Commit Checkout', () => {
    it('should provision an isolated worktree directory and resolve target commit', () => {
      const result = engine.checkoutWorktree({
        appId: 'dronehunter',
        baseCommitSha: '5c030af'
      });

      expect(result.appId).toBe('dronehunter');
      expect(result.baseSha).toBe('5c030af');
      expect(result.worktreePath).toContain('/tmp/slop-pipeline-dronehunter-');
    });
  });

  describe('2. AI Agent Code & Migration Modifications', () => {
    it('should apply AI generated file modifications and SQL migrations', () => {
      const mods = [
        {
          path: 'src/weapons/DualLaserShotgun.ts',
          content: 'export const DualLaser = { damage: 150, fireRate: 4 };',
          action: 'create' as const
        }
      ];

      const res = engine.applyModifications('/tmp/test-worktree', {
        agentName: 'claude-code',
        featureName: 'dual-laser',
        prompt: 'Add dual laser shotgun with high damage',
        modifications: mods,
        migrationSql: 'CREATE TABLE IF NOT EXISTS weapon_telemetry (id TEXT PRIMARY KEY);'
      });

      expect(res.appliedFiles.length).toBeGreaterThanOrEqual(2);
      expect(res.migrationFile).toContain('migrations/');
    });
  });

  describe('3. Real Git Unified Diff Generation', () => {
    it('should generate accurate unified diffs from modifications', () => {
      const mods = [
        {
          path: 'src/weapons/Laser.ts',
          content: 'line 1\nline 2\nline 3',
          action: 'create' as const
        }
      ];

      const diff = engine.produceDiff('/tmp/test-worktree', mods);
      expect(diff.filesChanged).toBe(1);
      expect(diff.additions).toBe(3);
      expect(diff.rawDiff).toContain('diff --git a/src/weapons/Laser.ts');
      expect(diff.modifiedFiles).toContain('src/weapons/Laser.ts');
    });
  });

  describe('4. Database Schema Migration Application', () => {
    it('should apply SQL migrations and report success', () => {
      const res = engine.applyMigrations('/tmp/test-worktree', 'CREATE TABLE IF NOT EXISTS scores (score INTEGER);');
      expect(res.success).toBe(true);
      expect(res.log).toBeDefined();
    });

    it('should handle empty migrations cleanly', () => {
      const res = engine.applyMigrations('/tmp/test-worktree');
      expect(res.success).toBe(true);
      expect(res.log).toContain('No migrations');
    });
  });

  describe('5. Sandboxed Build & Test Evidence Verification', () => {
    it('should run sandbox tests and generate verifiable SHA-256 evidence digest', () => {
      const testResult = engine.testInSandbox('/tmp/test-worktree', 12);
      expect(testResult.passed).toBe(true);
      expect(testResult.totalTests).toBe(12);
      expect(testResult.passedTests).toBe(12);
      expect(testResult.evidenceDigest).toMatch(/^sha256:/);
      expect(testResult.testLogs).toContain('Syntax AST validation');
    });
  });

  describe('6. Immutable Feature Ref Publishing', () => {
    it('should publish immutable refs/features/<name>/<sha> with author and test evidence', () => {
      const diff = {
        rawDiff: '+ code',
        filesChanged: 1,
        additions: 10,
        deletions: 0,
        modifiedFiles: ['src/weapons/Laser.ts']
      };

      const testEvidence = engine.testInSandbox('/tmp/test-worktree', 8);

      const published = engine.publishFeatureRef({
        worktreePath: '/tmp/test-worktree',
        appId: 'dronehunter',
        featureName: 'dual-laser',
        baseSha: '5c030af',
        diff,
        testEvidence,
        committer: 'nate'
      });

      expect(published.success).toBe(true);
      expect(published.featureRef).toMatch(/^refs\/features\/dual-laser\/[a-f0-9]{12}$/);
      expect(published.author).toBe('nate');
      expect(published.parentSha).toBe('5c030af');
      expect(published.migrationApplied).toBe(true);
    });
  });

  describe('7. Landing & Reverting Results', () => {
    it('should land feature ref with CAS merge update', () => {
      const res = engine.landFeatureRef('refs/features/dual-laser/abc123456789');
      expect(res.success).toBe(true);
      expect(res.targetRef).toBe('refs/heads/main');
      expect(res.mergedSha.length).toBe(12);
      expect(res.transactionId).toContain('cas-merge-');
    });

    it('should generate clean rollback patch on revert', () => {
      const res = engine.revertFeatureRef('abc123456789');
      expect(res.success).toBe(true);
      expect(res.rollbackRef).toBe('refs/heads/rollback-abc123456789');
      expect(res.reverseDiff).toContain('--- a/feature.ts');
    });
  });

  describe('8. Pipeline API Endpoints (/api/pipeline)', () => {
    it('GET /api/pipeline should return pipeline stage list and status', async () => {
      const res = await onRequestGet();
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.stages.length).toBe(7);
      expect(json.status).toBe('online');
    });

    it('POST /api/pipeline should execute complete end-to-end pipeline', async () => {
      const req = new Request('https://nates-software.com/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'dronehunter',
          featureName: 'laser-shotgun',
          prompt: 'Add laser shotgun with rapid burst reload',
          agentName: 'claude-code',
          committer: 'nate'
        })
      });

      const res = await onRequestPost({ request: req, env: {} });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.checkout).toBeDefined();
      expect(json.diff.filesChanged).toBeGreaterThanOrEqual(1);
      expect(json.testResult.passed).toBe(true);
      expect(json.featureResult.featureRef).toContain('refs/features/laser-shotgun');
    });

    it('POST /api/pipeline should support landing action', async () => {
      const req = new Request('https://nates-software.com/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'land',
          featureRef: 'refs/features/laser-shotgun/abc123',
          targetRef: 'refs/heads/main'
        })
      });

      const res = await onRequestPost({ request: req, env: {} });
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.result.targetRef).toBe('refs/heads/main');
    });

    it('POST /api/pipeline should support revert action', async () => {
      const req = new Request('https://nates-software.com/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revert',
          commitSha: '8f4a21e'
        })
      });

      const res = await onRequestPost({ request: req, env: {} });
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.result.rollbackRef).toBe('refs/heads/rollback-8f4a21e');
    });
  });
});
