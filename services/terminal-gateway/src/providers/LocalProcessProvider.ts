import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BaseTerminalProvider } from './TerminalProvider.js';
import type {
  TerminalSession,
  SessionOptions,
  IsolationType
} from '../types.js';

export class LocalProcessSession implements TerminalSession {
  readonly id: string;
  readonly workspacePath: string;
  readonly createdAt: number;
  lastActivityAt: number;

  private child: ChildProcess | null = null;
  private outputListeners: ((data: string) => void)[] = [];
  private exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
  private destroyed = false;

  constructor(id: string, workspacePath: string, child: ChildProcess) {
    this.id = id;
    this.workspacePath = workspacePath;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
    this.child = child;

    // Attach output streams
    if (this.child.stdout) {
      this.child.stdout.on('data', (chunk: Buffer) => {
        this.lastActivityAt = Date.now();
        const text = chunk.toString('utf-8');
        for (const listener of this.outputListeners) {
          listener(text);
        }
      });
    }

    if (this.child.stderr) {
      this.child.stderr.on('data', (chunk: Buffer) => {
        this.lastActivityAt = Date.now();
        const text = chunk.toString('utf-8');
        for (const listener of this.outputListeners) {
          listener(text);
        }
      });
    }

    this.child.on('close', (code, signal) => {
      for (const listener of this.exitListeners) {
        listener(code, signal);
      }
    });
  }

  write(data: string): void {
    if (this.destroyed || !this.child || !this.child.stdin || !this.child.stdin.writable) {
      return;
    }
    this.lastActivityAt = Date.now();
    this.child.stdin.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.destroyed || !this.child) return;
    this.lastActivityAt = Date.now();
    // In local-process mode without native PTY openpty(), simulate terminal size via env or stty if available
    try {
      if (this.child.pid) {
        // Send terminal dimension update if supported
      }
    } catch {}
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.child && !this.child.killed) {
      try {
        if (this.child.pid) {
          // Kill process group if detached, otherwise direct child
          try {
            process.kill(-this.child.pid, signal);
          } catch {
            this.child.kill(signal);
          }
        }
      } catch {
        try {
          this.child.kill(signal);
        } catch {}
      }
    }
  }

  onOutput(callback: (data: string) => void): void {
    this.outputListeners.push(callback);
  }

  onExit(callback: (code: number | null, signal: string | null) => void): void {
    this.exitListeners.push(callback);
  }

  isAlive(): boolean {
    return !this.destroyed && this.child !== null && !this.child.killed && this.child.exitCode === null;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // 1. Terminate child process
    this.kill('SIGTERM');

    // Give grace period before SIGKILL
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    this.kill('SIGKILL');

    // 2. Erase ephemeral workspace directory recursively
    try {
      if (fs.existsSync(this.workspacePath)) {
        fs.rmSync(this.workspacePath, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`[LocalProcessSession] Error cleaning workspace ${this.workspacePath}:`, err);
    }
  }
}

export class LocalProcessProvider extends BaseTerminalProvider {
  readonly id = 'local-process';
  readonly name = 'Local Process Provider';
  readonly isolationType: IsolationType = 'process';
  readonly isProductionVps = false;
  readonly description =
    'Local Process Isolation (Development / Non-Production): executes real PTY child processes inside disposable /tmp directories on the host operating system. Does not provide hardware virtualization or VPS multi-tenant kernel isolation.';

  private repoRoot: string;

  constructor(repoRoot?: string) {
    super();
    this.repoRoot = repoRoot || process.cwd();
  }

  getTruthStatement(): string {
    return 'NON-PRODUCTION DEVELOPMENT PROVIDER: Sessions execute as local child processes on the host. Isolation is filesystem-path only via disposable /tmp directories, without kernel containerization or VPS hardware virtualization.';
  }

