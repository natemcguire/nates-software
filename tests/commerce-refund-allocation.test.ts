import { describe, expect, it } from 'vitest';
import { calculateRefundAllocationDelta } from '../src/lib/commerce/recoveryDomain';

const allocations = [
  { id: 'maker', sequence: 0, role: 'maker' as const, amountCents: 700 },
  { id: 'ancestor', sequence: 1, role: 'ancestor' as const, amountCents: 200 },
  { id: 'pool', sequence: 2, role: 'protocol_pool' as const, amountCents: 100 }
];

describe('cumulative refund allocation', () => {
  it('conserves every partial refund exactly', () => {
    const first = calculateRefundAllocationDelta(allocations, 1000, 333);
    expect(first.map((row) => row.deltaAmountCents)).toEqual([234, 66, 33]);
    expect(first.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(333);

    const prior = new Map(first.map((row) => [row.id, row.cumulativeAmountCents]));
    const second = calculateRefundAllocationDelta(allocations, 1000, 667, prior);
    expect(second.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(334);
    expect(second.map((row) => row.cumulativeAmountCents)).toEqual([468, 133, 66]);
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
    expect(rows.map((row) => row.deltaAmountCents)).toEqual([1, 1, 0]);
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
