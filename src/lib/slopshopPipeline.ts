import crypto from 'node:crypto';

export interface PipelineWorktreeOptions {
  readonly appId: string;
  readonly baseCommitSha?: string;
  readonly baseBranch?: string;
  readonly worktreePath?: string;
}

export interface FileModification {
  readonly path: string;
  readonly content: string;
  readonly previousContent?: string;
  readonly previousDigest?: string;
  readonly action: 'create' | 'modify' | 'delete';
}

export interface AiAgentExecutionOptions {
  readonly agentName: 'claude-code' | 'antigravity' | 'cursor' | 'aider' | 'slop-native';
  readonly featureName: string;
  readonly prompt: string;
  readonly modifications: readonly FileModification[];
  readonly migrationSql?: string;
  readonly appId?: string;
}

export interface DiffSummary {
  readonly rawDiff: string;
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
  readonly modifiedFiles: readonly string[];
}

export interface SandboxTestResult {
  readonly passed: boolean;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly durationMs: number;
  readonly testLogs: string;
  readonly evidenceDigest: string;
}

export interface FeatureRefResult {
  readonly success: boolean;
  readonly featureName: string;
  readonly featureRef: string;
  readonly commitSha?: string;
  readonly parentSha?: string;
  readonly author?: string;
  readonly message: string;
  readonly diff?: DiffSummary;
  readonly testEvidence?: SandboxTestResult;
  readonly migrationApplied?: boolean;
  readonly publishedAt?: string;
  readonly error?: string;
}

export interface LandFeatureResult {
  readonly success: boolean;
  readonly targetRef: string;
  readonly mergedSha?: string;
  readonly featureRef: string;
  readonly transactionId?: string;
  readonly message: string;
  readonly error?: string;
}

export interface RevertResult {
  readonly success: boolean;
  readonly revertedSha: string;
  readonly rollbackRef?: string;
  readonly reverseDiff: string;
  readonly message: string;
  readonly error?: string;
}

export interface ValidationError {
  readonly code:
    | 'PATH_TRAVERSAL'
    | 'INVALID_PATH'
    | 'DUPLICATE_PATH'
    | 'CONFLICTING_ACTION'
    | 'ROUTE_COLLISION'
    | 'EXPORT_COLLISION'
    | 'SCHEMA_COLLISION'
    | 'SYNTAX_ERROR'
    | 'MISSING_BEFORE_CONTENT'
    | 'LIMIT_EXCEEDED'
    | 'MISSING_REQUIRED_FIELD';
  readonly message: string;
  readonly path?: string;
  readonly details?: Record<string, unknown>;
}

export interface ValidationWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface PackageValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
  readonly inspected: {
    readonly normalizedPaths: readonly string[];
    readonly routes: readonly string[];
    readonly exports: readonly { readonly path: string; readonly name: string; readonly kind: string }[];
    readonly tables: readonly string[];
  };
}

export interface PreflightPipelineResult {
  readonly success: boolean;
  readonly status: 'awaiting_local_execution' | 'validation_failed';
  readonly appId: string;
  readonly featureName: string;
  readonly validation: PackageValidationResult;
  readonly diff: DiffSummary;
  readonly inverseDiff: DiffSummary;
  readonly evidenceDigest: string;
  readonly message: string;
  readonly error?: string;
}

export function normalizeRelativePath(rawPath: string): { normalized: string; error?: string } {
  if (typeof rawPath !== 'string') {
    return { normalized: '', error: 'Path must be a non-empty string' };
  }

  if (rawPath.includes('\0')) {
    return { normalized: '', error: `Path contains null byte: "${rawPath}"` };
  }

  const p = rawPath.replace(/\\/g, '/').trim();

  if (!p) {
    return { normalized: '', error: 'Path cannot be empty' };
  }

  if (p.startsWith('/') || /^[a-zA-Z]:\//.test(p)) {
    return { normalized: '', error: `Absolute paths are not allowed: "${rawPath}"` };
  }

  const rawSegments = p.split('/');
  const normalizedSegments: string[] = [];

  for (const seg of rawSegments) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      return { normalized: '', error: `Path traversal detected ("..") in path: "${rawPath}"` };
    }
    normalizedSegments.push(seg);
  }

  if (normalizedSegments.length === 0) {
    return { normalized: '', error: `Invalid relative path: "${rawPath}"` };
  }

  return { normalized: normalizedSegments.join('/') };
}

