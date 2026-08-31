// Production Domain Logic for Durable Marketplace Commerce
// Implements deterministic allocation calculation, strict money/currency validation,
// and ancestry DAG lineage resolution for Nate's Software Lineage Ledger.

export const COMMERCE_BASIS_POINTS = {
  TOTAL: 10000,
  ROOT_MAKER: 9000,
  ROOT_PROTOCOL_POOL: 1000,
  FORK_MAKER: 7000,
  FORK_LINEAGE_TOTAL: 2000,
  FORK_PROTOCOL_POOL: 1000,
} as const;

export const MAKER_FLOOR_BPS = 1000;

export const DEFAULT_LINEAGE_POLICY = 'maker_70_lineage_20_pool_10' as const;

export type AllocationRole = 'maker' | 'ancestor' | 'protocol_pool' | 'contributor';

export class CommerceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommerceValidationError';
  }
}

export interface AncestorInput {
  repositoryId?: string | null;
  userId: string;
  depth?: number;
}

export interface AncestorNode {
  repositoryId: string | null;
  userId: string;
  depth: number;
}

export interface OrderAllocationSnapshot {
  sequence: number;
  role: AllocationRole;
  recipientUserId: string | null;
  sourceRepositoryId: string | null;
  lineageDepth: number | null;
  basisPoints: number;
  amountCents: number;
}

export interface AllocationCalculationInput {
  grossCents: number;
  currency: string;
  sellerUserId: string;
  repositoryId?: string | null;
  ancestors?: readonly AncestorInput[] | null;
}

export interface LineageSnapshotPayload {
  snapshottedAt: string;
  lineagePolicy: string;
  isRoot: boolean;
  grossCents: number;
  currency: string;
  sellerUserId: string;
  repositoryId: string | null;
  makerCents: number;
  makerBasisPoints: number;
  lineageTotalCents: number;
  lineageTotalBasisPoints: number;
  protocolPoolCents: number;
  protocolPoolBasisPoints: number;
  ancestorCount: number;
  ancestorAllocations: ReadonlyArray<{
    sequence: number;
    repositoryId: string | null;
    userId: string;
    depth: number;
    amountCents: number;
    basisPoints: number;
  }>;
  allocations: readonly OrderAllocationSnapshot[];
  conservationVerified: boolean;
}

export interface AllocationCalculationResult {
  isRoot: boolean;
  lineagePolicy: string;
  grossCents: number;
  currency: string;
  makerCents: number;
  makerBasisPoints: number;
  lineageTotalCents: number;
  lineageTotalBasisPoints: number;
  protocolPoolCents: number;
  protocolPoolBasisPoints: number;
  allocations: OrderAllocationSnapshot[];
  snapshot: LineageSnapshotPayload;
  snapshotJson: string;
  conservationVerified: boolean;
}

/**
 * Validates that gross cents is a strictly positive safe integer.
 */
export function validateGrossCents(grossCents: unknown): number {
  if (typeof grossCents !== 'number' || !Number.isFinite(grossCents) || !Number.isSafeInteger(grossCents) || grossCents <= 0) {
    throw new CommerceValidationError(`Gross cents must be a strictly positive safe integer, received: ${grossCents}`);
  }
  return grossCents;
}

/**
 * Validates that currency is a 3-letter lowercase string (e.g., 'usd').
 */
export function validateCurrency(currency: unknown): string {
  if (typeof currency !== 'string' || !/^[a-z]{3}$/.test(currency)) {
    throw new CommerceValidationError(`Currency must be a 3-letter lowercase string (e.g. 'usd'), received: ${JSON.stringify(currency)}`);
  }
  return currency;
}

/**
 * Validates seller user ID format.
 */
export function validateSellerUserId(sellerUserId: unknown): string {
  if (typeof sellerUserId !== 'string' || !sellerUserId.trim()) {
    throw new CommerceValidationError('sellerUserId is required and must be a non-empty string');
  }
  return sellerUserId.trim();
}

