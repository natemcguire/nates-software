// SLOPSHOP Deep AST Feature Splicer & Welding Engine
// Production implementation for AST parsing, safe AST injection, conflict detection, migration merging, and reversible patches.

import ts from 'typescript';

// ==========================================
// Types and Interfaces
// ==========================================

export interface ExportedInterface {
  name: string;
  kind: 'component' | 'hook' | 'function' | 'interface' | 'type' | 'class' | 'variable';
  params?: string[];
  returnType?: string;
  isDefault?: boolean;
}

export interface ImportSpecifierInfo {
  name: string;
  alias?: string;
  isTypeOnly?: boolean;
}

export interface ImportDeclarationInfo {
  moduleSpecifier: string;
  defaultImport?: string;
  namespaceImport?: string;
  namedImports: ImportSpecifierInfo[];
  isTypeOnly?: boolean;
}

export interface ParsedAstTree {
  sourceFile: ts.SourceFile;
  fileName: string;
  exports: ExportedInterface[];
  imports: ImportDeclarationInfo[];
  jsxElements: string[];
  routes: string[];
  hooks: string[];
  components: string[];
  nodeCount: number;
}

export interface FeatureMigration {
  id: string;
  filename: string;
  upSql: string;
  downSql?: string;
  dependencies?: string[];
  sequence?: number;
  tablesCreated?: string[];
}

export interface FeatureCodePayload {
  id: string;
  name: string;
  version: string;
  sourceCode: string;
  targetApp?: string;
  ref?: string;
  routes?: string[];
  tablesCreated?: string[];
  migrations?: FeatureMigration[];
  injectTarget?: {
    containerJsxTag?: string;
    insertionMode?: 'prepend' | 'append' | 'wrap';
    componentName?: string;
  };
}

export type ConflictSeverity = 'fatal' | 'warning';
export type ConflictType =
  | 'table_collision'
  | 'route_collision'
  | 'symbol_collision'
  | 'schema_mismatch'
  | 'import_collision'
  | 'migration_cycle';

export interface ConflictItem {
  type: ConflictType;
  severity: ConflictSeverity;
  identifier: string;
  featuresInvolved: string[];
  message: string;
  resolutionSuggestion: string;
}

export interface ConflictReport {
  hasFatalConflicts: boolean;
  conflicts: ConflictItem[];
  warnings: ConflictItem[];
}

export interface OrderedMigration {
  step: number;
  filename: string;
  featureId: string;
  upSql: string;
  downSql: string;
  checksum: string;
  tablesCreated: string[];
}

export interface MergedMigrationPlan {
  orderedMigrations: OrderedMigration[];
  combinedUpSql: string;
  combinedDownSql: string;
  totalChecksum: string;
  tables: string[];
}

export interface DiffHunk {
  originalStartLine: number;
  originalCount: number;
  originalLines: string[];
  modifiedStartLine: number;
  modifiedCount: number;
  modifiedLines: string[];
}

export interface ReversiblePatch {
  id: string;
  timestamp: number;
  originalChecksum: string;
  modifiedChecksum: string;
  forwardDiff: string;
  rollbackDiff: string;
  hunks: DiffHunk[];
  astNodesAdded: number;
  featuresApplied: string[];
}

export interface SpliceOptions {
  fileName?: string;
  targetComponentName?: string;
  containerJsxTag?: string;
  insertionMode?: 'prepend' | 'append' | 'wrap';
  allowWarnings?: boolean;
}

export interface SpliceResult {
  success: boolean;
  splicedSource: string;
  astNodesAdded: number;
  conflicts: ConflictReport;
  reversiblePatch: ReversiblePatch;
  migrationPlan: MergedMigrationPlan;
  injectedSymbols: string[];
  errors?: string[];
}

// ==========================================
// Cryptographic / Deterministic Hashing
// ==========================================

