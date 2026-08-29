import type {
  TerminalProvider,
  TerminalSession,
  SessionOptions,
  IsolationType,
  ProviderStats
} from '../types.js';

export abstract class BaseTerminalProvider implements TerminalProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly isolationType: IsolationType;
  abstract readonly isProductionVps: boolean;
  abstract readonly description: string;

  protected activeSessions = new Map<string, TerminalSession>();
  protected totalCreated = 0;

  abstract createSession(options: SessionOptions): Promise<TerminalSession>;

  async destroySession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      this.activeSessions.delete(sessionId);
      await session.destroy();
    }
  }

  getStats(): ProviderStats {
    return {
      activeSessions: this.activeSessions.size,
      totalSessionsCreated: this.totalCreated
    };
  }

  abstract getTruthStatement(): string;
}