export function inspectRoutes(modifications: readonly FileModification[]): {
  routes: string[];
  collisions: ValidationError[];
} {
  const routes: string[] = [];
  const collisions: ValidationError[] = [];
  const routeMap = new Map<string, string>();

  for (const mod of modifications) {
    const normRes = normalizeRelativePath(mod.path);
    if (normRes.error) continue;
    const filePath = normRes.normalized;

    if (filePath.startsWith('functions/api/')) {
      const routePath = filePath
        .replace(/^functions\/api/, '/api')
        .replace(/\.[a-zA-Z0-9]+$/, '')
        .replace(/\/index$/, '');
      const cleanRoute = routePath === '' ? '/api' : routePath;
      routes.push(cleanRoute);

      const handlerMatches = Array.from(mod.content.matchAll(/export\s+const\s+(onRequest(?:Get|Post|Put|Delete|Patch)?)/g));
      if (handlerMatches.length > 0) {
        for (const hm of handlerMatches) {
          const handlerName = hm[1];
          const method = handlerName === 'onRequest' ? 'ALL' : handlerName.replace('onRequest', '').toUpperCase();
          const routeKey = `${method} ${cleanRoute}`;
          if (routeMap.has(routeKey)) {
            collisions.push({
              code: 'ROUTE_COLLISION',
              message: `Route collision detected: "${routeKey}" defined in both "${routeMap.get(routeKey)}" and "${filePath}"`,
              path: filePath,
              details: { method, route: cleanRoute, conflictingFile: routeMap.get(routeKey) }
            });
          } else {
            routeMap.set(routeKey, filePath);
          }
        }
      } else {
        const routeKey = `FILE ${cleanRoute}`;
        if (routeMap.has(routeKey)) {
          collisions.push({
            code: 'ROUTE_COLLISION',
            message: `Route file collision detected: "${cleanRoute}" defined in both "${routeMap.get(routeKey)}" and "${filePath}"`,
            path: filePath,
            details: { route: cleanRoute, conflictingFile: routeMap.get(routeKey) }
          });
        } else {
          routeMap.set(routeKey, filePath);
        }
      }
    }

    const routeDeclMatches = Array.from(
      mod.content.matchAll(/(?:app|router|server)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi)
    );
    for (const rm of routeDeclMatches) {
      const method = rm[1].toUpperCase();
      const endpoint = rm[2];
      const routeKey = `${method} ${endpoint}`;
      routes.push(routeKey);
      if (routeMap.has(routeKey)) {
        collisions.push({
          code: 'ROUTE_COLLISION',
          message: `Route handler collision detected: "${routeKey}" registered in both "${routeMap.get(routeKey)}" and "${filePath}"`,
          path: filePath,
          details: { method, endpoint, conflictingFile: routeMap.get(routeKey) }
        });
      } else {
        routeMap.set(routeKey, filePath);
      }
    }
  }

  return { routes, collisions };
}

export function inspectExports(modifications: readonly FileModification[]): {
  exports: Array<{ path: string; name: string; kind: string }>;
  collisions: ValidationError[];
} {
  const exports: Array<{ path: string; name: string; kind: string }> = [];
  const collisions: ValidationError[] = [];

  for (const mod of modifications) {
    const normRes = normalizeRelativePath(mod.path);
    if (normRes.error) continue;
    const filePath = normRes.normalized;
    const fileExports = new Map<string, string>();

    const declRegex = /export\s+(?:async\s+)?(const|function|class|type|interface|enum|let|var)\s+([a-zA-Z0-9_$]+)/g;
    const declMatches = Array.from(mod.content.matchAll(declRegex));
    for (const match of declMatches) {
      const kind = match[1];
      const name = match[2];
      if (fileExports.has(name)) {
        collisions.push({
          code: 'EXPORT_COLLISION',
          message: `Duplicate export identifier "${name}" (${kind}) in file "${filePath}"`,
          path: filePath,
          details: { name, kind, duplicateInSameFile: true }
        });
      } else {
        fileExports.set(name, kind);
        exports.push({ path: filePath, name, kind });
      }
    }

    const blockRegex = /export\s*\{([^}]+)\}/g;
    const blockMatches = Array.from(mod.content.matchAll(blockRegex));
    for (const match of blockMatches) {
      const items = match[1].split(',');
      for (const item of items) {
        const parts = item.trim().split(/\s+as\s+/);
        const exportedName = (parts[1] || parts[0]).trim();
        if (exportedName && /^[a-zA-Z0-9_$]+$/.test(exportedName)) {
          if (fileExports.has(exportedName)) {
            collisions.push({
              code: 'EXPORT_COLLISION',
              message: `Duplicate export identifier "${exportedName}" in file "${filePath}"`,
              path: filePath,
              details: { name: exportedName, duplicateInSameFile: true }
            });
          } else {
            fileExports.set(exportedName, 'named');
            exports.push({ path: filePath, name: exportedName, kind: 'named' });
          }
        }
      }
    }
  }

  return { exports, collisions };
}