export function computeSha256(input: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  let i: number, j: number;
  let result = '';

  const words: number[] = [];
  const asciiBitLength = input.length * 8;

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  let str = input;
  for (i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    words[i >> 2] |= (code & 0xff) << (24 - (i % 4) * 8);
  }

  words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

  const w = new Array(64);

  for (i = 0; i < words.length; i += 16) {
    const oldHash = hash.slice(0);

    for (j = 0; j < 64; j++) {
      let w15: number, w2: number;
      if (j < 16) {
        w[j] = words[i + j] | 0;
      } else {
        w15 = w[j - 15];
        w2 = w[j - 2];
        const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
        const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }

      const s1 = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 = (hash[7] + s1 + ch + k[j] + w[j]) | 0;
      const s0 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 = (s0 + maj) | 0;

      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }

    for (j = 0; j < 8; j++) {
      hash[j] = (hash[j] + oldHash[j]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }

  return result;
}

// ==========================================
// 1. AST Parser & Interface Detection
// ==========================================

export function parseComponentTree(sourceCode: string, fileName: string = 'Component.tsx'): ParsedAstTree {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const exports: ExportedInterface[] = [];
  const imports: ImportDeclarationInfo[] = [];
  const jsxElements: string[] = [];
  const routes: string[] = [];
  const hooks: string[] = [];
  const components: string[] = [];
  let nodeCount = 0;

  function countNodes(node: ts.Node) {
    nodeCount++;
    ts.forEachChild(node, countNodes);
  }
  countNodes(sourceFile);

  function isExported(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  }

  function isDefaultExport(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  }

  function extractParams(declaration: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction): string[] {
    return declaration.parameters.map((p) => p.name.getText(sourceFile));
  }

  function visit(node: ts.Node) {
    // 1. Imports
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
      const isTypeOnly = node.importClause?.isTypeOnly ?? false;
      let defaultImport: string | undefined;
      let namespaceImport: string | undefined;
      const namedImports: ImportSpecifierInfo[] = [];

      if (node.importClause) {
        if (node.importClause.name) {
          defaultImport = node.importClause.name.getText(sourceFile);
        }
        if (node.importClause.namedBindings) {
          if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            namespaceImport = node.importClause.namedBindings.name.getText(sourceFile);
          } else if (ts.isNamedImports(node.importClause.namedBindings)) {
            for (const el of node.importClause.namedBindings.elements) {
              namedImports.push({
                name: el.propertyName ? el.propertyName.getText(sourceFile) : el.name.getText(sourceFile),
                alias: el.propertyName ? el.name.getText(sourceFile) : undefined,
                isTypeOnly: el.isTypeOnly
              });
            }
          }
        }
      }

      imports.push({
        moduleSpecifier,
        defaultImport,
        namespaceImport,
        namedImports,
        isTypeOnly
      });
    }

    // 2. Export Declarations (e.g. export { Foo, Bar })
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          exports.push({
            name: el.name.getText(sourceFile),
            kind: 'variable',
            isDefault: false
          });
        }
      }
    }

    // 3. Export Assignment (export default Identifier)
    if (ts.isExportAssignment(node)) {
      const expr = node.expression;
      exports.push({
        name: expr.getText(sourceFile),
        kind: 'component',
        isDefault: true
      });
    }

    // 4. Function Declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.getText(sourceFile);
      const isExp = isExported(node);
      const isDef = isDefaultExport(node);
      const isComp = /^[A-Z]/.test(name);
      const isHk = /^use[A-Z]/.test(name);

      if (isComp) components.push(name);
      if (isHk) hooks.push(name);

      if (isExp || isDef) {
        exports.push({
          name,
          kind: isHk ? 'hook' : isComp ? 'component' : 'function',
          params: extractParams(node),
          returnType: node.type?.getText(sourceFile),
          isDefault: isDef
        });
      }
    }

    // 5. Variable Statements (export const Foo = ... / hooks / components)
    if (ts.isVariableStatement(node)) {
      const isExp = isExported(node);
      const isDef = isDefaultExport(node);

      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.getText(sourceFile);
          const isComp = /^[A-Z]/.test(name);
          const isHk = /^use[A-Z]/.test(name);

          if (isComp) components.push(name);
          if (isHk) hooks.push(name);

          if (isExp || isDef) {
            let params: string[] | undefined;
            if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
              params = extractParams(decl.initializer);
            }
            exports.push({
              name,
              kind: isHk ? 'hook' : isComp ? 'component' : 'variable',
              params,
              returnType: decl.type?.getText(sourceFile),
              isDefault: isDef
            });
          }
        }
      }
    }

    // 6. Interfaces & Type Aliases
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.getText(sourceFile);
      if (isExported(node)) {
        exports.push({ name, kind: 'interface', isDefault: isDefaultExport(node) });
      }
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.getText(sourceFile);
      if (isExported(node)) {
        exports.push({ name, kind: 'type', isDefault: isDefaultExport(node) });
      }
    }

    // 7. JSX Elements
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      if (!jsxElements.includes(tagName)) {
        jsxElements.push(tagName);
      }
    }

    // 8. Route Registrations (e.g. path: '/...', router.get('/...'), route('/...'))
    if (ts.isCallExpression(node)) {
      const callText = node.expression.getText(sourceFile);
      if (
        callText.includes('route') ||
        callText.endsWith('.get') ||
        callText.endsWith('.post') ||
        callText.endsWith('.use')
      ) {
        if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
          const r = node.arguments[0].text;
          if (r.startsWith('/') && !routes.includes(r)) {
            routes.push(r);
          }
        }
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const propName = node.name.getText(sourceFile);
      if ((propName === 'path' || propName === 'route') && ts.isStringLiteral(node.initializer)) {
        const r = node.initializer.text;
        if (r.startsWith('/') && !routes.includes(r)) {
          routes.push(r);
        }
      }
    }

    // 9. React Hook Calls (e.g. useState, useEffect, useOcr)
    if (ts.isCallExpression(node)) {
      const exprText = node.expression.getText(sourceFile);
      if (/^use[A-Z]/.test(exprText) && !hooks.includes(exprText)) {
        hooks.push(exprText);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    sourceFile,
    fileName,
    exports,
    imports,
    jsxElements,
    routes,
    hooks,
    components,
    nodeCount
  };
}

