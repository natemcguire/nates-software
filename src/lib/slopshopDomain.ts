// Production Domain Logic for SLOPSHOP AST Feature Splicing

export interface ASTFeaturePackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly targetApp: string;
  readonly ref: string;
  readonly description: string;
  readonly author: string;
  readonly astNodesAdded: number;
  readonly tablesCreated: readonly string[];
  readonly walMode: boolean;
  readonly cleanlinessScore: number;
}

export const PRESET_FEATURES: readonly [ASTFeaturePackage, ...ASTFeaturePackage[]] = [
  {
    id: 'feat_triptych',
    name: '3-Piece Triptych Slicer & Matting',
    version: '2.4.0',
    targetApp: 'wallart',
    ref: 'refs/features/wallart-triptych/v2.4.0',
    description: 'Slices single canvas into 3 multi-panel museum displays with configurable gap offsets.',
    author: '@nate',
    astNodesAdded: 14,
    tablesCreated: ['triptych_splits', 'frame_presets'],
    walMode: true,
    cleanlinessScore: 99.8
  },
  {
    id: 'feat_ocr',
    name: 'OCR Receipt Scanner & Ledger',
    version: '1.2.0',
    targetApp: 'retro-calc',
    ref: 'refs/features/receipt-ocr/v1.2.0',
    description: 'Optical character recognition for receipts with instant SQLite balance journal insertions.',
    author: '@sam',
    astNodesAdded: 22,
    tablesCreated: ['receipt_scans', 'extracted_line_items'],
    walMode: true,
    cleanlinessScore: 99.4
  },
  {
    id: 'feat_polar',
    name: 'NMEA Polar Chart Telemetry Lock',
    version: '2.1.0',
    targetApp: 'sailtrack',
    ref: 'refs/features/nmea-polar/v2.1.0',
    description: 'Real-time polar performance curves and target VMG calculations against wind angle.',
    author: '@nate',
    astNodesAdded: 18,
    tablesCreated: ['polar_curves', 'telemetry_points'],
    walMode: true,
    cleanlinessScore: 98.8
  }
];

export type ValidationResult =
  | { readonly valid: true; readonly data: ASTFeaturePackage }
  | { readonly valid: false; readonly errors: readonly string[] };

export function validateAstFeature(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null) {
    return { valid: false, errors: ['Package manifest must be a non-null object.'] };
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.trim().length === 0) {
    errors.push('Feature must declare a non-empty string id.');
  }

  if (typeof obj.name !== 'string' || obj.name.trim().length < 3) {
    errors.push('Feature name must be a string of at least 3 characters.');
  }

  const version = typeof obj.version === 'string' ? obj.version.trim() : '';
  if (!version.match(/^v?\d+\.\d+\.\d+$/)) {
    errors.push('Feature version must follow standard semver (e.g. 1.0.0 or v1.0.0).');
  }

  if (typeof obj.targetApp !== 'string' || obj.targetApp.trim().length === 0) {
    errors.push('Feature targetApp must be a non-empty string.');
  }

  const ref = typeof obj.ref === 'string' ? obj.ref.trim() : '';
  if (!ref.match(/^refs\/features\/[a-z0-9-_]+\/v?\d+\.\d+\.\d+$/)) {
    errors.push('Feature ref must match canonical format: refs/features/<name>/<semver>');
  }

  if (typeof obj.description !== 'string' || obj.description.trim().length === 0) {
    errors.push('Feature description must be a non-empty string.');
  }

  if (typeof obj.author !== 'string' || obj.author.trim().length === 0) {
    errors.push('Feature author must be a non-empty string.');
  }

  if (typeof obj.astNodesAdded !== 'number' || obj.astNodesAdded <= 0 || !Number.isInteger(obj.astNodesAdded)) {
    errors.push('Feature astNodesAdded must be a positive integer.');
  }

  if (!Array.isArray(obj.tablesCreated) || obj.tablesCreated.length === 0) {
    errors.push('Feature must declare at least one isolated SQLite table in tablesCreated array.');
  } else {
    for (const t of obj.tablesCreated) {
      if (typeof t !== 'string' || !t.match(/^[a-z0-9_]+$/)) {
        errors.push(`Invalid SQLite table identifier: ${String(t)}`);
      }
    }
  }

  if (obj.walMode !== true) {
    errors.push('Feature schema must strictly declare walMode === true (boolean).');
  }

  if (typeof obj.cleanlinessScore !== 'number' || obj.cleanlinessScore < 0 || obj.cleanlinessScore > 100) {
    errors.push('Feature cleanlinessScore must be a number between 0 and 100.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      id: String(obj.id),
      name: String(obj.name),
      version,
      targetApp: String(obj.targetApp),
      ref,
      description: String(obj.description),
      author: String(obj.author),
      astNodesAdded: Number(obj.astNodesAdded),
      tablesCreated: obj.tablesCreated as string[],
      walMode: true,
      cleanlinessScore: Number(obj.cleanlinessScore)
    }
  };
}
