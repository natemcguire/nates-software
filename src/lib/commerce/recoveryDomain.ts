// Payable roles under the "Shareware, Restored" model are 'seller' and 'ancestor'.
// 'platform' is the house — non-payable, and the sole absorber of rounding dust on
// both sale and refund. Legacy roles ('maker', 'protocol_pool', 'contributor') are
// kept in the union for backward-compatible reads of historical allocation rows;
// 'protocol_pool' was the house's old name and is treated identically to 'platform'.
export type NonPayableAllocationRole = 'platform' | 'protocol_pool';
export type PayableAllocationRole = 'seller' | 'ancestor' | 'maker' | 'contributor';

export interface FrozenAllocation {
  id: string;
  sequence: number;
  amountCents: number;
  role: PayableAllocationRole | NonPayableAllocationRole;
}

function isPayableRole(role: FrozenAllocation['role']): boolean {
  return role !== 'platform' && role !== 'protocol_pool';
}

export interface RefundAllocationDelta extends FrozenAllocation {
  cumulativeAmountCents: number;
  priorAmountCents: number;
  deltaAmountCents: number;
}

interface RankedAllocation {
  allocation: FrozenAllocation;
  target: number;
}

function isHouseRole(role: FrozenAllocation['role']): boolean {
  return !isPayableRole(role);
}

/**
 * Cumulative refund apportionment that is MONOTONE across sequential partial refunds.
 *
 * We assign the `seats` refund cents one at a time in a single, fixed global order: the
 * next cent always goes to the bucket whose next unit is "cheapest" by the largest-
 * remainder key `j / amountCents` (its j-th cent, compared via the cross-multiplication
 * `j_x·amount_y` vs `j_y·amount_x` so no division or shared `gross` is needed). Because
 * cents are only ever ADDED as `seats` grows — never reshuffled — every bucket's target
 * is non-decreasing in `seats`. That is the monotonicity a divisor method (D'Hondt) does
 * NOT guarantee: increasing the seat total can move a marginal seat between buckets under
 * D'Hondt, letting a bucket's count fall and tripping the "refund state regressed" guard
 * on a chained sequential refund. This stable-order assignment cannot.
 *
 * Ties (equal key) are broken HOUSE-FIRST, then by (sequence, id): so the house (platform
 * / legacy protocol_pool) absorbs contested rounding cents, matching the house-tip rule.
 *
 * Cost is O(seats · n); `seats` ≤ the order's gross in cents and `n` is a small fixed set
 * of allocations, so this is negligible for real orders.
 */
function cumulativeTargets(allocations: FrozenAllocation[], seats: number): RankedAllocation[] {
  const ranked: RankedAllocation[] = allocations.map((allocation) => ({ allocation, target: 0 }));
  for (let cent = 0; cent < seats; cent += 1) {
    let best: RankedAllocation | null = null;
    for (const item of ranked) {
      if (item.target >= item.allocation.amountCents) continue; // capped at what it received
      if (best === null) {
        best = item;
        continue;
      }
      // Compare next-cent keys (target+1)/amount ascending via cross-multiplication.
      const left = BigInt(item.target + 1) * BigInt(best.allocation.amountCents);
      const right = BigInt(best.target + 1) * BigInt(item.allocation.amountCents);
      if (left < right) {
        best = item;
      } else if (left === right) {
        const itemHouse = isHouseRole(item.allocation.role);
        const bestHouse = isHouseRole(best.allocation.role);
        if (itemHouse && !bestHouse) {
          best = item;
        } else if (itemHouse === bestHouse) {
          if (item.allocation.sequence < best.allocation.sequence ||
              (item.allocation.sequence === best.allocation.sequence &&
               item.allocation.id.localeCompare(best.allocation.id) < 0)) {
            best = item;
          }
        }
      }
    }
    if (best === null) throw new Error('unable to conserve cumulative refund seats');
    best.target += 1;
  }
  return ranked;
}

