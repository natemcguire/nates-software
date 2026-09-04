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

function cumulativeTargets(allocations: FrozenAllocation[], seats: number): RankedAllocation[] {
  const ranked: RankedAllocation[] = allocations.map((allocation) => ({ allocation, target: 0 }));
  for (let cent = 0; cent < seats; cent += 1) {
    let best: RankedAllocation | null = null;
    for (const item of ranked) {
      if (item.target >= item.allocation.amountCents) continue;
      if (best === null) {
        best = item;
        continue;
      }
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
