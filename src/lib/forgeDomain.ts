export const MERGE_JOB_STATUSES = [
  'queued', 'preparing', 'running', 'needs_input', 'preview_ready',
  'landing', 'landed', 'stale', 'failed', 'cancelled'
] as const;

export type MergeJobStatus = typeof MERGE_JOB_STATUSES[number];

const MERGE_JOB_TRANSITIONS: Readonly<Record<MergeJobStatus, readonly MergeJobStatus[]>> = {
  queued: ['preparing', 'cancelled'],
  preparing: ['running', 'failed', 'cancelled'],
  running: ['needs_input', 'preview_ready', 'stale', 'failed', 'cancelled'],
  needs_input: ['queued', 'cancelled'],
  preview_ready: ['landing', 'stale', 'cancelled'],
  landing: ['landed', 'stale', 'failed'],
  landed: [],
  stale: ['queued', 'cancelled'],
  failed: ['queued', 'cancelled'],
  cancelled: []
};

export function canTransitionMergeJob(from: MergeJobStatus, to: MergeJobStatus): boolean {
  return MERGE_JOB_TRANSITIONS[from].includes(to);
}

export interface ForkOriginInput {
  readonly childRepositoryId: string;
  readonly parentRepositoryId: string;
  readonly parentRefName: string;
  readonly parentCommitOid: string;
  readonly childInitialCommitOid: string;
  readonly lineageRootRepositoryId: string;
  readonly depth: number;
}

export function validateForkOrigin(input: ForkOriginInput): readonly string[] {
  const errors: string[] = [];
  if (!input.childRepositoryId.trim()) errors.push('Child repository is required.');
  if (!input.parentRepositoryId.trim()) errors.push('Parent repository is required.');
  if (input.childRepositoryId === input.parentRepositoryId) errors.push('A repository cannot fork itself.');
  if (!input.parentRefName.startsWith('refs/')) errors.push('Parent ref must be a canonical refs/* name.');
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(input.parentCommitOid)) errors.push('Parent commit must be a full Git object ID.');
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(input.childInitialCommitOid)) errors.push('Child initial commit must be a full Git object ID.');
  if (!input.lineageRootRepositoryId.trim()) errors.push('Lineage root repository is required.');
  if (!Number.isInteger(input.depth) || input.depth < 1) errors.push('Fork depth must be a positive integer.');
  return errors;
}

export interface CasRefUpdateInput {
  readonly currentOid: string | null;
  readonly expectedOldOid: string | null;
  readonly newOid: string | null;
}

export function isCasRefUpdateValid(input: CasRefUpdateInput): boolean {
  return input.currentOid === input.expectedOldOid && input.currentOid !== input.newOid;
}

