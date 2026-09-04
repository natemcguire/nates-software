import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

export const CANONICAL_MIGRATIONS = [
  '0001_production_schema.sql',
  '0002_webhook_idempotency_and_atomic_ledger.sql',
  '0006_canonical_forge_lineage.sql',
  '0007_dyno_real_world_benchmarks.sql',
  '0008_session_security.sql',
  '0009_durable_commerce.sql',
  '0010_commerce_processing.sql',
  '0011_commerce_money_movement.sql',
  '0012_commerce_refunds_disputes.sql',
  '0013_commerce_refund_finalization.sql',
  '0014_hotwire_votes.sql',
  '0016_inbox_live_integrity.sql',
  '0017_picfit_truthful_listing.sql',
  '0018_ephemeral_terminal_sessions.sql',
  '0019_forge_outbox_leasing.sql',
  '0020_dyno_certified_evaluations.sql',
  '0021_active_project_catalog.sql',
  '0022_deployment_lifecycle_states.sql',
  '0023_retire_picfit_listing.sql',
  '0024_canonical_repository_linkage.sql',
  '0025_app_origin_kind.sql',
  '0026_unique_hostname_index.sql',
  '0027_app_postgres_addon.sql',
  '0028_user_ssh_keys.sql',
  '0029_contributor_revenue_sharing.sql',
  '0030_contributor_cap_triggers.sql',
  '0033_chat_presence_and_topic.sql',
  '0034_rig_verification_evidence_bundle.sql',
  '0035_reserved_hostname_guard.sql',
  '0036_launch_honesty_cleanup.sql',
  '0037_first_party_sso_tickets.sql',
  '0038_shareware_restored_money_model.sql',
  '0039_listing_rights_controls.sql',
  '0040_immutable_commerce_releases.sql'
] as const;

export type MigrationFileName = typeof CANONICAL_MIGRATIONS[number];

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta?: {
    changes?: number;
    last_row_id?: number;
    duration?: number;
    served_by?: string;
    rows_read?: number;
    rows_written?: number;
    [key: string]: any;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[][]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
  dump(): Promise<ArrayBuffer>;
}

