import { describe, it, expect } from 'vitest';

// Business logic for 70/20/10 split
export function computeRoyaltySplit(grossCents: number, ancestorCount: number = 1): {
  makerCents: number;
  lineageCents: number;
  poolCents: number;
  ancestorSplits: number[];
} {
  if (grossCents <= 0) {
    return { makerCents: 0, lineageCents: 0, poolCents: 0, ancestorSplits: [] };
  }

  const makerCents = Math.round(grossCents * 0.70);
  const lineageTotalCents = Math.round(grossCents * 0.20);
  const poolCents = grossCents - makerCents - lineageTotalCents;

  const perAncestor = ancestorCount > 0 ? Math.floor(lineageTotalCents / ancestorCount) : 0;
  const ancestorSplits = Array(ancestorCount).fill(perAncestor);

  return { makerCents, lineageCents: lineageTotalCents, poolCents, ancestorSplits };
}

describe('Lineage Ledger & Royalty Distribution (70/20/10)', () => {
  it('should accurately split a $25.00 purchase', () => {
    const split = computeRoyaltySplit(2500, 1);
    expect(split.makerCents).toBe(1750); // $17.50 (70%)
    expect(split.lineageCents).toBe(500); // $5.00 (20%)
    expect(split.poolCents).toBe(250);   // $2.50 (10%)
    expect(split.makerCents + split.lineageCents + split.poolCents).toBe(2500);
  });

  it('should evenly divide lineage share across multiple upstream ancestors', () => {
    const split = computeRoyaltySplit(10000, 2); // $100 with 2 ancestors
    expect(split.lineageCents).toBe(2000);
    expect(split.ancestorSplits).toEqual([1000, 1000]);
  });

  it('should reject zero or negative transaction values', () => {
    const split = computeRoyaltySplit(-500, 1);
    expect(split.makerCents).toBe(0);
    expect(split.lineageCents).toBe(0);
  });
});
