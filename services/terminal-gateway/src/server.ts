import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  GatewayConfig,
  GatewayCapabilities,
  TerminalProvider,
  WsClientMessage,
  WsServerMessage,
  LimitsConfig
} from './types.js';
import { isOriginAllowed, extractAuthToken, validateToken } from './auth.js';
import { SessionManager } from './sessionManager.js';
import { LocalProcessProvider } from './providers/LocalProcessProvider.js';
import { DaytonaSandboxProvider } from './providers/DaytonaSandboxProvider.js';
import { CORE_TERMINAL_TOOLS, LOCAL_TERMINAL_TOOLS } from './toolchain.js';

export const DEFAULT_LIMITS: LimitsConfig = {
  maxConcurrentSessions: 10,
  sessionTtlSeconds: 900,
  idleTimeoutSeconds: 300,
  maxOutputRateBytesPerSec: 1024 * 1024,
  maxPayloadBytes: 64 * 1024,
  maxOutputBufferBytes: 512 * 1024
};

export const DEFAULT_CONFIG: GatewayConfig = {
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:5173'],
  validTokens: process.env.VALID_TOKENS
    ? process.env.VALID_TOKENS.split(',').map(s => s.trim())
    : [],
  tokenSecret: process.env.TERMINAL_TICKET_SECRET,
  redeemUrl: process.env.TERMINAL_REDEEM_URL,
  gatewayServiceSecret: process.env.TERMINAL_GATEWAY_SERVICE_SECRET,
  limits: DEFAULT_LIMITS,
  repoRoot: process.env.REPO_ROOT || process.cwd()
};

export interface TerminalGatewayInstance {
  httpServer: HttpServer;
  wss: WebSocketServer;
  sessionManager: SessionManager;
  provider: TerminalProvider;
  config: GatewayConfig;
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function assertProductionConfig(config: GatewayConfig): void {
  if (!config.tokenSecret || config.tokenSecret.length < 32) {
    throw new Error('Production terminal gateway requires a TERMINAL_TICKET_SECRET of at least 32 characters');
  }
  if (!config.gatewayServiceSecret || config.gatewayServiceSecret.length < 32) {
    throw new Error('Production terminal gateway requires a TERMINAL_GATEWAY_SERVICE_SECRET of at least 32 characters');
  }
  let redeemUrl: URL;
  try {
    redeemUrl = new URL(config.redeemUrl || '');
  } catch {
    throw new Error('Production terminal gateway requires a valid HTTPS TERMINAL_REDEEM_URL');
  }
  if (redeemUrl.protocol !== 'https:') {
    throw new Error('Production terminal gateway requires a valid HTTPS TERMINAL_REDEEM_URL');
  }
  if (!config.allowedOrigins.length || config.allowedOrigins.some(origin => {
    if (origin === 'https://*.nates-software.pages.dev') return false;
    return origin.includes('*') || !origin.startsWith('https://');
  })) {
    throw new Error('Production terminal gateway requires explicit HTTPS origins (only the official Pages preview wildcard is allowed)');
  }
  if (config.validTokens?.length) {
    throw new Error('Production terminal gateway does not accept static VALID_TOKENS; use signed single-use tickets');
  }
}

export function createTerminalGateway(
  userConfig: Partial<GatewayConfig> = {},
  customProvider?: TerminalProvider
): TerminalGatewayInstance {
  const config: GatewayConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    limits: {
      ...DEFAULT_LIMITS,
      ...(userConfig.limits || {})
    }
  };

  if (process.env.NODE_ENV === 'production') assertProductionConfig(config);

  const provider = customProvider || (process.env.NODE_ENV === 'production'
    ? new DaytonaSandboxProvider({
        apiKey: process.env.DAYTONA_API_KEY || '',
        apiUrl: process.env.DAYTONA_API_URL,
        target: process.env.DAYTONA_TARGET,
        snapshot: process.env.DAYTONA_SNAPSHOT || '',
        ttlMinutes: Math.ceil(config.limits.sessionTtlSeconds / 60),
        vmIsolationVerified: process.env.DAYTONA_VM_ISOLATION_VERIFIED === 'true'
      })
    : new LocalProcessProvider(config.repoRoot));
  const sessionManager = new SessionManager(provider, config.limits);

  const getCapabilities = (): GatewayCapabilities => ({
    gatewayVersion: '1.0.0',
    provider: provider.name,
    isolationType: provider.isolationType,
    isProductionVps: provider.isProductionVps,
    truthStatement: provider.getTruthStatement(),
    authRequired: true,
    authMethods: ['bearer_token', 'websocket_protocol'],
    allowedOrigins: config.allowedOrigins,
    availableTools: [...(provider.isProductionVps ? CORE_TERMINAL_TOOLS : LOCAL_TERMINAL_TOOLS)],
    limits: config.limits,
    features: {
      ptyResize: true,
      ephemeralWorkspaces: true,
      autoCleanup: true,
      zeroSecretBaking: true
    }
  });

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const reqOrigin = req.headers['origin'] as string | undefined;
    const allowOriginHeader = isOriginAllowed(reqOrigin, config.allowedOrigins)
      ? (reqOrigin || '*')
      : 'null';

