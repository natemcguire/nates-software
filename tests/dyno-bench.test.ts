import { describe, it, expect } from 'vitest';
import {
  calculateDynoScore,
  generateBadgeMarkdown,
  REAL_WORLD_DEV_TASKS,
  LEADERBOARD_PRESETS,
  NEUTRAL_DEV_FIXTURES
} from '../src/lib/dynoDomain';

describe('DYNO Real-World AI Developer Benchmark Suite', () => {
  it('should calculate credible real-world developer scores deterministically across all performance dimensions', () => {
    const result = calculateDynoScore({
      tasksCompleted: 44,
      totalTasks: 50,
      firstAttemptSuccessRate: 0.72,
      hiddenTestsPassedRate: 0.94,
      medianCompletionSeconds: 138,
      humanInterventions: 2,
      safetyViolations: 0,
      unnecessaryFilesChanged: 0
    });

    expect(result.score).toBeGreaterThanOrEqual(800);
    expect(result.score).toBeLessThanOrEqual(950);
    expect(result.grade).toContain('Grade A+');
  });

  it('should penalize safety violations and excessive human interventions heavily', () => {
    const poorRun = calculateDynoScore({
      tasksCompleted: 25,
      totalTasks: 50,
      firstAttemptSuccessRate: 0.30,
      hiddenTestsPassedRate: 0.50,
      medianCompletionSeconds: 300,
      humanInterventions: 8,
      safetyViolations: 2,
      unnecessaryFilesChanged: 5
    });

    expect(poorRun.score).toBeLessThan(550);
    expect(poorRun.grade).toContain('Grade C');
  });

  it('should provide verified neutral task specs derived directly from canonical fixtures', () => {
    expect(REAL_WORLD_DEV_TASKS.length).toBe(NEUTRAL_DEV_FIXTURES.length);
    expect(REAL_WORLD_DEV_TASKS.length).toBeGreaterThanOrEqual(7);

    const categories = REAL_WORLD_DEV_TASKS.map(t => t.category);
    expect(categories).toContain('find_bug');
    expect(categories).toContain('implement_feature');
    expect(categories).toContain('repair_test');
    expect(categories).toContain('follow_repo_rules');
    expect(categories).toContain('recover_failure');

    REAL_WORLD_DEV_TASKS.forEach(t => {
      expect(t.id).toBeDefined();
      expect(t.name).toBeDefined();
      expect(t.prompt).toBeDefined();
      expect(t.expectedFiles.length).toBeGreaterThan(0);
      expect(t.hiddenTestCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('should generate valid Markdown badge snippet with dev score', () => {
    const badge = generateBadgeMarkdown('nate', 845);
    expect(badge).toContain('DYNO%20Dev%20Score-845%2F1000');
    expect(badge).toContain('https://nates-software.com/dyno/@nate');
  });

  it('should eliminate hardcoded fabricated leaderboard presets in favor of canonical D1 querying', () => {
    expect(LEADERBOARD_PRESETS).toEqual([]);
  });
});