export function detectExportedInterfaces(sourceCode: string, fileName: string = 'feature.ts'): ExportedInterface[] {
  const tree = parseComponentTree(sourceCode, fileName);
  return tree.exports;
}

// ==========================================
// 2. Safe AST Injection & Import Welding
// ==========================================

export function mergeImportDeclarations(
  hostImports: ImportDeclarationInfo[],
  featureImports: ImportDeclarationInfo[]
): string[] {
  const moduleMap = new Map<
    string,
    {
      defaultImport?: string;
      namespaceImport?: string;
      namedImports: Map<string, { alias?: string; isTypeOnly?: boolean }>;
      isTypeOnly: boolean;
    }
  >();

  function addImport(imp: ImportDeclarationInfo) {
    if (!moduleMap.has(imp.moduleSpecifier)) {
      moduleMap.set(imp.moduleSpecifier, {
        defaultImport: imp.defaultImport,
        namespaceImport: imp.namespaceImport,
        namedImports: new Map(),
        isTypeOnly: imp.isTypeOnly ?? false
      });
    }

    const existing = moduleMap.get(imp.moduleSpecifier)!;

    if (imp.defaultImport && !existing.defaultImport) {
      existing.defaultImport = imp.defaultImport;
    }
    if (imp.namespaceImport && !existing.namespaceImport) {
      existing.namespaceImport = imp.namespaceImport;
    }
    if (imp.isTypeOnly === false) {
      existing.isTypeOnly = false;
    }

    for (const named of imp.namedImports) {
      if (!existing.namedImports.has(named.name)) {
        existing.namedImports.set(named.name, {
          alias: named.alias,
          isTypeOnly: named.isTypeOnly
        });
      }
    }
  }

  hostImports.forEach(addImport);
  featureImports.forEach(addImport);

  const importLines: string[] = [];

  for (const [moduleSpecifier, info] of moduleMap.entries()) {
    const parts: string[] = [];
    if (info.defaultImport) {
      parts.push(info.defaultImport);
    }
    if (info.namespaceImport) {
      parts.push(`* as ${info.namespaceImport}`);
    }
    if (info.namedImports.size > 0) {
      const namedParts = Array.from(info.namedImports.entries()).map(([name, opt]) => {
        const typePrefix = opt.isTypeOnly ? 'type ' : '';
        return opt.alias ? `${typePrefix}${name} as ${opt.alias}` : `${typePrefix}${name}`;
      });
      parts.push(`{ ${namedParts.join(', ')} }`);
    }

    const typePrefix = info.isTypeOnly ? 'type ' : '';
    if (parts.length > 0) {
      importLines.push(`import ${typePrefix}${parts.join(', ')} from '${moduleSpecifier}';`);
    } else {
      importLines.push(`import '${moduleSpecifier}';`);
    }
  }

  return importLines;
}

// ==========================================
// 3. Conflict Detector
// ==========================================

