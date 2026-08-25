import { describe, it, expect } from 'vitest';
import { calculateDynoGrade, generateBadgeMarkdown } from '../src/lib/dynoDomain';

describe('DYNO Workstation Speedometer & Benchmarking Matrix', () => {
  it('should grant Grade A+ to high throughput + cached runs', () => {
    expect(calculateDynoGrade(167.4, 0.948)).toContain('Grade A+');
  });

  it('should downgrade if prompt cache hit rate is low despite raw throughput', () => {
    expect(calculateDynoGrade(160, 0.70)).toContain('Grade B');
  });

  it('should generate valid Markdown badge snippet', () => {
    const badge = generateBadgeMarkdown('nate', 'Grade A+');
    expect(badge).toContain('shields.io');
    expect(badge).toContain('nate');
  });
});
