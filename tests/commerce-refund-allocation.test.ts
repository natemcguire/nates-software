import { describe, expect, it } from 'vitest';
import { calculateDisputeRecoveryDelta, calculateRefundAllocationDelta } from '../src/lib/commerce/recoveryDomain';

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

// Regression for Codex Critical #1: a PARTIAL Stripe dispute must claw back EXACTLY its
// own amount, pro-rata, never the allocations' full frozen amounts.
describe('dispute recovery allocation (calculateDisputeRecoveryDelta)', () => {
  const disputeAllocations = [
    { id: 'maker', sequence: 0, role: 'maker' as const, amountCents: 1200 },
    { id: 'ancestor', sequence: 1, role: 'ancestor' as const, amountCents: 400 },
    { id: 'contributor', sequence: 2, role: 'contributor' as const, amountCents: 200 },
    { id: 'pool', sequence: 3, role: 'protocol_pool' as const, amountCents: 200 }
  ];

  it('conserves a PARTIAL dispute exactly: sum(deltas) === dispute.amount, never the full frozen allocations', () => {
    // 500c dispute on a 2000c order (maker 1200 / ancestor 400 / contributor 200 / pool 200).
    const deltas = calculateDisputeRecoveryDelta(disputeAllocations, 2000, 500, 0);
    const sum = deltas.reduce((total, row) => total + row.deltaAmountCents, 0);
    expect(sum).toBe(500);

    // Exact deterministic pro-rata split (weights 1200:400:200:200 of a 500-seat target).
    const byId = new Map(deltas.map((row) => [row.id, row.deltaAmountCents]));
    expect(byId.get('maker')).toBe(300);
    expect(byId.get('ancestor')).toBe(100);
    expect(byId.get('contributor')).toBe(50);
    expect(byId.get('pool')).toBe(50);

    // The over-claw bug would claw back the FULL frozen amounts (1200+400+200=1800 for
    // the payable roles alone). The fix must never do that for a partial dispute.
    const payableSum = deltas.filter((row) => row.role !== 'protocol_pool')
      .reduce((total, row) => total + row.deltaAmountCents, 0);
    expect(payableSum).toBeLessThan(1800);
    expect(payableSum).toBe(450);

    // No single allocation may ever be clawed back beyond its own frozen amount.
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
    // First dispute: 500c (prior clawback 0 so far).
    const first = calculateDisputeRecoveryDelta(disputeAllocations, 2000, 500, 0);
    const priorByAllocation = new Map(first.map((row) => [row.id, row.deltaAmountCents]));
    const priorClawbackCents = first.reduce((sum, row) => sum + row.deltaAmountCents, 0);

    // A second, later dispute for another 300c on the SAME order.
    const second = calculateDisputeRecoveryDelta(disputeAllocations, 2000, 300, priorClawbackCents, priorByAllocation);
    const secondSum = second.reduce((sum, row) => sum + row.deltaAmountCents, 0);
    expect(secondSum).toBe(300);

    // Combined clawback across BOTH disputes must never exceed each allocation's frozen
    // amount — the core money-conservation invariant.
    for (const row of second) {
      const combined = (priorByAllocation.get(row.id) ?? 0) + row.deltaAmountCents;
      expect(combined).toBeLessThanOrEqual(row.amountCents);
    }
  });

  it('fails closed rather than conserving a dispute that cannot be satisfied', () => {
    // A dispute larger than the order's gross_cents is structurally impossible.
    expect(() => calculateDisputeRecoveryDelta(disputeAllocations, 2000, 2500, 0)).toThrow();
    // A dispute seated on top of prior clawback that would exceed gross_cents.
    expect(() => calculateDisputeRecoveryDelta(disputeAllocations, 2000, 500, 1600)).toThrow();
  });
});
