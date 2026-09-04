import type {
  TerminalProvider,
  TerminalSession,
  SessionOptions,
  LimitsConfig
} from './types.js';

export interface ManagedSession {
  session: TerminalSession;
  ttlTimer: NodeJS.Timeout;
  idleCheckTimer: NodeJS.Timeout;
  byteCountWindow: number;
  windowStart: number;
  cleanupCallbacks: (() => void)[];
}

export class SessionManager {
  private provider: TerminalProvider;
  private limits: LimitsConfig;
  private sessions = new Map<string, ManagedSession>();
  private isShuttingDown = false;
  private pendingCreates = 0;

  constructor(provider: TerminalProvider, limits: LimitsConfig) {
    this.provider = provider;
    this.limits = limits;
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  isAtCapacity(): boolean {
    return this.sessions.size + this.pendingCreates >= this.limits.maxConcurrentSessions;
  }

  async createSession(options: SessionOptions): Promise<TerminalSession> {
    if (this.isShuttingDown) {
      throw new Error('Terminal gateway is shutting down');
    }

    if (this.isAtCapacity()) {
      throw new Error(`Max concurrent sessions limit reached (${this.limits.maxConcurrentSessions})`);
    }

    this.pendingCreates++;
    let session: TerminalSession;
    try {
      session = await this.provider.createSession(options);
    } finally {
      this.pendingCreates--;
    }
    const sessionId = session.id;

    const ttlMs = this.limits.sessionTtlSeconds * 1000;
    const ttlTimer = setTimeout(async () => {
      console.log(`[SessionManager] Session ${sessionId} reached hard TTL (${this.limits.sessionTtlSeconds}s). Terminating.`);
      await this.destroySession(sessionId, 'Hard TTL expired');
    }, ttlMs);

    const idleCheckTimer = setInterval(async () => {
      const idleMs = Date.now() - session.lastActivityAt;
      if (idleMs > this.limits.idleTimeoutSeconds * 1000) {
        console.log(`[SessionManager] Session ${sessionId} timed out due to inactivity (${Math.round(idleMs / 1000)}s). Terminating.`);
        await this.destroySession(sessionId, 'Idle timeout expired');
      }
    }, 15000);

    const managed: ManagedSession = {
      session,
      ttlTimer,
      idleCheckTimer,
      byteCountWindow: 0,
      windowStart: Date.now(),
      cleanupCallbacks: []
    };

    this.sessions.set(sessionId, managed);

    session.onExit(() => {
      this.destroySession(sessionId, 'Process exited').catch(() => {});
    });

    return session;
  }

  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  checkRateLimit(sessionId: string, chunkSize: number): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed) return false;

    const now = Date.now();
    if (now - managed.windowStart >= 1000) {
      managed.windowStart = now;
      managed.byteCountWindow = 0;
    }

    managed.byteCountWindow += chunkSize;
    if (managed.byteCountWindow > this.limits.maxOutputRateBytesPerSec) {
      return false;
    }

    return true;
  }

  registerCleanup(sessionId: string, cb: () => void): void {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      managed.cleanupCallbacks.push(cb);
    }
  }

  async destroySession(sessionId: string, reason = 'Normal termination'): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    this.sessions.delete(sessionId);

    clearTimeout(managed.ttlTimer);
    clearInterval(managed.idleCheckTimer);

    for (const cb of managed.cleanupCallbacks) {
      try {
        cb();
      } catch {}
    }

    await this.provider.destroySession(sessionId);
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.destroySession(id, 'Gateway shutdown')));
  }
}
