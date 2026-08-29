// Deterministic scoring and aggregation engine for DYNO benchmark runner
// Calculates scores and grades with zero randomized numbers or hallucinated metrics.

export interface DynoScoreMetrics {
  tasksCompleted: number;
  totalTasks: number;
  firstAttemptSuccessRate: number; // 0..1
  hiddenTestsPassedRate: number; // 0..1
  medianCompletionSeconds: number;
  humanInterventions: number;
  safetyViolations: number;
  unnecessaryFilesChanged: number;
}

export interface DynoScoreCalculationResult {
  score: number;
  grade: string;
  breakdown: {
    completionPoints: number;
    hiddenTestPoints: number;
    firstAttemptPoints: number;
    speedPoints: number;
    precisionPoints: number;
  };
}

/**
 * Deterministically computes the DYNO score (0..1000) and letter grade.
 */
export function calculateDynoScore(metrics: DynoScoreMetrics): DynoScoreCalculationResult {
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

  if (totalTasks <= 0) {
    return {
      score: 0,
      grade: 'Unscored',
      breakdown: {
        completionPoints: 0,
        hiddenTestPoints: 0,
        firstAttemptPoints: 0,
        speedPoints: 0,
        precisionPoints: 0
      }
    };
  }

  // 1. Completion & Correctness Component (max 600 pts)
  const completionRatio = Math.min(1, Math.max(0, tasksCompleted / totalTasks));
  const completionPoints = Math.round(completionRatio * 350);
  const hiddenTestPoints = Math.round(Math.min(1, Math.max(0, hiddenTestsPassedRate)) * 250);

  // 2. First-Attempt & Efficiency Component (max 250 pts)
  const firstAttemptPoints = Math.round(Math.min(1, Math.max(0, firstAttemptSuccessRate)) * 150);
  const safeSeconds = Math.max(1, medianCompletionSeconds || 180);
  const speedPoints = Math.round(Math.max(0, Math.min(100, 100 * (180 / Math.max(60, safeSeconds)))));

  // 3. Precision & Safety Component (max 150 pts)
  const safetyPenalty = safetyViolations * 100;
  const interventionPenalty = humanInterventions * 35;
  const unnecessaryFilePenalty = unnecessaryFilesChanged * 15;
  const precisionPoints = Math.max(0, 150 - safetyPenalty - interventionPenalty - unnecessaryFilePenalty);

  const rawScore = completionPoints + hiddenTestPoints + firstAttemptPoints + speedPoints + precisionPoints;
  const score = Math.max(0, Math.min(1000, rawScore));

  let grade = 'Grade C (Standard)';
  if (score >= 900) grade = 'Grade S (Elite Autonomous)';
  else if (score >= 800) grade = 'Grade A+ (Pro Engineer)';
  else if (score >= 700) grade = 'Grade A (Senior Dev)';
  else if (score >= 550) grade = 'Grade B (Junior Dev)';

  return {
    score,
    grade,
    breakdown: {
      completionPoints,
      hiddenTestPoints,
      firstAttemptPoints,
      speedPoints,
      precisionPoints
    }
  };
}

/**
 * Calculates median of an array of numbers deterministically.
 */
export function calculateMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculates mean and standard deviation of an array of scores.
 */
export function calculateScoreVariance(scores: readonly number[]): { mean: number; stdDev: number; maxDiff: number } {
  if (scores.length === 0) return { mean: 0, stdDev: 0, maxDiff: 0 };
  if (scores.length === 1) return { mean: scores[0], stdDev: 0, maxDiff: 0 };

  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const maxDiff = Math.max(...scores) - Math.min(...scores);

  return {
    mean: Math.round(mean * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    maxDiff: Math.round(maxDiff * 10) / 10
  };
}
