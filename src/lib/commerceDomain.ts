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

export interface ContributorInput {
  userId: string;
  bps: number;
}

export interface ContributorNode {
  userId: string;
  bps: number;
}

export interface AllocationCalculationInput {
  grossCents: number;
  currency: string;
  sellerUserId: string;
  repositoryId?: string | null;
  ancestors?: readonly AncestorInput[] | null;
  contributors?: readonly ContributorInput[] | null;
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
  contributorCount?: number;
  contributorTotalCents?: number;
  contributorTotalBasisPoints?: number;
  contributorAllocations?: ReadonlyArray<{
    sequence: number;
    repositoryId: string | null;
    userId: string;
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
  contributorTotalCents?: number;
  contributorTotalBasisPoints?: number;
  contributorAllocations?: ReadonlyArray<{
    sequence: number;
    repositoryId: string | null;
    userId: string;
    amountCents: number;
    basisPoints: number;
  }>;
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
 * Validates and sanitizes contributor share input list.
 * Enforces non-empty distinct user IDs, positive integer basis points,
 * and maker floor invariant (maker retains at least MAKER_FLOOR_BPS = 1000 bps).
 * Requires makerBasisPoints (must be 9000 for root or 7000 for fork) to enforce
 * the allowable contributor carve cap.
 */
export function validateContributors(
  contributors: unknown,
  makerBasisPoints: number
): ContributorNode[] {
  if (
    typeof makerBasisPoints !== 'number' ||
    (makerBasisPoints !== COMMERCE_BASIS_POINTS.ROOT_MAKER && makerBasisPoints !== COMMERCE_BASIS_POINTS.FORK_MAKER)
  ) {
    throw new CommerceValidationError(
      `makerBasisPoints must be either ${COMMERCE_BASIS_POINTS.ROOT_MAKER} (root) or ${COMMERCE_BASIS_POINTS.FORK_MAKER} (fork), received: ${makerBasisPoints}`
    );
  }

  if (contributors === null || contributors === undefined) {
    return [];
  }

  if (!Array.isArray(contributors)) {
    throw new CommerceValidationError('Contributors must be an array or null/undefined');
  }

  if (contributors.length === 0) {
    return [];
  }

  const result: ContributorNode[] = [];
  const seenUserIds = new Set<string>();
  let totalBps = 0;

  for (let i = 0; i < contributors.length; i++) {
    const item = contributors[i];
    if (!item || typeof item !== 'object') {
      throw new CommerceValidationError(`Contributor at index ${i} must be a valid object`);
    }

    const userId = item.userId;
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new CommerceValidationError(`Contributor at index ${i} has invalid or missing userId`);
    }
    const cleanUserId = userId.trim();

    if (seenUserIds.has(cleanUserId)) {
      throw new CommerceValidationError(`Duplicate contributor userId detected: ${cleanUserId}`);
    }
    seenUserIds.add(cleanUserId);

    const bps = item.bps;
    if (typeof bps !== 'number' || !Number.isFinite(bps) || !Number.isSafeInteger(bps) || bps <= 0) {
      throw new CommerceValidationError(`Contributor at index ${i} has invalid bps: ${bps} (must be a strictly positive integer)`);
    }

    totalBps += bps;
    result.push({
      userId: cleanUserId,
      bps
    });
  }

  const maxAllowedBps = makerBasisPoints - MAKER_FLOOR_BPS;
  if (totalBps > maxAllowedBps) {
    throw new CommerceValidationError(
      `Contributor total basis points (${totalBps}) exceeds the allowable carve cap of ${maxAllowedBps} bps (maker floor: ${MAKER_FLOOR_BPS} bps)`
    );
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
 *    - Maker: 9000 BPS (90%) minus active contributor shares
 *    - Active Contributors: carved from Maker slice (seq 1..M)
 *    - Protocol Pool: 1000 BPS (10%) (seq last)
 * 4. Fork App (N >= 1 ancestors):
 *    - Maker: 7000 BPS (70%) minus active contributor shares
 *    - Ancestors collectively: 2000 BPS (20%) (seq 1..N)
 *    - Active Contributors: carved from Maker slice (seq N+1..N+M)
 *    - Protocol Pool: 1000 BPS (10%) (seq last)
 *    - Ancestor shares are equal with deterministic remainder assignment by ancestry order (nearest ancestor first).
 */
export function calculateAllocations(input: AllocationCalculationInput): AllocationCalculationResult {
  const grossCents = validateGrossCents(input.grossCents);
  const currency = validateCurrency(input.currency);
  const sellerUserId = validateSellerUserId(input.sellerUserId);
  const repositoryId = input.repositoryId ? input.repositoryId.trim() : null;
  const ancestors = validateAncestors(input.ancestors, sellerUserId, repositoryId);

  const isRoot = ancestors.length === 0;
  const initialMakerBasisPoints = isRoot
    ? COMMERCE_BASIS_POINTS.ROOT_MAKER
    : COMMERCE_BASIS_POINTS.FORK_MAKER;

  const contributors = validateContributors(input.contributors, initialMakerBasisPoints);

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

  let contributorTotalBasisPoints = 0;
  let contributorTotalCents = 0;

  if (isRoot) {
    // Root Application: 90% Maker (minus contributors) / 10% Protocol Pool
    lineageTotalBasisPoints = 0;
    lineageTotalCents = 0;

    // Compute contributor allocations
    const contributorSnapshots: OrderAllocationSnapshot[] = [];
    for (let i = 0; i < contributors.length; i++) {
      const contrib = contributors[i];
      const allocCents = Math.floor((grossCents * contrib.bps) / COMMERCE_BASIS_POINTS.TOTAL);
      contributorSnapshots.push({
        sequence: 1 + i,
        role: 'contributor',
        recipientUserId: contrib.userId,
        sourceRepositoryId: repositoryId,
        lineageDepth: null,
        basisPoints: contrib.bps,
        amountCents: allocCents,
      });
      contributorTotalBasisPoints += contrib.bps;
      contributorTotalCents += allocCents;
    }

    // Maker receives conserved remainder: gross - protocolPool - contributorTotal
    makerBasisPoints = COMMERCE_BASIS_POINTS.ROOT_MAKER - contributorTotalBasisPoints;
    makerCents = grossCents - protocolPoolCents - contributorTotalCents;

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

    // Sequence 1..M: Contributors
    for (const cs of contributorSnapshots) {
      allocations.push(cs);
    }

    // Sequence M + 1: Protocol Pool
    allocations.push({
      sequence: 1 + contributors.length,
      role: 'protocol_pool',
      recipientUserId: null,
      sourceRepositoryId: null,
      lineageDepth: null,
      basisPoints: protocolPoolBasisPoints,
      amountCents: protocolPoolCents,
    });
  } else {
    // Fork Application: 70% Maker (minus contributors) / 20% Ancestors / 10% Protocol Pool
    const ancestorCount = ancestors.length;
    lineageTotalBasisPoints = COMMERCE_BASIS_POINTS.FORK_LINEAGE_TOTAL;
    lineageTotalCents = Math.floor((grossCents * lineageTotalBasisPoints) / COMMERCE_BASIS_POINTS.TOTAL);

    // Compute contributor allocations
    const contributorSnapshots: OrderAllocationSnapshot[] = [];
    for (let i = 0; i < contributors.length; i++) {
      const contrib = contributors[i];
      const allocCents = Math.floor((grossCents * contrib.bps) / COMMERCE_BASIS_POINTS.TOTAL);
      contributorSnapshots.push({
        sequence: 1 + ancestorCount + i,
        role: 'contributor',
        recipientUserId: contrib.userId,
        sourceRepositoryId: repositoryId,
        lineageDepth: null,
        basisPoints: contrib.bps,
        amountCents: allocCents,
      });
      contributorTotalBasisPoints += contrib.bps;
      contributorTotalCents += allocCents;
    }

    // Maker receives conserved remainder of (gross - lineage - protocol - contributors)
    makerBasisPoints = COMMERCE_BASIS_POINTS.FORK_MAKER - contributorTotalBasisPoints;
    makerCents = grossCents - lineageTotalCents - protocolPoolCents - contributorTotalCents;

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

    // Sequence N + 1 .. N + M: Contributors
    for (const cs of contributorSnapshots) {
      allocations.push(cs);
    }

    // Sequence N + M + 1: Protocol Pool
    allocations.push({
      sequence: 1 + ancestorCount + contributors.length,
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
    ...(contributors.length > 0
      ? {
          contributorCount: contributors.length,
          contributorTotalCents,
          contributorTotalBasisPoints,
          contributorAllocations: allocations
            .filter(a => a.role === 'contributor')
            .map(a => ({
              sequence: a.sequence,
              repositoryId: a.sourceRepositoryId,
              userId: a.recipientUserId!,
              amountCents: a.amountCents,
              basisPoints: a.basisPoints,
            })),
        }
      : {}),
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
    ...(contributors.length > 0
      ? {
          contributorTotalCents,
          contributorTotalBasisPoints,
          contributorAllocations: snapshot.contributorAllocations,
        }
      : {}),
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
