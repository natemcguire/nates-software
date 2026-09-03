import { describe, expect, it } from 'vitest';
import { calculateDisputeRecoveryDelta, calculateRefundAllocationDelta } from '../src/lib/commerce/recoveryDomain';

const allocations = [
  { id: 'maker', sequence: 0, role: 'maker' as const, amountCents: 700 },
  { id: 'ancestor', sequence: 1, role: 'ancestor' as const, amountCents: 200 },
  { id: 'pool', sequence: 2, role: 'protocol_pool' as const, amountCents: 100 }
];

describe('cumulative refund allocation', () => {
  // NOTE (Task C3): 'protocol_pool' is the legacy house/non-payable role — under
  // house-first flooring it absorbs rounding dust instead of taking a pure
  // proportional D'Hondt share, so its cumulative target differs from a naive
  // proportional split. 'maker'/'ancestor' (payable) get their exact floor.
  it('conserves every partial refund exactly', () => {
    const first = calculateRefundAllocationDelta(allocations, 1000, 333);
    // maker floor(700*333/1000)=233, ancestor floor(200*333/1000)=66,
    // pool absorbs the remainder: 333-233-66=34.
    expect(first.map((row) => row.deltaAmountCents)).toEqual([233, 66, 34]);
    expect(first.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(333);

    const prior = new Map(first.map((row) => [row.id, row.cumulativeAmountCents]));
    const second = calculateRefundAllocationDelta(allocations, 1000, 667, prior);
    expect(second.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(334);
    // maker floor(700*667/1000)=466, ancestor floor(200*667/1000)=133,
    // pool absorbs the remainder: 667-466-133=68.
    expect(second.map((row) => row.cumulativeAmountCents)).toEqual([466, 133, 68]);
  });

  it('ends exactly at each immutable allocation on a full refund', () => {
    const rows = calculateRefundAllocationDelta(allocations, 1000, 1000);
    expect(rows.map((row) => row.cumulativeAmountCents)).toEqual([700, 200, 100]);
  });

  it('assigns weighted cents deterministically with stable sequence ties', () => {
    // Payable floors (a,b) are both floor(1*2/3)=0, so the house (pool) is asked to
    // absorb all 2 cents of remainder — but pool only ever received 1, so it maxes
    // out at its own frozen amount (never over-clawed) and the last cent legitimately
    // spills back to the payables, broken deterministically by sequence (a wins).
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

// Task C3: house-first refund flooring under the "Shareware, Restored" model.
// Payable roles are 'seller' and 'ancestor'; 'platform' is the non-payable house
// bucket that absorbs all rounding dust — on sale AND on refund. A payable
// recipient must never be clawed back more than their strict proportional floor
// share of a partial refund; the platform bucket picks up whatever remainder is
// left so total clawback still conserves exactly to the refunded gross.
describe('house-first refund flooring (Task C3)', () => {
  // gross 10000: platform 1000, ann(ancestor) 900, bob(ancestor) 900, carol(seller) 7200
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
    // Partial refund of 9200 of 10000 gross — well within the house's own 1000-cent
    // frozen amount, so the house can absorb 100% of the rounding dust on top of its
    // own proportional share without exceeding what it actually received.
    // floor(7200*9200/10000)=6624, floor(900*9200/10000)=828 (x2) -> payable floor
    // total = 8280, so the un-refunded... rather the REMAINDER the house picks up is
    // 9200-8280=920 (vs its naive proportional share of floor(1000*9200/10000)=920 —
    // in this case they coincide because 9200/10000 divides evenly per allocation;
    // the important invariant is asserted generically below via the sweep test).
    const rows = calculateRefundAllocationDelta(shareware, 10000, 9200);
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const row of payable(rows)) {
      const floorShare = Math.floor((row.amountCents * 9200) / 10000);
      expect(row.deltaAmountCents).toBeLessThanOrEqual(floorShare);
      expect(row.deltaAmountCents).toBeLessThanOrEqual(row.amountCents);
    }
    expect(byId.get('carol')!.deltaAmountCents).toBe(6624); // floor(7200*9200/10000)
    expect(byId.get('ann')!.deltaAmountCents).toBe(828);    // floor(900*9200/10000)
    expect(byId.get('bob')!.deltaAmountCents).toBe(828);

    // The house absorbs whatever is left so the total still conserves exactly.
    const total = rows.reduce((sum, row) => sum + row.deltaAmountCents, 0);
    expect(total).toBe(9200);
    const platformDelta = house(rows)[0].deltaAmountCents;
    expect(platformDelta).toBe(9200 - 6624 - 828 - 828); // = 920
    expect(platformDelta).toBeLessThanOrEqual(1000);      // never exceeds what the house received
  });

  it('dust from flooring lands on the house, never on a maker/seller/ancestor', () => {
    // Refund 1 cent of a 10000-cent order: every payable role floors to 0,
    // the entire cent is absorbed by the platform bucket.
    const rows = calculateRefundAllocationDelta(shareware, 10000, 1);
    for (const row of payable(rows)) {
      expect(row.deltaAmountCents).toBe(0);
    }
    expect(house(rows)[0].deltaAmountCents).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(1);
  });

  it('when the house is fully exhausted, remaining dust spills to payables but is still floored and bounded', () => {
    // Refund of 9999 of 10000 gross: the naive "everything past the payable floors
    // goes to the house" remainder (1002) would exceed the house's own frozen 1000
    // cents — the house was never paid more than 1000, so it cannot absorb more than
    // that. The house is capped at its own frozen amount (never over-clawed either),
    // and the extra 2 cents of dust spill back to the payables via the same
    // house-monotone largest-remainder machinery — still floored, still bounded by
    // each payable's own frozen amount, and the whole refund still conserves exactly.
    const rows = calculateRefundAllocationDelta(shareware, 10000, 9999);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get('platform')!.deltaAmountCents).toBe(1000); // capped at what the house received
    for (const row of payable(rows)) {
      expect(row.deltaAmountCents).toBeLessThanOrEqual(row.amountCents);
    }
    expect(rows.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(9999);
  });

  it('conserves total clawback == refunded gross across successive partial refunds', () => {
    const first = calculateRefundAllocationDelta(shareware, 10000, 3333);
    const prior = new Map(first.map((row) => [row.id, row.cumulativeAmountCents]));
    expect(first.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(3333);
    for (const row of payable(first)) {
      expect(row.deltaAmountCents).toBeLessThanOrEqual(Math.floor((row.amountCents * 3333) / 10000));
    }

    const second = calculateRefundAllocationDelta(shareware, 10000, 10000, prior);
    expect(second.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(10000 - 3333);
    // Full refund still ends exactly at each recipient's frozen amount.
    const full = calculateRefundAllocationDelta(shareware, 10000, 10000);
    expect(full.find((row) => row.id === 'carol')!.cumulativeAmountCents).toBe(7200);
    expect(full.find((row) => row.id === 'ann')!.cumulativeAmountCents).toBe(900);
    expect(full.find((row) => row.id === 'bob')!.cumulativeAmountCents).toBe(900);
    expect(full.find((row) => row.id === 'platform')!.cumulativeAmountCents).toBe(1000);
  });

  it('never claws back more than a payable recipient actually received, even mid-sequence', () => {
    // Sweep every cumulative refund amount and assert the hard invariants hold
    // throughout: conservation, and no payable ever clawed back beyond what it
    // actually received. The house's OWN clawback is also capped at what it
    // received (1000). While the house has spare capacity (cumulative refund minus
    // every payable's floor share <= 1000) every payable clawback additionally
    // matches its strict proportional floor exactly — the house-first case this
    // task exists to guarantee — and once the house is exhausted, any leftover
    // dust legitimately spills back to payables (still bounded, still conserving).
    const houseCents = 1000;
    for (let c = 0; c <= 10000; c += 137) {
      const rows = calculateRefundAllocationDelta(shareware, 10000, c);
      const payableFloorTotal = payable(rows)
        .reduce((sum, row) => sum + Math.floor((row.amountCents * c) / 10000), 0);
      const houseHasCapacity = (c - payableFloorTotal) <= houseCents;

      for (const row of payable(rows)) {
        expect(row.cumulativeAmountCents).toBeLessThanOrEqual(row.amountCents); // never over-clawed
        if (houseHasCapacity) {
          const floorShare = Math.floor((row.amountCents * c) / 10000);
          expect(row.cumulativeAmountCents).toBe(floorShare); // house-first: exact floor
        }
      }
      for (const row of house(rows)) {
        expect(row.cumulativeAmountCents).toBeLessThanOrEqual(row.amountCents); // house never over-clawed either
      }
      expect(rows.reduce((sum, row) => sum + row.deltaAmountCents, 0)).toBe(c); // conservation
    }
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