export function detectConflicts(
  hostSource: string,
  features: FeatureCodePayload[]
): ConflictReport {
  const conflicts: ConflictItem[] = [];
  const warnings: ConflictItem[] = [];

  const hostTree = parseComponentTree(hostSource, 'Host.tsx');

  // Track tables
  const tableOwnerMap = new Map<string, string[]>();
  // Track routes
  const routeOwnerMap = new Map<string, string[]>();
  // Track exported symbols
  const symbolOwnerMap = new Map<string, string[]>();

  // Populate host routes and exports
  for (const r of hostTree.routes) {
    routeOwnerMap.set(r, ['host']);
  }
  for (const exp of hostTree.exports) {
    symbolOwnerMap.set(exp.name, ['host']);
  }

  // Iterate over features
  for (const feat of features) {
    const featTree = parseComponentTree(feat.sourceCode, `${feat.id}.tsx`);

    // 1. Table conflicts
    const declaredTables = new Set<string>();
    if (feat.tablesCreated) {
      feat.tablesCreated.forEach((t) => declaredTables.add(t));
    }
    if (feat.migrations) {
      for (const m of feat.migrations) {
        if (m.tablesCreated) {
          m.tablesCreated.forEach((t) => declaredTables.add(t));
        }
        // Extract CREATE TABLE statements via regex
        const matches = m.upSql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi);
        for (const match of matches) {
          declaredTables.add(match[1]);
        }
      }
    }

    for (const table of declaredTables) {
      const owners = tableOwnerMap.get(table) || [];
      owners.push(feat.id);
      tableOwnerMap.set(table, owners);
    }

    // 2. Route conflicts
    const declaredRoutes = new Set<string>(feat.routes || []);
    for (const r of featTree.routes) {
      declaredRoutes.add(r);
    }
    for (const r of declaredRoutes) {
      const owners = routeOwnerMap.get(r) || [];
      owners.push(feat.id);
      routeOwnerMap.set(r, owners);
    }

    // 3. Symbol conflicts
    for (const exp of featTree.exports) {
      const owners = symbolOwnerMap.get(exp.name) || [];
      owners.push(feat.id);
      symbolOwnerMap.set(exp.name, owners);
    }
  }

  // Analyze collisions
  for (const [table, owners] of tableOwnerMap.entries()) {
    if (owners.length > 1) {
      conflicts.push({
        type: 'table_collision',
        severity: 'fatal',
        identifier: table,
        featuresInvolved: owners,
        message: `Duplicate database table '${table}' detected across features [${owners.join(', ')}].`,
        resolutionSuggestion: `Prefix table name with feature namespace (e.g. '${owners[0]}_${table}').`
      });
    }
  }

  for (const [route, owners] of routeOwnerMap.entries()) {
    if (owners.length > 1) {
      conflicts.push({
        type: 'route_collision',
        severity: 'fatal',
        identifier: route,
        featuresInvolved: owners,
        message: `Route endpoint collision at '${route}' between [${owners.join(', ')}].`,
        resolutionSuggestion: `Scope routes under unique feature path prefixes or sub-routers.`
      });
    }
  }

  for (const [sym, owners] of symbolOwnerMap.entries()) {
    if (owners.length > 1) {
      const hasHost = owners.includes('host');
      conflicts.push({
        type: 'symbol_collision',
        severity: hasHost ? 'warning' : 'fatal',
        identifier: sym,
        featuresInvolved: owners,
        message: `Exported symbol '${sym}' collision across [${owners.join(', ')}].`,
        resolutionSuggestion: `Rename or alias export to avoid global naming collisions.`
      });
    }
  }

  // Check migration dependency cycles
  const allMigrations: FeatureMigration[] = [];
  for (const f of features) {
    if (f.migrations) {
      allMigrations.push(...f.migrations);
    }
  }

  const cycleCheck = checkMigrationCycles(allMigrations);
  if (cycleCheck.hasCycle) {
    conflicts.push({
      type: 'migration_cycle',
      severity: 'fatal',
      identifier: cycleCheck.cycleNode || 'migrations',
      featuresInvolved: cycleCheck.featuresInvolved || [],
      message: `Circular dependency detected in migrations: ${cycleCheck.path?.join(' -> ')}`,
      resolutionSuggestion: `Ensure migration dependencies form a Directed Acyclic Graph (DAG).`
    });
  }

  const fatalConflicts = conflicts.filter((c) => c.severity === 'fatal');
  const warningList = [...conflicts.filter((c) => c.severity === 'warning'), ...warnings];

  return {
    hasFatalConflicts: fatalConflicts.length > 0,
    conflicts: fatalConflicts,
    warnings: warningList
  };
}

function checkMigrationCycles(migrations: FeatureMigration[]): {
  hasCycle: boolean;
  cycleNode?: string;
  path?: string[];
  featuresInvolved?: string[];
} {
  const adj = new Map<string, string[]>();
  const idToFeat = new Map<string, string>();

  for (const m of migrations) {
    adj.set(m.id, m.dependencies || []);
    idToFeat.set(m.id, m.id);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  let cyclePath: string[] = [];

  function dfs(node: string, currentPath: string[]): boolean {
    visited.add(node);
    recStack.add(node);
    currentPath.push(node);

    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor, currentPath)) return true;
      } else if (recStack.has(neighbor)) {
        currentPath.push(neighbor);
        cyclePath = [...currentPath];
        return true;
      }
    }

    recStack.delete(node);
    currentPath.pop();
    return false;
  }

  for (const node of adj.keys()) {
    if (!visited.has(node)) {
      if (dfs(node, [])) {
        return {
          hasCycle: true,
          cycleNode: cyclePath[0],
          path: cyclePath,
          featuresInvolved: Array.from(new Set(cyclePath.map((id) => idToFeat.get(id) || id)))
        };
      }
    }
  }

  return { hasCycle: false };
}

// ==========================================
// 4. Automated Migration Merger
// ==========================================

