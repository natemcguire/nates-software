import { describe, it, expect, beforeEach } from 'vitest';
import {
  BoundedDockerProvider,
  RigDockerControlApi,
  NodeChildProcessRunner,
  buildDockerCreateArgv,
  type DockerInspectData
} from '../src/lib/rigDockerProvider';
import { MockDockerCommandRunner } from './fixtures/mockDockerRunner';
import {
  type RigSpec,
  type RigInstance,
  type RigOwnerIdentity,
  RigAuthenticationError,
  RigAuthorizationError,
  RigQuotaExceededError,
  RigSecurityViolationError,
  RigPreflightError,
  isValidImageDigest,
  isForbiddenMountPath,
  validateRigSpec
} from '../src/lib/rigDomain';

describe('RIG.EXE Bounded Docker Provider Adapter & Control API', () => {
  const sampleOwner: RigOwnerIdentity = {
    ownerId: 'nate-corp',
    username: 'nate',
    role: 'owner'
  };

  const sampleAdmin: RigOwnerIdentity = {
    ownerId: 'admin-user',
    username: 'superadmin',
    role: 'admin'
  };

  const otherOwner: RigOwnerIdentity = {
    ownerId: 'other-team',
    username: 'alice',
    role: 'owner'
  };

  const validPinnedDigest = 'ghcr.io/nates-software/dronehunter@sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

  const makeValidSpec = (overrides?: Partial<RigSpec>): RigSpec => ({
    id: 'rig-dh-9912',
    appId: 'dronehunter',
    name: 'DroneHunter Preview',
    ownerId: sampleOwner.ownerId,
    runtime: {
      adapter: 'docker',
      startCommand: 'node dist/index.js',
      imageDigest: validPinnedDigest,
      networkPolicy: 'none'
    },
    resources: {
      memoryCapMb: 256,
      cpuCores: 1,
      pidsLimit: 64
    },
    ttlSeconds: 900,
    source: 'provider',
    createdAt: new Date().toISOString(),
    ...overrides
  });

  // -------------------------------------------------------------------------
  // 1. Fail-Closed Config & Preflight Checks
  // -------------------------------------------------------------------------
  describe('1. Fail-Closed Config & Preflight Checks', () => {
    it('reports available=true when daemon is reachable and returns server version', async () => {
      const mockRunner = new MockDockerCommandRunner();
      mockRunner.setHandler('version', () => ({
        stdout: JSON.stringify({
          Client: { Version: '29.4.0' },
          Server: { Version: '29.4.0' }
        }),
        stderr: '',
        exitCode: 0
      }));

      const provider = new BoundedDockerProvider({ runner: mockRunner });
      const preflight = await provider.checkPreflight(true);

      expect(preflight.available).toBe(true);
      expect(preflight.daemonReachable).toBe(true);
      expect(preflight.serverVersion).toBe('29.4.0');
      expect(preflight.clientVersion).toBe('29.4.0');
      expect(preflight.error).toBeUndefined();
    });

    it('reports available=false and daemonReachable=false when daemon is offline (fail-closed)', async () => {
      const mockRunner = new MockDockerCommandRunner();
      mockRunner.setHandler('version', () => ({
        stdout: 'Client: Docker Engine 29.4.0\nCannot connect to the Docker daemon at unix:///var/run/docker.sock',
        stderr: 'Cannot connect to the Docker daemon',
        exitCode: 1
      }));

      const provider = new BoundedDockerProvider({ runner: mockRunner });
      const preflight = await provider.checkPreflight(true);

      expect(preflight.available).toBe(false);
      expect(preflight.daemonReachable).toBe(false);
      expect(preflight.error).toContain('Cannot connect to the Docker daemon');
    });

    it('refuses to start live container and throws RigPreflightError when daemon is offline', async () => {
      const mockRunner = new MockDockerCommandRunner();
      mockRunner.setHandler('version', () => ({
        stdout: '',
        stderr: 'Cannot connect to Docker daemon',
        exitCode: 1
      }));

      const provider = new BoundedDockerProvider({ runner: mockRunner });
      const spec = makeValidSpec();

      await expect(provider.createAndStart(sampleOwner, spec, 3001)).rejects.toThrow(RigPreflightError);
    });

    it('queries the actual host Docker CLI and truthfully reports daemon status without fabricating connectivity', async () => {
      const realRunner = new NodeChildProcessRunner();
      const provider = new BoundedDockerProvider({ runner: realRunner });
      const preflight = await provider.checkPreflight(true);

      // On this host, Docker CLI exists but daemon is unreachable
      expect(typeof preflight.available).toBe('boolean');
      expect(preflight.checkedAt).toBeDefined();
      // Must not falsely claim connectivity
      if (!preflight.daemonReachable) {
        expect(preflight.available).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Argv Construction, Shell-Less Execution & Image Digest Pinning
  // -------------------------------------------------------------------------
  describe('2. Argv Construction & Security Sandboxing', () => {
    it('builds strict argv vector with all security sandboxing flags', () => {
      const spec = makeValidSpec({ preferredPort: 3002 });
      const argv = buildDockerCreateArgv({
        spec,
        owner: sampleOwner,
        hostPort: 3002
      });

      expect(argv[0]).toBe('create');
      expect(argv).toContain('--name');
      expect(argv).toContain('rig-box-rig-dh-9912');

      // Security flags
      expect(argv).toContain('--user');
      expect(argv).toContain('10001:10001');
      expect(argv).toContain('--cap-drop=ALL');
      expect(argv).toContain('--security-opt');
      expect(argv).toContain('no-new-privileges:true');
      expect(argv).toContain('--read-only');

      // Tmpfs mounts
      expect(argv).toContain('--tmpfs');
      expect(argv).toContain('/tmp:rw,noexec,nosuid,size=32m');
      expect(argv).toContain('/run:rw,noexec,nosuid,size=8m');

      // Resource limits (<= 256MB)
      expect(argv).toContain('--memory');
      expect(argv).toContain('256m');
      expect(argv).toContain('--memory-swap');
      expect(argv).toContain('256m');
      expect(argv).toContain('--cpus');
      expect(argv).toContain('1');
      expect(argv).toContain('--pids-limit');
      expect(argv).toContain('64');

      // Network: default none
      expect(argv).toContain('--network');
      expect(argv).toContain('none');

      // Loopback port bind ONLY
      expect(argv).toContain('-p');
      expect(argv).toContain('127.0.0.1:3002:3001');

      // Labels
      expect(argv).toContain('rig.managed=true');
      expect(argv).toContain(`rig.instance.id=${spec.id}`);
      expect(argv).toContain(`rig.owner.id=${sampleOwner.ownerId}`);

      // Image digest
      expect(argv).toContain(validPinnedDigest);
    });

    it('validates image digest format and rejects unpinned floating tags', () => {
      expect(isValidImageDigest(validPinnedDigest)).toBe(true);
      expect(isValidImageDigest('alpine@sha256:e4355b66995c96dd16b9f2b835ac85e355509174e845e649d372770f64f4235c')).toBe(true);

      // Unpinned tags must fail
      expect(isValidImageDigest('alpine:latest')).toBe(false);
      expect(isValidImageDigest('node:20-alpine')).toBe(false);
      expect(isValidImageDigest('myregistry.io/app:v1')).toBe(false);
      expect(isValidImageDigest('')).toBe(false);

      const unpinnedSpec = makeValidSpec({
        runtime: {
          adapter: 'docker',
          startCommand: 'run',
          imageDigest: 'alpine:latest'
        }
      });

      expect(() =>
        buildDockerCreateArgv({
          spec: unpinnedSpec,
          owner: sampleOwner,
          hostPort: 3001
        })
      ).toThrow(RigSecurityViolationError);
    });

    it('rejects memory requests exceeding hard 256MB cap', () => {
      const overMemSpec = makeValidSpec({
        resources: { memoryCapMb: 512 }
      });

      expect(() =>
        buildDockerCreateArgv({
          spec: overMemSpec,
          owner: sampleOwner,
          hostPort: 3001
        })
      ).toThrow(RigSecurityViolationError);
    });

    it('rejects host port outside bounded 3001-3010 range', () => {
      const spec = makeValidSpec();
      expect(() =>
        buildDockerCreateArgv({
          spec,
          owner: sampleOwner,
          hostPort: 8080 // out of bounds
        })
      ).toThrow(RigSecurityViolationError);

      expect(() =>
        buildDockerCreateArgv({
          spec,
          owner: sampleOwner,
          hostPort: 3000 // below min
        })
      ).toThrow(RigSecurityViolationError);

      expect(() =>
        buildDockerCreateArgv({
          spec,
          owner: sampleOwner,
          hostPort: 3011 // above max
        })
      ).toThrow(RigSecurityViolationError);
    });

    it('supports explicit bridge network policy with rig-bridge (never host)', () => {
      const bridgeSpec = makeValidSpec({
        runtime: {
          adapter: 'docker',
          startCommand: 'run',
          imageDigest: validPinnedDigest,
          networkPolicy: 'bridge'
        }
      });

      const argv = buildDockerCreateArgv({
        spec: bridgeSpec,
        owner: sampleOwner,
        hostPort: 3003,
        config: { allowBridgeNetwork: true }
      });

      const netIdx = argv.indexOf('--network');
      expect(netIdx).toBeGreaterThan(-1);
      expect(argv[netIdx + 1]).toBe('rig-bridge');
      expect(argv).not.toContain('host');
    });

    it('fails closed on bridge networking unless trusted configuration explicitly enables it', () => {
      const bridgeSpec = makeValidSpec({
        runtime: { adapter: 'docker', startCommand: 'run', imageDigest: validPinnedDigest, networkPolicy: 'bridge' }
      });
      expect(() => buildDockerCreateArgv({ spec: bridgeSpec, owner: sampleOwner, hostPort: 3003 }))
        .toThrow(RigSecurityViolationError);
    });

    it('rejects unsafe owner and storage identifiers before constructing Docker labels or volume syntax', () => {
      const spec = makeValidSpec();
      expect(() => buildDockerCreateArgv({ spec, owner: { ownerId: 'owner,rig.owner.id=attacker' }, hostPort: 3001 }))
        .toThrow(RigAuthenticationError);
      const unsafeMount = makeValidSpec({ storage: [{ name: 'bad:name', kind: 'volume', mountPath: '/data', persistence: 'persistent' }] });
      expect(validateRigSpec(unsafeMount).valid).toBe(false);
    });

    it('forbids host paths, docker socket, and rootfs bind mounts', () => {
      expect(isForbiddenMountPath('/var/run/docker.sock')).toBe(true);
      expect(isForbiddenMountPath('/docker.sock')).toBe(true);
      expect(isForbiddenMountPath('/etc/shadow')).toBe(true);
      expect(isForbiddenMountPath('/proc/sys')).toBe(true);
      expect(isForbiddenMountPath('/data/app.sqlite')).toBe(false);

      const badMountSpec = makeValidSpec({
        storage: [
          {
            kind: 'volume',
            mountPath: '/var/run/docker.sock',
            persistence: 'ephemeral'
          }
        ]
      });

      expect(() =>
        buildDockerCreateArgv({
          spec: badMountSpec,
          owner: sampleOwner,
          hostPort: 3001
        })
      ).toThrow(RigSecurityViolationError);
    });

    it('passes arguments strictly as argv without shell expansion (prevents command injection)', async () => {
      const mockRunner = new MockDockerCommandRunner();
      const provider = new BoundedDockerProvider({ runner: mockRunner });

      // Spec with shell metacharacters in start command
      const injectionSpec = makeValidSpec({
        runtime: {
          adapter: 'docker',
          startCommand: 'node -e process.exit(0); rm -rf / ; $(whoami) `cat /etc/passwd`',
          imageDigest: validPinnedDigest
        }
      });

      await provider.createAndStart(sampleOwner, injectionSpec, 3001);

      const createCall = mockRunner.recordedCalls.find(c => c.args[0] === 'create');
      expect(createCall).toBeDefined();
      // Tokens are passed as separate array elements, not executed in shell
      expect(createCall?.args).toContain('node');
      expect(createCall?.args).toContain('-e');
      expect(createCall?.args).toContain('process.exit(0);');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Lifecycle Normalization & Exit 137 / OOM Triage
  // -------------------------------------------------------------------------
  describe('3. Lifecycle Normalization & Exit 137 / OOM Triage', () => {
    let provider: BoundedDockerProvider;

    beforeEach(() => {
      provider = new BoundedDockerProvider();
    });

    it('normalizes Running=true to healthy', () => {
      const inspect: DockerInspectData = {
        Id: 'c123',
        Name: '/rig-box-1',
        State: {
          Status: 'running',
          Running: true,
          OOMKilled: false,
          ExitCode: 0,
          StartedAt: '2026-08-29T12:00:00Z',
          FinishedAt: '0001-01-01T00:00:00Z'
        }
      };

      const spec = makeValidSpec();
      const state = provider.normalizeDockerState(inspect, spec, 3001);
      expect(state.lifecycle).toBe('healthy');
      expect(state.allocatedPort).toBe(3001);
      expect(state.startedAt).toBe('2026-08-29T12:00:00Z');
    });

    it('normalizes OOMKilled=true to oom lifecycle state', () => {
      const inspect: DockerInspectData = {
        Id: 'c123',
        Name: '/rig-box-1',
        State: {
          Status: 'exited',
          Running: false,
          OOMKilled: true,
          ExitCode: 137,
          StartedAt: '2026-08-29T12:00:00Z',
          FinishedAt: '2026-08-29T12:05:00Z'
        }
      };

      const spec = makeValidSpec();
      const state = provider.normalizeDockerState(inspect, spec, 3001);
      expect(state.lifecycle).toBe('oom');
      expect(state.allocatedPort).toBeUndefined(); // Port released
      expect(state.errorMessage).toContain('OOMKilled=true');
    });

    it('keeps ExitCode=137 as an unproven SIGKILL unless Docker reports OOMKilled', () => {
      const inspect: DockerInspectData = {
        Id: 'c123',
        Name: '/rig-box-1',
        State: {
          Status: 'exited',
          Running: false,
          OOMKilled: false,
          ExitCode: 137,
          StartedAt: '2026-08-29T12:00:00Z',
          FinishedAt: '2026-08-29T12:05:00Z'
        }
      };

      const spec = makeValidSpec();
      const state = provider.normalizeDockerState(inspect, spec, 3001);
      expect(state.lifecycle).toBe('crashed');
      expect(state.errorMessage).toContain('Exit Code 137');
      expect(state.errorMessage).toContain('not proven');
    });

    it('normalizes non-zero exit code (e.g. exit 1) to crashed', () => {
      const inspect: DockerInspectData = {
        Id: 'c123',
        Name: '/rig-box-1',
        State: {
          Status: 'exited',
          Running: false,
          OOMKilled: false,
          ExitCode: 1,
          StartedAt: '2026-08-29T12:00:00Z',
          FinishedAt: '2026-08-29T12:01:00Z'
        }
      };

      const spec = makeValidSpec();
      const state = provider.normalizeDockerState(inspect, spec, 3001);
      expect(state.lifecycle).toBe('crashed');
      expect(state.exitCode).toBe(1);
    });

    it('normalizes ExitCode=0 to stopped', () => {
      const inspect: DockerInspectData = {
        Id: 'c123',
        Name: '/rig-box-1',
        State: {
          Status: 'exited',
          Running: false,
          OOMKilled: false,
          ExitCode: 0,
          StartedAt: '2026-08-29T12:00:00Z',
          FinishedAt: '2026-08-29T12:10:00Z'
        }
      };

      const spec = makeValidSpec();
      const state = provider.normalizeDockerState(inspect, spec, 3001);
      expect(state.lifecycle).toBe('stopped');
      expect(state.exitCode).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Idempotent Stop & Remove Operations
  // -------------------------------------------------------------------------
  describe('4. Idempotent Stop & Remove Operations', () => {
    it('stops container idempotently when already stopped or not running', async () => {
      const mockRunner = new MockDockerCommandRunner();
      mockRunner.setHandler('stop', () => ({
        stdout: '',
        stderr: 'Error response from daemon: Container is not running',
        exitCode: 1
      }));

      const provider = new BoundedDockerProvider({ runner: mockRunner });
      const result = await provider.stopContainer(sampleOwner, 'inst-1');
      expect(result.stopped).toBe(true);
      expect(result.wasRunning).toBe(false);
    });

    it('removes container idempotently when already removed', async () => {
      const mockRunner = new MockDockerCommandRunner();
      mockRunner.setHandler('rm', () => ({
        stdout: '',
        stderr: 'Error: No such container: rig-box-inst-1',
        exitCode: 1
      }));

      const provider = new BoundedDockerProvider({ runner: mockRunner });
      const result = await provider.removeContainer(sampleOwner, 'inst-1');
      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Bounded Log Retrieval
  // -------------------------------------------------------------------------
  describe('5. Bounded Log Retrieval', () => {
    it('bounds log lines and max buffer size to prevent memory exhaustion', async () => {
      const mockRunner = new MockDockerCommandRunner();
      const provider = new BoundedDockerProvider({
        runner: mockRunner,
        config: { maxLogLines: 100 }
      });

      await provider.getContainerLogs(sampleOwner, 'inst-1', 500);

      const logsCall = mockRunner.recordedCalls.find(c => c.args[0] === 'logs');
      expect(logsCall).toBeDefined();
      expect(logsCall?.args).toContain('--tail');
      // Should be clamped to maxLogLines (100)
      expect(logsCall?.args).toContain('100');
    });
  });

  // -------------------------------------------------------------------------
  // 6. TTL Labels & Automated Reaper
  // -------------------------------------------------------------------------
  describe('6. TTL Labels & Automated Reaper', () => {
    it('scans rig.managed=true containers and reaps expired instances', async () => {
      const mockRunner = new MockDockerCommandRunner();
      const pastDate = new Date(Date.now() - 60000).toISOString();
      const futureDate = new Date(Date.now() + 600000).toISOString();

      mockRunner.setHandler('ps', () => ({
        stdout: [
          JSON.stringify({
            Id: 'c1',
            Labels: `rig.managed=true,rig.instance.id=expired-inst,rig.owner.id=nate-corp,rig.expires.at=${pastDate}`
          }),
          JSON.stringify({
            Id: 'c2',
            Labels: `rig.managed=true,rig.instance.id=active-inst,rig.owner.id=nate-corp,rig.expires.at=${futureDate}`
          })
        ].join('\n'),
        stderr: '',
        exitCode: 0
      }));

      const provider = new BoundedDockerProvider({ runner: mockRunner });
      const reaped = await provider.reapExpiredContainers(new Date());

      expect(reaped).toEqual(['expired-inst']);
      expect(mockRunner.recordedCalls.some(c => c.args[0] === 'rm' && c.args.includes('rig-box-expired-inst'))).toBe(true);
      expect(mockRunner.recordedCalls.some(c => c.args.includes('rig-box-active-inst'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Authenticated Control API & Trusted Boundary Authentication
  // -------------------------------------------------------------------------
  describe('7. Authenticated Control API & Multi-Tenant Boundaries', () => {
    let mockRunner: MockDockerCommandRunner;
    let controlApi: RigDockerControlApi;

    beforeEach(() => {
      mockRunner = new MockDockerCommandRunner();
      const provider = new BoundedDockerProvider({ runner: mockRunner });
      controlApi = new RigDockerControlApi({
        dockerProvider: provider,
        maxInstancesPerOwner: 2
      });
    });

    it('restores a durable registry entry only after Docker label and image reconciliation', async () => {
      const spec = makeValidSpec();
      const expiresAt = new Date('2026-08-29T22:00:00.000Z').toISOString();
      mockRunner.setHandler('inspect', (_file, args) => ({
        stdout: JSON.stringify([{
          Id: 'container-1', Name: `/${args.at(-1)}`,
          State: { Status: 'running', Running: true, OOMKilled: false, ExitCode: 0, Error: '', StartedAt: '2026-08-29T20:00:00.000Z', FinishedAt: '0001-01-01T00:00:00Z' },
          Config: { Image: validPinnedDigest, Labels: {
            'rig.managed': 'true', 'rig.instance.id': spec.id, 'rig.owner.id': sampleOwner.ownerId,
            'rig.app.id': spec.appId, 'rig.host.port': '3004', 'rig.memory.cap.mb': '256', 'rig.expires.at': expiresAt
          } }
        }]), stderr: '', exitCode: 0
      }));
      const persisted: RigInstance = {
        spec,
        observed: { lifecycle: 'healthy', allocatedPort: 3004, memoryMb: 0, expiresAt, events: [] }
      };

      await expect(controlApi.restoreInstances([persisted], new Date('2026-08-29T21:00:00.000Z')))
        .resolves.toEqual({ restored: [spec.id], removed: [] });
      expect((await controlApi.listInstances(sampleOwner))[0].observed.allocatedPort).toBe(3004);
      expect(controlApi.portAllocator.getAllocatedPorts().map(item => item.port)).toEqual([3004]);
    });

    it('fails startup reconciliation when durable identity disagrees with Docker labels', async () => {
      const spec = makeValidSpec();
      mockRunner.setHandler('inspect', () => ({
        stdout: JSON.stringify([{
          Id: 'container-1', Name: '/rig-box-rig-dh-9912',
          State: { Status: 'running', Running: true, OOMKilled: false, ExitCode: 0, Error: '', StartedAt: '2026-08-29T20:00:00.000Z', FinishedAt: '0001-01-01T00:00:00Z' },
          Config: { Image: validPinnedDigest, Labels: {
            'rig.managed': 'true', 'rig.instance.id': spec.id, 'rig.owner.id': 'different-owner',
            'rig.app.id': spec.appId, 'rig.host.port': '3004', 'rig.memory.cap.mb': '256',
            'rig.expires.at': '2026-08-29T22:00:00.000Z'
          } }
        }]), stderr: '', exitCode: 0
      }));
      const persisted: RigInstance = { spec, observed: { lifecycle: 'healthy', allocatedPort: 3004, memoryMb: 0, events: [] } };
      await expect(controlApi.restoreInstances([persisted], new Date('2026-08-29T21:00:00.000Z'))).rejects.toThrow('identity mismatch');
    });

    it('requires authenticated owner identity and rejects missing/invalid identity', async () => {
      const spec = makeValidSpec();

      await expect(controlApi.createInstance(null as any, spec)).rejects.toThrow(RigAuthenticationError);
      await expect(controlApi.createInstance({ ownerId: '' } as any, spec)).rejects.toThrow(RigAuthenticationError);
      await expect(controlApi.listInstances(undefined as any)).rejects.toThrow(RigAuthenticationError);
    });

    it('enforces per-owner instance quota strictly', async () => {
      // 1st instance
      await controlApi.createInstance(sampleOwner, {
        appId: 'app-1',
        name: 'App 1',
        runtime: { adapter: 'docker', startCommand: 'run', imageDigest: validPinnedDigest } as any,
        ttlSeconds: 600,
        source: 'demo'
      });

      // 2nd instance (hits quota = 2)
      await controlApi.createInstance(sampleOwner, {
        appId: 'app-2',
        name: 'App 2',
        runtime: { adapter: 'docker', startCommand: 'run', imageDigest: validPinnedDigest } as any,
        ttlSeconds: 600,
        source: 'demo'
      });

      // 3rd instance exceeds quota
      await expect(
        controlApi.createInstance(sampleOwner, {
          appId: 'app-3',
          name: 'App 3',
          runtime: { adapter: 'docker', startCommand: 'run', imageDigest: validPinnedDigest } as any,
          ttlSeconds: 600,
          source: 'demo'
        })
      ).rejects.toThrow(RigQuotaExceededError);

      // Other owner can still create instances
      const otherInst = await controlApi.createInstance(otherOwner, {
        appId: 'app-other',
        name: 'App Other',
        runtime: { adapter: 'docker', startCommand: 'run', imageDigest: validPinnedDigest } as any,
        ttlSeconds: 600,
        source: 'demo'
      });
      expect(otherInst.spec.ownerId).toBe(otherOwner.ownerId);
    });

    it('enforces cross-tenant isolation: owner cannot stop or view another owner instances', async () => {
      const inst = await controlApi.createInstance(sampleOwner, {
        appId: 'secret-app',
        name: 'Secret App',
        runtime: { adapter: 'docker', startCommand: 'run', imageDigest: validPinnedDigest } as any,
        ttlSeconds: 600,
        source: 'demo'
      });

      // Other owner tries to access
      await expect(controlApi.getInstance(otherOwner, inst.spec.id)).rejects.toThrow(RigAuthorizationError);
      await expect(controlApi.stopInstance(otherOwner, inst.spec.id)).rejects.toThrow(RigAuthorizationError);
      await expect(controlApi.deleteInstance(otherOwner, inst.spec.id)).rejects.toThrow(RigAuthorizationError);

      // Admin role can access
      const adminView = await controlApi.getInstance(sampleAdmin, inst.spec.id);
      expect(adminView?.spec.id).toBe(inst.spec.id);
    });

    it('restarts an instance, recreating container and allocating port', async () => {
      const inst = await controlApi.createInstance(sampleOwner, {
        appId: 'restart-app',
        name: 'Restart App',
        runtime: { adapter: 'docker', startCommand: 'run', imageDigest: validPinnedDigest } as any,
        ttlSeconds: 600,
        source: 'demo'
      });

      await controlApi.stopInstance(sampleOwner, inst.spec.id);
      const stopped = await controlApi.getInstance(sampleOwner, inst.spec.id);
      expect(stopped?.observed.lifecycle).toBe('stopped');

      const restarted = await controlApi.restartInstance(sampleOwner, inst.spec.id);
      expect(restarted.observed.lifecycle).toBe('queued');
      expect(restarted.observed.allocatedPort).toBeDefined();
    });

    it('restarts a healthy provider instance through stopped and queued states', async () => {
      const inst = await controlApi.createInstance(sampleOwner, {
        appId: 'live-restart-app',
        name: 'Live Restart App',
        runtime: { adapter: 'docker', startCommand: 'run', imageDigest: validPinnedDigest, networkPolicy: 'none' },
        resources: { memoryCapMb: 128 },
        ttlSeconds: 600,
        source: 'provider'
      });
      expect(inst.observed.lifecycle).toBe('healthy');

      const restarted = await controlApi.restartInstance(sampleOwner, inst.spec.id);
      expect(restarted.observed.lifecycle).toBe('healthy');
      expect(restarted.observed.events.slice(-3).map(event => [event.fromState, event.toState])).toEqual([
        ['healthy', 'stopped'],
        ['stopped', 'queued'],
        ['queued', 'healthy']
      ]);
    });

    it('reaps expired instances and releases ports safely', async () => {
      const inst = await controlApi.createInstance(sampleOwner, {
        appId: 'expiring-app',
        name: 'Expiring App',
        runtime: { adapter: 'docker', startCommand: 'run', imageDigest: validPinnedDigest } as any,
        ttlSeconds: 10,
        source: 'demo'
      });

      const port = inst.observed.allocatedPort!;
      expect(controlApi.portAllocator.isAvailable(port)).toBe(false);

      // Fast forward past expiration
      const future = new Date(Date.now() + 30000);
      const reaped = await controlApi.reapExpired(future);

      expect(reaped).toContain(inst.spec.id);
      const expiredInst = await controlApi.getInstance(sampleOwner, inst.spec.id);
      expect(expiredInst).toBeUndefined();
      expect(controlApi.portAllocator.isAvailable(port)).toBe(true);
    });

    it('supports stateless workloads and does not force SQLite, WAL, or databases', async () => {
      const stateless = await controlApi.createInstance(sampleOwner, {
        appId: 'pure-stateless',
        name: 'Pure Stateless Microservice',
        runtime: { adapter: 'docker', startCommand: 'node dist/index.js', imageDigest: validPinnedDigest } as any,
        ttlSeconds: 600,
        source: 'demo'
      });

      expect(stateless.spec.storage).toBeUndefined();
      expect(stateless.observed.lifecycle).toBe('queued');
    });
  });
});
