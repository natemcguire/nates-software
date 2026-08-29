import { describe, it, expect } from 'vitest';
import {
  computeFeatureManifestDigest,
  validateFeaturePackage,
  buildTransactionAncestorSnapshot,
  calculateDisputeDebits,
  evaluateTransactionFraud
} from '../src/lib/featureMarketplace';

describe('Feature Marketplace & Lineage Royalties Engine', () => {
  it('should validate feature packages and compute deterministic manifest digests', () => {
    const validPkg = {
      featureId: 'feat-ocr-engine',
      version: '1.2.0',
      commitOid: 'e6b8f321a5b6c7d8e9f0123456789abcdef01234',
      treeOid: '99887766554433221100aabbccddeeff00112233',
      priceCents: 2500,
      compatibility: {
        minAppVersion: '1.0.0',
        schemaVersion: 2,
        supportedPlatforms: ['web', 'macos', 'windows']
      }
    };

    const validation = validateFeaturePackage(validPkg);
    expect(validation.valid).toBe(true);

    const digest1 = computeFeatureManifestDigest(validPkg);
    const digest2 = computeFeatureManifestDigest(validPkg);
    expect(digest1).toBe(digest2);
    expect(digest1).toMatch(/^sha256_/);
  });

  it('should build immutable ancestor snapshot with exact 70/20/10 integer cent conservation across 3 ancestors', () => {
    const snapshot = buildTransactionAncestorSnapshot({
      orderId: 'ord_12345',
      appId: 'dronehunter',
      totalGrossCents: 1500, // $15.00
      makerUserId: 'usr_nate',
      makerHandle: 'nate',
      ancestorChain: [
        { repositoryId: 'repo_root', ownerUserId: 'usr_alice', ownerHandle: 'alice', depth: 1, parentCommitOid: '1111111111111111111111111111111111111111' },
        { repositoryId: 'repo_mid1', ownerUserId: 'usr_bob', ownerHandle: 'bob', depth: 2, parentCommitOid: '2222222222222222222222222222222222222222' },
        { repositoryId: 'repo_mid2', ownerUserId: 'usr_charlie', ownerHandle: 'charlie', depth: 3, parentCommitOid: '3333333333333333333333333333333333333333' }
      ]
    });

    expect(snapshot.orderId).toBe('ord_12345');
    expect(snapshot.makerId).toBe('usr_nate');

    // 70% of 1500 = 1050
    const makerSplit = snapshot.splits.find(s => s.role === 'maker');
    expect(makerSplit?.amountCents).toBe(1050);

    // 20% of 1500 = 300 distributed among 3 ancestors = 100 each
    const ancestorSplits = snapshot.splits.filter(s => s.role === 'ancestor');
    expect(ancestorSplits.length).toBe(3);
    ancestorSplits.forEach(a => expect(a.amountCents).toBe(100));

    // 10% of 1500 = 150
    const poolSplit = snapshot.splits.find(s => s.role === 'protocol_pool');
    expect(poolSplit?.amountCents).toBe(150);

    // Total conservation: 1050 + 100 + 100 + 100 + 150 = 1500
    const sumCents = snapshot.splits.reduce((acc, s) => acc + s.amountCents, 0);
    expect(sumCents).toBe(1500);
  });

  it('should calculate dispute and refund debits proportionally across all recipients', () => {
    const snapshot = buildTransactionAncestorSnapshot({
      orderId: 'ord_9999',
      appId: 'certified-mailer',
      totalGrossCents: 2000,
      makerUserId: 'usr_nate',
      makerHandle: 'nate',
      ancestorChain: [
        { repositoryId: 'repo_root', ownerUserId: 'usr_josh', ownerHandle: 'josh', depth: 1, parentCommitOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
      ]
    });

    const debits = calculateDisputeDebits(snapshot, 'dp_555');
    expect(debits.orderId).toBe('ord_9999');
    expect(debits.amountCents).toBe(2000);
    expect(debits.makerDebitCents).toBe(1400); // 70% of 2000
    expect(debits.ancestorDebits[0].debitCents).toBe(400); // 20% of 2000
    expect(debits.platformDebitCents).toBe(200); // 10% of 2000
  });

  it('should detect self-dealing and circular lineage loops', () => {
    // 1. Normal clean purchase
    const cleanCheck = evaluateTransactionFraud({
      buyerUserId: 'usr_guest_1',
      makerUserId: 'usr_nate',
      ancestorChain: [{ repositoryId: 'repo_root', ownerUserId: 'usr_josh', ownerHandle: 'josh', depth: 1, parentCommitOid: '1111' }]
    });
    expect(cleanCheck.isAllowed).toBe(true);
    expect(cleanCheck.hasCircularLineage).toBe(false);

    // 2. Circular lineage detection
    const circularCheck = evaluateTransactionFraud({
      buyerUserId: 'usr_guest_2',
      makerUserId: 'usr_nate',
      ancestorChain: [
        { repositoryId: 'repo_a', ownerUserId: 'usr_josh', ownerHandle: 'josh', depth: 1, parentCommitOid: '1111' },
        { repositoryId: 'repo_a', ownerUserId: 'usr_josh', ownerHandle: 'josh', depth: 2, parentCommitOid: '2222' }
      ]
    });
    expect(circularCheck.isAllowed).toBe(false);
    expect(circularCheck.hasCircularLineage).toBe(true);

    // 3. Self-dealing detection
    const selfCheck = evaluateTransactionFraud({
      buyerUserId: 'usr_nate',
      makerUserId: 'usr_nate',
      ancestorChain: []
    });
    expect(selfCheck.isSelfDealing).toBe(true);
    expect(selfCheck.riskScore).toBeGreaterThanOrEqual(60);
  });
});
