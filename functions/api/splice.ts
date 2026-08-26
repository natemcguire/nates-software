// POST /api/splice - Execute AST feature splicing & welding with conflict detection & reversible patches
// GET /api/splice - Retrieve available AST feature packages and splicer capabilities

import {
  spliceMultipleFeatures,
  detectConflicts,
  FeatureCodePayload,
  SpliceOptions,
  SpliceResult
} from '../../src/lib/slopshopBackend';
import { PRESET_FEATURES, type ASTFeaturePackage } from '../../src/lib/slopshopDomain';

// Pre-built feature source templates for preset packages
const PRESET_FEATURE_PAYLOADS: Record<string, FeatureCodePayload> = {
  feat_triptych: {
    id: 'feat_triptych',
    name: '3-Piece Triptych Slicer & Matting',
    version: '2.4.0',
    ref: 'refs/features/wallart-triptych/v2.4.0',
    targetApp: 'wallart',
    sourceCode: `import React, { useState } from 'react';

export interface TriptychProps {
  gapSize?: number;
  woodFinish?: string;
}

export function useTriptychSplitter() {
  const [panels, setPanels] = useState<string[]>(['Left Panel', 'Center Panel', 'Right Panel']);
  return { panels, setPanels };
}

export const TriptychViewer: React.FC<TriptychProps> = ({ gapSize = 16, woodFinish = 'walnut' }) => {
  return (
    <div className="triptych-frame-display" data-finish={woodFinish} style={{ gap: gapSize }}>
      <div className="panel panel-1">Panel 1 (Left)</div>
      <div className="panel panel-2">Panel 2 (Center)</div>
      <div className="panel panel-3">Panel 3 (Right)</div>
    </div>
  );
};`,
    routes: ['/api/triptych/split', '/api/triptych/presets'],
    tablesCreated: ['triptych_splits', 'frame_presets'],
    migrations: [
      {
        id: '20260825_001_triptych_splits',
        filename: '20260825_001_triptych_splits.sql',
        sequence: 1,
        upSql: `CREATE TABLE IF NOT EXISTS triptych_splits (
          id TEXT PRIMARY KEY,
          canvas_id TEXT NOT NULL,
          gap_inches REAL NOT NULL DEFAULT 2.0,
          border_finish TEXT NOT NULL DEFAULT 'walnut',
          created_at INTEGER NOT NULL
        );`,
        downSql: `DROP TABLE IF EXISTS triptych_splits;`,
        tablesCreated: ['triptych_splits']
      },
      {
        id: '20260825_002_frame_presets',
        filename: '20260825_002_frame_presets.sql',
        sequence: 2,
        dependencies: ['20260825_001_triptych_splits'],
        upSql: `CREATE TABLE IF NOT EXISTS frame_presets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          material TEXT NOT NULL,
          aspect_ratio TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );`,
        downSql: `DROP TABLE IF EXISTS frame_presets;`,
        tablesCreated: ['frame_presets']
      }
    ]
  },
  feat_ocr: {
    id: 'feat_ocr',
    name: 'OCR Receipt Scanner & Ledger',
    version: '1.2.0',
    ref: 'refs/features/receipt-ocr/v1.2.0',
    targetApp: 'retro-calc',
    sourceCode: `import React, { useState } from 'react';

export interface OcrReceiptResult {
  merchant: string;
  totalCents: number;
  date: string;
}

export function useReceiptOcr() {
  const [scanning, setScanning] = useState(false);
  return { scanning, setScanning };
}

export const OcrScannerWidget: React.FC = () => {
  return (
    <div className="ocr-scanner-widget p-3 border-2 border-dashed border-gray-400">
      <p className="font-mono text-xs">Drop receipt image or click to scan via Tesseract OCR</p>
    </div>
  );
};`,
    routes: ['/api/ocr/scan', '/api/ocr/ledger'],
    tablesCreated: ['receipt_scans', 'extracted_line_items'],
    migrations: [
      {
        id: '20260826_001_ocr_scans',
        filename: '20260826_001_ocr_scans.sql',
        sequence: 1,
        upSql: `CREATE TABLE IF NOT EXISTS receipt_scans (
          id TEXT PRIMARY KEY,
          image_hash TEXT NOT NULL,
          total_cents INTEGER NOT NULL,
          merchant TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );`,
        downSql: `DROP TABLE IF EXISTS receipt_scans;`,
        tablesCreated: ['receipt_scans']
      },
      {
        id: '20260826_002_extracted_line_items',
        filename: '20260826_002_extracted_line_items.sql',
        sequence: 2,
        dependencies: ['20260826_001_ocr_scans'],
        upSql: `CREATE TABLE IF NOT EXISTS extracted_line_items (
          id TEXT PRIMARY KEY,
          scan_id TEXT NOT NULL,
          description TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          FOREIGN KEY (scan_id) REFERENCES receipt_scans(id)
        );`,
        downSql: `DROP TABLE IF EXISTS extracted_line_items;`,
        tablesCreated: ['extracted_line_items']
      }
    ]
  },
  feat_polar: {
    id: 'feat_polar',
    name: 'NMEA Polar Chart Telemetry Lock',
    version: '2.1.0',
    ref: 'refs/features/nmea-polar/v2.1.0',
    targetApp: 'sailtrack',
    sourceCode: `import React, { useState, useEffect } from 'react';

export interface PolarTarget {
  twa: number;
  tws: number;
  targetVmg: number;
}

export function usePolarCurves() {
  const [telemetry, setTelemetry] = useState<PolarTarget[]>([]);
  return { telemetry, setTelemetry };
}

export const PolarChartView: React.FC = () => {
  return (
    <div className="polar-chart-telemetry bg-black text-cyan-400 p-2 font-mono">
      <span>Polar Chart Target VMG: 6.84 kts @ 42 deg</span>
    </div>
  );
};`,
    routes: ['/api/telemetry/polar', '/api/telemetry/stream'],
    tablesCreated: ['polar_curves', 'telemetry_points'],
    migrations: [
      {
        id: '20260827_001_polar_curves',
        filename: '20260827_001_polar_curves.sql',
        sequence: 1,
        upSql: `CREATE TABLE IF NOT EXISTS polar_curves (
          id TEXT PRIMARY KEY,
          hull_type TEXT NOT NULL,
          target_vmg REAL NOT NULL,
          true_wind_speed REAL NOT NULL,
          true_wind_angle REAL NOT NULL
        );`,
        downSql: `DROP TABLE IF EXISTS polar_curves;`,
        tablesCreated: ['polar_curves']
      }
    ]
  }
};

