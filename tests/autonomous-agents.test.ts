import { describe, it, expect } from 'vitest';
import {
  HostedRigManager,
  AutonomousMergeWorker,
  AgentCampaignManager
} from '../src/lib/autonomousAgents';
import { createMergeJob } from '../src/lib/forgeDomain';

describe('Hosted RIG and Autonomous Agents Runtime', () => {
  it('should provision ephemeral app environments with dedicated ports and memory caps', () => {
    const manager = new HostedRigManager();
    const env = manager.provisionEnvironment({ appId: 'dronehunter', runtime: 'node_dyno', ttlMinutes: 15 });

    expect(env.id).toContain('env_dronehunter_');
    expect(env.port).toBeGreaterThanOrEqual(3001);
    expect(env.port).toBeLessThanOrEqual(3010);
    expect(env.memoryCapMb).toBe(256);
    expect(env.status).toBe('running');

    // Record activity and meter resource usage
    const activeEnv = manager.recordActivity(env.id, 48, 10);
    expect(activeEnv.metrics.requestCount).toBe(10);
    expect(activeEnv.metrics.mbSeconds).toBeGreaterThan(0);
  });

  it('should reclaim idle environments to preserve pool ports', () => {
    const manager = new HostedRigManager();
    const env = manager.provisionEnvironment({ appId: 'picfitai', ttlMinutes: 10 });
    
    // Artificially age lastActiveAt
    env.lastActiveAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const reclaimed = manager.reclaimIdleEnvironments(15);
    expect(reclaimed).toContain(env.id);
    expect(manager.getEnvironments().length).toBe(0);
  });

  it('should take and restore real SQLite WAL point-in-time snapshots with checksums', () => {
    const manager = new HostedRigManager();
    const snapshot = manager.snapshotWal('certified-mailer', '/data/certified-mailer.sqlite', 2048000);

    expect(snapshot.snapshotId).toMatch(/^snap_certified-mailer_/);
    expect(snapshot.sha256Checksum).toMatch(/^sha256_/);
    expect(snapshot.byteSize).toBe(2048000);

    const restoreRes = manager.restoreWal('certified-mailer', snapshot.snapshotId);
    expect(restoreRes.restored).toBe(true);
    expect(restoreRes.snapshot.sha256Checksum).toBe(snapshot.sha256Checksum);
  });

  it('should execute autonomous AI merge worker transitions with sandboxed test proof', () => {
    const worker = new AutonomousMergeWorker();
    const initialJob = createMergeJob({
      targetRepositoryId: 'dronehunter',
      sourceRepositoryId: 'dronehunter-mod',
      sourceRefName: 'refs/features/arcade-scores/5c030af',
      baseCommitOid: '5c030af'
    });

    const completedJob = worker.executeAutonomousMerge(initialJob, () => ({
      success: true,
      evidenceDigest: 'sha256:7a92c81e9b14c'
    }));

    expect(completedJob.status).toBe('preview_ready');
    expect(completedJob.previewUrl).toContain('preview-dronehunter-mod');
    expect(completedJob.evidenceDigest).toBe('sha256:7a92c81e9b14c');
  });

  it('should fan-out agent campaigns across multiple target app forks in the agent inbox', () => {
    const campaignManager = new AgentCampaignManager();
    const report = campaignManager.dispatchCampaign({
      campaignId: 'cmp_sqlite_index_opt',
      title: 'SQLite Index Optimization & PRAGMA wal_autocheckpoint',
      summary: 'Automatically adds covering indexes to user_id and optimizes WAL checkpoints.',
      featureRef: 'refs/features/opt/sqlite-indexes',
      casNewSha: '8f4a21e',
      targetAppIds: ['dronehunter', 'certified-mailer', 'picfitai']
    });

    expect(report.targetsCount).toBe(3);
    expect(report.dispatchedCount).toBe(3);
    expect(report.proposals.length).toBe(3);
    expect(report.proposals[0].targetAppId).toBe('dronehunter');
    expect(report.proposals[0].status).toBe('pending');
  });
});
