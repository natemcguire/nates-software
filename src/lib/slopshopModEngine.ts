import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import type { FileModification, DiffSummary, ValidationError } from './slopshopPipeline.ts';
import {
  normalizeRelativePath,
  generateUnifiedDiff,
  generateInversePatch
} from './slopshopPipeline.ts';
import {
  validateTypeScriptModifications,
  transformSourceWithAst,
  type AstTransform,
  type AstValidationResult
} from './slopshopAstEngine.ts';

export interface VersionedFeatureManifest {
  readonly $schema?: string;
  readonly schemaVersion?: number | string;
  readonly id?: string;
  readonly name?: string;
  readonly version?: string;
  readonly featureName?: string;
  readonly description?: string;
  readonly prompt?: string;
  readonly baseCommitSha?: string;
  readonly expectedBaseSha?: string;
  readonly targetCommitSha?: string;
  readonly sourceCommit?: string;
  readonly targetRepository?: {
    readonly appId?: string;
    readonly slug?: string;
    readonly repoUrl?: string;
    readonly defaultPort?: number;
    readonly sqliteDatabase?: string;
  } | string;
  readonly appId?: string;
  readonly modifications?: readonly FileModification[];
  readonly files?: readonly FileModification[];
  readonly astTransforms?: readonly AstTransform[];
  readonly testCommand?: string | readonly string[];
  readonly assertions?: readonly string[];
  readonly migrationSql?: string;
  readonly lineageContract?: {
    readonly makerHandle?: string;
    readonly royaltySplit?: {
      readonly maker?: string;
      readonly ancestor?: string;
      readonly protocolPool?: string;
    };
  };
  readonly evidenceRequirements?: {
    readonly typecheckRequired?: boolean;
    readonly testsRequired?: boolean;
    readonly migrationValidationRequired?: boolean;
    readonly sha256DigestRequired?: boolean;
  };
}

export interface ResolvedFeatureManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly prompt: string;
  readonly appId: string;
  readonly expectedBaseSha?: string;
  readonly modifications: readonly FileModification[];
  readonly astTransforms: readonly AstTransform[];
  readonly testCommand?: string | readonly string[];
  readonly migrationSql?: string;
  readonly rawManifest: VersionedFeatureManifest;
}

export interface RollbackSnapshotEntry {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly existedBefore: boolean;
  readonly previousContent?: string;
}

export interface SandboxExecutionResult {
  readonly executable: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly passed: boolean;
  readonly outputHash: string;
  readonly error?: string;
}

export interface SlopModResult {
  readonly success: boolean;
  readonly command: 'mod';
  readonly featureId: string;
  readonly featureVersion: string;
  readonly worktreePath: string;
  readonly baseSha: string;
  readonly message: string;
  readonly appliedFiles: readonly { path: string; action: 'create' | 'modify' | 'delete' }[];
  readonly diff: DiffSummary;
  readonly inverseDiff: DiffSummary;
  readonly astValidation: AstValidationResult;
  readonly testResult?: SandboxExecutionResult;
  readonly evidenceDigest: string;
  readonly publicationStatus: 'pending_explicit_push';
  readonly rolledBack?: boolean;
  readonly rollbackReason?: string;
  readonly error?: string;
}

export interface SlopModOptions {
  readonly manifestOrRef: string | VersionedFeatureManifest;
  readonly worktreePath?: string;
  readonly runTests?: boolean;
  readonly rollbackOnTestFailure?: boolean;
}

