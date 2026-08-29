import type { IncomingMessage } from 'node:http';

export type IsolationType = 'process' | 'container' | 'vps';

export interface LimitsConfig {
  maxConcurrentSessions: number;
  sessionTtlSeconds: number;
  idleTimeoutSeconds: number;
  maxOutputRateBytesPerSec: number;
  maxPayloadBytes: number;
  maxOutputBufferBytes: number;
}

export interface GatewayCapabilities {
  gatewayVersion: string;
  provider: string;
  isolationType: IsolationType;
  isProductionVps: boolean;
  truthStatement: string;
  authRequired: boolean;
  authMethods: ('bearer_token' | 'query_param' | 'cookie' | 'websocket_protocol')[];
  allowedOrigins: string[];
  availableTools: string[];
  limits: LimitsConfig;
  features: {
    ptyResize: boolean;
    ephemeralWorkspaces: boolean;
    autoCleanup: boolean;
    zeroSecretBaking: boolean;
  };
}

export interface SessionOptions {
  sessionId: string;
  userId?: string;
  username?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  repoRoot?: string;
}

export interface TerminalSession {
  readonly id: string;
  readonly workspacePath: string;
  readonly createdAt: number;
  lastActivityAt: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
  onOutput(callback: (data: string) => void): void;
  onExit(callback: (code: number | null, signal: string | null) => void): void;
  isAlive(): boolean;
  destroy(): Promise<void>;
}

export interface ProviderStats {
  activeSessions: number;
  totalSessionsCreated: number;
}

export interface TerminalProvider {
  readonly id: string;
  readonly name: string;
  readonly isolationType: IsolationType;
  readonly isProductionVps: boolean;
  readonly description: string;
  createSession(options: SessionOptions): Promise<TerminalSession>;
  destroySession(sessionId: string): Promise<void>;
  getStats(): ProviderStats;
  getTruthStatement(): string;
}

export interface GatewayConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  validTokens?: string[];
  tokenSecret?: string;
  redeemUrl?: string;
  gatewayServiceSecret?: string;
  limits: LimitsConfig;
  repoRoot?: string;
}

export interface AuthValidationResult {
  valid: boolean;
  ticketId?: string;
  user?: {
    id: string;
    username: string;
    role?: string;
  };
  error?: string;
}

export type WsClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' }
  | { type: 'auth'; token: string };

export type WsServerMessage =
  | { type: 'output'; data: string }
  | { type: 'session_ready'; sessionId: string; workspacePath: string; provider: string; isolationType: IsolationType; isProductionVps: boolean; ttlSeconds: number; motd?: string }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' };
