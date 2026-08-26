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
    id: 'feat_dronehunter_scores',
    name: 'High Score Telemetry & Audio Synthesizer',
    version: '1.0.0',
    targetApp: 'dronehunter',
    ref: 'refs/features/dronehunter-scores/v1.0.0',
    description: 'High score leaderboard persistence in SQLite WAL and 8-bit sound effects synthesizer.',
    author: '@nate',
    astNodesAdded: 16,
    tablesCreated: ['high_scores', 'sound_effects'],
    walMode: true,
    cleanlinessScore: 99.8
  },
  {
    id: 'feat_pdf_raster',
    name: '300 DPI PDF Rasterizer & FCRA Validator',
    version: '1.0.0',
    targetApp: 'certified-mailer',
    ref: 'refs/features/pdf-rasterizer/v1.0.0',
    description: 'High-res rasterizer preventing printer layout substitutions during legal certified mailing.',
    author: '@nate',
    astNodesAdded: 24,
    tablesCreated: ['pdf_raster_caches', 'dispute_filings'],
    walMode: true,
    cleanlinessScore: 99.5
  },
  {
    id: 'feat_gemini_vision',
    name: 'Google Gemini 2.5 Flash Virtual Try-On',
    version: '1.0.0',
    targetApp: 'picfitai',
    ref: 'refs/features/gemini-tryon/v1.0.0',
    description: 'Photorealistic AI virtual try-on and garment segmentation pipeline.',
    author: '@sam',
    astNodesAdded: 18,
    tablesCreated: ['tryon_sessions', 'garment_masks'],
    walMode: true,
    cleanlinessScore: 99.2
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
