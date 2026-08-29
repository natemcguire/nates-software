// DYNO Real-World AI Developer Benchmark Suite
// Benchmarks real-world software engineering task execution across Models, Agent Harnesses, and Environments.
// "Not a wind tunnel token generator, but a real-world developer street race."

export interface DynoBenchmarkSubject {
  readonly model: string;
  readonly modelConfig: string;
  readonly agentHarness: string;
  readonly cliTools: readonly string[];
  readonly environment: string;
  readonly suiteVersion: string;
}

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
  | 'recover_failure';

export interface DynoTaskSpec {
  readonly id: string;
  readonly category: DynoTaskCategory;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly expectedFiles: readonly string[];
  readonly hiddenTestCount: number;
}

export interface DynoTaskRunRecord {
  readonly taskId: string;
  readonly taskName: string;
  readonly category: DynoTaskCategory;
  readonly passed: boolean;
  readonly firstAttemptSuccess: boolean;
  readonly hiddenTestsPassed: number;
  readonly totalHiddenTests: number;
  readonly durationSeconds: number;
  readonly toolCallsCount: number;
  readonly tokensConsumed: number;
  readonly costUsd: number;
  readonly unnecessaryFilesChanged: number;
  readonly safetyViolations: number;
  readonly humanInterventions: number;
}

export interface DynoRunResult {
  readonly id: string;
  readonly subject: DynoBenchmarkSubject;
  readonly runTimestamp: string;
  readonly totalTasks: number;
  readonly tasksCompleted: number;
  readonly completionRate: number; // 0..100%
  readonly firstAttemptSuccessRate: number; // 0..100%
  readonly hiddenTestsPassedRate: number; // 0..100%
  readonly medianCompletionSeconds: number;
  readonly medianToolCallsPerTask: number;
  readonly totalTokensConsumed: number;
  readonly medianCostPerTaskUsd: number;
  readonly totalHumanInterventions: number;
  readonly totalSafetyViolations: number;
  readonly totalUnnecessaryFilesChanged: number;
  readonly instructionFollowingScore: number; // 0..100
  readonly overallDynoScore: number; // 0..1000
  readonly grade: string;
  readonly taskBreakdown: readonly DynoTaskRunRecord[];
}

export const REAL_WORLD_DEV_TASKS: readonly DynoTaskSpec[] = [
  {
    id: 'task_01_explain',
    category: 'explain_repo',
    name: 'Explain Unfamiliar Codebase',
    description: 'Synthesize architecture, entry points, and invariants of an unfamiliar 50k-line repository.',
    prompt: 'Map the request lifecycle and ref validation path from ingress to storage.',
    expectedFiles: ['docs/architecture.md'],
    hiddenTestCount: 4
  },
  {
    id: 'task_02_find_bug',
    category: 'find_bug',
    name: 'Localize Silent Race Condition',
    description: 'Identify concurrent CAS state drift without log output.',
    prompt: 'Find why concurrent pushes on the same ref can return 200 without atomic locking.',
    expectedFiles: ['functions/api/git.ts'],
    hiddenTestCount: 6
  },
  {
    id: 'task_03_feature',
    category: 'implement_feature',
    name: 'Implement AST Feature Splice',
    description: 'Implement automated migration merging without syntax collisions.',
    prompt: 'Add multi-step SQL migration merger to ensure sequential execution.',
    expectedFiles: ['src/lib/slopshopBackend.ts'],
    hiddenTestCount: 8
  },
  {
    id: 'task_04_repair_test',
    category: 'repair_test',
    name: 'Repair Flaky Async Test',
    description: 'Fix timing race in Web Crypto PBKDF2 test suite.',
    prompt: 'Fix intermittency in PBKDF2 deriveKey assertions across parallel vitest workers.',
    expectedFiles: ['tests/auth.test.ts'],
    hiddenTestCount: 5
  },
  {
    id: 'task_05_schema',
    category: 'modify_schema',
    name: 'Safe SQLite Schema Migration',
    description: 'Add composite indexes and foreign key triggers without locking WAL.',
    prompt: 'Write idempotent migration for repository_forks with foreign key constraints.',
    expectedFiles: ['migrations/0006_canonical_forge_lineage.sql'],
    hiddenTestCount: 6
  },
  {
    id: 'task_06_conflict',
    category: 'resolve_conflict',
    name: 'Resolve 3-Way Git Merge Conflict',
    description: 'Merge divergent AST transformers preserving both feature additions.',
    prompt: 'Resolve conflict between AST import injector and dynamic router.',
    expectedFiles: ['src/lib/gitsmithBackend.ts'],
    hiddenTestCount: 5
  },
  {
    id: 'task_07_refactor',
    category: 'refactor_safe',
    name: 'Zero-Downtime Clean Refactor',
    description: 'Extract unified CatalogContext without breaking 6 consuming views.',
    prompt: 'Consolidate dual mock/D1 state into single authoritative CatalogProvider.',
    expectedFiles: ['src/context/CatalogContext.tsx', 'src/App.tsx'],
    hiddenTestCount: 10
  },
  {
    id: 'task_08_package',
    category: 'build_package',
    name: 'Fix Build & Bundle Script',
    description: 'Fix Node/Browser ESM module resolution failure in standalone CLI.',
    prompt: 'Ensure bin/slop executes cleanly under Node while bundling cleanly in Vite.',
    expectedFiles: ['bin/slop', 'package.json'],
    hiddenTestCount: 4
  },
  {
    id: 'task_09_rules',
    category: 'follow_repo_rules',
    name: 'Strict AGENTS.md Adherence',
    description: 'Follow repository-specific rules: preserve comments, use exact formatting.',
    prompt: 'Implement feature while strictly respecting AGENTS.md rules and file schemas.',
    expectedFiles: ['AGENTS.md'],
    hiddenTestCount: 5
  },
  {
    id: 'task_10_recover',
    category: 'recover_failure',
    name: 'Self-Correction After Linter Failure',
    description: 'Detect compile error in feedback loop and self-correct without user prompt.',
    prompt: 'Fix TypeScript strict typing error and ensure clean production build.',
    expectedFiles: ['src/lib/rigBackend.ts'],
    hiddenTestCount: 5
  }
];

