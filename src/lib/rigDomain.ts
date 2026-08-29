/**
 * RIG.EXE Domain Logic — Runtime-Agnostic Immutable Specifications & Explicit Observed State
 *
 * Invariants:
 * 1. Runtime-agnostic immutable specs (RigSpec) separate from explicit observed state (RigObservedState).
 * 2. Strict 9-state lifecycle: queued, building, starting, healthy, degraded, crashed, oom, expired, stopped.
 * 3. Runtime freedom: process, docker, wasm, custom, simulation adapters with build/start/health commands.
 * 4. Storage freedom: generic storage mounts (none, volume, sqlite, directory, ephemeral, block) with persistence policy.
 * 5. Resource limits (memory cap, CPU) and TTL/expiry tracking.
 * 6. Explicit truth/source marker ('demo' vs 'provider') with zero fabricated claims.
 */

export type RigLifecycleState =
  | 'queued'
  | 'building'
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'crashed'
  | 'oom'
  | 'expired'
  | 'stopped';

export type RigTruthSource = 'demo' | 'provider';

export type RigRuntimeAdapterKind = 'process' | 'docker' | 'wasm' | 'custom' | 'simulation';

export type RigStorageKind = 'volume' | 'sqlite' | 'directory' | 'ephemeral' | 'block';

export type RigStoragePersistence = 'ephemeral' | 'persistent' | 'retained';

export interface RigRuntimeConfig {
  readonly adapter: RigRuntimeAdapterKind;
  readonly buildCommand?: string;
  readonly startCommand: string;
  readonly healthCommand?: string;
  readonly healthEndpoint?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly imageDigest?: string;
}

export interface RigStorageMount {
  readonly name?: string;
  readonly kind: RigStorageKind;
  readonly mountPath: string;
  readonly sizeBytes?: number;
  readonly sizeMb?: number;
  readonly persistence: RigStoragePersistence;
}

export interface RigResourceLimits {
  readonly memoryCapMb: number;
  readonly cpuCores?: number;
}

export interface RigSpec {
  readonly id: string;
  readonly appId: string;
  readonly name: string;
  readonly runtime: RigRuntimeConfig;
  readonly resources: RigResourceLimits;
  readonly storage?: readonly RigStorageMount[];
  readonly preferredPort?: number;
  readonly ttlSeconds: number;
  readonly source: RigTruthSource;
  readonly createdAt: string;
}

export interface RigLifecycleEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly fromState: RigLifecycleState | null;
  readonly toState: RigLifecycleState;
  readonly reason?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RigObservedState {
  readonly lifecycle: RigLifecycleState;
  readonly allocatedPort?: number;
  readonly memoryMb: number;
  readonly cpuPercent?: number;
  readonly startedAt?: string;
  readonly stoppedAt?: string;
  readonly expiresAt?: string;
  readonly lastHealthCheckAt?: string;
  readonly healthDetails?: string;
  readonly exitCode?: number;
  readonly errorMessage?: string;
  readonly events: readonly RigLifecycleEvent[];
}

export interface RigInstance {
  readonly spec: RigSpec;
  readonly observed: RigObservedState;
}

// Backwards-compatibility interface for existing consumers
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
  readonly status: RigLifecycleState | 'online' | 'rebuilding' | 'oom_recovered' | 'idle';
  readonly testEvidenceScore?: number;
  readonly portalUrl?: string;
}

