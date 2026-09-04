import {
  type RigSpec,
  type RigInstance,
  type RigObservedState,
  type RigLifecycleState,
  type RigLifecycleEvent,
  type RigContainer,
  validateRigSpec,
  validateRigTransition
} from './rigDomain.ts';

export const PORT_RANGE_START = 3001;
export const PORT_RANGE_END = 3010;
export const MEMORY_CAP_MB = 256;

export interface PortAllocation {
  readonly port: number;
  readonly appId: string;
  readonly containerId?: string;
  readonly allocatedAt: Date;
}

export class MicroDynoPortAllocator {
  private readonly allocations: Map<number, PortAllocation> = new Map();
  public readonly minPort: number;
  public readonly maxPort: number;

  constructor(minPort: number = PORT_RANGE_START, maxPort: number = PORT_RANGE_END) {
    if (minPort > maxPort || minPort < 1024 || maxPort > 65535) {
      throw new Error(`Invalid port range: ${minPort}-${maxPort}`);
    }
    this.minPort = minPort;
    this.maxPort = maxPort;
  }

  public isAvailable(port: number): boolean {
    if (port < this.minPort || port > this.maxPort) return false;
    return !this.allocations.has(port);
  }

  public allocate(appId: string, preferredPort?: number, containerId?: string): number {
    if (!appId || appId.trim().length === 0) {
      throw new Error('appId must be a non-empty string for port allocation.');
    }

    if (preferredPort !== undefined && this.isAvailable(preferredPort)) {
      this.allocations.set(preferredPort, {
        port: preferredPort,
        appId,
        containerId,
        allocatedAt: new Date()
      });
      return preferredPort;
    }

    for (let port = this.minPort; port <= this.maxPort; port++) {
      if (!this.allocations.has(port)) {
        this.allocations.set(port, {
          port,
          appId,
          containerId,
          allocatedAt: new Date()
        });
        return port;
      }
    }

    throw new Error(`All micro-dyno ports (${this.minPort}-${this.maxPort}) are allocated. Port pool exhausted.`);
  }

  public release(port: number): boolean {
    return this.allocations.delete(port);
  }

  public releaseByApp(appId: string): number[] {
    const released: number[] = [];
    for (const [port, alloc] of this.allocations.entries()) {
      if (alloc.appId === appId) {
        this.allocations.delete(port);
        released.push(port);
      }
    }
    return released;
  }

  public releaseByContainer(containerId: string): number[] {
    const released: number[] = [];
    for (const [port, alloc] of this.allocations.entries()) {
      if (alloc.containerId === containerId) {
        this.allocations.delete(port);
        released.push(port);
      }
    }
    return released;
  }

  public releaseByInstance(instanceId: string): number[] {
    return this.releaseByContainer(instanceId);
  }

  public getAllocatedPorts(): PortAllocation[] {
    return Array.from(this.allocations.values()).sort((a, b) => a.port - b.port);
  }

  public getAvailablePorts(): number[] {
    const available: number[] = [];
    for (let p = this.minPort; p <= this.maxPort; p++) {
      if (!this.allocations.has(p)) {
        available.push(p);
      }
    }
    return available;
  }

  public reset(): void {
    this.allocations.clear();
  }
}

export interface GovernorDecision {
  readonly allowed: boolean;
  readonly action: 'none' | 'oom' | 'oom_recovered' | 'throttled' | 'rejected';
  readonly memoryMb: number;
  readonly memoryCapMb: number;
  readonly status: RigLifecycleState | string;
  readonly message: string;
}

export class RigMemoryGovernor {
  public readonly memoryCapMb: number = MEMORY_CAP_MB;

  public validateMemory(memoryMb: number, customCapMb?: number): boolean {
    const cap = customCapMb ?? this.memoryCapMb;
    return Number.isFinite(memoryMb) && memoryMb >= 0 && memoryMb <= cap;
  }

