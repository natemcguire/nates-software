// GITSMITH Bare Git Forge & Lineage Ledger Backend Engine
// High-integrity Atomic CAS Engine, 70/20/10 Lineage Royalty Settlement,
// Ed25519 / SSH Commit Signature Validator, and Immutable Lineage DAG Graph Builder.

import crypto from 'node:crypto';

// ============================================================================
// 1. TYPES & INTERFACES
// ============================================================================

export interface CASMergeRequest {
  readonly ref: string;
  readonly expectedOldSha: string | null;
  readonly newSha: string;
  readonly committer: string;
  readonly signatureVerified?: boolean;
  readonly signature?: string;
  readonly publicKey?: string;
  readonly commitPayload?: string;
  readonly testEvidence?: {
    readonly passed: boolean;
    readonly testCount: number;
    readonly durationMs?: number;
    readonly digest?: string;
  };
}

export interface BranchProtectionPolicy {
  readonly protectedPrefixes?: readonly string[];
  readonly requireSignedCommit?: boolean;
  readonly requirePassingTests?: boolean;
  readonly allowForcePush?: boolean;
  readonly allowRefDeletion?: boolean;
}

export interface ReflogEntry {
  readonly oldSha: string | null;
  readonly newSha: string;
  readonly committer: string;
  readonly timestamp: number;
  readonly action: string;
  readonly signatureVerified: boolean;
  readonly transactionId: string;
}

export interface RefRecord {
  readonly ref: string;
  readonly sha: string;
  readonly updatedAt: number;
  readonly committer: string;
  readonly signatureVerified: boolean;
  readonly reflog: readonly ReflogEntry[];
}

export type CASMergeResult =
  | {
      readonly success: true;
      readonly ref: string;
      readonly oldSha: string | null;
      readonly newHeadSha: string;
      readonly transactionId: string;
      readonly message: string;
    }
  | {
      readonly success: false;
      readonly ref: string;
      readonly error: string;
      readonly currentRemoteHeadSha: string | null;
      readonly retryable: boolean;
      readonly stale?: boolean;
    };

export interface BatchRefUpdateResult {
  readonly success: boolean;
  readonly transactionId: string;
  readonly results: readonly CASMergeResult[];
  readonly error?: string;
}

// ----------------------------------------------------------------------------
// Lineage Ledger Settlement Types
// ----------------------------------------------------------------------------

export interface AncestorNode {
  readonly appId: string;
  readonly creatorId: string;
  readonly depth: number; // 1 = direct parent, 2 = grandparent, etc.
  readonly weight?: number;
  readonly version?: string;
}

export interface AncestorSplit {
  readonly appId: string;
  readonly creatorId: string;
  readonly depth: number;
  readonly cents: number;
  readonly percentShare: number;
}

export interface SettlementSplit {
  readonly grossCents: number;
  readonly makerCents: number;
  readonly makerPercent: number;
  readonly lineageTotalCents: number;
  readonly lineagePercent: number;
  readonly poolCents: number;
  readonly poolPercent: number;
  readonly ancestorSplits: readonly AncestorSplit[];
  readonly conservationVerified: boolean;
}

export interface LineageLedgerEntry {
  readonly recipientId: string;
  readonly recipientType: 'maker' | 'ancestor' | 'protocol_pool';
  readonly appId?: string;
  readonly cents: number;
  readonly depth?: number;
}

export interface LineageSettlementRecord {
  readonly id: string;
  readonly appId: string;
  readonly buyerUserId: string;
  readonly makerId: string;
  readonly grossCents: number;
  readonly split: SettlementSplit;
  readonly stripeTransferId: string;
  readonly casTransactionId?: string;
  readonly settledAt: string;
  readonly ledgerEntries: readonly LineageLedgerEntry[];
}

export interface LineageSplitOptions {
  readonly distributionMethod?: 'equal' | 'decay' | 'custom';
  readonly makerPercent?: number; // default 70
  readonly lineagePercent?: number; // default 20
  readonly poolPercent?: number; // default 10
  readonly reallocateOrphanLineageToMaker?: boolean;
}

// ----------------------------------------------------------------------------
// Ed25519 & SSH Signature Types
// ----------------------------------------------------------------------------

export interface ParsedSshPublicKey {
  readonly type: 'ssh-ed25519';
  readonly rawPublicKey: Uint8Array;
  readonly comment: string;
  readonly fingerprint: string; // SHA256 base64 fingerprint
}

export interface SignatureValidationResult {
  readonly valid: boolean;
  readonly keyType: 'ssh-ed25519' | 'ed25519-raw' | 'unknown';
  readonly fingerprint?: string;
  readonly committer?: string;
  readonly error?: string;
}

// ----------------------------------------------------------------------------
// Lineage DAG Types
// ----------------------------------------------------------------------------

export interface LineageNode {
  readonly id: string; // App ID or fork slug
  readonly name: string;
  readonly creatorId: string;
  readonly parentIds: readonly string[];
  readonly version: string;
  readonly commitSha: string;
  readonly moddabilityScore?: number;
  readonly priceCents?: number;
  readonly license?: string;
  readonly createdAt?: string;
}

export interface LineageEdge {
  readonly source: string; // Parent ID
  readonly target: string; // Child ID
  readonly type: 'fork' | 'merge' | 'patch';
}

// ============================================================================
// 2. ATOMIC CAS MERGE VERIFICATION ENGINE
// ============================================================================

const DEFAULT_PROTECTED_BRANCHES: readonly string[] = [
  'refs/heads/main',
  'refs/heads/master',
  'refs/heads/production',
  'refs/heads/release'
];

/**
 * Validates git reference naming rules (RFC / Git reference specifications).
 */