export function inspectSchemaTables(
  migrationSql?: string,
  modifications?: readonly FileModification[]
): {
  tables: string[];
  collisions: ValidationError[];
} {
  const tables: string[] = [];
  const collisions: ValidationError[] = [];
  const tableCounts = new Map<string, number>();

  const sqlSources: Array<{ source: string; sql: string }> = [];
  if (migrationSql && migrationSql.trim()) {
    sqlSources.push({ source: 'migrationSql', sql: migrationSql });
  }

  if (modifications) {
    for (const mod of modifications) {
      if (mod.path.endsWith('.sql') || mod.content.includes('CREATE TABLE')) {
        sqlSources.push({ source: mod.path, sql: mod.content });
      }
    }
  }

  for (const src of sqlSources) {
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)["'`]?/gi;
    const matches = Array.from(src.sql.matchAll(createTableRegex));
    for (const match of matches) {
      const tableName = match[1].toLowerCase();
      tables.push(tableName);
      const count = (tableCounts.get(tableName) || 0) + 1;
      tableCounts.set(tableName, count);
      if (count > 1) {
        collisions.push({
          code: 'SCHEMA_COLLISION',
          message: `Duplicate table creation collision for table "${tableName}" detected in ${src.source}`,
          details: { tableName, source: src.source, count }
        });
      }
    }
  }

  return { tables, collisions };
}

