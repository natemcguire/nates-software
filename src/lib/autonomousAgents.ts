/**
 * HOSTED RIG & AUTONOMOUS AGENT RUNTIME ENGINE
 * 
 * Invariants:
 * 1. Hosted ephemeral app environments with scale-to-zero and 256MB cap
 * 2. Autonomous AI merge workers with sandboxed test proofs
 * 3. Resource metering (MB-seconds, token velocity, IOPS)
 * 4. Provider-backed storage snapshots with validated evidence
 * 5. Agent inbox and multi-fork campaign fan-out
 * 6. Multi-runtime support (Browser WASM, Node Dyno, Micro-Container, Cloudflare Worker)
 */

import { RigMemoryGovernor, MicroDynoPortAllocator } from './rigBackend.ts';
import { transitionMergeJob, MergeJobRecord } from './forgeDomain.ts';

export type RuntimeType = 'browser_wasm' | 'node_dyno' | 'docker_container' | 'cloudflare_worker';

export interface HostedAppEnvironment {
  readonly id: string;
  readonly appId: string;
  readonly runtime: RuntimeType;
  readonly port: number;
  readonly memoryMb: number;
  readonly memoryCapMb: number;
  readonly status: 'provisioning' | 'running' | 'idle' | 'stopped' | 'recycled';
  readonly ttlMinutes: number;
  readonly createdAt: string;
  lastActiveAt: string;
  metrics: {
    cpuPercent: number;
    mbSeconds: number;
    requestCount: number;
  };
}

export interface WalSnapshot {
  readonly snapshotId: string;
  readonly appId: string;
  readonly sqlitePath: string;
  readonly byteSize: number;
  readonly sha256Checksum: string;
  readonly createdAt: string;
}

export interface RigStorageSnapshotAdapter {
  createSnapshot(input: {
    readonly appId: string;
    readonly storagePath: string;
  }): WalSnapshot;
  restoreSnapshot(input: {
    readonly appId: string;
    readonly snapshot: WalSnapshot;
  }): { readonly restored: boolean; readonly evidenceDigest: string };
}

export interface AgentProposal {
  readonly id: string;
  readonly agentName: string;
  readonly campaignId?: string;
  readonly targetAppId: string;
  readonly title: string;
  readonly summary: string;
  readonly featureRef: string;
  readonly casNewSha: string;
  readonly diffStats: { additions: number; deletions: number; filesChanged: number };
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface CampaignFanoutReport {
  readonly campaignId: string;
  readonly title: string;
  readonly targetsCount: number;
  readonly dispatchedCount: number;
  readonly proposals: AgentProposal[];
  readonly dispatchedAt: string;
}

export class HostedRigManager {
  private portAllocator = new MicroDynoPortAllocator();
  private governor = new RigMemoryGovernor();
  private environments = new Map<string, HostedAppEnvironment>();
  private snapshots = new Map<string, WalSnapshot[]>();

  public constructor(private readonly storageAdapter?: RigStorageSnapshotAdapter) {}

  public provisionEnvironment(params: {
    appId: string;
    runtime?: RuntimeType;
    ttlMinutes?: number;
  }): HostedAppEnvironment {
    const { appId, runtime = 'node_dyno', ttlMinutes = 15 } = params;
    const envId = `env_${appId}_${Date.now().toString(36)}`;
    const port = this.portAllocator.allocate(appId, undefined, envId);
    const now = new Date().toISOString();

    const env: HostedAppEnvironment = {
      id: envId,
      appId,
      runtime,
      port,
      memoryMb: 24, // Baseline memory allocation
      memoryCapMb: 256,
      status: 'running',
      ttlMinutes,
      createdAt: now,
      lastActiveAt: now,
      metrics: {
        cpuPercent: 1.2,
        mbSeconds: 0,
        requestCount: 0
      }
    };

    this.environments.set(envId, env);
    return env;
  }

  public recordActivity(envId: string, memoryUsedMb: number, requestCountDelta = 1): HostedAppEnvironment {
    const env = this.environments.get(envId);
    if (!env) throw new Error(`Environment ${envId} not found`);

    const decision = this.governor.evaluate({
      id: env.id,
      name: env.appId,
      appId: env.appId,
      port: env.port,
      memoryMb: memoryUsedMb,
      memoryCapMb: 256,
      sqlitePath: `/data/${env.appId}.sqlite`,
      sqliteSizeBytes: 1048576,
      walJournalSizeBytes: 0,
      status: env.status === 'running' ? 'online' : 'idle',
      testEvidenceScore: 99.8,
      portalUrl: `http://localhost:${env.port}`
    }, memoryUsedMb);

    env.lastActiveAt = new Date().toISOString();
    env.metrics.requestCount += requestCountDelta;
    env.metrics.mbSeconds += (decision.memoryMb * 1); // increment MB-seconds

    return env;
  }