// Initial demo fleet used when callers instantiate without custom fleet options
export const INITIAL_FLEET: readonly RigContainer[] = [
  {
    id: 'rig-wa-9812',
    appId: 'wallart',
    name: 'nate/wallart',
    port: 3002,
    memoryMb: 48,
    memoryCapMb: 256,
    sqlitePath: '/data/wallart.sqlite',
    sqliteSizeBytes: 15518920,
    walJournalSizeBytes: 0,
    status: 'healthy'
  },
  {
    id: 'rig-rc-4401',
    appId: 'retro-calc',
    name: 'sam/retro-calc',
    port: 3001,
    memoryMb: 24,
    memoryCapMb: 256,
    sqlitePath: '/data/app.sqlite',
    sqliteSizeBytes: 1468006,
    walJournalSizeBytes: 0,
    status: 'healthy'
  },
  {
    id: 'rig-st-1109',
    appId: 'sailtrack',
    name: 'nate/sailtrack',
    port: 3003,
    memoryMb: 38,
    memoryCapMb: 256,
    sqlitePath: '/data/telemetry.sqlite',
    sqliteSizeBytes: 4404019,
    walJournalSizeBytes: 0,
    status: 'healthy'
  }
];

// Legal State Transitions
export const LEGAL_RIG_TRANSITIONS: Readonly<Record<RigLifecycleState, readonly RigLifecycleState[]>> = {
  queued: ['building', 'starting', 'crashed', 'stopped'],
  building: ['starting', 'crashed', 'oom', 'stopped'],
  starting: ['healthy', 'degraded', 'crashed', 'oom', 'stopped'],
  healthy: ['degraded', 'crashed', 'oom', 'expired', 'stopped'],
  degraded: ['healthy', 'crashed', 'oom', 'expired', 'stopped'],
  crashed: ['queued', 'stopped'],
  oom: ['queued', 'stopped'],
  expired: ['queued', 'stopped'],
  stopped: ['queued']
};

