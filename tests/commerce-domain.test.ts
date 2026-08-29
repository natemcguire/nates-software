import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateAllocations,
  validateGrossCents,
  validateCurrency,
  validateAncestors,
  fetchRepositoryAncestry,
  CommerceValidationError,
  COMMERCE_BASIS_POINTS
} from '../src/lib/commerceDomain';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

describe('Durable Commerce Domain Logic & Allocation Engine', () => {
  describe('1. Gross Cents & Money Validation', () => {
    it.each([1, 10, 1500, 2000, 2500, 100000, Number.MAX_SAFE_INTEGER])(
      'accepts valid positive integer cents: %i',
      (cents) => {
        expect(validateGrossCents(cents)).toBe(cents);
      }
    );

    it.each([
      [0, 'zero cents'],
      [-1, 'negative cents'],
      [-1500, 'negative large cents'],
      [15.5, 'fractional float cents'],
      [0.99, 'fractional cents'],
      [NaN, 'NaN'],
      [Infinity, 'Infinity'],
      [-Infinity, '-Infinity'],
      ['1500', 'string value'],
      [null, 'null'],
      [undefined, 'undefined'],
      [{}, 'object'],
      [Number.MAX_SAFE_INTEGER + 1, 'unsafe integer']
    ])('rejects invalid money value %s (%s)', (invalidVal, _desc) => {
      expect(() => validateGrossCents(invalidVal)).toThrow(CommerceValidationError);
    });
  });

  describe('2. Currency Validation', () => {
    it.each(['usd', 'eur', 'gbp', 'cad', 'jpy'])('accepts valid 3-letter lowercase currency: %s', (curr) => {
      expect(validateCurrency(curr)).toBe(curr);
    });

    it.each([
      ['USD', 'uppercase'],
      ['Usd', 'mixed case'],
      ['us', 'too short'],
      ['usdt', 'too long'],
      ['$$$', 'symbols'],
      ['123', 'digits'],
      ['', 'empty string'],
      [null, 'null'],
      [undefined, 'undefined'],
      [123, 'number']
    ])('rejects invalid currency code %s (%s)', (invalidCurr, _desc) => {
      expect(() => validateCurrency(invalidCurr)).toThrow(CommerceValidationError);
    });
  });

  describe('3. Ancestry Validation & Cycle / Duplicate Detection', () => {
    it('accepts null, undefined, or empty array as root ancestry', () => {
      expect(validateAncestors(null, 'usr_seller')).toEqual([]);
      expect(validateAncestors(undefined, 'usr_seller')).toEqual([]);
      expect(validateAncestors([], 'usr_seller')).toEqual([]);
    });

    it('accepts valid ancestor chains with auto-assigned depths', () => {
      const ancestors = validateAncestors([
        { userId: 'usr_alice', repositoryId: 'repo_a' },
        { userId: 'usr_bob', repositoryId: 'repo_b' }
      ], 'usr_seller');

      expect(ancestors).toEqual([
        { userId: 'usr_alice', repositoryId: 'repo_a', depth: 1 },
        { userId: 'usr_bob', repositoryId: 'repo_b', depth: 2 }
      ]);
    });

    it('rejects non-array input', () => {
      expect(() => validateAncestors('not-array', 'usr_seller')).toThrow(CommerceValidationError);
      expect(() => validateAncestors(123, 'usr_seller')).toThrow(CommerceValidationError);
      expect(() => validateAncestors({}, 'usr_seller')).toThrow(CommerceValidationError);
    });

    it('rejects duplicate ancestor user IDs', () => {
      expect(() =>
        validateAncestors([
          { userId: 'usr_alice' },
          { userId: 'usr_bob' },
          { userId: 'usr_alice' }
        ], 'usr_seller')
      ).toThrow(/Duplicate ancestor userId detected: usr_alice/);
    });

    it('rejects duplicate ancestor repository IDs', () => {
      expect(() =>
        validateAncestors([
          { userId: 'usr_alice', repositoryId: 'repo_parent' },
          { userId: 'usr_bob', repositoryId: 'repo_parent' }
        ], 'usr_seller')
      ).toThrow(/Duplicate ancestor repositoryId detected: repo_parent/);
    });

    it('rejects seller listed as ancestor (self-ancestry cycle)', () => {
      expect(() =>
        validateAncestors([
          { userId: 'usr_alice' },
          { userId: 'usr_seller' }
        ], 'usr_seller')
      ).toThrow(/Cyclic ancestry: seller \(usr_seller\) cannot be listed as an ancestor/);
    });

    it('rejects source repository listed as ancestor (self-fork cycle)', () => {
      expect(() =>
        validateAncestors([
          { userId: 'usr_alice', repositoryId: 'repo_child' }
        ], 'usr_seller', 'repo_child')
      ).toThrow(/Cyclic ancestry: source repository \(repo_child\) cannot be listed as an ancestor/);
    });

    it('rejects invalid or non-increasing depths', () => {
      expect(() =>
        validateAncestors([
          { userId: 'usr_alice', depth: 0 }
        ], 'usr_seller')
      ).toThrow(/invalid depth/);

      expect(() =>
        validateAncestors([
          { userId: 'usr_alice', depth: 2 },
          { userId: 'usr_bob', depth: 2 }
        ], 'usr_seller')
      ).toThrow(/must be strictly greater than previous depth/);

      expect(() =>
        validateAncestors([
          { userId: 'usr_alice', depth: 3 },
          { userId: 'usr_bob', depth: 2 }
        ], 'usr_seller')
      ).toThrow(/must be strictly greater than previous depth/);
    });
  });

  describe('4. Root Application Allocations (90% Maker / 10% Protocol Pool)', () => {
    it('calculates exact 90/10 split for standard prices', () => {
      const res = calculateAllocations({
        grossCents: 1500, // $15.00
        currency: 'usd',
        sellerUserId: 'usr_nate',
        repositoryId: 'repo_dronehunter',
        ancestors: []
      });

      expect(res.isRoot).toBe(true);
      expect(res.grossCents).toBe(1500);
      expect(res.currency).toBe('usd');
      expect(res.makerCents).toBe(1350); // 90% of 1500
      expect(res.makerBasisPoints).toBe(COMMERCE_BASIS_POINTS.ROOT_MAKER); // 9000 bps
      expect(res.protocolPoolCents).toBe(150); // 10% of 1500
      expect(res.protocolPoolBasisPoints).toBe(COMMERCE_BASIS_POINTS.ROOT_PROTOCOL_POOL); // 1000 bps
      expect(res.lineageTotalCents).toBe(0);
      expect(res.lineageTotalBasisPoints).toBe(0);
      expect(res.conservationVerified).toBe(true);

      // Allocations array
      expect(res.allocations).toHaveLength(2);
      expect(res.allocations[0]).toEqual({
        sequence: 0,
        role: 'maker',
        recipientUserId: 'usr_nate',
        sourceRepositoryId: 'repo_dronehunter',
        lineageDepth: 0,
        basisPoints: 9000,
        amountCents: 1350
      });
      expect(res.allocations[1]).toEqual({
        sequence: 1,
        role: 'protocol_pool',
        recipientUserId: null,
        sourceRepositoryId: null,
        lineageDepth: null,
        basisPoints: 1000,
        amountCents: 150
      });
    });

    it.each([
      [1, 1, 0], // $0.01: maker gets 1, protocol gets 0
      [2, 2, 0],
      [7, 7, 0],
      [9, 9, 0],
      [10, 9, 1], // $0.10: maker gets 9, protocol gets 1
      [1999, 1800, 199], // $19.99: protocol 199, maker 1800
      [2500, 2250, 250],
      [100000, 90000, 10000]
    ])('conserves all cents on root price %i cents -> maker: %i, pool: %i', (gross, expectedMaker, expectedPool) => {
      const res = calculateAllocations({
        grossCents: gross,
        currency: 'usd',
        sellerUserId: 'usr_nate'
      });

      expect(res.makerCents).toBe(expectedMaker);
      expect(res.protocolPoolCents).toBe(expectedPool);
      expect(res.makerCents + res.protocolPoolCents).toBe(gross);

      const sumCents = res.allocations.reduce((sum, a) => sum + a.amountCents, 0);
      const sumBps = res.allocations.reduce((sum, a) => sum + a.basisPoints, 0);
      expect(sumCents).toBe(gross);
      expect(sumBps).toBe(10000);
    });
  });

  describe('5. Fork Application Allocations (70% Maker / 20% Lineage / 10% Protocol Pool)', () => {
    it('calculates exact 70/20/10 split with 1 ancestor', () => {
      const res = calculateAllocations({
        grossCents: 1500,
        currency: 'usd',
        sellerUserId: 'usr_fork_maker',
        repositoryId: 'repo_fork',
        ancestors: [{ userId: 'usr_root_maker', repositoryId: 'repo_root', depth: 1 }]
      });

      expect(res.isRoot).toBe(false);
      expect(res.grossCents).toBe(1500);
      expect(res.makerCents).toBe(1050); // 70% of 1500
      expect(res.makerBasisPoints).toBe(7000);
      expect(res.lineageTotalCents).toBe(300); // 20% of 1500
      expect(res.lineageTotalBasisPoints).toBe(2000);
      expect(res.protocolPoolCents).toBe(150); // 10% of 1500
      expect(res.protocolPoolBasisPoints).toBe(1000);

      expect(res.allocations).toHaveLength(3);
      expect(res.allocations[0]).toEqual({
        sequence: 0,
        role: 'maker',
        recipientUserId: 'usr_fork_maker',
        sourceRepositoryId: 'repo_fork',
        lineageDepth: 0,
        basisPoints: 7000,
        amountCents: 1050
      });
      expect(res.allocations[1]).toEqual({
        sequence: 1,
        role: 'ancestor',
        recipientUserId: 'usr_root_maker',
        sourceRepositoryId: 'repo_root',
        lineageDepth: 1,
        basisPoints: 2000,
        amountCents: 300
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
    });

    it('distributes lineage equally and assigns remainder deterministically by ancestry order for 3 ancestors', () => {
      // 1500 cents: lineage is 300 cents. 300 / 3 = 100 each.
      // BPS: 2000 / 3 = 666 remainder 2. Ancestor 0 gets 667, Ancestor 1 gets 667, Ancestor 2 gets 666.
      const res = calculateAllocations({
        grossCents: 1500,
        currency: 'usd',
        sellerUserId: 'usr_leaf',
        ancestors: [
          { userId: 'usr_parent', depth: 1 },
          { userId: 'usr_grandparent', depth: 2 },
          { userId: 'usr_root', depth: 3 }
        ]
      });

      expect(res.allocations).toHaveLength(5);
      expect(res.allocations[0].amountCents).toBe(1050); // maker
      expect(res.allocations[0].basisPoints).toBe(7000);

      // Ancestor 1 (parent - nearest)
      expect(res.allocations[1]).toEqual({
        sequence: 1,
        role: 'ancestor',
        recipientUserId: 'usr_parent',
        sourceRepositoryId: null,
        lineageDepth: 1,
        basisPoints: 667, // 666 + 1
        amountCents: 100
      });

      // Ancestor 2 (grandparent)
      expect(res.allocations[2]).toEqual({
        sequence: 2,
        role: 'ancestor',
        recipientUserId: 'usr_grandparent',
        sourceRepositoryId: null,
        lineageDepth: 2,
        basisPoints: 667, // 666 + 1
        amountCents: 100
      });

      // Ancestor 3 (root - furthest)
      expect(res.allocations[3]).toEqual({
        sequence: 3,
        role: 'ancestor',
        recipientUserId: 'usr_root',
        sourceRepositoryId: null,
        lineageDepth: 3,
        basisPoints: 666, // base 666
        amountCents: 100
      });

      // Protocol pool
      expect(res.allocations[4]).toEqual({
        sequence: 4,
        role: 'protocol_pool',
        recipientUserId: null,
        sourceRepositoryId: null,
        lineageDepth: null,
        basisPoints: 1000,
        amountCents: 150
      });

      // Conservation checks
      const sumBps = res.allocations.reduce((s, a) => s + a.basisPoints, 0);
      const sumCents = res.allocations.reduce((s, a) => s + a.amountCents, 0);
      expect(sumBps).toBe(10000);
      expect(sumCents).toBe(1500);
    });

    it('handles remainder cents assignment deterministically across 7 ancestors', () => {
      // 1500 cents: lineage = 300 cents. 300 / 7 = 42 remainder 6 cents.
      // Ancestors 0..5 get 43 cents, Ancestor 6 gets 42 cents.
      // BPS: 2000 / 7 = 285 remainder 5. Ancestors 0..4 get 286 bps, Ancestors 5..6 get 285 bps.
      const res = calculateAllocations({
        grossCents: 1500,
        currency: 'usd',
        sellerUserId: 'usr_leaf',
        ancestors: Array.from({ length: 7 }, (_, i) => ({
          userId: `usr_anc_${i + 1}`,
          depth: i + 1
        }))
      });

      const ancestorAllocs = res.allocations.filter(a => a.role === 'ancestor');
      expect(ancestorAllocs).toHaveLength(7);

      // Cents verification
      expect(ancestorAllocs.slice(0, 6).map(a => a.amountCents)).toEqual([43, 43, 43, 43, 43, 43]);
      expect(ancestorAllocs[6].amountCents).toBe(42);

      const totalLineageCents = ancestorAllocs.reduce((s, a) => s + a.amountCents, 0);
      expect(totalLineageCents).toBe(300);

      // BPS verification
      expect(ancestorAllocs.slice(0, 5).map(a => a.basisPoints)).toEqual([286, 286, 286, 286, 286]);
      expect(ancestorAllocs.slice(5).map(a => a.basisPoints)).toEqual([285, 285]);

      const totalLineageBps = ancestorAllocs.reduce((s, a) => s + a.basisPoints, 0);
      expect(totalLineageBps).toBe(2000);

      // Total conservation
      const totalCents = res.allocations.reduce((s, a) => s + a.amountCents, 0);
      const totalBps = res.allocations.reduce((s, a) => s + a.basisPoints, 0);
      expect(totalCents).toBe(1500);
      expect(totalBps).toBe(10000);
    });

    it.each([
      [1, 1],
      [2, 1],
      [3, 2],
      [7, 3],
      [10, 4],
      [1999, 5],
      [2500, 8],
      [99999, 13]
    ])('guarantees complete conservation on %i cents with %i ancestors', (gross, numAncestors) => {
      const res = calculateAllocations({
        grossCents: gross,
        currency: 'usd',
        sellerUserId: 'usr_leaf',
        ancestors: Array.from({ length: numAncestors }, (_, i) => ({
          userId: `usr_anc_${i + 1}`
        }))
      });

      const sumCents = res.allocations.reduce((s, a) => s + a.amountCents, 0);
      const sumBps = res.allocations.reduce((s, a) => s + a.basisPoints, 0);
      expect(sumCents).toBe(gross);
      expect(sumBps).toBe(10000);
      expect(res.conservationVerified).toBe(true);
    });
  });

  describe('6. D1 Repository Lineage DAG Resolution (fetchRepositoryAncestry)', () => {
    let ctx: TestD1Context;

    beforeEach(async () => {
      ctx = await createTestD1Database({ foreignKeys: true });
    });

    it('returns empty array for root repository with no fork record', async () => {
      // Create root user & repo
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name)
        VALUES ('usr_root', 'rootdev', 'Root Dev')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key)
        VALUES ('repo_root', 'usr_root', 'my-root-app', 'key_root')
      `).run();

      const ancestry = await fetchRepositoryAncestry(ctx.d1, 'repo_root');
      expect(ancestry).toEqual([]);
    });

    it('resolves multi-generation fork lineage in correct depth order (nearest parent to root)', async () => {
      // 1. Root Repo (A) owned by usr_a
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name)
        VALUES
          ('usr_a', 'user_a', 'User A'),
          ('usr_b', 'user_b', 'User B'),
          ('usr_c', 'user_c', 'User C')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key)
        VALUES
          ('repo_a', 'usr_a', 'app-root', 'key_a'),
          ('repo_b', 'usr_b', 'app-fork-1', 'key_b'),
          ('repo_c', 'usr_c', 'app-fork-2', 'key_c')
      `).run();

      // B is fork of A
      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES ('repo_b', 'repo_a', 'usr_b', 'refs/heads/main', 'sha1', 'sha1', 'repo_a', 1)
      `).run();

      // C is fork of B
      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES ('repo_c', 'repo_b', 'usr_c', 'refs/heads/main', 'sha2', 'sha2', 'repo_a', 2)
      `).run();

      const ancestry = await fetchRepositoryAncestry(ctx.d1, 'repo_c');
      expect(ancestry).toEqual([
        { repositoryId: 'repo_b', userId: 'usr_b', depth: 1 },
        { repositoryId: 'repo_a', userId: 'usr_a', depth: 2 }
      ]);
    });

    it('detects cyclic fork graph in D1 and throws CommerceValidationError', async () => {
      await ctx.d1.prepare(`
        INSERT INTO users (id, username, display_name)
        VALUES
          ('usr_x', 'user_x', 'User X'),
          ('usr_y', 'user_y', 'User Y')
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, storage_key)
        VALUES
          ('repo_x', 'usr_x', 'cyclic-x', 'key_x'),
          ('repo_y', 'usr_y', 'cyclic-y', 'key_y')
      `).run();

      // X -> Y
      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES ('repo_x', 'repo_y', 'usr_x', 'refs/heads/main', 'sha_x', 'sha_x', 'repo_y', 1)
      `).run();

      // Y -> X (cyclic)
      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES ('repo_y', 'repo_x', 'usr_y', 'refs/heads/main', 'sha_y', 'sha_y', 'repo_x', 1)
      `).run();

      await expect(fetchRepositoryAncestry(ctx.d1, 'repo_x')).rejects.toThrow(
        /Cycle detected in repository lineage/
      );
    });
  });
});