  public evaluate(
    target: { memoryCapMb?: number; status?: string; memoryMb?: number; [key: string]: unknown },
    requestedMemoryMb: number
  ): GovernorDecision {
    const cap = typeof target.memoryCapMb === 'number' && target.memoryCapMb > 0 ? target.memoryCapMb : this.memoryCapMb;
    const currentMemory = typeof target.memoryMb === 'number' ? target.memoryMb : 0;
    const currentStatus = typeof target.status === 'string' ? target.status : 'healthy';

    if (!Number.isFinite(requestedMemoryMb) || requestedMemoryMb < 0) {
      return {
        allowed: false,
        action: 'rejected',
        memoryMb: currentMemory,
        memoryCapMb: cap,
        status: currentStatus,
        message: `Invalid memory request: ${requestedMemoryMb}MB must be a non-negative finite number.`
      };
    }

    if (requestedMemoryMb <= cap) {
      return {
        allowed: true,
        action: 'none',
        memoryMb: requestedMemoryMb,
        memoryCapMb: cap,
        status: currentStatus === 'oom' || currentStatus === 'oom_recovered' ? 'healthy' : currentStatus,
        message: `Memory usage ${requestedMemoryMb}MB within ${cap}MB boundary.`
      };
    }

    return {
      allowed: false,
      action: 'oom',
      memoryMb: requestedMemoryMb,
      memoryCapMb: cap,
      status: 'oom',
      message: `Memory limit exceeded: observed ${requestedMemoryMb}MB exceeds strict ${cap}MB cap.`
    };
  }

  public getFleetStats(targets: readonly (RigInstance | RigContainer)[]): {
    totalUsedMb: number;
    totalCapMb: number;
    usagePercent: number;
    healthyCount: number;
    oomCount: number;
  } {
    let totalUsedMb = 0;
    let totalCapMb = 0;
    let healthyCount = 0;
    let oomCount = 0;

    for (const t of targets) {
      if ('spec' in t && 'observed' in t) {
        totalUsedMb += t.observed.memoryMb;
        totalCapMb += t.spec.resources.memoryCapMb;
        if (t.observed.lifecycle === 'healthy') healthyCount++;
        if (t.observed.lifecycle === 'oom') oomCount++;
      } else {
        const c = t as RigContainer;
        totalUsedMb += c.memoryMb;
        totalCapMb += c.memoryCapMb;
        if (c.status === 'online' || c.status === 'healthy') healthyCount++;
        if (c.status === 'oom' || c.status === 'oom_recovered') oomCount++;
      }
    }

    const usagePercent = totalCapMb > 0 ? Math.round((totalUsedMb / totalCapMb) * 1000) / 10 : 0;

    return {
      totalUsedMb,
      totalCapMb,
      usagePercent,
      healthyCount,
      oomCount
    };
  }
}

export interface CreateRigSpecParams {
  id?: string;
  appId: string;
  name?: string;
  runtime?: {
    adapter?: 'process' | 'docker' | 'wasm' | 'custom' | 'simulation';
    buildCommand?: string;
    startCommand?: string;
    healthCommand?: string;
    healthEndpoint?: string;
    env?: Record<string, string>;
  };
  resources?: {
    memoryCapMb?: number;
    cpuCores?: number;
  };
  storage?: Array<{
    name?: string;
    kind: 'volume' | 'sqlite' | 'directory' | 'ephemeral' | 'block';
    mountPath: string;
    sizeBytes?: number;
    sizeMb?: number;
    persistence: 'ephemeral' | 'persistent' | 'retained';
  }>;
  preferredPort?: number;
  ttlSeconds?: number;
  source?: 'demo' | 'provider';
}

export class RigControlPlane {
  public readonly portAllocator: MicroDynoPortAllocator;
  public readonly memoryGovernor: RigMemoryGovernor;
  private instances: Map<string, RigInstance> = new Map();
  private isProviderConnected: boolean = false;

