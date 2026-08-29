import { describe, it, expect, beforeEach } from 'vitest';
import {
  MicroDynoPortAllocator,
  RigMemoryGovernor,
  RigControlPlane,
  RigRuntimeBackend,
  PORT_RANGE_START,
  PORT_RANGE_END,
  MEMORY_CAP_MB
} from '../src/lib/rigBackend';
import {
  type RigSpec,
  validateRigSpec,
  validateRigStorageMount,
  validateRigTransition,
  isValidRigTransition,
  formatBytes,
  formatDuration
} from '../src/lib/rigDomain';

describe('1. Rig Domain Validation & Storage/Runtime Freedom', () => {
  it('should validate a complete and valid RigSpec with Docker adapter and SQLite storage', () => {
    const validSpec: RigSpec = {
      id: 'rig-dronehunter-01',
      appId: 'dronehunter',
      name: 'DroneHunter Telemetry',
      runtime: {
        adapter: 'docker',
        buildCommand: 'npm run build',
        startCommand: 'node dist/server.js',
        healthEndpoint: '/healthz'
      },
      resources: {
        memoryCapMb: 256,
        cpuCores: 1
      },
      storage: [
        {
          name: 'db-volume',
          kind: 'sqlite',
          mountPath: '/data/app.sqlite',
          sizeMb: 64,
          persistence: 'persistent'
        }
      ],
      preferredPort: 3005,
      ttlSeconds: 900,
      source: 'demo',
      createdAt: new Date().toISOString()
    };

    const result = validateRigSpec(validSpec);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.id).toBe('rig-dronehunter-01');
      expect(result.data.runtime.adapter).toBe('docker');
      expect(result.data.storage?.[0].kind).toBe('sqlite');
      expect(result.data.source).toBe('demo');
    }
  });

  it('should validate stateless specs without storage mounts', () => {
    const statelessSpec: RigSpec = {
      id: 'rig-stateless-calc',
      appId: 'calc',
      name: 'Stateless Calculator',
      runtime: {
        adapter: 'wasm',
        startCommand: 'wasm-runner app.wasm'
      },
      resources: {
        memoryCapMb: 128
      },
      ttlSeconds: 300,
      source: 'demo',
      createdAt: new Date().toISOString()
    };

    const result = validateRigSpec(statelessSpec);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.storage).toBeUndefined();
      expect(result.data.runtime.adapter).toBe('wasm');
    }
  });

  it('should validate generic storage mounts across volume, directory, ephemeral, and block kinds', () => {
    const kinds = ['volume', 'directory', 'ephemeral', 'block'] as const;
    for (const kind of kinds) {
      const mountRes = validateRigStorageMount({
        kind,
        mountPath: `/data/${kind}-storage`,
        persistence: 'ephemeral',
        sizeMb: 128
      });
      expect(mountRes.valid).toBe(true);
    }
  });

  it('should reject storage mounts with path traversal attempts', () => {
    const traversalRes = validateRigStorageMount({
      kind: 'sqlite',
      mountPath: '/data/../etc/passwd',
      persistence: 'persistent'
    });
    expect(traversalRes.valid).toBe(false);
    if (!traversalRes.valid) {
      expect(traversalRes.errors.some(e => e.includes('path traversal'))).toBe(true);
    }
  });

  it('should reject invalid specs (missing appId, missing startCommand, invalid TTL, invalid source)', () => {
    const invalidSpec = {
      id: 'invalid-spec',
      appId: '',
      name: '',
      runtime: {
        adapter: 'unknown-adapter',
        startCommand: ''
      },
      resources: {
        memoryCapMb: -50
      },
      ttlSeconds: 0,
      source: 'fake-source'
    };

    const result = validateRigSpec(invalidSpec);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('should format bytes and durations truthfully', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(1073741824)).toBe('1.0 GB');

    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(900)).toBe('15m 00s');
    expect(formatDuration(3665)).toBe('1h 01m 05s');
  });
});

