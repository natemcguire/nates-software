/**
 * RIG.EXE Bounded Docker Provider Adapter & Control API
 *
 * Core Guarantees & Invariants:
 * 1. Explicit fail-closed config and preflight (never claims live connectivity if daemon is unreachable).
 * 2. Command execution strictly via spawn/execFile-style argv array (never shell).
 * 3. Immutable OCI image reference pinned by sha256 digest.
 * 4. Hard resource limits: memory <= 256MB (--memory, --memory-swap), CPU bounds (--cpus), PID bounds (--pids-limit <= 100).
 * 5. Least-privilege isolation: non-root user (10001:10001), cap-drop ALL, no-new-privileges, read-only rootfs, tmpfs on /tmp & /run.
 * 6. Storage isolation: named docker volumes or tmpfs only; NEVER host bind mounts or docker socket mounts.
 * 7. Network isolation: default --network=none; explicit allow policy (--network=rig-bridge, never host).
 * 8. Host port bounds: only 3001-3010 loopback bound (-p 127.0.0.1:<port>:3001).
 * 9. Standardized TTL labels (rig.managed, rig.instance.id, rig.owner.id, rig.expires.at) with automated reaper.
 * 10. Per-owner instance quota enforcement.
 * 11. Bounded log retrieval (tail + buffer cap) and normalized 9-state lifecycle events.
 * 12. Idempotent stop and remove operations.
 * 13. Injectable Command Runner (DockerCommandRunner) for unit testing without live daemon.
 * 14. No auth fabrication: all API & provider methods require trusted RigOwnerIdentity.
 * 15. No forced WAL/storage/database: respects stateless or arbitrary declared storage.
 */

import { spawn } from 'node:child_process';
import {
  type RigSpec,
  type RigInstance,
  type RigObservedState,
  type RigLifecycleState,
  type RigLifecycleEvent,
  type RigOwnerIdentity,
  type RigNetworkPolicy,
  RigAuthenticationError,
  RigAuthorizationError,
  RigQuotaExceededError,
  RigSecurityViolationError,
  RigPreflightError,
  isValidImageDigest,
  isForbiddenMountPath,
  validateRigSpec,
  validateRigTransition
} from './rigDomain.ts';
import {
  MicroDynoPortAllocator,
  RigMemoryGovernor,
  PORT_RANGE_START,
  PORT_RANGE_END,
  MEMORY_CAP_MB,
  type CreateRigSpecParams
} from './rigBackend.ts';

// ---------------------------------------------------------------------------
// 1. Injectable Command Runner Interface & Implementations
// ---------------------------------------------------------------------------

export interface CommandExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly signal?: string;
}

export interface CommandExecOptions {
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
}

export interface DockerCommandRunner {
  exec(file: string, args: readonly string[], options?: CommandExecOptions): Promise<CommandExecResult>;
}

/**
 * Production child_process runner executing strictly without shell expansion.
 */
export class NodeChildProcessRunner implements DockerCommandRunner {
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxBufferBytes: number;

  constructor(options?: { defaultTimeoutMs?: number; defaultMaxBufferBytes?: number }) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 30000;
    this.defaultMaxBufferBytes = options?.defaultMaxBufferBytes ?? 1024 * 1024; // 1 MB
  }

  public async exec(
    file: string,
    args: readonly string[],
    options?: CommandExecOptions
  ): Promise<CommandExecResult> {
    return new Promise<CommandExecResult>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
      const maxBuffer = options?.maxBufferBytes ?? this.defaultMaxBufferBytes;

      let stdoutAccumulator = '';
      let stderrAccumulator = '';
      let stdoutExceeded = false;
      let stderrExceeded = false;
      let isSettled = false;
      let timer: NodeJS.Timeout | null = null;

      // Strictly enforce shell: false to eliminate command injection vectors
      const child = spawn(file, args as string[], {
        shell: false,
        env: options?.env ? { ...process.env, ...options.env } : process.env,
        cwd: options?.cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            child.kill('SIGTERM');
            const killTimer = setTimeout(() => {
              try {
                child.kill('SIGKILL');
              } catch {}
            }, 1000);
            if (killTimer.unref) killTimer.unref();
            resolve({
              stdout: stdoutAccumulator,
              stderr: `${stderrAccumulator}\nCommand timed out after ${timeoutMs}ms`,
              exitCode: 124,
              signal: 'SIGTERM'
            });
          }
        }, timeoutMs);
      }

      child.stdout.on('data', (chunk: Buffer) => {
        if (!stdoutExceeded) {
          stdoutAccumulator += chunk.toString('utf8');
          if (stdoutAccumulator.length > maxBuffer) {
            stdoutAccumulator = stdoutAccumulator.slice(0, maxBuffer);
            stdoutExceeded = true;
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (!stderrExceeded) {
          stderrAccumulator += chunk.toString('utf8');
          if (stderrAccumulator.length > maxBuffer) {
            stderrAccumulator = stderrAccumulator.slice(0, maxBuffer);
            stderrExceeded = true;
          }
        }
      });

      child.on('error', (err: Error) => {
        if (timer) clearTimeout(timer);
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      });

      child.on('close', (code: number | null, signal: string | null) => {
        if (timer) clearTimeout(timer);
        if (!isSettled) {
          isSettled = true;
          resolve({
            stdout: stdoutAccumulator,
            stderr: stderrAccumulator,
            exitCode: code ?? (signal ? 128 : 0),
            signal: signal || undefined
          });
        }
      });
    });
  }
}

export type MockHandler = (file: string, args: readonly string[], options?: CommandExecOptions) => CommandExecResult | Promise<CommandExecResult>;

/**
 * Injectable mock runner for unit and integration testing without a running Docker daemon.
 */
export class MockDockerCommandRunner implements DockerCommandRunner {
  public recordedCalls: Array<{ file: string; args: string[]; options?: CommandExecOptions }> = [];
  private handlers: Map<string, MockHandler> = new Map();
  public defaultHandler?: MockHandler;

  public setHandler(subcommand: string, handler: MockHandler): void {
    this.handlers.set(subcommand, handler);
  }

  public clearHandlers(): void {
    this.handlers.clear();
    this.recordedCalls = [];
  }

