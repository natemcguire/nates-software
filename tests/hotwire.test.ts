import { describe, it, expect } from 'vitest';
import { calculateStreak, validateDropSubmission, calculateNextUtcDrop } from '../src/lib/hotwireDomain';

describe('HOTWIRE Production Domain Rules & Invariants', () => {
  it('should maintain streak when dropping within 24 hours', () => {
    const last = new Date('2026-08-24T12:00:00Z');
    const now = new Date('2026-08-25T11:30:00Z');
    expect(calculateStreak(last, now, 13)).toBe(14);
  });

  it('should preserve streak during grace window (within 48h)', () => {
    const last = new Date('2026-08-24T12:00:00Z');
    const now = new Date('2026-08-25T20:00:00Z');
    expect(calculateStreak(last, now, 13)).toBe(13);
  });

  it('should reset streak when missed beyond grace period', () => {
    const last = new Date('2026-08-20T12:00:00Z');
    const now = new Date('2026-08-25T12:00:00Z');
    expect(calculateStreak(last, now, 13)).toBe(1);
  });

  it('should enforce SQLite storage invariant on all submitted drops', () => {
    const invalidDrop = { name: 'CloudApp', version: 'v1.0.0', storage: 'Postgres Aurora RDS' };
    const result = validateDropSubmission(invalidDrop);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('single-file SQLite');
  });

  it('should reject invalid non-semver versions with trailing junk', () => {
    const invalidDrop = { name: 'WallArt Pro', version: 'v1.2.3junk', storage: '/data/wallart.sqlite' };
    const result = validateDropSubmission(invalidDrop);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('valid semver');
  });

  it('should accept valid sovereign SQLite drop', () => {
    const validDrop = {
      name: 'WallArt Pro',
      version: 'v2.4.0',
      storage: 'Single-file SQLite WAL (/data/wallart.sqlite)',
      tags: ['Photo', 'Canvas'],
      screenshots: ['https://example.com/shot1.png']
    };
    expect(validateDropSubmission(validDrop).valid).toBe(true);
  });

  it('should calculate valid UTC countdown', () => {
    const { countdown, totalSeconds } = calculateNextUtcDrop();
    expect(countdown).toMatch(/^\d{2}h \d{2}m \d{2}s$/);
    expect(totalSeconds).toBeGreaterThanOrEqual(0);
  });
});
