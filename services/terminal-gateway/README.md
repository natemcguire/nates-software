# @nates-software/terminal-gateway

> **Real Ephemeral Linux Terminal Gateway for TERMINAL.EXE**
> Provides authenticated WebSocket connections to real PTYs and disposable workspaces.

---

## 1. Truth in Architecture & Isolation Guarantees

Nate's Software Suite strictly documents the actual isolation model provided by each runtime provider:

| Provider | Isolation Type | Production VPS? | Security & Isolation Boundary |
| :--- | :--- | :--- | :--- |
| **`LocalProcessProvider`** | `process` | **No** (Dev Only) | Child process and disposable directory only; it is not a native PTY or a multi-tenant boundary. |
| **`DaytonaSandboxProvider`** | `vps` | **Yes, only with a verified VM snapshot** | One provider-managed ephemeral VM and native PTY per session, with hard TTL and explicit deletion. |

> [!IMPORTANT]
> **Railway / PaaS Note:** Standard container hosting on Railway or Cloudflare provides container or process-level isolation. Unless backed by a dedicated hypervisor control plane (MicroVMs), it must be truthfully advertised as **Container / Process Isolation**, not hardware VPS isolation.

---

## 2. Security & Ephemeral Lifecycle Model

1. **Zero Secret Baking:**
   - No LLM credentials (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`), Stripe keys, or Cloudflare tokens are ever baked into images or passed to session environments.
   - All session environments are explicitly scrubbed and sanitized on spawn.

2. **Ephemeral Workspaces:**
   - Each session receives a fresh disposable directory (`/tmp/nsw-terminal-<sessionId>`).
   - Starter template with git initialized and the repository's `slop` CLI launcher exposed in `$PATH`.
   - Complete recursive deletion on WebSocket disconnect, client error, process exit, or hard TTL expiry.

3. **Strict Limits & Throttling:**
   - **Hard TTL:** Defaults to 15 minutes (900s) maximum session lifetime.
   - **Idle Timeout:** Defaults to 5 minutes (300s) inactivity limit.
   - **Output Throttling:** 1MB/s rate limit to prevent flood crashes / buffer bloat.
   - **Concurrent Session Cap:** Rejects connections beyond configured limit (`maxConcurrentSessions`).

4. **Origin & Single-Use Ticket Validation:**
   - Cloudflare validates the D1 login and mints a 60-second HMAC ticket.
   - The browser sends it as a WebSocket subprotocol, keeping it out of URLs.
   - The gateway verifies it and atomically redeems its `jti` against D1 before creating a sandbox.
   - Production origins are an explicit allowlist; wildcard origins and test-token bypasses are disabled.

---

## 3. Endpoints

### HTTP `GET /health`
Returns service status and active session count.
```json
{
  "status": "ok",
  "uptime": 12.4,
  "activeSessions": 1,
  "timestamp": "2026-08-29T12:00:00.000Z"
}
```

### HTTP `GET /capabilities`
Returns truthful capabilities manifest.
```json
{
  "gatewayVersion": "1.0.0",
  "provider": "Local Process Provider",
  "isolationType": "process",
  "isProductionVps": false,
  "truthStatement": "NON-PRODUCTION DEVELOPMENT PROVIDER: Sessions execute as local child processes on the host...",
  "authRequired": true,
  "authMethods": ["bearer_token", "websocket_protocol"],
  "allowedOrigins": ["*"],
  "availableTools": ["git", "node", "npm", "npx", "slop"],
  "limits": {
    "maxConcurrentSessions": 10,
    "sessionTtlSeconds": 900,
    "idleTimeoutSeconds": 300,
    "maxOutputRateBytesPerSec": 1048576,
    "maxPayloadBytes": 65536,
    "maxOutputBufferBytes": 524288
  },
  "features": {
    "ptyResize": true,
    "ephemeralWorkspaces": true,
    "autoCleanup": true,
    "zeroSecretBaking": true
  }
}
```

### WebSocket `wss://<host>/terminal`
Bi-directional streaming PTY connection.

The browser first calls `POST /api/terminal-session`, then connects with protocols
`nsw-terminal-v1` and `nsw-ticket.<signed-ticket>`.

## Production configuration

The Railway gateway fails closed unless all of these are supplied:

- `DAYTONA_API_KEY`
- `DAYTONA_SNAPSHOT` (prebuilt with Git, Node/npm/npx, and `slop`)
- `DAYTONA_VM_ISOLATION_VERIFIED=true`
- `TERMINAL_TICKET_SECRET`
- `TERMINAL_GATEWAY_SERVICE_SECRET`
- `TERMINAL_REDEEM_URL=https://nates-software.com/api/terminal-session`
- `ALLOWED_ORIGINS=https://nates-software.com,https://nates-software.pages.dev`

No persistent Daytona volume is attached. The snapshot is immutable input; session
changes are deleted on disconnect and by Daytona's wall-clock TTL.

- **Inbound frames (client -> server):**
  - `{ "type": "input", "data": "slop help\r" }` (or raw text)
  - `{ "type": "resize", "cols": 80, "rows": 24 }`
  - `{ "type": "ping" }`

- **Outbound frames (server -> client):**
  - `{ "type": "session_ready", "sessionId": "...", "workspacePath": "...", "provider": "...", ... }`
  - `{ "type": "output", "data": "..." }`
  - `{ "type": "exit", "code": 0, "signal": null }`
  - `{ "type": "error", "message": "..." }`
  - `{ "type": "pong" }`

---

## 4. Running Locally

```bash
# Build
npm run build

# Start server (default: port 4000)
npm start

# Run in development mode with live TypeScript reload
npm run dev

# Run test suite
npm test
```