export function validateFeaturePackage(params: {
  appId?: string;
  featureName?: string;
  prompt?: string;
  modifications?: readonly FileModification[];
  migrationSql?: string;
}): PackageValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const normalizedPaths: string[] = [];
  const seenPaths = new Set<string>();

  if (!params.appId || typeof params.appId !== 'string' || !params.appId.trim()) {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      message: 'appId is required and must be a non-empty string'
    });
  } else if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(params.appId)) {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      message: 'appId must be a repository-safe identifier containing only letters, numbers, hyphens, and underscores'
    });
  }

  if (!params.featureName || typeof params.featureName !== 'string' || !params.featureName.trim()) {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      message: 'featureName is required and must be a non-empty string'
    });
  }

  if (!params.prompt || typeof params.prompt !== 'string' || !params.prompt.trim()) {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      message: 'prompt is required and must be a non-empty string'
    });
  }

  const modifications = params.modifications || [];
  if (!Array.isArray(modifications) || modifications.length === 0) {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      message: 'modifications must be a non-empty array'
    });
  } else if (modifications.length > 100) {
    errors.push({
      code: 'LIMIT_EXCEEDED',
      message: 'A feature package may contain at most 100 file modifications'
    });
  }

  if (typeof params.prompt === 'string' && params.prompt.length > 50_000) {
    errors.push({ code: 'LIMIT_EXCEEDED', message: 'prompt may not exceed 50,000 characters' });
  }
  if (typeof params.migrationSql === 'string' && params.migrationSql.length > 1_000_000) {
    errors.push({ code: 'LIMIT_EXCEEDED', message: 'migrationSql may not exceed 1,000,000 characters' });
  }

  for (let i = 0; i < modifications.length; i++) {
    const mod = modifications[i];
    if (!mod || typeof mod !== 'object') {
      errors.push({
        code: 'INVALID_PATH',
        message: `Modification at index ${i} is not a valid object`
      });
      continue;
    }

    const norm = normalizeRelativePath(mod.path);
    if (norm.error) {
      errors.push({
        code: norm.error.includes('traversal') ? 'PATH_TRAVERSAL' : 'INVALID_PATH',
        message: norm.error,
        path: mod.path
      });
    } else {
      const normPath = norm.normalized;
      if (seenPaths.has(normPath)) {
        errors.push({
          code: 'DUPLICATE_PATH',
          message: `Duplicate target path detected: "${normPath}" is modified multiple times in the same feature package`,
          path: normPath
        });
      } else {
        seenPaths.add(normPath);
        normalizedPaths.push(normPath);
      }
    }

    if (!['create', 'modify', 'delete'].includes(mod.action)) {
      errors.push({
        code: 'CONFLICTING_ACTION',
        message: `Invalid modification action "${mod.action}" for path "${mod.path}". Must be create, modify, or delete.`,
        path: mod.path
      });
    }

    if (typeof mod.content !== 'string') {
      errors.push({
        code: 'MISSING_REQUIRED_FIELD',
        message: `Modification content must be a string for path "${mod.path}"`,
        path: mod.path
      });
    } else if (mod.content.length > 1_000_000) {
      errors.push({
        code: 'LIMIT_EXCEEDED',
        message: `Modification content may not exceed 1,000,000 characters for path "${mod.path}"`,
        path: mod.path
      });
    }

    if ((mod.action === 'modify' || mod.action === 'delete') && typeof mod.previousContent !== 'string') {
      errors.push({
        code: 'MISSING_BEFORE_CONTENT',
        message: `Action "${mod.action}" requires explicit previousContent so its inverse patch is provable`,
        path: mod.path
      });
    } else if (typeof mod.previousContent === 'string' && mod.previousContent.length > 1_000_000) {
      errors.push({
        code: 'LIMIT_EXCEEDED',
        message: `previousContent may not exceed 1,000,000 characters for path "${mod.path}"`,
        path: mod.path
      });
    }

    if (mod.action === 'delete' && mod.content && mod.content.trim().length > 0) {
      warnings.push({
        code: 'DELETE_CONTENT_IGNORED',
        message: `Content provided for delete action on "${mod.path}" will be ignored`,
        path: mod.path
      });
    }
  }

  const routeInspection = inspectRoutes(modifications);
  errors.push(...routeInspection.collisions);

  const exportInspection = inspectExports(modifications);
  errors.push(...exportInspection.collisions);

  const schemaInspection = inspectSchemaTables(params.migrationSql, modifications);
  errors.push(...schemaInspection.collisions);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    inspected: {
      normalizedPaths,
      routes: routeInspection.routes,
      exports: exportInspection.exports,
      tables: schemaInspection.tables
    }
  };
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/\r?\n/);
}

function computeLCSMatrix(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

interface DiffOp {
  type: 'common' | 'add' | 'del';
  line: string;
  oldIndex?: number;
  newIndex?: number;
}

function buildDiffOps(a: string[], b: string[]): DiffOp[] {
  if (a.length * b.length > 1_000_000) {
    return [
      ...a.map((line, index) => ({ type: 'del' as const, line, oldIndex: index + 1 })),
      ...b.map((line, index) => ({ type: 'add' as const, line, newIndex: index + 1 }))
    ];
  }

  const dp = computeLCSMatrix(a, b);
  const ops: DiffOp[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'common', line: a[i - 1], oldIndex: i, newIndex: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', line: b[j - 1], newIndex: j });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      ops.push({ type: 'del', line: a[i - 1], oldIndex: i });
      i--;
    }
  }

  ops.reverse();
  return ops;
}

