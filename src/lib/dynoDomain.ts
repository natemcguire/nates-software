// DYNO Real-World AI Developer Benchmark Suite - Domain & Interface Layer
// Re-exports canonical types and deterministic runners aligned with migration 0007.
// Zero random/fabricated scores, zero hardcoded verified leaderboards.

export * from './dyno/types';
export * from './dyno/crypto';
export * from './dyno/scoring';
export * from './dyno/fixtures';
export * from './dyno/trace';
export * from './dyno/grader';

import {
  DynoFixture,
  DynoTaskCategory
} from './dyno/types';
import { NEUTRAL_DEV_FIXTURES } from './dyno/fixtures';
import { DynoScoreMetrics, calculateDynoScore as calculateScoreInternal } from './dyno/scoring';

export interface DynoBenchmarkSubject {
  readonly model: string;
  readonly modelConfig: string;
  readonly agentHarness: string;
  readonly cliTools: readonly string[];
  readonly environment: string;
  readonly suiteVersion: string;
}

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

/**
 * Neutral real-world developer tasks under test, derived deterministically from canonical fixtures.
 */
export const REAL_WORLD_DEV_TASKS: readonly DynoTaskSpec[] = NEUTRAL_DEV_FIXTURES.map((f: DynoFixture) => ({
  id: f.key,
  category: f.category,
  name: f.title,
  description: f.description,
  prompt: f.prompt,
  expectedFiles: f.expectedModifiedFiles,
  hiddenTestCount: f.hiddenTests.length
}));

/**
 * Deterministically calculates DYNO score (0..1000) and letter grade with zero randomized numbers.
 */
export function calculateDynoScore(metrics: DynoScoreMetrics): { score: number; grade: string } {
  const res = calculateScoreInternal(metrics);
  return { score: res.score, grade: res.grade };
}

/**
 * Backward-compatible grade calculator supporting both score (0..1000) and legacy throughput metrics.
 */
export function calculateDynoGrade(tokensPerSecOrScore: number, cacheHitRate?: number): string {
  if (typeof cacheHitRate === 'number') {
    if (tokensPerSecOrScore >= 150 && cacheHitRate >= 0.90) return 'Grade A+ (Pro Engineer / M4 Max)';
    if (tokensPerSecOrScore >= 100 && cacheHitRate >= 0.80) return 'Grade A (Senior Dev)';
    if (tokensPerSecOrScore >= 50) return 'Grade B (Standard Dev)';
    return 'Grade C (Throttled)';
  }
  if (tokensPerSecOrScore >= 900) return 'Grade S (Elite Autonomous)';
  if (tokensPerSecOrScore >= 800) return 'Grade A+ (Pro Engineer)';
  if (tokensPerSecOrScore >= 700) return 'Grade A (Senior Dev)';
  if (tokensPerSecOrScore >= 550) return 'Grade B (Junior Dev)';
  return 'Grade C (Standard)';
}

/**
 * Generates dynamic Markdown badge linking to verified DYNO score.
 */
export function generateBadgeMarkdown(username: string, score: number | string): string {
  const cleanScore = encodeURIComponent(String(score));
  return `[![DYNO Real-World AI Benchmark](https://img.shields.io/badge/DYNO%20Dev%20Score-${cleanScore}%2F1000-blue?style=flat-square&logo=apple)](https://nates-software.com/dyno/@${username})`;
}

/**
 * Canonical empty preset array. Eliminates fabricated/hardcoded verified leaderboards.
 * Verified runs are queried dynamically from canonical D1 dyno_runs database.
 */
export const LEADERBOARD_PRESETS: readonly DynoRunResult[] = [];
