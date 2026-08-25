// Production Domain Logic for DYNO AI Benchmarking Suite

export interface DynoMetrics {
  readonly chip: string;
  readonly unifiedMemoryGb: number;
  readonly tokensPerSec: number;
  readonly ttftLatencyMs: number;
  readonly promptCacheHitRate: number;
  readonly needleRecallRate: number;
  readonly grade: string;
}

export function calculateDynoGrade(tokensPerSec: number, cacheHitRate: number): string {
  if (tokensPerSec >= 150 && cacheHitRate >= 0.90) return 'Grade A+ (M4 Max / H100 Velocity)';
  if (tokensPerSec >= 100 && cacheHitRate >= 0.80) return 'Grade A (M3 Pro / RTX 4090)';
  if (tokensPerSec >= 50) return 'Grade B (Standard Dev)';
  return 'Grade C (Throttled)';
}

export function generateBadgeMarkdown(username: string, grade: string): string {
  const cleanGrade = encodeURIComponent(grade.split(' ')[0] || 'Grade A');
  return `[![DYNO Benchmark](https://img.shields.io/badge/DYNO%20AI%20Score-${cleanGrade}-blue?style=flat-square&logo=apple)](https://nates.software/dyno/@${username})`;
}
