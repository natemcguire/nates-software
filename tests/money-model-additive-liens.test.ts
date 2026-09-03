// tests/money-model-additive-liens.test.ts
import { describe, it, expect } from 'vitest';
import { calculateAllocations } from '../src/lib/commerceDomain';

describe('additive frozen-lien allocations', () => {
  it('Ann->Bob->Carol all 10%, $100 → platform 1000, Ann 900, Bob 900, seller 7200', () => {
    const r = calculateAllocations({
      grossCents: 10000, currency: 'usd', sellerUserId: 'carol', sellerRepositoryId: 'repo_c',
      liens: [
        { ancestorUserId: 'ann', ancestorRepositoryId: 'repo_a', bps: 1000, depth: 2 },
        { ancestorUserId: 'bob', ancestorRepositoryId: 'repo_b', bps: 1000, depth: 1 },
      ],
    });
    const by = (role: string) => r.allocations.filter(a => a.role === role);
    expect(by('platform').reduce((s,a)=>s+a.amountCents,0)).toBe(1000);
    expect(by('ancestor').find(a=>a.recipientUserId==='ann')!.amountCents).toBe(900);
    expect(by('ancestor').find(a=>a.recipientUserId==='bob')!.amountCents).toBe(900);
    expect(by('seller')[0].amountCents).toBe(7200);
    expect(r.allocations.reduce((s,a)=>s+a.amountCents,0)).toBe(10000);
  });

  it('root sale (no liens) → platform 1000, seller 9000', () => {
    const r = calculateAllocations({ grossCents: 10000, currency: 'usd', sellerUserId: 'ann', sellerRepositoryId: 'repo_a', liens: [] });
    expect(r.allocations.find(a=>a.role==='platform')!.amountCents).toBe(1000);
    expect(r.allocations.find(a=>a.role==='seller')!.amountCents).toBe(9000);
    expect(r.allocations.some(a=>a.role==='ancestor')).toBe(false);
  });

  it('house tip: $9.95 dust accrues to platform, conservation exact', () => {
    // platform_base = floor(0.10*995)=99, R=896; lien 10% -> floor(0.10*896)=89 (bob), floor(0.10*896)=89 (ann)
    const r = calculateAllocations({
      grossCents: 995, currency: 'usd', sellerUserId: 'carol', sellerRepositoryId: 'repo_c',
      liens: [
        { ancestorUserId: 'ann', ancestorRepositoryId: 'repo_a', bps: 1000, depth: 2 },
        { ancestorUserId: 'bob', ancestorRepositoryId: 'repo_b', bps: 1000, depth: 1 },
      ],
    });
    const platform = r.allocations.filter(a=>a.role==='platform').reduce((s,a)=>s+a.amountCents,0);
    const sum = r.allocations.reduce((s,a)=>s+a.amountCents,0);
    expect(sum).toBe(995);            // conservation exact
    expect(platform).toBeGreaterThanOrEqual(99); // base + any dust
  });

  it('skips a 0% lien instead of writing a 0-amount row', () => {
    const r = calculateAllocations({
      grossCents: 10000, currency: 'usd', sellerUserId: 'carol', sellerRepositoryId: 'repo_c',
      liens: [{ ancestorUserId: 'bob', ancestorRepositoryId: 'repo_b', bps: 0, depth: 1 }],
    });
    expect(r.allocations.some(a=>a.role==='ancestor')).toBe(false);
    expect(r.allocations.every(a=>a.amountCents>0)).toBe(true);
  });

  it('throws if liens sum > 100%', () => {
    expect(() => calculateAllocations({
      grossCents: 10000, currency: 'usd', sellerUserId: 'x', sellerRepositoryId: 'r',
      liens: [{ ancestorUserId:'a', ancestorRepositoryId:'ra', bps: 9000, depth:2 }, { ancestorUserId:'b', ancestorRepositoryId:'rb', bps: 2000, depth:1 }],
    })).toThrow();
  });
});
