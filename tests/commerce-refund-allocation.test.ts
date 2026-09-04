import { describe, expect, it, vi } from 'vitest';
import { calculateDisputeRecoveryDelta, calculateRefundAllocationDelta } from '../src/lib/commerce/recoveryDomain';

vi.setConfig({ testTimeout: 30000 });

const allocations = [
  { id: 'maker', sequence: 0, role: 'maker' as const, amountCents: 700 },
  { id: 'ancestor', sequence: 1, role: 'ancestor' as const, amountCents: 200 },
  { id: 'pool', sequence: 2, role: 'protocol_pool' as const, amountCents: 100 }
];

describe('cumulative refund allocation', () => {
  it('conserves every partial refund exactly', () => {
    const first = calculateRefundAllocationDelta(allocations, 1000, 333);
    expect(first.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(333);
    for (const row of first) {
      expect(row.cumulativeAmountCents).toBeLessThanOrEqual(row.amountCents);
      expect(row.deltaAmountCents).toBeGreaterThanOrEqual(0);
    }

    const prior = new Map(first.map((row) => [row.id, row.cumulativeAmountCents]));
    const second = calculateRefundAllocationDelta(allocations, 1000, 667, prior);
    expect(second.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(334);
    for (const row of second) {
      expect(row.cumulativeAmountCents).toBeGreaterThanOrEqual(prior.get(row.id) ?? 0);
      expect(row.cumulativeAmountCents).toBeLessThanOrEqual(row.amountCents);
    }
    expect(second.reduce((sum, row) => sum + row.cumulativeAmountCents, 0)).toBe(667);
  });

  it('ends exactly at each immutable allocation on a full refund', () => {
    const rows = calculateRefundAllocationDelta(allocations, 1000, 1000);
    expect(rows.map((row) => row.cumulativeAmountCents)).toEqual([700, 200, 100]);
  });

  it('assigns weighted cents deterministically with stable sequence ties', () => {
    const rows = calculateRefundAllocationDelta([
      { id: 'a', sequence: 0, role: 'maker', amountCents: 1 },
      { id: 'b', sequence: 1, role: 'ancestor', amountCents: 1 },
      { id: 'c', sequence: 2, role: 'protocol_pool', amountCents: 1 }
    ], 3, 2);
    expect(rows.map((row) => row.deltaAmountCents)).toEqual([1, 0, 1]);
  });

  it('is house-monotone across the canonical Alabama-paradox population', () => {
    const paradox = [1500, 1500, 900, 500, 500, 200].map((amountCents, sequence) => ({
      id: `p${sequence}`,
      sequence,
      role: (sequence === 5 ? 'protocol_pool' : sequence === 0 ? 'maker' : 'ancestor') as 'maker' | 'ancestor' | 'protocol_pool',
      amountCents
    }));
    const at25 = calculateRefundAllocationDelta(paradox, 5100, 25);
    const prior = new Map(at25.map((row) => [row.id, row.cumulativeAmountCents]));
    const at26 = calculateRefundAllocationDelta(paradox, 5100, 26, prior);
    expect(at26.every((row) => row.deltaAmountCents >= 0)).toBe(true);
    expect(at26.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(1);
  });

  it('rejects inconsistent or regressive ledger state', () => {
    expect(() => calculateRefundAllocationDelta(allocations, 999, 100)).toThrow(/conserve/);
    expect(() => calculateRefundAllocationDelta(allocations, 1000, 1001)).toThrow(/bounded/);
    expect(() => calculateRefundAllocationDelta(allocations, 1000, 100, new Map([['maker', 500]]))).toThrow(/regressed/);
  });
});

describe('house-first refund flooring (Task C3)', () => {
  const shareware = [
    { id: 'platform', sequence: 0, role: 'platform' as const, amountCents: 1000 },
    { id: 'ann', sequence: 1, role: 'ancestor' as const, amountCents: 900 },
    { id: 'bob', sequence: 2, role: 'ancestor' as const, amountCents: 900 },
    { id: 'carol', sequence: 3, role: 'seller' as const, amountCents: 7200 }
  ];

  function payable(rows: ReturnType<typeof calculateRefundAllocationDelta>) {
    return rows.filter((row) => row.role === 'seller' || row.role === 'ancestor');
  }
  function house(rows: ReturnType<typeof calculateRefundAllocationDelta>) {
    return rows.filter((row) => row.role === 'platform');
  }

  it('floors every payable clawback and never exceeds what that recipient received', () => {
    const rows = calculateRefundAllocationDelta(shareware, 10000, 9200);
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const row of payable(rows)) {
      const floorShare = Math.floor((row.amountCents * 9200) / 10000);
      expect(row.deltaAmountCents).toBeLessThanOrEqual(floorShare);
      expect(row.deltaAmountCents).toBeLessThanOrEqual(row.amountCents);
    }
    expect(byId.get('carol')!.deltaAmountCents).toBe(6624);
    expect(byId.get('ann')!.deltaAmountCents).toBe(828);
    expect(byId.get('bob')!.deltaAmountCents).toBe(828);

    const total = rows.reduce((sum, row) => sum + row.deltaAmountCents, 0);
    expect(total).toBe(9200);
    const platformDelta = house(rows)[0].deltaAmountCents;
    expect(platformDelta).toBe(9200 - 6624 - 828 - 828);
    expect(platformDelta).toBeLessThanOrEqual(1000);
  });

  it('a single refunded cent conserves and is bounded (monotone apportionment)', () => {
    const rows = calculateRefundAllocationDelta(shareware, 10000, 1);
    expect(rows.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(1);
    for (const row of rows) {
      expect(row.deltaAmountCents).toBeGreaterThanOrEqual(0);
      expect(row.cumulativeAmountCents).toBeLessThanOrEqual(row.amountCents);
    }
    expect(rows.filter((row) => row.deltaAmountCents === 1)).toHaveLength(1);
  });

  it('when the house is fully exhausted, remaining dust spills to payables but is still floored and bounded', () => {
    const rows = calculateRefundAllocationDelta(shareware, 10000, 9999);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get('platform')!.deltaAmountCents).toBe(1000);
    for (const row of payable(rows)) {
      expect(row.deltaAmountCents).toBeLessThanOrEqual(row.amountCents);
    }
    expect(rows.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(9999);
  });

  it('conserves total clawback == refunded gross across successive partial refunds', () => {
    const first = calculateRefundAllocationDelta(shareware, 10000, 3333);
    const prior = new Map(first.map((row) => [row.id, row.cumulativeAmountCents]));
    expect(first.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(3333);
    for (const row of first) {
      expect(row.cumulativeAmountCents).toBeLessThanOrEqual(row.amountCents);
    }

    const second = calculateRefundAllocationDelta(shareware, 10000, 10000, prior);
    expect(second.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(10000 - 3333);
    const full = calculateRefundAllocationDelta(shareware, 10000, 10000);
    expect(full.find((row) => row.id === 'carol')!.cumulativeAmountCents).toBe(7200);
    expect(full.find((row) => row.id === 'ann')!.cumulativeAmountCents).toBe(900);
    expect(full.find((row) => row.id === 'bob')!.cumulativeAmountCents).toBe(900);
    expect(full.find((row) => row.id === 'platform')!.cumulativeAmountCents).toBe(1000);
  });

  function assertChainMonotoneAndHouseFirst(
    fixture: ReadonlyArray<{ id: string; sequence: number; role: any; amountCents: number }>,
    gross: number
  ) {
    const houseCeiling = fixture
      .filter((a) => a.role === 'platform' || a.role === 'protocol_pool')
      .reduce((sum, a) => sum + a.amountCents, 0);
    let prior = new Map<string, number>();
    for (let c = 1; c <= gross; c += 1) {
      const rows = calculateRefundAllocationDelta(fixture as any, gross, c, prior);

      for (const row of rows) {
        expect(row.cumulativeAmountCents).toBeLessThanOrEqual(row.amountCents);
        expect(row.cumulativeAmountCents).toBeGreaterThanOrEqual(prior.get(row.id) ?? 0);
      }
      expect(rows.reduce((sum, row) => sum + row.cumulativeAmountCents, 0)).toBe(c);

      const houseFloor = fixture
        .filter((a) => a.role === 'platform' || a.role === 'protocol_pool')
        .reduce((sum, a) => sum + Math.floor((a.amountCents * c) / gross), 0);
      const houseCumulative = rows
        .filter((row) => row.role === 'platform' || row.role === 'protocol_pool')
        .reduce((sum, row) => sum + row.cumulativeAmountCents, 0);
      expect(houseCumulative).toBeGreaterThanOrEqual(Math.min(houseFloor, houseCeiling));

      prior = new Map(rows.map((row) => [row.id, row.cumulativeAmountCents]));
    }
  }

  it('chained 1-cent partial refunds across EVERY integer never regress (shareware fixture)', () => {
    assertChainMonotoneAndHouseFirst(shareware, 10000);
  });

  it('chained 1-cent partial refunds across EVERY integer never regress (odd gross forces frequent rounding)', () => {
    const oddGross = [
      { id: 'platform', sequence: 0, role: 'platform' as const, amountCents: 99 },
      { id: 'ann', sequence: 1, role: 'ancestor' as const, amountCents: 89 },
      { id: 'bob', sequence: 2, role: 'ancestor' as const, amountCents: 89 },
      { id: 'carol', sequence: 3, role: 'seller' as const, amountCents: 718 }
    ];
    assertChainMonotoneAndHouseFirst(oddGross, 995);
  });

  it('chained 1-cent partial refunds across EVERY integer never regress (legacy maker/pool roles)', () => {
    const legacy = [
      { id: 'maker', sequence: 0, role: 'maker' as const, amountCents: 700 },
      { id: 'ancestor', sequence: 1, role: 'ancestor' as const, amountCents: 200 },
      { id: 'pool', sequence: 2, role: 'protocol_pool' as const, amountCents: 100 }
    ];
    assertChainMonotoneAndHouseFirst(legacy, 1000);
  });
});

describe('dispute recovery allocation (calculateDisputeRecoveryDelta)', () => {
  const disputeAllocations = [
    { id: 'maker', sequence: 0, role: 'maker' as const, amountCents: 1200 },
    { id: 'ancestor', sequence: 1, role: 'ancestor' as const, amountCents: 400 },
    { id: 'contributor', sequence: 2, role: 'contributor' as const, amountCents: 200 },
    { id: 'pool', sequence: 3, role: 'protocol_pool' as const, amountCents: 200 }
  ];

  it('conserves a PARTIAL dispute exactly: sum(deltas) === dispute.amount, never the full frozen allocations', () => {
    const deltas = calculateDisputeRecoveryDelta(disputeAllocations, 2000, 500, 0);
    const sum = deltas.reduce((total, row) => total + row.deltaAmountCents, 0);
    expect(sum).toBe(500);

    const byId = new Map(deltas.map((row) => [row.id, row.deltaAmountCents]));
    expect(byId.get('maker')).toBe(300);
    expect(byId.get('ancestor')).toBe(100);
    expect(byId.get('contributor')).toBe(50);
    expect(byId.get('pool')).toBe(50);

    const payableSum = deltas.filter((row) => row.role !== 'protocol_pool')
      .reduce((total, row) => total + row.deltaAmountCents, 0);
    expect(payableSum).toBeLessThan(1800);
    expect(payableSum).toBe(450);

    for (const row of deltas) {
      expect(row.deltaAmountCents).toBeLessThanOrEqual(row.amountCents);
    }
  });

  it('a FULL dispute claws back exactly each allocation\'s full frozen amount', () => {
    const deltas = calculateDisputeRecoveryDelta(disputeAllocations, 2000, 2000, 0);
    const byId = new Map(deltas.map((row) => [row.id, row.deltaAmountCents]));
    expect(byId.get('maker')).toBe(1200);
    expect(byId.get('ancestor')).toBe(400);
    expect(byId.get('contributor')).toBe(200);
    expect(byId.get('pool')).toBe(200);
    expect(deltas.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(2000);
  });

  it('seats a second dispute on top of a prior dispute/refund without exceeding conservation', () => {
    const first = calculateDisputeRecoveryDelta(disputeAllocations, 2000, 500, 0);
    const priorByAllocation = new Map(first.map((row) => [row.id, row.deltaAmountCents]));
    const priorClawbackCents = first.reduce((sum, row) => sum + row.deltaAmountCents, 0);

    const second = calculateDisputeRecoveryDelta(disputeAllocations, 2000, 300, priorClawbackCents, priorByAllocation);
    const secondSum = second.reduce((sum, row) => sum + row.deltaAmountCents, 0);
    expect(secondSum).toBe(300);

    for (const row of second) {
      const combined = (priorByAllocation.get(row.id) ?? 0) + row.deltaAmountCents;
      expect(combined).toBeLessThanOrEqual(row.amountCents);
    }
  });

  it('fails closed rather than conserving a dispute that cannot be satisfied', () => {
    expect(() => calculateDisputeRecoveryDelta(disputeAllocations, 2000, 2500, 0)).toThrow();
    expect(() => calculateDisputeRecoveryDelta(disputeAllocations, 2000, 500, 1600)).toThrow();
  });
});