export function generateFileDiff(
  filePath: string,
  action: 'create' | 'modify' | 'delete',
  content: string,
  previousContent: string = ''
): { diffText: string; additions: number; deletions: number } {
  const normPath = normalizeRelativePath(filePath).normalized || filePath;

  if (action === 'create') {
    const afterLines = splitLines(content);
    const diffLines: string[] = [
      `diff --git a/${normPath} b/${normPath}`,
      `new file mode 100644`,
      `--- /dev/null`,
      `+++ b/${normPath}`,
      `@@ -0,0 +1,${afterLines.length} @@`
    ];
    for (const l of afterLines) {
      diffLines.push(`+${l}`);
    }
    return {
      diffText: diffLines.join('\n'),
      additions: afterLines.length,
      deletions: 0
    };
  }

  if (action === 'delete') {
    const beforeLines = splitLines(previousContent);
    const diffLines: string[] = [
      `diff --git a/${normPath} b/${normPath}`,
      `deleted file mode 100644`,
      `--- a/${normPath}`,
      `+++ /dev/null`,
      `@@ -1,${beforeLines.length} +0,0 @@`
    ];
    for (const l of beforeLines) {
      diffLines.push(`-${l}`);
    }
    return {
      diffText: diffLines.join('\n'),
      additions: 0,
      deletions: beforeLines.length
    };
  }

  const beforeLines = splitLines(previousContent);
  const afterLines = splitLines(content);

  if (previousContent === content) {
    return { diffText: '', additions: 0, deletions: 0 };
  }

  if (beforeLines.length === 0) {
    const diffLines: string[] = [
      `diff --git a/${normPath} b/${normPath}`,
      `--- a/${normPath}`,
      `+++ b/${normPath}`,
      `@@ -0,0 +1,${afterLines.length} @@`
    ];
    for (const l of afterLines) {
      diffLines.push(`+${l}`);
    }
    return {
      diffText: diffLines.join('\n'),
      additions: afterLines.length,
      deletions: 0
    };
  }

  const ops = buildDiffOps(beforeLines, afterLines);
  let additions = 0;
  let deletions = 0;

  for (const op of ops) {
    if (op.type === 'add') additions++;
    if (op.type === 'del') deletions++;
  }

  const diffLines: string[] = [
    `diff --git a/${normPath} b/${normPath}`,
    `--- a/${normPath}`,
    `+++ b/${normPath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`
  ];

  for (const op of ops) {
    if (op.type === 'common') {
      diffLines.push(` ${op.line}`);
    } else if (op.type === 'add') {
      diffLines.push(`+${op.line}`);
    } else if (op.type === 'del') {
      diffLines.push(`-${op.line}`);
    }
  }

  return {
    diffText: diffLines.join('\n'),
    additions,
    deletions
  };
}

export function generateUnifiedDiff(modifications: readonly FileModification[]): DiffSummary {
  const modifiedFiles: string[] = [];
  const diffChunks: string[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const mod of modifications) {
    const norm = normalizeRelativePath(mod.path).normalized || mod.path;
    modifiedFiles.push(norm);
    const { diffText, additions, deletions } = generateFileDiff(
      norm,
      mod.action,
      mod.content,
      mod.previousContent || ''
    );
    if (diffText) {
      diffChunks.push(diffText);
      totalAdditions += additions;
      totalDeletions += deletions;
    }
  }

  return {
    rawDiff: diffChunks.join('\n\n'),
    filesChanged: modifiedFiles.length,
    additions: totalAdditions,
    deletions: totalDeletions,
    modifiedFiles: Array.from(new Set(modifiedFiles))
  };
}

export function generateInversePatch(modifications: readonly FileModification[]): DiffSummary {
  const inverseMods: FileModification[] = modifications.map(mod => {
    const norm = normalizeRelativePath(mod.path).normalized || mod.path;
    if (mod.action === 'create') {
      return {
        path: norm,
        action: 'delete' as const,
        content: '',
        previousContent: mod.content
      };
    } else if (mod.action === 'delete') {
      return {
        path: norm,
        action: 'create' as const,
        content: mod.previousContent || '',
        previousContent: ''
      };
    } else {
      return {
        path: norm,
        action: 'modify' as const,
        content: mod.previousContent || '',
        previousContent: mod.content
      };
    }
  });

  return generateUnifiedDiff(inverseMods);
}

