import { requireAuth } from './_auth';

async function secureEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(b))
  ]);
  const aa = new Uint8Array(left);
  const bb = new Uint8Array(right);
  let mismatch = 0;
  for (let i = 0; i < aa.length; i++) mismatch |= aa[i] ^ bb[i];
  return mismatch === 0;
}

function base64Url(bytes: Uint8Array): string {
  let raw = '';
  bytes.forEach(byte => { raw += String.fromCharCode(byte); });
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signTicket(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded)));
  return `${encoded}.${base64Url(signature)}`;
}

const REQUIRED_TERMINAL_TOOLS = [
  'bash', 'git', 'git-lfs', 'ssh', 'curl', 'wget', 'jq', 'rg',
  'node', 'npm', 'npx', 'python3', 'pip3', 'gcc', 'g++', 'make',
  'pkg-config', 'sqlite3', 'tar', 'gzip', 'zip', 'unzip', 'rsync',
  'file', 'tree', 'nano', 'vim', 'claude', 'slop'
] as const;

function provesProductionTerminal(capabilities: any): boolean {
  const tools = new Set(Array.isArray(capabilities?.availableTools) ? capabilities.availableTools : []);
  return capabilities?.isProductionVps === true
    && capabilities?.isolationType === 'vps'
    && capabilities?.authRequired === true
    && capabilities?.authMethods?.includes('websocket_protocol')
    && capabilities?.features?.ptyResize === true
    && capabilities?.features?.ephemeralWorkspaces === true
    && capabilities?.features?.autoCleanup === true
    && capabilities?.features?.zeroSecretBaking === true
    && Number.isInteger(capabilities?.limits?.maxConcurrentSessions)
    && capabilities.limits.maxConcurrentSessions > 0
    && capabilities.limits.maxConcurrentSessions <= 10
    && Number.isInteger(capabilities?.limits?.sessionTtlSeconds)
    && capabilities.limits.sessionTtlSeconds > 0
    && capabilities.limits.sessionTtlSeconds <= 900
    && REQUIRED_TERMINAL_TOOLS.every(tool => tools.has(tool));
}

async function productionGatewayReadiness(env: any): Promise<{ ready: boolean; capabilities?: any; error?: string }> {
  let gatewayUrl: URL;
  try {
    gatewayUrl = new URL(env.TERMINAL_GATEWAY_URL);
  } catch {
    return { ready: false, error: 'Terminal gateway URL is missing or invalid.' };
  }
  if (gatewayUrl.protocol !== 'https:') return { ready: false, error: 'Terminal gateway must use HTTPS.' };
  const request = env.__TERMINAL_GATEWAY_FETCH || fetch;
  try {
    const capabilitiesUrl = new URL('/capabilities', gatewayUrl);
    const response = await request(capabilitiesUrl.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4_000)
    });
    if (!response.ok) return { ready: false, error: `Terminal gateway capability probe returned HTTP ${response.status}.` };
    const capabilities = await response.json();
    if (!provesProductionTerminal(capabilities)) {
      return { ready: false, error: 'Terminal gateway did not prove the required VPS, cleanup, auth, limits, and toolchain contract.' };
    }
    return { ready: true, capabilities };
  } catch (error: any) {
    return { ready: false, error: `Terminal gateway readiness failed: ${error?.message || 'unreachable'}` };
  }
}