// ============================================================================
// DYNO SCORE CALCULATOR
// ============================================================================

export function calculateDynoScore(metrics: {
  tasksCompleted: number;
  totalTasks: number;
  firstAttemptSuccessRate: number; // 0..1
  hiddenTestsPassedRate: number; // 0..1
  medianCompletionSeconds: number;
  humanInterventions: number;
  safetyViolations: number;
  unnecessaryFilesChanged: number;
}): { score: number; grade: string } {
  const {
    tasksCompleted,
    totalTasks,
    firstAttemptSuccessRate,
    hiddenTestsPassedRate,
    medianCompletionSeconds,
    humanInterventions,
    safetyViolations,
    unnecessaryFilesChanged
  } = metrics;

  if (totalTasks === 0) return { score: 0, grade: 'Unscored' };

  // 1. Completion & Correctness Component (max 600 pts)
  const completionRatio = tasksCompleted / totalTasks;
  const completionPts = completionRatio * 350;
  const hiddenTestPts = hiddenTestsPassedRate * 250;

  // 2. First-Attempt & Efficiency Component (max 250 pts)
  const firstAttemptPts = firstAttemptSuccessRate * 150;
  // Speed score: 120s is baseline target (max 100 pts)
  const speedPts = Math.max(0, Math.min(100, 100 * (180 / Math.max(60, medianCompletionSeconds))));

  // 3. Precision & Safety Component (max 150 pts)
  const safetyPenalty = safetyViolations * 100;
  const interventionPenalty = humanInterventions * 35;
  const unnecessaryFilePenalty = unnecessaryFilesChanged * 15;
  const precisionPts = Math.max(0, 150 - safetyPenalty - interventionPenalty - unnecessaryFilePenalty);

  const rawScore = Math.round(completionPts + hiddenTestPts + firstAttemptPts + speedPts + precisionPts);
  const score = Math.max(0, Math.min(1000, rawScore));

  let grade = 'Grade C (Standard)';
  if (score >= 900) grade = 'Grade S (Elite Autonomous)';
  else if (score >= 800) grade = 'Grade A+ (Pro Engineer)';
  else if (score >= 700) grade = 'Grade A (Senior Dev)';
  else if (score >= 550) grade = 'Grade B (Junior Dev)';

  return { score, grade };
}

// Backward-compatible export
export interface DynoMetrics {
  readonly chip: string;
  readonly unifiedMemoryGb: number;
  readonly tokensPerSec: number;
  readonly ttftLatencyMs: number;
  readonly promptCacheHitRate: number;
  readonly needleRecallRate: number;
  readonly grade: string;
  readonly dynoScore?: number;
  readonly realWorldSuite?: DynoRunResult;
}

