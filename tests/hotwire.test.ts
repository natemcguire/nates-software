import { describe, it, expect } from 'vitest';

// Business logic rules for Hotwire drops and streaks
export function calculateStreak(lastDropDate: Date, currentDate: Date, currentStreak: number): number {
  const diffHours = (currentDate.getTime() - lastDropDate.getTime()) / (1000 * 60 * 60);
  if (diffHours <= 24) {
    return currentStreak + 1;
  } else if (diffHours <= 48) {
    return currentStreak; // Grace window within same day
  } else {
    return 1; // Streak reset
  }
}

export function validateDropSubmission(drop: { name: string; version: string; storage: string }): { valid: boolean; error?: string } {
  if (!drop.name || drop.name.trim().length < 3) {
    return { valid: false, error: 'App name must be at least 3 characters' };
  }
  if (!drop.version.match(/^v?\d+\.\d+\.\d+/)) {
    return { valid: false, error: 'Version must follow semver (e.g. v1.0.0)' };
  }
  if (!drop.storage.includes('.sqlite')) {
    return { valid: false, error: 'App must declare a single-file SQLite database volume' };
  }
  return { valid: true };
}

describe('Hotwire Daily Drops & Streak Engine', () => {
  it('should maintain streak when dropping within 24 hours', () => {
    const last = new Date('2026-08-24T12:00:00Z');
    const now = new Date('2026-08-25T11:30:00Z');
    expect(calculateStreak(last, now, 13)).toBe(14);
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
    expect(result.error).toContain('single-file SQLite');
  });

  it('should accept valid sovereign SQLite drop', () => {
    const validDrop = { name: 'WallArt Pro', version: 'v2.4.0', storage: 'Single-file SQLite WAL (/data/wallart.sqlite)' };
    expect(validateDropSubmission(validDrop).valid).toBe(true);
  });
});