export function mergeMigrations(features: FeatureCodePayload[]): MergedMigrationPlan {
  const migrationList: {
    featureId: string;
    migration: FeatureMigration;
    sortKey: string;
  }[] = [];

  const tablesSet = new Set<string>();

  for (const feat of features) {
    if (feat.tablesCreated) {
      feat.tablesCreated.forEach((t) => tablesSet.add(t));
    }

    if (feat.migrations && feat.migrations.length > 0) {
      for (const m of feat.migrations) {
        if (m.tablesCreated) {
          m.tablesCreated.forEach((t) => tablesSet.add(t));
        }

        const seqPrefix = m.sequence !== undefined ? String(m.sequence).padStart(6, '0') : '';
        const sortKey = `${seqPrefix}_${m.filename || m.id}`;

        migrationList.push({
          featureId: feat.id,
          migration: m,
          sortKey
        });
      }
    } else if (feat.tablesCreated && feat.tablesCreated.length > 0) {
      const syntheticUp = feat.tablesCreated
        .map((t) => `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT);`)
        .join('\n');
      const syntheticDown = feat.tablesCreated.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n');

      migrationList.push({
        featureId: feat.id,
        migration: {
          id: `mig_${feat.id}_init`,
          filename: `001_${feat.id}_init.sql`,
          upSql: syntheticUp,
          downSql: syntheticDown,
          tablesCreated: feat.tablesCreated
        },
        sortKey: `000001_${feat.id}_init`
      });
    }
  }

  const orderedList = topologicalSortMigrations(migrationList);

  const orderedMigrations: OrderedMigration[] = [];
  const upSqlBlocks: string[] = [];
  const downSqlBlocks: string[] = [];

  orderedList.forEach((item, index) => {
    const step = index + 1;
    const stepStr = String(step).padStart(3, '0');
    const safeBaseName = (item.migration.filename || item.migration.id).replace(/^\d+[-_]?/, '');
    const filename = `${stepStr}_${safeBaseName.endsWith('.sql') ? safeBaseName : `${safeBaseName}.sql`}`;

    const upSql = item.migration.upSql.trim();
    const downSql = (item.migration.downSql || `-- Down migration for ${filename}`).trim();
    const checksum = computeSha256(upSql);

    orderedMigrations.push({
      step,
      filename,
      featureId: item.featureId,
      upSql,
      downSql,
      checksum,
      tablesCreated: item.migration.tablesCreated || []
    });

    upSqlBlocks.push(`-- [Migration ${step}: ${filename} (${item.featureId})] --\n${upSql}`);
    downSqlBlocks.unshift(`-- [Rollback ${step}: ${filename} (${item.featureId})] --\n${downSql}`);
  });

  const combinedUpSql = upSqlBlocks.join('\n\n');
  const combinedDownSql = downSqlBlocks.join('\n\n');
  const totalChecksum = computeSha256(combinedUpSql);

  return {
    orderedMigrations,
    combinedUpSql,
    combinedDownSql,
    totalChecksum,
    tables: Array.from(tablesSet)
  };
}

function topologicalSortMigrations(
  items: { featureId: string; migration: FeatureMigration; sortKey: string }[]
): { featureId: string; migration: FeatureMigration; sortKey: string }[] {
  const itemMap = new Map<string, { featureId: string; migration: FeatureMigration; sortKey: string }>();
  items.forEach((it) => itemMap.set(it.migration.id, it));

  const visited = new Set<string>();
  const result: { featureId: string; migration: FeatureMigration; sortKey: string }[] = [];

  const sortedItems = [...items].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const item = itemMap.get(id);
    if (item && item.migration.dependencies) {
      for (const depId of item.migration.dependencies) {
        if (itemMap.has(depId)) {
          visit(depId);
        }
      }
    }

    if (item) {
      result.push(item);
    }
  }

  for (const it of sortedItems) {
    visit(it.migration.id);
  }

  return result;
}

// ==========================================
// 5. Reversible Patch Generator & Rollback
// ==========================================

