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

export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_IMAGE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_DEFAULT_FILE_BYTES = 2 * 1024 * 1024;

export function getMaxFileSizeBytes(filePath: string): number {
  if (typeof filePath !== 'string') return MAX_DEFAULT_FILE_BYTES;
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot !== -1) {
    const ext = filePath.slice(lastDot).toLowerCase();
    if (['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.mjs', '.ts'].includes(ext)) {
      return MAX_TEXT_FILE_BYTES;
    }
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.avif', '.bmp'].includes(ext)) {
      return MAX_IMAGE_FILE_BYTES;
    }
  }
  return MAX_DEFAULT_FILE_BYTES;
}

export function validateRepoFilePath(filePath: unknown): { valid: boolean; error?: string } {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { valid: false, error: 'File path must be a non-empty string.' };
  }

  const clean = filePath.trim();

  if (clean.includes('\0')) {
    return { valid: false, error: 'File path cannot contain null bytes.' };
  }

  if (clean.includes('\\')) {
    return { valid: false, error: 'File path cannot contain backslashes.' };
  }

  if (clean.startsWith('/') || clean.startsWith('-') || /^[a-zA-Z]:/.test(clean)) {
    return { valid: false, error: 'Absolute paths, leading slashes, and option flags are forbidden.' };
  }

  const segments = clean.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return { valid: false, error: 'Path traversal and empty segments are forbidden.' };
    }
  }

  if (clean.includes('..')) {
    return { valid: false, error: 'Path traversal is forbidden.' };
  }

  return { valid: true };
}

export function isValidRepoFilePath(filePath: unknown): boolean {
  return validateRepoFilePath(filePath).valid;
}

export function buildRepositoryStorageKey(repositoryId: string): string {
  const cleanId = String(repositoryId || '').trim();
  if (!cleanId) throw new Error('Repository ID is required to build storage key.');
  return `repositories/${cleanId}`;
}

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
  if (!Number.isInteger(input.depth) || input.depth < 1) {
    errors.push('Fork depth must be a positive integer.');
  } else if (input.depth > MAX_FORK_DEPTH) {
    errors.push(`Fork depth exceeds the maximum lineage depth of ${MAX_FORK_DEPTH}.`);
  }
  return errors;
}

export const MAX_FORK_DEPTH = 500;

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
  readonly requireSignedCommits: boolean | number;
  readonly requirePassingBuild: boolean | number;
  readonly minimumApprovals: number;
  readonly allowForcePush: boolean | number;
  readonly allowDelete: boolean | number;
}

export function normalizeRefPattern(refOrPattern: string): string {
  if (!refOrPattern || typeof refOrPattern !== 'string') return '';
  const trimmed = refOrPattern.trim();
  if (trimmed.startsWith('refs/')) return trimmed;
  return `refs/heads/${trimmed}`;
}

export function refPatternMatches(pattern: string, refName: string): boolean {
  if (!pattern || typeof pattern !== 'string') return false;
  if (!refName || typeof refName !== 'string') return false;
  const p = pattern.trim();
  const r = refName.trim();
  const normP = normalizeRefPattern(p);
  const normR = normalizeRefPattern(r);

  if (r === p || normR === normP || normR === p || r === normP) return true;

  if (p.endsWith('*')) {
    const prefix = p.slice(0, -1);
    const normPrefix = normP.slice(0, -1);
    return r.startsWith(prefix) || normR.startsWith(normPrefix) || normR.startsWith(prefix) || r.startsWith(normPrefix);
  }
  return false;
}

export function isValidRefPolicyEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }
  const p = entry as Record<string, unknown>;
  if (typeof p.refPattern !== 'string' || !p.refPattern.trim()) {
    return false;
  }
  if (p.allowForcePush === undefined || (typeof p.allowForcePush !== 'boolean' && p.allowForcePush !== 0 && p.allowForcePush !== 1)) {
    return false;
  }
  if (p.allowDelete === undefined || (typeof p.allowDelete !== 'boolean' && p.allowDelete !== 0 && p.allowDelete !== 1)) {
    return false;
  }
  if (p.requireSignedCommits === undefined || (typeof p.requireSignedCommits !== 'boolean' && p.requireSignedCommits !== 0 && p.requireSignedCommits !== 1)) {
    return false;
  }
  if (p.requirePassingBuild === undefined || (typeof p.requirePassingBuild !== 'boolean' && p.requirePassingBuild !== 0 && p.requirePassingBuild !== 1)) {
    return false;
  }
  if (p.minimumApprovals === undefined || typeof p.minimumApprovals !== 'number' || !Number.isFinite(p.minimumApprovals) || p.minimumApprovals < 0) {
    return false;
  }
  return true;
}

export function isValidRefPolicies(policies: unknown): boolean {
  if (!Array.isArray(policies)) return false;
  return policies.every(isValidRefPolicyEntry);
}

function comparePolicySpecificity(a: RefPolicy, b: RefPolicy): number {
  const normA = normalizeRefPattern(a.refPattern);
  const normB = normalizeRefPattern(b.refPattern);
  const hasWildcardA = normA.endsWith('*') ? 1 : 0;
  const hasWildcardB = normB.endsWith('*') ? 1 : 0;
  const prefixLenA = hasWildcardA ? normA.slice(0, -1).length : normA.length;
  const prefixLenB = hasWildcardB ? normB.slice(0, -1).length : normB.length;

  if (prefixLenB !== prefixLenA) {
    return prefixLenB - prefixLenA;
  }
  if (hasWildcardA !== hasWildcardB) {
    return hasWildcardA - hasWildcardB;
  }
  return 0;
}

export function selectRefPolicy(policies: readonly RefPolicy[], refName: string): RefPolicy | null {
  if (!Array.isArray(policies) || policies.length === 0 || !refName) return null;
  const matches = policies.filter(policy => policy && typeof policy.refPattern === 'string' && refPatternMatches(policy.refPattern, refName));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const sorted = [...matches].sort(comparePolicySpecificity);
  const best = sorted[0];
  const topTier = sorted.filter(p => comparePolicySpecificity(best, p) === 0);

  if (topTier.length === 1) return topTier[0];

  const allowForcePush = topTier.every(p => Boolean(p.allowForcePush));
  const allowDelete = topTier.every(p => Boolean(p.allowDelete));
  const requireSignedCommits = topTier.some(p => Boolean(p.requireSignedCommits));
  const requirePassingBuild = topTier.some(p => Boolean(p.requirePassingBuild));
  const minimumApprovals = Math.max(...topTier.map(p => Number(p.minimumApprovals) || 0));
  const sortedPatterns = [...topTier].sort((a, b) => normalizeRefPattern(a.refPattern).localeCompare(normalizeRefPattern(b.refPattern)));

  return {
    refPattern: sortedPatterns[0].refPattern,
    allowForcePush,
    allowDelete,
    requireSignedCommits,
    requirePassingBuild,
    minimumApprovals
  };
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
