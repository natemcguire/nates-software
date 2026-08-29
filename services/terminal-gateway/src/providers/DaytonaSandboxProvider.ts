import { Daytona, type Sandbox, type PtyHandle } from '@daytona/sdk';
import { BaseTerminalProvider } from './TerminalProvider.js';
import type { IsolationType, SessionOptions, TerminalSession } from '../types.js';

type OutputListener = (data: string) => void;
type ExitListener = (code: number | null, signal: string | null) => void;

export interface DaytonaProviderConfig {
  apiKey: string;
  snapshot: string;
  ttlMinutes: number;
  vmIsolationVerified: boolean;
  apiUrl?: string;
  target?: string;
}

class DaytonaTerminalSession implements TerminalSession {
  readonly createdAt = Date.now();
  lastActivityAt = Date.now();
  readonly workspacePath = '/workspace';
  private alive = true;
  private readonly outputListeners = new Set<OutputListener>();
  private readonly exitListeners = new Set<ExitListener>();

  constructor(
    readonly id: string,
    private readonly sandbox: Sandbox,
    private readonly pty: PtyHandle
  ) {}

  emitOutput(data: string): void {
    this.lastActivityAt = Date.now();
    this.outputListeners.forEach(listener => listener(data));
  }

  write(data: string): void {
    if (!this.alive) return;
    this.lastActivityAt = Date.now();
    void this.pty.sendInput(data).catch(() => this.emitExit(1, 'PTY_WRITE_FAILED'));
  }

  resize(cols: number, rows: number): void {
    if (!this.alive) return;
    this.lastActivityAt = Date.now();
    void this.pty.resize(cols, rows).catch(() => undefined);
  }

  kill(): void {
    if (!this.alive) return;
    void this.pty.kill().catch(() => undefined);
  }

  onOutput(callback: OutputListener): void {
    this.outputListeners.add(callback);
  }

  onExit(callback: ExitListener): void {
    this.exitListeners.add(callback);
  }

  isAlive(): boolean {
    return this.alive && this.pty.isConnected();
  }

  async destroy(): Promise<void> {
    if (!this.alive) return;
    this.alive = false;
    try { await this.pty.kill(); } catch {}
    try { await this.pty.disconnect(); } catch {}
    // The sandbox is ephemeral and has autoDeleteInterval=0, but explicit deletion
    // makes disconnect cleanup deterministic instead of waiting for provider GC.
    try { await this.sandbox.delete(60, true); } catch {}
  }

  emitExit(code: number | null, signal: string | null): void {
    if (!this.alive) return;
    this.alive = false;
    this.exitListeners.forEach(listener => listener(code, signal));
  }
}

/**
 * Creates one Daytona sandbox per browser session. Production startup is
 * fail-closed unless the configured snapshot has been independently verified
 * as VM-backed; a generic shared-kernel container must never be called a VPS.
 */
export class DaytonaSandboxProvider extends BaseTerminalProvider {
  readonly id = 'daytona-ephemeral-vm';
  readonly name = 'Daytona Ephemeral VM Provider';
  readonly isolationType: IsolationType = 'vps';
  readonly isProductionVps = true;
  readonly description = 'One ephemeral Daytona VM sandbox and native PTY per terminal session; no volumes or snapshots are written during a session.';
  private readonly client: Daytona;

  constructor(private readonly config: DaytonaProviderConfig, client?: Daytona) {
    super();
    if (!config.apiKey || !config.snapshot || !config.vmIsolationVerified) {
      throw new Error('Daytona VM provider requires DAYTONA_API_KEY, DAYTONA_SNAPSHOT, and DAYTONA_VM_ISOLATION_VERIFIED=true');
    }
    this.client = client || new Daytona({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      target: config.target,
      otelEnabled: false
    });
  }

  getTruthStatement(): string {
    return 'PRODUCTION VM ISOLATION: every connection receives a separate verified VM-backed Daytona sandbox with a native PTY, hard TTL, no mounted volume, and explicit deletion on disconnect.';
  }

  async createSession(options: SessionOptions): Promise<TerminalSession> {
    const sandbox = await this.client.create({
      snapshot: this.config.snapshot,
      name: `nsw-terminal-${options.sessionId}`,
      user: 'daytona',
      ephemeral: true,
      ttlMinutes: this.config.ttlMinutes,
      autoStopInterval: 0,
      autoPauseInterval: 0,
      autoDeleteInterval: 0,
      volumes: [],
      public: false,
      labels: { product: 'terminal-exe', session: options.sessionId }
    }, { timeout: 90 });

    try {
      const proof = await sandbox.process.executeCommand(
        "mkdir -p /workspace && cd /workspace && command -v git && command -v node && command -v npm && command -v npx && command -v slop",
        undefined,
        undefined,
        30
      );
      if (proof.exitCode !== 0) {
        throw new Error(`Terminal snapshot is missing required tooling: ${proof.result || 'capability probe failed'}`);
      }

      let session!: DaytonaTerminalSession;
      const pty = await sandbox.process.createPty({
        id: `pty-${options.sessionId}`,
        cwd: '/workspace',
        cols: options.cols || 80,
        rows: options.rows || 25,
        envs: { TERM: 'xterm-256color', NSW_SESSION_ID: options.sessionId },
        onData: data => session?.emitOutput(new TextDecoder().decode(data))
      });
      await pty.waitForConnection();
      session = new DaytonaTerminalSession(options.sessionId, sandbox, pty);
      this.activeSessions.set(options.sessionId, session);
      this.totalCreated++;
      void pty.wait().then(result => session.emitExit(result.exitCode ?? null, result.error || null)).catch(() => session.emitExit(1, 'PTY_FAILED'));
      return session;
    } catch (error) {
      try { await sandbox.delete(60, true); } catch {}
      throw error;
    }
  }
}
