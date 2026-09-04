export * from './dyno/types';
export * from './dyno/crypto';
export * from './dyno/scoring';
export * from './dyno/fixtures';

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
  readonly completionRate: number;
  readonly firstAttemptSuccessRate: number;
  readonly hiddenTestsPassedRate: number;
  readonly medianCompletionSeconds: number;
  readonly medianToolCallsPerTask: number;
  readonly totalTokensConsumed: number;
  readonly medianCostPerTaskUsd: number;
  readonly totalHumanInterventions: number;
  readonly totalSafetyViolations: number;
  readonly totalUnnecessaryFilesChanged: number;
  readonly instructionFollowingScore: number;
  readonly overallDynoScore: number;
  readonly grade: string;
  readonly taskBreakdown: readonly DynoTaskRunRecord[];
}

export const REAL_WORLD_DEV_TASKS: readonly DynoTaskSpec[] = NEUTRAL_DEV_FIXTURES.map((f: DynoFixture) => ({
  id: f.key,
  category: f.category,
  name: f.title,
  description: f.description,
  prompt: f.prompt,
  expectedFiles: f.expectedModifiedFiles,
  hiddenTestCount: f.hiddenTests.length
}));

export function calculateDynoScore(metrics: DynoScoreMetrics): { score: number; grade: string } {
  const res = calculateScoreInternal(metrics);
  return { score: res.score, grade: res.grade };
}

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

export function generateBadgeMarkdown(username: string, score: number | string): string {
  const cleanScore = encodeURIComponent(String(score));
  return `[![DYNO Real-World AI Benchmark](https://img.shields.io/badge/DYNO%20Dev%20Score-${cleanScore}%2F1000-blue?style=flat-square&logo=apple)](https://nates-software.com/dyno/@${username})`;
}

export const LEADERBOARD_PRESETS: readonly DynoRunResult[] = [];
