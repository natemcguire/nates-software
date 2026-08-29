import { describe, it, expect, beforeEach } from 'vitest';
import {
  // CAS Engine
  validateGitRef,
  validateSha,
  executeCasMerge,
  GitsmithCasEngine,
  CASMergeRequest,
  BranchProtectionPolicy,

  // Lineage Ledger
  calculateLineageSplits,
  createSettlementRecord,
  computeRoyaltySplit,
  AncestorNode,

  // Ed25519 & SSH Signatures
  generateEd25519KeyPair,
  parseSshPublicKey,
  verifyEd25519,
  signCommitPayload,
  verifyCommitSignature,
  extractCommitSignature,

  // Lineage DAG
  LineageDagEngine,
  LineageNode
} from '../src/lib/gitsmithBackend';

import { onRequestGet, onRequestPost } from '../functions/api/git';

describe('GITSMITH Bare Forge & Lineage Ledger Backend Engine', () => {

  // ==========================================================================
  // 1. ATOMIC CAS MERGE VERIFICATION ENGINE
  // ==========================================================================
  describe('1. Atomic CAS Merge Verification Engine', () => {
    let casEngine: GitsmithCasEngine;

    beforeEach(() => {
      casEngine = new GitsmithCasEngine();
      casEngine.setRef('refs/heads/main', '5c030af', 'nate');
      casEngine.setRef('refs/features/receipt-ocr/v1.2.0', '1109a2b', 'sam');
    });

    describe('Git Reference & SHA Validation', () => {
      it('should validate valid git reference paths across namespaces', () => {
        expect(validateGitRef('refs/heads/main').valid).toBe(true);
        expect(validateGitRef('refs/heads/feature/sub-feature').valid).toBe(true);
        expect(validateGitRef('refs/features/wallart-triptych/v2.4.0').valid).toBe(true);
        expect(validateGitRef('refs/tags/v1.0.0').valid).toBe(true);
        expect(validateGitRef('refs/proposals/pr-42').valid).toBe(true);
      });

      it('should reject invalid git references (malformed paths, illegal chars)', () => {
        expect(validateGitRef('heads/main').valid).toBe(false);
        expect(validateGitRef('refs/heads/').valid).toBe(false);
        expect(validateGitRef('refs/heads/main.lock').valid).toBe(false);
        expect(validateGitRef('refs/heads//main').valid).toBe(false);
        expect(validateGitRef('refs/heads/main..beta').valid).toBe(false);
        expect(validateGitRef('refs/heads/main with spaces').valid).toBe(false);
        expect(validateGitRef('refs/heads/main~1').valid).toBe(false);
        expect(validateGitRef('refs/heads/main^test').valid).toBe(false);
        expect(validateGitRef('refs/heads/main:tag').valid).toBe(false);
      });

      it('should validate SHA-1 and SHA-256 hexadecimal commit hashes', () => {
        expect(validateSha('5c030af').valid).toBe(true); // 7-char short SHA
        expect(validateSha('4e10bc9812f0a3341b8c09182374618239019283').valid).toBe(true); // 40-char SHA-1
        expect(validateSha('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855').valid).toBe(true); // 64-char SHA-256
        expect(validateSha('invalid-sha-xyz').valid).toBe(false);
        expect(validateSha('12345').valid).toBe(false); // too short (<7)
        expect(validateSha('').valid).toBe(false);
      });
    });

    describe('Stateless CAS Execution & Publication Invariants', () => {
      it('should succeed when remote head matches expectedOldSha exactly', () => {
        const req: CASMergeRequest = {
          ref: 'refs/heads/main',
          expectedOldSha: '5c030af',
          newSha: '8f4a21e',
          committer: 'nate',
          signatureVerified: true
        };

        const result = executeCasMerge('5c030af', req);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.newHeadSha).toBe('8f4a21e');
          expect(result.ref).toBe('refs/heads/main');
          expect(result.transactionId).toMatch(/^tx_/);
        }
      });

      it('should atomically reject CAS when remote ref has moved (requiring rebase)', () => {
        const req: CASMergeRequest = {
          ref: 'refs/heads/main',
          expectedOldSha: '5c030af',
          newSha: '8f4a21e',
          committer: 'nate',
          signatureVerified: true
        };

        const result = executeCasMerge('diverged999', req);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('CAS atomic rejection');
          expect(result.currentRemoteHeadSha).toBe('diverged999');
          expect(result.retryable).toBe(true);
          expect(result.stale).toBe(true);
        }
      });

      it('should allow initial ref creation when expectedOldSha is null or zero-sha', () => {
        const req: CASMergeRequest = {
          ref: 'refs/features/new-feature',
          expectedOldSha: null,
          newSha: '9912aab',
          committer: 'nate'
        };

        const result = executeCasMerge(null, req);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.oldSha).toBeNull();
          expect(result.newHeadSha).toBe('9912aab');
        }
      });

      it('should reject initial creation if the ref already exists on remote', () => {
        const req: CASMergeRequest = {
          ref: 'refs/heads/main',
          expectedOldSha: null,
          newSha: '9912aab',
          committer: 'nate'
        };

        const result = executeCasMerge('5c030af', req);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('already exists');
        }
      });

      it('should enforce branch protection rules: requireSignedCommit', () => {
        const policy: BranchProtectionPolicy = {
          protectedPrefixes: ['refs/heads/main'],
          requireSignedCommit: true
        };

        const unsignedReq: CASMergeRequest = {
          ref: 'refs/heads/main',
          expectedOldSha: '5c030af',
          newSha: '8f4a21e',
          committer: 'nate',
          signatureVerified: false
        };

        const result = executeCasMerge('5c030af', unsignedReq, policy);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('requires a verified cryptographic signature');
        }

        const signedReq: CASMergeRequest = {
          ...unsignedReq,
          signatureVerified: true
        };

        const signedResult = executeCasMerge('5c030af', signedReq, policy);
        expect(signedResult.success).toBe(true);
      });

      it('should enforce branch protection rules: requirePassingTests evidence', () => {
        const policy: BranchProtectionPolicy = {
          protectedPrefixes: ['refs/heads/main'],
          requirePassingTests: true
        };

        const failedTestReq: CASMergeRequest = {
          ref: 'refs/heads/main',
          expectedOldSha: '5c030af',
          newSha: '8f4a21e',
          committer: 'nate',
          signatureVerified: true,
          testEvidence: { passed: false, testCount: 14 }
        };

        const failRes = executeCasMerge('5c030af', failedTestReq, policy);
        expect(failRes.success).toBe(false);
        if (!failRes.success) {
          expect(failRes.error).toContain('requires passing test evidence');
        }

        const passingTestReq: CASMergeRequest = {
          ...failedTestReq,
          testEvidence: { passed: true, testCount: 14, durationMs: 41 }
        };

        const passRes = executeCasMerge('5c030af', passingTestReq, policy);
        expect(passRes.success).toBe(true);
      });
    });

    describe('Stateful GitsmithCasEngine & Reflog Tracking', () => {
      it('should record complete reflogs with committers, timestamps, and transaction IDs', () => {
        const mergeReq: CASMergeRequest = {
          ref: 'refs/heads/main',
          expectedOldSha: '5c030af',
          newSha: '8f4a21e',
          committer: 'nate',
          signatureVerified: true
        };

        const res = casEngine.updateRef(mergeReq);
        expect(res.success).toBe(true);

        const refRecord = casEngine.getRef('refs/heads/main');
        expect(refRecord).toBeDefined();
        expect(refRecord?.sha).toBe('8f4a21e');
        expect(refRecord?.reflog.length).toBe(2);

        const latestLog = refRecord?.reflog[1];
        expect(latestLog?.oldSha).toBe('5c030af');
        expect(latestLog?.newSha).toBe('8f4a21e');
        expect(latestLog?.committer).toBe('nate');
        expect(latestLog?.signatureVerified).toBe(true);
      });

      it('should list refs filtered by prefix namespace', () => {
        casEngine.setRef('refs/tags/v1.0.0', '5c030af');
        casEngine.setRef('refs/tags/v2.0.0', '8f4a21e');

        const headRefs = casEngine.listRefs('refs/heads/');
        expect(headRefs.length).toBe(1);
        expect(headRefs[0].ref).toBe('refs/heads/main');

        const tagRefs = casEngine.listRefs('refs/tags/');
        expect(tagRefs.length).toBe(2);
      });

      it('should support atomic batch ref updates (all-or-nothing rollback on conflict)', () => {
        const batchReqs: CASMergeRequest[] = [
          {
            ref: 'refs/heads/main',
            expectedOldSha: '5c030af',
            newSha: '8f4a21e',
            committer: 'nate'
          },
          {
            ref: 'refs/features/receipt-ocr/v1.2.0',
            expectedOldSha: 'diverged_stale_sha', // will fail CAS
            newSha: '4e10bc9',
            committer: 'sam'
          }
        ];

        const batchRes = casEngine.batchUpdateRefs(batchReqs);
        expect(batchRes.success).toBe(false);
        expect(batchRes.error).toContain('Batch CAS Transaction aborted');

        // Verify that refs/heads/main was NOT modified (atomic rollback)
        expect(casEngine.getRef('refs/heads/main')?.sha).toBe('5c030af');
        expect(casEngine.getRef('refs/features/receipt-ocr/v1.2.0')?.sha).toBe('1109a2b');
      });

      it('should commit all refs in batch update when all CAS checks succeed', () => {
        const batchReqs: CASMergeRequest[] = [
          {
            ref: 'refs/heads/main',
            expectedOldSha: '5c030af',
            newSha: '8f4a21e',
            committer: 'nate'
          },
          {
            ref: 'refs/features/receipt-ocr/v1.2.0',
            expectedOldSha: '1109a2b',
            newSha: '4e10bc9',
            committer: 'sam'
          }
        ];

        const batchRes = casEngine.batchUpdateRefs(batchReqs);
        expect(batchRes.success).toBe(true);
        expect(casEngine.getRef('refs/heads/main')?.sha).toBe('8f4a21e');
        expect(casEngine.getRef('refs/features/receipt-ocr/v1.2.0')?.sha).toBe('4e10bc9');
      });

      it('should support safe ref deletion with CAS check', () => {
        const delRes = casEngine.deleteRef('refs/features/receipt-ocr/v1.2.0', '1109a2b');
        expect(delRes.success).toBe(true);
        expect(casEngine.getRef('refs/features/receipt-ocr/v1.2.0')).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // 2. MULTI-GENERATIONAL LINEAGE LEDGER SETTLEMENT ENGINE
  // ==========================================================================
  describe('2. Multi-Generational Lineage Ledger Settlement Engine (70/20/10)', () => {
    it('should split $25.00 purchase into exact 70% ($17.50), 20% ($5.00), and 10% ($2.50)', () => {
      const split = calculateLineageSplits(2500, 1);
      expect(split.grossCents).toBe(2500);
      expect(split.makerCents).toBe(1750); // $17.50
      expect(split.lineageTotalCents).toBe(500); // $5.00
      expect(split.poolCents).toBe(250); // $2.50
      expect(split.conservationVerified).toBe(true);
      expect(split.makerCents + split.lineageTotalCents + split.poolCents).toBe(2500);
    });

    it('should strictly conserve cents across non-divisible amounts (e.g. $10.00 split across 3 ancestors)', () => {
      // $10.00 = 1000 cents. 20% lineage = 200 cents. 200 / 3 = 66.666 cents.
      // Integer cent split must give 67, 67, 66 cents totaling exactly 200 cents!
      const split = calculateLineageSplits(1000, 3, { distributionMethod: 'equal' });
      expect(split.lineageTotalCents).toBe(200);
      expect(split.ancestorSplits.map(a => a.cents)).toEqual([67, 67, 66]);
      expect(split.ancestorSplits.reduce((sum, a) => sum + a.cents, 0)).toBe(200);
      expect(split.makerCents + split.lineageTotalCents + split.poolCents).toBe(1000);
      expect(split.conservationVerified).toBe(true);
    });

    it('should calculate generational decay weights with Hare-Niemeyer conservation', () => {
      const ancestors: AncestorNode[] = [
        { appId: 'wallart-v2.3', creatorId: 'usr_josh', depth: 1, weight: 8 },
        { appId: 'wallart-v2.0', creatorId: 'usr_sam', depth: 2, weight: 4 },
        { appId: 'wallart-v1.0', creatorId: 'usr_nate', depth: 3, weight: 2 },
        { appId: 'wallart-alpha', creatorId: 'usr_root', depth: 4, weight: 1 }
      ];

      const split = calculateLineageSplits(10000, ancestors, { distributionMethod: 'decay' });
      expect(split.lineageTotalCents).toBe(2000); // $20.00
      expect(split.ancestorSplits.length).toBe(4);

      // Verify descending shares based on generational distance
      expect(split.ancestorSplits[0].cents).toBeGreaterThan(split.ancestorSplits[1].cents);
      expect(split.ancestorSplits[1].cents).toBeGreaterThan(split.ancestorSplits[2].cents);
      expect(split.ancestorSplits[2].cents).toBeGreaterThan(split.ancestorSplits[3].cents);

      // Verify total conservation
      const ancestorSum = split.ancestorSplits.reduce((sum, a) => sum + a.cents, 0);
      expect(ancestorSum).toBe(2000);
      expect(split.makerCents + ancestorSum + split.poolCents).toBe(10000);
      expect(split.conservationVerified).toBe(true);
    });

    it('should handle genesis root apps with zero upstream ancestors', () => {
      const split = calculateLineageSplits(5000, 0);
      expect(split.grossCents).toBe(5000);
      expect(split.makerCents).toBe(3500); // 70%
      expect(split.lineageTotalCents).toBe(0);
      expect(split.poolCents).toBe(1500); // Remaining 30%
      expect(split.ancestorSplits).toEqual([]);
      expect(split.conservationVerified).toBe(true);
    });

    it('should reallocate orphan lineage share to maker when configured', () => {
      const split = calculateLineageSplits(5000, 0, { reallocateOrphanLineageToMaker: true });
      expect(split.makerCents).toBe(4500); // 70% + 20% = 90%
      expect(split.poolCents).toBe(500); // 10%
      expect(split.conservationVerified).toBe(true);
    });

    it('should handle zero or negative gross cents safely', () => {
      const splitZero = calculateLineageSplits(0, 2);
      expect(splitZero.grossCents).toBe(0);
      expect(splitZero.makerCents).toBe(0);
      expect(splitZero.lineageTotalCents).toBe(0);

      const splitNegative = calculateLineageSplits(-1500, 2);
      expect(splitNegative.grossCents).toBe(0);
      expect(splitNegative.conservationVerified).toBe(true);
    });

    it('should create complete auditable settlement records with atomic ledger entries', () => {
      const record = createSettlementRecord({
        appId: 'wallart',
        buyerUserId: 'usr_buyer_99',
        makerId: 'usr_nate',
        grossCents: 2500,
        ancestors: [
          { appId: 'canvas-core', creatorId: 'usr_josh', depth: 1 },
          { appId: 'tiff-render', creatorId: 'usr_sam', depth: 2 }
        ],
        casTransactionId: 'tx_cas_12345'
      });

      expect(record.id).toMatch(/^set_/);
      expect(record.stripeTransferId).toMatch(/^tr_/);
      expect(record.casTransactionId).toBe('tx_cas_12345');
      expect(record.ledgerEntries.length).toBe(4); // 1 maker + 2 ancestors + 1 protocol pool

      // Verify ledger conservation
      const ledgerTotal = record.ledgerEntries.reduce((sum, e) => sum + e.cents, 0);
      expect(ledgerTotal).toBe(2500);
    });

    it('should maintain backwards compatibility with computeRoyaltySplit', () => {
      const legacySplit = computeRoyaltySplit(2500, 2);
      expect(legacySplit.grossCents).toBe(2500);
      expect(legacySplit.makerCents).toBe(1750);
      expect(legacySplit.lineageTotalCents).toBe(500);
      expect(legacySplit.ancestorSplits).toEqual([250, 250]);
    });
  });

  // ==========================================================================
  // 3. ED25519 / SSH COMMIT SIGNATURE VERIFICATION VALIDATOR
  // ==========================================================================
  describe('3. Ed25519 / SSH Commit Signature Verification Validator', () => {
    let testKeyPair: ReturnType<typeof generateEd25519KeyPair>;

    beforeEach(() => {
      testKeyPair = generateEd25519KeyPair('nate@macmini');
    });

    it('should generate valid Ed25519 keypair and standard OpenSSH public key string', () => {
      expect(testKeyPair.publicKeySsh).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5/);
      expect(testKeyPair.publicKeySsh).toContain('nate@macmini');
      expect(testKeyPair.rawPublicKeyHex.length).toBe(64); // 32 bytes hex
      expect(testKeyPair.fingerprint).toMatch(/^SHA256:/);
    });

    it('should parse OpenSSH formatted Ed25519 public key and extract raw bytes', () => {
      const parsed = parseSshPublicKey(testKeyPair.publicKeySsh);
      expect(parsed.type).toBe('ssh-ed25519');
      expect(parsed.rawPublicKey.length).toBe(32);
      expect(Buffer.from(parsed.rawPublicKey).toString('hex')).toBe(testKeyPair.rawPublicKeyHex);
      expect(parsed.comment).toBe('nate@macmini');
      expect(parsed.fingerprint).toBe(testKeyPair.fingerprint);
    });

    it('should reject invalid or malformed SSH public keys', () => {
      expect(() => parseSshPublicKey('ssh-rsa AAAAB3NzaC1yc2E...')).toThrow(/ssh-ed25519/i);
      expect(() => parseSshPublicKey('invalid_single_string')).toThrow(/invalid ssh public key format/i);
      expect(() => parseSshPublicKey('')).toThrow(/cannot be empty/i);
    });

    it('should sign and verify commit payloads using raw Ed25519 signatures', () => {
      const commitPayload = 'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nauthor Nate <nate@macmini> 1724600000 +0000\ncommitter Nate <nate@macmini> 1724600000 +0000\n\nfeat: atomic merge engine';
      
      const sig = signCommitPayload(commitPayload, testKeyPair.privateKeyObj);
      expect(sig.signatureHex.length).toBe(128); // 64 bytes hex

      const verified = verifyEd25519(commitPayload, sig.signatureHex, testKeyPair.publicKeySsh);
      expect(verified).toBe(true);

      const verifiedWithHex = verifyEd25519(commitPayload, sig.signatureRaw, testKeyPair.rawPublicKeyHex);
      expect(verifiedWithHex).toBe(true);
    });

    it('should sign and verify OpenSSH SSHSIG armored signatures', () => {
      const commitPayload = 'tree d8329f2100a8b4ff\nparent 5c030af\nauthor Sam <sam@openai> 1724600000 -0400\n\nPR #14: Spliced OCR Receipt Scanner';
      
      const rawPub = Buffer.from(testKeyPair.rawPublicKeyHex, 'hex');
      const sig = signCommitPayload(commitPayload, testKeyPair.privateKeyObj, rawPub);
      expect(sig.sshSigArmor).toContain('-----BEGIN SSH SIGNATURE-----');
      expect(sig.sshSigArmor).toContain('-----END SSH SIGNATURE-----');

      const verified = verifyEd25519(commitPayload, sig.sshSigArmor, testKeyPair.publicKeySsh);
      expect(verified).toBe(true);
    });

    it('should reject tampered commit payloads or invalid signatures', () => {
      const commitPayload = 'valid commit message';
      const sig = signCommitPayload(commitPayload, testKeyPair.privateKeyObj);

      const tamperedPayload = 'tampered commit message';
      const verifiedTampered = verifyEd25519(tamperedPayload, sig.signatureHex, testKeyPair.publicKeySsh);
      expect(verifiedTampered).toBe(false);

      // Test with a different keypair
      const otherKey = generateEd25519KeyPair('other@host');
      const verifiedOtherKey = verifyEd25519(commitPayload, sig.signatureHex, otherKey.publicKeySsh);
      expect(verifiedOtherKey).toBe(false);
    });

    it('should validate commit signatures with verifyCommitSignature helper', () => {
      const commitPayload = 'commit payload data';
      const sig = signCommitPayload(commitPayload, testKeyPair.privateKeyObj);

      const validResult = verifyCommitSignature({
        commitPayload,
        signature: sig.signatureBase64,
        publicKey: testKeyPair.publicKeySsh,
        committer: 'nate'
      });

      expect(validResult.valid).toBe(true);
      expect(validResult.keyType).toBe('ssh-ed25519');
      expect(validResult.committer).toBe('nate');
      expect(validResult.fingerprint).toBe(testKeyPair.fingerprint);

      const invalidResult = verifyCommitSignature({
        commitPayload: 'altered data',
        signature: sig.signatureBase64,
        publicKey: testKeyPair.publicKeySsh,
        committer: 'nate'
      });

      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toContain('verification failed');
    });

    it('should extract payload, tree, parents, author, committer, and signature from raw Git commit objects', () => {
      const rawGitCommit = [
        'tree 7bb2e8b5d38a0f622e03290fb49eb56fa1e5d321',
        'parent 5c030afb1234567890abcdef1234567890abcdef',
        'author Nate McGuire <nate@macmini> 1724600000 -0400',
        'committer Nate McGuire <nate@macmini> 1724600000 -0400',
        'gpgsig-ssh -----BEGIN SSH SIGNATURE-----',
        ' U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAg...',
        ' -----END SSH SIGNATURE-----',
        '',
        'feat(gitsmith): implement atomic CAS publication boundary',
        '',
        'This completes the multi-generational lineage engine.'
      ].join('\n');

      const extracted = extractCommitSignature(rawGitCommit);
      expect(extracted.tree).toBe('7bb2e8b5d38a0f622e03290fb49eb56fa1e5d321');
      expect(extracted.parents).toEqual(['5c030afb1234567890abcdef1234567890abcdef']);
      expect(extracted.author).toBe('Nate McGuire <nate@macmini> 1724600000 -0400');
      expect(extracted.committer).toBe('Nate McGuire <nate@macmini> 1724600000 -0400');
      expect(extracted.signatureArmor).toContain('-----BEGIN SSH SIGNATURE-----');
      expect(extracted.message).toContain('feat(gitsmith): implement atomic CAS publication boundary');
    });
  });

  // ==========================================================================
  // 4. IMMUTABLE LINEAGE DAG GRAPH BUILDER
  // ==========================================================================
  describe('4. Immutable Lineage DAG Graph Builder', () => {
    let sampleNodes: LineageNode[];
    let dagEngine: LineageDagEngine;

    beforeEach(() => {
      sampleNodes = [
        {
          id: 'root-canvas',
          name: 'Canvas Core',
          creatorId: 'usr_root',
          parentIds: [],
          version: 'v1.0.0',
          commitSha: '1000001',
          priceCents: 0
        },
        {
          id: 'wallart-v1',
          name: 'WallArt Canvas Pro Genesis',
          creatorId: 'usr_nate',
          parentIds: ['root-canvas'],
          version: 'v1.0.0',
          commitSha: '2000002',
          priceCents: 2000
        },
        {
          id: 'wallart-triptych',
          name: 'WallArt Multi-Panel Triptych',
          creatorId: 'usr_sam',
          parentIds: ['wallart-v1'],
          version: 'v2.0.0',
          commitSha: '3000003',
          priceCents: 2500
        },
        {
          id: 'wallart-gpu-segment',
          name: 'WallArt GPU Matting Studio',
          creatorId: 'usr_josh',
          parentIds: ['wallart-triptych'],
          version: 'v2.4.0',
          commitSha: '4000004',
          priceCents: 3000
        },
        {
          id: 'wallart-print-tiff',
          name: 'WallArt 300 DPI TIFF Export',
          creatorId: 'usr_nate',
          parentIds: ['wallart-v1'],
          version: 'v1.5.0',
          commitSha: '5000005',
          priceCents: 2200
        },
        {
          id: 'wallart-ultimate',
          name: 'WallArt Ultimate Local-First Suite (Diamond Merge)',
          creatorId: 'usr_nate',
          parentIds: ['wallart-gpu-segment', 'wallart-print-tiff'], // Diamond merge from 2 forks
          version: 'v3.0.0',
          commitSha: '6000006',
          priceCents: 3500
        }
      ];

      dagEngine = new LineageDagEngine(sampleNodes);
    });

    it('should build the DAG and verify that the graph is acyclic', () => {
      const cycleCheck = dagEngine.detectCycles();
      expect(cycleCheck.hasCycle).toBe(false);
      expect(dagEngine.getAllNodes().length).toBe(6);
    });

    it('should detect cycles and report cycle paths if a circular dependency is introduced', () => {
      const cyclicDag = new LineageDagEngine([
        { id: 'node-A', name: 'A', creatorId: 'usr_1', parentIds: ['node-C'], version: 'v1', commitSha: '111' },
        { id: 'node-B', name: 'B', creatorId: 'usr_1', parentIds: ['node-A'], version: 'v1', commitSha: '222' },
        { id: 'node-C', name: 'C', creatorId: 'usr_1', parentIds: ['node-B'], version: 'v1', commitSha: '333' }
      ]);

      const cycleCheck = cyclicDag.detectCycles();
      expect(cycleCheck.hasCycle).toBe(true);
      expect(cycleCheck.cyclePath).toBeDefined();
      expect(cycleCheck.cyclePath?.length).toBeGreaterThanOrEqual(3);
    });

    it('should traverse upward ancestry to root makers with accurate generational depth', () => {
      const ancestors = dagEngine.getAncestors('wallart-gpu-segment');
      expect(ancestors.length).toBe(3);

      expect(ancestors[0].node.id).toBe('wallart-triptych');
      expect(ancestors[0].depth).toBe(1); // Immediate parent

      expect(ancestors[1].node.id).toBe('wallart-v1');
      expect(ancestors[1].depth).toBe(2); // Grandparent

      expect(ancestors[2].node.id).toBe('root-canvas');
      expect(ancestors[2].depth).toBe(3); // Great-grandparent
    });

    it('should traverse diamond merge ancestry without duplicate nodes', () => {
      const ancestors = dagEngine.getAncestors('wallart-ultimate');
      const ancestorIds = ancestors.map(a => a.node.id);
      
      // Ensure all upstream nodes are included
      expect(ancestorIds).toContain('wallart-gpu-segment');
      expect(ancestorIds).toContain('wallart-print-tiff');
      expect(ancestorIds).toContain('wallart-triptych');
      expect(ancestorIds).toContain('wallart-v1');
      expect(ancestorIds).toContain('root-canvas');

      // Ensure no duplicates exist
      const uniqueIds = new Set(ancestorIds);
      expect(uniqueIds.size).toBe(ancestorIds.length);
    });

    it('should traverse downstream descendants from root down to leaf forks', () => {
      const descendants = dagEngine.getDescendants('root-canvas');
      expect(descendants.length).toBe(5);

      const descIds = descendants.map(d => d.node.id);
      expect(descIds).toContain('wallart-v1');
      expect(descIds).toContain('wallart-triptych');
      expect(descIds).toContain('wallart-gpu-segment');
      expect(descIds).toContain('wallart-ultimate');
    });

    it('should accurately resolve root maker genesis nodes', () => {
      const roots = dagEngine.getRootMakers('wallart-ultimate');
      expect(roots.length).toBe(1);
      expect(roots[0].id).toBe('root-canvas');
      expect(roots[0].creatorId).toBe('usr_root');
    });

    it('should generate formatted ancestor royalty chain for settlement engine', () => {
      const chain = dagEngine.calculateAncestorRoyaltyChain('wallart-gpu-segment');
      expect(chain).toEqual([
        { appId: 'wallart-triptych', creatorId: 'usr_sam', depth: 1, version: 'v2.0.0' },
        { appId: 'wallart-v1', creatorId: 'usr_nate', depth: 2, version: 'v1.0.0' },
        { appId: 'root-canvas', creatorId: 'usr_root', depth: 3, version: 'v1.0.0' }
      ]);

      // Feed chain directly into settlement engine
      const settlement = calculateLineageSplits(3000, chain, { distributionMethod: 'decay' });
      expect(settlement.lineageTotalCents).toBe(600); // 20% of 3000
      expect(settlement.conservationVerified).toBe(true);
      expect(settlement.ancestorSplits[0].creatorId).toBe('usr_sam');
    });

    it('should export Mermaid diagram visualization markdown', () => {
      const mermaid = dagEngine.exportMermaid('wallart-gpu-segment');
      expect(mermaid).toContain('```mermaid');
      expect(mermaid).toContain('graph TD');
      expect(mermaid).toContain('wallart_gpu_segment');
      expect(mermaid).toContain('-->|fork|');
    });

    it('should serialize to JSON and deserialize cleanly via fromJson', () => {
      const json = dagEngine.exportJson();
      const restoredDag = LineageDagEngine.fromJson(json);
      expect(restoredDag.getAllNodes().length).toBe(dagEngine.getAllNodes().length);
      expect(restoredDag.getAncestors('wallart-gpu-segment').length).toBe(3);
    });
  });

  // ==========================================================================
  // 5. API ENDPOINT INTEGRATION (functions/api/git.ts)
  // ==========================================================================
  describe('5. Git Forge & Lineage Ledger API Endpoints', () => {
    let mockDbRows: any[] = [];
    let mockEnv: any;

    beforeEach(() => {
      mockDbRows = [];
      mockEnv = {
        DB: {
          prepare: (sql: string) => ({
            bind: (...params: any[]) => ({
              run: async () => {
                if (sql.includes('INSERT INTO royalty_settlements')) {
                  mockDbRows.push({
                    id: params[0],
                    app_id: params[1],
                    buyer_user_id: params[2],
                    gross_cents: params[3],
                    maker_cents: params[4],
                    lineage_cents: params[5],
                    pool_cents: params[6],
                    stripe_transfer_id: params[7],
                    settled_at: new Date().toISOString()
                  });
                }
                return { success: true };
              },
              all: async () => {
                if (sql.includes('WHERE app_id = ?')) {
                  return { results: mockDbRows.filter(r => r.app_id === params[0]) };
                }
                return { results: mockDbRows };
              }
            }),
            all: async () => ({ results: mockDbRows })
          })
        }
      };
    });

    it('POST /api/git should refuse to impersonate the authoritative Git CAS gateway', async () => {
      const payload = { action: 'cas', repositoryId: 'wallart' };

      const request = new Request('https://nates.software/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(501);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('GITSMITH gateway');
    });

    it('POST /api/git should return 400 Bad Request if required parameters are missing', async () => {
      const request = new Request('https://nates.software/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'wallart' }) // Missing ref and newSha
      });

      const response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Supported control-plane action');
    });

    it('POST /api/git should not accept caller-selected signature policy as ref authorization', async () => {
      const keyPair = generateEd25519KeyPair('sam@openai');
      const newSha = '4e10bc9812f0a3341b8c09182374618239019283';
      const ref = 'refs/features/receipt-ocr/v1.2.0';
      const committer = 'sam';
      const payloadText = `${newSha} ${ref} ${committer}`;

      const sig = signCommitPayload(payloadText, keyPair.privateKeyObj);

      const request = new Request('https://nates.software/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ref-update',
          repositoryId: 'retro-calc',
          ref,
          expectedOldSha: '5c030af',
          newSha,
          committer,
          signature: sig.signatureHex,
          publicKey: keyPair.publicKeySsh,
          commitPayload: payloadText,
          requireSignedCommit: true
        })
      });

      const response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(501);
      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('GITSMITH gateway');
    });

    it('GET /api/git should declare the control-plane authority boundary', async () => {
      const request = new Request('https://nates.software/api/git', { method: 'GET' });
      const response = await onRequestGet({ request, env: mockEnv });
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('gateway_required');
      expect(json.authority.gitGateway).toContain('authoritative ref');
      expect(json.authority.d1).toContain('immutable lineage');
    });
  });
});