const DEFAULT_HOST_SOURCE = `import React from 'react';

export const App: React.FC = () => {
  return (
    <div className="host-container p-4 bg-gray-100 min-h-screen">
      <header className="mb-4">
        <h1 className="text-xl font-bold">Nates Software Sovereign App</h1>
      </header>
      <main className="app-body">
        <p>Base host workstation running with single-file SQLite database.</p>
      </main>
    </div>
  );
};

export default App;
`;

export const onRequestGet = async () => {
  return Response.json({
    success: true,
    engine: 'SLOPSHOP AST Splicer v4.2',
    supportedOperations: ['splice', 'conflict-detect', 'merge-migrations', 'rollback-patch'],
    presetFeatures: PRESET_FEATURES
  });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json();
    const {
      hostSource = DEFAULT_HOST_SOURCE,
      featureIds,
      features: rawFeatures,
      options = {}
    }: {
      hostSource?: string;
      featureIds?: string[];
      features?: (FeatureCodePayload | ASTFeaturePackage)[];
      options?: SpliceOptions;
    } = body;

    const featurePayloads: FeatureCodePayload[] = [];

    // 1. Resolve feature payloads from featureIds
    if (Array.isArray(featureIds) && featureIds.length > 0) {
      for (const fId of featureIds) {
        if (PRESET_FEATURE_PAYLOADS[fId]) {
          featurePayloads.push(PRESET_FEATURE_PAYLOADS[fId]);
        } else {
          // If not in presets, check PRESET_FEATURES metadata
          const meta = PRESET_FEATURES.find((p) => p.id === fId);
          if (meta) {
            featurePayloads.push({
              id: meta.id,
              name: meta.name,
              version: meta.version,
              ref: meta.ref,
              targetApp: meta.targetApp,
              sourceCode: `import React from 'react';\n\nexport const ${meta.id.replace(/^feat_/, '').toUpperCase()}Widget: React.FC = () => <div>Feature ${meta.name}</div>;`,
              tablesCreated: [...meta.tablesCreated]
            });
          } else {
            return Response.json(
              { success: false, error: `Unknown feature ID: ${fId}` },
              { status: 400 }
            );
          }
        }
      }
    }

    // 2. Resolve custom raw features
    if (Array.isArray(rawFeatures) && rawFeatures.length > 0) {
      for (const rf of rawFeatures) {
        const payload = rf as FeatureCodePayload;
        if (!payload.id || !payload.sourceCode) {
          return Response.json(
            { success: false, error: 'Custom feature payload must include id and sourceCode' },
            { status: 400 }
          );
        }
        featurePayloads.push(payload);
      }
    }

    if (featurePayloads.length === 0) {
      return Response.json(
        { success: false, error: 'No valid features provided. Supply featureIds or features array.' },
        { status: 400 }
      );
    }

    // 3. Pre-flight Conflict Check
    const conflicts = detectConflicts(hostSource, featurePayloads);
    if (conflicts.hasFatalConflicts && !options.allowWarnings) {
      return Response.json(
        {
          success: false,
          error: 'Fatal AST or Schema conflicts detected during pre-flight analysis.',
          conflicts: conflicts.conflicts,
          warnings: conflicts.warnings
        },
        { status: 409 }
      );
    }

    // 4. Perform AST Splice & Migration Weld
    const result: SpliceResult = spliceMultipleFeatures(hostSource, featurePayloads, options);

    if (!result.success) {
      return Response.json(
        {
          success: false,
          error: 'Failed to complete AST feature splice',
          errors: result.errors,
          conflicts: result.conflicts
        },
        { status: 422 }
      );
    }

    // 5. Optional D1 audit trail logging
    if (env?.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO audit_logs (id, event_type, payload, created_at)
          VALUES (?, 'ast_feature_splice', ?, ?)
        `).bind(
          result.reversiblePatch.id,
          JSON.stringify({
            features: featurePayloads.map((f) => f.id),
            astNodesAdded: result.astNodesAdded,
            tables: result.migrationPlan.tables
          }),
          Date.now()
        ).run();
      } catch {
        // Non-blocking if table not present in current env
      }
    }

    return Response.json({
      success: true,
      splicedSource: result.splicedSource,
      astNodesAdded: result.astNodesAdded,
      injectedSymbols: result.injectedSymbols,
      conflicts: result.conflicts,
      reversiblePatch: result.reversiblePatch,
      migrationPlan: result.migrationPlan,
      message: `Successfully spliced ${featurePayloads.length} feature(s) into host AST`
    });
  } catch (err: any) {
    return Response.json(
      { success: false, error: `AST Splicer internal error: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
};
