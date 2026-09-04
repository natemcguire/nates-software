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

/**
 * Reads the frozen ancestor liens captured at fork-confirm time for a given
 * seller repository, from the `repository_fork_liens` table (see migration
 * 0038 / Task B1). Replaces the old `fetchRepositoryAncestry` per-generation
 * walk: liens are frozen once at fork time, so buy-time settlement is a
 * single indexed read instead of a chain of sequential D1 subrequests.
 *
 * Returns liens sorted root-first (highest depth first), matching the order
 * `calculateAllocations` expects.
 */
export async function fetchFrozenLiens(db: any, sellerRepositoryId: string): Promise<LienInput[]> {
  const result: any = await db.prepare(`
    SELECT ancestor_user_id, ancestor_repository_id, bps, depth
    FROM repository_fork_liens
    WHERE holder_of_repository_id = ?
    ORDER BY depth DESC
  `).bind(sellerRepositoryId).all();

  const rows = result?.results ?? [];
  return rows.map((row: any) => ({
    ancestorUserId: row.ancestor_user_id,
    ancestorRepositoryId: row.ancestor_repository_id,
    bps: row.bps,
    depth: row.depth,
  }));
}
