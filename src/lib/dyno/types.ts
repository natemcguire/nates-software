// DYNO Real-World AI Developer Benchmark Runner
// Type definitions aligned with migrations/0007_dyno_real_world_benchmarks.sql canonical schema.
// Independent benchmark of model + agent harness + tools on common developer tasks.

export type DynoTaskCategory =
  | 'explain_repo'
  | 'find_bug'
  | 'implement_feature'
  | 'repair_test'
  | 'modify_schema'
  | 'resolve_conflict'
  | 'refactor_safe'
  | 'build_package'
  | 'follow_repo_rules'
  | 'recover_failure'
  | 'cli_operation';

export type DynoSuiteStatus = 'draft' | 'active' | 'retired';

export type DynoRunStatus =
  | 'queued'
  | 'running'
  | 'grading'
  | 'completed'
  | 'invalid'
  | 'failed'
  | 'cancelled';

export type DynoVerificationStatus =
  | 'unverified'
  | 'reproducible'
  | 'verified'
  | 'rejected';

export type DynoAttemptStatus =
  | 'running'
  | 'passed'
  | 'failed'
  | 'timed_out'
  | 'unsafe'
  | 'cancelled';

export type DynoSafetyClassification =
  | 'allowed'
  | 'reviewed'
  | 'blocked'
  | 'violation';

export type DynoNetworkPolicy = 'none' | 'isolated' | 'local_only' | 'full';

// ============================================================================
// CANONICAL DATABASE RECORD INTERFACES (Matching migration 0007)
// ============================================================================

export interface DynoSuiteRecord {
  readonly id: string;
  readonly slug: string;
  readonly version: string;
  readonly name: string;
  readonly methodology_markdown: string;
  readonly task_manifest_digest: string;
  readonly grader_version: string;
  readonly status: DynoSuiteStatus;
  readonly published_at?: string | null;
  readonly created_at: string;
}

export interface DynoTaskRecord {
  readonly id: string;
  readonly suite_id: string;
  readonly task_key: string;
  readonly category: DynoTaskCategory;
  readonly title: string;
  readonly prompt_digest: string;
  readonly fixture_digest: string;
  readonly grader_manifest_digest: string;
  readonly time_limit_seconds: number;
  readonly weight: number;
  readonly display_order: number;
}

export interface DynoSubjectRecord {
  readonly id: string;
  readonly model_provider: string;
  readonly model_id: string;
  readonly model_version?: string | null;
  readonly model_config: string; // JSON string
  readonly agent_harness: string;
  readonly harness_version: string;
  readonly tool_manifest: string; // JSON string
  readonly created_at?: string;
}

export interface DynoEnvironmentRecord {
  readonly id: string;
  readonly os_name: string;
  readonly os_version: string;
  readonly architecture: string;
  readonly cpu_model?: string | null;
  readonly accelerator_model?: string | null;
  readonly memory_bytes?: number | null;
  readonly container_image_digest: string;
  readonly runtime_manifest: string; // JSON string
  readonly network_policy: DynoNetworkPolicy;
  readonly created_at?: string;
}

export interface DynoRunRecord {
  readonly id: string;
  readonly suite_id: string;
  readonly subject_id: string;
  readonly environment_id: string;
  readonly submitted_by_user_id?: string | null;
  readonly repetition: number;
  readonly randomization_seed: string;
  readonly status: DynoRunStatus;
  readonly verification_status: DynoVerificationStatus;
  readonly overall_score?: number | null;
  readonly total_cost_micros?: number | null;
  readonly total_tokens?: number | null;
  readonly runner_attestation_digest?: string | null;
  readonly raw_trace_r2_key?: string | null;
  readonly raw_trace_sha256?: string | null;
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
  readonly created_at: string;
}

export interface DynoTaskAttemptRecord {
  readonly id: string;
  readonly run_id: string;
  readonly task_id: string;
  readonly attempt_number: number;
  readonly status: DynoAttemptStatus;
  readonly first_attempt_success: 0 | 1;
  readonly hidden_tests_passed: number;
  readonly hidden_tests_total: number;
  readonly duration_ms: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cached_input_tokens: number;
  readonly cost_micros: number;
  readonly tool_calls: number;
  readonly human_interventions: number;
  readonly unnecessary_files_changed: number;
  readonly safety_violations: number;
  readonly instruction_score?: number | null;
  readonly result_digest?: string | null;
  readonly started_at: string;
  readonly completed_at?: string | null;
}

export interface DynoToolEventRecord {
  readonly id: string;
  readonly task_attempt_id: string;
  readonly sequence_number: number;
  readonly tool_name: string;
  readonly command_class?: string | null;
  readonly started_offset_ms: number;
  readonly duration_ms?: number | null;
  readonly exit_code?: number | null;
  readonly input_digest: string;
  readonly output_digest?: string | null;
  readonly safety_classification: DynoSafetyClassification;
}

export interface DynoGraderResultRecord {
  readonly id: string;
  readonly task_attempt_id: string;
  readonly grader_key: string;
  readonly grader_version: string;
  readonly passed: 0 | 1;
  readonly score: number;
  readonly max_score: number;
  readonly evidence_digest: string;
  readonly detail: string;
  readonly created_at?: string;
}

