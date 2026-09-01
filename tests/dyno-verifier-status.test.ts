import { describe, it, expect } from 'vitest';
import { onRequestGet } from '../functions/api/dyno-verifier-status';

describe('DYNO verifier status endpoint (/api/dyno-verifier-status)', () => {
  it('reports acceptingJobs: false and an honest offline message when the flag is unset (current production reality)', async () => {
    const res = await onRequestGet({ env: {} } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.acceptingJobs).toBe(false);
    expect(body.message.toLowerCase()).toContain('no independent reproduction worker');
    expect(body.message.toLowerCase()).toContain('unverified');
  });

  it('reports acceptingJobs: false when the flag is any value other than the exact string "true"', async () => {
    const res = await onRequestGet({ env: { DYNO_VERIFIER_ENABLED: 'TRUE' } } as any);
    const body = await res.json();
    expect(body.acceptingJobs).toBe(false);

    const res2 = await onRequestGet({ env: { DYNO_VERIFIER_ENABLED: true } } as any);
    const body2 = await res2.json();
    expect(body2.acceptingJobs).toBe(false);
  });

  it('reports acceptingJobs: true only when DYNO_VERIFIER_ENABLED is exactly "true"', async () => {
    const res = await onRequestGet({ env: { DYNO_VERIFIER_ENABLED: 'true' } } as any);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.acceptingJobs).toBe(true);
    expect(body.message.toLowerCase()).toContain('commissioned');
  });

  it('never returns a "verified" or "reproduced" claim in its message', async () => {
    const res = await onRequestGet({ env: {} } as any);
    const body = await res.json();
    expect(body.message).not.toMatch(/is verified/i);
    expect(body.message).not.toMatch(/is reproduced/i);
  });

  it('sends a no-store cache header so status is never stale-cached into a false "online" claim', async () => {
    const res = await onRequestGet({ env: {} } as any);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