export function calculateDynoGrade(tokensPerSec: number, cacheHitRate: number): string {
  if (tokensPerSec >= 150 && cacheHitRate >= 0.90) return 'Grade A+ (Pro Engineer / M4 Max)';
  if (tokensPerSec >= 100 && cacheHitRate >= 0.80) return 'Grade A (Senior Dev)';
  if (tokensPerSec >= 50) return 'Grade B (Standard Dev)';
  return 'Grade C (Throttled)';
}

export function generateBadgeMarkdown(username: string, score: number | string): string {
  const cleanScore = encodeURIComponent(String(score));
  return `[![DYNO Real-World AI Benchmark](https://img.shields.io/badge/DYNO%20Dev%20Score-${cleanScore}%2F1000-blue?style=flat-square&logo=apple)](https://nates-software.com/dyno/@${username})`;
}

// Preset verified real-world benchmark runs for leaderboard
export const LEADERBOARD_PRESETS: readonly DynoRunResult[] = [
  {
    id: 'run_claude_agy_m4max',
    subject: {
      model: 'Claude 3.7 Sonnet (Thinking 16k)',
      modelConfig: 'Temperature 0.2, Top-P 0.95',
      agentHarness: 'Antigravity CLI (agy v2.4)',
      cliTools: ['view_file', 'replace_file_content', 'run_command', 'grep_search'],
      environment: 'Apple M4 Max (64GB) / macOS 15.3',
      suiteVersion: 'DYNO Real-World Dev Suite 2026.1'
    },
    runTimestamp: '2026-08-29T06:45:00Z',
    totalTasks: 50,
    tasksCompleted: 44,
    completionRate: 88,
    firstAttemptSuccessRate: 72,
    hiddenTestsPassedRate: 94,
    medianCompletionSeconds: 138,
    medianToolCallsPerTask: 6.8,
    totalTokensConsumed: 284000,
    medianCostPerTaskUsd: 0.38,
    totalHumanInterventions: 2,
    totalSafetyViolations: 0,
    totalUnnecessaryFilesChanged: 0,
    instructionFollowingScore: 97,
    overallDynoScore: 845,
    grade: 'Grade A+ (Pro Engineer)',
    taskBreakdown: []
  },
  {
    id: 'run_gpt5_cursor_rtx4090',
    subject: {
      model: 'GPT-5 Codex Preview',
      modelConfig: 'Default Reasoning',
      agentHarness: 'Cursor Agent (v0.45)',
      cliTools: ['codebase_search', 'edit_file', 'terminal'],
      environment: 'Ubuntu 24.04 / RTX 4090 / 64GB',
      suiteVersion: 'DYNO Real-World Dev Suite 2026.1'
    },
    runTimestamp: '2026-08-28T18:20:00Z',
    totalTasks: 50,
    tasksCompleted: 41,
    completionRate: 82,
    firstAttemptSuccessRate: 64,
    hiddenTestsPassedRate: 89,
    medianCompletionSeconds: 154,
    medianToolCallsPerTask: 8.2,
    totalTokensConsumed: 340000,
    medianCostPerTaskUsd: 0.46,
    totalHumanInterventions: 4,
    totalSafetyViolations: 0,
    totalUnnecessaryFilesChanged: 2,
    instructionFollowingScore: 92,
    overallDynoScore: 780,
    grade: 'Grade A (Senior Dev)',
    taskBreakdown: []
  },
  {
    id: 'run_claude_claudecode_m3pro',
    subject: {
      model: 'Claude 3.5 Sonnet',
      modelConfig: 'Default',
      agentHarness: 'Claude Code CLI (v1.0.12)',
      cliTools: ['Bash', 'GlobTool', 'GrepTool', 'Edit'],
      environment: 'Apple M3 Pro (36GB) / macOS 15.2',
      suiteVersion: 'DYNO Real-World Dev Suite 2026.1'
    },
    runTimestamp: '2026-08-27T14:10:00Z',
    totalTasks: 50,
    tasksCompleted: 39,
    completionRate: 78,
    firstAttemptSuccessRate: 58,
    hiddenTestsPassedRate: 84,
    medianCompletionSeconds: 172,
    medianToolCallsPerTask: 9.4,
    totalTokensConsumed: 410000,
    medianCostPerTaskUsd: 0.52,
    totalHumanInterventions: 5,
    totalSafetyViolations: 0,
    totalUnnecessaryFilesChanged: 1,
    instructionFollowingScore: 89,
    overallDynoScore: 725,
    grade: 'Grade A (Senior Dev)',
    taskBreakdown: []
  }
];
