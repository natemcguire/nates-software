export interface TerminalCapabilities {
  gatewayVersion: string;
  provider: string;
  isolationType: 'process' | 'container' | 'vps';
  isProductionVps: boolean;
  truthStatement: string;
  authRequired: boolean;
  authMethods: string[];
  allowedOrigins: string[];
  availableTools: string[];
  limits: {
    maxConcurrentSessions: number;
    sessionTtlSeconds: number;
    idleTimeoutSeconds: number;
    maxOutputRateBytesPerSec: number;
    maxPayloadBytes: number;
    maxOutputBufferBytes: number;
  };
  features: {
    ptyResize: boolean;
    ephemeralWorkspaces: boolean;
    autoCleanup: boolean;
    zeroSecretBaking: boolean;
  };
}

export interface TerminalSessionInfo {
  sessionId: string;
  workspacePath: string;
  provider: string;
  isolationType: 'process' | 'container' | 'vps';
  isProductionVps: boolean;
  ttlSeconds: number;
  motd?: string;
}

export interface TerminalReadiness {
  success: boolean;
  ready: boolean;
  configured: boolean;
  capabilities?: TerminalCapabilities;
  error?: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'unreachable';

export interface TerminalClientCallbacks {
  onOutput?: (chunk: string) => void;
  onSessionReady?: (info: TerminalSessionInfo) => void;
  onStateChange?: (state: ConnectionState) => void;
  onError?: (error: string) => void;
  onClose?: (code: number, reason: string) => void;
}

export function getDefaultGatewayUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:4000';

  const envUrl = (import.meta as any).env?.VITE_TERMINAL_GATEWAY_URL;
  if (envUrl && typeof envUrl === 'string') return envUrl;

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:4000';
  }

  return `${window.location.protocol}//${window.location.host}`;
}

export function toWebSocketUrl(httpUrl: string, path = '/terminal'): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(httpUrl);
  } catch {
    parsedUrl = new URL(httpUrl, 'http://localhost');
  }

  parsedUrl.protocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  parsedUrl.pathname = cleanPath;

  return parsedUrl.toString();
}

export class TerminalClient {
  private gatewayUrl: string;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private callbacks: TerminalClientCallbacks;
  private sessionInfo: TerminalSessionInfo | null = null;

  constructor(gatewayUrl?: string, callbacks: TerminalClientCallbacks = {}) {
    this.gatewayUrl = gatewayUrl || getDefaultGatewayUrl();
    this.callbacks = callbacks;
  }

  getState(): ConnectionState {
    return this.state;
  }

  getSessionInfo(): TerminalSessionInfo | null {
    return this.sessionInfo;
  }

  private setState(newState: ConnectionState) {
    this.state = newState;
    this.callbacks.onStateChange?.(newState);
  }

  async checkCapabilities(): Promise<TerminalCapabilities | null> {
    try {
      const res = await fetch(`${this.gatewayUrl}/capabilities`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      return (await res.json()) as TerminalCapabilities;
    } catch {
      return null;
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.gatewayUrl}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async checkReadiness(): Promise<TerminalReadiness> {
    try {
      const res = await fetch('/api/terminal-session', { credentials: 'same-origin', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ready) {
        return {
          success: false,
          ready: false,
          configured: Boolean(data.configured),
          error: data.error || `Ephemeral terminal service returned HTTP ${res.status}`
        };
      }
      return {
        success: true,
        ready: true,
        configured: true,
        capabilities: data.capabilities
      };
    } catch (err: any) {
      return {
        success: false,
        ready: false,
        configured: false,
        error: err?.message || 'Failed to check terminal gateway readiness'
      };
    }
  }

  async connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setState('connecting');

    try {
      const readinessResponse = await fetch('/api/terminal-session', { credentials: 'same-origin', cache: 'no-store' });
      const readiness = await readinessResponse.json() as TerminalReadiness;
      if (!readinessResponse.ok || !readiness.ready) {
        throw new Error(readiness.error || 'Ephemeral terminal service is unavailable');
      }
      const ticketResponse = await fetch('/api/terminal-session', { method: 'POST', credentials: 'same-origin' });
      const ticketData = await ticketResponse.json();
      if (!ticketResponse.ok || !ticketData.success || !ticketData.ticket || !ticketData.gatewayUrl) {
        throw new Error(ticketData.error || 'Unable to authorize terminal session');
      }
      this.gatewayUrl = ticketData.gatewayUrl;
      const wsEndpoint = toWebSocketUrl(this.gatewayUrl, '/terminal');
      this.ws = new WebSocket(wsEndpoint, ['nsw-terminal-v1', `nsw-ticket.${ticketData.ticket}`]);

      this.ws.onopen = () => {
      };

      this.ws.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : '';
        try {
          const msg = JSON.parse(text);
          if (msg.type === 'session_ready') {
            this.sessionInfo = {
              sessionId: msg.sessionId,
              workspacePath: msg.workspacePath,
              provider: msg.provider,
              isolationType: msg.isolationType,
              isProductionVps: Boolean(msg.isProductionVps),
              ttlSeconds: msg.ttlSeconds,
              motd: msg.motd
            };
            this.setState('connected');
            this.callbacks.onSessionReady?.(this.sessionInfo);
            if (msg.motd) {
              this.callbacks.onOutput?.(msg.motd);
            }
            return;
          }

          if (msg.type === 'output') {
            this.callbacks.onOutput?.(msg.data);
            return;
          }

          if (msg.type === 'error') {
            this.callbacks.onError?.(msg.message);
            return;
          }

          if (msg.type === 'exit') {
            this.callbacks.onOutput?.(`\n[Process exited with code ${msg.code ?? 0}]\n`);
            return;
          }
        } catch {
          this.callbacks.onOutput?.(text);
        }
      };

      this.ws.onerror = () => {
        this.setState('error');
        this.callbacks.onError?.('WebSocket connection error to terminal gateway');
      };

      this.ws.onclose = (event) => {
        this.setState('disconnected');
        this.sessionInfo = null;
        this.callbacks.onClose?.(event.code, event.reason);
      };
    } catch (err: any) {
      this.setState('error');
      this.callbacks.onError?.(err.message || 'Failed to establish WebSocket connection');
    }
  }

  sendInput(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'input', data }));
  }

  sendResize(cols: number, rows: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
    this.setState('disconnected');
    this.sessionInfo = null;
  }
}
