import { describe, expect, it, vi } from 'vitest';
import { listRigInstances, requestRigControl } from '../src/lib/rigClient';

describe('RIG browser control client', () => {
  it('uses the authenticated same-origin edge boundary', async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, result: [] })) as any;
    await expect(listRigInstances(fetcher)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith('/api/rig', expect.objectContaining({
      method: 'POST', credentials: 'same-origin'
    }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ action: 'list' });
  });

  it('surfaces the gateway error and never invents a result', async () => {
    const fetcher = vi.fn(async () => Response.json({ success: false, error: 'Docker daemon unavailable' }, { status: 503 })) as any;
    await expect(requestRigControl({ action: 'list' }, fetcher)).rejects.toThrow('Docker daemon unavailable');
  });

  it('rejects malformed success responses', async () => {
    const fetcher = vi.fn(async () => new Response('not json', { status: 200 })) as any;
    await expect(requestRigControl({ action: 'list' }, fetcher)).rejects.toThrow('RIG control request failed');
  });
});
