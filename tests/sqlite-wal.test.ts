import { describe, it, expect } from 'vitest';
import { INITIAL_FLEET, validateRigContainer, formatBytes } from '../src/lib/rigDomain';

describe('RIG.EXE Micro-Dyno & Sovereign SQLite Invariants', () => {
  it('should validate all initial fleet containers', () => {
    expect(INITIAL_FLEET.length).toBeGreaterThan(0);
    INITIAL_FLEET.forEach((c) => {
      const result = validateRigContainer(c);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.memoryCapMb).toBe(256);
        expect(result.data.port).toBeGreaterThanOrEqual(3000);
      }
    });
  });

  it('should enforce 256MB memory cap constraint on micro-containers', () => {
    const invalidContainer = {
      ...INITIAL_FLEET[0],
      memoryCapMb: 1024
    };
    const result = validateRigContainer(invalidContainer);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('256MB');
    }
  });

  it('should reject non-integer or out-of-range ports', () => {
    expect(validateRigContainer({ ...INITIAL_FLEET[0], port: 3000.5 }).valid).toBe(false);
    expect(validateRigContainer({ ...INITIAL_FLEET[0], port: 80 }).valid).toBe(false);
  });

  it('should reject path traversal in sqlite volume path', () => {
    const invalidContainer = {
      ...INITIAL_FLEET[0],
      sqlitePath: '/data/../etc/passwd.sqlite'
    };
    const result = validateRigContainer(invalidContainer);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('without path traversal');
    }
  });

  it('should safely format edge case bytes and negative values', () => {
    expect(formatBytes(-100)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024 * 64)).toBe('64.0 KB');
    expect(formatBytes(15518920)).toBe('14.8 MB');
  });
});