export const onRequestGet = async ({ env }: { request: Request; env: any }) => {
  const configured = Boolean(
    env?.TERMINAL_GATEWAY_URL
    && typeof env?.TERMINAL_TICKET_SECRET === 'string'
    && env.TERMINAL_TICKET_SECRET.length >= 32
    && typeof env?.TERMINAL_GATEWAY_SERVICE_SECRET === 'string'
    && env.TERMINAL_GATEWAY_SERVICE_SECRET.length >= 32
  );
  if (!configured) {
    return Response.json({
      success: false,
      ready: false,
      configured: false,
      error: 'Ephemeral terminal service is not configured.'
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const readiness = await productionGatewayReadiness(env);
  return Response.json({
    success: readiness.ready,
    ready: readiness.ready,
    configured: true,
    capabilities: readiness.ready ? readiness.capabilities : undefined,
    error: readiness.error
  }, { status: readiness.ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const action = new URL(request.url).searchParams.get('action') || 'mint';
  if (!['mint', 'redeem', 'close'].includes(action)) {
    return Response.json({ success: false, error: 'Unsupported terminal session action' }, { status: 400 });
  }
  if (!env?.DB) {
    return Response.json({ success: false, error: 'Terminal session ledger is unavailable' }, { status: 503 });
  }
  if (action === 'redeem' || action === 'close') {
    const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (!env.TERMINAL_GATEWAY_SERVICE_SECRET || !bearer || !(await secureEqual(bearer, env.TERMINAL_GATEWAY_SERVICE_SECRET))) {
      return Response.json({ success: false, error: 'Unauthorized gateway' }, { status: 401 });
    }
    const body: any = await request.json().catch(() => ({}));
    const now = Date.now();
    if (action === 'redeem') {
      if (!body.jti || !body.userId || !body.gatewaySessionId) {
        return Response.json({ success: false, error: 'Missing redemption fields' }, { status: 400 });
      }
      // D1 serializes this single conditional write. The NOT EXISTS clause
      // makes the one-active-session policy authoritative at redemption time,
      // even when two independently minted tickets race across gateway nodes.
      const updated = await env.DB.prepare(`
        UPDATE terminal_session_tickets SET redeemed_at = ?, session_expires_at = ?, gateway_session_id = ?
        WHERE jti = ? AND user_id = ? AND redeemed_at IS NULL AND expires_at > ?
          AND NOT EXISTS (
            SELECT 1 FROM terminal_session_tickets active
            WHERE active.user_id = ?
              AND active.redeemed_at IS NOT NULL
              AND active.closed_at IS NULL
              AND active.session_expires_at > ?
              AND active.jti <> ?
          )
      `).bind(
        now, now + 15 * 60_000, body.gatewaySessionId,
        body.jti, body.userId, now,
        body.userId, now, body.jti
      ).run();
      if (updated.meta?.changes !== 1) {
        return Response.json({ success: false, error: 'Ticket expired, invalid, or already redeemed' }, { status: 409 });
      }
      return Response.json({ success: true });
    }
    if (!body.gatewaySessionId) return Response.json({ success: false, error: 'Missing gatewaySessionId' }, { status: 400 });
    await env.DB.prepare('UPDATE terminal_session_tickets SET closed_at = ? WHERE gateway_session_id = ? AND closed_at IS NULL')
      .bind(now, body.gatewaySessionId).run();
    return Response.json({ success: true });
  }

  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  if (!env.TERMINAL_TICKET_SECRET || !env.TERMINAL_GATEWAY_URL) {
    return Response.json({ success: false, error: 'Ephemeral terminal service is not configured' }, { status: 503 });
  }
  if (!(await productionGatewayReadiness(env)).ready) {
    return Response.json({
      success: false,
      error: 'Ephemeral VPS gateway is unavailable or has not verified its isolation and cleanup guarantees'
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const now = Math.floor(Date.now() / 1000);
  const nowMs = now * 1000;
  const dayStart = nowMs - 24 * 60 * 60_000;
  const [daily, active] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM terminal_session_tickets WHERE user_id = ? AND issued_at >= ?')
      .bind(auth.user!.id, dayStart).first(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM terminal_session_tickets
      WHERE user_id = ? AND redeemed_at IS NOT NULL AND closed_at IS NULL AND session_expires_at > ?`)
      .bind(auth.user!.id, nowMs).first()
  ]);
  if (Number(daily?.count || 0) >= 10) return Response.json({ success: false, error: 'Daily ephemeral terminal limit reached' }, { status: 429 });
  if (Number(active?.count || 0) >= 1) return Response.json({ success: false, error: 'You already have an active terminal session' }, { status: 409 });
  const jti = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO terminal_session_tickets (jti, user_id, issued_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(jti, auth.user!.id, nowMs, (now + 60) * 1000).run();
  const ticket = await signTicket({
    sub: auth.user!.id,
    username: auth.user!.username,
    role: auth.user!.role,
    aud: 'terminal-gateway',
    iat: now,
    exp: now + 60,
    jti
  }, env.TERMINAL_TICKET_SECRET);

  return Response.json({
    success: true,
    gatewayUrl: env.TERMINAL_GATEWAY_URL,
    ticket,
    expiresAt: (now + 60) * 1000
  }, { headers: { 'Cache-Control': 'no-store' } });
};

export { provesProductionTerminal };
