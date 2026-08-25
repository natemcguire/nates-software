import { describe, it, expect } from 'vitest';

export interface FeatureManifest {
  name: string;
  version: string;
  author: string;
  storage: string;
  schema: {
    tables: string[];
    wal_mode: boolean;
  };
  exports: string[];
}

export function validateFeatureManifest(manifest: Partial<FeatureManifest>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest.name) errors.push('Missing feature name');
  if (!manifest.exports || manifest.exports.length === 0) errors.push('Feature must declare at least one exported AST module');
  if (!manifest.schema || !manifest.schema.wal_mode) errors.push('Feature must explicitly declare schema.wal_mode = true');
  return { valid: errors.length === 0, errors };
}

describe('SLOPSHOP AST Feature Splicer & Manifest Contract', () => {
  it('should accept a compliant feature package', () => {
    const pkg: FeatureManifest = {
      name: 'wallart-triptych-slicer',
      version: '2.4.0',
      author: '@nate',
      storage: '/data/wallart.sqlite',
      schema: { tables: ['presets', 'photos'], wal_mode: true },
      exports: ['components/CanvasTriptych.tsx']
    };
    const result = validateFeatureManifest(pkg);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject manifest without WAL mode declaration', () => {
    const invalidPkg: any = {
      name: 'legacy-feature',
      exports: ['components/Bad.tsx'],
      schema: { tables: ['bad'], wal_mode: false }
    };
    const result = validateFeatureManifest(invalidPkg);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('wal_mode = true');
  });
});