/**
 * Validates and sanitizes ancestor input list.
 * Enforces cycle detection, duplicate rejection, identity validity, and ordering invariants.
 */
export function validateAncestors(
  ancestors: unknown,
  _sellerUserId?: string,
  repositoryId?: string | null
): AncestorNode[] {
  if (ancestors === null || ancestors === undefined) {
    return [];
  }

  if (!Array.isArray(ancestors)) {
    throw new CommerceValidationError('Ancestors must be an array or null/undefined');
  }

  if (ancestors.length > COMMERCE_BASIS_POINTS.FORK_LINEAGE_TOTAL) {
    throw new CommerceValidationError('Ancestor chain exceeds the 2,000-member allocation limit');
  }

  const result: AncestorNode[] = [];
  const seenRepoIds = new Set<string>();

  if (repositoryId && typeof repositoryId === 'string' && repositoryId.trim()) {
    seenRepoIds.add(repositoryId.trim());
  }

  let previousDepth = 0;

  for (let i = 0; i < ancestors.length; i++) {
    const item = ancestors[i];
    if (!item || typeof item !== 'object') {
      throw new CommerceValidationError(`Ancestor at index ${i} must be a valid object`);
    }

    const userId = item.userId;
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new CommerceValidationError(`Ancestor at index ${i} has invalid or missing userId`);
    }
    const cleanUserId = userId.trim();

    let cleanRepoId: string | null = null;
    if (item.repositoryId !== undefined && item.repositoryId !== null) {
      if (typeof item.repositoryId !== 'string' || !item.repositoryId.trim()) {
        throw new CommerceValidationError(`Ancestor at index ${i} has invalid repositoryId`);
      }
      const repoId = item.repositoryId.trim();
      if (seenRepoIds.has(repoId)) {
        if (repositoryId && repoId === repositoryId.trim()) {
          throw new CommerceValidationError(`Cyclic ancestry: source repository (${repoId}) cannot be listed as an ancestor`);
        }
        throw new CommerceValidationError(`Duplicate ancestor repositoryId detected: ${repoId}`);
      }
      seenRepoIds.add(repoId);
      cleanRepoId = repoId;
    }

    let depth = i + 1;
    if (item.depth !== undefined && item.depth !== null) {
      if (typeof item.depth !== 'number' || !Number.isSafeInteger(item.depth) || item.depth <= 0) {
        throw new CommerceValidationError(`Ancestor at index ${i} has invalid depth: ${item.depth}`);
      }
      if (item.depth <= previousDepth) {
        throw new CommerceValidationError(`Ancestor depth at index ${i} (${item.depth}) must be strictly greater than previous depth (${previousDepth})`);
      }
      depth = item.depth;
    }
    previousDepth = depth;

    result.push({
      repositoryId: cleanRepoId,
      userId: cleanUserId,
      depth
    });
  }

  return result;
}

/**
 * Deterministically calculates royalty allocations for a purchase.
 *
 * Rules:
 * 1. Conservation of Cents: Sum of all allocation amount_cents EXACTLY equals gross_cents.
 * 2. Conservation of BPS: Sum of all basis_points EXACTLY equals 10,000.
 * 3. Root App (0 ancestors):
 *    - Maker: 9000 BPS (90%)
 *    - Protocol Pool: 1000 BPS (10%)
 * 4. Fork App (N >= 1 ancestors):
 *    - Maker: 7000 BPS (70%)
 *    - Protocol Pool: 1000 BPS (10%)
 *    - Ancestors collectively: 2000 BPS (20%)
 *    - Ancestor shares are equal with deterministic remainder assignment by ancestry order (nearest ancestor first).
 */