export function isValidRigTransition(from: RigLifecycleState, to: RigLifecycleState): boolean {
  return LEGAL_RIG_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateRigTransition(
  from: RigLifecycleState,
  to: RigLifecycleState
): { readonly valid: boolean; readonly error?: string } {
  if (isValidRigTransition(from, to)) {
    return { valid: true };
  }
  const allowed = LEGAL_RIG_TRANSITIONS[from] || [];
  return {
    valid: false,
    error: `Illegal state transition from '${from}' to '${to}'. Allowed target states: [${allowed.join(', ')}]`
  };
}

export type RigValidationResult<T> =
  | { readonly valid: true; readonly data: T }
  | { readonly valid: false; readonly errors: readonly string[] };

export function validateRigStorageMount(mount: unknown): RigValidationResult<RigStorageMount> {
  const errors: string[] = [];
  if (typeof mount !== 'object' || mount === null) {
    return { valid: false, errors: ['Storage mount must be a non-null object.'] };
  }
  const m = mount as Record<string, unknown>;
  const validKinds: RigStorageKind[] = ['volume', 'sqlite', 'directory', 'ephemeral', 'block'];
  if (typeof m.kind !== 'string' || !validKinds.includes(m.kind as RigStorageKind)) {
    if (m.kind === 'none') {
      errors.push('Storage kind "none" is not a valid mount; absence of storage mounts represents stateless configuration.');
    } else {
      errors.push(`Storage mount kind must be one of: ${validKinds.join(', ')}`);
    }
  }

  if (typeof m.mountPath !== 'string' || m.mountPath.trim().length === 0) {
    errors.push('Storage mount must specify a non-empty string mountPath.');
  } else if (!m.mountPath.startsWith('/')) {
    errors.push('Storage mountPath must be an absolute path starting with "/".');
  } else if (m.mountPath.includes('..')) {
    errors.push('Storage mountPath must not contain path traversal (..).');
  }

  const validPersistence: RigStoragePersistence[] = ['ephemeral', 'persistent', 'retained'];
  if (typeof m.persistence !== 'string' || !validPersistence.includes(m.persistence as RigStoragePersistence)) {
    errors.push(`Storage persistence must be one of: ${validPersistence.join(', ')}`);
  }

  if (m.sizeBytes !== undefined && (typeof m.sizeBytes !== 'number' || !Number.isFinite(m.sizeBytes) || m.sizeBytes < 0)) {
    errors.push('Storage sizeBytes must be a non-negative finite number.');
  }

  if (m.sizeMb !== undefined && (typeof m.sizeMb !== 'number' || !Number.isFinite(m.sizeMb) || m.sizeMb < 0)) {
    errors.push('Storage sizeMb must be a non-negative finite number.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      name: typeof m.name === 'string' ? m.name : undefined,
      kind: m.kind as RigStorageKind,
      mountPath: String(m.mountPath),
      sizeBytes: typeof m.sizeBytes === 'number' ? m.sizeBytes : undefined,
      sizeMb: typeof m.sizeMb === 'number' ? m.sizeMb : undefined,
      persistence: m.persistence as RigStoragePersistence
    }
  };
}

export function validateRigSpec(spec: unknown): RigValidationResult<RigSpec> {
  const errors: string[] = [];

  if (typeof spec !== 'object' || spec === null) {
    return { valid: false, errors: ['Rig spec must be a non-null object.'] };
  }

  const s = spec as Record<string, unknown>;

  if (typeof s.id !== 'string' || !s.id.match(/^[a-z0-9_-]{2,}$/i)) {
    errors.push('Rig spec id must match /^[a-z0-9_-]{2,}$/i');
  }

  if (typeof s.appId !== 'string' || s.appId.trim().length === 0) {
    errors.push('Rig spec must specify a non-empty string appId.');
  }

  if (typeof s.name !== 'string' || s.name.trim().length === 0) {
    errors.push('Rig spec must specify a non-empty string name.');
  }

  const validSources: RigTruthSource[] = ['demo', 'provider'];
  if (typeof s.source !== 'string' || !validSources.includes(s.source as RigTruthSource)) {
    errors.push(`Rig spec source must be one of: ${validSources.join(', ')}`);
  }

  if (typeof s.ttlSeconds !== 'number' || !Number.isInteger(s.ttlSeconds) || s.ttlSeconds <= 0) {
    errors.push('Rig spec ttlSeconds must be a positive integer.');
  }

  if (s.preferredPort !== undefined) {
    if (typeof s.preferredPort !== 'number' || !Number.isInteger(s.preferredPort) || s.preferredPort < 1024 || s.preferredPort > 65535) {
      errors.push('Rig spec preferredPort must be an integer between 1024 and 65535.');
    }
  }

  if (typeof s.createdAt !== 'string' || s.createdAt.trim().length === 0 || Number.isNaN(Date.parse(s.createdAt))) {
    errors.push('Rig spec createdAt must be a valid date timestamp string.');
  }

  // Runtime config validation
  if (typeof s.runtime !== 'object' || s.runtime === null) {
    errors.push('Rig spec must contain a runtime configuration object.');
  } else {
    const r = s.runtime as Record<string, unknown>;
    const validAdapters: RigRuntimeAdapterKind[] = ['process', 'docker', 'wasm', 'custom', 'simulation'];
    if (typeof r.adapter !== 'string' || !validAdapters.includes(r.adapter as RigRuntimeAdapterKind)) {
      errors.push(`Runtime adapter must be one of: ${validAdapters.join(', ')}`);
    }
    if (typeof r.startCommand !== 'string' || r.startCommand.trim().length === 0) {
      errors.push('Runtime startCommand must be a non-empty string.');
    }
  }

  // Resource limits validation
  if (typeof s.resources !== 'object' || s.resources === null) {
    errors.push('Rig spec must contain a resources configuration object.');
  } else {
    const res = s.resources as Record<string, unknown>;
    if (typeof res.memoryCapMb !== 'number' || !Number.isFinite(res.memoryCapMb) || res.memoryCapMb <= 0) {
      errors.push('Resource limits memoryCapMb must be a positive finite number.');
    }
    if (res.cpuCores !== undefined && (typeof res.cpuCores !== 'number' || !Number.isFinite(res.cpuCores) || res.cpuCores <= 0)) {
      errors.push('Resource limits cpuCores must be a positive finite number.');
    }
  }

  // Storage validation
  const validatedStorage: RigStorageMount[] = [];
  if (s.storage !== undefined) {
    if (!Array.isArray(s.storage)) {
      errors.push('Rig spec storage must be an array of storage mounts.');
    } else {
      s.storage.forEach((mount, idx) => {
        const mountRes = validateRigStorageMount(mount);
        if (!mountRes.valid) {
          errors.push(`Storage mount [${idx}]: ${mountRes.errors.join('; ')}`);
        } else {
          validatedStorage.push(mountRes.data);
        }
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const runtimeObj = s.runtime as Record<string, unknown>;
  const resourcesObj = s.resources as Record<string, unknown>;

  return {
    valid: true,
    data: {
      id: String(s.id),
      appId: String(s.appId),
      name: String(s.name),
      runtime: {
        adapter: runtimeObj.adapter as RigRuntimeAdapterKind,
        buildCommand: typeof runtimeObj.buildCommand === 'string' ? runtimeObj.buildCommand : undefined,
        startCommand: String(runtimeObj.startCommand),
        healthCommand: typeof runtimeObj.healthCommand === 'string' ? runtimeObj.healthCommand : undefined,
        healthEndpoint: typeof runtimeObj.healthEndpoint === 'string' ? runtimeObj.healthEndpoint : undefined,
        env: typeof runtimeObj.env === 'object' && runtimeObj.env !== null ? (runtimeObj.env as Record<string, string>) : undefined,
        imageDigest: typeof runtimeObj.imageDigest === 'string' ? runtimeObj.imageDigest : undefined
      },
      resources: {
        memoryCapMb: Number(resourcesObj.memoryCapMb),
        cpuCores: typeof resourcesObj.cpuCores === 'number' ? Number(resourcesObj.cpuCores) : undefined
      },
      storage: validatedStorage.length > 0 ? validatedStorage : undefined,
      preferredPort: typeof s.preferredPort === 'number' ? s.preferredPort : undefined,
      ttlSeconds: Number(s.ttlSeconds),
      source: s.source as RigTruthSource,
      createdAt: String(s.createdAt)
    }
  };
}

// Backwards-compatible validator for RigContainer
export function validateRigContainer(container: unknown): RigValidationResult<RigContainer> {
  const errors: string[] = [];

  if (typeof container !== 'object' || container === null) {
    return { valid: false, errors: ['Rig container must be a non-null object.'] };
  }

  const c = container as Record<string, unknown>;

  if (typeof c.id !== 'string' || !c.id.match(/^rig-[a-z0-9_-]{2,}$/i)) {
    errors.push('Rig container id must match /^rig-[a-z0-9_-]{2,}$/i');
  }

  if (typeof c.appId !== 'string' || c.appId.trim().length === 0) {
    errors.push('Rig container must specify a non-empty string appId.');
  }

  if (typeof c.name !== 'string' || c.name.trim().length === 0) {
    errors.push('Rig container must specify a non-empty string name.');
  }

  if (typeof c.port !== 'number' || !Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) {
    errors.push('Port must be an integer between 1024 and 65535.');
  }

  if (typeof c.memoryCapMb !== 'number' || c.memoryCapMb <= 0) {
    errors.push('Memory cap must be a positive number.');
  }

  if (typeof c.memoryMb !== 'number' || c.memoryMb < 0) {
    errors.push('Memory usage must be a non-negative number.');
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
      memoryCapMb: Number(c.memoryCapMb),
      sqlitePath: typeof c.sqlitePath === 'string' ? c.sqlitePath : '',
      sqliteSizeBytes: typeof c.sqliteSizeBytes === 'number' ? c.sqliteSizeBytes : 0,
      walJournalSizeBytes: typeof c.walJournalSizeBytes === 'number' ? c.walJournalSizeBytes : 0,
      status: (c.status as any) || 'healthy',
      testEvidenceScore: typeof c.testEvidenceScore === 'number' ? c.testEvidenceScore : undefined,
      portalUrl: typeof c.portalUrl === 'string' ? c.portalUrl : undefined
    }
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h === 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${h}h ${remM.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
}
