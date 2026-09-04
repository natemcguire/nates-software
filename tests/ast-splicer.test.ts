import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  parseAndValidateSource,
  transformSourceWithAst
} from '../src/lib/slopshopAstEngine.ts';
import {
  executeSlopMod,
  verifyBaseGitSha,
  verifyPathAndSymlinkContainment,
  verifyPreviousFileStates,
  applyModificationsAtomically,
  rollbackModifications,
  resolveRepoTestCommand,
  executeRepoTestsWithoutShellInjection,
  buildTestEnvironment,
  computeSha256,
  type VersionedFeatureManifest
} from '../src/lib/slopshopModEngine.ts';
import { handleMod } from '../bin/slop.ts';

describe('SLOPSHOP AST Splicer & Local Worktree Execution Boundary', () => {
  let tempWorktree: string;
  let baseCommitSha: string;

  beforeEach(() => {

    tempWorktree = mkdtempSync(join(tmpdir(), 'slop-ast-test-'));
    execSync('git init -b main', { cwd: tempWorktree, stdio: 'pipe' });
    execSync('git config user.name "Test Developer"', { cwd: tempWorktree, stdio: 'pipe' });
    execSync('git config user.email "dev@nates-software.com"', { cwd: tempWorktree, stdio: 'pipe' });

    writeFileSync(join(tempWorktree, 'package.json'), JSON.stringify({
      name: 'test-app',
      version: '1.0.0',
      scripts: {
        test: 'node -e "process.exit(0)"'
      }
    }, null, 2));

    writeFileSync(join(tempWorktree, 'slop.json'), JSON.stringify({
      name: 'test-app',
      price: 15,
      testCommand: ['node', '-e', 'process.exit(0)']
    }, null, 2));

    mkdirSync(join(tempWorktree, 'src'), { recursive: true });
    writeFileSync(join(tempWorktree, 'src', 'index.ts'), 'export const VERSION = "1.0.0";\nexport function main() { return 42; }\n');
    writeFileSync(join(tempWorktree, 'src', 'config.ts'), 'export const config = { enabled: true, mode: "fast" };\n');

    execSync('git add -A', { cwd: tempWorktree, stdio: 'pipe' });
    execSync('git commit -m "feat(init): base commit"', { cwd: tempWorktree, stdio: 'pipe' });
    baseCommitSha = execSync('git rev-parse HEAD', { cwd: tempWorktree, encoding: 'utf-8' }).trim();
  });

  afterEach(() => {
    if (existsSync(tempWorktree)) {
      rmSync(tempWorktree, { recursive: true, force: true });
    }
  });

  describe('1. TypeScript Compiler Parser AST Validation', () => {
    it('should correctly parse valid TypeScript and extract named, variable, and function exports', () => {
      const tsCode = `
        export const API_PORT = 3004;
        export let active = true;
        export function calculateScore(hits: number, misses: number): number {
          return hits * 10 - misses * 5;
        }
        export class GameSession {
          constructor(public id: string) {}
        }
        export type PlayerId = string;
        export interface PlayerStats {
          score: number;
          accuracy: number;
        }
        export enum GameMode {
          EASY = 'EASY',
          HARD = 'HARD'
        }
        export namespace GameUtils {
          export const helper = 1;
        }
        const internal = 'hidden';
        export { internal as exportedInternal };
      `;

      const res = parseAndValidateSource('src/game.ts', tsCode);
      expect(res.valid).toBe(true);
      expect(res.syntaxErrors).toHaveLength(0);

      const exportNames = res.exports.map(e => e.name);
      expect(exportNames).toContain('API_PORT');
      expect(exportNames).toContain('active');
      expect(exportNames).toContain('calculateScore');
      expect(exportNames).toContain('GameSession');
      expect(exportNames).toContain('PlayerId');
      expect(exportNames).toContain('PlayerStats');
      expect(exportNames).toContain('GameMode');
      expect(exportNames).toContain('GameUtils');
      expect(exportNames).toContain('exportedInternal');
      expect(exportNames).not.toContain('internal');
    });

    it('should detect TypeScript syntax errors with exact line and column diagnostic positions', () => {
      const invalidCode = `
        export const valid = 1;
        export function broken( {
          return ;
      `;

      const res = parseAndValidateSource('src/broken.ts', invalidCode);
      expect(res.valid).toBe(false);
      expect(res.syntaxErrors.length).toBeGreaterThan(0);
      expect(res.syntaxErrors[0].file).toBe('src/broken.ts');
      expect(res.syntaxErrors[0].line).toBeGreaterThanOrEqual(2);
      expect(res.syntaxErrors[0].column).toBeGreaterThanOrEqual(1);
      expect(res.syntaxErrors[0].message).toBeDefined();
    });

    it('should detect duplicate export identifier collisions within the same file', () => {
      const duplicateCode = `
        export const Radar = { active: true };
        export function Radar() {
          return 'conflict';
        }
      `;

      const res = parseAndValidateSource('src/radar.ts', duplicateCode);
      expect(res.valid).toBe(false);
      expect(res.collisions.length).toBeGreaterThan(0);
      expect(res.collisions[0].code).toBe('EXPORT_COLLISION');
      expect(res.collisions[0].message).toContain('Duplicate export identifier "Radar"');
      expect(res.collisions[0].path).toBe('src/radar.ts');
    });

    it('should parse TSX/JSX components without errors', () => {
      const tsxCode = `
        import React from 'react';
        export interface ButtonProps {
          label: string;
          onClick: () => void;
        }
        export const ActionButton: React.FC<ButtonProps> = ({ label, onClick }) => {
          return <button onClick={onClick} className="btn-retro">{label}</button>;
        };
        export default ActionButton;
      `;

      const res = parseAndValidateSource('src/components/ActionButton.tsx', tsxCode);
      expect(res.valid).toBe(true);
      expect(res.syntaxErrors).toHaveLength(0);
      expect(res.exports.map(e => e.name)).toContain('ActionButton');
      expect(res.exports.map(e => e.name)).toContain('default');
    });

    it('should handle non-TypeScript files (JSON, Markdown, SQL) safely', () => {
      const resJson = parseAndValidateSource('data/schema.sql', 'CREATE TABLE test (id TEXT PRIMARY KEY);');
      expect(resJson.valid).toBe(true);
      expect(resJson.exports).toHaveLength(0);
      expect(resJson.syntaxErrors).toHaveLength(0);
    });

    it('should replace one named export by locating its AST statement', () => {
      const source = 'export const keep = 1;\nexport function score() { return 1; }\n';
      const transformed = transformSourceWithAst('src/score.ts', source, {
        path: 'src/score.ts',
        operation: 'replace_export',
        exportName: 'score',
        content: 'export function score() { return 2; }'
      });
      expect(transformed.content).toContain('export const keep = 1');
      expect(transformed.content).toContain('return 2');
      expect(transformed.replacedRange).toBeDefined();
    });
  });

  describe('2. Base Git SHA Verification', () => {
    it('should verify matching base Git SHA successfully', () => {
      const check = verifyBaseGitSha(tempWorktree, baseCommitSha);
      expect(check.verified).toBe(true);
      expect(check.currentSha).toBe(baseCommitSha);
    });

    it('should allow short prefix SHA match', () => {
      const shortSha = baseCommitSha.slice(0, 7);
      const check = verifyBaseGitSha(tempWorktree, shortSha);
      expect(check.verified).toBe(true);
    });

    it('should reject mismatched base Git SHA before modifying files', () => {
      const fakeSha = '1111222233334444555566667777888899990000';
      const check = verifyBaseGitSha(tempWorktree, fakeSha);
      expect(check.verified).toBe(false);
      expect(check.error).toContain('BASE_SHA_MISMATCH');
      expect(check.error).toContain(baseCommitSha.slice(0, 8));
    });

    it('should fail cleanly when target directory is not a git repository', () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), 'slop-nongit-'));
      const check = verifyBaseGitSha(nonGitDir, baseCommitSha);
      expect(check.verified).toBe(false);
      expect(check.error).toContain('not inside a Git worktree');
      rmSync(nonGitDir, { recursive: true, force: true });
    });
  });

  describe('3. Previous File Content & Digest Verification', () => {
    it('should verify matching previous content and SHA-256 digest', () => {
      const indexContent = readFileSync(join(tempWorktree, 'src', 'index.ts'), 'utf-8');
      const indexDigest = `sha256:${computeSha256(indexContent)}`;

      const check = verifyPreviousFileStates(tempWorktree, [
        {
          path: 'src/index.ts',
          action: 'modify',
          content: 'export const VERSION = "1.1.0";\n',
          previousContent: indexContent,
          previousDigest: indexDigest
        }
      ]);

      expect(check.valid).toBe(true);
      expect(check.errors).toHaveLength(0);
    });

    it('should reject modify action when previousContent does not match disk content', () => {
      const check = verifyPreviousFileStates(tempWorktree, [
        {
          path: 'src/index.ts',
          action: 'modify',
          content: 'export const VERSION = "2.0.0";\n',
          previousContent: 'export const VERSION = "0.9.0-wrong";\n'
        }
      ]);

      expect(check.valid).toBe(false);
      expect(check.errors.some(e => e.message.includes('PREVIOUS_CONTENT_MISMATCH'))).toBe(true);
    });

    it('should reject modify action when previousDigest does not match disk digest', () => {
      const indexContent = readFileSync(join(tempWorktree, 'src', 'index.ts'), 'utf-8');
      const badDigest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

      const check = verifyPreviousFileStates(tempWorktree, [
        {
          path: 'src/index.ts',
          action: 'modify',
          content: 'export const VERSION = "2.0.0";\n',
          previousContent: indexContent,
          previousDigest: badDigest
        }
      ]);

      expect(check.valid).toBe(false);
      expect(check.errors.some(e => e.message.includes('PREVIOUS_DIGEST_MISMATCH'))).toBe(true);
    });

    it('should reject create action when target file already exists on disk', () => {
      const check = verifyPreviousFileStates(tempWorktree, [
        {
          path: 'src/index.ts',
          action: 'create',
          content: 'export const conflict = true;\n'
        }
      ]);

      expect(check.valid).toBe(false);
      expect(check.errors.some(e => e.message.includes('TARGET_FILE_ALREADY_EXISTS'))).toBe(true);
    });

    it('should reject modify action when target file does not exist on disk', () => {
      const check = verifyPreviousFileStates(tempWorktree, [
        {
          path: 'src/non-existent.ts',
          action: 'modify',
          content: 'export const newVal = 1;\n',
          previousContent: 'export const oldVal = 1;\n'
        }
      ]);

      expect(check.valid).toBe(false);
      expect(check.errors.some(e => e.message.includes('TARGET_FILE_NOT_FOUND'))).toBe(true);
    });

    it('should reject modify action missing previousContent and previousDigest', () => {
      const check = verifyPreviousFileStates(tempWorktree, [
        {
          path: 'src/index.ts',
          action: 'modify',
          content: 'export const VERSION = "3.0.0";\n'
        }
      ]);

      expect(check.valid).toBe(false);
      expect(check.errors.some(e => e.message.includes('MISSING_PREVIOUS_CONTENT'))).toBe(true);
    });
  });

  describe('4. Path & Symlink Containment Defenses', () => {
    it('should reject path traversal attempts with ".."', () => {
      const res = verifyPathAndSymlinkContainment(tempWorktree, '../../secret.txt');
      expect(res.contained).toBe(false);
      expect(res.error).toContain('traversal');
    });

    it('should reject absolute target paths', () => {
      const res = verifyPathAndSymlinkContainment(tempWorktree, '/etc/passwd');
      expect(res.contained).toBe(false);
      expect(res.error).toContain('Absolute paths are not allowed');
    });

    it('should reject null bytes in paths', () => {
      const res = verifyPathAndSymlinkContainment(tempWorktree, 'src/\0hack.ts');
      expect(res.contained).toBe(false);
      expect(res.error).toContain('null byte');
    });

    it('should detect and reject symlink traversal pointing outside worktree', () => {

      const externalDir = mkdtempSync(join(tmpdir(), 'slop-symlink-target-'));
      const symlinkInWorktree = join(tempWorktree, 'src', 'external_link');

      try {
        symlinkSync(externalDir, symlinkInWorktree, 'dir');

        const res = verifyPathAndSymlinkContainment(tempWorktree, 'src/external_link/exploit.ts');
        expect(res.contained).toBe(false);
        expect(res.error).toContain('SYMLINK_CONTAINMENT_VIOLATION');
      } finally {
        rmSync(externalDir, { recursive: true, force: true });
      }
    });
  });

  describe('5. Atomic Application & Rollback on Failure', () => {
    it('should apply create, modify, and delete operations atomically', () => {
      const originalConfig = readFileSync(join(tempWorktree, 'src', 'config.ts'), 'utf-8');

      const mods = [
        {
          path: 'src/weapons/Laser.ts',
          action: 'create' as const,
          content: 'export const LaserDamage = 100;\n'
        },
        {
          path: 'src/config.ts',
          action: 'modify' as const,
          content: 'export const config = { enabled: true, mode: "turbo" };\n',
          previousContent: originalConfig
        }
      ];

      const applyRes = applyModificationsAtomically(tempWorktree, mods);
      expect(applyRes.success).toBe(true);
      expect(applyRes.applied).toHaveLength(2);
      expect(existsSync(join(tempWorktree, 'src', 'weapons', 'Laser.ts'))).toBe(true);
      expect(readFileSync(join(tempWorktree, 'src', 'config.ts'), 'utf-8')).toContain('turbo');
    });

    it('should rollback all modifications cleanly on failure', () => {
      const originalConfig = readFileSync(join(tempWorktree, 'src', 'config.ts'), 'utf-8');

      const mods = [
        {
          path: 'src/weapons/Beam.ts',
          action: 'create' as const,
          content: 'export const Beam = true;\n'
        },
        {
          path: 'src/config.ts',
          action: 'modify' as const,
          content: 'export const config = { modified: true };\n',
          previousContent: originalConfig
        }
      ];

      const applyRes = applyModificationsAtomically(tempWorktree, mods);
      expect(applyRes.success).toBe(true);
      expect(existsSync(join(tempWorktree, 'src', 'weapons', 'Beam.ts'))).toBe(true);

      const rollbackRes = rollbackModifications(applyRes.rollbackSnapshot, applyRes.createdDirectories);
      expect(rollbackRes.success).toBe(true);

      expect(existsSync(join(tempWorktree, 'src', 'weapons', 'Beam.ts'))).toBe(false);
      expect(readFileSync(join(tempWorktree, 'src', 'config.ts'), 'utf-8')).toBe(originalConfig);
    });
  });

  describe('6. Repository-Configured Test Execution without Shell Injection', () => {
    it('should resolve test command from slop.json', () => {
      const cmd = resolveRepoTestCommand(tempWorktree);
      expect(cmd.executable).toBe('node');
      expect(cmd.args).toEqual(['-e', 'process.exit(0)']);
      expect(cmd.source).toBe('slop.json');
    });

    it('should reject string commands instead of guessing shell tokenization', () => {
      writeFileSync(join(tempWorktree, 'slop.json'), JSON.stringify({ testCommand: 'npm test && echo unsafe' }));
      expect(() => resolveRepoTestCommand(tempWorktree)).toThrow('argument array');
    });

    it('should execute test command with shell: false and capture stdout, stderr, duration, exitCode', () => {
      const testCmd = {
        executable: 'node',
        args: ['-e', 'console.log("Test suite started"); console.error("Warning note"); process.exit(0);']
      };

      const res = executeRepoTestsWithoutShellInjection(tempWorktree, testCmd);
      expect(res.passed).toBe(true);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Test suite started');
      expect(res.stderr).toContain('Warning note');
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
      expect(res.outputHash).toHaveLength(64);
    });

    it('should truthfully capture non-zero test exit codes', () => {
      const testCmd = {
        executable: 'node',
        args: ['-e', 'console.error("AssertionError: expected 1 to equal 2"); process.exit(1);']
      };

      const res = executeRepoTestsWithoutShellInjection(tempWorktree, testCmd);
      expect(res.passed).toBe(false);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('AssertionError');
    });

    it('should prevent shell injection attacks by executing without shell interpretation', () => {

      const injectedFile = join(tempWorktree, 'injected-file.txt');
      const injectionAttempt = {
        executable: 'node',
        args: ['-e', 'process.exit(0);', ';', 'touch', injectedFile]
      };

      const res = executeRepoTestsWithoutShellInjection(tempWorktree, injectionAttempt);

      expect(existsSync(injectedFile)).toBe(false);
      expect(res.passed).toBe(true);
    });

    it('should exclude ambient credentials from the test environment', () => {
      const env = buildTestEnvironment({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'secret', AWS_SECRET_ACCESS_KEY: 'secret' });
      expect(env.PATH).toBe('/usr/bin');
      expect(env.CI).toBe('true');
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    });
  });

  describe('7. Full End-to-End executeSlopMod Execution', () => {
    it('should successfully execute a valid manifest against real worktree', async () => {
      const manifest: VersionedFeatureManifest = {
        schemaVersion: 1,
        id: 'radar-hud',
        name: 'Radar HUD Display',
        version: '1.2.0',
        prompt: 'Add rotating radar HUD display',
        baseCommitSha,
        modifications: [
          {
            path: 'src/hud/Radar.ts',
            action: 'create',
            content: 'export const RadarHud = { scanAngle: 45, blips: [] };\n'
          }
        ]
      };

      const result = await executeSlopMod({
        manifestOrRef: manifest,
        worktreePath: tempWorktree,
        runTests: true
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('mod');
      expect(result.featureId).toBe('radar-hud');
      expect(result.featureVersion).toBe('1.2.0');
      expect(result.baseSha).toBe(baseCommitSha);
      expect(result.appliedFiles).toHaveLength(1);
      expect(result.astValidation.valid).toBe(true);
      expect(result.astValidation.exports.map(e => e.name)).toContain('RadarHud');
      expect(result.testResult?.passed).toBe(true);
      expect(result.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.publicationStatus).toBe('pending_explicit_push');
      expect(existsSync(join(tempWorktree, 'src', 'hud', 'Radar.ts'))).toBe(true);
    });

    it('should reject and abort when baseCommitSha does not match repository HEAD', async () => {
      const manifest: VersionedFeatureManifest = {
        schemaVersion: 1,
        id: 'mismatched-feature',
        version: '1.0.0',
        baseCommitSha: '0000111122223333444455556666777788889999',
        modifications: [
          {
            path: 'src/hud/NewFeature.ts',
            action: 'create',
            content: 'export const Feature = true;\n'
          }
        ]
      };

      const result = await executeSlopMod({
        manifestOrRef: manifest,
        worktreePath: tempWorktree,
        runTests: true
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('BASE_SHA_MISMATCH');
      expect(existsSync(join(tempWorktree, 'src', 'hud', 'NewFeature.ts'))).toBe(false);
    });

    it('should require a versioned, base-pinned manifest', async () => {
      const result = await executeSlopMod({
        manifestOrRef: { id: 'unpinned', modifications: [{ path: 'src/new.ts', action: 'create', content: 'export const x = 1;' }] },
        worktreePath: tempWorktree
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('schemaVersion');
      expect(existsSync(join(tempWorktree, 'src', 'new.ts'))).toBe(false);
    });

    it('should not fabricate a package for an unresolved GITSMITH feature ref', async () => {
      const result = await executeSlopMod({ manifestOrRef: 'refs/features/radar/v1.0.0', worktreePath: tempWorktree });
      expect(result.success).toBe(false);
      expect(result.error).toContain('signed manifest from GITSMITH');
    });

    it('should reject manifest with TypeScript syntax errors before writing', async () => {
      const manifest: VersionedFeatureManifest = {
        schemaVersion: 1,
        id: 'broken-syntax-feature',
        version: '1.0.0',
        baseCommitSha,
        modifications: [
          {
            path: 'src/broken.ts',
            action: 'create',
            content: 'export const x: = 123;\n'
          }
        ]
      };

      const result = await executeSlopMod({
        manifestOrRef: manifest,
        worktreePath: tempWorktree,
        runTests: false
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('TypeScript syntax error');
      expect(existsSync(join(tempWorktree, 'src', 'broken.ts'))).toBe(false);
    });

    it('should rollback modifications atomically when test suite fails in strict mode', async () => {

      writeFileSync(join(tempWorktree, 'slop.json'), JSON.stringify({
        name: 'test-app',
        testCommand: ['node', '-e', 'console.error("Test failure simulated"); process.exit(1);']
      }, null, 2));

      const manifest: VersionedFeatureManifest = {
        schemaVersion: 1,
        id: 'failing-test-feature',
        version: '1.0.0',
        baseCommitSha,
        modifications: [
          {
            path: 'src/hud/FailingRadar.ts',
            action: 'create',
            content: 'export const FailingRadar = true;\n'
          }
        ]
      };

      const result = await executeSlopMod({
        manifestOrRef: manifest,
        worktreePath: tempWorktree,
        runTests: true,
        rollbackOnTestFailure: true
      });

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      expect(result.testResult?.passed).toBe(false);
      expect(result.testResult?.exitCode).toBe(1);

      expect(existsSync(join(tempWorktree, 'src', 'hud', 'FailingRadar.ts'))).toBe(false);
    });

    it('should execute a digest-pinned parser-backed AST transform', async () => {
      const original = readFileSync(join(tempWorktree, 'src', 'index.ts'), 'utf-8');
      const manifest: VersionedFeatureManifest = {
        schemaVersion: 1,
        id: 'score-transform',
        version: '1.0.0',
        baseCommitSha,
        astTransforms: [{
          path: 'src/index.ts',
          operation: 'replace_export',
          exportName: 'main',
          expectedFileSha256: `sha256:${computeSha256(original)}`,
          content: 'export function main() { return 84; }'
        }]
      };
      const result = await executeSlopMod({ manifestOrRef: manifest, worktreePath: tempWorktree });
      expect(result.success).toBe(true);
      expect(readFileSync(join(tempWorktree, 'src', 'index.ts'), 'utf-8')).toContain('return 84');
      expect(readFileSync(join(tempWorktree, 'src', 'index.ts'), 'utf-8')).toContain('VERSION');
    });
  });

  describe('8. CLI Handler: slop mod <package-or-manifest>', () => {
    it('should execute slop mod via handleMod with manifest file path', async () => {
      const manifestPath = join(tempWorktree, 'feature-manifest.json');
      const manifestData: VersionedFeatureManifest = {
        schemaVersion: 1,
        id: 'cli-feature',
        name: 'CLI Feature',
        version: '1.0.0',
        prompt: 'Add CLI feature',
        baseCommitSha,
        modifications: [
          {
            path: 'src/cli-module.ts',
            action: 'create',
            content: 'export const CliModule = { loaded: true };\n'
          }
        ]
      };
      writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2));

      const res = await handleMod([manifestPath, `--worktree=${tempWorktree}`]);
      expect(res.success).toBe(true);
      expect(res.command).toBe('mod');
      expect(res.data.featureId).toBe('cli-feature');
      expect(res.data.publicationStatus).toBe('pending_explicit_push');
      expect(existsSync(join(tempWorktree, 'src', 'cli-module.ts'))).toBe(true);
    });

    it('should print usage and error when slop mod is invoked without arguments', async () => {
      const res = await handleMod([]);
      expect(res.success).toBe(false);
      expect(res.message).toContain('Usage: slop mod');
    });
  });
});