// ============================================================================
// FIXTURE & GRADER SPECIFICATIONS
// ============================================================================

export interface DynoHiddenTestSpec {
  readonly name: string;
  readonly command: string;
  readonly expectedExitCode?: number;
  readonly expectedOutputContains?: string;
  readonly timeoutMs?: number;
}

export type DynoGraderType =
  | 'file_content'
  | 'file_integrity'
  | 'test_runner'
  | 'custom';

export interface DynoGraderSpec {
  readonly key: string;
  readonly version: string;
  readonly type: DynoGraderType;
  readonly description: string;
  readonly weight?: number; // default 1
  readonly config: {
    readonly targetFiles?: readonly string[];
    readonly expectedPatterns?: readonly (string | RegExp)[];
    readonly forbiddenPatterns?: readonly (string | RegExp)[];
    readonly testCommands?: readonly DynoHiddenTestSpec[];
    readonly readOnlyFiles?: readonly string[];
    readonly customGrader?: (sandbox: DynoSandboxInstance) => Promise<{ passed: boolean; score: number; maxScore: number; detail: string }>;
  };
}

export interface DynoFixture {
  readonly key: string;
  readonly category: DynoTaskCategory;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
  readonly timeLimitSeconds: number;
  readonly weight: number;
  readonly files: Readonly<Record<string, string>>;
  readonly expectedModifiedFiles: readonly string[];
  readonly readOnlyFiles?: readonly string[];
  readonly hiddenTests: readonly DynoHiddenTestSpec[];
  readonly graders: readonly DynoGraderSpec[];
}

// ============================================================================
// SANDBOX & RUNTIME INTERFACES
// ============================================================================

export interface DynoExecOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
  readonly toolName?: string;
  readonly commandClass?: string;
}

export interface DynoExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface DynoFileChangeSummary {
  readonly modified: readonly string[];
  readonly created: readonly string[];
  readonly deleted: readonly string[];
  readonly unnecessaryChanges: readonly string[];
}

export interface DynoSandboxInstance {
  readonly dir: string;
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  deleteFile(relativePath: string): Promise<void>;
  fileExists(relativePath: string): Promise<boolean>;
  listFiles(relativeSubdir?: string): Promise<string[]>;
  exec(command: string, args?: string[], options?: DynoExecOptions): Promise<DynoExecResult>;
  getFileChanges(expectedFiles: readonly string[]): Promise<DynoFileChangeSummary>;
  cleanup(): Promise<void>;
}

// ============================================================================
// AGENT HARNESS & EXECUTION INTERFACES
// ============================================================================

export interface DynoExecutionContext {
  readonly runId: string;
  readonly taskAttemptId: string;
  readonly task: DynoFixture;
  readonly sandbox: DynoSandboxInstance;
  readonly tracer: DynoTracerInstance;
  readonly abortSignal: AbortSignal;
  readonly repetition: number;
  readonly randomizationSeed: string;
}

export interface DynoAgentResult {
  readonly tokensUsed?: {
    readonly input: number;
    readonly output: number;
    readonly cachedInput: number;
  };
  readonly costMicros?: number;
  readonly humanInterventions?: number;
  readonly notes?: string;
}

export interface DynoAgentHarness {
  readonly name: string;
  readonly version: string;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly modelVersion?: string;
  readonly modelConfig?: Record<string, any>;
  readonly toolManifest: readonly string[];
  execute(context: DynoExecutionContext): Promise<DynoAgentResult | void>;
}

export interface DynoTracerInstance {
  readonly taskAttemptId: string;
  recordToolEvent(params: {
    toolName: string;
    commandClass?: string;
    input: any;
    output?: any;
    durationMs?: number;
    exitCode?: number;
    safetyClassification?: DynoSafetyClassification;
    startedOffsetMs?: number;
  }): DynoToolEventRecord;
  getEvents(): readonly DynoToolEventRecord[];
  getSafetyViolationsCount(): number;
  computeTraceSha256(): string;
}

// ============================================================================
// RUNNER & AGGREGATE RESULTS
// ============================================================================

export interface DynoTaskAttemptExecutionResult {
  readonly attempt: DynoTaskAttemptRecord;
  readonly toolEvents: readonly DynoToolEventRecord[];
  readonly graderResults: readonly DynoGraderResultRecord[];
  readonly fileChanges: DynoFileChangeSummary;
  readonly error?: string;
}

export interface DynoRunExecutionResult {
  readonly run: DynoRunRecord;
  readonly subject: DynoSubjectRecord;
  readonly environment: DynoEnvironmentRecord;
  readonly suite: DynoSuiteRecord;
  readonly attempts: readonly DynoTaskAttemptExecutionResult[];
  readonly summary: {
    readonly totalTasks: number;
    readonly tasksPassed: number;
    readonly completionRate: number; // 0..100
    readonly firstAttemptSuccessRate: number; // 0..100
    readonly hiddenTestsPassedRate: number; // 0..100
    readonly medianDurationMs: number;
    readonly medianToolCalls: number;
    readonly totalTokens: number;
    readonly totalCostMicros: number;
    readonly totalSafetyViolations: number;
    readonly totalUnnecessaryFilesChanged: number;
    readonly totalHumanInterventions: number;
    readonly dynoScore: number; // 0..1000
    readonly grade: string;
  };
}