export function computeLcsDiff(originalLines: string[], modifiedLines: string[]): DiffHunk[] {
  const n = originalLines.length;
  const m = modifiedLines.length;

  let start = 0;
  while (start < n && start < m && originalLines[start] === modifiedLines[start]) {
    start++;
  }

  let endA = n - 1;
  let endB = m - 1;
  while (endA >= start && endB >= start && originalLines[endA] === modifiedLines[endB]) {
    endA--;
    endB--;
  }

  const subA = originalLines.slice(start, endA + 1);
  const subB = modifiedLines.slice(start, endB + 1);

  if (subA.length === 0 && subB.length === 0) {
    return [];
  }

  const dp: number[][] = Array.from({ length: subA.length + 1 }, () => new Array(subB.length + 1).fill(0));

  for (let i = 1; i <= subA.length; i++) {
    for (let j = 1; j <= subB.length; j++) {
      if (subA[i - 1] === subB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = subA.length;
  let j = subB.length;
  const ops: { type: 'equal' | 'delete' | 'insert'; line: string; origIdx: number; modIdx: number }[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && subA[i - 1] === subB[j - 1]) {
      ops.unshift({ type: 'equal', line: subA[i - 1], origIdx: start + i - 1, modIdx: start + j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'insert', line: subB[j - 1], origIdx: start + i, modIdx: start + j - 1 });
      j--;
    } else if (i > 0) {
      ops.unshift({ type: 'delete', line: subA[i - 1], origIdx: start + i - 1, modIdx: start + j });
      i--;
    }
  }

  const hunks: DiffHunk[] = [];
  let k = 0;

  while (k < ops.length) {
    if (ops[k].type === 'equal') {
      k++;
      continue;
    }

    const hunkOrigLines: string[] = [];
    const hunkModLines: string[] = [];
    const origStart = ops[k].origIdx + 1;
    const modStart = ops[k].modIdx + 1;

    while (k < ops.length && ops[k].type !== 'equal') {
      if (ops[k].type === 'delete') {
        hunkOrigLines.push(ops[k].line);
      } else if (ops[k].type === 'insert') {
        hunkModLines.push(ops[k].line);
      }
      k++;
    }

    hunks.push({
      originalStartLine: origStart,
      originalCount: hunkOrigLines.length,
      originalLines: hunkOrigLines,
      modifiedStartLine: modStart,
      modifiedCount: hunkModLines.length,
      modifiedLines: hunkModLines
    });
  }

  return hunks;
}

export function generateReversiblePatch(
  originalSource: string,
  modifiedSource: string,
  featuresApplied: string[] = []
): ReversiblePatch {
  const originalLines = originalSource.split('\n');
  const modifiedLines = modifiedSource.split('\n');

  const originalChecksum = computeSha256(originalSource);
  const modifiedChecksum = computeSha256(modifiedSource);

  const hunks = computeLcsDiff(originalLines, modifiedLines);

  const forwardDiffLines: string[] = [
    `--- a/source`,
    `+++ b/source`,
    `@@ -1,${originalLines.length} +1,${modifiedLines.length} @@`
  ];
  const rollbackDiffLines: string[] = [
    `--- b/source`,
    `+++ a/source`,
    `@@ -1,${modifiedLines.length} +1,${originalLines.length} @@`
  ];

  for (const h of hunks) {
    forwardDiffLines.push(`@@ -${h.originalStartLine},${h.originalCount} +${h.modifiedStartLine},${h.modifiedCount} @@`);
    h.originalLines.forEach((l) => forwardDiffLines.push(`-${l}`));
    h.modifiedLines.forEach((l) => forwardDiffLines.push(`+${l}`));

    rollbackDiffLines.push(`@@ -${h.modifiedStartLine},${h.modifiedCount} +${h.originalStartLine},${h.originalCount} @@`);
    h.modifiedLines.forEach((l) => rollbackDiffLines.push(`-${l}`));
    h.originalLines.forEach((l) => rollbackDiffLines.push(`+${l}`));
  }

  const origTree = parseComponentTree(originalSource, 'orig.tsx');
  const modTree = parseComponentTree(modifiedSource, 'mod.tsx');
  const astNodesAdded = Math.max(0, modTree.nodeCount - origTree.nodeCount);

  return {
    id: `patch_${Date.now()}_${originalChecksum.slice(0, 8)}`,
    timestamp: Date.now(),
    originalChecksum,
    modifiedChecksum,
    forwardDiff: forwardDiffLines.join('\n'),
    rollbackDiff: rollbackDiffLines.join('\n'),
    hunks,
    astNodesAdded,
    featuresApplied
  };
}

export function applyForwardPatch(
  source: string,
  patch: ReversiblePatch
): { success: boolean; result: string; error?: string } {
  const currentChecksum = computeSha256(source);
  if (currentChecksum !== patch.originalChecksum) {
    return {
      success: false,
      result: source,
      error: `Patch rejection: input source checksum ${currentChecksum.slice(0, 8)} does not match patch baseline ${patch.originalChecksum.slice(0, 8)}`
    };
  }

  const lines = source.split('\n');
  const resultLines: string[] = [];
  let lineIdx = 0;

  for (const hunk of patch.hunks) {
    const targetIdx = hunk.originalStartLine - 1;
    while (lineIdx < targetIdx && lineIdx < lines.length) {
      resultLines.push(lines[lineIdx++]);
    }
    lineIdx += hunk.originalCount;
    resultLines.push(...hunk.modifiedLines);
  }

  while (lineIdx < lines.length) {
    resultLines.push(lines[lineIdx++]);
  }

  const result = resultLines.join('\n');
  const resChecksum = computeSha256(result);

  if (resChecksum !== patch.modifiedChecksum) {
    return {
      success: false,
      result,
      error: `Patch applied but result checksum mismatch: got ${resChecksum.slice(0, 8)}, expected ${patch.modifiedChecksum.slice(0, 8)}`
    };
  }

  return { success: true, result };
}

export function applyRollbackPatch(
  modifiedSource: string,
  patch: ReversiblePatch
): { success: boolean; result: string; error?: string } {
  const currentChecksum = computeSha256(modifiedSource);
  if (currentChecksum !== patch.modifiedChecksum) {
    return {
      success: false,
      result: modifiedSource,
      error: `Rollback rejection: source checksum ${currentChecksum.slice(0, 8)} does not match patch modified baseline ${patch.modifiedChecksum.slice(0, 8)}`
    };
  }

  const lines = modifiedSource.split('\n');
  const resultLines: string[] = [];
  let lineIdx = 0;

  for (const hunk of patch.hunks) {
    const targetIdx = hunk.modifiedStartLine - 1;
    while (lineIdx < targetIdx && lineIdx < lines.length) {
      resultLines.push(lines[lineIdx++]);
    }
    lineIdx += hunk.modifiedCount;
    resultLines.push(...hunk.originalLines);
  }

  while (lineIdx < lines.length) {
    resultLines.push(lines[lineIdx++]);
  }

  const result = resultLines.join('\n');
  const resChecksum = computeSha256(result);

  if (resChecksum !== patch.originalChecksum) {
    return {
      success: false,
      result,
      error: `Rollback applied but result checksum mismatch: got ${resChecksum.slice(0, 8)}, expected ${patch.originalChecksum.slice(0, 8)}`
    };
  }

  return { success: true, result };
}

// ==========================================
// 6. Deep AST Splicing & Welding Engine
// ==========================================

export function spliceAstFeature(
  hostSource: string,
  feature: FeatureCodePayload,
  options: SpliceOptions = {}
): SpliceResult {
  return spliceMultipleFeatures(hostSource, [feature], options);
}

export function spliceMultipleFeatures(
  hostSource: string,
  features: FeatureCodePayload[],
  options: SpliceOptions = {}
): SpliceResult {
  const fileName = options.fileName || 'App.tsx';

  // 1. Conflict Detection
  const conflicts = detectConflicts(hostSource, features);
  if (conflicts.hasFatalConflicts && !options.allowWarnings) {
    const emptyMigration = mergeMigrations([]);
    const emptyPatch = generateReversiblePatch(hostSource, hostSource);
    return {
      success: false,
      splicedSource: hostSource,
      astNodesAdded: 0,
      conflicts,
      reversiblePatch: emptyPatch,
      migrationPlan: emptyMigration,
      injectedSymbols: [],
      errors: conflicts.conflicts.map((c) => c.message)
    };
  }

  // 2. Parse Host and Features
  const hostTree = parseComponentTree(hostSource, fileName);
  const allFeatureImports: ImportDeclarationInfo[] = [];
  const topLevelDeclarationsToInject: string[] = [];
  const injectedSymbols: string[] = [];
  const componentsToRender: { name: string; tag: string; isHook: boolean }[] = [];

  for (const feat of features) {
    const featTree = parseComponentTree(feat.sourceCode, `${feat.id}.tsx`);
    allFeatureImports.push(...featTree.imports);

    // Identify exported components and hooks
    for (const exp of featTree.exports) {
      if (exp.kind === 'component') {
        componentsToRender.push({
          name: exp.name,
          tag: `<${exp.name} />`,
          isHook: false
        });
        injectedSymbols.push(exp.name);
      } else if (exp.kind === 'hook') {
        componentsToRender.push({
          name: exp.name,
          tag: `${exp.name}()`,
          isHook: true
        });
        injectedSymbols.push(exp.name);
      } else {
        injectedSymbols.push(exp.name);
      }
    }

    // Extract top-level non-import statements from feature
    const featStatements = extractTopLevelStatements(featTree);
    topLevelDeclarationsToInject.push(...featStatements);
  }

  // 3. Merge Imports
  const mergedImportLines = mergeImportDeclarations(hostTree.imports, allFeatureImports);

  // 4. Transform Host AST
  const splicedSource = performAstTransformation({
    hostSource,
    hostTree,
    mergedImportLines,
    topLevelDeclarationsToInject,
    componentsToRender,
    options
  });

  // 5. Build Reversible Patch
  const reversiblePatch = generateReversiblePatch(
    hostSource,
    splicedSource,
    features.map((f) => f.id)
  );

  // 6. Merge Migrations
  const migrationPlan = mergeMigrations(features);

  return {
    success: true,
    splicedSource,
    astNodesAdded: reversiblePatch.astNodesAdded,
    conflicts,
    reversiblePatch,
    migrationPlan,
    injectedSymbols
  };
}

function extractTopLevelStatements(parsed: ParsedAstTree): string[] {
  const statements: string[] = [];
  const sf = parsed.sourceFile;

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) {
      statements.push(stmt.getText(sf));
    }
  }

  return statements;
}

