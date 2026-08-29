export const MERGE_JOB_STATUSES = [
  'queued', 'preparing', 'running', 'needs_input', 'preview_ready',
  'landing', 'landed', 'stale', 'failed', 'cancelled'
] as const;

export type MergeJobStatus = typeof MERGE_JOB_STATUSES[number];

export type RepositoryStatus = 'provisioning' | 'active' | 'archived' | 'quarantined';
export type RepositoryVisibility = 'public' | 'unlisted' | 'private';
export type RepositoryObjectFormat = 'sha1' | 'sha256';
export type RefOperation = 'create' | 'update' | 'delete';

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
  return MERGE_JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Validates repository slug format.
 * Slug must start with a lowercase alphanumeric character and contain only lowercase letters, digits, '.', '_', '-'.
 * Must be 1-100 chars, cannot end with '.git', '.lock', or '.', and cannot contain '..' or '//'.
 */
export function validateRepositorySlug(slug: unknown): { valid: boolean; error?: string } {
  if (typeof slug !== 'string' || !slug.trim()) {
    return { valid: false, error: 'Repository slug must be a non-empty string.' };
  }
  const trimmed = slug.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    return { valid: false, error: 'Repository slug must be between 1 and 100 characters.' };
  }
  if (!/^[a-z0-9]/.test(trimmed)) {
    return { valid: false, error: 'Repository slug must start with a lowercase alphanumeric character.' };
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(trimmed)) {
    return { valid: false, error: 'Repository slug may only contain lowercase alphanumeric characters, hyphens, underscores, and periods.' };
  }
  if (trimmed.endsWith('.git') || trimmed.endsWith('.lock') || trimmed.endsWith('.')) {
    return { valid: false, error: 'Repository slug cannot end with .git, .lock, or a trailing period.' };
  }
  if (trimmed.includes('..') || trimmed.includes('//')) {
    return { valid: false, error: 'Repository slug cannot contain consecutive periods or slashes.' };
  }
  return { valid: true };
}

export function isValidRepositorySlug(slug: unknown): boolean {
  return validateRepositorySlug(slug).valid;
}

/**
 * Validates that an OID is a full 40-hex (SHA-1) or 64-hex (SHA-256) Git object ID.
 */
export function validateGitOid(oid: unknown, label = 'Git object ID'): { valid: boolean; error?: string } {
  if (typeof oid !== 'string' || !oid.trim()) {
    return { valid: false, error: `${label} must be a non-empty string.` };
  }
  const trimmed = oid.trim();
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(trimmed)) {
    return { valid: false, error: `${label} must be a full 40-character (SHA-1) or 64-character (SHA-256) hexadecimal Git object ID.` };
  }
  return { valid: true };
}

export function isValidGitOid(oid: unknown): boolean {
  return validateGitOid(oid).valid;
}

export function isGitOidCompatibleWithObjectFormat(
  oid: unknown,
  objectFormat: RepositoryObjectFormat
): boolean {
  if (typeof oid !== 'string') return false;
  return objectFormat === 'sha256'
    ? /^[a-f0-9]{64}$/i.test(oid)
    : /^[a-f0-9]{40}$/i.test(oid);
}

/**
 * Validates git reference naming rules (e.g. refs/heads/main, refs/tags/v1.0).
 */
export function validateGitRef(ref: unknown): { valid: boolean; error?: string; namespace?: string } {
  if (typeof ref !== 'string' || !ref.trim()) {
    return { valid: false, error: 'Ref path must be a non-empty string.' };
  }

  const trimmed = ref.trim();
  if (!trimmed.startsWith('refs/')) {
    return { valid: false, error: 'Invalid ref path; must start with "refs/".' };
  }

  if (trimmed.endsWith('/') || trimmed.endsWith('.lock')) {
    return { valid: false, error: 'Ref path cannot end with "/" or ".lock".' };
  }

  if (trimmed.includes('//') || trimmed.includes('..')) {
    return { valid: false, error: 'Ref path cannot contain consecutive slashes or "..".' };
  }

  // Check for forbidden characters in git refs: ~ ^ : ? * [ \ whitespace control chars
  if (/[\x00-\x20\x7F~^:?*\[\\@]/.test(trimmed) || trimmed.includes('@{')) {
    return { valid: false, error: 'Ref path contains illegal Git reference characters.' };
  }

  const parts = trimmed.split('/');
  if (parts.length < 3 || parts.some(p => p.length === 0)) {
    return { valid: false, error: 'Ref path must specify a valid namespace and name (e.g. refs/heads/main, refs/features/xyz).' };
  }

  const namespace = `${parts[0]}/${parts[1]}`;
  return { valid: true, namespace };
}

export function isValidGitRef(ref: unknown): boolean {
  return validateGitRef(ref).valid;
}

/**
 * Generates an immutable, id-based storage key for a repository.
 */
export function buildRepositoryStorageKey(repositoryId: string): string {
  const cleanId = String(repositoryId || '').trim();
  if (!cleanId) throw new Error('Repository ID is required to build storage key.');
  return `repositories/${cleanId}`;
}

/**
 * Constant-time comparison for authentication tokens to prevent timing attacks.
 */
export function constantTimeTokenCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const lenA = a.length;
  const lenB = b.length;
  let mismatch = lenA === lenB ? 0 : 1;
  const maxLen = Math.max(lenA, lenB);
  for (let i = 0; i < maxLen; i++) {
    const charA = i < lenA ? a.charCodeAt(i) : 0;
    const charB = i < lenB ? b.charCodeAt(i) : 0;
    mismatch |= charA ^ charB;
  }
  return mismatch === 0;
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
  if (!input.childRepositoryId?.trim()) errors.push('Child repository is required.');
  if (!input.parentRepositoryId?.trim()) errors.push('Parent repository is required.');
  if (input.childRepositoryId && input.childRepositoryId === input.parentRepositoryId) {
    errors.push('A repository cannot fork itself.');
  }
  const refVal = validateGitRef(input.parentRefName);
  if (!refVal.valid) {
    errors.push('Parent ref must be a canonical refs/* name.');
  }
  const parentOidVal = validateGitOid(input.parentCommitOid, 'Parent commit');
  if (!parentOidVal.valid) {
    errors.push('Parent commit must be a full Git object ID.');
  }
  const childOidVal = validateGitOid(input.childInitialCommitOid, 'Child initial commit');
  if (!childOidVal.valid) {
    errors.push('Child initial commit must be a full Git object ID.');
  }
  if (!input.lineageRootRepositoryId?.trim()) errors.push('Lineage root repository is required.');
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
  return ROLE_ACTIONS[role]?.includes(action) ?? false;
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
