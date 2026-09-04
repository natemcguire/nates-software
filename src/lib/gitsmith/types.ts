export type RepositoryObjectFormat = 'sha1' | 'sha256';
export type RefOperation = 'create' | 'update' | 'delete';

export interface GatewayConfig {
  readonly reposRoot: string;
  readonly controlPlaneUrl: string;
  readonly gatewayToken: string;
  readonly sshEnabled?: boolean;
  readonly sshHost?: string;
  readonly sshPort?: number;
  readonly sshPublicPort?: number;
  readonly productionEnabled?: boolean;
  readonly isProduction?: boolean;
  readonly port?: number;
  readonly pollIntervalMs?: number;
  readonly maxAttempts?: number;
  readonly leaseDurationSeconds?: number;
  readonly baseBackoffSeconds?: number;
  readonly maxBackoffSeconds?: number;
}

export interface GitCapabilities {
  readonly gitAvailable: boolean;
  readonly gitVersion?: string;
  readonly supportsSha1: boolean;
  readonly supportsSha256: boolean;
  readonly error?: string;
}

export interface StorageValidationResult {
  readonly valid: boolean;
  readonly error?: string;
  readonly resolvedPath?: string;
}

export interface ProvisionRepoParams {
  readonly storageKey: string;
  readonly objectFormat?: RepositoryObjectFormat;
  readonly defaultRef?: string;
}

export interface ProvisionRepoResult {
  readonly success: boolean;
  readonly storageKey: string;
  readonly repoPath: string;
  readonly objectFormat: RepositoryObjectFormat;
  readonly defaultRef: string;
  readonly idempotent?: boolean;
  readonly error?: string;
}

export interface AuthoritativeRefCasParams {
  readonly storageKey: string;
  readonly refName: string;
  readonly newOid: string | null;
  readonly expectedOldOid: string | null;
  readonly operation?: RefOperation;
  readonly actorUserId?: string | null;
  readonly idempotencyKey?: string;
  readonly signatureVerified?: boolean;
}

export interface AuthoritativeRefCasResult {
  readonly success: boolean;
  readonly refName: string;
  readonly oldOid: string | null;
  readonly newOid: string | null;
  readonly currentOid: string | null;
  readonly stale?: boolean;
  readonly error?: string;
  readonly reconciled?: boolean;
  readonly receiptPersisted?: boolean;
  readonly controlPlaneEventId?: string;
  readonly controlPlaneError?: string;
  readonly idempotent?: boolean;
}

export interface ForkProvisionParams {
  readonly childRepositoryId: string;
  readonly childStorageKey: string;
  readonly parentRepositoryId: string;
  readonly parentStorageKey: string;
  readonly parentRefName: string;
  readonly parentCommitOid: string;
  readonly childInitialCommitOid: string;
  readonly lineageRootRepositoryId: string;
  readonly depth: number;
  readonly idempotencyKey: string;
  readonly actorUserId?: string | null;
  readonly childSlug?: string;
  readonly defaultRef?: string;
  readonly objectFormat?: RepositoryObjectFormat;
}

export interface ForkProvisionResult {
  readonly success: boolean;
  readonly childRepositoryId: string;
  readonly childStorageKey: string;
  readonly childRepoPath: string;
  readonly parentCommitOid: string;
  readonly childInitialCommitOid: string;
  readonly idempotent?: boolean;
  readonly controlPlaneConfirmed?: boolean;
  readonly controlPlaneError?: string;
  readonly error?: string;
}

export interface OutboxEventRecord {
  readonly id: string;
  readonly aggregate_type: 'repository' | 'ref' | 'fork' | 'merge' | 'build' | 'deployment';
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly payload: string;
  readonly attempts: number;
  readonly available_at?: string;
  readonly delivered_at?: string | null;
  readonly dead_lettered_at?: string | null;
  readonly last_error?: string | null;
  readonly claim_token?: string | null;
  readonly lease_expires_at?: string | null;
  readonly created_at?: string;
}

