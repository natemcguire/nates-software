import { describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPost, provesProductionProvider } from '../functions/api/rig';

const capabilities = {
  apiVersion: 1,
  provider: 'docker',
  liveContainers: true,
  ephemeralCleanup: true,
  authRequired: true,
  limits: { maxMemoryMb: 256, maxTtlSeconds: 3600 },
  isolation: { nonRoot: true, readOnlyRootfs: true, noDockerSocketMount: true }
};

describe('RIG edge gateway boundary', () => {
  it('requires the complete live-provider proof contract', () => {
    expect(provesProductionProvider(capabilities)).toBe(true);
    expect(provesProductionProvider({ ...capabilities, liveContainers: false })).toBe(false);
    expect(provesProductionProvider({ ...capabilities, limits: { maxMemoryMb: 512, maxTtlSeconds: 3600 } })).toBe(false);
    expect(provesProductionProvider({ ...capabilities, isolation: { ...capabilities.isolation, nonRoot: false } })).toBe(false);
  });

  it('fails closed when no production gateway is configured', async () => {
    const response = await onRequestGet({ request: new Request('https://example.test/api/rig?action=readiness'), env: {} });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, ready: false, configured: false });
  });

  it('reports ready only after the gateway proves its capabilities', async () => {
    const gatewayFetch = vi.fn(async () => Response.json(capabilities));
    const response = await onRequestGet({
      request: new Request('https://example.test/api/rig?action=readiness'),
      env: { RIG_GATEWAY_URL: 'https://rig.example.test', RIG_GATEWAY_SERVICE_SECRET: 's'.repeat(32), __RIG_GATEWAY_FETCH: gatewayFetch }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, ready: true, provider: 'docker' });
    expect(gatewayFetch).toHaveBeenCalledWith('https://rig.example.test/capabilities', expect.any(Object));
  });

  it('rejects user control requests without authentication before contacting the gateway', async () => {
    const gatewayFetch = vi.fn();
    const response = await onRequestPost({
      request: new Request('https://example.test/api/rig', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' })
      }),
      env: { RIG_GATEWAY_URL: 'https://rig.example.test', RIG_GATEWAY_SERVICE_SECRET: 's'.repeat(32), __RIG_GATEWAY_FETCH: gatewayFetch }
    });
    expect(response.status).toBe(401);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