export function calculateAllocations(input: AllocationCalculationInput): AllocationCalculationResult {
  const grossCents = validateGrossCents(input.grossCents);
  const currency = validateCurrency(input.currency);
  const sellerUserId = validateSellerUserId(input.sellerUserId);
  const repositoryId = input.repositoryId ? input.repositoryId.trim() : null;
  const ancestors = validateAncestors(input.ancestors, sellerUserId, repositoryId);

  const isRoot = ancestors.length === 0;
  const lineagePolicy = DEFAULT_LINEAGE_POLICY;
  const allocations: OrderAllocationSnapshot[] = [];

  let makerCents: number;
  let makerBasisPoints: number;
  let lineageTotalCents: number;
  let lineageTotalBasisPoints: number;
  let protocolPoolCents: number;
  let protocolPoolBasisPoints: number;

  // Protocol Pool always receives 10% (1000 bps)
  protocolPoolBasisPoints = COMMERCE_BASIS_POINTS.ROOT_PROTOCOL_POOL;
  protocolPoolCents = Math.floor((grossCents * protocolPoolBasisPoints) / COMMERCE_BASIS_POINTS.TOTAL);

  if (isRoot) {
    // Root Application: 90% Maker / 10% Protocol Pool
    makerBasisPoints = COMMERCE_BASIS_POINTS.ROOT_MAKER;
    lineageTotalBasisPoints = 0;
    lineageTotalCents = 0;

    // Maker receives the conserved remainder
    makerCents = grossCents - protocolPoolCents;

    // Sequence 0: Maker
    allocations.push({
      sequence: 0,
      role: 'maker',
      recipientUserId: sellerUserId,
      sourceRepositoryId: repositoryId,
      lineageDepth: 0,
      basisPoints: makerBasisPoints,
      amountCents: makerCents,
    });

    // Sequence 1: Protocol Pool
    allocations.push({
      sequence: 1,
      role: 'protocol_pool',
      recipientUserId: null,
      sourceRepositoryId: null,
      lineageDepth: null,
      basisPoints: protocolPoolBasisPoints,
      amountCents: protocolPoolCents,
    });
  } else {
    // Fork Application: 70% Maker / 20% Ancestors / 10% Protocol Pool
    const ancestorCount = ancestors.length;
    makerBasisPoints = COMMERCE_BASIS_POINTS.FORK_MAKER;
    lineageTotalBasisPoints = COMMERCE_BASIS_POINTS.FORK_LINEAGE_TOTAL;
    lineageTotalCents = Math.floor((grossCents * lineageTotalBasisPoints) / COMMERCE_BASIS_POINTS.TOTAL);

    // Maker receives the conserved remainder of (gross - lineage - protocol)
    makerCents = grossCents - lineageTotalCents - protocolPoolCents;

    // Sequence 0: Maker
    allocations.push({
      sequence: 0,
      role: 'maker',
      recipientUserId: sellerUserId,
      sourceRepositoryId: repositoryId,
      lineageDepth: 0,
      basisPoints: makerBasisPoints,
      amountCents: makerCents,
    });

    // Distribute lineage 2000 BPS and lineageTotalCents across ancestors equally,
    // with remainder allocated deterministically to earlier ancestors in ancestry order.
    const baseBps = Math.floor(lineageTotalBasisPoints / ancestorCount);
    const remainderBps = lineageTotalBasisPoints % ancestorCount;

    const baseCents = Math.floor(lineageTotalCents / ancestorCount);
    const remainderCents = lineageTotalCents % ancestorCount;

    for (let i = 0; i < ancestorCount; i++) {
      const ancestor = ancestors[i];
      const allocBps = baseBps + (i < remainderBps ? 1 : 0);
      const allocCents = baseCents + (i < remainderCents ? 1 : 0);

      allocations.push({
        sequence: i + 1,
        role: 'ancestor',
        recipientUserId: ancestor.userId,
        sourceRepositoryId: ancestor.repositoryId,
        lineageDepth: ancestor.depth,
        basisPoints: allocBps,
        amountCents: allocCents,
      });
    }

    // Sequence N + 1: Protocol Pool
    allocations.push({
      sequence: ancestorCount + 1,
      role: 'protocol_pool',
      recipientUserId: null,
      sourceRepositoryId: null,
      lineageDepth: null,
      basisPoints: protocolPoolBasisPoints,
      amountCents: protocolPoolCents,
    });
  }

  // Verify conservation invariants
  const totalAllocatedCents = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  const totalAllocatedBps = allocations.reduce((sum, a) => sum + a.basisPoints, 0);

  if (totalAllocatedCents !== grossCents) {
    throw new Error(`FATAL INVARIANT VIOLATION: allocated cents (${totalAllocatedCents}) does not equal gross cents (${grossCents})`);
  }

  if (totalAllocatedBps !== COMMERCE_BASIS_POINTS.TOTAL) {
    throw new Error(`FATAL INVARIANT VIOLATION: allocated basis points (${totalAllocatedBps}) does not equal 10,000`);
  }

  const ancestorAllocations = allocations
    .filter(a => a.role === 'ancestor')
    .map(a => ({
      sequence: a.sequence,
      repositoryId: a.sourceRepositoryId,
      userId: a.recipientUserId!,
      depth: a.lineageDepth!,
      amountCents: a.amountCents,
      basisPoints: a.basisPoints,
    }));

  const snapshot: LineageSnapshotPayload = {
    snapshottedAt: new Date().toISOString(),
    lineagePolicy,
    isRoot,
    grossCents,
    currency,
    sellerUserId,
    repositoryId,
    makerCents,
    makerBasisPoints,
    lineageTotalCents,
    lineageTotalBasisPoints,
    protocolPoolCents,
    protocolPoolBasisPoints,
    ancestorCount: ancestors.length,
    ancestorAllocations,
    allocations,
    conservationVerified: true,
  };

  return {
    isRoot,
    lineagePolicy,
    grossCents,
    currency,
    makerCents,
    makerBasisPoints,
    lineageTotalCents,
    lineageTotalBasisPoints,
    protocolPoolCents,
    protocolPoolBasisPoints,
    allocations,
    snapshot,
    snapshotJson: JSON.stringify(snapshot),
    conservationVerified: true,
  };
}

