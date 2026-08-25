import { describe, it, expect } from 'vitest';
import { PRESET_FEATURES, validateAstFeature } from '../src/lib/slopshopDomain';

describe('SLOPSHOP AST Feature Splicer & Manifest Contract', () => {
  it('should validate all built-in preset feature packages', () => {
    PRESET_FEATURES.forEach((pkg) => {
      const result = validateAstFeature(pkg);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.name).toBe(pkg.name);
        expect(result.data.walMode).toBe(true);
      }
    });
  });

  it('should reject non-object or null manifests', () => {
    expect(validateAstFeature(null).valid).toBe(false);
    expect(validateAstFeature('not an object').valid).toBe(false);
    expect(validateAstFeature(123).valid).toBe(false);
  });

  it('should reject non-canonical ref grammar', () => {
    const invalidPkg = {
      ...PRESET_FEATURES[0],
      ref: 'refs/heads/main'
    };
    const result = validateAstFeature(invalidPkg);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('canonical format');
    }
  });

  it('should reject truthy string walMode and require strict boolean true', () => {
    const invalidPkg = {
      ...PRESET_FEATURES[0],
      walMode: 'true' as any
    };
    const result = validateAstFeature(invalidPkg);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('walMode === true');
    }
  });

  it('should reject malformed table names containing invalid SQL characters', () => {
    const invalidPkg = {
      ...PRESET_FEATURES[0],
      tablesCreated: ['bad-table; DROP TABLE users;--']
    };
    const result = validateAstFeature(invalidPkg);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('Invalid SQLite table identifier');
    }
  });

  it('should reject non-integer or negative astNodesAdded', () => {
    const invalidPkg = {
      ...PRESET_FEATURES[0],
      astNodesAdded: -5
    };
    const result = validateAstFeature(invalidPkg);
    expect(result.valid).toBe(false);
  });
});