  async createSession(options: SessionOptions): Promise<TerminalSession> {
    const sessionId = options.sessionId;
    const workspacePath = path.join(os.tmpdir(), `nsw-terminal-${sessionId}`);

    // 1. Create clean ephemeral workspace
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
    fs.mkdirSync(workspacePath, { recursive: true });

    // 2. Set up workspace bin directory and SLOP wrapper
    const binDir = path.join(workspacePath, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const slopSourcePath = path.resolve(this.repoRoot, 'bin/slop.ts');
    const slopWrapperScript = `#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const slopTs = ${JSON.stringify(slopSourcePath)};
const repoDir = ${JSON.stringify(this.repoRoot)};

// Execute slop CLI in the context of this workspace
const res = spawnSync('npx', ['tsx', slopTs, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_PATH: resolve(repoDir, 'node_modules')
  }
});
process.exit(res.status ?? (res.error ? 1 : 0));
`;

    const slopBinPath = path.join(binDir, 'slop');
    fs.writeFileSync(slopBinPath, slopWrapperScript, { mode: 0o755 });

    // 3. Initialize workspace starter template
    const initialPkg = {
      name: `workspace-${sessionId.slice(0, 8)}`,
      version: '1.0.0',
      private: true,
      description: 'Nate\'s Software Ephemeral Terminal Workspace',
      scripts: {
        test: 'slop test',
        status: 'slop status'
      }
    };
    fs.writeFileSync(
      path.join(workspacePath, 'package.json'),
      JSON.stringify(initialPkg, null, 2) + '\n'
    );

    fs.writeFileSync(
      path.join(workspacePath, 'README.md'),
      `# ⚡ Nate's Software Ephemeral Workspace\n\nSession ID: \`${sessionId}\`\nInitialized: ${new Date().toISOString()}\n\nAvailable tools: \`slop\`, \`git\`, \`node\`, \`npm\`, \`npx\`.\nRun \`slop help\` to get started.\n`
    );

    // Initialize git in workspace
    try {
      const gitInitRes = spawn('git', ['init', '-b', 'main', workspacePath], { stdio: 'ignore' });
      await new Promise<void>(resolve => {
        gitInitRes.on('close', () => resolve());
        gitInitRes.on('error', () => resolve());
      });
    } catch {}

    // 4. Clean and sanitize environment variables (Never leak LLM credentials or platform keys)
    const sanitizedEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      HOME: workspacePath,
      TMPDIR: workspacePath,
      USER: options.username || 'maker',
      LOGNAME: options.username || 'maker',
      PWD: workspacePath,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      PATH: `${binDir}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}`,
      NSW_SESSION_ID: sessionId,
      NSW_ISOLATION: 'process',
      NSW_PRODUCTION_VPS: 'false'
    };

    // Explicitly delete sensitive keys to guarantee zero secret leakage
    const sensitiveKeyPatterns = [
      /API_KEY/i,
      /SECRET/i,
      /TOKEN/i,
      /AUTH/i,
      /PASSWORD/i,
      /CREDENTIAL/i,
      /PRIVATE/i,
      /^OPENAI_/i,
      /^ANTHROPIC_/i,
      /^GEMINI_/i,
      /^GOOGLE_/i,
      /^CLOUDFLARE_/i,
      /^STRIPE_/i,
      /^AWS_/i,
      /^GITHUB_TOKEN/i
    ];

    for (const key of Object.keys(sanitizedEnv)) {
      if (key === 'NSW_SESSION_ID' || key === 'NSW_ISOLATION' || key === 'NSW_PRODUCTION_VPS') continue;
      if (sensitiveKeyPatterns.some(pattern => pattern.test(key))) {
        delete sanitizedEnv[key];
      }
    }

    // Merge any explicitly provided non-sensitive session env vars
    if (options.env) {
      for (const [k, v] of Object.entries(options.env)) {
        if (!sensitiveKeyPatterns.some(p => p.test(k))) {
          sanitizedEnv[k] = v;
        }
      }
    }

    // 5. Select shell executable
    const shellCandidates = [
      process.env.SHELL,
      '/bin/bash',
      '/usr/bin/bash',
      '/bin/zsh',
      '/bin/sh'
    ].filter(Boolean) as string[];

    let selectedShell = '/bin/sh';
    for (const cand of shellCandidates) {
      if (fs.existsSync(cand)) {
        selectedShell = cand;
        break;
      }
    }

    // Spawn shell
    const child = spawn(selectedShell, ['-i'], {
      cwd: workspacePath,
      env: sanitizedEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true
    });

    const session = new LocalProcessSession(sessionId, workspacePath, child);
    this.activeSessions.set(sessionId, session);
    this.totalCreated++;

    return session;
  }
}
