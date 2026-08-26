import { describe, it, expect } from 'vitest';
import {
  parseComponentTree,
  detectExportedInterfaces,
  mergeImportDeclarations,
  detectConflicts,
  mergeMigrations,
  generateReversiblePatch,
  applyForwardPatch,
  applyRollbackPatch,
  spliceAstFeature,
  spliceMultipleFeatures,
  computeSha256,
  FeatureCodePayload
} from '../src/lib/slopshopBackend';
import { onRequestGet, onRequestPost } from '../functions/api/splice';

describe('SLOPSHOP AST Feature Splicer & Backend Logic', () => {
  const sampleHostCode = `import React, { useState } from 'react';
import { Header } from './Header';

export interface HostProps {
  title: string;
}

export function App({ title }: HostProps) {
  const [activeTab, setActiveTab] = useState('main');

  return (
    <div className="host-application">
      <Header title={title} />
      <main className="content">
        <h1>Welcome</h1>
      </main>
    </div>
  );
}

export default App;
`;

  const sampleTriptychFeature: FeatureCodePayload = {
    id: 'feat_triptych',
    name: 'Triptych Slicer',
    version: '2.4.0',
    sourceCode: `import React, { useState } from 'react';

export interface TriptychProps {
  gapSize?: number;
}

export function useTriptych() {
  const [panels, setPanels] = useState<string[]>(['Left', 'Center', 'Right']);
  return { panels, setPanels };
}

export const TriptychViewer: React.FC<TriptychProps> = ({ gapSize = 10 }) => {
  return <div className="triptych-viewer">Triptych Panels ({gapSize}px gap)</div>;
};
`,
    routes: ['/api/triptych/split'],
    tablesCreated: ['triptych_splits'],
    migrations: [
      {
        id: '20260825_001_triptych',
        filename: '20260825_001_triptych.sql',
        sequence: 1,
        upSql: 'CREATE TABLE triptych_splits (id TEXT PRIMARY KEY, gap REAL);',
        downSql: 'DROP TABLE triptych_splits;'
      }
    ]
  };

  const sampleOcrFeature: FeatureCodePayload = {
    id: 'feat_ocr',
    name: 'Receipt OCR Scanner',
    version: '1.2.0',
    sourceCode: `import React, { useEffect } from 'react';

export interface OcrResult {
  merchant: string;
  total: number;
}

export function useOcrEngine() {
  return { status: 'idle' };
}

export const OcrScanner: React.FC = () => {
  return <div className="ocr-scanner">OCR Scanner Box</div>;
};
`,
    routes: ['/api/ocr/scan'],
    tablesCreated: ['receipt_scans'],
    migrations: [
      {
        id: '20260826_001_ocr',
        filename: '20260826_001_ocr.sql',
        sequence: 2,
        upSql: 'CREATE TABLE receipt_scans (id TEXT PRIMARY KEY, merchant TEXT);',
        downSql: 'DROP TABLE receipt_scans;'
      }
    ]
  };

  describe('1. AST Parsing & Interface Detection', () => {
    it('should parse component trees and extract exports, imports, JSX tags, and hooks', () => {
      const parsed = parseComponentTree(sampleHostCode, 'App.tsx');
      expect(parsed.fileName).toBe('App.tsx');
      expect(parsed.nodeCount).toBeGreaterThan(0);

      // Check exports
      const exportNames = parsed.exports.map((e) => e.name);
      expect(exportNames).toContain('HostProps');
      expect(exportNames).toContain('App');

      // Check imports
      expect(parsed.imports.length).toBe(2);
      expect(parsed.imports[0].moduleSpecifier).toBe('react');
      expect(parsed.imports[0].namedImports.map((n) => n.name)).toContain('useState');

      // Check JSX elements
      expect(parsed.jsxElements).toContain('div');
      expect(parsed.jsxElements).toContain('Header');
      expect(parsed.jsxElements).toContain('main');

      // Check hooks
      expect(parsed.hooks).toContain('useState');
    });

    it('should detect specialized feature interfaces such as custom hooks and components', () => {
      const exports = detectExportedInterfaces(sampleTriptychFeature.sourceCode);
      const hookExp = exports.find((e) => e.name === 'useTriptych');
      const compExp = exports.find((e) => e.name === 'TriptychViewer');
      const ifaceExp = exports.find((e) => e.name === 'TriptychProps');

      expect(hookExp?.kind).toBe('hook');
      expect(compExp?.kind).toBe('component');
      expect(ifaceExp?.kind).toBe('interface');
    });
  });

  describe('2. Import Welding and Deduplication', () => {
    it('should merge imports from host and feature without duplicate module statements', () => {
      const hostParsed = parseComponentTree(sampleHostCode);
      const featParsed = parseComponentTree(sampleOcrFeature.sourceCode);

      const merged = mergeImportDeclarations(hostParsed.imports, featParsed.imports);
      expect(merged.length).toBe(2); // 'react' and './Header'

      const reactImport = merged.find((l) => l.includes("'react'"));
      expect(reactImport).toBeDefined();
      expect(reactImport).toContain('useState');
      expect(reactImport).toContain('useEffect');
    });
  });

  describe('3. Conflict Detector', () => {
    it('should report zero fatal conflicts for clean orthogonal features', () => {
      const conflicts = detectConflicts(sampleHostCode, [sampleTriptychFeature, sampleOcrFeature]);
      expect(conflicts.hasFatalConflicts).toBe(false);
      expect(conflicts.conflicts.length).toBe(0);
    });

    it('should detect duplicate database table collisions across features', () => {
      const collidingFeature: FeatureCodePayload = {
        id: 'feat_colliding_tables',
        name: 'Colliding Tables',
        version: '1.0.0',
        sourceCode: `export const Dummy = () => <div>Dummy</div>;`,
        tablesCreated: ['triptych_splits'] // Collides with sampleTriptychFeature
      };

      const conflicts = detectConflicts(sampleHostCode, [sampleTriptychFeature, collidingFeature]);
      expect(conflicts.hasFatalConflicts).toBe(true);
      const tableConflict = conflicts.conflicts.find((c) => c.type === 'table_collision');
      expect(tableConflict).toBeDefined();
      expect(tableConflict?.identifier).toBe('triptych_splits');
      expect(tableConflict?.featuresInvolved).toEqual(['feat_triptych', 'feat_colliding_tables']);
    });

    it('should detect route collisions between features', () => {
      const collidingRouteFeature: FeatureCodePayload = {
        id: 'feat_colliding_route',
        name: 'Colliding Route',
        version: '1.0.0',
        sourceCode: `export const RouteDummy = () => <div>Dummy</div>;`,
        routes: ['/api/triptych/split'] // Collides with sampleTriptychFeature
      };

      const conflicts = detectConflicts(sampleHostCode, [sampleTriptychFeature, collidingRouteFeature]);
      expect(conflicts.hasFatalConflicts).toBe(true);
      const routeConflict = conflicts.conflicts.find((c) => c.type === 'route_collision');
      expect(routeConflict).toBeDefined();
      expect(routeConflict?.identifier).toBe('/api/triptych/split');
    });

    it('should detect circular migration dependencies', () => {
      const cyclicFeat1: FeatureCodePayload = {
        id: 'feat_cycle_1',
        name: 'Cycle 1',
        version: '1.0.0',
        sourceCode: 'export const C1 = () => <div/>;',
        migrations: [
          {
            id: 'mig_1',
            filename: 'mig_1.sql',
            upSql: 'CREATE TABLE t1 (id TEXT);',
            dependencies: ['mig_2']
          }
        ]
      };

      const cyclicFeat2: FeatureCodePayload = {
        id: 'feat_cycle_2',
        name: 'Cycle 2',
        version: '1.0.0',
        sourceCode: 'export const C2 = () => <div/>;',
        migrations: [
          {
            id: 'mig_2',
            filename: 'mig_2.sql',
            upSql: 'CREATE TABLE t2 (id TEXT);',
            dependencies: ['mig_1']
          }
        ]
      };

      const conflicts = detectConflicts(sampleHostCode, [cyclicFeat1, cyclicFeat2]);
      expect(conflicts.hasFatalConflicts).toBe(true);
      expect(conflicts.conflicts.some((c) => c.type === 'migration_cycle')).toBe(true);
    });
  });

  describe('4. Automated Migration Merger', () => {
    it('should merge migrations in dependency order and assign sequential numbers', () => {
      const featA: FeatureCodePayload = {
        id: 'feat_a',
        name: 'Feature A',
        version: '1.0.0',
        sourceCode: 'export const A = () => <div/>;',
        migrations: [
          {
            id: 'mig_base',
            filename: '001_base.sql',
            sequence: 1,
            upSql: 'CREATE TABLE base_table (id TEXT PRIMARY KEY);',
            downSql: 'DROP TABLE base_table;'
          }
        ]
      };

      const featB: FeatureCodePayload = {
        id: 'feat_b',
        name: 'Feature B',
        version: '1.0.0',
        sourceCode: 'export const B = () => <div/>;',
        migrations: [
          {
            id: 'mig_child',
            filename: '002_child.sql',
            sequence: 2,
            dependencies: ['mig_base'],
            upSql: 'CREATE TABLE child_table (id TEXT PRIMARY KEY, base_id TEXT REFERENCES base_table(id));',
            downSql: 'DROP TABLE child_table;'
          }
        ]
      };

      const plan = mergeMigrations([featB, featA]);
      expect(plan.orderedMigrations.length).toBe(2);
      expect(plan.orderedMigrations[0].featureId).toBe('feat_a');
      expect(plan.orderedMigrations[0].filename).toContain('001_');
      expect(plan.orderedMigrations[1].featureId).toBe('feat_b');
      expect(plan.orderedMigrations[1].filename).toContain('002_');

      expect(plan.combinedUpSql).toContain('CREATE TABLE base_table');
      expect(plan.combinedUpSql).toContain('CREATE TABLE child_table');
      expect(plan.combinedDownSql).toContain('DROP TABLE child_table');
      expect(plan.totalChecksum.length).toBe(64);
    });

    it('should auto-generate synthetic migrations if tablesCreated is declared without SQL', () => {
      const featSynthetic: FeatureCodePayload = {
        id: 'feat_synth',
        name: 'Synthetic Tables',
        version: '1.0.0',
        sourceCode: 'export const Synth = () => <div/>;',
        tablesCreated: ['custom_kv_store']
      };

      const plan = mergeMigrations([featSynthetic]);
      expect(plan.orderedMigrations.length).toBe(1);
      expect(plan.combinedUpSql).toContain('CREATE TABLE IF NOT EXISTS custom_kv_store');
      expect(plan.combinedDownSql).toContain('DROP TABLE IF EXISTS custom_kv_store');
    });
  });

  describe('5. Reversible Patch Generator & Rollback', () => {
    it('should generate forward diff and rollback diff with exact checksum guarantees', () => {
      const orig = 'const x = 1;\nconst y = 2;\nconsole.log(x + y);';
      const mod = 'const x = 1;\nconst z = 99;\nconst y = 2;\nconsole.log(x + y + z);';

      const patch = generateReversiblePatch(orig, mod, ['feat_test']);
      expect(patch.originalChecksum).toBe(computeSha256(orig));
      expect(patch.modifiedChecksum).toBe(computeSha256(mod));
      expect(patch.forwardDiff).toContain('+const z = 99;');
      expect(patch.rollbackDiff).toContain('-const z = 99;');

      // Forward Patch Application
      const forwardRes = applyForwardPatch(orig, patch);
      expect(forwardRes.success).toBe(true);
      expect(forwardRes.result).toBe(mod);

      // Rollback Patch Application
      const rollbackRes = applyRollbackPatch(forwardRes.result, patch);
      expect(rollbackRes.success).toBe(true);
      expect(rollbackRes.result).toBe(orig);
    });

    it('should reject applying patch if baseline source checksum mismatches', () => {
      const orig = 'const a = 1;';
      const mod = 'const a = 1;\nconst b = 2;';
      const patch = generateReversiblePatch(orig, mod);

      const tamperedSource = 'const a = 999;';
      const forwardRes = applyForwardPatch(tamperedSource, patch);
      expect(forwardRes.success).toBe(false);
      expect(forwardRes.error).toContain('Patch rejection');
    });

    it('should reject rollback if modified source checksum mismatches', () => {
      const orig = 'const a = 1;';
      const mod = 'const a = 1;\nconst b = 2;';
      const patch = generateReversiblePatch(orig, mod);

      const tamperedMod = 'const a = 1;\nconst b = 999;';
      const rollbackRes = applyRollbackPatch(tamperedMod, patch);
      expect(rollbackRes.success).toBe(false);
      expect(rollbackRes.error).toContain('Rollback rejection');
    });
  });

  describe('6. Deep AST Feature Splicing & Multi-Feature Welding', () => {
    it('should splice a feature into host source and inject JSX, hooks, and merged imports', () => {
      const result = spliceAstFeature(sampleHostCode, sampleTriptychFeature);
      expect(result.success).toBe(true);
      expect(result.astNodesAdded).toBeGreaterThan(0);
      expect(result.injectedSymbols).toContain('TriptychViewer');
      expect(result.injectedSymbols).toContain('useTriptych');

      // Spliced source should contain the welded imports and declarations
      expect(result.splicedSource).toContain('TriptychViewer');
      expect(result.splicedSource).toContain('useTriptych()');
      expect(result.splicedSource).toContain('<TriptychViewer />');

      // Test that rollback patch works on the spliced source
      const rollback = applyRollbackPatch(result.splicedSource, result.reversiblePatch);
      expect(rollback.success).toBe(true);
      expect(rollback.result).toBe(sampleHostCode);
    });

    it('should splice multiple features simultaneously without collisions', () => {
      const result = spliceMultipleFeatures(sampleHostCode, [sampleTriptychFeature, sampleOcrFeature]);
      expect(result.success).toBe(true);
      expect(result.conflicts.hasFatalConflicts).toBe(false);
      expect(result.migrationPlan.orderedMigrations.length).toBe(2);
      expect(result.splicedSource).toContain('<TriptychViewer />');
      expect(result.splicedSource).toContain('<OcrScanner />');

      // Verify complete rollback
      const rollback = applyRollbackPatch(result.splicedSource, result.reversiblePatch);
      expect(rollback.success).toBe(true);
      expect(rollback.result).toBe(sampleHostCode);
    });

    it('should reject splice if fatal conflicts exist and return error messages', () => {
      const collidingFeature: FeatureCodePayload = {
        id: 'feat_colliding',
        name: 'Colliding',
        version: '1.0.0',
        sourceCode: 'export const Dummy = () => <div/>;',
        tablesCreated: ['triptych_splits']
      };

      const result = spliceMultipleFeatures(sampleHostCode, [sampleTriptychFeature, collidingFeature]);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain("Duplicate database table 'triptych_splits'");
    });
  });

  describe('7. Cloudflare Pages Function API Handler (/api/splice)', () => {
    it('GET /api/splice should return engine status and preset features', async () => {
      const res = await onRequestGet();
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.engine).toContain('SLOPSHOP');
      expect(json.presetFeatures.length).toBeGreaterThan(0);
    });

    it('POST /api/splice should execute splice with preset featureIds', async () => {
      const req = new Request('http://localhost/api/splice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features: [sampleTriptychFeature, sampleOcrFeature],
          hostSource: sampleHostCode
        })
      });

      const res = await onRequestPost({ request: req, env: {} });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.splicedSource).toContain('TriptychViewer');
      expect(json.splicedSource).toContain('OcrScannerWidget');
      expect(json.migrationPlan.orderedMigrations.length).toBe(2); // 1 from triptych, 1 from ocr
      expect(json.reversiblePatch).toBeDefined();
    });

    it('POST /api/splice should return 409 Conflict when fatal collisions are passed', async () => {
      const req = new Request('http://localhost/api/splice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features: [
            sampleTriptychFeature,
            {
              id: 'feat_dupe_table',
              name: 'Duplicate',
              version: '1.0.0',
              sourceCode: 'export const X = () => <div/>;',
              tablesCreated: ['triptych_splits']
            }
          ]
        })
      });

      const res = await onRequestPost({ request: req, env: {} });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.conflicts.length).toBeGreaterThan(0);
    });

    it('POST /api/splice should return 400 Bad Request on invalid payloads', async () => {
      const req = new Request('http://localhost/api/splice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featureIds: ['non_existent_feature_12345']
        })
      });

      const res = await onRequestPost({ request: req, env: {} });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Unknown feature ID');
    });
  });
});
