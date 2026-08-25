// Production Domain Logic for GITSMITH Bare Git Forge & Lineage Ledger

export interface CASMergeRequest {
  readonly ref: string;
  readonly expectedOldSha: string;
  readonly newSha: string;
  readonly committer: string;
  readonly signatureVerified: boolean;
}

export type CASMergeResult =
  | { readonly success: true; readonly ref: string; readonly newHeadSha: string }
  | { readonly success: false; readonly error: string; readonly currentRemoteHeadSha: string };

export function executeCasMerge(
  currentRemoteHeadSha: string,
  request: CASMergeRequest
): CASMergeResult {
  if (!request.ref || !request.ref.startsWith('refs/')) {
    return {
      success: false,
      error: 'Invalid ref path; must start with refs/',
      currentRemoteHeadSha
    };
  }

  if (currentRemoteHeadSha !== request.expectedOldSha) {
    return {
      success: false,
      error: `CAS atomic rejection: remote ${request.ref} has moved to ${currentRemoteHeadSha}. Rebase required before push.`,
      currentRemoteHeadSha
    };
  }

  if (!request.newSha || !request.newSha.match(/^[a-f0-9]{7,40}$/)) {
    return {
      success: false,
      error: 'Invalid commit SHA format.',
      currentRemoteHeadSha
    };
  }

  return {
    success: true,
    ref: request.ref,
    newHeadSha: request.newSha
  };
}

export interface RoyaltySplitResult {
  readonly grossCents: number;
  readonly makerCents: number;
  readonly lineageTotalCents: number;
  readonly poolCents: number;
  readonly ancestorSplits: readonly number[];
}

export function computeRoyaltySplit(grossCents: number, ancestorCount: number = 1): RoyaltySplitResult {
  if (!Number.isFinite(grossCents) || grossCents <= 0) {
    return { grossCents: 0, makerCents: 0, lineageTotalCents: 0, poolCents: 0, ancestorSplits: [] };
  }

  const roundedGross = Math.floor(grossCents);
  const makerCents = Math.round(roundedGross * 0.70);
  const lineageTotalCents = Math.round(roundedGross * 0.20);
  const poolCents = roundedGross - makerCents - lineageTotalCents;

  const perAncestor = ancestorCount > 0 ? Math.floor(lineageTotalCents / ancestorCount) : 0;
  const ancestorSplits = Array(ancestorCount).fill(perAncestor);

  return {
    grossCents: roundedGross,
    makerCents,
    lineageTotalCents,
    poolCents,
    ancestorSplits
  };
}
