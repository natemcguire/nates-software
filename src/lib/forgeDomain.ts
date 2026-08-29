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

export type RepositoryRole = 'reader' | 'triager' | 'writer' | 'maintainer' | 'owner';
export type RepositoryAction = 'read' | 'triage' | 'push' | 'manage_refs' | 'manage_members' | 'archive';

const ROLE_ACTIONS: Readonly<Record<RepositoryRole, readonly RepositoryAction[]>> = {
  reader: ['read'],
  triager: ['read', 'triage'],
  writer: ['read', 'triage', 'push'],
  maintainer: ['read', 'triage', 'push', 'manage_refs'],
  owner: ['read', 'triage', 'push', 'manage_refs', 'manage_members', 'archive']
};

export function repositoryRoleAllows(role: RepositoryRole, action: RepositoryAction): boolean {
  return ROLE_ACTIONS[role].includes(action);
}

export interface RefPolicy {
  readonly refPattern: string;
  readonly requireSignedCommits: boolean;
  readonly requirePassingBuild: boolean;
  readonly minimumApprovals: number;
  readonly allowForcePush: boolean;
  readonly allowDelete: boolean;
}

export function refPatternMatches(pattern: string, refName: string): boolean {
  if (!pattern.endsWith('*')) return pattern === refName;
  return refName.startsWith(pattern.slice(0, -1));
}

export function selectRefPolicy(policies: readonly RefPolicy[], refName: string): RefPolicy | null {
  const matches = policies.filter(policy => refPatternMatches(policy.refPattern, refName));
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.refPattern.replace(/\*$/, '').length - a.refPattern.replace(/\*$/, '').length)[0];
}

export interface MergeJobRecord {
  readonly id: string;
  readonly targetRepositoryId: string;
  readonly sourceRepositoryId: string;
  readonly sourceRefName: string;
  readonly targetRefName: string;
  readonly baseCommitOid: string;
  status: MergeJobStatus;
  previewUrl?: string;
  evidenceDigest?: string;
  createdAt: string;
  updatedAt: string;
}

export function createMergeJob(params: {
  targetRepositoryId: string;
  sourceRepositoryId: string;
  sourceRefName: string;
  targetRefName?: string;
  baseCommitOid: string;
}): MergeJobRecord {
  const id = `mj_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  return {
    id,
    targetRepositoryId: params.targetRepositoryId,
    sourceRepositoryId: params.sourceRepositoryId,
    sourceRefName: params.sourceRefName,
    targetRefName: params.targetRefName || 'refs/heads/main',
    baseCommitOid: params.baseCommitOid,
    status: 'queued',
    createdAt: now,
    updatedAt: now
  };
}

export function transitionMergeJob(
  job: MergeJobRecord,
  newStatus: MergeJobStatus,
  extra?: { previewUrl?: string; evidenceDigest?: string }
): MergeJobRecord {
  if (!canTransitionMergeJob(job.status, newStatus)) {
    throw new Error(`Invalid merge job transition from '${job.status}' to '${newStatus}'`);
  }
  return {
    ...job,
    status: newStatus,
    previewUrl: extra?.previewUrl || job.previewUrl,
    evidenceDigest: extra?.evidenceDigest || job.evidenceDigest,
    updatedAt: new Date().toISOString()
  };
}