/**
 * Traverses the canonical `repository_forks` table in D1 to construct the
 * immutable ancestry DAG up to the root repository.
 * Detects cycles and preserves ancestry order from nearest parent (depth 1) to root.
 */
export async function fetchRepositoryAncestry(
  db: any,
  repositoryId: string | null | undefined
): Promise<AncestorNode[]> {
  if (!db || !repositoryId || typeof repositoryId !== 'string' || !repositoryId.trim()) {
    return [];
  }

  const startRepoId = repositoryId.trim();
  const ancestors: AncestorNode[] = [];
  const visitedRepoIds = new Set<string>([startRepoId]);
  let currentChildId = startRepoId;

  while (true) {
    const fork: any = await db.prepare(`
      SELECT f.parent_repository_id AS parentRepositoryId,
             f.depth,
             r.owner_user_id AS ownerUserId
      FROM repository_forks f
      JOIN repositories r ON r.id = f.parent_repository_id
      WHERE f.child_repository_id = ?
    `).bind(currentChildId).first();

    if (!fork || !fork.parentRepositoryId || !fork.ownerUserId) {
      break;
    }

    const parentRepoId = String(fork.parentRepositoryId).trim();
    if (visitedRepoIds.has(parentRepoId)) {
      throw new CommerceValidationError(`Cycle detected in repository lineage for repository ID: ${parentRepoId}`);
    }
    visitedRepoIds.add(parentRepoId);

    ancestors.push({
      repositoryId: parentRepoId,
      userId: String(fork.ownerUserId).trim(),
      depth: ancestors.length + 1
    });

    currentChildId = parentRepoId;
  }

  return ancestors;
}