    res.setHeader('Access-Control-Allow-Origin', allowOriginHeader);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Sec-WebSocket-Protocol');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/health' || pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: process.uptime(),
          activeSessions: sessionManager.getActiveCount(),
          timestamp: new Date().toISOString()
        })
      );
      return;
    }

    if (pathname === '/capabilities' || pathname === '/v1/capabilities' || pathname === '/api/capabilities') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getCapabilities(), null, 2));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
  });

  const usedTicketDigests = new Set<string>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.limits.maxPayloadBytes,
    handleProtocols: protocols => protocols.has('nsw-terminal-v1') ? 'nsw-terminal-v1' : false
  });

  httpServer.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const origin = req.headers['origin'] as string | undefined;

    if (!isOriginAllowed(origin, config.allowedOrigins)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    if (sessionManager.isAtCapacity()) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    const { token } = extractAuthToken(req);
    const authResult = validateToken(token, config.validTokens, config.tokenSecret);
    if (!authResult.valid) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (process.env.NODE_ENV === 'production' && token) {
      const digest = token.slice(-43);
      if (usedTicketDigests.has(digest)) {
        socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const gatewaySessionId = randomUUID();
    if (process.env.NODE_ENV === 'production') {
      if (!config.redeemUrl || !config.gatewayServiceSecret || !authResult.ticketId || !authResult.user) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }
      try {
        const redemption = await fetch(`${config.redeemUrl}?action=redeem`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.gatewayServiceSecret}` },
          body: JSON.stringify({ jti: authResult.ticketId, userId: authResult.user.id, gatewaySessionId })
        });
        if (!redemption.ok) {
          const status = redemption.status === 409 ? '409 Conflict' : '401 Unauthorized';
          socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
          socket.destroy();
          return;
        }
      } catch {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    if (process.env.NODE_ENV === 'production' && token) {
      const digest = token.slice(-43);
      usedTicketDigests.add(digest);
      setTimeout(() => usedTicketDigests.delete(digest), 90_000).unref();
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { ...authResult.user, gatewaySessionId });
    });
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage, user?: any) => {
    const sessionId = user?.gatewaySessionId || randomUUID();
    let session: any = null;
    let lifecycleClosed = false;
    const closeLifecycle = () => {
      if (lifecycleClosed || !config.redeemUrl || !config.gatewayServiceSecret) return;
      lifecycleClosed = true;
      void fetch(`${config.redeemUrl}?action=close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.gatewayServiceSecret}` },
        body: JSON.stringify({ gatewaySessionId: sessionId })
      }).catch(() => undefined);
    };

    const sendWs = (msg: WsServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > config.limits.maxOutputBufferBytes) {
          ws.close(1009, 'Terminal output backpressure limit exceeded');
          return;
        }
        ws.send(JSON.stringify(msg));
      }
    };

    try {
      session = await sessionManager.createSession({
        sessionId,
        userId: user?.id,
        username: user?.username || 'maker',
        repoRoot: config.repoRoot
      });

      sendWs({
        type: 'session_ready',
        sessionId: session.id,
        workspacePath: session.workspacePath,
        provider: provider.name,
        isolationType: provider.isolationType,
        isProductionVps: provider.isProductionVps,
        ttlSeconds: config.limits.sessionTtlSeconds,
        motd: `⚡ Nate's Software Ephemeral Terminal [${provider.isolationType.toUpperCase()} ISOLATION]\nWorkspace: ${session.workspacePath}\n`
      });

      session.onOutput((chunk: string) => {
        if (!sessionManager.checkRateLimit(sessionId, Buffer.byteLength(chunk))) {
          sendWs({ type: 'error', message: 'Terminal output rate exceeded; session terminated', code: 'OUTPUT_RATE_LIMIT' });
          ws.close(1009, 'Terminal output rate limit exceeded');
          void sessionManager.destroySession(sessionId, 'Output rate limit exceeded');
          return;
        }
        sendWs({
          type: 'output',
          data: chunk
        });
      });

      session.onExit((code: number | null, signal: string | null) => {
        closeLifecycle();
        sendWs({
          type: 'exit',
          code,
          signal
        });
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Process exited');
        }
      });

      sessionManager.registerCleanup(sessionId, () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Session cleaned up');
        }
      });
    } catch (err: any) {
      closeLifecycle();
      sendWs({
        type: 'error',
        message: err.message || 'Failed to initialize terminal session'
      });
      ws.close(1011, 'Session initialization failed');
      return;
    }

    ws.on('message', (data: Buffer | string) => {
      if (!session || !session.isAlive()) return;

      const raw = data.toString();
      try {
        const parsed = JSON.parse(raw) as WsClientMessage;
        if (parsed.type === 'input') {
          if (typeof parsed.data !== 'string') {
            sendWs({ type: 'error', message: 'Terminal input must be a string', code: 'INVALID_INPUT' });
            return;
          }
          session.write(parsed.data);
        } else if (parsed.type === 'resize') {
          if (!Number.isInteger(parsed.cols) || !Number.isInteger(parsed.rows) || parsed.cols < 20 || parsed.cols > 500 || parsed.rows < 5 || parsed.rows > 200) {
            sendWs({ type: 'error', message: 'Terminal dimensions are out of range', code: 'INVALID_RESIZE' });
            return;
          }
          session.resize(parsed.cols, parsed.rows);
        } else if (parsed.type === 'ping') {
          sendWs({ type: 'pong' });
        } else {
          sendWs({ type: 'error', message: 'Unknown terminal message type', code: 'INVALID_MESSAGE' });
        }
      } catch {
        session.write(raw);
      }
    });

    ws.on('close', () => {
      closeLifecycle();
      if (session) {
        sessionManager.destroySession(sessionId, 'Client disconnected').catch(() => {});
      }
    });

    ws.on('error', () => {
      closeLifecycle();
      if (session) {
        sessionManager.destroySession(sessionId, 'WebSocket error').catch(() => {});
      }
    });
  });

  return {
    httpServer,
    wss,
    sessionManager,
    provider,
    config,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        httpServer.listen(config.port, config.host, () => {
          const address = httpServer.address();
          const port = typeof address === 'object' && address ? address.port : config.port;
          resolve(port);
        });
        httpServer.once('error', reject);
      }),
    close: async () => {
      await sessionManager.shutdown();
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}
