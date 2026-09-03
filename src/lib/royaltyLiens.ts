// Fork-time frozen royalty lien capture (Task B2, Shareware Restored money model).
//
// A lien = "this descendant repo owes this ancestor this bps on every sale,
// forever." Liens are captured ONCE, atomically, at fork-confirm time, and
// are never mutated afterward (see migration 0038's immutability triggers on
// repository_fork_liens). Buy-time settlement reads the frozen set via
// commerceDomain.ts::fetchFrozenLiens instead of walking ancestry.
//
// This module is pure — no DB access — so the inheritance math can be unit
// tested in isolation. functions/api/git.ts wires the DB reads/writes around
// it inside the gateway-confirm-fork atomic batch.
//
// Task B3 adds the Σr <= 100% gate: a fork whose inherited Σr would exceed
// 10000 bps must be rejected at fork-REQUEST time (before provisioning), not
// merely refused at confirm/buy time. assertForkAllowed is the pure
// assertion; functions/api/git.ts calls buildInheritedLiens(...) in a
// dry/no-write way in the action==='fork' phase to compute prospective
// sumBps, then calls this to decide whether to proceed.

import { CommerceValidationError } from './commerceDomain';

/**
 * Throws CommerceValidationError if the prospective inherited Σr (in basis
 * points) would exceed 100% (10000 bps). A sale could never cover liens that
 * sum past the full sale price, so a fork that would create such a lien set
 * must never be provisioned.
 */
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

/**
 * Computes the frozen lien set a child repository inherits when it forks a
 * parent repository.
 *
 * Rules:
 * 1. The child inherits ALL of the parent's own liens, each carried forward
 *    at depth+1, with holder rewritten to the child's repository id.
 * 2. PLUS one new lien for the immediate parent itself — ancestor = parent's
 *    repo/owner, bps = the parent's own listing royalty_bps, depth = 1 —
 *    but only if that rate is > 0.
 * 3. Any lien (inherited or new) whose bps <= 0 is skipped entirely; a
 *    0-bps lien is never written (matches the repository_fork_liens
 *    CHECK (bps > 0)).
 * 4. sumBps is the sum of all bps in the returned liens — the caller (Task
 *    B3) uses this to gate Σr <= 10000 at fork-request time. This function
 *    does not throw; it only computes and reports the sum.
 */
export function buildInheritedLiens(
  parentLiens: readonly ParentLien[],
  parentListingBps: number,
  parentRepositoryId: string,
  parentUserId: string,
  childRepositoryId: string
): BuildInheritedLiensResult {
  const liens: NewLienRow[] = [];

  for (const parentLien of parentLiens) {
    if (!(parentLien.bps > 0)) continue; // defensive skip-zero
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
