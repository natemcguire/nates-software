import { describe, it, expect } from 'vitest';
import { computeRoyaltySplit } from '../src/lib/gitsmithDomain';

describe('Lineage Ledger & Royalty Distribution (70/20/10)', () => {
  it('should accurately split a $25.00 purchase', () => {
    const split = computeRoyaltySplit(2500, 1);
    expect(split.makerCents).toBe(1750); // $17.50 (70%)
    expect(split.lineageTotalCents).toBe(500); // $5.00 (20%)
    expect(split.poolCents).toBe(250);   // $2.50 (10%)
    expect(split.makerCents + split.lineageTotalCents + split.poolCents).toBe(2500);
  });

  it('should evenly divide lineage share across multiple upstream ancestors', () => {
    const split = computeRoyaltySplit(10000, 2); // $100 with 2 ancestors
    expect(split.lineageTotalCents).toBe(2000);
    expect(split.ancestorSplits).toEqual([1000, 1000]);
  });

  it('should reject zero or negative transaction values', () => {
    const split = computeRoyaltySplit(-500, 1);
    expect(split.makerCents).toBe(0);
    expect(split.lineageTotalCents).toBe(0);
  });
});