export function validateGitRef(ref: string): { valid: boolean; error?: string; namespace?: string } {
  if (!ref || typeof ref !== 'string') {
    return { valid: false, error: 'Ref path must be a non-empty string.' };
  }

  const trimmed = ref.trim();
  if (!trimmed.startsWith('refs/')) {
    return { valid: false, error: 'Invalid ref path; must start with "refs/".' };
  }

  if (trimmed.endsWith('/') || trimmed.endsWith('.lock')) {
    return { valid: false, error: 'Ref path cannot end with "/" or ".lock".' };
  }

  if (trimmed.includes('//') || trimmed.includes('..')) {
    return { valid: false, error: 'Ref path cannot contain consecutive slashes or "..".' };
  }

  // Check for forbidden characters in git refs: ~ ^ : ? * [ \ whitespace control chars
  if (/[\x00-\x20\x7F~^:?*\[\\@]/.test(trimmed) || trimmed.includes('@{')) {
    return { valid: false, error: 'Ref path contains illegal Git reference characters.' };
  }

  const parts = trimmed.split('/');
  if (parts.length < 3 || parts.some(p => p.length === 0)) {
    return { valid: false, error: 'Ref path must specify a valid namespace and name (e.g. refs/heads/main, refs/features/xyz).' };
  }

  const namespace = `${parts[0]}/${parts[1]}`;
  return { valid: true, namespace };
}

/**
 * Validates commit SHA-1 or SHA-256 hex string format.
 */
export function validateSha(sha: string | null | undefined): { valid: boolean; error?: string } {
  if (!sha || typeof sha !== 'string') {
    return { valid: false, error: 'Commit SHA must be a non-empty string.' };
  }

  const trimmed = sha.trim().toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(trimmed)) {
    return { valid: false, error: 'Invalid commit SHA format; must be 7 to 64 hexadecimal characters.' };
  }

  return { valid: true };
}

/**
 * Checks whether a given ref is covered by a branch protection policy.
 */
export function isRefProtected(ref: string, policy?: BranchProtectionPolicy): boolean {
  const protectedPrefixes = policy?.protectedPrefixes ?? DEFAULT_PROTECTED_BRANCHES;
  return protectedPrefixes.some(prefix => ref === prefix || ref.startsWith(`${prefix}/`));
}

/**
 * Executes a stateless atomic CAS merge verification check.
 */
