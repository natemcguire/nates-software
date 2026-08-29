// Temporary Test Sandbox for DYNO benchmark runner
// Provides filesystem and process isolation for executing and grading benchmark tasks.
// Prevents directory traversal, filters environment variables, enforces timeouts,
// and tracks file modifications against initial fixture manifests.

import { mkdtemp, rm, readFile, writeFile, unlink, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import {
  DynoSandboxInstance,
  DynoExecOptions,
  DynoExecResult,
  DynoFileChangeSummary,
  DynoTracerInstance,
  DynoNetworkPolicy
} from './types';
import { sha256, sha256File } from './crypto';
import { classifyCommandSafety } from './trace';

const SENSITIVE_ENV_PREFIXES = [
  'ANTHROPIC_',
  'OPENAI_',
  'CLOUDFLARE_',
  'AWS_',
  'GITHUB_',
  'STRIPE_',
  'DATABASE_',
  'JWT_',
  'COOKIE_',
  'SESSION_'
];

const SENSITIVE_ENV_KEYWORDS = [
  'KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'CREDENTIAL',
  'AUTH'
];

export function sanitizeEnvironment(customEnv?: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: process.env.HOME || tmpdir(),
    TMPDIR: tmpdir(),
    LANG: 'en_US.UTF-8',
    NODE_ENV: 'test',
    FORCE_COLOR: '0',
    PAGER: 'cat',
    CI: 'true'
  };

  // Filter out host environment variables that might leak secrets
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const upperKey = key.toUpperCase();

    // Check if key is sensitive
    const isSensitive = SENSITIVE_ENV_PREFIXES.some(prefix => upperKey.startsWith(prefix)) ||
      SENSITIVE_ENV_KEYWORDS.some(keyword => upperKey.includes(keyword));

    if (!isSensitive && ['USER', 'SHELL', 'TERM', 'LOGNAME'].includes(key)) {
      sanitized[key] = value;
    }
  }

  // Merge custom environment overrides
  if (customEnv) {
    for (const [k, v] of Object.entries(customEnv)) {
      if (v !== undefined) {
        sanitized[k] = String(v);
      }
    }
  }

  return sanitized;
}

export class DynoSandbox implements DynoSandboxInstance {
  readonly dir: string;
  private readonly initialFileHashes: Map<string, string> = new Map();
  private readonly tracer?: DynoTracerInstance;
  private readonly networkPolicy: DynoNetworkPolicy;
  private isCleanedUp = false;

  private constructor(dir: string, tracer?: DynoTracerInstance, networkPolicy: DynoNetworkPolicy = 'none') {
    this.dir = dir;
    this.tracer = tracer;
    this.networkPolicy = networkPolicy;
  }

  /**
   * Initializes a new temporary sandbox with optional initial fixture files.
   */
  static async create(options?: {
    initialFiles?: Record<string, string>;
    tracer?: DynoTracerInstance;
    prefix?: string;
    networkPolicy?: DynoNetworkPolicy;
  }): Promise<DynoSandbox> {
    const prefix = options?.prefix || 'dyno-task-';
    const tempDir = await mkdtemp(join(tmpdir(), prefix));
    const sandbox = new DynoSandbox(tempDir, options?.tracer, options?.networkPolicy || 'none');

    if (options?.initialFiles) {
      for (const [relPath, content] of Object.entries(options.initialFiles)) {
        await sandbox.writeFile(relPath, content);
      }
      // Snapshot initial files
      await sandbox.snapshotInitialFiles();
    }

    return sandbox;
  }

  private resolveSafePath(relativePath: string): string {
    if (this.isCleanedUp) {
      throw new Error(`Sandbox at ${this.dir} has already been cleaned up`);
    }
    const resolved = resolve(this.dir, relativePath);
    if (!resolved.startsWith(this.dir + sep) && resolved !== this.dir) {
      throw new Error(`Path traversal violation: '${relativePath}' escapes sandbox root '${this.dir}'`);
    }
    return resolved;
  }

  private async snapshotInitialFiles(): Promise<void> {
    this.initialFileHashes.clear();
    const files = await this.listFiles();
    for (const file of files) {
      const fullPath = this.resolveSafePath(file);
      const hash = await sha256File(fullPath);
      this.initialFileHashes.set(file, hash);
    }
  }