export function computeSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function resolveFeatureManifest(
  input: string | VersionedFeatureManifest,
  worktreePath?: string
): ResolvedFeatureManifest {
  let manifestObj: VersionedFeatureManifest;

  if (typeof input === 'string') {
    const trimmed = input.trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        manifestObj = JSON.parse(trimmed);
      } catch (err: any) {
        throw new Error(`Failed to parse inline manifest JSON: ${err.message}`);
      }
    }
    else {
      if (trimmed.startsWith('refs/features/')) {
        throw new Error(`Feature ref "${trimmed}" is not available locally. Fetch its signed manifest from GITSMITH first, then pass the local manifest path.`);
      }
      const candidatePath = path.isAbsolute(trimmed)
        ? trimmed
        : worktreePath
        ? path.resolve(worktreePath, trimmed)
        : path.resolve(process.cwd(), trimmed);

      if (!fs.existsSync(candidatePath)) {
        throw new Error(`Manifest file "${trimmed}" not found at "${candidatePath}".`);
      }

      try {
        manifestObj = JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));
      } catch (err: any) {
        throw new Error(`Failed to parse manifest file at "${candidatePath}": ${err.message}`);
      }
    }
  } else if (typeof input === 'object' && input !== null) {
    manifestObj = input;
  } else {
    throw new Error('Invalid manifest input: must be a manifest object, JSON string, file path, or feature ref.');
  }

  if (manifestObj.schemaVersion !== 1 && manifestObj.schemaVersion !== '1') {
    throw new Error('Unsupported or missing feature manifest schemaVersion; expected 1.');
  }

  const id = manifestObj.id || manifestObj.featureName || manifestObj.name || 'unnamed-feature';
  const name = manifestObj.name || manifestObj.featureName || id;
  const version = manifestObj.version || '1.0.0';
  const prompt = manifestObj.prompt || manifestObj.description || name;

  let appId = manifestObj.appId || 'custom';
  if (manifestObj.targetRepository) {
    if (typeof manifestObj.targetRepository === 'string') {
      appId = manifestObj.targetRepository;
    } else if (manifestObj.targetRepository.appId) {
      appId = manifestObj.targetRepository.appId;
    }
  }

  const expectedBaseSha =
    manifestObj.expectedBaseSha ||
    manifestObj.baseCommitSha ||
    manifestObj.targetCommitSha ||
    manifestObj.sourceCommit;
  if (!expectedBaseSha || !/^[a-f0-9]{7,64}$/i.test(expectedBaseSha)) {
    throw new Error('Feature manifest must declare a valid expectedBaseSha/baseCommitSha.');
  }

  const rawMods = manifestObj.modifications || manifestObj.files || [];
  const astTransforms = manifestObj.astTransforms || [];
  if ((!Array.isArray(rawMods) || rawMods.length === 0) && (!Array.isArray(astTransforms) || astTransforms.length === 0)) {
    throw new Error(`Manifest for feature "${id}" contains no file modifications or AST transforms.`);
  }

  const modifications: FileModification[] = rawMods.map(m => {
    const norm = normalizeRelativePath(m.path);
    if (norm.error) {
      throw new Error(`Invalid modification path in manifest: ${norm.error}`);
    }
    return {
      path: norm.normalized,
      action: m.action || 'create',
      content: typeof m.content === 'string' ? m.content : '',
      previousContent: typeof m.previousContent === 'string' ? m.previousContent : undefined,
      previousDigest: m.previousDigest || (m as FileModification & { previousSha256?: string }).previousSha256
    };
  });

  return {
    id,
    name,
    version,
    prompt,
    appId,
    expectedBaseSha,
    modifications,
    astTransforms,
    testCommand: manifestObj.testCommand,
    migrationSql: manifestObj.migrationSql,
    rawManifest: manifestObj
  };
}

export function materializeAstTransforms(worktreePath: string, transforms: readonly AstTransform[]): FileModification[] {
  const staged = new Map<string, string>();
  const original = new Map<string, string>();
  for (const transform of transforms) {
    const containment = verifyPathAndSymlinkContainment(worktreePath, transform.path);
    if (!containment.contained) throw new Error(containment.error);
    if (!fs.existsSync(containment.fullPath) || !fs.statSync(containment.fullPath).isFile()) {
      throw new Error(`AST transform target does not exist as a regular file: ${transform.path}`);
    }
    const before = staged.get(transform.path) ?? fs.readFileSync(containment.fullPath, 'utf-8');
    if (!original.has(transform.path)) original.set(transform.path, before);
    if (transform.expectedFileSha256) {
      const expected = transform.expectedFileSha256.replace(/^sha256:/, '');
      const actual = computeSha256(original.get(transform.path)!);
      if (expected !== actual) throw new Error(`AST transform base digest mismatch for ${transform.path}.`);
    }
    staged.set(transform.path, transformSourceWithAst(transform.path, before, transform).content);
  }
  return [...staged.entries()].map(([targetPath, content]) => ({
    path: targetPath,
    action: 'modify' as const,
    previousContent: original.get(targetPath)!,
    content
  }));
}