  constructor(
    optionsOrFleet?:
      | {
          minPort?: number;
          maxPort?: number;
          providerConnected?: boolean;
          initialFleet?: readonly (RigInstance | RigContainer)[];
        }
      | readonly (RigInstance | RigContainer)[]
  ) {
    let minPort = PORT_RANGE_START;
    let maxPort = PORT_RANGE_END;
    let fleetToLoad: readonly (RigInstance | RigContainer)[] = [];

    if (Array.isArray(optionsOrFleet)) {
      fleetToLoad = optionsOrFleet;
    } else if (optionsOrFleet && typeof optionsOrFleet === 'object') {
      const opts = optionsOrFleet as {
        minPort?: number;
        maxPort?: number;
        providerConnected?: boolean;
        initialFleet?: readonly (RigInstance | RigContainer)[];
      };
      if (typeof opts.minPort === 'number') minPort = opts.minPort;
      if (typeof opts.maxPort === 'number') maxPort = opts.maxPort;
      if (opts.providerConnected !== undefined) this.isProviderConnected = opts.providerConnected;
      if (opts.initialFleet !== undefined) {
        fleetToLoad = opts.initialFleet;
      }
    }

    this.portAllocator = new MicroDynoPortAllocator(minPort, maxPort);
    this.memoryGovernor = new RigMemoryGovernor();

    if (fleetToLoad && fleetToLoad.length > 0) {
      for (const item of fleetToLoad) {
        if ('spec' in item && 'observed' in item) {
          const inst = item as RigInstance;
          if (inst.observed.allocatedPort) {
            this.portAllocator.allocate(inst.spec.appId, inst.observed.allocatedPort, inst.spec.id);
          }
          this.instances.set(inst.spec.id, inst);
        } else {
          const c = item as RigContainer;
          const port = this.portAllocator.allocate(c.appId, c.port, c.id);
          const spec: RigSpec = {
            id: c.id,
            appId: c.appId,
            name: c.name,
            runtime: {
              adapter: 'simulation',
              startCommand: 'npm start'
            },
            resources: {
              memoryCapMb: c.memoryCapMb || MEMORY_CAP_MB
            },
            storage: c.sqlitePath
              ? [
                  {
                    kind: 'sqlite',
                    mountPath: c.sqlitePath,
                    sizeBytes: c.sqliteSizeBytes,
                    persistence: 'persistent'
                  }
                ]
              : undefined,
            preferredPort: port,
            ttlSeconds: 900,
            source: 'demo',
            createdAt: new Date().toISOString()
          };

          const observed: RigObservedState = {
            lifecycle: (c.status as RigLifecycleState) || 'healthy',
            allocatedPort: port,
            memoryMb: c.memoryMb,
            events: [
              {
                id: `evt-init-${c.id}`,
                timestamp: new Date().toISOString(),
                fromState: null,
                toState: (c.status as RigLifecycleState) || 'healthy',
                reason: 'Initial demo instance registered'
              }
            ]
          };

          this.instances.set(c.id, { spec, observed });
        }
      }
    }
  }

  public getProviderStatus(): { connected: boolean; message: string } {
    return {
      connected: this.isProviderConnected,
      message: this.isProviderConnected
        ? 'Real provider adapter connected.'
        : 'Provider disconnected. Operating in deterministic local control-plane simulation mode.'
    };
  }

  public createInstance(params: RigSpec | CreateRigSpecParams): RigInstance {
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
      const val = validateRigSpec(params);
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
        runtime: {
          adapter: p.runtime?.adapter || 'simulation',
          buildCommand: p.runtime?.buildCommand,
          startCommand: p.runtime?.startCommand || 'npm start',
          healthCommand: p.runtime?.healthCommand,
          healthEndpoint: p.runtime?.healthEndpoint || '/healthz',
          env: p.runtime?.env
        },
        resources: {
          memoryCapMb: p.resources?.memoryCapMb || MEMORY_CAP_MB,
          cpuCores: p.resources?.cpuCores
        },
        storage: p.storage,
        preferredPort: p.preferredPort,
        ttlSeconds: p.ttlSeconds && p.ttlSeconds > 0 ? p.ttlSeconds : 900,
        source: p.source || 'demo',
        createdAt: new Date().toISOString()
      };