export async function bindTestCommerceRelease(
  db: D1Database,
  appId: string,
  options: { repositoryId?: string; commitOid?: string } = {}
): Promise<string> {
  const token = appId.replace(/[^a-zA-Z0-9_]/g, '_');
  const product: any = await db.prepare(`
    SELECT cp.repository_id AS repositoryId, cp.seller_user_id AS sellerUserId,
           cp.resale_enabled AS resaleEnabled, cp.forking_enabled AS forkingEnabled,
           a.version, a.binaries
    FROM commerce_products cp
    JOIN app_listings a ON a.id = cp.app_id
    WHERE cp.app_id = ?
  `).bind(appId).first();
  if (!product) throw new Error(`Missing commerce product fixture for ${appId}`);

  const repositoryId = options.repositoryId || product.repositoryId || `repo_test_release_${token}`;
  const commitOid = options.commitOid || 'f'.repeat(40);
  const buildRunId = `build_test_release_${token}`;
  const deploymentRevisionId = `deploy_test_release_${token}`;
  const releaseId = `rel_test_release_${token}`;
  const repository: any = await db.prepare('SELECT id FROM repositories WHERE id = ?')
    .bind(repositoryId).first();

  if (!repository) {
    await db.prepare(`
      INSERT INTO repositories (
        id, app_id, owner_user_id, slug, visibility, default_ref, storage_key, status
      ) VALUES (?, ?, ?, ?, 'public', 'refs/heads/main', ?, 'active')
    `).bind(repositoryId, appId, product.sellerUserId, `test-release-${token}`, `repositories/${repositoryId}`).run();
  } else {
    await db.prepare('UPDATE repositories SET app_id = ? WHERE id = ?')
      .bind(appId, repositoryId).run();
  }
  await db.prepare('UPDATE app_listings SET repository_id = ? WHERE id = ?')
    .bind(repositoryId, appId).run();
  await db.prepare('UPDATE commerce_products SET repository_id = ? WHERE app_id = ?')
    .bind(repositoryId, appId).run();
  await db.prepare(`
    INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id)
    VALUES (?, 'refs/heads/main', ?, 1, ?)
    ON CONFLICT(repository_id, ref_name) DO UPDATE SET commit_oid = excluded.commit_oid
  `).bind(repositoryId, commitOid, product.sellerUserId).run();
  await db.prepare(`
    INSERT INTO build_runs (
      id, repository_id, commit_oid, purpose, status, runner_image_digest,
      build_command, source_manifest_digest, result_digest
    ) VALUES (?, ?, ?, 'release', 'passed', 'sha256:test-runner', 'npm run build', 'sha256:test-source', 'sha256:test-result')
  `).bind(buildRunId, repositoryId, commitOid).run();
  const revision: any = await db.prepare(`
    SELECT COALESCE(MAX(revision_number), 0) + 1 AS nextRevision
    FROM deployment_revisions WHERE app_id = ? AND environment = 'production'
  `).bind(appId).first();
  await db.prepare(`
    INSERT INTO deployment_revisions (
      id, app_id, repository_id, commit_oid, build_run_id, environment,
      revision_number, status, runtime_config_digest, deployed_by_user_id, deployed_at
    ) VALUES (?, ?, ?, ?, ?, 'production', ?, 'healthy', 'sha256:test-runtime', ?, CURRENT_TIMESTAMP)
  `).bind(
    deploymentRevisionId,
    appId,
    repositoryId,
    commitOid,
    buildRunId,
    revision?.nextRevision || 1,
    product.sellerUserId
  ).run();
  const repositoryRow: any = await db.prepare('SELECT visibility FROM repositories WHERE id = ?')
    .bind(repositoryId).first();
  await db.prepare(`
    INSERT INTO commerce_releases (
      id, app_id, repository_id, seller_user_id, commit_oid,
      deployment_revision_id, build_run_id, version, binaries_json,
      artifact_manifest_json, resale_enabled, forking_enabled, visibility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    releaseId,
    appId,
    repositoryId,
    product.sellerUserId,
    commitOid,
    deploymentRevisionId,
    buildRunId,
    product.version,
    product.binaries || '{}',
    JSON.stringify({ binaries: JSON.parse(product.binaries || '{}'), artifacts: [] }),
    product.resaleEnabled,
    product.forkingEnabled,
    repositoryRow.visibility
  ).run();
  await db.prepare('UPDATE commerce_products SET release_id = ? WHERE app_id = ?')
    .bind(releaseId, appId).run();
  return releaseId;
}

export interface ForeignKeyViolation {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
}

export interface TestD1Context {
  d1: D1Database;
  rawDb: Database;
  runForeignKeyCheck: () => ForeignKeyViolation[];
  getTableNames: () => string[];
  getViewNames: () => string[];
  getTriggerNames: () => string[];
  getIndexNames: () => string[];
}

let cachedEngine: SqlJsStatic | null = null;

export async function getSqlJsEngine(): Promise<SqlJsStatic> {
  if (cachedEngine) return cachedEngine;
  cachedEngine = await initSqlJs();
  return cachedEngine;
}

function sanitizeParam(val: any): any {
  if (val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

export class SqlJsD1PreparedStatement implements D1PreparedStatement {
  private readonly rawDb: Database;
  private readonly query: string;
  private readonly params: any[];

  constructor(rawDb: Database, query: string, params: any[] = []) {
    this.rawDb = rawDb;
    this.query = query;
    this.params = params;
  }

  public bind(...values: any[]): D1PreparedStatement {
    const flat = (values.length === 1 && Array.isArray(values[0])) ? values[0] : values;
    const sanitized = flat.map(sanitizeParam);
    return new SqlJsD1PreparedStatement(this.rawDb, this.query, sanitized);
  }

  public async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.rawDb.prepare(this.query);
    try {
      if (this.params.length > 0) {
        stmt.bind(this.params);
      }
      if (stmt.step()) {
        const obj = stmt.getAsObject() as Record<string, any>;
        if (colName) {
          return (obj[colName] !== undefined ? obj[colName] : null) as T;
        }
        return obj as T;
      }
      return null;
    } finally {
      stmt.free();
    }
  }

  public async all<T = unknown>(): Promise<D1Result<T>> {
    const stmt = this.rawDb.prepare(this.query);
    try {
      if (this.params.length > 0) {
        stmt.bind(this.params);
      }
      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      return {
        success: true,
        results,
        meta: {
          changes: this.rawDb.getRowsModified()
        }
      };
    } finally {
      stmt.free();
    }
  }

  public async run<T = unknown>(): Promise<D1Result<T>> {
    const stmt = this.rawDb.prepare(this.query);
    try {
      if (this.params.length > 0) {
        stmt.bind(this.params);
      }
      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      return {
        success: true,
        results: results.length > 0 ? results : undefined,
        meta: {
          changes: this.rawDb.getRowsModified()
        }
      };
    } finally {
      stmt.free();
    }
  }

  public async raw<T = unknown>(): Promise<T[][]> {
    const stmt = this.rawDb.prepare(this.query);
    try {
      if (this.params.length > 0) {
        stmt.bind(this.params);
      }
      const rows: T[][] = [];
      while (stmt.step()) {
        rows.push(stmt.get() as T[]);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }
}

export class SqlJsD1Database implements D1Database {
  public rawDb: Database;

  constructor(rawDb: Database) {
    this.rawDb = rawDb;
  }

  public prepare(query: string): D1PreparedStatement {
    return new SqlJsD1PreparedStatement(this.rawDb, query);
  }

  public async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.rawDb.run('BEGIN TRANSACTION;');
    try {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        const res = await stmt.run<T>();
        results.push(res);
      }
      this.rawDb.run('COMMIT;');
      return results;
    } catch (err) {
      try {
        this.rawDb.run('ROLLBACK;');
      } catch {}
      throw err;
    }
  }

  public async exec(query: string): Promise<D1ExecResult> {
    this.rawDb.exec(query);
    return { count: 1, duration: 0 };
  }

  public async dump(): Promise<ArrayBuffer> {
    const u8 = this.rawDb.export();
    return u8.buffer as ArrayBuffer;
  }
}

export function getMigrationsDir(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(__dirname, '../../migrations'),
    path.resolve(__dirname, '../migrations')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(process.cwd(), 'migrations');
}

export function runForeignKeyCheck(rawDb: Database): ForeignKeyViolation[] {
  const res = rawDb.exec('PRAGMA foreign_key_check;');
  if (res.length === 0 || !res[0]) return [];
  const cols = res[0].columns;
  return res[0].values.map((row: any[]) => {
    const entry: Record<string, any> = {};
    cols.forEach((col, idx) => {
      entry[col] = row[idx];
    });
    return {
      table: String(entry.table ?? row[0]),
      rowid: Number(entry.rowid ?? row[1]),
      parent: String(entry.parent ?? row[2]),
      fkid: Number(entry.fkid ?? row[3])
    };
  });
}

export async function createTestD1Database(options: {
  foreignKeys?: boolean;
  migrations?: readonly string[] | string[];
} = {}): Promise<TestD1Context> {
  const {
    foreignKeys = true,
    migrations = CANONICAL_MIGRATIONS
  } = options;

  const engine = await getSqlJsEngine();
  const rawDb = new engine.Database();

  if (foreignKeys) {
    rawDb.run('PRAGMA foreign_keys = ON;');
  }

  const migrationsDir = getMigrationsDir();
  for (const m of migrations) {
    const filePath = path.join(migrationsDir, m);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Migration file not found: ${filePath}`);
    }
    const sql = fs.readFileSync(filePath, 'utf-8');
    rawDb.run(sql);
  }

  const d1 = new SqlJsD1Database(rawDb);

  return {
    d1,
    rawDb,
    runForeignKeyCheck: () => runForeignKeyCheck(rawDb),
    getTableNames: () => {
      const res = rawDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
      if (res.length === 0 || !res[0]) return [];
      return res[0].values.map((r: any[]) => String(r[0]));
    },
    getViewNames: () => {
      const res = rawDb.exec("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name;");
      if (res.length === 0 || !res[0]) return [];
      return res[0].values.map((r: any[]) => String(r[0]));
    },
    getTriggerNames: () => {
      const res = rawDb.exec("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name;");
      if (res.length === 0 || !res[0]) return [];
      return res[0].values.map((r: any[]) => String(r[0]));
    },
    getIndexNames: () => {
      const res = rawDb.exec("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
      if (res.length === 0 || !res[0]) return [];
      return res[0].values.map((r: any[]) => String(r[0]));
    }
  };
}