export function verifyBaseGitSha(
  worktreePath: string,
  expectedBaseSha?: string
): { verified: boolean; currentSha: string; expectedSha?: string; error?: string } {
  let currentSha = 'unknown';

  try {
    const insideGit = execSync('git rev-parse --is-inside-work-tree', {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();

    if (insideGit !== 'true') {
      return {
        verified: false,
        currentSha: 'non-git',
        error: `Target path "${worktreePath}" is not inside a Git worktree.`
      };
    }

    currentSha = execSync('git rev-parse HEAD', {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();
  } catch (err: any) {
    const msg = (err.stderr ? err.stderr.toString() : err.message) || '';
    if (msg.includes('not a git repository') || msg.includes('fatal:')) {
      return {
        verified: false,
        currentSha: 'non-git',
        error: `Target path "${worktreePath}" is not inside a Git worktree.`
      };
    }
    return {
      verified: false,
      currentSha: 'error',
      error: `Failed to query Git HEAD in "${worktreePath}": ${err.message}`
    };
  }

  if (!expectedBaseSha || expectedBaseSha.trim() === '') {
    return { verified: true, currentSha };
  }

  const cleanExpected = expectedBaseSha.trim().toLowerCase();
  const cleanCurrent = currentSha.toLowerCase();

  const isMatch = cleanCurrent === cleanExpected || (cleanExpected.length >= 7 && cleanCurrent.startsWith(cleanExpected));

  if (!isMatch) {
    return {
      verified: false,
      currentSha,
      expectedSha: expectedBaseSha,
      error: `BASE_SHA_MISMATCH: Current worktree HEAD (${currentSha.slice(0, 8)}) does not match expected base Git SHA (${expectedBaseSha.slice(0, 8)}). Aborting without modifying files.`
    };
  }

  return { verified: true, currentSha, expectedSha: expectedBaseSha };
}

export function verifyPathAndSymlinkContainment(
  worktreePath: string,
  relativePath: string
): { contained: boolean; fullPath: string; error?: string } {
  const norm = normalizeRelativePath(relativePath);
  if (norm.error) {
    return { contained: false, fullPath: '', error: norm.error };
  }

  const worktreeRoot = path.resolve(worktreePath);
  let canonicalWorktreeRoot = worktreeRoot;
  try {
    if (fs.existsSync(worktreeRoot)) {
      canonicalWorktreeRoot = fs.realpathSync(worktreeRoot);
    }
  } catch (err: any) {
    return { contained: false, fullPath: '', error: `Unable to resolve worktree root: ${err.message}` };
  }

  const fullPath = path.resolve(worktreeRoot, norm.normalized);

  if (!fullPath.startsWith(worktreeRoot + path.sep) && fullPath !== worktreeRoot) {
    return {
      contained: false,
      fullPath,
      error: `PATH_CONTAINMENT_VIOLATION: Target path "${norm.normalized}" resolves outside the worktree directory.`
    };
  }

  const segments = norm.normalized.split('/');
  let currentCheck = worktreeRoot;

  for (const seg of segments) {
    currentCheck = path.join(currentCheck, seg);
    if (fs.existsSync(currentCheck)) {
      try {
        const stat = fs.lstatSync(currentCheck);
        if (stat.isSymbolicLink()) {
          const real = fs.realpathSync(currentCheck);
          if (!real.startsWith(canonicalWorktreeRoot + path.sep) && real !== canonicalWorktreeRoot) {
            return {
              contained: false,
              fullPath,
              error: `SYMLINK_CONTAINMENT_VIOLATION: Segment "${seg}" in path "${norm.normalized}" is a symbolic link pointing outside worktree boundary (${real}).`
            };
          }
        }
      } catch (err: any) {
        return {
          contained: false,
          fullPath,
          error: `Failed to inspect path "${currentCheck}": ${err.message}`
        };
      }
    }
  }

  return { contained: true, fullPath };
}

export function verifyPreviousFileStates(
  worktreePath: string,
  modifications: readonly FileModification[]
): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  for (const mod of modifications) {
    const containment = verifyPathAndSymlinkContainment(worktreePath, mod.path);
    if (!containment.contained) {
      errors.push({
        code: 'PATH_TRAVERSAL',
        message: containment.error || `Path containment violation for "${mod.path}"`,
        path: mod.path
      });
      continue;
    }

    const fullPath = containment.fullPath;
    const existsOnDisk = fs.existsSync(fullPath);

    if (mod.action === 'create') {
      if (existsOnDisk) {
        errors.push({
          code: 'DUPLICATE_PATH',
          message: `TARGET_FILE_ALREADY_EXISTS: Cannot create "${mod.path}" because it already exists on disk. Use action "modify" to update existing files.`,
          path: mod.path
        });
      }
    } else if (mod.action === 'modify') {
      if (!existsOnDisk) {
        errors.push({
          code: 'MISSING_BEFORE_CONTENT',
          message: `TARGET_FILE_NOT_FOUND: Cannot modify "${mod.path}" because the file does not exist on disk.`,
          path: mod.path
        });
        continue;
      }

      const diskContent = fs.readFileSync(fullPath, 'utf-8');

      if (typeof mod.previousContent === 'string') {
        if (diskContent !== mod.previousContent) {
          errors.push({
            code: 'MISSING_BEFORE_CONTENT',
            message: `PREVIOUS_CONTENT_MISMATCH: File "${mod.path}" content on disk does not match expected previousContent. The file was modified or diverged.`,
            path: mod.path
          });
        }
      }

      const expectedDigest = mod.previousDigest;
      if (expectedDigest) {
        const diskDigest = `sha256:${computeSha256(diskContent)}`;
        const cleanExpected = expectedDigest.startsWith('sha256:') ? expectedDigest : `sha256:${expectedDigest}`;
        if (diskDigest !== cleanExpected) {
          errors.push({
            code: 'MISSING_BEFORE_CONTENT',
            message: `PREVIOUS_DIGEST_MISMATCH: File "${mod.path}" on-disk digest (${diskDigest}) does not match expected digest (${cleanExpected}).`,
            path: mod.path
          });
        }
      }

      if (typeof mod.previousContent !== 'string' && !expectedDigest) {
        errors.push({
          code: 'MISSING_BEFORE_CONTENT',
          message: `MISSING_PREVIOUS_CONTENT: Action "modify" on "${mod.path}" requires explicit previousContent or previousDigest for provable reversible patching.`,
          path: mod.path
        });
      }
    } else if (mod.action === 'delete') {
      if (!existsOnDisk) {
        errors.push({
          code: 'MISSING_BEFORE_CONTENT',
          message: `TARGET_FILE_NOT_FOUND: Cannot delete "${mod.path}" because the file does not exist on disk.`,
          path: mod.path
        });
        continue;
      }

      const diskContent = fs.readFileSync(fullPath, 'utf-8');

      if (typeof mod.previousContent === 'string') {
        if (diskContent !== mod.previousContent) {
          errors.push({
            code: 'MISSING_BEFORE_CONTENT',
            message: `PREVIOUS_CONTENT_MISMATCH: Cannot delete "${mod.path}" because content on disk does not match expected previousContent.`,
            path: mod.path
          });
        }
      }

      const expectedDigest = mod.previousDigest;
      if (expectedDigest) {
        const diskDigest = `sha256:${computeSha256(diskContent)}`;
        const cleanExpected = expectedDigest.startsWith('sha256:') ? expectedDigest : `sha256:${expectedDigest}`;
        if (diskDigest !== cleanExpected) {
          errors.push({
            code: 'MISSING_BEFORE_CONTENT',
            message: `PREVIOUS_DIGEST_MISMATCH: Cannot delete "${mod.path}" because on-disk digest (${diskDigest}) does not match expected digest (${cleanExpected}).`,
            path: mod.path
          });
        }
      }

      if (typeof mod.previousContent !== 'string' && !expectedDigest) {
        errors.push({
          code: 'MISSING_BEFORE_CONTENT',
          message: `MISSING_PREVIOUS_CONTENT: Action "delete" on "${mod.path}" requires explicit previousContent or previousDigest for provable reversible deletion.`,
          path: mod.path
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function applyModificationsAtomically(
  worktreePath: string,
  modifications: readonly FileModification[]
): {
  success: boolean;
  applied: { path: string; action: 'create' | 'modify' | 'delete' }[];
  rollbackSnapshot: RollbackSnapshotEntry[];
  createdDirectories: string[];
  error?: string;
} {
  const rollbackSnapshot: RollbackSnapshotEntry[] = [];
  const createdDirectories: string[] = [];
  const applied: { path: string; action: 'create' | 'modify' | 'delete' }[] = [];

  for (const mod of modifications) {
    const containment = verifyPathAndSymlinkContainment(worktreePath, mod.path);
    if (!containment.contained) {
      return {
        success: false,
        applied: [],
        rollbackSnapshot: [],
        createdDirectories: [],
        error: containment.error
      };
    }

    const fullPath = containment.fullPath;
    const existedBefore = fs.existsSync(fullPath);
    let previousContent: string | undefined;

    if (existedBefore) {
      previousContent = fs.readFileSync(fullPath, 'utf-8');
    }

    rollbackSnapshot.push({
      relativePath: mod.path,
      absolutePath: fullPath,
      existedBefore,
      previousContent
    });
  }

  try {
    for (const mod of modifications) {
      const containment = verifyPathAndSymlinkContainment(worktreePath, mod.path);
      const fullPath = containment.fullPath;

      if (mod.action === 'create' || mod.action === 'modify') {
        const parentDir = path.dirname(fullPath);
        if (!fs.existsSync(parentDir)) {
          let checkDir = parentDir;
          const newDirs: string[] = [];
          while (!fs.existsSync(checkDir) && checkDir !== path.resolve(worktreePath)) {
            newDirs.push(checkDir);
            checkDir = path.dirname(checkDir);
          }
          fs.mkdirSync(parentDir, { recursive: true });
          createdDirectories.push(...newDirs.reverse());
        }

        fs.writeFileSync(fullPath, mod.content, 'utf-8');
        applied.push({ path: mod.path, action: mod.action });
      } else if (mod.action === 'delete') {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
        applied.push({ path: mod.path, action: 'delete' });
      }
    }

    return {
      success: true,
      applied,
      rollbackSnapshot,
      createdDirectories
    };
  } catch (err: any) {
    const rollback = rollbackModifications(rollbackSnapshot, createdDirectories);
    return {
      success: false,
      applied: [],
      rollbackSnapshot,
      createdDirectories,
      error: `I/O error applying modifications: ${err.message}${rollback.success ? '' : `; rollback also failed: ${rollback.error}`}`
    };
  }
}

export function rollbackModifications(
  rollbackSnapshot: readonly RollbackSnapshotEntry[],
  createdDirectories: readonly string[] = []
): { success: boolean; restoredCount: number; error?: string } {
  let restoredCount = 0;

  try {
    for (let i = rollbackSnapshot.length - 1; i >= 0; i--) {
      const entry = rollbackSnapshot[i];
      if (entry.existedBefore && typeof entry.previousContent === 'string') {
        const parentDir = path.dirname(entry.absolutePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(entry.absolutePath, entry.previousContent, 'utf-8');
        restoredCount++;
      } else if (!entry.existedBefore) {
        if (fs.existsSync(entry.absolutePath)) {
          fs.unlinkSync(entry.absolutePath);
          restoredCount++;
        }
      }
    }

    for (let i = createdDirectories.length - 1; i >= 0; i--) {
      const dir = createdDirectories[i];
      try {
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch {}
    }

    return { success: true, restoredCount };
  } catch (err: any) {
    return {
      success: false,
      restoredCount,
      error: `Rollback encountered error: ${err.message}`
    };
  }
}

export function resolveRepoTestCommand(
  worktreePath: string
): {
  executable: string;
  args: string[];
  source: 'slop.json' | 'package.json' | 'manifest' | 'default';
} {
  const slopJsonPath = path.join(worktreePath, 'slop.json');
  if (fs.existsSync(slopJsonPath)) {
    const cfg = JSON.parse(fs.readFileSync(slopJsonPath, 'utf-8'));
    if (cfg.testCommand !== undefined) {
      if (!Array.isArray(cfg.testCommand) || cfg.testCommand.length === 0 || !cfg.testCommand.every((part: unknown) => typeof part === 'string' && part.length > 0)) {
        throw new Error('slop.json testCommand must be a non-empty argument array, for example ["npm", "test"].');
      }
      return {
        executable: cfg.testCommand[0],
        args: cfg.testCommand.slice(1),
        source: 'slop.json'
      };
    }
  }

  const pkgJsonPath = path.join(worktreePath, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    if (pkg.scripts && typeof pkg.scripts.test === 'string' && pkg.scripts.test.trim()) {
      return {
        executable: 'npm',
        args: ['test'],
        source: 'package.json'
      };
    }
  }

  throw new Error('No repository-owned test command found. Add testCommand as an argument array to slop.json or define package.json scripts.test.');
}

export function executeRepoTestsWithoutShellInjection(
  worktreePath: string,
  commandConfig: { executable: string; args: readonly string[] },
  timeoutMs: number = 60000
): SandboxExecutionResult {
  const startTime = Date.now();
  const { executable, args } = commandConfig;

  const forbiddenPattern = /[\0\r\n]/;
  if (forbiddenPattern.test(executable) || args.some(a => forbiddenPattern.test(a))) {
    return {
      executable,
      args,
      exitCode: 1,
      stdout: '',
      stderr: 'Test command rejected: executable or arguments contain illegal control characters.',
      durationMs: 0,
      passed: false,
      outputHash: computeSha256(''),
      error: 'SECURITY_VALIDATION_FAILED'
    };
  }

  try {
    const spawned = spawnSync(executable, [...args], {
      cwd: worktreePath,
      shell: false,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
      env: buildTestEnvironment(process.env)
    });

    const durationMs = Date.now() - startTime;
    const stdout = spawned.stdout ? spawned.stdout.trim() : '';
    const stderr = spawned.stderr ? spawned.stderr.trim() : '';
    const exitCode = spawned.status;
    const passed = exitCode === 0;
    const combinedOutput = `${stdout}\n${stderr}`;
    const outputHash = computeSha256(combinedOutput);

    return {
      executable,
      args,
      exitCode,
      stdout,
      stderr,
      durationMs,
      passed,
      outputHash,
      error: spawned.error ? spawned.error.message : (passed ? undefined : `Test exited with code ${exitCode}`)
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    return {
      executable,
      args,
      exitCode: 1,
      stdout: '',
      stderr: err.message || 'Execution error',
      durationMs,
      passed: false,
      outputHash: computeSha256(''),
      error: err.message
    };
  }
}

export function buildTestEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM'];
  const env: NodeJS.ProcessEnv = { CI: 'true', NODE_ENV: 'test' };
  for (const key of allowed) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export function computeModEvidenceDigest(params: {
  featureId: string;
  featureVersion: string;
  worktreePath: string;
  baseSha: string;
  modifications: readonly FileModification[];
  diff: DiffSummary;
  astValidation: AstValidationResult;
  testResult?: SandboxExecutionResult;
}): string {
  const canonical = {
    featureId: params.featureId.trim(),
    featureVersion: params.featureVersion.trim(),
    baseSha: params.baseSha.trim(),
    diffAdditions: params.diff.additions,
    diffDeletions: params.diff.deletions,
    filesChanged: params.diff.filesChanged,
    rawDiff: params.diff.rawDiff,
    astValid: params.astValidation.valid,
    exports: params.astValidation.exports.map(e => ({ name: e.name, kind: e.kind, file: e.file })),
    testPassed: params.testResult ? params.testResult.passed : null,
    testExitCode: params.testResult ? params.testResult.exitCode : null,
    testDurationMs: params.testResult ? params.testResult.durationMs : null,
    testOutputHash: params.testResult ? params.testResult.outputHash : null
  };

  const jsonStr = JSON.stringify(canonical);
  const digest = computeSha256(jsonStr);
  return `sha256:${digest}`;
}

export async function executeSlopMod(options: SlopModOptions): Promise<SlopModResult> {
  const cwd = options.worktreePath ? path.resolve(options.worktreePath) : process.cwd();

  let manifest: ResolvedFeatureManifest;
  try {
    manifest = resolveFeatureManifest(options.manifestOrRef, cwd);
  } catch (err: any) {
    return {
      success: false,
      command: 'mod',
      featureId: 'unknown',
      featureVersion: 'unknown',
      worktreePath: cwd,
      baseSha: 'unknown',
      message: `Failed to resolve feature package manifest: ${err.message}`,
      appliedFiles: [],
      diff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      inverseDiff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      astValidation: { valid: false, syntaxErrors: [], exports: [], imports: [], collisions: [], errors: [] },
      evidenceDigest: '',
      publicationStatus: 'pending_explicit_push',
      error: err.message
    };
  }

  const baseGitCheck = verifyBaseGitSha(cwd, manifest.expectedBaseSha);
  if (!baseGitCheck.verified) {
    return {
      success: false,
      command: 'mod',
      featureId: manifest.id,
      featureVersion: manifest.version,
      worktreePath: cwd,
      baseSha: baseGitCheck.currentSha,
      message: baseGitCheck.error || 'Base Git SHA verification failed.',
      appliedFiles: [],
      diff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      inverseDiff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      astValidation: { valid: false, syntaxErrors: [], exports: [], imports: [], collisions: [], errors: [] },
      evidenceDigest: '',
      publicationStatus: 'pending_explicit_push',
      error: baseGitCheck.error
    };
  }
  const baseSha = baseGitCheck.currentSha;

  let modifications = [...manifest.modifications];
  try {
    const transformed = materializeAstTransforms(cwd, manifest.astTransforms);
    const touched = new Set(modifications.map(modification => modification.path));
    if (transformed.some(modification => touched.has(modification.path))) {
      throw new Error('A manifest cannot combine a whole-file modification and AST transform for the same path.');
    }
    modifications = [...modifications, ...transformed];
  } catch (err: any) {
    return {
      success: false, command: 'mod', featureId: manifest.id, featureVersion: manifest.version,
      worktreePath: cwd, baseSha, message: `AST transform preparation failed: ${err.message}`,
      appliedFiles: [], diff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      inverseDiff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      astValidation: { valid: false, syntaxErrors: [], exports: [], imports: [], collisions: [], errors: [] },
      evidenceDigest: '', publicationStatus: 'pending_explicit_push', error: err.message
    };
  }

  const previousCheck = verifyPreviousFileStates(cwd, modifications);
  if (!previousCheck.valid) {
    const errorMsg = previousCheck.errors.map(e => e.message).join('; ');
    return {
      success: false,
      command: 'mod',
      featureId: manifest.id,
      featureVersion: manifest.version,
      worktreePath: cwd,
      baseSha,
      message: `Previous file state verification failed: ${errorMsg}`,
      appliedFiles: [],
      diff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      inverseDiff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      astValidation: { valid: false, syntaxErrors: [], exports: [], imports: [], collisions: [], errors: previousCheck.errors },
      evidenceDigest: '',
      publicationStatus: 'pending_explicit_push',
      error: errorMsg
    };
  }

  const astValidation = validateTypeScriptModifications(modifications);
  if (!astValidation.valid) {
    const errorMsg = astValidation.errors.map(e => e.message).join('; ');
    return {
      success: false,
      command: 'mod',
      featureId: manifest.id,
      featureVersion: manifest.version,
      worktreePath: cwd,
      baseSha,
      message: `TypeScript AST validation failed: ${errorMsg}`,
      appliedFiles: [],
      diff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      inverseDiff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
      astValidation,
      evidenceDigest: '',
      publicationStatus: 'pending_explicit_push',
      error: errorMsg
    };
  }

  const diff = generateUnifiedDiff(modifications);
  const inverseDiff = generateInversePatch(modifications);

  const applyResult = applyModificationsAtomically(cwd, modifications);
  if (!applyResult.success) {
    return {
      success: false,
      command: 'mod',
      featureId: manifest.id,
      featureVersion: manifest.version,
      worktreePath: cwd,
      baseSha,
      message: `Atomic file application failed: ${applyResult.error}`,
      appliedFiles: [],
      diff,
      inverseDiff,
      astValidation,
      evidenceDigest: '',
      publicationStatus: 'pending_explicit_push',
      rolledBack: true,
      error: applyResult.error
    };
  }

  let testResult: SandboxExecutionResult | undefined;
  const shouldRunTests = options.runTests !== false;

  if (shouldRunTests) {
    let testCmdConfig: ReturnType<typeof resolveRepoTestCommand>;
    try {
      testCmdConfig = resolveRepoTestCommand(cwd);
    } catch (err: any) {
      const rollback = rollbackModifications(applyResult.rollbackSnapshot, applyResult.createdDirectories);
      return {
        success: false,
        command: 'mod',
        featureId: manifest.id,
        featureVersion: manifest.version,
        worktreePath: cwd,
        baseSha,
        message: rollback.success
          ? `Test verification unavailable. Modifications were rolled back: ${err.message}`
          : `Test verification unavailable and rollback failed: ${rollback.error}`,
        appliedFiles: [],
        diff,
        inverseDiff,
        astValidation,
        evidenceDigest: '',
        publicationStatus: 'pending_explicit_push',
        rolledBack: rollback.success,
        rollbackReason: err.message,
        error: 'REPOSITORY_TEST_COMMAND_REQUIRED'
      };
    }

    testResult = executeRepoTestsWithoutShellInjection(cwd, testCmdConfig);

    if (!testResult.passed && options.rollbackOnTestFailure !== false) {
      const rollback = rollbackModifications(applyResult.rollbackSnapshot, applyResult.createdDirectories);
      const evidenceDigest = computeModEvidenceDigest({
        featureId: manifest.id,
        featureVersion: manifest.version,
        worktreePath: cwd,
        baseSha,
        modifications,
        diff,
        astValidation,
        testResult
      });

      return {
        success: false,
        command: 'mod',
        featureId: manifest.id,
        featureVersion: manifest.version,
        worktreePath: cwd,
        baseSha,
        message: rollback.success
          ? `Repository tests failed (exit code ${testResult.exitCode}). Modifications were rolled back.`
          : `Repository tests failed (exit code ${testResult.exitCode}) and rollback failed: ${rollback.error}`,
        appliedFiles: [],
        diff,
        inverseDiff,
        astValidation,
        testResult,
        evidenceDigest,
        publicationStatus: 'pending_explicit_push',
        rolledBack: rollback.success,
        rollbackReason: `Tests failed: ${testResult.stderr || testResult.stdout || 'non-zero exit code'}`,
        error: `TESTS_FAILED: ${testResult.error || 'Test suite failed'}`
      };
    }
  }

  const evidenceDigest = computeModEvidenceDigest({
    featureId: manifest.id,
    featureVersion: manifest.version,
    worktreePath: cwd,
    baseSha,
    modifications,
    diff,
    astValidation,
    testResult
  });

  const successMessage = [
    `[SLOP MOD] Feature "${manifest.name}" (${manifest.version}) spliced into worktree.`,
    `  ✔ Base Git SHA verified: ${baseSha.slice(0, 8)}`,
    `  ✔ AST syntax & exports verified with TypeScript compiler (${astValidation.exports.length} exports, 0 errors)`,
    `  ✔ Applied ${applyResult.applied.length} file change(s) with a reversible transaction snapshot`,
    testResult ? `  ✔ Repository tests (${testResult.executable} ${testResult.args.join(' ')}): ${testResult.passed ? 'PASSED' : 'FAILED'} in ${testResult.durationMs}ms` : '  ✔ Test execution skipped by configuration',
    `  ✔ Evidence digest: ${evidenceDigest}`,
    `\nFeature modification verified locally. Publication is a separate explicit step.\n` +
      `Review and commit the changes, then use "slop push" only after configuring the intended Git remote. ` +
      `That command pushes Git; it does not deploy or publish a HOTWIRE listing.`
  ].join('\n');

  return {
    success: testResult ? testResult.passed : true,
    command: 'mod',
    featureId: manifest.id,
    featureVersion: manifest.version,
    worktreePath: cwd,
    baseSha,
    message: successMessage,
    appliedFiles: applyResult.applied,
    diff,
    inverseDiff,
    astValidation,
    testResult,
    evidenceDigest,
    publicationStatus: 'pending_explicit_push'
  };
}