      const val = validateRigSpec(candidateSpec);
      if (!val.valid) {
        throw new Error(`Invalid RigSpec parameters: ${val.errors.join('; ')}`);
      }
      spec = val.data;
    }

    if (spec.source === 'provider' && !this.isProviderConnected) {
      throw new Error('Cannot create instance with source "provider" while provider is disconnected.');
    }

    if (this.instances.has(spec.id)) {
      throw new Error(`Instance with id ${spec.id} already exists.`);
    }

    const port = this.portAllocator.allocate(spec.appId, spec.preferredPort, spec.id);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + spec.ttlSeconds * 1000).toISOString();

    const initialEvent: RigLifecycleEvent = {
      id: `evt-${Date.now().toString(36)}-0`,
      timestamp: nowIso,
      fromState: null,
      toState: 'queued',
      reason: `Instance spec registered (adapter: ${spec.runtime.adapter}, source: ${spec.source})`
    };

    const observed: RigObservedState = {
      lifecycle: 'queued',
      allocatedPort: port,
      memoryMb: 0,
      startedAt: undefined,
      stoppedAt: undefined,
      expiresAt,
      events: [initialEvent]
    };

    const instance: RigInstance = { spec, observed };
    this.instances.set(spec.id, instance);
    return instance;
  }

  public transitionState(
    instanceId: string,
    toState: RigLifecycleState,
    reason?: string,
    details?: Record<string, unknown>
  ): RigInstance {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    const fromState = instance.observed.lifecycle;
    const validation = validateRigTransition(fromState, toState);
    if (!validation.valid) {
      throw new Error(validation.error || `Illegal state transition from ${fromState} to ${toState}`);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    let port = instance.observed.allocatedPort;

    const terminalOrInactiveStates: RigLifecycleState[] = ['crashed', 'oom', 'expired', 'stopped'];
    const activeStates: RigLifecycleState[] = ['queued', 'building', 'starting', 'healthy', 'degraded'];

    if (terminalOrInactiveStates.includes(toState)) {
      if (port !== undefined) {
        this.portAllocator.release(port);
        port = undefined;
      }
    } else if (activeStates.includes(toState) && port === undefined) {
      port = this.portAllocator.allocate(instance.spec.appId, instance.spec.preferredPort, instance.spec.id);
    }

    let startedAt = instance.observed.startedAt;
    if (toState === 'starting' && !startedAt) {
      startedAt = nowIso;
    }

    let stoppedAt = instance.observed.stoppedAt;
    if (toState === 'stopped') {
      stoppedAt = nowIso;
    }

    const event: RigLifecycleEvent = {
      id: `evt-${Date.now().toString(36)}-${instance.observed.events.length}`,
      timestamp: nowIso,
      fromState,
      toState,
      reason: reason || `Transition from ${fromState} to ${toState}`,
      details
    };

    const updatedObserved: RigObservedState = {
      ...instance.observed,
      lifecycle: toState,
      allocatedPort: port,
      startedAt,
      stoppedAt,
      events: [...instance.observed.events, event]
    };

    const updatedInstance: RigInstance = {
      spec: instance.spec,
      observed: updatedObserved
    };

    this.instances.set(instanceId, updatedInstance);
    return updatedInstance;
  }

  public updateMemory(
    instanceId: string,
    memoryMb: number
  ): { instance: RigInstance; decision: GovernorDecision } {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    const decision = this.memoryGovernor.evaluate(
      {
        memoryCapMb: instance.spec.resources.memoryCapMb,
        status: instance.observed.lifecycle,
        memoryMb: instance.observed.memoryMb
      },
      memoryMb
    );

    if (decision.action === 'oom') {
      const fromState = instance.observed.lifecycle;
      const validation = validateRigTransition(fromState, 'oom');
      if (!validation.valid) {
        throw new Error(`Cannot observe OOM for instance '${instanceId}' in state '${fromState}': ${validation.error}`);
      }

      const updated = this.transitionState(
        instanceId,
        'oom',
        `OOM observation: requested ${memoryMb}MB exceeds memory cap of ${instance.spec.resources.memoryCapMb}MB.`
      );
      return { instance: updated, decision };
    }

    if (decision.allowed) {
      const updatedObserved: RigObservedState = {
        ...instance.observed,
        memoryMb: decision.memoryMb
      };
      const updatedInstance: RigInstance = {
        spec: instance.spec,
        observed: updatedObserved
      };
      this.instances.set(instanceId, updatedInstance);
      return { instance: updatedInstance, decision };
    }

    return { instance, decision };
  }

  public restartInstance(instanceId: string): RigInstance {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    const fromState = instance.observed.lifecycle;
    const validation = validateRigTransition(fromState, 'queued');
    if (!validation.valid) {
      throw new Error(`Cannot restart instance from state '${fromState}': ${validation.error}`);
    }

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
      fromState,
      toState: 'queued',
      reason: 'Instance restarted by control plane'
    };

    const updatedObserved: RigObservedState = {
      lifecycle: 'queued',
      allocatedPort: port,
      memoryMb: 0,
      startedAt: undefined,
      stoppedAt: undefined,
      expiresAt,
      exitCode: undefined,
      errorMessage: undefined,
      events: [...instance.observed.events, restartEvent]
    };

    const updatedInstance: RigInstance = {
      spec: instance.spec,
      observed: updatedObserved
    };

    this.instances.set(instanceId, updatedInstance);
    return updatedInstance;
  }

  public stopInstance(instanceId: string, reason = 'Operator stopped instance'): RigInstance {
    return this.transitionState(instanceId, 'stopped', reason);
  }

  public checkExpiry(now: Date | string | number = new Date()): RigInstance[] {
    const nowMs = new Date(now).getTime();
    const expiredInstances: RigInstance[] = [];
    const activeStates: RigLifecycleState[] = ['queued', 'building', 'starting', 'healthy', 'degraded'];

    for (const [id, instance] of this.instances.entries()) {
      if (activeStates.includes(instance.observed.lifecycle)) {
        if (instance.observed.expiresAt) {
          const expiresAtMs = new Date(instance.observed.expiresAt).getTime();
          if (nowMs >= expiresAtMs) {
            const updated = this.transitionState(
              id,
              'expired',
              `TTL of ${instance.spec.ttlSeconds}s expired at ${new Date(nowMs).toISOString()}`
            );
            expiredInstances.push(updated);
          }
        }
      }
    }

    return expiredInstances;
  }

  public deleteInstance(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    if (instance.observed.allocatedPort !== undefined) {
      this.portAllocator.release(instance.observed.allocatedPort);
    }
    return this.instances.delete(instanceId);
  }

  public getInstance(instanceId: string): RigInstance | undefined {
    return this.instances.get(instanceId);
  }

  public listInstances(): RigInstance[] {
    return Array.from(this.instances.values());
  }

  public getStatusSummary(): {
    totalContainers: number;
    totalInstances: number;
    activePorts: number[];
    availablePorts: number[];
    fleetStats: {
      totalUsedMb: number;
      totalCapMb: number;
      usagePercent: number;
      healthyCount: number;
      oomCount: number;
    };
    fleetMemory: {
      totalUsedMb: number;
      totalCapMb: number;
      usagePercent: number;
      healthyCount: number;
      oomCount: number;
    };
    provider: { connected: boolean; message: string };
  } {
    const instances = this.listInstances();
    const stats = this.memoryGovernor.getFleetStats(instances);
    return {
      totalContainers: instances.length,
      totalInstances: instances.length,
      activePorts: this.portAllocator.getAllocatedPorts().map(a => a.port),
      availablePorts: this.portAllocator.getAvailablePorts(),
      fleetStats: stats,
      fleetMemory: stats,
      provider: this.getProviderStatus()
    };
  }

  public spawnContainer(params: {
    appId: string;
    name: string;
    preferredPort?: number;
    initialMemoryMb?: number;
    sqliteFileName?: string;
    sqliteSizeBytes?: number;
  }): RigContainer {
    const inst = this.createInstance({
      appId: params.appId,
      name: params.name,
      preferredPort: params.preferredPort,
      resources: { memoryCapMb: MEMORY_CAP_MB },
      storage: params.sqliteFileName
        ? [
            {
              kind: 'sqlite',
              mountPath: `/data/${params.sqliteFileName}.sqlite`,
              persistence: 'persistent',
              sizeBytes: params.sqliteSizeBytes ?? 1048576
            }
          ]
        : undefined,
      ttlSeconds: 900,
      source: 'demo'
    });

    if (params.initialMemoryMb && params.initialMemoryMb > 0) {
      this.updateMemory(inst.spec.id, params.initialMemoryMb);
    }

    const current = this.getInstance(inst.spec.id)!;
    return {
      id: current.spec.id,
      appId: current.spec.appId,
      name: current.spec.name,
      port: current.observed.allocatedPort || 0,
      memoryMb: current.observed.memoryMb,
      memoryCapMb: current.spec.resources.memoryCapMb,
      sqlitePath: current.spec.storage?.[0]?.mountPath || '',
      sqliteSizeBytes: current.spec.storage?.[0]?.sizeBytes || 0,
      walJournalSizeBytes: 0,
      status: current.observed.lifecycle
    };
  }

  public terminateContainer(containerId: string): boolean {
    return this.deleteInstance(containerId);
  }

  public getContainer(containerId: string): RigContainer | undefined {
    const inst = this.getInstance(containerId);
    if (!inst) return undefined;
    return {
      id: inst.spec.id,
      appId: inst.spec.appId,
      name: inst.spec.name,
      port: inst.observed.allocatedPort || 0,
      memoryMb: inst.observed.memoryMb,
      memoryCapMb: inst.spec.resources.memoryCapMb,
      sqlitePath: inst.spec.storage?.[0]?.mountPath || '',
      sqliteSizeBytes: inst.spec.storage?.[0]?.sizeBytes || 0,
      walJournalSizeBytes: 0,
      status: inst.observed.lifecycle
    };
  }

  public listContainers(): RigContainer[] {
    return this.listInstances().map(inst => ({
      id: inst.spec.id,
      appId: inst.spec.appId,
      name: inst.spec.name,
      port: inst.observed.allocatedPort || 0,
      memoryMb: inst.observed.memoryMb,
      memoryCapMb: inst.spec.resources.memoryCapMb,
      sqlitePath: inst.spec.storage?.[0]?.mountPath || '',
      sqliteSizeBytes: inst.spec.storage?.[0]?.sizeBytes || 0,
      walJournalSizeBytes: 0,
      status: inst.observed.lifecycle
    }));
  }
}

export const RigRuntimeBackend = RigControlPlane;
export type RigRuntimeBackend = RigControlPlane;
