// In-Browser WASM SQLite Engine for Local-First Single-File Execution
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

let SQL: SqlJsStatic | null = null;

export async function getSqlJsEngine(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`
  });
  return SQL;
}

export class LocalSqliteDatabase {
  private db: Database | null = null;
  public readonly appName: string;

  constructor(appName: string) {
    this.appName = appName;
  }

  public async init(initialSql?: string): Promise<void> {
    const engine = await getSqlJsEngine();
    this.db = new engine.Database();

    // Enable WAL pragma
    this.db.run('PRAGMA journal_mode = WAL;');

    if (initialSql) {
      this.db.run(initialSql);
    }
  }

  public run(sql: string, params?: any[]): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(sql, params);
  }

  public exec(sql: string): { columns: string[]; values: any[][] }[] {
    if (!this.db) throw new Error('Database not initialized');
    const res = this.db.exec(sql);
    return res.map(r => ({
      columns: r.columns,
      values: r.values
    }));
  }

  public exportBinary(): Uint8Array {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.export();
  }

  public getTables(): string[] {
    if (!this.db) return [];
    const res = this.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
    if (res.length === 0 || !res[0]) return [];
    return res[0].values.map(row => String(row[0]));
  }
}
