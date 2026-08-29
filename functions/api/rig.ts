import { requireAuth } from './_auth';

const ALLOWED_ACTIONS = new Set(['create', 'list', 'inspect', 'stop', 'restart', 'delete', 'logs']);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function gatewayConfig(env: any): { url: URL; secret: string } | null {
  try {
    const url = new URL(String(env?.RIG_GATEWAY_URL || ''));
    const secret = String(env?.RIG_GATEWAY_SERVICE_SECRET || '');
    if (url.protocol !== 'https:' || secret.length < 32) return null;
    return { url, secret };
  } catch {
    return null;
  }
}

async function fetchGateway(env: any, path: string, init?: RequestInit): Promise<Response> {
  const config = gatewayConfig(env);
  if (!config) throw new Error('RIG gateway is not configured');
  const request = env.__RIG_GATEWAY_FETCH || fetch;
  return request(new URL(path, config.url).toString(), {
    ...init,
    signal: AbortSignal.timeout(init?.method === 'POST' ? 90_000 : 5_000)
  });
}

function provesProductionProvider(capabilities: any): boolean {
  return capabilities?.apiVersion === 1
    && capabilities?.provider === 'docker'
    && capabilities?.liveContainers === true
    && capabilities?.ephemeralCleanup === true
    && capabilities?.authRequired === true
    && capabilities?.limits?.maxMemoryMb === 256
    && capabilities?.limits?.maxTtlSeconds <= 3600
    && capabilities?.isolation?.nonRoot === true
    && capabilities?.isolation?.readOnlyRootfs === true
    && capabilities?.isolation?.noDockerSocketMount === true;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const action = new URL(request.url).searchParams.get('action') || 'readiness';
  if (action !== 'readiness') return json({ success: false, error: 'Unsupported RIG GET action' }, 400);
  if (!gatewayConfig(env)) {
    return json({ success: false, ready: false, configured: false, error: 'RIG provider gateway is not configured.' }, 503);
  }
  try {
    const response = await fetchGateway(env, '/capabilities', { headers: { Accept: 'application/json' } });
    const capabilities = await response.json().catch(() => null);
    const ready = response.ok && provesProductionProvider(capabilities);
    return json({
      success: ready,
      ready,
      configured: true,
      provider: ready ? capabilities.provider : null,
      capabilities: ready ? capabilities : undefined,
      error: ready ? undefined : 'RIG gateway did not prove the required live-container isolation and cleanup contract.'
    }, ready ? 200 : 503);
  } catch (error: any) {
    return json({ success: false, ready: false, configured: true, error: `RIG gateway readiness failed: ${error?.message || 'unreachable'}` }, 503);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  const config = gatewayConfig(env);
  if (!config) return json({ success: false, error: 'RIG provider gateway is not configured.' }, 503);

  const body: any = await request.json().catch(() => ({}));
  const action = String(body?.action || '');
  if (!ALLOWED_ACTIONS.has(action)) return json({ success: false, error: 'Unsupported RIG control action' }, 400);

  try {
    const response = await fetchGateway(env, `/v1/instances/${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.secret}`,
        'X-Rig-Owner-Id': auth.user!.id,
        'X-Rig-Owner-Username': auth.user!.username,
        'X-Rig-Owner-Role': auth.user!.role === 'super_admin' ? 'admin' : 'owner'
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({ success: false, error: 'RIG gateway returned an invalid response.' }));
    return json(payload, response.status);
  } catch (error: any) {
    return json({ success: false, error: `RIG gateway request failed: ${error?.message || 'unreachable'}` }, 503);
  }
};

export { provesProductionProvider };