export function computeStableEvidenceDigest(params: {
  appId: string;
  featureName: string;
  prompt: string;
  modifications: readonly FileModification[];
  migrationSql?: string;
  rawDiff?: string;
}): string {
  const sortedMods = [...params.modifications]
    .map(m => ({
      path: normalizeRelativePath(m.path).normalized || m.path,
      action: m.action,
      content: m.content || '',
      previousContent: m.previousContent || ''
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const canonicalObj = {
    appId: params.appId.trim().toLowerCase(),
    featureName: params.featureName.trim().toLowerCase(),
    prompt: params.prompt.trim(),
    migrationSql: params.migrationSql ? params.migrationSql.trim() : '',
    modifications: sortedMods,
    rawDiff: params.rawDiff ? params.rawDiff.trim() : ''
  };

  const canonicalJson = JSON.stringify(canonicalObj);
  const hash = crypto.createHash('sha256').update(canonicalJson, 'utf-8').digest('hex');
  return `sha256:${hash}`;
}

export class SlopshopPipelineEngine {
  private readonly defaultAppId: string;

  constructor(defaultAppId: string = 'dronehunter') {
    this.defaultAppId = defaultAppId;
  }

  public validatePackage(options: {
    appId?: string;
    featureName: string;
    prompt: string;
    modifications: readonly FileModification[];
    migrationSql?: string;
  }): PackageValidationResult {
    return validateFeaturePackage({
      appId: options.appId || this.defaultAppId,
      featureName: options.featureName,
      prompt: options.prompt,
      modifications: options.modifications,
      migrationSql: options.migrationSql
    });
  }

  public checkoutWorktree(options: PipelineWorktreeOptions): {
    worktreePath: string;
    appId: string;
    baseSha: string;
  } {
    const appId = options.appId || this.defaultAppId;
    const baseSha = options.baseCommitSha || '';
    const timestamp = Date.now().toString(36);
    const worktreePath = options.worktreePath || `/tmp/slop-pipeline-${appId}-${timestamp}`;

    return {
      worktreePath,
      appId,
      baseSha
    };
  }

  public applyModifications(
    worktreePath: string,
    options: AiAgentExecutionOptions
  ): {
    appliedFiles: string[];
    migrationFile?: string;
  } {
    const validation = this.validatePackage({
      appId: options.appId || this.defaultAppId,
      featureName: options.featureName,
      prompt: options.prompt,
      modifications: options.modifications,
      migrationSql: options.migrationSql
    });

    if (!validation.valid) {
      throw new Error(`Feature package validation failed: ${validation.errors.map(e => e.message).join('; ')}`);
    }

    void worktreePath;
    throw new Error('HOST_RUNNER_REQUIRED: apply the validated patch through the local SLOP CLI or an authenticated runner');
  }

  public produceDiff(
    worktreeOrMods: string | readonly FileModification[],
    maybeMods?: readonly FileModification[]
  ): DiffSummary {
    const modifications = Array.isArray(worktreeOrMods) ? worktreeOrMods : (maybeMods || []);
    return generateUnifiedDiff(modifications);
  }

  public produceInverseDiff(modifications: readonly FileModification[]): DiffSummary {
    return generateInversePatch(modifications);
  }

  public computeDigest(params: {
    appId: string;
    featureName: string;
    prompt: string;
    modifications: readonly FileModification[];
    migrationSql?: string;
    diff?: DiffSummary;
  }): string {
    const diff = params.diff || this.produceDiff(params.modifications);
    return computeStableEvidenceDigest({
      appId: params.appId,
      featureName: params.featureName,
      prompt: params.prompt,
      modifications: params.modifications,
      migrationSql: params.migrationSql,
      rawDiff: diff.rawDiff
    });
  }

  public applyMigrations(
    worktreePath: string,
    migrationSql?: string
  ): { success: boolean; log: string; error?: string } {
    if (!migrationSql || migrationSql.trim().length === 0) {
      return { success: true, log: 'No migrations to apply.' };
    }

    void worktreePath;
    return {
      success: false,
      log: 'Persistence migration requires the target repository\'s configured local runner.',
      error: 'TARGET_RUNTIME_REQUIRED'
    };
  }

  public testInSandbox(worktreePath: string, testCount: number = 0): SandboxTestResult {
    void worktreePath;
    return {
      passed: false,
      totalTests: testCount,
      passedTests: 0,
      failedTests: 0,
      durationMs: 0,
      testLogs: 'Tests must be executed by the target repository\'s configured local runner.',
      evidenceDigest: ''
    };
  }

  public publishFeatureRef(params: {
    worktreePath: string;
    appId: string;
    featureName: string;
    baseSha: string;
    diff: DiffSummary;
    testEvidence: SandboxTestResult;
    committer?: string;
  }): FeatureRefResult {
    void params.worktreePath;
    return {
      success: false,
      featureName: params.featureName,
      featureRef: '',
      message: 'Publishing feature ref requires local host Git execution with verified evidence.',
      error: params.testEvidence.passed ? 'HOST_GIT_REQUIRED' : 'VERIFIED_TEST_EVIDENCE_REQUIRED'
    };
  }

  public landFeatureRef(featureRef: string, targetRef: string = 'refs/heads/main'): LandFeatureResult {
    return {
      success: false,
      targetRef,
      featureRef,
      message: 'CAS landing cannot be executed directly from browser or edge runtimes. CAS merges must be executed on local host or via verified GITSMITH gateway with cryptographic evidence.',
      error: 'CAS_EDGE_UNSUPPORTED'
    };
  }

  public revertFeatureRef(
    commitSha: string,
    options?: { modifications?: readonly FileModification[] }
  ): RevertResult {
    const rollbackRef = `refs/heads/rollback-${commitSha}`;

    if (options?.modifications && options.modifications.length > 0) {
      const inverse = generateInversePatch(options.modifications);
      return {
        success: true,
        revertedSha: commitSha,
        rollbackRef,
        reverseDiff: inverse.rawDiff,
        message: `Generated clean reverse patch for commit ${commitSha}`
      };
    }

    return {
      success: false,
      revertedSha: commitSha,
      reverseDiff: '',
      message: 'Reverting a feature ref requires local Git execution or explicit feature modifications for inverse patch generation.',
      error: 'REVERT_EDGE_UNSUPPORTED'
    };
  }

  public preflightPipeline(params: {
    appId?: string;
    featureName: string;
    prompt: string;
    modifications: readonly FileModification[];
    migrationSql?: string;
    agentName?: 'claude-code' | 'antigravity' | 'cursor' | 'aider' | 'slop-native';
    committer?: string;
  }): PreflightPipelineResult {
    const appId = params.appId || this.defaultAppId;
    const validation = this.validatePackage({
      appId,
      featureName: params.featureName,
      prompt: params.prompt,
      modifications: params.modifications,
      migrationSql: params.migrationSql
    });

    if (!validation.valid) {
      return {
        success: false,
        status: 'validation_failed',
        appId,
        featureName: params.featureName,
        validation,
        diff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
        inverseDiff: { rawDiff: '', filesChanged: 0, additions: 0, deletions: 0, modifiedFiles: [] },
        evidenceDigest: '',
        message: `Feature package validation failed: ${validation.errors.map(e => e.message).join('; ')}`,
        error: 'VALIDATION_FAILED'
      };
    }

    const diff = this.produceDiff(params.modifications);
    const inverseDiff = this.produceInverseDiff(params.modifications);
    const evidenceDigest = this.computeDigest({
      appId,
      featureName: params.featureName,
      prompt: params.prompt,
      modifications: params.modifications,
      migrationSql: params.migrationSql,
      diff
    });

    return {
      success: true,
      status: 'awaiting_local_execution',
      appId,
      featureName: params.featureName,
      validation,
      diff,
      inverseDiff,
      evidenceDigest,
      message: 'Feature package validated and preflight artifacts generated. Awaiting local host execution.'
    };
  }

  public async executePipeline(params: {
    appId: string;
    featureName: string;
    prompt: string;
    modifications: readonly FileModification[];
    migrationSql?: string;
    agentName?: 'claude-code' | 'antigravity' | 'cursor' | 'aider' | 'slop-native';
    committer?: string;
  }): Promise<{
    checkout: { worktreePath: string; appId: string; baseSha: string };
    validation: PackageValidationResult;
    diff: DiffSummary;
    inverseDiff: DiffSummary;
    evidenceDigest: string;
    status: string;
    message: string;
  }> {
    const preflight = this.preflightPipeline(params);
    const checkout = this.checkoutWorktree({ appId: params.appId });

    if (!preflight.success) {
      throw new Error(`Pipeline execution failed: ${preflight.message}`);
    }

    return {
      checkout,
      validation: preflight.validation,
      diff: preflight.diff,
      inverseDiff: preflight.inverseDiff,
      evidenceDigest: preflight.evidenceDigest,
      status: preflight.status,
      message: preflight.message
    };
  }
}
