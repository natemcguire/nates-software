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

function compareNextSeat(a: RankedAllocation, b: RankedAllocation): number {
  const left = BigInt(a.allocation.amountCents) * BigInt(b.target + 1);
  const right = BigInt(b.allocation.amountCents) * BigInt(a.target + 1);
  if (left !== right) return left > right ? -1 : 1;
  return a.allocation.sequence - b.allocation.sequence || a.allocation.id.localeCompare(b.allocation.id);
}

/** House-monotone D'Hondt allocation with exact BigInt tie comparison. */
function cumulativeTargets(allocations: FrozenAllocation[], seats: number): RankedAllocation[] {
  if (seats === 0) return allocations.map((allocation) => ({ allocation, target: 0 }));
  let low = 0;
  let high = Math.max(...allocations.map((allocation) => allocation.amountCents)) + 1;
  for (let i = 0; i < 96; i += 1) {
    const divisor = (low + high) / 2;
    const count = allocations.reduce((sum, allocation) => sum + Math.floor(allocation.amountCents / divisor), 0);
    if (count > seats) low = divisor;
    else high = divisor;
  }
  const ranked = allocations.map((allocation) => ({
    allocation,
    target: Math.min(allocation.amountCents, Math.floor(allocation.amountCents / high))
  }));
  let assigned = ranked.reduce((sum, item) => sum + item.target, 0);
  while (assigned < seats) {
    ranked.sort(compareNextSeat);
    const next = ranked.find((item) => item.target < item.allocation.amountCents);
    if (!next) throw new Error('unable to conserve cumulative refund seats');
    next.target += 1;
    assigned += 1;
  }
  if (assigned !== seats) throw new Error('cumulative refund allocation exceeded target');
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
 * House-first flooring (Task C3): every PAYABLE allocation (seller/ancestor, plus
 * the legacy maker/contributor roles) is capped at its exact proportional floor —
 * `floor(amountCents * cumulativeRefundedCents / grossCents)` — a pure, monotone
 * function of the cumulative refund. A payable recipient can therefore never be
 * clawed back more than they actually received. Whatever remains of the cumulative
 * refund after all payable floors are subtracted is assigned to the NON-PAYABLE
 * (house) allocations — 'platform' or the legacy 'protocol_pool' — via the same
 * cumulative largest-remainder machinery, so 100% of the rounding dust lands on the
 * house, on sale and on refund alike, exactly mirroring the house-tip sale-time rule.
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

  // House-first, monotone-across-sequential-refunds apportionment.
  //
  // The house (platform / legacy protocol_pool) absorbs rounding dust first, so every
  // payable is capped at its exact proportional floor `floor(amount·c/gross)` for as
  // long as the house has capacity to soak up the difference. The house's cumulative
  // target is therefore the leftover `c − Σ payableFloor`, bounded by its own frozen
  // amount.
  //
  // That leftover is NOT monotone on its own: as `c` rises by 1 the payable-floor sum
  // can jump by 2+ (several payables round up on the same cent), which would drag the
  // house residual DOWN and trip the "refund state regressed" guard on a sequential
  // partial refund — the production path threads `priorByAllocation` call-to-call.
  // We restore monotonicity by clamping the house's cumulative to never fall below
  // what it was already clawed back (`priorHouse`), then re-derive the payables from
  // whatever the house did NOT take, seated with the monotone divisor (D'Hondt)
  // machinery. Both series come out monotone and conserve `c` exactly.
  const payable = allocations.filter((allocation) => isPayableRole(allocation.role));
  const nonPayable = allocations.filter((allocation) => !isPayableRole(allocation.role));

  const payableFloorTotal = payable.reduce(
    (sum, allocation) => sum + Math.floor((allocation.amountCents * cumulativeRefundedCents) / grossCents),
    0
  );
  const nonPayableCeiling = nonPayable.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const priorHouse = nonPayable.reduce((sum, allocation) => sum + (priorByAllocation.get(allocation.id) ?? 0), 0);

  // House's cumulative: the flooring leftover, floored at what it already holds
  // (monotone) and capped at what it actually received (never over-clawed). The extra
  // clamp against `cumulativeRefundedCents` guards the edge where prior house exceeds
  // the whole current refund (cannot happen with a well-formed ledger, but keeps the
  // payable seat count non-negative regardless).
  const houseTarget = Math.min(
    nonPayableCeiling,
    cumulativeRefundedCents,
    Math.max(priorHouse, cumulativeRefundedCents - payableFloorTotal)
  );
  const payableSeats = cumulativeRefundedCents - houseTarget;

  const payableRanked: RankedAllocation[] = payable.length === 0
    ? []
    : cumulativeTargets(payable, payableSeats);
  const nonPayableRanked: RankedAllocation[] = nonPayable.length === 0
    ? []
    : cumulativeTargets(nonPayable, houseTarget);

  return [...payableRanked, ...nonPayableRanked]
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