describe('2. Deterministic Lifecycle Transitions & Validation', () => {
  it('should validate legal lifecycle state transitions', () => {
    // Normal progression: queued -> building -> starting -> healthy
    expect(isValidRigTransition('queued', 'building')).toBe(true);
    expect(isValidRigTransition('building', 'starting')).toBe(true);
    expect(isValidRigTransition('starting', 'healthy')).toBe(true);

    // Degradation & Recovery: healthy -> degraded -> healthy
    expect(isValidRigTransition('healthy', 'degraded')).toBe(true);
    expect(isValidRigTransition('degraded', 'healthy')).toBe(true);

    // Failures & Expiry from active:
    expect(isValidRigTransition('healthy', 'crashed')).toBe(true);
    expect(isValidRigTransition('healthy', 'oom')).toBe(true);
    expect(isValidRigTransition('healthy', 'expired')).toBe(true);
    expect(isValidRigTransition('healthy', 'stopped')).toBe(true);

    // Restarts:
    expect(isValidRigTransition('stopped', 'queued')).toBe(true);
    expect(isValidRigTransition('crashed', 'queued')).toBe(true);
    expect(isValidRigTransition('oom', 'queued')).toBe(true);
    expect(isValidRigTransition('expired', 'queued')).toBe(true);
  });

  it('should reject illegal lifecycle transitions', () => {
    expect(isValidRigTransition('queued', 'healthy')).toBe(false);
    expect(isValidRigTransition('stopped', 'healthy')).toBe(false);
    expect(isValidRigTransition('expired', 'building')).toBe(false);
    expect(isValidRigTransition('building', 'expired')).toBe(false);

    const val = validateRigTransition('queued', 'healthy');
    expect(val.valid).toBe(false);
    expect(val.error).toContain("Illegal state transition from 'queued' to 'healthy'");
  });
});

describe('3. MicroDynoPortAllocator: Collisions, Exhaustion, and Safe Release', () => {
  let allocator: MicroDynoPortAllocator;

  beforeEach(() => {
    allocator = new MicroDynoPortAllocator(PORT_RANGE_START, PORT_RANGE_END);
  });

  it('should initialize with boundary ports [3001..3010] all available', () => {
    expect(allocator.minPort).toBe(3001);
    expect(allocator.maxPort).toBe(3010);
    expect(allocator.getAvailablePorts().length).toBe(10);
    expect(allocator.getAllocatedPorts().length).toBe(0);
  });

  it('should allocate ports sequentially and respect availability check', () => {
    const p1 = allocator.allocate('app-1');
    const p2 = allocator.allocate('app-2');

    expect(p1).toBe(3001);
    expect(p2).toBe(3002);
    expect(allocator.isAvailable(3001)).toBe(false);
    expect(allocator.isAvailable(3002)).toBe(false);
    expect(allocator.isAvailable(3003)).toBe(true);
  });

  it('should allocate preferred port if free, and avoid collisions with fallback', () => {
    const preferred = allocator.allocate('app-fav', 3007);
    expect(preferred).toBe(3007);

    // Contender asks for 3007 -> falls back to lowest available (3001)
    const fallback = allocator.allocate('app-contender', 3007);
    expect(fallback).toBe(3001);
  });

  it('should release ports and allow immediate reuse', () => {
    const p1 = allocator.allocate('app-a');
    allocator.allocate('app-b');
    expect(p1).toBe(3001);

    expect(allocator.release(p1)).toBe(true);
    expect(allocator.isAvailable(3001)).toBe(true);

    const reused = allocator.allocate('app-c');
    expect(reused).toBe(3001);
  });

  it('should throw when all 10 ports are allocated (port pool exhaustion)', () => {
    for (let i = 1; i <= 10; i++) {
      allocator.allocate(`worker-${i}`);
    }
    expect(allocator.getAvailablePorts().length).toBe(0);
    expect(() => allocator.allocate('overflow')).toThrow(/Port pool exhausted/i);
  });

  it('should release ports by appId and containerId/instanceId', () => {
    allocator.allocate('tenant-a', undefined, 'inst-1');
    allocator.allocate('tenant-a', undefined, 'inst-2');
    allocator.allocate('tenant-b', undefined, 'inst-3');

    const released = allocator.releaseByApp('tenant-a');
    expect(released).toEqual([3001, 3002]);
    expect(allocator.isAvailable(3001)).toBe(true);
    expect(allocator.isAvailable(3002)).toBe(true);
    expect(allocator.isAvailable(3003)).toBe(false);

    allocator.releaseByInstance('inst-3');
    expect(allocator.isAvailable(3003)).toBe(true);
  });
});

