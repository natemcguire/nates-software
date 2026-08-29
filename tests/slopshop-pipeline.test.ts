import { describe, it, expect } from 'vitest';
import {
  SlopshopPipelineEngine,
  normalizeRelativePath,
  validateFeaturePackage,
  generateUnifiedDiff,
  generateInversePatch,
  computeStableEvidenceDigest,
  FileModification
} from '../src/lib/slopshopPipeline';
import { onRequestGet, onRequestPost } from '../functions/api/pipeline';
import { createTestD1Database } from './fixtures/d1Harness';

describe('SLOPSHOP AI Feature Modification Pipeline & Production Preflight', () => {
  const engine = new SlopshopPipelineEngine('dronehunter');

  // ==========================================================================
  // 1. PATH NORMALIZATION & TRAVERSAL PROTECTION
  // ==========================================================================
  describe('1. Path Normalization & Traversal Protection', () => {
    it('should normalize valid relative paths with forward slashes and strip leading dots', () => {
      expect(normalizeRelativePath('src/weapons/Laser.ts')).toEqual({ normalized: 'src/weapons/Laser.ts' });
      expect(normalizeRelativePath('./src/weapons/Laser.ts')).toEqual({ normalized: 'src/weapons/Laser.ts' });
      expect(normalizeRelativePath('src//weapons///Laser.ts')).toEqual({ normalized: 'src/weapons/Laser.ts' });
      expect(normalizeRelativePath('src\\weapons\\Laser.ts')).toEqual({ normalized: 'src/weapons/Laser.ts' });
    });

    it('should reject path traversal attempts with ".."', () => {
      const res1 = normalizeRelativePath('../../etc/passwd');
      expect(res1.error).toContain('Path traversal detected');

      const res2 = normalizeRelativePath('src/../../../secret.env');
      expect(res2.error).toContain('Path traversal detected');

      const res3 = normalizeRelativePath('..');
      expect(res3.error).toContain('Path traversal detected');
    });

    it('should reject absolute paths', () => {
      const res1 = normalizeRelativePath('/etc/passwd');
      expect(res1.error).toContain('Absolute paths are not allowed');

      const res2 = normalizeRelativePath('C:/Windows/System32');
      expect(res2.error).toContain('Absolute paths are not allowed');
    });

    it('should reject null bytes in paths', () => {
      const res = normalizeRelativePath('src/weapons/\0exploit.ts');
      expect(res.error).toContain('Path contains null byte');
    });
  });

  // ==========================================================================
  // 2. DETERMINISTIC FEATURE-PACKAGE VALIDATION & COLLISION DETECTION
  // ==========================================================================
  describe('2. Deterministic Feature-Package Validation & Collision Detection', () => {
    it('should validate a clean feature package successfully', () => {
      const mods: FileModification[] = [
        {
          path: 'src/weapons/Laser.ts',
          content: 'export const Laser = { damage: 50 };',
          action: 'create'
        }
      ];

      const validation = validateFeaturePackage({
        appId: 'dronehunter',
        featureName: 'laser-cannon',
        prompt: 'Add laser cannon weapon',
        modifications: mods,
        migrationSql: 'CREATE TABLE IF NOT EXISTS weapon_stats (id TEXT PRIMARY KEY);'
      });

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.inspected.normalizedPaths).toEqual(['src/weapons/Laser.ts']);
      expect(validation.inspected.tables).toContain('weapon_stats');
      expect(validation.inspected.exports).toEqual([
        { path: 'src/weapons/Laser.ts', name: 'Laser', kind: 'const' }
      ]);
    });

    it('should detect duplicate target path collisions', () => {
      const mods: FileModification[] = [
        {
          path: 'src/weapons/Laser.ts',
          content: 'export const Laser = { damage: 50 };',
          action: 'create'
        },
        {
          path: './src/weapons/Laser.ts', // Redundant leading ./ resolves to duplicate
          content: 'export const Laser = { damage: 100 };',
          action: 'modify'
        }
      ];

      const validation = validateFeaturePackage({
        appId: 'dronehunter',
        featureName: 'laser-cannon',
        prompt: 'Add laser cannon weapon',
        modifications: mods
      });

      expect(validation.valid).toBe(false);
      const duplicateError = validation.errors.find(e => e.code === 'DUPLICATE_PATH');
      expect(duplicateError).toBeDefined();
      expect(duplicateError?.message).toContain('Duplicate target path detected');
    });

    it('should detect invalid and conflicting actions', () => {
      const mods: any[] = [
        {
          path: 'src/weapons/Laser.ts',
          content: 'export const Laser = 1;',
          action: 'invalid_action'
        }
      ];

      const validation = validateFeaturePackage({
        appId: 'dronehunter',
        featureName: 'laser-cannon',
        prompt: 'Add laser cannon',
        modifications: mods
      });

      expect(validation.valid).toBe(false);
      const actionError = validation.errors.find(e => e.code === 'CONFLICTING_ACTION');
      expect(actionError).toBeDefined();
    });

    it('should detect route handler collisions across files', () => {
      const mods: FileModification[] = [
        {
          path: 'functions/api/telemetry.ts',
          content: 'export const onRequestGet = async () => Response.json({ ok: true });',
          action: 'create'
        },
        {
          path: 'functions/api/telemetry/index.ts', // Collides on same route GET /api/telemetry
          content: 'export const onRequestGet = async () => Response.json({ ok: false });',
          action: 'create'
        }
      ];

      const validation = validateFeaturePackage({
        appId: 'dronehunter',
        featureName: 'telemetry',
        prompt: 'Add telemetry routes',
        modifications: mods
      });

      expect(validation.valid).toBe(false);
      const routeError = validation.errors.find(e => e.code === 'ROUTE_COLLISION');
      expect(routeError).toBeDefined();
      expect(routeError?.message).toContain('Route collision detected');
    });

    it('should detect duplicate named export collisions in the same file', () => {
      const mods: FileModification[] = [
        {
          path: 'src/hud/Radar.ts',
          content: `export const Radar = 1;\nexport function Radar() { return 2; }`,
          action: 'create'
        }
      ];

      const validation = validateFeaturePackage({
        appId: 'dronehunter',
        featureName: 'radar',
        prompt: 'Add radar',
        modifications: mods
      });

      expect(validation.valid).toBe(false);
      const exportError = validation.errors.find(e => e.code === 'EXPORT_COLLISION');
      expect(exportError).toBeDefined();
      expect(exportError?.message).toContain('Duplicate export identifier "Radar"');
    });

    it('should detect duplicate schema table collisions in migrations', () => {
      const migrationSql = `
        CREATE TABLE IF NOT EXISTS score_entries (id TEXT PRIMARY KEY, score INTEGER);
        CREATE TABLE score_entries (id TEXT PRIMARY KEY, extra TEXT);
      `;

      const validation = validateFeaturePackage({
        appId: 'dronehunter',
        featureName: 'leaderboard',
        prompt: 'Add leaderboard',
        modifications: [
          { path: 'src/db/scores.ts', content: 'export const Scores = {};', action: 'create' }
        ],
        migrationSql
      });

      expect(validation.valid).toBe(false);
      const schemaError = validation.errors.find(e => e.code === 'SCHEMA_COLLISION');
      expect(schemaError).toBeDefined();
      expect(schemaError?.message).toContain('Duplicate table creation collision for table "score_entries"');
    });

    it('should require exact before-content for every reversible modify or delete', () => {
      const validation = validateFeaturePackage({
        appId: 'dronehunter',
        featureName: 'unsafe-edit',
        prompt: 'Modify a file without its base content',
        modifications: [{ path: 'src/config.ts', content: 'changed', action: 'modify' }]
      });

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContainEqual(expect.objectContaining({ code: 'MISSING_BEFORE_CONTENT' }));
    });
  });

  // ==========================================================================
  // 3. REVERSIBLE FORWARD AND INVERSE UNIFIED PATCH GENERATION
  // ==========================================================================
  describe('3. Reversible Forward and Inverse Unified Patch Generation', () => {
    it('should generate forward unified diff and exact inverse patch for file creation', () => {
      const mods: FileModification[] = [
        {
          path: 'src/weapons/DualLaser.ts',
          content: 'line 1\nline 2\nline 3',
          action: 'create'
        }
      ];

      const forward = generateUnifiedDiff(mods);
      expect(forward.filesChanged).toBe(1);
      expect(forward.additions).toBe(3);
      expect(forward.deletions).toBe(0);
      expect(forward.rawDiff).toContain('diff --git a/src/weapons/DualLaser.ts b/src/weapons/DualLaser.ts');
      expect(forward.rawDiff).toContain('--- /dev/null');
      expect(forward.rawDiff).toContain('+++ b/src/weapons/DualLaser.ts');
      expect(forward.rawDiff).toContain('+line 1\n+line 2\n+line 3');

      // Inverse patch: should delete the created file
      const inverse = generateInversePatch(mods);
      expect(inverse.filesChanged).toBe(1);
      expect(inverse.additions).toBe(0);
      expect(inverse.deletions).toBe(3);
      expect(inverse.rawDiff).toContain('--- a/src/weapons/DualLaser.ts');
      expect(inverse.rawDiff).toContain('+++ /dev/null');
      expect(inverse.rawDiff).toContain('-line 1\n-line 2\n-line 3');
    });

    it('should generate forward unified diff and exact inverse patch for file modification', () => {
      const mods: FileModification[] = [
        {
          path: 'src/config.ts',
          previousContent: 'export const fireRate = 10;\nexport const sound = false;',
          content: 'export const fireRate = 25;\nexport const sound = true;',
          action: 'modify'
        }
      ];

      const forward = generateUnifiedDiff(mods);
      expect(forward.filesChanged).toBe(1);
      expect(forward.rawDiff).toContain('-export const fireRate = 10;');
      expect(forward.rawDiff).toContain('+export const fireRate = 25;');
      expect(forward.rawDiff).toContain('-export const sound = false;');
      expect(forward.rawDiff).toContain('+export const sound = true;');

      // Inverse patch: should swap changes back to original
      const inverse = generateInversePatch(mods);
      expect(inverse.filesChanged).toBe(1);
      expect(inverse.rawDiff).toContain('-export const fireRate = 25;');
      expect(inverse.rawDiff).toContain('+export const fireRate = 10;');
      expect(inverse.rawDiff).toContain('-export const sound = true;');
      expect(inverse.rawDiff).toContain('+export const sound = false;');
    });

    it('should generate forward unified diff and exact inverse patch for file deletion', () => {
      const mods: FileModification[] = [
        {
          path: 'src/obsolete.ts',
          previousContent: 'export const legacy = true;',
          content: '',
          action: 'delete'
        }
      ];

      const forward = generateUnifiedDiff(mods);
      expect(forward.deletions).toBe(1);
      expect(forward.additions).toBe(0);
      expect(forward.rawDiff).toContain('deleted file mode 100644');
      expect(forward.rawDiff).toContain('-export const legacy = true;');

      // Inverse patch: should recreate the deleted file
      const inverse = generateInversePatch(mods);
      expect(inverse.additions).toBe(1);
      expect(inverse.deletions).toBe(0);
      expect(inverse.rawDiff).toContain('new file mode 100644');
      expect(inverse.rawDiff).toContain('+export const legacy = true;');
    });

    it('should use a bounded reversible full-file patch for large modifications', () => {
      const before = Array.from({ length: 1_001 }, (_, i) => `before ${i}`).join('\n');
      const after = Array.from({ length: 1_001 }, (_, i) => `after ${i}`).join('\n');
      const mods: FileModification[] = [{
        path: 'src/large-generated-file.ts',
        previousContent: before,
        content: after,
        action: 'modify'
      }];

      const forward = generateUnifiedDiff(mods);
      const inverse = generateInversePatch(mods);
      expect(forward.deletions).toBe(1_001);
      expect(forward.additions).toBe(1_001);
      expect(inverse.rawDiff).toContain('-after 1000');
      expect(inverse.rawDiff).toContain('+before 1000');
    });
  });

  // ==========================================================================
  // 4. STABLE SHA-256 CRYPTOGRAPHIC EVIDENCE DIGEST
  // ==========================================================================
  describe('4. Stable SHA-256 Cryptographic Evidence Digest', () => {
    it('should generate deterministic sha256 digest stable across runs and orderings', () => {
      const modA: FileModification = {
        path: 'src/a.ts',
        content: 'export const a = 1;',
        action: 'create'
      };
      const modB: FileModification = {
        path: 'src/b.ts',
        content: 'export const b = 2;',
        action: 'create'
      };

      const digest1 = computeStableEvidenceDigest({
        appId: 'dronehunter',
        featureName: 'dual-weapons',
        prompt: 'Add weapons a and b',
        modifications: [modA, modB],
        migrationSql: 'CREATE TABLE t (id INT);'
      });

      const digest2 = computeStableEvidenceDigest({
        appId: 'dronehunter',
        featureName: 'dual-weapons',
        prompt: 'Add weapons a and b',
        modifications: [modB, modA], // Swapped ordering!
        migrationSql: 'CREATE TABLE t (id INT);'
      });

      expect(digest1).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(digest1).toBe(digest2); // Stable for same input!
    });

    it('should produce different digest when prompt or code modifications change', () => {
      const digestBase = computeStableEvidenceDigest({
        appId: 'dronehunter',
        featureName: 'dual-weapons',
        prompt: 'Add weapons',
        modifications: [{ path: 'src/a.ts', content: 'export const a = 1;', action: 'create' }]
      });

      const digestChangedCode = computeStableEvidenceDigest({
        appId: 'dronehunter',
        featureName: 'dual-weapons',
        prompt: 'Add weapons',
        modifications: [{ path: 'src/a.ts', content: 'export const a = 999;', action: 'create' }]
      });

      expect(digestBase).not.toBe(digestChangedCode);
    });
  });

  // ==========================================================================
  // 5. TRUTHFUL EXECUTION & ZERO FABRICATED SUCCESS
  // ==========================================================================
  describe('5. Truthful Execution & Zero Fabricated Success', () => {
    it('testInSandbox should NOT fabricate passing evidence when runner is not executing on host', () => {
      const testResult = engine.testInSandbox('/non-existent/worktree/path', 8);
      expect(testResult.passed).toBe(false);
      expect(testResult.passedTests).toBe(0);
      expect(testResult.testLogs).toContain('configured local runner');
      expect(testResult.evidenceDigest).toBe('');
    });

    it('applyMigrations should handle empty migrations cleanly and report truthful status', () => {
      const resEmpty = engine.applyMigrations('/tmp/worktree');
      expect(resEmpty.success).toBe(true);
      expect(resEmpty.log).toContain('No migrations to apply');

      const resWithSql = engine.applyMigrations('/tmp/non-existent-worktree', 'CREATE TABLE test (id INT);');
      expect(resWithSql.success).toBe(false);
      expect(resWithSql.error).toBeDefined();
    });

    it('publishFeatureRef should NOT invent fake commit SHAs when git operations cannot run', () => {
      const diff = { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] };
      const testEvidence = { passed: false, totalTests: 0, passedTests: 0, failedTests: 0, durationMs: 0, testLogs: '', evidenceDigest: '' };

      const res = engine.publishFeatureRef({
        worktreePath: '/tmp/non-existent-worktree',
        appId: 'dronehunter',
        featureName: 'laser-cannon',
        baseSha: '5c030af',
        diff,
        testEvidence
      });

      expect(res.success).toBe(false);
      expect(res.commitSha).toBeUndefined();
      expect(res.error).toBeDefined();
    });

    it('landFeatureRef should truthfully reject in-browser/edge CAS merges', () => {
      const res = engine.landFeatureRef('refs/features/dual-laser/abc123456789');
      expect(res.success).toBe(false);
      expect(res.error).toBe('CAS_EDGE_UNSUPPORTED');
      expect(res.message).toContain('cannot be executed directly from browser');
      expect(res.mergedSha).toBeUndefined();
      expect(res.transactionId).toBeUndefined();
    });

    it('revertFeatureRef should generate real inverse patch when modifications are provided', () => {
      const mods: FileModification[] = [
        {
          path: 'src/weapons/Laser.ts',
          content: 'export const Laser = 2;',
          previousContent: 'export const Laser = 1;',
          action: 'modify'
        }
      ];

      const res = engine.revertFeatureRef('abc123456789', { modifications: mods });
      expect(res.success).toBe(true);
      expect(res.rollbackRef).toBe('refs/heads/rollback-abc123456789');
      expect(res.reverseDiff).toContain('-export const Laser = 2;');
      expect(res.reverseDiff).toContain('+export const Laser = 1;');
    });

    it('revertFeatureRef should reject revert when no modifications or local git exist', () => {
      const res = engine.revertFeatureRef('abc123456789');
      expect(res.success).toBe(false);
      expect(res.error).toBe('REVERT_EDGE_UNSUPPORTED');
    });
  });

  // ==========================================================================
  // 6. PIPELINE API PREFLIGHT & REJECTION CONTRACTS (/api/pipeline)
  // ==========================================================================
  describe('6. Pipeline API Preflight & Rejection Contracts (/api/pipeline)', () => {
    it('GET /api/pipeline should return preflight status, mode, and capabilities', async () => {
      const res = await onRequestGet();
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.mode).toBe('preflight_and_planning_only');
      expect(json.status).toBe('online');
      expect(json.stages.length).toBeGreaterThanOrEqual(5);
      expect(json.landingPolicy).toContain('Edge runtime cannot execute Git');
    });

    it('POST /api/pipeline should execute preflight and return awaiting_local_execution', async () => {
      const req = new Request('https://nates-software.com/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'dronehunter',
          featureName: 'laser-shotgun',
          prompt: 'Add laser shotgun with rapid burst reload',
          agentName: 'claude-code',
          modifications: [{
            path: 'src/features/laser-shotgun.ts',
            content: 'export const laserShotgun = true;',
            action: 'create'
          }]
        })
      });

      const res = await onRequestPost({ request: req });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('awaiting_local_execution');
      expect(json.validation.valid).toBe(true);
      expect(json.diff.filesChanged).toBeGreaterThanOrEqual(1);
      expect(json.inverseDiff.filesChanged).toBeGreaterThanOrEqual(1);
      expect(json.evidenceDigest).toMatch(/^sha256:/);
      expect(json.checkout).toBeUndefined();
    });

    it('POST /api/pipeline should reject invalid package with 400 and validation errors', async () => {
      const req = new Request('https://nates-software.com/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'dronehunter',
          featureName: 'exploit-test',
          prompt: 'Try path traversal',
          modifications: [
            {
              path: '../../etc/passwd',
              content: 'root:x:0:0',
              action: 'create'
            }
          ]
        })
      });

      const res = await onRequestPost({ request: req });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.validation.valid).toBe(false);
      expect(json.validation.errors.some((e: any) => e.code === 'PATH_TRAVERSAL')).toBe(true);
    });

    it('POST /api/pipeline should reject landing action with 400 and truthful edge error', async () => {
      const req = new Request('https://nates-software.com/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'land',
          featureRef: 'refs/features/laser-shotgun/abc123',
          targetRef: 'refs/heads/main'
        })
      });

      const res = await onRequestPost({ request: req });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.status).toBe('rejected_edge_runtime_unsupported');
      expect(json.error).toContain('Edge runtime cannot execute Git land operations');
    });

    it('POST /api/pipeline should reject revert action with 400 and truthful edge error', async () => {
      const req = new Request('https://nates-software.com/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revert',
          commitSha: '8f4a21e'
        })
      });

      const res = await onRequestPost({ request: req });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.status).toBe('rejected_edge_runtime_unsupported');
      expect(json.error).toContain('Edge runtime cannot execute Git revert operations');
    });

    it('queues one pinned RIG verification workflow without claiming preview readiness', async () => {
      const ctx = await createTestD1Database({ foreignKeys: true });
      const targetOid = 'a'.repeat(40);
      const resultOid = 'b'.repeat(40);
      await ctx.d1.prepare(`INSERT INTO repositories
        (id,owner_user_id,slug,visibility,default_ref,storage_key,status)
        VALUES ('repo-verify','usr_nate','verify-me','private','refs/heads/main','repositories/repo-verify','active')`).run();
      await ctx.d1.prepare(`INSERT INTO repository_refs (repository_id,ref_name,commit_oid,version)
        VALUES ('repo-verify','refs/heads/main',?,1),
               ('repo-verify','refs/heads/feature-verify',?,1)`).bind(targetOid, resultOid).run();
      const env = {
        DB: ctx.d1,
        RIG_VERIFICATION_IMAGE_DIGEST: `node@sha256:${'c'.repeat(64)}`,
        RIG_TOOLCHAIN_VERSION: 'rig-toolchain-1',
        RIG_TEST_POLICY_VERSION: 'repo-native-1'
      };
      const request = () => new Request('https://nates-software.com/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
        body: JSON.stringify({
          action: 'request_verification', targetRepositoryId: 'repo-verify',
          targetRef: 'refs/heads/main', sourceRef: 'refs/heads/feature-verify',
          idempotencyKey: 'verify-feature-001', sourceManifestDigest: `sha256:${'d'.repeat(64)}`,
          buildCommand: 'npm run build', testCommand: 'npm test', instructions: 'Verify the feature branch.'
        })
      });
      const first = await onRequestPost({ request: request(), env });
      const firstBody: any = await first.json();
      const second = await onRequestPost({ request: request(), env });
      expect(first.status).toBe(202);
      expect(firstBody).toMatchObject({ success: true, idempotent: false,
        verification: { jobStatus: 'queued', attemptStatus: 'preparing', buildStatus: 'queued' } });
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ success: true, idempotent: true });
      expect(await ctx.d1.prepare("SELECT count(*) AS count FROM forge_outbox_events WHERE event_type='build.verification_requested'").first('count')).toBe(1);
      expect(await ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind(firstBody.verification.mergeAttemptId).first('status')).toBe('preparing');
    });

    it('fails closed when RIG verification policy is absent', async () => {
      const response = await onRequestPost({
        request: new Request('https://nates-software.com/api/pipeline', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' },
          body: JSON.stringify({ action: 'request_verification' })
        }),
        env: { DB: (await createTestD1Database()).d1 }
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ success: false, error: 'RIG verification policy is not configured.' });
    });
  });
});
