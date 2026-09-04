import { COMMERCE_BASIS_POINTS, CommerceValidationError } from './commerceDomain';

export const MINIMUM_SELLER_HEADROOM_BPS = 1;

export function getListingRoyaltyHeadroomBps(inheritedSumBps: number): number {
  if (!Number.isSafeInteger(inheritedSumBps) || inheritedSumBps < 0 || inheritedSumBps > COMMERCE_BASIS_POINTS.TOTAL) {
    throw new CommerceValidationError('Inherited royalty basis points must be an integer between 0 and 10000.');
  }
  return Math.max(0, COMMERCE_BASIS_POINTS.TOTAL - MINIMUM_SELLER_HEADROOM_BPS - inheritedSumBps);
}

export function assertListingRoyaltyAllowed(inheritedSumBps: number, listingRoyaltyBps: number): void {
  if (!Number.isSafeInteger(listingRoyaltyBps) || listingRoyaltyBps < 0) {
    throw new CommerceValidationError('Listing royalty basis points must be a non-negative integer.');
  }
  const headroomBps = getListingRoyaltyHeadroomBps(inheritedSumBps);
  if (listingRoyaltyBps > headroomBps) {
    throw new CommerceValidationError(
      `Royalty rate exceeds the ${headroomBps} bps available after inherited liens and the minimum seller remainder.`
    );
  }
}

export function assertForkAllowed(sumBps: number): void {
  if (sumBps > 10000) {
    throw new CommerceValidationError(
      `Inherited royalty liens (${sumBps} bps) would exceed 100%; fork blocked.`
    );
  }
}

export interface ParentLien {
  ancestorRepositoryId: string;
  ancestorUserId: string;
  bps: number;
  depth: number;
}

export interface NewLienRow {
  holderOfRepositoryId: string;
  ancestorRepositoryId: string;
  ancestorUserId: string;
  bps: number;
  depth: number;
}

export interface BuildInheritedLiensResult {
  liens: NewLienRow[];
  sumBps: number;
}

export function buildInheritedLiens(
  parentLiens: readonly ParentLien[],
  parentListingBps: number,
  parentRepositoryId: string,
  parentUserId: string,
  childRepositoryId: string
): BuildInheritedLiensResult {
  const liens: NewLienRow[] = [];

  for (const parentLien of parentLiens) {
    if (!(parentLien.bps > 0)) continue;
    liens.push({
      holderOfRepositoryId: childRepositoryId,
      ancestorRepositoryId: parentLien.ancestorRepositoryId,
      ancestorUserId: parentLien.ancestorUserId,
      bps: parentLien.bps,
      depth: parentLien.depth + 1,
    });
  }

  if (parentListingBps > 0) {
    liens.push({
      holderOfRepositoryId: childRepositoryId,
      ancestorRepositoryId: parentRepositoryId,
      ancestorUserId: parentUserId,
      bps: parentListingBps,
      depth: 1,
    });
  }

  const sumBps = liens.reduce((sum, lien) => sum + lien.bps, 0);

  return { liens, sumBps };
}