describe('4. RigMemoryGovernor & Honest OOM Observation (No Fabricated Checkpointing)', () => {
  let governor: RigMemoryGovernor;

  beforeEach(() => {
    governor = new RigMemoryGovernor();
  });

  it('should enforce strict 256MB cap constant', () => {
    expect(governor.memoryCapMb).toBe(256);
    expect(MEMORY_CAP_MB).toBe(256);
  });

  it('should allow memory usage within limits without side-effects', () => {
    const target = { memoryCapMb: 256, status: 'healthy', memoryMb: 24 };
    const decision = governor.evaluate(target, 48);

    expect(decision.allowed).toBe(true);
    expect(decision.action).toBe('none');
    expect(decision.memoryMb).toBe(48);
    expect(decision.status).toBe('healthy');
  });

  it('should observe OOM when requested memory exceeds cap without claiming fake WAL checkpointing', () => {
    const target = { memoryCapMb: 256, status: 'healthy', memoryMb: 128 };
    const decision = governor.evaluate(target, 384);

    expect(decision.allowed).toBe(false);
    expect(decision.action).toBe('oom');
    expect(decision.status).toBe('oom');
    expect(decision.message).toContain('exceeds strict 256MB cap');
    // Ensure no fake WAL or R2 claims in message
    expect(decision.message).not.toContain('WAL checkpointed');
    expect(decision.message).not.toContain('Cloudflare R2');
  });

  it('should reject negative, NaN, or non-finite memory requests', () => {
    const target = { memoryCapMb: 256, status: 'healthy', memoryMb: 32 };
    expect(governor.evaluate(target, -1).allowed).toBe(false);
    expect(governor.evaluate(target, NaN).allowed).toBe(false);
    expect(governor.evaluate(target, Infinity).allowed).toBe(false);
  });
});