interface AstTransformContext {
  hostSource: string;
  hostTree: ParsedAstTree;
  mergedImportLines: string[];
  topLevelDeclarationsToInject: string[];
  componentsToRender: { name: string; tag: string; isHook: boolean }[];
  options: SpliceOptions;
}

function performAstTransformation(ctx: AstTransformContext): string {
  const { hostTree, mergedImportLines, topLevelDeclarationsToInject, componentsToRender, options } = ctx;
  const sf = hostTree.sourceFile;

  const hostNonImportStatements: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) {
      hostNonImportStatements.push(stmt.getText(sf));
    }
  }

  const targetCompName =
    options.targetComponentName ||
    hostTree.components[0] ||
    (hostTree.exports.find((e) => e.kind === 'component')?.name ?? 'App');

  let modifiedHostStatements = hostNonImportStatements.map((stmtText) => {
    if (stmtText.includes(`function ${targetCompName}`) || stmtText.includes(`const ${targetCompName}`)) {
      return injectIntoComponentSource(stmtText, componentsToRender, options);
    }
    return stmtText;
  });

  if (modifiedHostStatements.length === 0) {
    const renderedTags = componentsToRender
      .filter((c) => !c.isHook)
      .map((c) => `      ${c.tag}`)
      .join('\n');
    const compCode = `export const ${targetCompName}: React.FC = () => {\n  return (\n    <div className="spliced-container">\n${renderedTags}\n    </div>\n  );\n};`;
    modifiedHostStatements.push(compCode);
  }

  const resultBlocks: string[] = [];

  if (mergedImportLines.length > 0) {
    resultBlocks.push(mergedImportLines.join('\n'));
  }

  if (topLevelDeclarationsToInject.length > 0) {
    resultBlocks.push(topLevelDeclarationsToInject.join('\n\n'));
  }

  if (modifiedHostStatements.length > 0) {
    resultBlocks.push(modifiedHostStatements.join('\n\n'));
  }

  return resultBlocks.join('\n\n');
}