export interface ProcessOutboxResult {
  readonly success: boolean;
  readonly eventId: string;
  readonly eventType: string;
  readonly skipped?: boolean;
  readonly retryable?: boolean;
  readonly terminal?: boolean;
  readonly error?: string;
  readonly details?: any;
}

export type ReconciliationIssueType =
  | 'git_missing_in_d1'
  | 'd1_missing_in_git'
  | 'oid_mismatch'
  | 'artifact_missing';

export interface ReconciliationIssueRecord {
  readonly id: string;
  readonly repository_id: string;
  readonly ref_name?: string | null;
  readonly issue_type: ReconciliationIssueType;
  readonly git_oid?: string | null;
  readonly d1_oid?: string | null;
  readonly status: 'open' | 'repairing' | 'resolved' | 'ignored';
  readonly detail: string;
  readonly detected_at: string;
  readonly resolved_at?: string | null;
}

export interface ReconciliationSummary {
  readonly scannedRepositories: number;
  readonly openIssuesFound: number;
  readonly resolvedCount: number;
  readonly issues: ReconciliationIssueRecord[];
}

export interface GatewayHealthStatus {
  readonly status: 'ok' | 'degraded' | 'error';
  readonly uptimeSeconds: number;
  readonly timestamp: string;
}

export interface GatewayReadinessStatus {
  readonly ready: boolean;
  readonly configured: boolean;
  readonly active: boolean;
  readonly checks: {
    readonly git: {
      readonly available: boolean;
      readonly version?: string;
      readonly supportsSha1: boolean;
      readonly supportsSha256: boolean;
      readonly error?: string;
    };
    readonly storage: {
      readonly configured: boolean;
      readonly root?: string;
      readonly exists: boolean;
      readonly writable: boolean;
      readonly error?: string;
    };
    readonly controlPlane: {
      readonly configured: boolean;
      readonly url?: string;
      readonly reachable: boolean;
      readonly error?: string;
    };
    readonly dispatcher: {
      readonly running: boolean;
      readonly processedCount: number;
      readonly lastPolledAt?: string;
    };
    readonly transport: {
      readonly protocol: 'ssh';
      readonly configured: boolean;
      readonly active: boolean;
      readonly host?: string;
      readonly port?: number;
      readonly error?: string;
    };
  };
  readonly timestamp: string;
}

export interface GitCommitInfo {
  readonly sha: string;
  readonly shortSha: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly summary: string;
  readonly message: string;
}

export interface DiffLine {
  readonly type: 'add' | 'delete' | 'context' | 'header';
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
  readonly content: string;
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly header: string;
  readonly lines: DiffLine[];
}

export interface GitFileDiff {
  readonly oldPath: string;
  readonly newPath: string;
  readonly status: 'modified' | 'added' | 'deleted' | 'renamed';
  readonly additions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
  readonly patch: string;
  readonly hunks: DiffHunk[];
}

export interface ProposalDiffResult {
  readonly success: boolean;
  readonly baseOid: string;
  readonly headOid: string;
  readonly mergeBaseOid: string | null;
  readonly isFastForward: boolean;
  readonly diverged: boolean;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly commits: GitCommitInfo[];
  readonly files: GitFileDiff[];
  readonly totalAdditions: number;
  readonly totalDeletions: number;
  readonly filesChanged: number;
  readonly unifiedDiff: string;
  readonly error?: string;
}

export interface InspectCommitTreeParams {
  readonly storageKey: string;
  readonly commitOid: string;
  readonly manifestCandidates?: readonly string[];
}

export interface InspectCommitTreeResult {
  readonly success: boolean;
  readonly exists: boolean;
  readonly storageKey: string;
  readonly commitOid: string;
  readonly files?: readonly string[];
  readonly manifestContents?: Record<string, string>;
  readonly error?: string;
}
