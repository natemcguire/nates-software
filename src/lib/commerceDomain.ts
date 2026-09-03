// Production Domain Logic for Durable Marketplace Commerce
// Implements deterministic allocation calculation, strict money/currency validation,
// and ancestry DAG lineage resolution for Nate's Software Lineage Ledger.

export const COMMERCE_BASIS_POINTS = {
  TOTAL: 10000,
} as const;

export const PLATFORM_FEE_BPS = 1000;

export type AllocationRole = 'platform' | 'ancestor' | 'seller';

export class CommerceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommerceValidationError';
  }
}

export interface LienInput {
  ancestorUserId: string;
  ancestorRepositoryId: string | null;
  bps: number;
  depth: number;
}

export interface OrderAllocationSnapshot {
  sequence: number;
  role: AllocationRole;
  recipientUserId: string | null;
  sourceRepositoryId: string | null;
  lineageDepth: number | null;
  basisPoints: number | null;
  amountCents: number;
}

export interface AllocationCalculationInput {
  grossCents: number;
  currency: string;
  sellerUserId: string;
  sellerRepositoryId?: string | null;
  liens?: readonly LienInput[] | null;
}

export interface LineageSnapshotPayload {
  snapshottedAt: string;
  isRoot: boolean;
  grossCents: number;
  currency: string;
  sellerUserId: string;
  sellerRepositoryId: string | null;
  platformCents: number;
  sellerCents: number;
  ancestorTotalCents: number;
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
  grossCents: number;
  currency: string;
  platformCents: number;
  sellerCents: number;
  ancestorTotalCents: number;
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
 * Deterministically calculates additive frozen-lien allocations for a purchase.
 *
 * Rules:
 * 1. Platform base fee = floor(0.10 * grossCents), taken off the top.
 * 2. Remainder R = grossCents - platformBase.
 * 3. Each ancestor lien pays floor(r_i * R / 10000), applied additively (not nested),
 *    root-first (highest depth first).
 * 4. Seller receives the floored remainder of R after all ancestor liens.
 * 5. House tip: all rounding dust accrues to the platform. Conservation is exact:
 *    platformTotal + Σancestor + seller == grossCents.
 * 6. Skip-zero: a lien with 0 bps or a computed 0 amount is never written as an
 *    allocation row.
 * 7. Throws CommerceValidationError if Σ lien bps > 10000.
 */
export function calculateAllocations(input: AllocationCalculationInput): AllocationCalculationResult {
  const grossCents = validateGrossCents(input.grossCents);
  const currency = validateCurrency(input.currency);
  const sellerUserId = validateSellerUserId(input.sellerUserId);
  const sellerRepositoryId = input.sellerRepositoryId ?? null;
  const liens = (input.liens ?? []).slice().sort((a, b) => b.depth - a.depth); // root (highest depth) first
  const totalLienBps = liens.reduce((s, l) => s + l.bps, 0);
  if (totalLienBps > COMMERCE_BASIS_POINTS.TOTAL) {
    throw new CommerceValidationError(`Inherited liens (${totalLienBps} bps) exceed 100%`);
  }

  const platformBase = Math.floor((grossCents * PLATFORM_FEE_BPS) / COMMERCE_BASIS_POINTS.TOTAL);
  const R = grossCents - platformBase;

  const allocations: OrderAllocationSnapshot[] = [];
  let sequence = 1;
  let ancestorTotal = 0;
  for (const lien of liens) {
    if (lien.bps <= 0) continue; // skip-zero: never write a 0-amount row
    const pay = Math.floor((R * lien.bps) / COMMERCE_BASIS_POINTS.TOTAL);
    if (pay <= 0) continue;
    ancestorTotal += pay;
    allocations.push({
      sequence: sequence++, role: 'ancestor', recipientUserId: lien.ancestorUserId,
      sourceRepositoryId: lien.ancestorRepositoryId, lineageDepth: lien.depth,
      basisPoints: lien.bps, amountCents: pay,
    });
  }

  const sellerCents = R - ancestorTotal;             // floored remainder of R
  const platformDust = grossCents - platformBase - ancestorTotal - sellerCents; // ≥ 0
  const platformTotal = platformBase + platformDust; // house tip

  allocations.push({
    sequence: sequence++, role: 'seller', recipientUserId: sellerUserId,
    sourceRepositoryId: sellerRepositoryId, lineageDepth: 0,
    basisPoints: null, amountCents: sellerCents,
  });
  allocations.push({
    sequence: sequence++, role: 'platform', recipientUserId: null,
    sourceRepositoryId: null, lineageDepth: null, basisPoints: null, amountCents: platformTotal,
  });

  const total = allocations.reduce((s, a) => s + a.amountCents, 0);
  if (total !== grossCents) {
    throw new Error(`FATAL INVARIANT VIOLATION: allocated cents (${total}) != gross cents (${grossCents})`);
  }

  const isRoot = liens.length === 0;

  const ancestorAllocations = allocations
    .filter(a => a.role === 'ancestor')
    .map(a => ({
      sequence: a.sequence,
      repositoryId: a.sourceRepositoryId,
      userId: a.recipientUserId!,
      depth: a.lineageDepth!,
      amountCents: a.amountCents,
      basisPoints: a.basisPoints!,
    }));

  const snapshot: LineageSnapshotPayload = {
    snapshottedAt: new Date().toISOString(),
    isRoot,
    grossCents,
    currency,
    sellerUserId,
    sellerRepositoryId,
    platformCents: platformTotal,
    sellerCents,
    ancestorTotalCents: ancestorTotal,
    ancestorAllocations,
    allocations,
    conservationVerified: true,
  };

  return {
    isRoot,
    grossCents,
    currency,
    platformCents: platformTotal,
    sellerCents,
    ancestorTotalCents: ancestorTotal,
    allocations,
    snapshot,
    snapshotJson: JSON.stringify(snapshot),
    conservationVerified: true,
  };
}

// TODO(A2): replaced by fetchFrozenLiens. fetchRepositoryAncestry (and its
// AncestorNode return type) belonged to the old nested 70/20/10 royalty model
// and referenced COMMERCE_BASIS_POINTS.FORK_LINEAGE_TOTAL, which no longer
// exists under the additive frozen-lien model. Left commented out rather than
// deleted per Task A1 scope; Task A2 replaces this with fetchFrozenLiens.
//
// export interface AncestorNode {
//   repositoryId: string | null;
//   userId: string;
//   depth: number;
// }
//
// /**
//  * Traverses the canonical `repository_forks` table in D1 to construct the
//  * immutable ancestry DAG up to the root repository.
//  * Detects cycles and preserves ancestry order from nearest parent (depth 1) to root.
//  */
// export async function fetchRepositoryAncestry(
//   db: any,
//   repositoryId: string | null | undefined
// ): Promise<AncestorNode[]> {
//   if (!db || !repositoryId || typeof repositoryId !== 'string' || !repositoryId.trim()) {
//     return [];
//   }
//
//   const startRepoId = repositoryId.trim();
//   const ancestors: AncestorNode[] = [];
//   const visitedRepoIds = new Set<string>([startRepoId]);
//   let currentChildId = startRepoId;
//
//   // Bound the walk to the maximum payable lineage size. Each generation is one
//   // sequential D1 query, so without this ceiling a maliciously deep (but free
//   // and depth-unbounded) fork chain would make every checkout issue tens of
//   // thousands of D1 subrequests — exhausting the Cloudflare subrequest/CPU
//   // budget and burning D1 quota (a request→DB amplification DoS). Cap the number
//   // of queries at FORK_LINEAGE_TOTAL + 1 and fail closed the same way the
//   // downstream validateAncestors cap would, so an over-deep listing is honestly
//   // unpurchasable rather than an amplification vector.
//   const MAX_ANCESTORS = 2000;
//
//   while (true) {
//     const fork: any = await db.prepare(`
//       SELECT f.parent_repository_id AS parentRepositoryId,
//              f.depth,
//              r.owner_user_id AS ownerUserId
//       FROM repository_forks f
//       JOIN repositories r ON r.id = f.parent_repository_id
//       WHERE f.child_repository_id = ?
//     `).bind(currentChildId).first();
//
//     if (!fork || !fork.parentRepositoryId || !fork.ownerUserId) {
//       break;
//     }
//
//     const parentRepoId = String(fork.parentRepositoryId).trim();
//     if (visitedRepoIds.has(parentRepoId)) {
//       throw new CommerceValidationError(`Cycle detected in repository lineage for repository ID: ${parentRepoId}`);
//     }
//     visitedRepoIds.add(parentRepoId);
//
//     ancestors.push({
//       repositoryId: parentRepoId,
//       userId: String(fork.ownerUserId).trim(),
//       depth: ancestors.length + 1
//     });
//
//     if (ancestors.length > MAX_ANCESTORS) {
//       throw new CommerceValidationError(
//         `Repository lineage exceeds the maximum of ${MAX_ANCESTORS} ancestors and cannot be settled.`
//       );
//     }
//
//     currentChildId = parentRepoId;
//   }
//
//   return ancestors;
// }
