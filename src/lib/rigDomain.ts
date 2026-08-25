// Production Domain Logic for RIG.EXE Micro-Dyno Container Runtime

export interface RigContainer {
  readonly id: string;
  readonly appId: string;
  readonly name: string;
  readonly port: number;
  readonly memoryMb: number;
  readonly memoryCapMb: number;
  readonly sqlitePath: string;
  readonly sqliteSizeBytes: number;
  readonly walJournalSizeBytes: number;
  readonly status: 'online' | 'rebuilding' | 'oom_recovered' | 'idle';
  readonly testEvidenceScore: number;
  readonly portalUrl: string;
}

export const INITIAL_FLEET: readonly [RigContainer, ...RigContainer[]] = [
  {
    id: 'rig-wa-9812',
    appId: 'wallart',
    name: 'nate/wallart (Flagship Studio)',
    port: 3002,
    memoryMb: 48,
    memoryCapMb: 256,
    sqlitePath: '/data/wallart.sqlite',
    sqliteSizeBytes: 15518920, // 14.8 MB
    walJournalSizeBytes: 245760, // 240 KB
    status: 'online',
    testEvidenceScore: 100,
    portalUrl: 'https://wallart-nate.rig.nates.software'
  },
  {
    id: 'rig-rc-4401',
    appId: 'retro-calc',
    name: 'sam/retro-calc (Accounting WASM)',
    port: 3001,
    memoryMb: 24,
    memoryCapMb: 256,
    sqlitePath: '/data/app.sqlite',
    sqliteSizeBytes: 1468006, // 1.4 MB
    walJournalSizeBytes: 65536, // 64 KB
    status: 'online',
    testEvidenceScore: 100,
    portalUrl: 'https://retro-calc-sam.rig.nates.software'
  },
  {
    id: 'rig-st-1109',
    appId: 'sailtrack',
    name: 'nate/sailtrack (NMEA Marine HUD)',
    port: 3003,
    memoryMb: 38,
    memoryCapMb: 256,
    sqlitePath: '/data/telemetry.sqlite',
    sqliteSizeBytes: 4404019, // 4.2 MB
    walJournalSizeBytes: 131072, // 128 KB
    status: 'online',
    testEvidenceScore: 100,
    portalUrl: 'https://sailtrack-nate.rig.nates.software'
  }
];

export type RigValidationResult =
  | { readonly valid: true; readonly data: RigContainer }
  | { readonly valid: false; readonly errors: readonly string[] };

export function validateRigContainer(container: unknown): RigValidationResult {
  const errors: string[] = [];

  if (typeof container !== 'object' || container === null) {
    return { valid: false, errors: ['Rig container must be a non-null object.'] };
  }

  const c = container as Record<string, unknown>;

  if (typeof c.id !== 'string' || !c.id.match(/^rig-[a-z0-9-_]{2,}$/)) {
    errors.push('Rig container id must match /^rig-[a-z0-9-_]{2,}$/');
  }

  if (typeof c.appId !== 'string' || c.appId.trim().length === 0) {
    errors.push('Rig container must specify a non-empty string appId.');
  }

  if (typeof c.name !== 'string' || c.name.trim().length === 0) {
    errors.push('Rig container must specify a non-empty string name.');
  }

  if (typeof c.port !== 'number' || !Number.isInteger(c.port) || c.port < 3000 || c.port > 9999) {
    errors.push('Port must be an integer between 3000 and 9999.');
  }

  if (typeof c.memoryCapMb !== 'number' || c.memoryCapMb !== 256) {
    errors.push('Memory cap must be strictly configured to 256MB.');
  }

  if (typeof c.memoryMb !== 'number' || c.memoryMb < 0 || c.memoryMb > 256) {
    errors.push('Memory usage must be a number between 0 and 256MB.');
  }

  if (
    typeof c.sqlitePath !== 'string' ||
    !c.sqlitePath.match(/^\/data\/[a-z0-9-_]+\.sqlite$/) ||
    c.sqlitePath.includes('..')
  ) {
    errors.push('SQLite volume path must strictly match /data/<name>.sqlite without path traversal.');
  }

  if (typeof c.sqliteSizeBytes !== 'number' || c.sqliteSizeBytes < 0 || !Number.isFinite(c.sqliteSizeBytes)) {
    errors.push('SQLite size must be a non-negative finite number of bytes.');
  }

  if (typeof c.walJournalSizeBytes !== 'number' || c.walJournalSizeBytes < 0 || !Number.isFinite(c.walJournalSizeBytes)) {
    errors.push('WAL journal size must be a non-negative finite number of bytes.');
  }

  const validStatuses = ['online', 'rebuilding', 'oom_recovered', 'idle'];
  if (typeof c.status !== 'string' || !validStatuses.includes(c.status)) {
    errors.push(`Status must be one of: ${validStatuses.join(', ')}`);
  }

  if (typeof c.testEvidenceScore !== 'number' || c.testEvidenceScore < 0 || c.testEvidenceScore > 100) {
    errors.push('Test evidence score must be a number between 0 and 100.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      id: String(c.id),
      appId: String(c.appId),
      name: String(c.name),
      port: Number(c.port),
      memoryMb: Number(c.memoryMb),
      memoryCapMb: 256,
      sqlitePath: String(c.sqlitePath),
      sqliteSizeBytes: Number(c.sqliteSizeBytes),
      walJournalSizeBytes: Number(c.walJournalSizeBytes),
      status: c.status as any,
      testEvidenceScore: Number(c.testEvidenceScore),
      portalUrl: String(c.portalUrl)
    }
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
