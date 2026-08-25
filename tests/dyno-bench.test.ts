import { describe, it, expect } from 'vitest';

export function calculateDynoGrade(tokensPerSec: number, cacheHitRate: number): string {
  if (tokensPerSec >= 150 && cacheHitRate >= 0.90) return 'Grade A+ (M4 Max / H100 Velocity)';
  if (tokensPerSec >= 100 && cacheHitRate >= 0.80) return 'Grade A (M3 Pro / RTX 4090)';
  if (tokensPerSec >= 50) return 'Grade B (Standard Dev)';
  return 'Grade C (Throttled)';
}

describe('DYNO Workstation Speedometer & Benchmarking Matrix', () => {
  it('should grant Grade A+ to high throughput + cached runs', () => {
    expect(calculateDynoGrade(167, 0.948)).toContain('Grade A+');
  });

  it('should downgrade if prompt cache hit rate is low despite raw throughput', () => {
    expect(calculateDynoGrade(160, 0.70)).toContain('Grade B');
  });
});