function injectIntoComponentSource(
  componentSource: string,
  componentsToRender: { name: string; tag: string; isHook: boolean }[],
  options: SpliceOptions
): string {
  let result = componentSource;

  // 1. Inject Hooks into Component body
  const hooksToInject = componentsToRender.filter((c) => c.isHook);
  if (hooksToInject.length > 0) {
    const hookCalls = hooksToInject.map((h) => `  ${h.tag};`).join('\n');
    const bodyStartIdx = result.indexOf('{');
    if (bodyStartIdx !== -1) {
      result = `${result.slice(0, bodyStartIdx + 1)}\n${hookCalls}${result.slice(bodyStartIdx + 1)}`;
    }
  }

  // 2. Inject JSX Elements into Return JSX Tree
  const jsxToInject = componentsToRender.filter((c) => !c.isHook);
  if (jsxToInject.length > 0) {
    const renderedTags = jsxToInject.map((c) => `        ${c.tag}`).join('\n');
    const insertionMode = options.insertionMode || 'append';

    const returnIdx = result.indexOf('return');
    if (returnIdx !== -1) {
      if (insertionMode === 'prepend') {
        const openMatch = result.slice(returnIdx).match(/<([a-zA-Z0-9_-]+)(?:[^>]*)>/);
        if (openMatch && openMatch.index !== undefined) {
          const insertPos = returnIdx + openMatch.index + openMatch[0].length;
          result = `${result.slice(0, insertPos)}\n${renderedTags}${result.slice(insertPos)}`;
        }
      } else {
        const lastCloseMatch = result.match(/<\/[a-zA-Z0-9_-]+>\s*;/);
        if (lastCloseMatch && lastCloseMatch.index !== undefined) {
          const insertPos = lastCloseMatch.index;
          result = `${result.slice(0, insertPos)}\n${renderedTags}\n      ${result.slice(insertPos)}`;
        } else {
          const closeParenMatch = result.lastIndexOf(');');
          if (closeParenMatch !== -1) {
            const beforeParen = result.lastIndexOf('</', closeParenMatch);
            if (beforeParen !== -1) {
              result = `${result.slice(0, beforeParen)}${renderedTags}\n      ${result.slice(beforeParen)}`;
            }
          }
        }
      }
    }
  }

  return result;
}
