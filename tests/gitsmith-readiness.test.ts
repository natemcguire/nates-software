import { describe, expect, it, vi } from 'vitest';
import { onRequestGet } from '../functions/api/git';

describe('GITSMITH public gateway readiness projection', () => {
  it('returns only bounded readiness booleans from a healthy gateway', async () => {
    const gatewayFetch = vi.fn(async () => Response.json({
      ready: true,
      configured: true,
      active: true,
      timestamp: '2026-08-29T20:41:05.510Z',
      checks: {
        git: { available: true, version: '2.39.5' },
        storage: { writable: true, root: '/secret/path' },
        controlPlane: { reachable: true, url: 'https://internal.example' },
        dispatcher: { running: true, processedCount: 12 },
        transport: { protocol: 'ssh', configured: false, active: false, host: 'secret.internal', port: 2222 }
      }
    }));

    const response = await onRequestGet({
      request: new Request('https://example.test/api/git?action=gateway-readiness'),
      env: {
        GITSMITH_GATEWAY_URL: 'https://gateway.example.test',
        GITSMITH_GATEWAY_FETCH: gatewayFetch
      }
    });
    const payload: any = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(payload).toEqual({
      success: true,
      ready: true,
      configured: true,
      active: true,
      checks: { git: true, storage: true, controlPlane: true, dispatcher: true, transport: false },
      transport: { protocol: 'ssh', configured: false, active: false },
      checkedAt: '2026-08-29T20:41:05.510Z'
    });
    expect(JSON.stringify(payload)).not.toContain('/secret/path');
    expect(JSON.stringify(payload)).not.toContain('internal.example');
  });

  it('fails closed when the gateway URL is absent or unreachable', async () => {
    const missing = await onRequestGet({
      request: new Request('https://example.test/api/git?action=gateway-readiness'),
      env: {}
    });
    expect(missing.status).toBe(503);
    expect((await missing.json() as any).ready).toBe(false);

    const unreachable = await onRequestGet({
      request: new Request('https://example.test/api/git?action=gateway-readiness'),
      env: {
        GITSMITH_GATEWAY_URL: 'https://gateway.example.test',
        GITSMITH_GATEWAY_FETCH: vi.fn(async () => { throw new Error('offline'); })
      }
    });
    expect(unreachable.status).toBe(503);
    expect((await unreachable.json() as any).ready).toBe(false);
  });
});
