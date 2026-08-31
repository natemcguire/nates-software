import { describe, it, expect } from 'vitest';
import {
  calculateAllocations,
  validateContributors,
  CommerceValidationError,
  COMMERCE_BASIS_POINTS,
  MAKER_FLOOR_BPS,
  AllocationCalculationInput,
  AncestorInput,
  ContributorInput
} from '../src/lib/commerceDomain';

describe('Phase 2: Contributor Carve Math in calculateAllocations', () => {
  // --------------------------------------------------------------------------
  // 1. THE BYTE-IDENTICAL GUARANTEE (Zero behavior change when contributors absent/empty)
  // --------------------------------------------------------------------------
  describe('1. Byte-Identical Guarantee with Absent, Null, or Empty Contributors', () => {
    it.each([
      [1500, 'usd', 'usr_nate', 'repo_root', []],
      [1, 'usd', 'usr_nate', null, []],
      [10, 'usd', 'usr_nate', 'repo_root', []],
      [1999, 'usd', 'usr_nate', 'repo_root', []],
      [100000, 'usd', 'usr_nate', 'repo_root', []],
      [1500, 'usd', 'usr_seller', 'repo_fork', [{ userId: 'usr_anc1', repositoryId: 'repo_p1', depth: 1 }]],
      [5000, 'usd', 'usr_seller', 'repo_fork', [
        { userId: 'usr_anc1', repositoryId: 'repo_p1', depth: 1 },
        { userId: 'usr_anc2', repositoryId: 'repo_p2', depth: 2 },
        { userId: 'usr_anc3', repositoryId: 'repo_p3', depth: 3 }
      ]]
    ])(
      'produces identical results for gross=%i with absent vs empty/null contributors',
      (grossCents, currency, sellerUserId, repositoryId, ancestors) => {
        const baseInput: AllocationCalculationInput = {
          grossCents,
          currency,
          sellerUserId,
          repositoryId,
          ancestors
        };

        const resDefault = calculateAllocations(baseInput);
        const resUndefined = calculateAllocations({ ...baseInput, contributors: undefined });
        const resNull = calculateAllocations({ ...baseInput, contributors: null });
        const resEmpty = calculateAllocations({ ...baseInput, contributors: [] });

        // Verify all 4 invocations return identical outputs
        expect(resUndefined.allocations).toEqual(resDefault.allocations);
        expect(resNull.allocations).toEqual(resDefault.allocations);
        expect(resEmpty.allocations).toEqual(resDefault.allocations);

        expect(resDefault.makerCents).toBe(resEmpty.makerCents);
        expect(resDefault.makerBasisPoints).toBe(resEmpty.makerBasisPoints);
        expect(resDefault.protocolPoolCents).toBe(resEmpty.protocolPoolCents);
        expect(resDefault.protocolPoolBasisPoints).toBe(resEmpty.protocolPoolBasisPoints);
        expect(resDefault.lineageTotalCents).toBe(resEmpty.lineageTotalCents);
        expect(resDefault.lineageTotalBasisPoints).toBe(resEmpty.lineageTotalBasisPoints);

        // No contributor rows emitted
        expect(resDefault.allocations.some(a => a.role === 'contributor')).toBe(false);
        expect(resEmpty.allocations.some(a => a.role === 'contributor')).toBe(false);
        expect(resDefault.contributorAllocations).toEqual([]);
        expect(resDefault.contributorTotalCents).toBe(0);
        expect(resDefault.contributorTotalBasisPoints).toBe(0);
      }
    );
  });

  // --------------------------------------------------------------------------
  // 2. INPUT VALIDATION & FAIL-CLOSED GUARDS
  // --------------------------------------------------------------------------
  describe('2. Contributor Input Validation & Fail-Closed Guards', () => {
    it('accepts null, undefined, or empty array as empty contributors', () => {
      expect(validateContributors(null)).toEqual([]);
      expect(validateContributors(undefined)).toEqual([]);
      expect(validateContributors([])).toEqual([]);
    });

    it('sanitizes valid contributor inputs by trimming user IDs', () => {
      const result = validateContributors([
        { userId: '  usr_alice  ', bps: 500 },
        { userId: 'usr_bob', bps: 1000 }
      ]);
      expect(result).toEqual([
        { userId: 'usr_alice', bps: 500 },
        { userId: 'usr_bob', bps: 1000 }
      ]);
    });

    it.each([
      ['not-array', 'string instead of array'],
      [123, 'number instead of array'],
      [true, 'boolean instead of array'],
      [{}, 'object instead of array']
    ])('rejects non-array contributor input: %s (%s)', (invalidInput, _desc) => {
      expect(() => validateContributors(invalidInput)).toThrow(CommerceValidationError);
      expect(() => validateContributors(invalidInput)).toThrow(/Contributors must be an array/);
    });

    it.each([
      [[null], 'null item in array'],
      [[undefined], 'undefined item in array'],
      [['string_item'], 'string item in array'],
      [[123], 'number item in array']
    ])('rejects invalid item in contributors array: %s (%s)', (invalidArray, _desc) => {
      expect(() => validateContributors(invalidArray as any)).toThrow(CommerceValidationError);
      expect(() => validateContributors(invalidArray as any)).toThrow(/must be a valid object/);
    });

    it.each([
      ['', 'empty string'],
      ['   ', 'whitespace only'],
      [null, 'null userId'],
      [undefined, 'undefined userId'],
      [123, 'number userId'],
      [{}, 'object userId']
    ])('rejects invalid or missing userId: %s (%s)', (invalidUserId, _desc) => {
      expect(() => validateContributors([{ userId: invalidUserId as any, bps: 500 }])).toThrow(CommerceValidationError);
      expect(() => validateContributors([{ userId: invalidUserId as any, bps: 500 }])).toThrow(/invalid or missing userId/);
    });

    it('rejects duplicate contributor userIds', () => {
      expect(() =>
        validateContributors([
          { userId: 'usr_alice', bps: 500 },
          { userId: 'usr_alice', bps: 1000 }
        ])
      ).toThrow(CommerceValidationError);
      expect(() =>
        validateContributors([
          { userId: 'usr_alice', bps: 500 },
          { userId: 'usr_alice', bps: 1000 }
        ])
      ).toThrow(/Duplicate contributor userId detected: usr_alice/);
    });

    it.each([
      [0, 'zero bps'],
      [-1, 'negative bps'],
      [-500, 'large negative bps'],
      [10.5, 'fractional float bps'],
      [0.1, 'small float bps'],
      [NaN, 'NaN bps'],
      [Infinity, 'Infinity bps'],
      [-Infinity, '-Infinity bps'],
      ['500', 'string bps'],
      [null, 'null bps'],
      [undefined, 'undefined bps']
    ])('rejects invalid basis points: %s (%s)', (invalidBps, _desc) => {
      expect(() => validateContributors([{ userId: 'usr_alice', bps: invalidBps as any }])).toThrow(CommerceValidationError);
      expect(() => validateContributors([{ userId: 'usr_alice', bps: invalidBps as any }])).toThrow(/invalid bps/);
    });

    // ------------------------------------------------------------------------
    // Floor & Over-Cap Validation (Root <= 8000 bps, Fork <= 6000 bps)
    // ------------------------------------------------------------------------
    it('allows root application contributors up to exactly 8000 bps (maker floor 1000 bps)', () => {
      const validRoot = calculateAllocations({
        grossCents: 10000,
        currency: 'usd',
        sellerUserId: 'usr_nate',
        contributors: [
          { userId: 'usr_c1', bps: 4000 },
          { userId: 'usr_c2', bps: 4000 }
        ]
      });

      expect(validRoot.makerBasisPoints).toBe(1000); // exactly MAKER_FLOOR_BPS
      expect(validRoot.contributorTotalBasisPoints).toBe(8000);
      expect(validRoot.allocations.find(a => a.role === 'maker')?.basisPoints).toBe(1000);
    });

    it('rejects root application contributors exceeding 8000 bps cap (fail-closed)', () => {
      expect(() =>
        calculateAllocations({
          grossCents: 10000,
          currency: 'usd',
          sellerUserId: 'usr_nate',
          contributors: [
            { userId: 'usr_c1', bps: 4000 },
            { userId: 'usr_c2', bps: 4001 } // total 8001 > 8000
          ]
        })
      ).toThrow(CommerceValidationError);

      expect(() =>
        calculateAllocations({
          grossCents: 10000,
          currency: 'usd',
          sellerUserId: 'usr_nate',
          contributors: [{ userId: 'usr_c1', bps: 9000 }]
        })
      ).toThrow(/exceeds the allowable carve cap of 8000 bps/);
    });

    it('allows fork application contributors up to exactly 6000 bps (maker floor 1000 bps)', () => {
      const validFork = calculateAllocations({
        grossCents: 10000,
        currency: 'usd',
        sellerUserId: 'usr_nate',
        ancestors: [{ userId: 'usr_parent', depth: 1 }],
        contributors: [
          { userId: 'usr_c1', bps: 3000 },
          { userId: 'usr_c2', bps: 3000 }
        ]
      });

      expect(validFork.makerBasisPoints).toBe(1000); // exactly MAKER_FLOOR_BPS
      expect(validFork.contributorTotalBasisPoints).toBe(6000);
      expect(validFork.allocations.find(a => a.role === 'maker')?.basisPoints).toBe(1000);
    });

    it('rejects fork application contributors exceeding 6000 bps cap (fail-closed)', () => {
      expect(() =>
        calculateAllocations({
          grossCents: 10000,
          currency: 'usd',
          sellerUserId: 'usr_nate',
          ancestors: [{ userId: 'usr_parent', depth: 1 }],
          contributors: [
            { userId: 'usr_c1', bps: 3000 },
            { userId: 'usr_c2', bps: 3001 } // total 6001 > 6000
          ]
        })
      ).toThrow(CommerceValidationError);

      expect(() =>
        calculateAllocations({
          grossCents: 10000,
          currency: 'usd',
          sellerUserId: 'usr_nate',
          ancestors: [{ userId: 'usr_parent', depth: 1 }],
          contributors: [{ userId: 'usr_c1', bps: 6500 }]
        })
      ).toThrow(/exceeds the allowable carve cap of 6000 bps/);
    });
  });

  // --------------------------------------------------------------------------
  // 3. DETERMINISTIC CARVE MATH & SEQUENCING
  // --------------------------------------------------------------------------
  describe('3. Deterministic Carve Math & Sequencing', () => {
    it('correctly calculates root app with 1 contributor (15% share on $15.00 purchase)', () => {
      // Gross: 1500 cents ($15.00)
      // Protocol Pool: 10% = 150 cents, 1000 bps
      // Contributor: 15% (1500 bps) = Math.floor(1500 * 1500 / 10000) = 225 cents
      // Maker remainder: 9000 - 1500 = 7500 bps; 1500 - 150 - 225 = 1125 cents
      const res = calculateAllocations({
        grossCents: 1500,
        currency: 'usd',
        sellerUserId: 'usr_maker',
        repositoryId: 'repo_root',
        contributors: [{ userId: 'usr_contrib1', bps: 1500 }]
      });

      expect(res.isRoot).toBe(true);
      expect(res.makerCents).toBe(1125);
      expect(res.makerBasisPoints).toBe(7500);
      expect(res.contributorTotalCents).toBe(225);
      expect(res.contributorTotalBasisPoints).toBe(1500);
      expect(res.protocolPoolCents).toBe(150);
      expect(res.protocolPoolBasisPoints).toBe(1000);

      // Sequencing: maker (0) -> contributor (1) -> protocol_pool (2)
      expect(res.allocations).toHaveLength(3);

      expect(res.allocations[0]).toEqual({
        sequence: 0,
        role: 'maker',
        recipientUserId: 'usr_maker',
        sourceRepositoryId: 'repo_root',
        lineageDepth: 0,
        basisPoints: 7500,
        amountCents: 1125
      });

      expect(res.allocations[1]).toEqual({
        sequence: 1,
        role: 'contributor',
        recipientUserId: 'usr_contrib1',
        sourceRepositoryId: 'repo_root',
        lineageDepth: null,
        basisPoints: 1500,
        amountCents: 225
      });

      expect(res.allocations[2]).toEqual({
        sequence: 2,
        role: 'protocol_pool',
        recipientUserId: null,
        sourceRepositoryId: null,
        lineageDepth: null,
        basisPoints: 1000,
        amountCents: 150
      });

      expect(res.contributorAllocations).toEqual([
        {
          sequence: 1,
          repositoryId: 'repo_root',
          userId: 'usr_contrib1',
          basisPoints: 1500,
          amountCents: 225
        }
      ]);
    });

    it('correctly calculates fork app with 2 ancestors and 2 contributors', () => {
      // Gross: 2000 cents ($20.00)
      // Protocol Pool: 10% = 200 cents, 1000 bps
      // Lineage (2 ancestors): 2000 bps total (1000 each) = 400 cents total (200 each)
      // Contributors:
      //   Contrib 1: 500 bps (5%) = Math.floor(2000 * 500 / 10000) = 100 cents
      //   Contrib 2: 1500 bps (15%) = Math.floor(2000 * 1500 / 10000) = 300 cents
      //   Total Contributor: 2000 bps, 400 cents
      // Maker remainder:
      //   BPS: 7000 - 2000 = 5000 bps
      //   Cents: 2000 - 400 (lineage) - 200 (pool) - 400 (contribs) = 1000 cents
      const res = calculateAllocations({
        grossCents: 2000,
        currency: 'usd',
        sellerUserId: 'usr_fork_maker',
        repositoryId: 'repo_fork_app',
        ancestors: [
          { userId: 'usr_parent', repositoryId: 'repo_parent', depth: 1 },
          { userId: 'usr_root', repositoryId: 'repo_root', depth: 2 }
        ],
        contributors: [
          { userId: 'usr_contrib_a', bps: 500 },
          { userId: 'usr_contrib_b', bps: 1500 }
        ]
      });

      expect(res.isRoot).toBe(false);
      expect(res.makerCents).toBe(1000);
      expect(res.makerBasisPoints).toBe(5000);
      expect(res.lineageTotalCents).toBe(400);
      expect(res.lineageTotalBasisPoints).toBe(2000);
      expect(res.contributorTotalCents).toBe(400);
      expect(res.contributorTotalBasisPoints).toBe(2000);
      expect(res.protocolPoolCents).toBe(200);
      expect(res.protocolPoolBasisPoints).toBe(1000);

      // Sequencing: maker (0) -> ancestor1 (1) -> ancestor2 (2) -> contrib_a (3) -> contrib_b (4) -> protocol_pool (5)
      expect(res.allocations).toHaveLength(6);

      expect(res.allocations[0]).toEqual({
        sequence: 0,
        role: 'maker',
        recipientUserId: 'usr_fork_maker',
        sourceRepositoryId: 'repo_fork_app',
        lineageDepth: 0,
        basisPoints: 5000,
        amountCents: 1000
      });

      expect(res.allocations[1]).toEqual({
        sequence: 1,
        role: 'ancestor',
        recipientUserId: 'usr_parent',
        sourceRepositoryId: 'repo_parent',
        lineageDepth: 1,
        basisPoints: 1000,
        amountCents: 200
      });

      expect(res.allocations[2]).toEqual({
        sequence: 2,
        role: 'ancestor',
        recipientUserId: 'usr_root',
        sourceRepositoryId: 'repo_root',
        lineageDepth: 2,
        basisPoints: 1000,
        amountCents: 200
      });

      expect(res.allocations[3]).toEqual({
        sequence: 3,
        role: 'contributor',
        recipientUserId: 'usr_contrib_a',
        sourceRepositoryId: 'repo_fork_app',
        lineageDepth: null,
        basisPoints: 500,
        amountCents: 100
      });

      expect(res.allocations[4]).toEqual({
        sequence: 4,
        role: 'contributor',
        recipientUserId: 'usr_contrib_b',
        sourceRepositoryId: 'repo_fork_app',
        lineageDepth: null,
        basisPoints: 1500,
        amountCents: 300
      });

      expect(res.allocations[5]).toEqual({
        sequence: 5,
        role: 'protocol_pool',
        recipientUserId: null,
        sourceRepositoryId: null,
        lineageDepth: null,
        basisPoints: 1000,
        amountCents: 200
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4. ZERO-CENTS CONTRIBUTOR ROWS (Small grossCents / tiny share)
  // --------------------------------------------------------------------------
  describe('4. Zero-Cents Contributor Rows (Floor-to-zero is legal and emits valid row)', () => {
    it('emits a valid contributor row with 0 cents when gross price is 1 cent ($0.01)', () => {
      // Gross: 1 cent
      // Contributor: 500 bps (5%) -> Math.floor(1 * 500 / 10000) = 0 cents
      // Protocol Pool: 1000 bps (10%) -> Math.floor(1 * 1000 / 10000) = 0 cents
      // Maker: remainder = 1 - 0 - 0 = 1 cent; bps = 9000 - 500 = 8500 bps
      const res = calculateAllocations({
        grossCents: 1,
        currency: 'usd',
        sellerUserId: 'usr_nate',
        repositoryId: 'repo_tiny',
        contributors: [{ userId: 'usr_helper', bps: 500 }]
      });

      expect(res.grossCents).toBe(1);
      expect(res.makerCents).toBe(1);
      expect(res.protocolPoolCents).toBe(0);
      expect(res.contributorTotalCents).toBe(0);
      expect(res.conservationVerified).toBe(true);

      const contribAlloc = res.allocations.find(a => a.role === 'contributor');
      expect(contribAlloc).toBeDefined();
      expect(contribAlloc).toEqual({
        sequence: 1,
        role: 'contributor',
        recipientUserId: 'usr_helper',
        sourceRepositoryId: 'repo_tiny',
        lineageDepth: null,
        basisPoints: 500,
        amountCents: 0
      });

      // Strict conservation
      const totalCents = res.allocations.reduce((s, a) => s + a.amountCents, 0);
      const totalBps = res.allocations.reduce((s, a) => s + a.basisPoints, 0);
      expect(totalCents).toBe(1);
      expect(totalBps).toBe(10000);
    });

    it('emits valid 0-cent rows for multiple contributors on low prices', () => {
      const res = calculateAllocations({
        grossCents: 5,
        currency: 'usd',
        sellerUserId: 'usr_nate',
        contributors: [
          { userId: 'usr_c1', bps: 100 }, // 5 * 100 / 10000 = 0 cents
          { userId: 'usr_c2', bps: 200 }  // 5 * 200 / 10000 = 0 cents
        ]
      });

      expect(res.allocations.filter(a => a.role === 'contributor')).toHaveLength(2);
      expect(res.allocations.filter(a => a.role === 'contributor').map(a => a.amountCents)).toEqual([0, 0]);
      expect(res.allocations.filter(a => a.role === 'contributor').map(a => a.basisPoints)).toEqual([100, 200]);

      const totalCents = res.allocations.reduce((s, a) => s + a.amountCents, 0);
      const totalBps = res.allocations.reduce((s, a) => s + a.basisPoints, 0);
      expect(totalCents).toBe(5);
      expect(totalBps).toBe(10000);
    });
  });

  // --------------------------------------------------------------------------
  // 5. EXTENSIVE RANDOMIZED PROPERTY TESTS (Spec Exit Gate)
  // --------------------------------------------------------------------------
  describe('5. Randomized Property Tests (Conservation & Invariance under Fuzzing)', () => {
    // Deterministic pseudo-random number generator for reproducible fuzz tests
    let seed = 42;
    function pseudoRandom(): number {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    }

    function randInt(min: number, max: number): number {
      return Math.floor(pseudoRandom() * (max - min + 1)) + min;
    }

    it('proves conservation and non-maker invariance across 2,000 random configurations', () => {
      for (let iteration = 0; iteration < 2000; iteration++) {
        // Random price: skewed distribution across 1 cent to $100,000 (10,000,000 cents)
        const priceTier = randInt(1, 4);
        let grossCents: number;
        if (priceTier === 1) {
          grossCents = randInt(1, 100); // 1 cent - $1.00
        } else if (priceTier === 2) {
          grossCents = randInt(100, 5000); // $1.00 - $50.00
        } else if (priceTier === 3) {
          grossCents = randInt(5000, 100000); // $50.00 - $1,000.00
        } else {
          grossCents = randInt(100000, 10000000); // $1,000.00 - $100,000.00
        }

        const numAncestors = randInt(0, 4);
        const ancestors: AncestorInput[] = [];
        for (let a = 0; a < numAncestors; a++) {
          ancestors.push({
            userId: `usr_anc_${iteration}_${a + 1}`,
            repositoryId: `repo_anc_${iteration}_${a + 1}`,
            depth: a + 1
          });
        }

        const isRoot = numAncestors === 0;
        const maxGrantableBps = isRoot
          ? COMMERCE_BASIS_POINTS.ROOT_MAKER - MAKER_FLOOR_BPS // 8000
          : COMMERCE_BASIS_POINTS.FORK_MAKER - MAKER_FLOOR_BPS; // 6000

        const numContributors = randInt(0, 3);
        const contributors: ContributorInput[] = [];

        if (numContributors > 0) {
          let remainingBps = maxGrantableBps;
          for (let c = 0; c < numContributors; c++) {
            if (remainingBps <= 1) break;
            const slotsLeft = numContributors - c;
            const maxForThis = Math.floor(remainingBps / slotsLeft);
            const bps = randInt(1, Math.max(1, maxForThis));
            contributors.push({
              userId: `usr_contrib_${iteration}_${c + 1}`,
              bps
            });
            remainingBps -= bps;
          }
        }

        const baseInput: AllocationCalculationInput = {
          grossCents,
          currency: 'usd',
          sellerUserId: `usr_seller_${iteration}`,
          repositoryId: `repo_app_${iteration}`,
          ancestors
        };

        // 1. Calculate without contributors (the uncarved baseline)
        const resBaseline = calculateAllocations(baseInput);

        // 2. Calculate with contributors (the carved result)
        const resCarved = calculateAllocations({
          ...baseInput,
          contributors
        });

        // --------------------------------------------------------------------
        // Invariant A: Conservation of Cents and BPS
        // --------------------------------------------------------------------
        const sumCents = resCarved.allocations.reduce((sum, a) => sum + a.amountCents, 0);
        const sumBps = resCarved.allocations.reduce((sum, a) => sum + a.basisPoints, 0);

        expect(sumCents).toBe(grossCents);
        expect(sumBps).toBe(COMMERCE_BASIS_POINTS.TOTAL);
        expect(resCarved.conservationVerified).toBe(true);

        // --------------------------------------------------------------------
        // Invariant B: Maker Retains at least MAKER_FLOOR_BPS and >= 0 Cents
        // --------------------------------------------------------------------
        expect(resCarved.makerBasisPoints).toBeGreaterThanOrEqual(MAKER_FLOOR_BPS);
        expect(resCarved.makerCents).toBeGreaterThanOrEqual(0);

        // --------------------------------------------------------------------
        // Invariant C: Protocol Pool is BYTE-IDENTICAL to baseline (Never touched by carve)
        // --------------------------------------------------------------------
        expect(resCarved.protocolPoolCents).toBe(resBaseline.protocolPoolCents);
        expect(resCarved.protocolPoolBasisPoints).toBe(resBaseline.protocolPoolBasisPoints);

        const poolRowBaseline = resBaseline.allocations.find(a => a.role === 'protocol_pool')!;
        const poolRowCarved = resCarved.allocations.find(a => a.role === 'protocol_pool')!;
        expect(poolRowCarved.amountCents).toBe(poolRowBaseline.amountCents);
        expect(poolRowCarved.basisPoints).toBe(poolRowBaseline.basisPoints);
        expect(poolRowCarved.recipientUserId).toBeNull();
        expect(poolRowCarved.sourceRepositoryId).toBeNull();
        expect(poolRowCarved.lineageDepth).toBeNull();

        // --------------------------------------------------------------------
        // Invariant D: Ancestor Allocations are BYTE-IDENTICAL to baseline (Never touched by carve)
        // --------------------------------------------------------------------
        expect(resCarved.lineageTotalCents).toBe(resBaseline.lineageTotalCents);
        expect(resCarved.lineageTotalBasisPoints).toBe(resBaseline.lineageTotalBasisPoints);

        const ancestorRowsBaseline = resBaseline.allocations.filter(a => a.role === 'ancestor');
        const ancestorRowsCarved = resCarved.allocations.filter(a => a.role === 'ancestor');
        expect(ancestorRowsCarved.length).toBe(ancestorRowsBaseline.length);

        for (let idx = 0; idx < ancestorRowsCarved.length; idx++) {
          const aCarved = ancestorRowsCarved[idx];
          const aBase = ancestorRowsBaseline[idx];
          expect(aCarved.amountCents).toBe(aBase.amountCents);
          expect(aCarved.basisPoints).toBe(aBase.basisPoints);
          expect(aCarved.recipientUserId).toBe(aBase.recipientUserId);
          expect(aCarved.sourceRepositoryId).toBe(aBase.sourceRepositoryId);
          expect(aCarved.lineageDepth).toBe(aBase.lineageDepth);
          expect(aCarved.sequence).toBe(aBase.sequence);
        }

        // --------------------------------------------------------------------
        // Invariant E: The Carve is 100% From Maker Only
        // --------------------------------------------------------------------
        const expectedCarvedBps = contributors.reduce((s, c) => s + c.bps, 0);
        const actualCarvedBps = resBaseline.makerBasisPoints - resCarved.makerBasisPoints;
        expect(actualCarvedBps).toBe(expectedCarvedBps);

        const actualCarvedCents = resBaseline.makerCents - resCarved.makerCents;
        expect(actualCarvedCents).toBe(resCarved.contributorTotalCents);

        // --------------------------------------------------------------------
        // Invariant F: Contributor Rows Structure & Sequencing
        // --------------------------------------------------------------------
        const contribRows = resCarved.allocations.filter(a => a.role === 'contributor');
        expect(contribRows.length).toBe(contributors.length);

        for (let cIdx = 0; cIdx < contribRows.length; cIdx++) {
          const row = contribRows[cIdx];
          const inputContrib = contributors[cIdx];
          expect(row.role).toBe('contributor');
          expect(row.recipientUserId).toBe(inputContrib.userId);
          expect(row.sourceRepositoryId).toBe(`repo_app_${iteration}`);
          expect(row.lineageDepth).toBeNull();
          expect(row.basisPoints).toBe(inputContrib.bps);
          expect(row.amountCents).toBe(Math.floor((grossCents * inputContrib.bps) / COMMERCE_BASIS_POINTS.TOTAL));

          // Sequence continues after maker (seq 0) + ancestors (seq 1..N)
          const expectedSeq = 1 + numAncestors + cIdx;
          expect(row.sequence).toBe(expectedSeq);
        }

        // Protocol pool sequence is always last
        expect(poolRowCarved.sequence).toBe(1 + numAncestors + contributors.length);
      }
    });
  });
});