export function executeCasMerge(
  currentRemoteHeadSha: string | null | undefined,
  request: CASMergeRequest,
  policy?: BranchProtectionPolicy
): CASMergeResult {
  // 1. Validate ref
  const refValidation = validateGitRef(request.ref);
  if (!refValidation.valid) {
    return {
      success: false,
      ref: request.ref,
      error: refValidation.error || 'Invalid ref path.',
      currentRemoteHeadSha: currentRemoteHeadSha ?? null,
      retryable: false
    };
  }

  // 2. Validate newSha
  const newShaValidation = validateSha(request.newSha);
  if (!newShaValidation.valid) {
    return {
      success: false,
      ref: request.ref,
      error: newShaValidation.error || 'Invalid new commit SHA.',
      currentRemoteHeadSha: currentRemoteHeadSha ?? null,
      retryable: false
    };
  }

  const normalizedCurrentSha = currentRemoteHeadSha ? currentRemoteHeadSha.trim().toLowerCase() : null;
  const isInitialCreation = request.expectedOldSha === null ||
    request.expectedOldSha === '' ||
    request.expectedOldSha === '0000000000000000000000000000000000000000';

  // 3. CAS Check
  if (isInitialCreation) {
    if (normalizedCurrentSha !== null) {
      return {
        success: false,
        ref: request.ref,
        error: `CAS rejection: Ref ${request.ref} already exists at ${normalizedCurrentSha}. Initial creation rejected.`,
        currentRemoteHeadSha: normalizedCurrentSha,
        retryable: true,
        stale: true
      };
    }
  } else {
    const normalizedExpectedSha = request.expectedOldSha!.trim().toLowerCase();
    if (normalizedCurrentSha !== normalizedExpectedSha) {
      return {
        success: false,
        ref: request.ref,
        error: `CAS atomic rejection: remote ${request.ref} has moved to ${normalizedCurrentSha ?? 'null'}. Expected base was ${normalizedExpectedSha}. Rebase required before push.`,
        currentRemoteHeadSha: normalizedCurrentSha,
        retryable: true,
        stale: true
      };
    }
  }

  // 4. Branch Protection Policies
  const isProtected = isRefProtected(request.ref, policy);
  if (isProtected) {
    if (policy?.requireSignedCommit && !request.signatureVerified) {
      return {
        success: false,
        ref: request.ref,
        error: `CAS policy rejection: Protected ref ${request.ref} requires a verified cryptographic signature.`,
        currentRemoteHeadSha: normalizedCurrentSha,
        retryable: false
      };
    }

    if (policy?.requirePassingTests && request.testEvidence) {
      if (!request.testEvidence.passed) {
        return {
          success: false,
          ref: request.ref,
          error: `CAS policy rejection: Protected ref ${request.ref} requires passing test evidence. Test suite reported failure.`,
          currentRemoteHeadSha: normalizedCurrentSha,
          retryable: false
        };
      }
    }
  }

  const txId = `tx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  return {
    success: true,
    ref: request.ref,
    oldSha: normalizedCurrentSha,
    newHeadSha: request.newSha.trim().toLowerCase(),
    transactionId: txId,
    message: `Ref ${request.ref} successfully advanced to ${request.newSha.trim().toLowerCase()} via atomic CAS.`
  };
}

/**
 * Stateful In-Memory Forge CAS Engine with Atomic Transactions & Reflogs.
 */
export class GitsmithCasEngine {
  private readonly refs = new Map<string, RefRecord>();
  private readonly policy: BranchProtectionPolicy;

  constructor(policy?: BranchProtectionPolicy) {
    this.policy = policy ?? {
      protectedPrefixes: DEFAULT_PROTECTED_BRANCHES,
      requireSignedCommit: false,
      requirePassingTests: false,
      allowForcePush: false,
      allowRefDeletion: false
    };
  }

  public getRef(ref: string): RefRecord | undefined {
    return this.refs.get(ref);
  }

  public setRef(ref: string, sha: string, committer: string = 'system', signatureVerified: boolean = false): void {
    const existing = this.refs.get(ref);
    const txId = `tx_init_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const logEntry: ReflogEntry = {
      oldSha: existing ? existing.sha : null,
      newSha: sha,
      committer,
      timestamp: Date.now(),
      action: existing ? 'update' : 'create',
      signatureVerified,
      transactionId: txId
    };

    const updatedLog = existing ? [...existing.reflog, logEntry] : [logEntry];
    this.refs.set(ref, {
      ref,
      sha,
      updatedAt: Date.now(),
      committer,
      signatureVerified,
      reflog: updatedLog
    });
  }

  public listRefs(prefix?: string): RefRecord[] {
    const all = Array.from(this.refs.values());
    if (!prefix) return all;
    return all.filter(r => r.ref.startsWith(prefix));
  }

  public updateRef(request: CASMergeRequest, customPolicy?: BranchProtectionPolicy): CASMergeResult {
    const activePolicy = customPolicy ?? this.policy;
    const current = this.refs.get(request.ref);
    const currentSha = current ? current.sha : null;

    const result = executeCasMerge(currentSha, request, activePolicy);
    if (result.success) {
      const logEntry: ReflogEntry = {
        oldSha: currentSha,
        newSha: result.newHeadSha,
        committer: request.committer,
        timestamp: Date.now(),
        action: currentSha ? 'update' : 'create',
        signatureVerified: !!request.signatureVerified,
        transactionId: result.transactionId
      };

      const updatedLog = current ? [...current.reflog, logEntry] : [logEntry];
      this.refs.set(request.ref, {
        ref: request.ref,
        sha: result.newHeadSha,
        updatedAt: Date.now(),
        committer: request.committer,
        signatureVerified: !!request.signatureVerified,
        reflog: updatedLog
      });
    }

    return result;
  }

  /**
   * Atomic All-or-Nothing Multi-Ref Transaction Update.
   */
  public batchUpdateRefs(
    requests: readonly CASMergeRequest[],
    customPolicy?: BranchProtectionPolicy
  ): BatchRefUpdateResult {
    const activePolicy = customPolicy ?? this.policy;
    const txId = `tx_batch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const plannedUpdates: Array<{ request: CASMergeRequest; casResult: CASMergeResult }> = [];

    // Phase 1: Dry-run verification of all CAS operations
    for (const req of requests) {
      const current = this.refs.get(req.ref);
      const currentSha = current ? current.sha : null;
      const res = executeCasMerge(currentSha, req, activePolicy);

      if (!res.success) {
        return {
          success: false,
          transactionId: txId,
          results: plannedUpdates.map(p => p.casResult).concat([res]),
          error: `Batch CAS Transaction aborted: Ref ${req.ref} failed CAS check (${res.error}). No refs were changed.`
        };
      }

      plannedUpdates.push({ request: req, casResult: res });
    }

    // Phase 2: Commit all updates atomically
    const appliedResults: CASMergeResult[] = [];
    for (const { request, casResult } of plannedUpdates) {
      if (casResult.success) {
        const current = this.refs.get(request.ref);
        const currentSha = current ? current.sha : null;
        const logEntry: ReflogEntry = {
          oldSha: currentSha,
          newSha: casResult.newHeadSha,
          committer: request.committer,
          timestamp: Date.now(),
          action: 'batch_update',
          signatureVerified: !!request.signatureVerified,
          transactionId: txId
        };

        const updatedLog = current ? [...current.reflog, logEntry] : [logEntry];
        this.refs.set(request.ref, {
          ref: request.ref,
          sha: casResult.newHeadSha,
          updatedAt: Date.now(),
          committer: request.committer,
          signatureVerified: !!request.signatureVerified,
          reflog: updatedLog
        });
        appliedResults.push(casResult);
      }
    }

    return {
      success: true,
      transactionId: txId,
      results: appliedResults
    };
  }

  public deleteRef(ref: string, expectedOldSha: string): CASMergeResult {
    const current = this.refs.get(ref);
    if (!current) {
      return {
        success: false,
        ref,
        error: `Ref ${ref} does not exist.`,
        currentRemoteHeadSha: null,
        retryable: false
      };
    }

    if (current.sha !== expectedOldSha.trim().toLowerCase()) {
      return {
        success: false,
        ref,
        error: `CAS rejection on delete: Ref ${ref} current SHA is ${current.sha}, expected ${expectedOldSha}.`,
        currentRemoteHeadSha: current.sha,
        retryable: true,
        stale: true
      };
    }

    if (isRefProtected(ref, this.policy) && !this.policy.allowRefDeletion) {
      return {
        success: false,
        ref,
        error: `Protected ref ${ref} cannot be deleted.`,
        currentRemoteHeadSha: current.sha,
        retryable: false
      };
    }

    this.refs.delete(ref);
    return {
      success: true,
      ref,
      oldSha: current.sha,
      newHeadSha: '0000000000000000000000000000000000000000',
      transactionId: `tx_del_${Date.now()}`,
      message: `Ref ${ref} deleted successfully.`
    };
  }

  public getReflog(ref: string): readonly ReflogEntry[] {
    return this.refs.get(ref)?.reflog ?? [];
  }

  public reset(): void {
    this.refs.clear();
  }
}

// ============================================================================
// 3. MULTI-GENERATIONAL LINEAGE LEDGER SETTLEMENT ENGINE
// ============================================================================

/**
 * Calculates multi-generational 70% Maker / 20% Lineage Ancestor Chain / 10% Protocol Pool split.
 * Strictly guarantees total cents conservation: Maker + Ancestors + Pool === Gross Cents.
 */
export function calculateLineageSplits(
  grossCents: number,
  ancestorsInput: readonly AncestorNode[] | number = 1,
  options?: LineageSplitOptions
): SettlementSplit {
  if (!Number.isFinite(grossCents) || grossCents <= 0) {
    return {
      grossCents: 0,
      makerCents: 0,
      makerPercent: options?.makerPercent ?? 70,
      lineageTotalCents: 0,
      lineagePercent: options?.lineagePercent ?? 20,
      poolCents: 0,
      poolPercent: options?.poolPercent ?? 10,
      ancestorSplits: [],
      conservationVerified: true
    };
  }

  const gross = Math.floor(grossCents);
  const makerPct = options?.makerPercent ?? 70;
  const lineagePct = options?.lineagePercent ?? 20;
  const poolPct = options?.poolPercent ?? 10;

  // Convert input into AncestorNode array
  const ancestors: AncestorNode[] = typeof ancestorsInput === 'number'
    ? Array.from({ length: Math.max(0, ancestorsInput) }, (_, i) => ({
        appId: `ancestor_app_${i + 1}`,
        creatorId: `usr_ancestor_${i + 1}`,
        depth: i + 1
      }))
    : [...ancestorsInput];

  const ancestorCount = ancestors.length;

  let baseMakerCents = Math.round((gross * makerPct) / 100);
  let baseLineageCents = Math.round((gross * lineagePct) / 100);

  // If no ancestors exist (root genesis app)
  if (ancestorCount === 0) {
    if (options?.reallocateOrphanLineageToMaker) {
      baseMakerCents += baseLineageCents;
    }
    const finalPoolCents = gross - baseMakerCents;
    return {
      grossCents: gross,
      makerCents: baseMakerCents,
      makerPercent: makerPct,
      lineageTotalCents: 0,
      lineagePercent: lineagePct,
      poolCents: finalPoolCents,
      poolPercent: poolPct,
      ancestorSplits: [],
      conservationVerified: baseMakerCents + finalPoolCents === gross
    };
  }

  const method = options?.distributionMethod ?? 'equal';
  const allocatedCents: number[] = new Array(ancestorCount).fill(0);

  if (method === 'equal') {
    const baseShare = Math.floor(baseLineageCents / ancestorCount);
    const remainder = baseLineageCents % ancestorCount;

    for (let i = 0; i < ancestorCount; i++) {
      // Distribute remainder cents to closest ancestors (lower depth)
      allocatedCents[i] = baseShare + (i < remainder ? 1 : 0);
    }
  } else {
    // Generational decay or weighted distribution using Hare-Niemeyer (Largest Remainder Method)
    const rawWeights = ancestors.map((a, i) => a.weight ?? (1 / Math.pow(2, i)));
    const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);

    const quotas = rawWeights.map(w => (w / totalWeight) * baseLineageCents);
    const baseFloors = quotas.map(q => Math.floor(q));
    const remainders = quotas.map((q, idx) => ({ index: idx, remainder: q - baseFloors[idx], depth: ancestors[idx].depth }));

    let currentSum = baseFloors.reduce((sum, v) => sum + v, 0);
    const missingCents = baseLineageCents - currentSum;

    // Sort by largest remainder descending, breaking ties by lower depth (closest ancestor)
    remainders.sort((a, b) => {
      if (Math.abs(b.remainder - a.remainder) > 1e-9) {
        return b.remainder - a.remainder;
      }
      return a.depth - b.depth;
    });

    for (let i = 0; i < ancestorCount; i++) {
      allocatedCents[i] = baseFloors[i];
    }

    for (let i = 0; i < missingCents; i++) {
      allocatedCents[remainders[i % ancestorCount].index] += 1;
    }
  }

  const actualLineageSum = allocatedCents.reduce((sum, c) => sum + c, 0);
  const finalPoolCents = gross - baseMakerCents - actualLineageSum;

  const ancestorSplits: AncestorSplit[] = ancestors.map((a, i) => ({
    appId: a.appId,
    creatorId: a.creatorId,
    depth: a.depth,
    cents: allocatedCents[i],
    percentShare: gross > 0 ? Number(((allocatedCents[i] / gross) * 100).toFixed(4)) : 0
  }));

  const totalCalculated = baseMakerCents + actualLineageSum + finalPoolCents;
  const conservationVerified = totalCalculated === gross;

  return {
    grossCents: gross,
    makerCents: baseMakerCents,
    makerPercent: makerPct,
    lineageTotalCents: actualLineageSum,
    lineagePercent: lineagePct,
    poolCents: finalPoolCents,
    poolPercent: poolPct,
    ancestorSplits,
    conservationVerified
  };
}

/**
 * Creates a fully auditable Lineage Settlement Record with atomic ledger entries.
 */
export function createSettlementRecord(params: {
  readonly appId: string;
  readonly buyerUserId: string;
  readonly makerId: string;
  readonly grossCents: number;
  readonly ancestors?: readonly AncestorNode[] | number;
  readonly stripeTransferId?: string;
  readonly casTransactionId?: string;
  readonly options?: LineageSplitOptions;
}): LineageSettlementRecord {
  const split = calculateLineageSplits(params.grossCents, params.ancestors, params.options);
  const settlementId = `set_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const stripeId = params.stripeTransferId ?? `tr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const ledgerEntries: LineageLedgerEntry[] = [
    {
      recipientId: params.makerId,
      recipientType: 'maker',
      appId: params.appId,
      cents: split.makerCents
    }
  ];

  for (const a of split.ancestorSplits) {
    ledgerEntries.push({
      recipientId: a.creatorId,
      recipientType: 'ancestor',
      appId: a.appId,
      cents: a.cents,
      depth: a.depth
    });
  }

  ledgerEntries.push({
    recipientId: 'protocol_pool',
    recipientType: 'protocol_pool',
    cents: split.poolCents
  });

  return {
    id: settlementId,
    appId: params.appId,
    buyerUserId: params.buyerUserId,
    makerId: params.makerId,
    grossCents: split.grossCents,
    split,
    stripeTransferId: stripeId,
    casTransactionId: params.casTransactionId,
    settledAt: new Date().toISOString(),
    ledgerEntries
  };
}

/**
 * Backward compatibility wrapper for existing tests.
 */
export function computeRoyaltySplit(grossCents: number, ancestorCount: number = 1) {
  const res = calculateLineageSplits(grossCents, ancestorCount, { distributionMethod: 'equal' });
  return {
    grossCents: res.grossCents,
    makerCents: res.makerCents,
    lineageTotalCents: res.lineageTotalCents,
    poolCents: res.poolCents,
    ancestorSplits: res.ancestorSplits.map(a => a.cents)
  };
}

// ============================================================================
// 4. ED25519 / SSH COMMIT SIGNATURE VERIFICATION VALIDATOR
// ============================================================================

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Formats a raw 32-byte Ed25519 public key into standard OpenSSH format.
 */
export function formatSshPublicKey(rawPublicKey: Uint8Array | Buffer, comment: string = 'git@gitsmith'): string {
  const rawBuf = Buffer.isBuffer(rawPublicKey) ? rawPublicKey : Buffer.from(rawPublicKey);
  if (rawBuf.length !== 32) {
    throw new Error(`Invalid raw Ed25519 public key length: expected 32 bytes, got ${rawBuf.length}`);
  }

  const typeStr = Buffer.from('ssh-ed25519');
  const typeLen = Buffer.alloc(4);
  typeLen.writeUInt32BE(typeStr.length);

  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(rawBuf.length);

  const fullBuf = Buffer.concat([typeLen, typeStr, keyLen, rawBuf]);
  return `ssh-ed25519 ${fullBuf.toString('base64')} ${comment}`.trim();
}

/**
 * Calculates SHA256 base64 fingerprint for an SSH public key.
 */
export function computeSshFingerprint(rawPublicKey: Uint8Array | Buffer): string {
  const rawBuf = Buffer.isBuffer(rawPublicKey) ? rawPublicKey : Buffer.from(rawPublicKey);
  const typeStr = Buffer.from('ssh-ed25519');
  const typeLen = Buffer.alloc(4);
  typeLen.writeUInt32BE(typeStr.length);

  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(rawBuf.length);

  const blob = Buffer.concat([typeLen, typeStr, keyLen, rawBuf]);
  const hash = crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
  return `SHA256:${hash}`;
}

/**
 * Parses OpenSSH formatted Ed25519 public key.
 */
export function parseSshPublicKey(sshKeyString: string): ParsedSshPublicKey {
  if (!sshKeyString || typeof sshKeyString !== 'string') {
    throw new Error('SSH public key string cannot be empty.');
  }

  const parts = sshKeyString.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error('Invalid SSH public key format: expected "ssh-ed25519 <base64> [comment]".');
  }

  const keyType = parts[0];
  if (keyType !== 'ssh-ed25519') {
    if (keyType.startsWith('ssh-')) {
      throw new Error(`Unsupported SSH key type: ${keyType}. Only ssh-ed25519 is supported.`);
    }
    throw new Error(`Invalid SSH public key format: unexpected prefix "${keyType}". Expected "ssh-ed25519".`);
  }

  const base64Data = parts[1];
  const comment = parts.slice(2).join(' ');
  const buf = Buffer.from(base64Data, 'base64');

  if (buf.length < 19) {
    throw new Error('Invalid SSH public key binary payload: too short.');
  }

  let offset = 0;
  const typeLen = buf.readUInt32BE(offset);
  offset += 4;

  if (offset + typeLen > buf.length) {
    throw new Error('Malformed SSH key type string in binary payload.');
  }

  const decodedType = buf.subarray(offset, offset + typeLen).toString('utf8');
  offset += typeLen;

  if (decodedType !== 'ssh-ed25519') {
    throw new Error(`Mismatched key type inside binary payload: expected ssh-ed25519, got ${decodedType}`);
  }

  const keyLen = buf.readUInt32BE(offset);
  offset += 4;

  if (offset + keyLen > buf.length || keyLen !== 32) {
    throw new Error(`Invalid Ed25519 public key length: expected 32 bytes, got ${keyLen}`);
  }

  const rawPublicKey = buf.subarray(offset, offset + keyLen);
  const fingerprint = computeSshFingerprint(rawPublicKey);

  return {
    type: 'ssh-ed25519',
    rawPublicKey: new Uint8Array(rawPublicKey),
    comment,
    fingerprint
  };
}

/**
 * Extracts raw 32-byte Ed25519 public key from SSH key, hex string, base64, or Uint8Array.
 */
export function normalizePublicKey(publicKey: Uint8Array | Buffer | string): { rawBytes: Buffer; fingerprint: string } {
  if (typeof publicKey === 'string') {
    const trimmed = publicKey.trim();
    if (trimmed.startsWith('ssh-ed25519')) {
      const parsed = parseSshPublicKey(trimmed);
      const raw = Buffer.from(parsed.rawPublicKey);
      return { rawBytes: raw, fingerprint: parsed.fingerprint };
    }

    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const raw = Buffer.from(trimmed, 'hex');
      return { rawBytes: raw, fingerprint: computeSshFingerprint(raw) };
    }

    if (/^[A-Za-z0-9+/]{43,44}={0,2}$/.test(trimmed)) {
      const raw = Buffer.from(trimmed, 'base64');
      if (raw.length === 32) {
        return { rawBytes: raw, fingerprint: computeSshFingerprint(raw) };
      }
    }

    throw new Error('Unrecognized public key format. Expected ssh-ed25519 string, 64-hex chars, or 32-byte base64.');
  }

  const raw = Buffer.isBuffer(publicKey) ? publicKey : Buffer.from(publicKey);
  if (raw.length !== 32) {
    throw new Error(`Invalid raw Ed25519 public key byte length: expected 32, got ${raw.length}`);
  }

  return { rawBytes: raw, fingerprint: computeSshFingerprint(raw) };
}

/**
 * Normalizes signature buffer from raw bytes, hex, base64, or OpenSSH SSHSIG armor.
 */
export function normalizeSignature(signature: Uint8Array | Buffer | string): Buffer {
  if (typeof signature === 'string') {
    const trimmed = signature.trim();

    // Check OpenSSH SSHSIG armor block
    if (trimmed.includes('-----BEGIN SSH SIGNATURE-----')) {
      const clean = trimmed
        .replace(/-----BEGIN SSH SIGNATURE-----/g, '')
        .replace(/-----END SSH SIGNATURE-----/g, '')
        .replace(/\s+/g, '');
      const buf = Buffer.from(clean, 'base64');
      if (buf.subarray(0, 6).toString('utf8') !== 'SSHSIG') {
        throw new Error('Invalid SSHSIG armor: missing SSHSIG magic header.');
      }

      let offset = 6;
      offset += 4; // version

      // pubkey blob
      const pkLen = buf.readUInt32BE(offset);
      offset += 4 + pkLen;

      // namespace
      const nsLen = buf.readUInt32BE(offset);
      offset += 4 + nsLen;

      // reserved
      const resLen = buf.readUInt32BE(offset);
      offset += 4 + resLen;

      // hash algo
      const hashAlgoLen = buf.readUInt32BE(offset);
      offset += 4 + hashAlgoLen;

      // hash
      const hashLen = buf.readUInt32BE(offset);
      offset += 4 + hashLen;

      // sig blob
      offset += 4; // sig blob total len
      const sTypeLen = buf.readUInt32BE(offset);
      offset += 4 + sTypeLen;
      const sLen = buf.readUInt32BE(offset);
      offset += 4;

      const rawSig = buf.subarray(offset, offset + sLen);
      if (rawSig.length !== 64) {
        throw new Error(`Invalid signature length extracted from SSHSIG armor: ${rawSig.length}`);
      }
      return Buffer.from(rawSig);
    }

    if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }

    if (/^[A-Za-z0-9+/]{86,88}={0,2}$/.test(trimmed)) {
      const raw = Buffer.from(trimmed, 'base64');
      if (raw.length === 64) {
        return raw;
      }
    }

    throw new Error('Unrecognized signature format. Expected SSHSIG armor, 128-hex chars, or 64-byte base64.');
  }

  const raw = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
  if (raw.length !== 64) {
    throw new Error(`Invalid raw Ed25519 signature byte length: expected 64, got ${raw.length}`);
  }
  return raw;
}

/**
 * Creates OpenSSH SSHSIG armor from raw signature, public key, and payload.
 */
export function createSshSigArmor(
  rawSignature: Uint8Array | Buffer,
  rawPublicKey: Uint8Array | Buffer,
  payload: Uint8Array | Buffer | string,
  namespace: string = 'git',
  hashAlgo: string = 'sha512'
): string {
  const sigBuf = Buffer.isBuffer(rawSignature) ? rawSignature : Buffer.from(rawSignature);
  const pubBuf = Buffer.isBuffer(rawPublicKey) ? rawPublicKey : Buffer.from(rawPublicKey);
  const dataBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);

  const hash = crypto.createHash(hashAlgo).update(dataBuf).digest();

  const typeStr = Buffer.from('ssh-ed25519');
  const typeLen = Buffer.alloc(4);
  typeLen.writeUInt32BE(typeStr.length);

  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(pubBuf.length);

  const pubKeyBlob = Buffer.concat([typeLen, typeStr, keyLen, pubBuf]);
  const pubKeyBlobLen = Buffer.alloc(4);
  pubKeyBlobLen.writeUInt32BE(pubKeyBlob.length);

  const nsBuf = Buffer.from(namespace);
  const nsLen = Buffer.alloc(4);
  nsLen.writeUInt32BE(nsBuf.length);

  const resLen = Buffer.alloc(4);
  resLen.writeUInt32BE(0);

  const algoBuf = Buffer.from(hashAlgo);
  const algoLen = Buffer.alloc(4);
  algoLen.writeUInt32BE(algoBuf.length);

  const hashBufLen = Buffer.alloc(4);
  hashBufLen.writeUInt32BE(hash.length);

  const sigTypeLen = Buffer.alloc(4);
  sigTypeLen.writeUInt32BE(typeStr.length);
  const sigBytesLen = Buffer.alloc(4);
  sigBytesLen.writeUInt32BE(sigBuf.length);

  const sigInnerBlob = Buffer.concat([sigTypeLen, typeStr, sigBytesLen, sigBuf]);
  const sigBlobLen = Buffer.alloc(4);
  sigBlobLen.writeUInt32BE(sigInnerBlob.length);

  const magic = Buffer.from('SSHSIG');
  const version = Buffer.alloc(4);
  version.writeUInt32BE(1);

  const sshsigBuf = Buffer.concat([
    magic,
    version,
    pubKeyBlobLen,
    pubKeyBlob,
    nsLen,
    nsBuf,
    resLen,
    algoLen,
    algoBuf,
    hashBufLen,
    hash,
    sigBlobLen,
    sigInnerBlob
  ]);

  return `-----BEGIN SSH SIGNATURE-----\n${sshsigBuf.toString('base64')}\n-----END SSH SIGNATURE-----`;
}

/**
 * Verifies an Ed25519 signature over data using Node crypto SPKI DER import.
 */
export function verifyEd25519(
  data: Uint8Array | Buffer | string,
  signature: Uint8Array | Buffer | string,
  publicKey: Uint8Array | Buffer | string
): boolean {
  try {
    const dataBuf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const { rawBytes: pubKeyRaw } = normalizePublicKey(publicKey);
    const sigBuf = normalizeSignature(signature);

    const spkiBuf = Buffer.concat([ED25519_SPKI_PREFIX, pubKeyRaw]);
    const pubKeyObj = crypto.createPublicKey({ key: spkiBuf, format: 'der', type: 'spki' });

    return crypto.verify(null, dataBuf, pubKeyObj, sigBuf);
  } catch {
    return false;
  }
}

/**
 * Generates an Ed25519 keypair for test suites and maker identities.
 */
export function generateEd25519KeyPair(comment: string = 'nate@macmini') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = spkiDer.subarray(spkiDer.length - 32);

  const rawPubHex = rawPub.toString('hex');
  const rawPubBase64 = rawPub.toString('base64');
  const publicKeySsh = formatSshPublicKey(rawPub, comment);

  const pkcs8Der = privateKey.export({ type: 'pkcs8', format: 'der' });
  const rawPriv = pkcs8Der.subarray(pkcs8Der.length - 32);
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  return {
    publicKeySsh,
    rawPublicKeyHex: rawPubHex,
    rawPublicKeyBase64: rawPubBase64,
    privateKeyPem,
    privateKeyRawHex: rawPriv.toString('hex'),
    publicKeyObj: publicKey,
    privateKeyObj: privateKey,
    fingerprint: computeSshFingerprint(rawPub)
  };
}

/**
 * Signs data payload with an Ed25519 private key.
 */
export function signCommitPayload(
  payload: Uint8Array | Buffer | string,
  privateKey: crypto.KeyObject | string,
  rawPublicKey?: Uint8Array | Buffer
) {
  const dataBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
  let privKeyObj: crypto.KeyObject;

  if (typeof privateKey === 'string') {
    if (privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      privKeyObj = crypto.createPrivateKey({ key: privateKey, format: 'pem' });
    } else if (/^[0-9a-fA-F]{64}$/.test(privateKey.trim())) {
      const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
      const pkcs8Buf = Buffer.concat([pkcs8Prefix, Buffer.from(privateKey.trim(), 'hex')]);
      privKeyObj = crypto.createPrivateKey({ key: pkcs8Buf, format: 'der', type: 'pkcs8' });
    } else {
      throw new Error('Invalid private key format.');
    }
  } else {
    privKeyObj = privateKey;
  }

  const rawSig = crypto.sign(null, dataBuf, privKeyObj);
  const sigHex = rawSig.toString('hex');
  const sigBase64 = rawSig.toString('base64');

  let sshSigArmor = '';
  if (rawPublicKey) {
    sshSigArmor = createSshSigArmor(rawSig, rawPublicKey, dataBuf);
  }

  return {
    signatureHex: sigHex,
    signatureBase64: sigBase64,
    signatureRaw: new Uint8Array(rawSig),
    sshSigArmor
  };
}

/**
 * Validates a commit signature with committer identity validation.
 */
export function verifyCommitSignature(params: {
  readonly commitPayload: string | Uint8Array;
  readonly signature: string | Uint8Array;
  readonly publicKey: string | Uint8Array;
  readonly committer?: string;
}): SignatureValidationResult {
  try {
    const { rawBytes, fingerprint } = normalizePublicKey(params.publicKey);
    const keyType = typeof params.publicKey === 'string' && params.publicKey.startsWith('ssh-ed25519')
      ? 'ssh-ed25519'
      : 'ed25519-raw';

    const valid = verifyEd25519(params.commitPayload, params.signature, rawBytes);

    if (!valid) {
      return {
        valid: false,
        keyType,
        fingerprint,
        error: 'Cryptographic signature verification failed: signature does not match payload and public key.'
      };
    }

    return {
      valid: true,
      keyType,
      fingerprint,
      committer: params.committer
    };
  } catch (err: any) {
    return {
      valid: false,
      keyType: 'unknown',
      error: err.message || 'Failed to process commit signature validation.'
    };
  }
}

/**
 * Extracts payload, headers, and signature from a raw Git commit object.
 */
export function extractCommitSignature(rawCommitObject: string): {
  readonly payload: string;
  readonly signatureArmor?: string;
  readonly tree?: string;
  readonly parents: readonly string[];
  readonly author?: string;
  readonly committer?: string;
  readonly message: string;
} {
  const lines = rawCommitObject.split('\n');
  const payloadLines: string[] = [];
  const sigLines: string[] = [];
  const parents: string[] = [];
  let tree = '';
  let author = '';
  let committer = '';
  let inSig = false;
  let inBody = false;
  const bodyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inBody) {
      bodyLines.push(line);
      payloadLines.push(line);
      continue;
    }

    if (line === '') {
      inBody = true;
      payloadLines.push(line);
      continue;
    }

    if (line.startsWith('gpgsig ') || line.startsWith('gpgsig-ssh ')) {
      inSig = true;
      sigLines.push(line.replace(/^gpgsig(-ssh)? /, ''));
      continue;
    }

    if (inSig) {
      if (line.startsWith(' ')) {
        sigLines.push(line.substring(1));
        continue;
      } else {
        inSig = false;
      }
    }

    if (line.startsWith('tree ')) {
      tree = line.substring(5).trim();
    } else if (line.startsWith('parent ')) {
      parents.push(line.substring(7).trim());
    } else if (line.startsWith('author ')) {
      author = line.substring(7).trim();
    } else if (line.startsWith('committer ')) {
      committer = line.substring(10).trim();
    }

    payloadLines.push(line);
  }

  const payload = payloadLines.join('\n');
  const signatureArmor = sigLines.length > 0 ? sigLines.join('\n') : undefined;
  const message = bodyLines.join('\n');

  return {
    payload,
    signatureArmor,
    tree,
    parents,
    author,
    committer,
    message
  };
}

// ============================================================================
// 5. IMMUTABLE LINEAGE DAG GRAPH BUILDER
// ============================================================================

export class LineageDagEngine {
  private readonly nodes = new Map<string, LineageNode>();
  private readonly childrenMap = new Map<string, Set<string>>(); // parentId -> childIds
  private readonly parentsMap = new Map<string, Set<string>>(); // childId -> parentIds

  constructor(initialNodes?: readonly LineageNode[]) {
    if (initialNodes) {
      this.addNodes(initialNodes);
    }
  }

  public addNode(node: LineageNode): void {
    this.nodes.set(node.id, node);

    if (!this.childrenMap.has(node.id)) {
      this.childrenMap.set(node.id, new Set());
    }
    if (!this.parentsMap.has(node.id)) {
      this.parentsMap.set(node.id, new Set());
    }

    for (const parentId of node.parentIds) {
      this.addEdge(parentId, node.id);
    }
  }

  public addNodes(nodes: readonly LineageNode[]): void {
    for (const n of nodes) {
      this.addNode(n);
    }
  }

  public addEdge(parentId: string, childId: string): void {
    if (!this.childrenMap.has(parentId)) {
      this.childrenMap.set(parentId, new Set());
    }
    this.childrenMap.get(parentId)!.add(childId);

    if (!this.parentsMap.has(childId)) {
      this.parentsMap.set(childId, new Set());
    }
    this.parentsMap.get(childId)!.add(parentId);
  }

  public getNode(id: string): LineageNode | undefined {
    return this.nodes.get(id);
  }

  public getAllNodes(): LineageNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Cycle detection using Tarjan / DFS with 3-color marking.
   */
  public detectCycles(): { hasCycle: boolean; cyclePath?: string[] } {
    const visited = new Map<string, 'white' | 'gray' | 'black'>();
    for (const id of this.nodes.keys()) {
      visited.set(id, 'white');
    }

    const currentPath: string[] = [];

    const dfs = (nodeId: string): boolean => {
      visited.set(nodeId, 'gray');
      currentPath.push(nodeId);

      const children = this.childrenMap.get(nodeId) || new Set();
      for (const childId of children) {
        const state = visited.get(childId) || 'white';
        if (state === 'gray') {
          currentPath.push(childId);
          return true; // Cycle detected
        }
        if (state === 'white') {
          if (dfs(childId)) return true;
        }
      }

      visited.set(nodeId, 'black');
      currentPath.pop();
      return false;
    };

    for (const id of this.nodes.keys()) {
      if (visited.get(id) === 'white') {
        if (dfs(id)) {
          return { hasCycle: true, cyclePath: [...currentPath] };
        }
      }
    }

    return { hasCycle: false };
  }

  /**
   * Traverses ancestry upwards from a child fork up to root makers.
   * Returns list of ancestor nodes ordered by generational depth.
   */
  public getAncestors(nodeId: string, maxDepth: number = 20): Array<{ node: LineageNode; depth: number }> {
    const results: Array<{ node: LineageNode; depth: number }> = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [];

    const immediateParents = this.parentsMap.get(nodeId) || new Set();
    for (const pId of immediateParents) {
      queue.push({ id: pId, depth: 1 });
      visited.add(pId);
    }

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth > maxDepth) continue;

      const node = this.nodes.get(id);
      if (node) {
        results.push({ node, depth });
      }

      const grandparents = this.parentsMap.get(id) || new Set();
      for (const gpId of grandparents) {
        if (!visited.has(gpId)) {
          visited.add(gpId);
          queue.push({ id: gpId, depth: depth + 1 });
        }
      }
    }

    return results.sort((a, b) => a.depth - b.depth);
  }

  /**
   * Traverses downstream forks from root down to Nth child.
   */
  public getDescendants(nodeId: string, maxDepth: number = 20): Array<{ node: LineageNode; depth: number }> {
    const results: Array<{ node: LineageNode; depth: number }> = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [];

    const immediateChildren = this.childrenMap.get(nodeId) || new Set();
    for (const cId of immediateChildren) {
      queue.push({ id: cId, depth: 1 });
      visited.add(cId);
    }

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth > maxDepth) continue;

      const node = this.nodes.get(id);
      if (node) {
        results.push({ node, depth });
      }

      const grandchildren = this.childrenMap.get(id) || new Set();
      for (const gcId of grandchildren) {
        if (!visited.has(gcId)) {
          visited.add(gcId);
          queue.push({ id: gcId, depth: depth + 1 });
        }
      }
    }

    return results.sort((a, b) => a.depth - b.depth);
  }

  /**
   * Finds the genesis root maker node(s) for a given fork.
   */
  public getRootMakers(nodeId: string): LineageNode[] {
    const ancestors = this.getAncestors(nodeId);
    if (ancestors.length === 0) {
      const current = this.nodes.get(nodeId);
      return current ? [current] : [];
    }

    const roots = ancestors.filter(a => {
      const parents = this.parentsMap.get(a.node.id);
      return !parents || parents.size === 0;
    });

    return roots.map(r => r.node);
  }

  /**
   * Formats ancestor chain for multi-generational royalty calculations.
   */
  public calculateAncestorRoyaltyChain(nodeId: string, maxDepth: number = 10): AncestorNode[] {
    const ancestors = this.getAncestors(nodeId, maxDepth);
    return ancestors.map(a => ({
      appId: a.node.id,
      creatorId: a.node.creatorId,
      depth: a.depth,
      version: a.node.version
    }));
  }

  /**
   * Exports the DAG as a clean GitHub-Flavored Mermaid diagram.
   */
  public exportMermaid(startNodeId?: string, title: string = 'GITSMITH Lineage DAG'): string {
    const lines: string[] = ['```mermaid', 'graph TD'];
    lines.push(`  %% ${title}`);

    const nodeSet = startNodeId
      ? new Set([
          startNodeId,
          ...this.getAncestors(startNodeId).map(a => a.node.id),
          ...this.getDescendants(startNodeId).map(d => d.node.id)
        ])
      : new Set(this.nodes.keys());

    for (const id of nodeSet) {
      const node = this.nodes.get(id);
      if (node) {
        const label = `"${node.name} (${node.version})<br/>@${node.creatorId}"`;
        lines.push(`  ${id.replace(/[^a-zA-Z0-9_]/g, '_')}[${label}]`);
      }
    }

    for (const [parentId, children] of this.childrenMap.entries()) {
      if (!nodeSet.has(parentId)) continue;
      const cleanParent = parentId.replace(/[^a-zA-Z0-9_]/g, '_');

      for (const childId of children) {
        if (!nodeSet.has(childId)) continue;
        const cleanChild = childId.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`  ${cleanParent} -->|fork| ${cleanChild}`);
      }
    }

    lines.push('```');
    return lines.join('\n');
  }

  public exportJson(): string {
    return JSON.stringify(Array.from(this.nodes.values()), null, 2);
  }

  public static fromJson(json: string): LineageDagEngine {
    const nodes: LineageNode[] = JSON.parse(json);
    return new LineageDagEngine(nodes);
  }
}