  public async exec(
    file: string,
    args: readonly string[],
    options?: CommandExecOptions
  ): Promise<CommandExecResult> {
    this.recordedCalls.push({ file, args: [...args], options });

    const subcommand = args[0] || '';
    const handler = this.handlers.get(subcommand) || this.defaultHandler;

    if (handler) {
      return handler(file, args, options);
    }

    // Default canned responses for standard Docker CLI subcommands
    if (subcommand === 'version') {
      return {
        stdout: JSON.stringify({
          Client: { Version: '29.4.0' },
          Server: { Version: '29.4.0' }
        }),
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'create') {
      return {
        stdout: 'c_mock_' + Math.random().toString(36).substring(2, 12),
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'start' || subcommand === 'stop' || subcommand === 'rm') {
      return {
        stdout: args[args.length - 1] || 'ok',
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'inspect') {
      const target = args[args.length - 1] || 'mock';
      return {
        stdout: JSON.stringify([
          {
            Id: target,
            Name: `/${target}`,
            State: {
              Status: 'running',
              Running: true,
              OOMKilled: false,
              ExitCode: 0,
              StartedAt: new Date().toISOString(),
              FinishedAt: '0001-01-01T00:00:00Z',
              Error: ''
            },
            Config: {
              Labels: {
                'rig.managed': 'true',
                'rig.instance.id': target.replace(/^rig-box-/, ''),
                'rig.owner.id': 'nate-corp',
                'rig.expires.at': new Date(Date.now() + 900000).toISOString()
              }
            }
          }
        ]),
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'ps') {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'logs') {
      return {
        stdout: `[mock-log] Application initialized on port 3001\n[mock-log] Ready for connections\n`,
        stderr: '',
        exitCode: 0
      };
    }

    return {
      stdout: '',
      stderr: '',
      exitCode: 0
    };
  }
}

// ---------------------------------------------------------------------------
// 2. Configuration & Preflight Types
// ---------------------------------------------------------------------------

export interface DockerProviderConfig {
  readonly dockerBinPath?: string;
  readonly maxMemoryCapMb?: number;
  readonly maxInstancesPerOwner?: number;
  readonly maxTotalInstances?: number;
  readonly defaultNetwork?: RigNetworkPolicy;
  readonly allowBridgeNetwork?: boolean;
  readonly defaultPidsLimit?: number;
  readonly defaultCpuCores?: number;
  readonly containerPrefix?: string;
  readonly maxLogLines?: number;
  readonly maxLogBufferBytes?: number;
  readonly defaultTtlSeconds?: number;
}

const OWNER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_-]{2,128}$/;

function assertOwnerIdentity(owner: RigOwnerIdentity | null | undefined): asserts owner is RigOwnerIdentity {
  if (!owner || !OWNER_ID_PATTERN.test(owner.ownerId)) {
    throw new RigAuthenticationError('Authenticated ownerId must match /^[a-zA-Z0-9_-]{1,64}$/.');
  }
}

function assertInstanceId(instanceId: string): void {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw new RigSecurityViolationError('Instance id must contain only letters, digits, underscore, and hyphen.');
  }
}

export interface DockerPreflightResult {
  readonly available: boolean;
  readonly daemonReachable: boolean;
  readonly serverVersion?: string;
  readonly clientVersion?: string;
  readonly error?: string;
  readonly checkedAt: string;
}

export interface DockerInspectData {
  readonly Id: string;
  readonly Name: string;
  readonly State: {
    readonly Status: string;
    readonly Running: boolean;
    readonly Paused?: boolean;
    readonly Restarting?: boolean;
    readonly OOMKilled: boolean;
    readonly Dead?: boolean;
    readonly Pid?: number;
    readonly ExitCode: number;
    readonly Error?: string;
    readonly StartedAt: string;
    readonly FinishedAt: string;
  };
  readonly Config?: {
    readonly Labels?: Record<string, string>;
    readonly Image?: string;
  };
}

// ---------------------------------------------------------------------------
// 3. Command Line Builder (Strict argv construction & validation)
// ---------------------------------------------------------------------------

export function buildDockerCreateArgv(params: {
  readonly spec: RigSpec;
  readonly owner: RigOwnerIdentity;
  readonly hostPort: number;
  readonly config?: DockerProviderConfig;
}): string[] {
  const { spec, owner, hostPort, config } = params;

  // 1. Identity validation
  assertOwnerIdentity(owner);

  // 2. Image digest pinning enforcement
  if (!spec.runtime.imageDigest || !isValidImageDigest(spec.runtime.imageDigest)) {
    throw new RigSecurityViolationError(
      `Image must be pinned with an immutable sha256 digest (e.g. image@sha256:64hex). Received: "${spec.runtime.imageDigest || 'none'}"`
    );
  }

  // 3. Hard resource bounds
  const memoryCapMb = spec.resources.memoryCapMb;
  const maxAllowedMem = Math.min(config?.maxMemoryCapMb ?? MEMORY_CAP_MB, MEMORY_CAP_MB);
  if (memoryCapMb <= 0 || memoryCapMb > maxAllowedMem) {
    throw new RigSecurityViolationError(
      `Requested memory ${memoryCapMb}MB exceeds hard bounded limit of ${maxAllowedMem}MB.`
    );
  }

  const cpuCores = Math.min(Math.max(spec.resources.cpuCores ?? config?.defaultCpuCores ?? 1.0, 0.1), 2.0);
  const pidsLimit = Math.min(Math.max(spec.resources.pidsLimit ?? config?.defaultPidsLimit ?? 64, 1), 100);

  // 4. Host port bounds (3001-3010)
  if (!Number.isInteger(hostPort) || hostPort < PORT_RANGE_START || hostPort > PORT_RANGE_END) {
    throw new RigSecurityViolationError(
      `Host port ${hostPort} outside bounded MicroDyno range [${PORT_RANGE_START}..${PORT_RANGE_END}].`
    );
  }

  // 5. Network policy
  const networkPolicy: RigNetworkPolicy = spec.runtime.networkPolicy || config?.defaultNetwork || 'none';
  if (networkPolicy === 'bridge' && config?.allowBridgeNetwork !== true) {
    throw new RigSecurityViolationError('Bridge networking is disabled unless allowBridgeNetwork is explicitly enabled by trusted configuration.');
  }
  const networkFlagValue = networkPolicy === 'bridge' ? 'rig-bridge' : 'none';

  // 6. TTL calculation
  const prefix = config?.containerPrefix ?? 'rig-box-';
  const containerName = `${prefix}${spec.id}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + spec.ttlSeconds * 1000).toISOString();

  // 7. Base argv array construction (never shell)
  const argv: string[] = [
    'create',
    '--name',
    containerName,
    // Labels for TTL tracking and inventory ownership
    '--label',
    'rig.managed=true',
    '--label',
    `rig.instance.id=${spec.id}`,
    '--label',
    `rig.app.id=${spec.appId}`,
    '--label',
    `rig.owner.id=${owner.ownerId}`,
    '--label',
    `rig.created.at=${spec.createdAt}`,
    '--label',
    `rig.expires.at=${expiresAt}`,
    '--label',
    `rig.ttl.seconds=${spec.ttlSeconds}`,
    '--label',
    `rig.host.port=${hostPort}`,
    '--label',
    `rig.memory.cap.mb=${memoryCapMb}`,
    // Security flags: non-root, cap-drop, no new privileges, read-only rootfs
    '--user',
    '10001:10001',
    '--cap-drop=ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--read-only',
    // Transient tmpfs mounts only
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=32m',
    '--tmpfs',
    '/run:rw,noexec,nosuid,size=8m',
    // Bounded resource limits
    '--memory',
    `${memoryCapMb}m`,
    '--memory-swap',
    `${memoryCapMb}m`,
    '--cpus',
    `${cpuCores}`,
    '--pids-limit',
    `${pidsLimit}`,
    // Network isolation
    '--network',
    networkFlagValue,
    // Loopback-only host port publication to private container port 3001
    '-p',
    `127.0.0.1:${hostPort}:3001`
  ];

  // Standard environment variables
  argv.push(
    '-e',
    'PORT=3001',
    '-e',
    'NODE_ENV=production',
    '-e',
    `RIG_INSTANCE_ID=${spec.id}`,
    '-e',
    `RIG_APP_ID=${spec.appId}`,
    '-e',
    `RIG_OWNER_ID=${owner.ownerId}`
  );

  // User-defined environment variables (strictly validated)
  if (spec.runtime.env) {
    for (const [key, val] of Object.entries(spec.runtime.env)) {
      if (!key.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        throw new RigSecurityViolationError(`Invalid environment variable key "${key}".`);
      }
      if (typeof val !== 'string' || val.includes('\0')) {
        throw new RigSecurityViolationError(`Invalid environment variable value for "${key}".`);
      }
      argv.push('-e', `${key}=${val}`);
    }
  }

  // Storage mounts (named volumes or tmpfs only; NEVER host bind mounts or docker socket)
  if (spec.storage && spec.storage.length > 0) {
    spec.storage.forEach((mount, idx) => {
      if (isForbiddenMountPath(mount.mountPath)) {
        throw new RigSecurityViolationError(
          `Storage mount "${mount.mountPath}" targets forbidden system path or docker socket.`
        );
      }
      if (mount.kind === 'ephemeral') {
        const sizeMb = mount.sizeMb || 32;
        argv.push('--tmpfs', `${mount.mountPath}:rw,noexec,nosuid,size=${sizeMb}m`);
      } else {
        const volName = `rig-vol-${spec.id}-${mount.name || idx}`;
        argv.push('-v', `${volName}:${mount.mountPath}:rw`);
      }
    });
  }

  // Pinned Image digest
  argv.push(spec.runtime.imageDigest);

  // Optional start command argv parsing
  if (spec.runtime.startCommand && spec.runtime.startCommand.trim().length > 0) {
    const rawTokens = spec.runtime.startCommand.trim().split(/\s+/);
    if (rawTokens.length > 0 && rawTokens[0] !== '') {
      argv.push(...rawTokens);
    }
  }

  return argv;
}

// ---------------------------------------------------------------------------
// 4. Bounded Docker Provider Adapter
// ---------------------------------------------------------------------------

export class BoundedDockerProvider {
  private readonly runner: DockerCommandRunner;
  private readonly config: DockerProviderConfig;
  private preflightCache: DockerPreflightResult | null = null;
  private preflightTimestamp: number = 0;
  private readonly preflightCacheTtlMs: number = 10000;

  constructor(options?: {
    runner?: DockerCommandRunner;
    config?: DockerProviderConfig;
  }) {
    this.runner = options?.runner ?? new NodeChildProcessRunner();
    this.config = {
      dockerBinPath: 'docker',
      maxMemoryCapMb: MEMORY_CAP_MB,
      maxInstancesPerOwner: 3,
      maxTotalInstances: 10,
      defaultNetwork: 'none',
      allowBridgeNetwork: false,
      defaultPidsLimit: 64,
      defaultCpuCores: 1.0,
      containerPrefix: 'rig-box-',
      maxLogLines: 500,
      maxLogBufferBytes: 256 * 1024,
      defaultTtlSeconds: 900,
      ...options?.config
    };
    if (!Number.isInteger(this.config.maxInstancesPerOwner) || this.config.maxInstancesPerOwner! < 1 || this.config.maxInstancesPerOwner! > 10) {
      throw new RigSecurityViolationError('maxInstancesPerOwner must be an integer between 1 and 10.');
    }
    if (!Number.isInteger(this.config.maxTotalInstances) || this.config.maxTotalInstances! < 1 || this.config.maxTotalInstances! > 10) {
      throw new RigSecurityViolationError('maxTotalInstances must be an integer between 1 and 10.');
    }
    if (!Number.isInteger(this.config.maxMemoryCapMb) || this.config.maxMemoryCapMb! < 1 || this.config.maxMemoryCapMb! > MEMORY_CAP_MB) {
      throw new RigSecurityViolationError(`maxMemoryCapMb must be an integer between 1 and ${MEMORY_CAP_MB}.`);
    }
  }

  public getDockerBin(): string {
    return this.config.dockerBinPath || 'docker';
  }

  public getContainerPrefix(): string {
    return this.config.containerPrefix || 'rig-box-';
  }

  public getContainerName(instanceId: string): string {
    assertInstanceId(instanceId);
    return `${this.getContainerPrefix()}${instanceId}`;
  }

  private async inspectRaw(instanceId: string): Promise<DockerInspectData | null> {
    const containerName = this.getContainerName(instanceId);
    const res = await this.runner.exec(this.getDockerBin(), ['inspect', containerName], { timeoutMs: 5000 });
    if (res.exitCode !== 0) return null;
    try {
      const parsed = JSON.parse(res.stdout);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed[0] as DockerInspectData : null;
    } catch {
      return null;
    }
  }

  private authorizeDockerObject(owner: RigOwnerIdentity, instanceId: string, inspect: DockerInspectData): void {
    assertOwnerIdentity(owner);
    const labels = inspect.Config?.Labels;
    if (labels?.['rig.managed'] !== 'true' || labels?.['rig.instance.id'] !== instanceId) {
      throw new RigAuthorizationError('Target is not the requested RIG-managed instance.');
    }
    if (owner.role !== 'admin' && labels?.['rig.owner.id'] !== owner.ownerId) {
      throw new RigAuthorizationError('Owner is not authorized for this Docker instance.');
    }
  }

  /**
   * Preflight Check: Verifies Docker CLI existence and daemon reachability.
   * Never claims live connectivity if daemon is unreachable.
   */
  public async checkPreflight(forceRefresh = false): Promise<DockerPreflightResult> {
    const now = Date.now();
    if (!forceRefresh && this.preflightCache && now - this.preflightTimestamp < this.preflightCacheTtlMs) {
      return this.preflightCache;
    }

    const nowIso = new Date().toISOString();
    try {
      const res = await this.runner.exec(this.getDockerBin(), ['version', '--format', '{{json .}}'], {
        timeoutMs: 5000
      });

      if (res.exitCode !== 0) {
        const errorMsg = res.stderr.trim() || res.stdout.trim() || `docker version exited with code ${res.exitCode}`;
        const result: DockerPreflightResult = {
          available: false,
          daemonReachable: false,
          error: errorMsg,
          checkedAt: nowIso
        };
        this.preflightCache = result;
        this.preflightTimestamp = now;
        return result;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(res.stdout);
      } catch {
        // Fallback for non-json output
        const hasServer = res.stdout.includes('Server:');
        const result: DockerPreflightResult = {
          available: hasServer,
          daemonReachable: hasServer,
          clientVersion: 'detected',
          serverVersion: hasServer ? 'detected' : undefined,
          error: hasServer ? undefined : 'Cannot connect to Docker daemon',
          checkedAt: nowIso
        };
        this.preflightCache = result;
        this.preflightTimestamp = now;
        return result;
      }

      const clientVersion = parsed?.Client?.Version;
      const serverVersion = parsed?.Server?.Version;
      const daemonReachable = Boolean(serverVersion);

      const result: DockerPreflightResult = {
        available: daemonReachable,
        daemonReachable,
        clientVersion,
        serverVersion,
        error: daemonReachable ? undefined : 'Docker client found but daemon is unreachable.',
        checkedAt: nowIso
      };

      this.preflightCache = result;
      this.preflightTimestamp = now;
      return result;
    } catch (err: any) {
      const result: DockerPreflightResult = {
        available: false,
        daemonReachable: false,
        error: `Docker preflight error: ${err.message || String(err)}`,
        checkedAt: nowIso
      };
      this.preflightCache = result;
      this.preflightTimestamp = now;
      return result;
    }
  }

  /**
   * Creates and starts a hardened Docker container using spawn-style argv execution.
   */
  public async createAndStart(
    owner: RigOwnerIdentity,
    spec: RigSpec,
    hostPort: number
  ): Promise<{ containerId: string; containerName: string; hostPort: number }> {
    assertOwnerIdentity(owner);
    const validated = validateRigSpec(spec);
    if (!validated.valid) throw new RigSecurityViolationError(`Invalid provider spec: ${validated.errors.join('; ')}`);
    if (spec.ownerId !== owner.ownerId) throw new RigAuthorizationError('Spec ownerId must match the authenticated owner.');
    if (spec.source !== 'provider' || spec.runtime.adapter !== 'docker') {
      throw new RigSecurityViolationError('Live Docker creation requires source="provider" and adapter="docker".');
    }

    // 1. Fail-closed preflight check
    const preflight = await this.checkPreflight();
    if (!preflight.daemonReachable) {
      throw new RigPreflightError(
        `Docker provider fail-closed: daemon is unavailable (${preflight.error || 'unreachable'}). Live containers cannot be created.`
      );
    }
    await this.assertCapacity(owner);

    // 2. Validate and build argv
    const argv = buildDockerCreateArgv({
      spec,
      owner,
      hostPort,
      config: this.config
    });

    // 3. Execute `docker create`
    const createRes = await this.runner.exec(this.getDockerBin(), argv, { timeoutMs: 15000 });
    if (createRes.exitCode !== 0) {
      throw new Error(`Failed to create container for ${spec.id}: ${createRes.stderr || createRes.stdout}`);
    }

    const containerId = createRes.stdout.trim().slice(0, 12);
    const containerName = this.getContainerName(spec.id);

    // 4. Execute `docker start`
    const startRes = await this.runner.exec(this.getDockerBin(), ['start', containerName], { timeoutMs: 10000 });
    if (startRes.exitCode !== 0) {
      // Cleanup created container on start failure
      try {
        await this.runner.exec(this.getDockerBin(), ['rm', '-f', containerName]);
      } catch {}
      throw new Error(`Failed to start container ${containerName}: ${startRes.stderr || startRes.stdout}`);
    }

    return {
      containerId,
      containerName,
      hostPort
    };
  }

  private async countManagedContainers(ownerId?: string): Promise<number> {
    const args = ['ps', '-aq', '--filter', 'label=rig.managed=true'];
    if (ownerId) args.push('--filter', `label=rig.owner.id=${ownerId}`);
    const result = await this.runner.exec(this.getDockerBin(), args, { timeoutMs: 5000, maxBufferBytes: 64 * 1024 });
    if (result.exitCode !== 0) throw new RigPreflightError(`Cannot enforce Docker quota: ${result.stderr || result.stdout}`);
    return result.stdout.split('\n').filter(Boolean).length;
  }

  private async assertCapacity(owner: RigOwnerIdentity): Promise<void> {
    const [total, owned] = await Promise.all([
      this.countManagedContainers(),
      this.countManagedContainers(owner.ownerId)
    ]);
    if (total >= (this.config.maxTotalInstances ?? 10)) {
      throw new RigQuotaExceededError('Global RIG Docker instance quota reached.');
    }
    if (owned >= (this.config.maxInstancesPerOwner ?? 3)) {
      throw new RigQuotaExceededError(`Docker instance quota reached for owner "${owner.ownerId}".`);
    }
  }

  /**
   * Idempotently stops a container.
   */
  public async stopContainer(
    owner: RigOwnerIdentity,
    instanceId: string,
    timeoutSec: number = 5
  ): Promise<{ stopped: boolean; wasRunning: boolean }> {
    assertOwnerIdentity(owner);
    assertInstanceId(instanceId);

    const inspect = await this.inspectRaw(instanceId);
    if (!inspect) return { stopped: true, wasRunning: false };
    this.authorizeDockerObject(owner, instanceId, inspect);

    const containerName = this.getContainerName(instanceId);
    const stopRes = await this.runner.exec(
      this.getDockerBin(),
      ['stop', '-t', String(timeoutSec), containerName],
      { timeoutMs: (timeoutSec + 5) * 1000 }
    );

    if (stopRes.exitCode === 0) {
      return { stopped: true, wasRunning: true };
    }

    // If container not found or already stopped, treat as idempotent success
    const errText = (stopRes.stderr + stopRes.stdout).toLowerCase();
    if (errText.includes('no such container') || errText.includes('not running')) {
      return { stopped: true, wasRunning: false };
    }

    throw new Error(`Failed to stop container ${containerName}: ${stopRes.stderr || stopRes.stdout}`);
  }

  /**
   * Idempotently removes a container and associated named volumes.
   */
  public async removeContainer(owner: RigOwnerIdentity, instanceId: string): Promise<boolean> {
    assertOwnerIdentity(owner);
    assertInstanceId(instanceId);
    const inspect = await this.inspectRaw(instanceId);
    if (!inspect) return true;
    this.authorizeDockerObject(owner, instanceId, inspect);

    const containerName = this.getContainerName(instanceId);
    const rmRes = await this.runner.exec(this.getDockerBin(), ['rm', '-f', '-v', containerName], {
      timeoutMs: 10000
    });

    if (rmRes.exitCode === 0) {
      return true;
    }

    const errText = (rmRes.stderr + rmRes.stdout).toLowerCase();
    if (errText.includes('no such container')) {
      return true;
    }

    throw new Error(`Failed to remove container ${containerName}: ${rmRes.stderr || rmRes.stdout}`);
  }

  /**
   * Inspects a container's live Docker state.
   */
  public async inspectContainer(
    owner: RigOwnerIdentity,
    instanceId: string
  ): Promise<DockerInspectData | null> {
    assertOwnerIdentity(owner);
    assertInstanceId(instanceId);
    const inspect = await this.inspectRaw(instanceId);
    if (inspect) this.authorizeDockerObject(owner, instanceId, inspect);
    return inspect;
  }

  /**
   * Retrieves bounded container logs with tail limit and buffer limit.
   */
  public async getContainerLogs(
    owner: RigOwnerIdentity,
    instanceId: string,
    tailLines: number = 200
  ): Promise<string> {
    assertOwnerIdentity(owner);
    assertInstanceId(instanceId);
    const inspect = await this.inspectRaw(instanceId);
    if (!inspect) return '[RIG LOGS] Container does not exist.';
    this.authorizeDockerObject(owner, instanceId, inspect);

    const maxLines = Math.min(Math.max(tailLines, 1), this.config.maxLogLines ?? 500);
    const containerName = this.getContainerName(instanceId);

    const res = await this.runner.exec(
      this.getDockerBin(),
      ['logs', '--tail', String(maxLines), '--timestamps', containerName],
      {
        timeoutMs: 5000,
        maxBufferBytes: this.config.maxLogBufferBytes ?? 256 * 1024
      }
    );

    if (res.exitCode !== 0) {
      return `[RIG LOGS ERROR] Failed to fetch logs: ${res.stderr || res.stdout}`;
    }

    return res.stdout + (res.stderr ? `\n[STDERR]\n${res.stderr}` : '');
  }

  /**
   * Scans and reaps expired containers labeled with rig.managed=true.
   */
  public async reapExpiredContainers(now: Date = new Date()): Promise<string[]> {
    const preflight = await this.checkPreflight();
    if (!preflight.daemonReachable) {
      return [];
    }

    const res = await this.runner.exec(
      this.getDockerBin(),
      ['ps', '-a', '--filter', 'label=rig.managed=true', '--format', '{{json .}}'],
      { timeoutMs: 10000 }
    );

    if (res.exitCode !== 0 || !res.stdout.trim()) {
      return [];
    }

    const reapedInstanceIds: string[] = [];
    const lines = res.stdout.trim().split('\n');
    const nowMs = now.getTime();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        // Extract labels
        const labelsStr = item.Labels || '';
        let expiresAtIso: string | undefined;
        let instanceId: string | undefined;
        let ownerId: string | undefined;

        // Docker ps json output can format labels as comma-separated or map
        if (typeof labelsStr === 'string') {
          const matchExp = labelsStr.match(/rig\.expires\.at=([^,]+)/);
          if (matchExp) expiresAtIso = matchExp[1];
          const matchInst = labelsStr.match(/rig\.instance\.id=([^,]+)/);
          if (matchInst) instanceId = matchInst[1];
          const matchOwner = labelsStr.match(/rig\.owner\.id=([^,]+)/);
          if (matchOwner) ownerId = matchOwner[1];
        }

        if (instanceId && expiresAtIso) {
          const expMs = new Date(expiresAtIso).getTime();
          if (nowMs >= expMs) {
            const systemOwner: RigOwnerIdentity = { ownerId: ownerId || 'reaper', role: 'admin' };
            await this.removeContainer(systemOwner, instanceId);
            reapedInstanceIds.push(instanceId);
          }
        }
      } catch {}
    }

    return reapedInstanceIds;
  }

  /**
   * Normalizes Docker inspect metadata into RIG's strict 9-state lifecycle machine.
   */
  public normalizeDockerState(
    inspect: DockerInspectData | null,
    _spec?: RigSpec,
    allocatedPort?: number
  ): RigObservedState {
    if (!inspect) {
      return {
        lifecycle: 'stopped',
        allocatedPort: undefined,
        memoryMb: 0,
        events: []
      };
    }

    const state = inspect.State;
    let lifecycle: RigLifecycleState = 'stopped';
    let errorMessage: string | undefined = state.Error || undefined;

    if (state.OOMKilled) {
      lifecycle = 'oom';
      errorMessage = 'Container terminated by kernel cgroup out-of-memory killer (OOMKilled=true).';
    } else if (state.Running) {
      lifecycle = 'healthy';
    } else if (state.Status === 'created') {
      lifecycle = 'building';
    } else if (state.Status === 'restarting') {
      lifecycle = 'starting';
    } else if (state.ExitCode === 137) {
      // Exit 137 proves SIGKILL, not its cause. Only OOMKilled=true proves cgroup OOM.
      lifecycle = 'crashed';
      errorMessage = 'Process terminated with Exit Code 137 (SIGKILL); Docker did not report OOMKilled, so an out-of-memory cause is not proven.';
    } else if (state.ExitCode !== 0) {
      lifecycle = 'crashed';
      errorMessage = `Process exited with non-zero code ${state.ExitCode}.`;
    } else {
      lifecycle = 'stopped';
    }

    return {
      lifecycle,
      allocatedPort: lifecycle === 'healthy' || lifecycle === 'starting' || lifecycle === 'building' ? allocatedPort : undefined,
      memoryMb: 0,
      startedAt: state.StartedAt && state.StartedAt !== '0001-01-01T00:00:00Z' ? state.StartedAt : undefined,
      stoppedAt: state.FinishedAt && state.FinishedAt !== '0001-01-01T00:00:00Z' ? state.FinishedAt : undefined,
      expiresAt: inspect.Config?.Labels?.['rig.expires.at'],
      exitCode: state.ExitCode,
      errorMessage,
      events: []
    };
  }
}

// ---------------------------------------------------------------------------
// 5. Authenticated Control API Service (`RigDockerControlApi`)
// ---------------------------------------------------------------------------

export interface RigControlApiOptions {
  readonly dockerProvider?: BoundedDockerProvider;
  readonly portAllocator?: MicroDynoPortAllocator;
  readonly memoryGovernor?: RigMemoryGovernor;
  readonly maxInstancesPerOwner?: number;
}

export class RigDockerControlApi {
  public readonly dockerProvider: BoundedDockerProvider;
  public readonly portAllocator: MicroDynoPortAllocator;
  public readonly memoryGovernor: RigMemoryGovernor;
  private readonly instances: Map<string, RigInstance> = new Map();
  private readonly maxInstancesPerOwner: number;

  constructor(options?: RigControlApiOptions) {
    this.dockerProvider = options?.dockerProvider ?? new BoundedDockerProvider();
    this.portAllocator = options?.portAllocator ?? new MicroDynoPortAllocator();
    this.memoryGovernor = options?.memoryGovernor ?? new RigMemoryGovernor();
    this.maxInstancesPerOwner = options?.maxInstancesPerOwner ?? 3;
  }

  private validateOwner(owner: RigOwnerIdentity): void {
    if (!owner || typeof owner !== 'object') {
      throw new RigAuthenticationError('Missing authenticated owner identity.');
    }
    if (typeof owner.ownerId !== 'string' || owner.ownerId.trim().length === 0) {
      throw new RigAuthenticationError('Invalid owner identity: ownerId must be a non-empty string.');
    }
  }

  private authorizeAccess(owner: RigOwnerIdentity, instance: RigInstance): void {
    this.validateOwner(owner);
    if (owner.role === 'admin') return;
    const instanceOwner = instance.spec.ownerId || (instance.spec as any).owner;
    if (instanceOwner && instanceOwner !== owner.ownerId) {
      throw new RigAuthorizationError(
        `Owner "${owner.ownerId}" is not authorized to access instance "${instance.spec.id}" (owned by "${instanceOwner}").`
      );
    }
  }

  public getOwnerInstanceCount(ownerId: string): number {
    let count = 0;
    const activeStates: RigLifecycleState[] = ['queued', 'building', 'starting', 'healthy', 'degraded'];
    for (const inst of this.instances.values()) {
      if (inst.spec.ownerId === ownerId && activeStates.includes(inst.observed.lifecycle)) {
        count++;
      }
    }
    return count;
  }

  public async getPreflight(): Promise<DockerPreflightResult> {
    return this.dockerProvider.checkPreflight();
  }

  public exportInstances(): RigInstance[] {
    return Array.from(this.instances.values());
  }

  /** Re-authorizes durable registry entries against actual Docker objects after gateway restart. */
  public async restoreInstances(candidates: readonly RigInstance[], now: Date = new Date()): Promise<{ restored: string[]; removed: string[] }> {
    if (this.instances.size > 0 || this.portAllocator.getAllocatedPorts().length > 0) {
      throw new Error('RIG restore requires a fresh control API instance.');
    }
    const restored: string[] = [];
    const removed: string[] = [];
    for (const candidate of candidates) {
      const validation = validateRigSpec(candidate.spec);
      if (!validation.valid || candidate.spec.source !== 'provider' || candidate.spec.runtime.adapter !== 'docker' || !candidate.spec.ownerId) {
        removed.push(candidate.spec?.id || 'invalid');
        continue;
      }
      const admin: RigOwnerIdentity = { ownerId: 'rig-reconciler', role: 'admin' };
      const inspect = await this.dockerProvider.inspectContainer(admin, candidate.spec.id);
      if (!inspect) {
        removed.push(candidate.spec.id);
        continue;
      }
      const labels = inspect.Config?.Labels || {};
      const port = Number(labels['rig.host.port']);
      const labelsMatch = labels['rig.owner.id'] === candidate.spec.ownerId
        && labels['rig.app.id'] === candidate.spec.appId
        && inspect.Config?.Image === candidate.spec.runtime.imageDigest
        && Number(labels['rig.memory.cap.mb']) === candidate.spec.resources.memoryCapMb
        && Number.isInteger(port) && port >= PORT_RANGE_START && port <= PORT_RANGE_END;
      if (!labelsMatch) throw new RigSecurityViolationError(`RIG registry/container identity mismatch for ${candidate.spec.id}.`);

      const expiresAt = labels['rig.expires.at'];
      if (!expiresAt || new Date(expiresAt).getTime() <= now.getTime()) {
        await this.dockerProvider.removeContainer(admin, candidate.spec.id);
        removed.push(candidate.spec.id);
        continue;
      }

      const observed = this.dockerProvider.normalizeDockerState(inspect, candidate.spec, port);
      if (['building', 'starting', 'healthy', 'degraded'].includes(observed.lifecycle)) {
        const restoredPort = this.portAllocator.allocate(candidate.spec.appId, port, candidate.spec.id);
        if (restoredPort !== port) {
          throw new RigSecurityViolationError(`RIG restart detected duplicate authoritative host port ${port}.`);
        }
      }
      const recovered: RigInstance = {
        spec: candidate.spec,
        observed: {
          ...observed,
          events: [
            ...candidate.observed.events,
            {
              id: `evt-${Date.now().toString(36)}-restore-${restored.length}`,
              timestamp: now.toISOString(),
              fromState: candidate.observed.lifecycle,
              toState: observed.lifecycle,
              reason: 'Gateway restart reconciliation verified the authoritative Docker object and labels'
            }
          ]
        }
      };
      this.instances.set(candidate.spec.id, recovered);
      restored.push(candidate.spec.id);
    }
    return { restored, removed };
  }

  public async createInstance(
    owner: RigOwnerIdentity,
    params: RigSpec | CreateRigSpecParams
  ): Promise<RigInstance> {
    this.validateOwner(owner);

    // Enforce per-owner instance quota
    const currentActive = this.getOwnerInstanceCount(owner.ownerId);
    if (currentActive >= this.maxInstancesPerOwner) {
      throw new RigQuotaExceededError(
        `Quota exceeded for owner "${owner.ownerId}": maximum ${this.maxInstancesPerOwner} active instances allowed.`
      );
    }

    let spec: RigSpec;

    if ('spec' in (params as any)) {
      spec = (params as any).spec;
    } else if (
      'id' in params &&
      typeof params.id === 'string' &&
      'runtime' in params &&
      'resources' in params &&
      typeof params.ttlSeconds === 'number' &&
      typeof params.source === 'string'
    ) {
      const val = validateRigSpec({ ...params, ownerId: owner.ownerId });
      if (!val.valid) {
        throw new Error(`Invalid RigSpec: ${val.errors.join('; ')}`);
      }
      spec = val.data;
    } else {
      const p = params as CreateRigSpecParams;
      const appId = p.appId?.trim();
      if (!appId) throw new Error('appId must not be empty.');

      const cleanAppId = appId.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
      const id = p.id || `rig-${cleanAppId}-${Date.now().toString(36).slice(-4)}`;
      const name = p.name?.trim() || `${appId} Preview`;

      const candidateSpec: RigSpec = {
        id,
        appId: cleanAppId,
        name,
        ownerId: owner.ownerId,
        runtime: {
          adapter: p.runtime?.adapter || 'docker',
          buildCommand: p.runtime?.buildCommand,
          startCommand: p.runtime?.startCommand || 'npm start',
          healthCommand: p.runtime?.healthCommand,
          healthEndpoint: p.runtime?.healthEndpoint || '/healthz',
          env: p.runtime?.env,
          imageDigest: (p.runtime as any)?.imageDigest,
          networkPolicy: (p.runtime as any)?.networkPolicy
        },
        resources: {
          memoryCapMb: Math.min(p.resources?.memoryCapMb || MEMORY_CAP_MB, MEMORY_CAP_MB),
          cpuCores: p.resources?.cpuCores,
          pidsLimit: (p.resources as any)?.pidsLimit
        },
        storage: p.storage,
        preferredPort: p.preferredPort,
        ttlSeconds: p.ttlSeconds && p.ttlSeconds > 0 ? p.ttlSeconds : 900,
        source: p.source || 'provider',
        createdAt: new Date().toISOString()
      };

      const val = validateRigSpec(candidateSpec);
      if (!val.valid) {
        throw new Error(`Invalid RigSpec parameters: ${val.errors.join('; ')}`);
      }
      spec = val.data;
    }

    if (this.instances.has(spec.id)) {
      throw new Error(`Instance with id ${spec.id} already exists.`);
    }

    // Allocate port from 3001-3010
    const port = this.portAllocator.allocate(spec.appId, spec.preferredPort, spec.id);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + spec.ttlSeconds * 1000).toISOString();

    const initialEvent: RigLifecycleEvent = {
      id: `evt-${Date.now().toString(36)}-0`,
      timestamp: nowIso,
      fromState: null,
      toState: 'queued',
      reason: `Instance registered for owner ${owner.ownerId} (adapter: ${spec.runtime.adapter}, source: ${spec.source})`
    };

    let observed: RigObservedState = {
      lifecycle: 'queued',
      allocatedPort: port,
      memoryMb: 0,
      startedAt: undefined,
      stoppedAt: undefined,
      expiresAt,
      events: [initialEvent]
    };

    // If source is provider and adapter is docker, execute live container creation
    if (spec.source === 'provider' && spec.runtime.adapter === 'docker') {
      try {
        await this.dockerProvider.createAndStart(owner, spec, port);
        const runningEvent: RigLifecycleEvent = {
          id: `evt-${Date.now().toString(36)}-1`,
          timestamp: new Date().toISOString(),
          fromState: 'queued',
          toState: 'healthy',
          reason: 'Hardened Docker container started and bound to loopback port'
        };
        observed = {
          ...observed,
          lifecycle: 'healthy',
          startedAt: new Date().toISOString(),
          events: [...observed.events, runningEvent]
        };
      } catch (err: any) {
        this.portAllocator.release(port);
        throw err;
      }
    }

    const instance: RigInstance = { spec, observed };
    this.instances.set(spec.id, instance);
    return instance;
  }

  public async stopInstance(
    owner: RigOwnerIdentity,
    instanceId: string,
    reason = 'Operator stopped instance'
  ): Promise<RigInstance> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }
    this.authorizeAccess(owner, instance);

    const fromState = instance.observed.lifecycle;
    const validation = validateRigTransition(fromState, 'stopped');
    if (!validation.valid && fromState !== 'stopped') {
      throw new Error(validation.error || `Illegal state transition from ${fromState} to stopped`);
    }

    if (instance.spec.source === 'provider' && instance.spec.runtime.adapter === 'docker') {
      await this.dockerProvider.stopContainer(owner, instanceId);
    }

    if (instance.observed.allocatedPort !== undefined) {
      this.portAllocator.release(instance.observed.allocatedPort);
    }

    const nowIso = new Date().toISOString();
    const event: RigLifecycleEvent = {
      id: `evt-${Date.now().toString(36)}-${instance.observed.events.length}`,
      timestamp: nowIso,
      fromState,
      toState: 'stopped',
      reason
    };

    const updated: RigInstance = {
      spec: instance.spec,
      observed: {
        ...instance.observed,
        lifecycle: 'stopped',
        allocatedPort: undefined,
        stoppedAt: nowIso,
        events: [...instance.observed.events, event]
      }
    };

    this.instances.set(instanceId, updated);
    return updated;
  }

  public async deleteInstance(owner: RigOwnerIdentity, instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    this.authorizeAccess(owner, instance);

    if (instance.spec.source === 'provider' && instance.spec.runtime.adapter === 'docker') {
      await this.dockerProvider.removeContainer(owner, instanceId);
    }

    if (instance.observed.allocatedPort !== undefined) {
      this.portAllocator.release(instance.observed.allocatedPort);
    }

    return this.instances.delete(instanceId);
  }

  public async restartInstance(owner: RigOwnerIdentity, instanceId: string): Promise<RigInstance> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }
    this.authorizeAccess(owner, instance);

    const fromState = instance.observed.lifecycle;
    const restartEvents: RigLifecycleEvent[] = [...instance.observed.events];
    let transitionFrom = fromState;
    if (fromState !== 'stopped' && validateRigTransition(fromState, 'stopped').valid) {
      restartEvents.push({
        id: `evt-${Date.now().toString(36)}-${restartEvents.length}`,
        timestamp: new Date().toISOString(),
        fromState,
        toState: 'stopped',
        reason: 'Instance stopped for control-plane restart'
      });
      transitionFrom = 'stopped';
    }
    const validation = validateRigTransition(transitionFrom, 'queued');
    if (!validation.valid) {
      throw new Error(`Cannot restart instance from state '${fromState}': ${validation.error}`);
    }

    // Stop container if still running
    if (instance.spec.source === 'provider' && instance.spec.runtime.adapter === 'docker') {
      await this.dockerProvider.stopContainer(owner, instanceId);
      await this.dockerProvider.removeContainer(owner, instanceId);
    }

    // Allocate port if released
    let port = instance.observed.allocatedPort;
    if (port === undefined) {
      port = this.portAllocator.allocate(instance.spec.appId, instance.spec.preferredPort, instance.spec.id);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + instance.spec.ttlSeconds * 1000).toISOString();

    const restartEvent: RigLifecycleEvent = {
      id: `evt-${Date.now().toString(36)}-${instance.observed.events.length}`,
      timestamp: nowIso,
      fromState: transitionFrom,
      toState: 'queued',
      reason: 'Instance restarted by control plane'
    };

    let observed: RigObservedState = {
      lifecycle: 'queued',
      allocatedPort: port,
      memoryMb: 0,
      startedAt: undefined,
      stoppedAt: undefined,
      expiresAt,
      exitCode: undefined,
      errorMessage: undefined,
      events: [...restartEvents, restartEvent]
    };

    if (instance.spec.source === 'provider' && instance.spec.runtime.adapter === 'docker') {
      await this.dockerProvider.createAndStart(owner, instance.spec, port);
      observed = {
        ...observed,
        lifecycle: 'healthy',
        startedAt: new Date().toISOString(),
        events: [
          ...observed.events,
          {
            id: `evt-${Date.now().toString(36)}-${observed.events.length}`,
            timestamp: new Date().toISOString(),
            fromState: 'queued',
            toState: 'healthy',
            reason: 'Container recreated and restarted'
          }
        ]
      };
    }

    const updated: RigInstance = {
      spec: instance.spec,
      observed
    };

    this.instances.set(instanceId, updated);
    return updated;
  }

  public async getInstance(
    owner: RigOwnerIdentity,
    instanceId: string
  ): Promise<RigInstance | undefined> {
    const instance = this.instances.get(instanceId);
    if (!instance) return undefined;
    this.authorizeAccess(owner, instance);
    return instance;
  }

  public async listInstances(owner: RigOwnerIdentity): Promise<RigInstance[]> {
    this.validateOwner(owner);
    const all = Array.from(this.instances.values());
    if (owner.role === 'admin') {
      return all;
    }
    return all.filter(i => i.spec.ownerId === owner.ownerId);
  }

  public async getLogs(
    owner: RigOwnerIdentity,
    instanceId: string,
    tailLines: number = 200
  ): Promise<string> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }
    this.authorizeAccess(owner, instance);

    if (instance.spec.source === 'provider' && instance.spec.runtime.adapter === 'docker') {
      return this.dockerProvider.getContainerLogs(owner, instanceId, tailLines);
    }

    // Local simulation logs
    return instance.observed.events
      .map(e => `[${e.timestamp}] [${e.toState.toUpperCase()}] ${e.reason || ''}`)
      .join('\n');
  }

  public async reapExpired(now: Date = new Date()): Promise<string[]> {
    const reapedIds: string[] = [];
    const nowMs = now.getTime();
    const activeStates: RigLifecycleState[] = ['queued', 'building', 'starting', 'healthy', 'degraded'];

    for (const [id, inst] of this.instances.entries()) {
      if (activeStates.includes(inst.observed.lifecycle) && inst.observed.expiresAt) {
        const expMs = new Date(inst.observed.expiresAt).getTime();
        if (nowMs >= expMs) {
          const systemOwner: RigOwnerIdentity = { ownerId: inst.spec.ownerId || 'reaper', role: 'admin' };
          await this.stopInstance(systemOwner, id, `TTL expired after ${inst.spec.ttlSeconds}s`);
          await this.deleteInstance(systemOwner, id);
          reapedIds.push(id);
        }
      }
    }

    // Also reap any orphaned docker containers
    const dockerReaped = await this.dockerProvider.reapExpiredContainers(now);
    for (const dId of dockerReaped) {
      if (!reapedIds.includes(dId)) {
        reapedIds.push(dId);
      }
    }

    return reapedIds;
  }
}