describe('5. RigControlPlane / RigRuntimeBackend: Deterministic Control Plane', () => {
  let controlPlane: RigControlPlane;

  beforeEach(() => {
    controlPlane = new RigControlPlane({ initialFleet: [] });
  });

  it('should start with empty instances list and full port availability', () => {
    expect(controlPlane.listInstances()).toEqual([]);
    const summary = controlPlane.getStatusSummary();
    expect(summary.totalInstances).toBe(0);
    expect(summary.activePorts.length).toBe(0);
    expect(summary.availablePorts.length).toBe(10);
    expect(summary.provider.connected).toBe(false);
  });

  it('should register a new instance spec in queued state and allocate port', () => {
    const instance = controlPlane.createInstance({
      appId: 'dronehunter',
      name: 'DroneHunter Telemetry',
      runtime: {
        adapter: 'docker',
        startCommand: 'node dist/index.js'
      },
      resources: { memoryCapMb: 256 },
      ttlSeconds: 900,
      source: 'demo'
    });

    expect(instance.spec.appId).toBe('dronehunter');
    expect(instance.observed.lifecycle).toBe('queued');
    expect(instance.observed.allocatedPort).toBe(3001);
    expect(instance.observed.events.length).toBe(1);
    expect(instance.observed.events[0].toState).toBe('queued');
  });

  it('should advance instance legally through building -> starting -> healthy', () => {
    const inst = controlPlane.createInstance({
      appId: 'wallart',
      name: 'WallArt Studio',
      runtime: { adapter: 'process', startCommand: 'npm start' }
    });

    const building = controlPlane.transitionState(inst.spec.id, 'building', 'Building bundle');
    expect(building.observed.lifecycle).toBe('building');

    const starting = controlPlane.transitionState(inst.spec.id, 'starting', 'Starting web process');
    expect(starting.observed.lifecycle).toBe('starting');
    expect(starting.observed.startedAt).toBeDefined();

    const healthy = controlPlane.transitionState(inst.spec.id, 'healthy', 'Health check /healthz responded 200');
    expect(healthy.observed.lifecycle).toBe('healthy');
    expect(healthy.observed.events.length).toBe(4);
  });

  it('should reject illegal transitions in control plane', () => {
    const inst = controlPlane.createInstance({
      appId: 'app-jump',
      name: 'Jump App',
      runtime: { adapter: 'wasm', startCommand: 'wasm-run' }
    });

    // queued -> healthy is illegal (must build/start)
    expect(() => controlPlane.transitionState(inst.spec.id, 'healthy')).toThrow(/Illegal state transition/i);
  });

  it('should observe memory limit exceedance, transition to OOM, and release port', () => {
    const inst = controlPlane.createInstance({
      appId: 'leaky-app',
      name: 'Leaky App',
      runtime: { adapter: 'docker', startCommand: 'leak' },
      resources: { memoryCapMb: 256 }
    });

    const allocatedPort = inst.observed.allocatedPort!;
    expect(controlPlane.portAllocator.isAvailable(allocatedPort)).toBe(false);

    // Advance to healthy
    controlPlane.transitionState(inst.spec.id, 'building');
    controlPlane.transitionState(inst.spec.id, 'starting');
    controlPlane.transitionState(inst.spec.id, 'healthy');

    // Update memory beyond 256MB cap
    const result = controlPlane.updateMemory(inst.spec.id, 512);
    expect(result.decision.action).toBe('oom');
    expect(result.instance.observed.lifecycle).toBe('oom');
    expect(result.instance.observed.allocatedPort).toBeUndefined();

    // Port should now be released
    expect(controlPlane.portAllocator.isAvailable(allocatedPort)).toBe(true);
  });

  it('should automatically release port when stopped, crashed, or deleted', () => {
    const inst = controlPlane.createInstance({
      appId: 'stopping-app',
      name: 'Stopping App',
      runtime: { adapter: 'process', startCommand: 'run' }
    });
    const port = inst.observed.allocatedPort!;

    // Stop instance
    const stopped = controlPlane.stopInstance(inst.spec.id);
    expect(stopped.observed.lifecycle).toBe('stopped');
    expect(stopped.observed.allocatedPort).toBeUndefined();
    expect(controlPlane.portAllocator.isAvailable(port)).toBe(true);

    // Delete instance
    expect(controlPlane.deleteInstance(inst.spec.id)).toBe(true);
    expect(controlPlane.getInstance(inst.spec.id)).toBeUndefined();
  });

  it('should enforce TTL expiry and release resources', () => {
    const inst = controlPlane.createInstance({
      appId: 'ephemeral-app',
      name: 'Ephemeral App',
      runtime: { adapter: 'simulation', startCommand: 'run' },
      ttlSeconds: 60
    });
    const port = inst.observed.allocatedPort!;

    // Move to healthy
    controlPlane.transitionState(inst.spec.id, 'building');
    controlPlane.transitionState(inst.spec.id, 'starting');
    controlPlane.transitionState(inst.spec.id, 'healthy');

    // Check expiry at now (should not be expired yet)
    const notExpired = controlPlane.checkExpiry(new Date());
    expect(notExpired.length).toBe(0);
    expect(controlPlane.getInstance(inst.spec.id)?.observed.lifecycle).toBe('healthy');

    // Fast forward 120 seconds into future
    const futureDate = new Date(Date.now() + 120 * 1000);
    const expiredList = controlPlane.checkExpiry(futureDate);

    expect(expiredList.length).toBe(1);
    expect(expiredList[0].spec.id).toBe(inst.spec.id);
    expect(expiredList[0].observed.lifecycle).toBe('expired');
    expect(expiredList[0].observed.allocatedPort).toBeUndefined();
    expect(controlPlane.portAllocator.isAvailable(port)).toBe(true);
  });

  it('should restart instance from stopped/oom/crashed/expired, reacquiring port and resetting timer', () => {
    const inst = controlPlane.createInstance({
      appId: 'reboot-app',
      name: 'Reboot App',
      runtime: { adapter: 'docker', startCommand: 'run' }
    });

    controlPlane.stopInstance(inst.spec.id);
    expect(controlPlane.getInstance(inst.spec.id)?.observed.lifecycle).toBe('stopped');

    const restarted = controlPlane.restartInstance(inst.spec.id);
    expect(restarted.observed.lifecycle).toBe('queued');
    expect(restarted.observed.allocatedPort).toBeDefined();
    expect(restarted.observed.memoryMb).toBe(0);
    expect(restarted.observed.events.some(e => e.reason?.includes('restarted'))).toBe(true);
  });

  it('should support legacy RigRuntimeBackend alias and spawnContainer compatibility', () => {
    const backend = new RigRuntimeBackend({ initialFleet: [] });
    const c = backend.spawnContainer({
      appId: 'legacy-app',
      name: 'Legacy Container',
      initialMemoryMb: 32,
      sqliteFileName: 'legacy'
    });

    expect(c.appId).toBe('legacy-app');
    expect(c.port).toBe(3001);
    expect(c.memoryMb).toBe(32);
    expect(c.memoryCapMb).toBe(256);
    expect(c.sqlitePath).toBe('/data/legacy.sqlite');

    const containers = backend.listContainers();
    expect(containers.length).toBe(1);

    expect(backend.terminateContainer(c.id)).toBe(true);
    expect(backend.listContainers().length).toBe(0);
  });

  it('should never claim fake container execution, R2 uploads, or cryptographic checksums', () => {
    const inst = controlPlane.createInstance({
      appId: 'honest-app',
      name: 'Honest App',
      runtime: { adapter: 'simulation', startCommand: 'run' },
      source: 'demo'
    });

    expect(inst.spec.source).toBe('demo');
    const providerStatus = controlPlane.getProviderStatus();
    expect(providerStatus.connected).toBe(false);
    expect(providerStatus.message).toContain('Provider disconnected');

    // Verify events contain honest control-plane audit logs
    inst.observed.events.forEach(evt => {
      expect(evt.reason).not.toContain('Uploaded to R2');
      expect(evt.reason).not.toContain('Litestream replication');
      expect(evt.reason).not.toContain('irrefutable evidence');
    });
  });
});