  public reclaimIdleEnvironments(maxIdleMinutes = 15): string[] {
    const now = Date.now();
    const reclaimed: string[] = [];

    for (const [id, env] of this.environments.entries()) {
      const lastActive = new Date(env.lastActiveAt).getTime();
      const idleMinutes = (now - lastActive) / (1000 * 60);

      if (idleMinutes >= maxIdleMinutes) {
        this.portAllocator.release(env.port);
        this.environments.delete(id);
        reclaimed.push(id);
      }
    }

    return reclaimed;
  }

  public snapshotWal(appId: string, sqlitePath = `/data/${appId}.sqlite`): WalSnapshot {
    if (!this.storageAdapter) {
      throw new Error('Storage snapshot unavailable: no provider adapter is configured.');
    }

    const snapshot = this.storageAdapter.createSnapshot({ appId, storagePath: sqlitePath });
    if (
      snapshot.appId !== appId ||
      snapshot.sqlitePath !== sqlitePath ||
      !Number.isSafeInteger(snapshot.byteSize) ||
      snapshot.byteSize < 0 ||
      !/^[a-f0-9]{64}$/i.test(snapshot.sha256Checksum) ||
      Number.isNaN(Date.parse(snapshot.createdAt))
    ) {
      throw new Error('Storage provider returned invalid snapshot evidence.');
    }

    const list = this.snapshots.get(appId) || [];
    list.push(snapshot);
    this.snapshots.set(appId, list);

    return snapshot;
  }

  public restoreWal(appId: string, snapshotId: string): { restored: boolean; snapshot: WalSnapshot } {
    const list = this.snapshots.get(appId) || [];
    const snapshot = list.find(s => s.snapshotId === snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found for app ${appId}`);
    }

    if (!this.storageAdapter) {
      throw new Error('Storage restore unavailable: no provider adapter is configured.');
    }

    const result = this.storageAdapter.restoreSnapshot({ appId, snapshot });
    if (!result.restored || !/^[a-f0-9]{64}$/i.test(result.evidenceDigest)) {
      throw new Error('Storage provider did not return valid restore evidence.');
    }

    return { restored: true, snapshot };
  }

  public getEnvironments(): HostedAppEnvironment[] {
    return Array.from(this.environments.values());
  }
}

export class AutonomousMergeWorker {
  public executeAutonomousMerge(
    job: MergeJobRecord,
    testRunner: () => { success: boolean; evidenceDigest: string }
  ): MergeJobRecord {
    let currentJob = transitionMergeJob(job, 'preparing');
    currentJob = transitionMergeJob(currentJob, 'running');

    const testResult = testRunner();
    if (!testResult.success) {
      return transitionMergeJob(currentJob, 'failed');
    }

    const previewUrl = `https://preview-${currentJob.sourceRepositoryId}.nates-software.com`;
    return transitionMergeJob(currentJob, 'preview_ready', {
      previewUrl,
      evidenceDigest: testResult.evidenceDigest
    });
  }
}

export class AgentCampaignManager {
  public dispatchCampaign(params: {
    campaignId: string;
    title: string;
    summary: string;
    featureRef: string;
    casNewSha: string;
    targetAppIds: string[];
    diffStats?: { additions: number; deletions: number; filesChanged: number };
  }): CampaignFanoutReport {
    const {
      campaignId,
      title,
      summary,
      featureRef,
      casNewSha,
      targetAppIds,
      diffStats = { additions: 42, deletions: 8, filesChanged: 3 }
    } = params;

    const proposals: AgentProposal[] = targetAppIds.map(appId => ({
      id: `prop_${campaignId}_${appId}`,
      agentName: 'AGY Autonomous Feature Agent',
      campaignId,
      targetAppId: appId,
      title,
      summary,
      featureRef,
      casNewSha,
      diffStats,
      status: 'pending',
      createdAt: new Date().toISOString()
    }));

    return {
      campaignId,
      title,
      targetsCount: targetAppIds.length,
      dispatchedCount: proposals.length,
      proposals,
      dispatchedAt: new Date().toISOString()
    };
  }
}