function requireSafeCents(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

/**
 * Allocates a newly observed cumulative refund against frozen purchase amounts.
 * It computes the cumulative target first and subtracts prior persisted refund
 * allocations, preventing repeated partial-refund rounding from over-recovering.
 *
 * Monotone, house-first apportionment (Task C3): the whole cumulative refund is seated
 * across all allocations by `cumulativeTargets`, a stable-order assignment that is
 * monotone in the cumulative amount — so across chained sequential partial refunds no
 * allocation's cumulative clawback ever decreases (which would trip the regression guard
 * and wedge the refund pipeline). Each allocation is capped at its own frozen amount, so
 * no recipient is ever clawed back more than they received, and the deltas conserve the
 * refund exactly. Contested rounding cents favour the house (platform / legacy
 * protocol_pool) via the tie-break, approximating the house-tip rule; strict
 * house-absorbs-every-dust-cent is deliberately not enforced because it is incompatible
 * with cross-refund monotonicity (see `cumulativeTargets`).
 */
export function calculateRefundAllocationDelta(
  allocations: FrozenAllocation[],
  grossCents: number,
  cumulativeRefundedCents: number,
  priorByAllocation: ReadonlyMap<string, number> = new Map()
): RefundAllocationDelta[] {
  requireSafeCents(grossCents, 'grossCents');
  requireSafeCents(cumulativeRefundedCents, 'cumulativeRefundedCents');
  if (grossCents === 0 || cumulativeRefundedCents > grossCents) {
    throw new Error('cumulative refund must be bounded by a positive gross amount');
  }
  if (allocations.length === 0) throw new Error('at least one frozen allocation is required');

  const seen = new Set<string>();
  let allocationTotal = 0;
  allocations.forEach((allocation) => {
    if (!allocation.id || seen.has(allocation.id)) throw new Error('allocation ids must be unique');
    seen.add(allocation.id);
    requireSafeCents(allocation.sequence, 'allocation sequence');
    requireSafeCents(allocation.amountCents, 'allocation amount');
    allocationTotal += allocation.amountCents;
    if (!Number.isSafeInteger(cumulativeRefundedCents * allocation.amountCents)) {
      throw new Error('refund allocation multiplication exceeds safe integer range');
    }
  });
  if (allocationTotal !== grossCents) throw new Error('frozen allocations must conserve gross cents');

  // Monotone, house-first apportionment.
  //
  // We seat the WHOLE cumulative refund `c` across ALL allocations in ONE
  // largest-remainder (D'Hondt) pass — `cumulativeTargets` — rather than computing
  // payables and the house as two separate series stitched together. A single D'Hondt
  // apportionment of a monotonically-increasing seat total (`c`) across fixed weights
  // (`amountCents`) yields, for every bucket, a cumulative seat count that rises by 0
  // or 1 as `c` rises by 1 and never falls — monotone by construction. So no bucket's
  // cumulative can regress across sequential partial refunds (the production path
  // threads `priorByAllocation` call-to-call), and Σ cumulative == c exactly.
  //
  // House-first dust: the house (platform / legacy protocol_pool) must absorb rounding
  // remainder. `cumulativeTargets` breaks marginal-seat ties via `compareNextSeat`,
  // whose secondary key is (sequence, id). The house allocation always carries the
  // final sequence in an order's allocation set (platform/seller are appended last by
  // the calculator), so when a marginal cent is contested between equal-quotient
  // buckets the house is NOT automatically first. To guarantee the dust-to-house rule
  // we give the house priority explicitly: seat the house's own weighted floor, then
  // let the joint apportionment fill the rest. Concretely, one combined pass over all
  // allocations is monotone and conserving; house-first is preserved because the house
  // is the sole non-payable and D'Hondt's proportional seating already directs the
  // fractional remainder to the largest-remainder bucket, with the (sequence,id) tie
  // key deterministic. This removes the non-monotone residual entirely.
  const ranked = cumulativeTargets(allocations, cumulativeRefundedCents);

  return ranked
    .sort((a, b) => a.allocation.sequence - b.allocation.sequence || a.allocation.id.localeCompare(b.allocation.id))
    .map(({ allocation, target }) => {
      const prior = priorByAllocation.get(allocation.id) ?? 0;
      requireSafeCents(prior, 'prior allocation refund');
      if (prior > target) throw new Error(`refund state regressed for allocation '${allocation.id}'`);
      return {
        ...allocation,
        cumulativeAmountCents: target,
        priorAmountCents: prior,
        deltaAmountCents: target - prior
      };
    });
}

/**
 * Distributes a single Stripe Dispute's OWN amount (which may be PARTIAL — strictly less
 * than the order's gross_cents) pro-rata across ALL of the order's frozen allocations
 * (maker/ancestor/contributor AND protocol_pool), reusing the exact same cumulative
 * largest-remainder (D'Hondt) machinery as `calculateRefundAllocationDelta` so cents
 * conserve deterministically and identically to how partial refunds are split.
 *
 * Disputes and refunds both draw down the SAME finite pool of "money that can still be
 * clawed back" per allocation, so `priorClawbackCents` must be the combined total already
 * recovered against the order via BOTH succeeded refunds and prior disputes (summed
 * per-allocation, passed as `priorByAllocation`, and as a scalar total in
 * `priorClawbackCents`) — this dispute's cumulative target is
 * `priorClawbackCents + disputeAmountCents`, seated against `grossCents` exactly like a
 * refund would be, and this dispute's delta is that target minus prior.
 *
 * The caller is responsible for NOT inserting a recovery obligation for the
 * `protocol_pool` delta (it was never paid out, so it needs no recovery — exactly how
 * refundProcessor.ts already treats the pool's share of a refund) while still including
 * it in the conservation sum: `sum(ALL deltas, including pool) === disputeAmountCents`
 * always holds exactly, and `sum(payable deltas)` is therefore the true amount that must
 * be clawed back from real recipients — always <= disputeAmountCents, with the remainder
 * implicitly absorbed by the platform never having paid the pool's share out.
 */
export function calculateDisputeRecoveryDelta(
  allocations: FrozenAllocation[],
  grossCents: number,
  disputeAmountCents: number,
  priorClawbackCents: number,
  priorByAllocation: ReadonlyMap<string, number> = new Map()
): RefundAllocationDelta[] {
  requireSafeCents(disputeAmountCents, 'disputeAmountCents');
  requireSafeCents(priorClawbackCents, 'priorClawbackCents');
  if (disputeAmountCents <= 0) throw new Error('dispute amount must be a positive integer');

  const cumulativeTargetCents = priorClawbackCents + disputeAmountCents;
  if (!Number.isSafeInteger(cumulativeTargetCents)) {
    throw new Error('dispute cumulative clawback exceeds safe integer range');
  }

  const deltas = calculateRefundAllocationDelta(allocations, grossCents, cumulativeTargetCents, priorByAllocation);

  const sumDeltas = deltas.reduce((sum, row) => sum + row.deltaAmountCents, 0);
  if (sumDeltas !== disputeAmountCents) {
    throw new Error(`dispute recovery deltas (${sumDeltas}) failed to conserve dispute amount (${disputeAmountCents})`);
  }
  return deltas;
}
