import { createTerminalGateway, DEFAULT_CONFIG, DEFAULT_LIMITS } from './server.js';
import { LocalProcessProvider } from './providers/LocalProcessProvider.js';
import { DaytonaSandboxProvider } from './providers/DaytonaSandboxProvider.js';
import { BaseTerminalProvider } from './providers/TerminalProvider.js';
import { SessionManager } from './sessionManager.js';
import { extractAuthToken, validateToken, isOriginAllowed } from './auth.js';

export * from './types.js';
export {
  createTerminalGateway,
  DEFAULT_CONFIG,
  DEFAULT_LIMITS,
  LocalProcessProvider,
  DaytonaSandboxProvider,
  BaseTerminalProvider,
  SessionManager,
  extractAuthToken,
  validateToken,
  isOriginAllowed
};

// Start standalone server when executed directly
if (
  typeof process !== 'undefined' &&
  process.argv &&
  (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js'))
) {
  const gateway = createTerminalGateway();
  gateway.listen().then(port => {
    console.log(`
┌────────────────────────────────────────────────────────────┐
│ ⚡ NATE'S SOFTWARE TERMINAL GATEWAY v1.0.0                  │
│ Status: Online on http://${gateway.config.host}:${port}                  │
│ Provider: ${gateway.provider.name} (${gateway.provider.isolationType})               │
│ Truth: ${gateway.provider.isProductionVps ? 'Production VPS' : 'Non-Production (Process Sandbox)'}         │
└────────────────────────────────────────────────────────────┘
`);
    console.log(`[GATEWAY] Health Check:   http://${gateway.config.host}:${port}/health`);
    console.log(`[GATEWAY] Capabilities:   http://${gateway.config.host}:${port}/capabilities`);
    console.log(`[GATEWAY] WebSocket PTY:  ws://${gateway.config.host}:${port}/terminal`);
    console.log(`[GATEWAY] TTL:            ${gateway.config.limits.sessionTtlSeconds}s | Idle: ${gateway.config.limits.idleTimeoutSeconds}s`);
  }).catch(err => {
    console.error('[GATEWAY] Failed to start:', err);
    process.exit(1);
  });
}
