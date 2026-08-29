import { describe, it, expect } from 'vitest';
import {
  calculateDynoScore,
  generateBadgeMarkdown,
  REAL_WORLD_DEV_TASKS,
  LEADERBOARD_PRESETS
} from '../src/lib/dynoDomain';

describe('DYNO Real-World AI Developer Benchmark Suite', () => {
  it('should calculate credible real-world developer scores across all performance dimensions', () => {
    // Claude 3.7 Sonnet + Antigravity CLI preset
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

  it('should provide 10 verified real-world engineering task specs covering core workflows', () => {
    expect(REAL_WORLD_DEV_TASKS.length).toBe(10);
    const categories = REAL_WORLD_DEV_TASKS.map(t => t.category);
    expect(categories).toContain('explain_repo');
    expect(categories).toContain('find_bug');
    expect(categories).toContain('implement_feature');
    expect(categories).toContain('repair_test');
    expect(categories).toContain('modify_schema');
    expect(categories).toContain('resolve_conflict');
    expect(categories).toContain('refactor_safe');
    expect(categories).toContain('build_package');
    expect(categories).toContain('follow_repo_rules');
    expect(categories).toContain('recover_failure');
  });

  it('should generate valid Markdown badge snippet with dev score', () => {
    const badge = generateBadgeMarkdown('nate', 845);
    expect(badge).toContain('DYNO%20Dev%20Score-845%2F1000');
    expect(badge).toContain('https://nates-software.com/dyno/@nate');
  });

  it('should contain verified leaderboard presets comparing model harnesses', () => {
    expect(LEADERBOARD_PRESETS.length).toBeGreaterThanOrEqual(3);
    const topEntry = LEADERBOARD_PRESETS[0];
    expect(topEntry.subject.agentHarness).toContain('Antigravity CLI');
    expect(topEntry.overallDynoScore).toBeGreaterThan(800);
  });
});
