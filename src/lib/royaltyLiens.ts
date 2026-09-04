import { CommerceValidationError } from './commerceDomain';

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