  async readFile(relativePath: string): Promise<string> {
    const fullPath = this.resolveSafePath(relativePath);
    const content = await readFile(fullPath, 'utf8');

    if (this.tracer) {
      this.tracer.recordToolEvent({
        toolName: 'read_file',
        commandClass: 'fs_read',
        input: { path: relativePath },
        output: { length: content.length, sha256: sha256(content) }
      });
    }

    return content;
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolveSafePath(relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');

    if (this.tracer) {
      this.tracer.recordToolEvent({
        toolName: 'write_file',
        commandClass: 'fs_write',
        input: { path: relativePath, length: content.length, sha256: sha256(content) },
        output: { success: true }
      });
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = this.resolveSafePath(relativePath);
    await unlink(fullPath);

    if (this.tracer) {
      this.tracer.recordToolEvent({
        toolName: 'delete_file',
        commandClass: 'fs_delete',
        input: { path: relativePath },
        output: { success: true }
      });
    }
  }

  async fileExists(relativePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolveSafePath(relativePath);
      return existsSync(fullPath);
    } catch {
      return false;
    }
  }

  async listFiles(relativeSubdir = ''): Promise<string[]> {
    const targetDir = this.resolveSafePath(relativeSubdir);
    if (!existsSync(targetDir)) return [];

    const results: string[] = [];

    async function walk(currentDir: string, baseDir: string) {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip .git or temporary hidden files
        if (entry.name === '.git') continue;
        const full = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, baseDir);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          results.push(relative(baseDir, full).split(sep).join('/'));
        }
      }
    }

    await walk(targetDir, this.dir);
    return results.sort();
  }

  async exec(command: string, args: string[] = [], options: DynoExecOptions = {}): Promise<DynoExecResult> {
    const fullCmd = args.length > 0 ? `${command} ${args.join(' ')}` : command;
    const safety = classifyCommandSafety(fullCmd, this.networkPolicy);
    const startTime = Date.now();

    // Policy-blocked and critically unsafe commands never reach the shell.
    if (safety === 'violation' || safety === 'blocked') {
      const result: DynoExecResult = {
        exitCode: 126,
        stdout: '',
        stderr: `Command blocked by DYNO safety policy: ${safety === 'blocked' ? 'network policy denied execution' : 'critical safety violation detected'}`,
        durationMs: 1,
        timedOut: false
      };

      if (this.tracer) {
        this.tracer.recordToolEvent({
          toolName: options.toolName || 'exec',
          commandClass: options.commandClass || 'process_exec',
          input: { command: fullCmd },
          output: result,
          durationMs: 1,
          exitCode: 126,
          safetyClassification: 'violation'
        });
      }

      return result;
    }

    const workingDir = options.cwd ? this.resolveSafePath(options.cwd) : this.dir;
    const timeoutMs = options.timeoutMs || 30_000;
    const maxBuffer = options.maxBufferBytes || 1024 * 1024 * 5; // 5MB

    const env = sanitizeEnvironment(options.env);

    return new Promise<DynoExecResult>((resolveResult) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(command, args, {
        cwd: workingDir,
        env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length + chunk.length <= maxBuffer) {
          stdout += chunk.toString();
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length + chunk.length <= maxBuffer) {
          stderr += chunk.toString();
        }
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const result: DynoExecResult = {
          exitCode: 1,
          stdout,
          stderr: stderr + `\nProcess error: ${err.message}`,
          durationMs,
          timedOut
        };

        if (this.tracer) {
          this.tracer.recordToolEvent({
            toolName: options.toolName || 'exec',
            commandClass: options.commandClass || 'process_exec',
            input: { command: fullCmd },
            output: result,
            durationMs,
            exitCode: 1,
            safetyClassification: safety
          });
        }

        resolveResult(result);
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const exitCode = timedOut ? 124 : (code ?? 0);

        const result: DynoExecResult = {
          exitCode,
          stdout,
          stderr: timedOut ? stderr + `\nCommand timed out after ${timeoutMs}ms` : stderr,
          durationMs,
          timedOut
        };

        if (this.tracer) {
          this.tracer.recordToolEvent({
            toolName: options.toolName || 'exec',
            commandClass: options.commandClass || 'process_exec',
            input: { command: fullCmd },
            output: result,
            durationMs,
            exitCode,
            safetyClassification: safety
          });
        }

        resolveResult(result);
      });
    });
  }

  async getFileChanges(expectedFiles: readonly string[]): Promise<DynoFileChangeSummary> {
    const currentFiles = await this.listFiles();
    const currentFilesSet = new Set(currentFiles);

    const modified: string[] = [];
    const created: string[] = [];
    const deleted: string[] = [];

    // Check created & modified
    for (const file of currentFiles) {
      const fullPath = this.resolveSafePath(file);
      const currentHash = await sha256File(fullPath);

      if (this.initialFileHashes.has(file)) {
        const initialHash = this.initialFileHashes.get(file)!;
        if (currentHash !== initialHash) {
          modified.push(file);
        }
      } else {
        created.push(file);
      }
    }

    // Check deleted
    for (const [file] of this.initialFileHashes.entries()) {
      if (!currentFilesSet.has(file)) {
        deleted.push(file);
      }
    }

    const expectedSet = new Set(expectedFiles.map(f => f.split(sep).join('/')));
    const allChanges = [...modified, ...created, ...deleted];
    const unnecessaryChanges = allChanges.filter(f => !expectedSet.has(f));

    return {
      modified: modified.sort(),
      created: created.sort(),
      deleted: deleted.sort(),
      unnecessaryChanges: unnecessaryChanges.sort()
    };
  }

  async cleanup(): Promise<void> {
    if (this.isCleanedUp) return;
    this.isCleanedUp = true;
    try {
      if (existsSync(this.dir)) {
        await rm(this.dir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error in tmp directory
    }
  }
}
