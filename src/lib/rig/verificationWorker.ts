import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';

export interface RigVerificationWorkerConfig {
  controlPlaneUrl: string;
  serviceSecret: string;
  jobsRoot: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

const digest = (value: Buffer | string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

export function validateArchiveEntries(entries: string[]): void {
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || normalized.includes('\0')) {
      throw new Error(`Unsafe archive entry rejected: ${entry}`);
    }
  }
}

function runDocker(args: string[], timeoutMs: number): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
  return new Promise(resolve => {
    const child = execFile('docker', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error: any, stdout, stderr) => {
      resolve({ exitCode: Number.isInteger(error?.code) ? error.code : (error ? 1 : 0),
        output: `${stdout || ''}${stderr || ''}`.slice(-8 * 1024 * 1024), timedOut: Boolean(error?.killed) });
    });
    child.stdin?.end();
  });
}

export class RigVerificationWorker {
  private busy = false;
  constructor(private readonly config: RigVerificationWorkerConfig, private readonly workerFetch: typeof fetch = fetch) {}

  private async post(body: unknown): Promise<any> {
    const response = await this.workerFetch(new URL('/api/rig-verification', this.config.controlPlaneUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.serviceSecret}` },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`RIG control plane returned ${response.status}.`);
    return response.json();
  }

  async pollOnce(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    let claim: any;
    try {
      claim = (await this.post({ action: 'claim', leaseSeconds: Math.min(900, Math.ceil(this.config.timeoutMs / 1000) + 120) })).claim;
      if (!claim) return false;
      await this.executeClaim(claim);
      return true;
    } catch (error: any) {
      if (claim?.eventId && claim?.claimToken) {
        try { await this.post({ action: 'release', eventId: claim.eventId, claimToken: claim.claimToken,
          error: error?.message || 'RIG worker infrastructure failure' }); } catch {}
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  private async executeClaim(claim: any): Promise<void> {
    const payload = claim.payload || {};
    const jobName = String(claim.eventId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!jobName || !/^sha256:[a-f0-9]{64}$/.test(String(payload.sourceManifestDigest || '')) ||
        !/^[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/i.test(String(payload.runnerImageDigest || ''))) {
      throw new Error('Verification claim is missing its pinned source or runner identity.');
    }
    const jobRoot = path.join(this.config.jobsRoot, jobName);
    const workspace = path.join(jobRoot, 'workspace');
    const archivePath = path.join(jobRoot, 'source.tar');
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const started = Date.now();
    try {
      const sourceUrl = new URL('/api/rig-verification', this.config.controlPlaneUrl);
      sourceUrl.searchParams.set('eventId', claim.eventId);
      sourceUrl.searchParams.set('claimToken', claim.claimToken);
      const response = await this.workerFetch(sourceUrl, { headers: { Authorization: `Bearer ${this.config.serviceSecret}` } });
      if (!response.ok) throw new Error(`Pinned source download returned ${response.status}.`);
      const source = Buffer.from(await response.arrayBuffer());
      if (source.length === 0 || source.length > 64 * 1024 * 1024) throw new Error('Pinned source archive violates the 64 MiB size bound.');
      if (digest(source) !== payload.sourceManifestDigest) throw new Error('Pinned source archive digest does not match the requested manifest.');
      fs.writeFileSync(archivePath, source, { mode: 0o600 });
      const entries = execFileSync('tar', ['-tf', archivePath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\n').filter(Boolean);
      validateArchiveEntries(entries);
      execFileSync('tar', ['-xf', archivePath, '-C', workspace, '--no-same-owner', '--no-same-permissions'], { stdio: 'pipe' });
      fs.chmodSync(workspace, 0o755);
      const command = `${payload.buildCommand}\n${payload.testCommand}`;
      const run = await runDocker([
        'run', '--rm', '--network=bridge', '--memory=256m', '--memory-swap=256m', '--pids-limit=128', '--cpus=1',
        '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only', `--user=${process.getuid?.() || 65532}:${process.getgid?.() || 65532}`,
        '--tmpfs=/tmp:rw,noexec,nosuid,size=64m', '--mount', `type=bind,src=${workspace},dst=/workspace`,
        '--workdir=/workspace', payload.runnerImageDigest, '/bin/sh', '-eu', '-c', command
      ], this.config.timeoutMs);
      const status = run.timedOut ? 'timed_out' : run.exitCode === 0 ? 'passed' : 'failed';
      const resultDigest = digest(JSON.stringify({ commitOid: payload.resultCommitOid, runnerImageDigest: payload.runnerImageDigest,
        toolchainVersion: payload.toolchainVersion, testPolicyVersion: payload.testPolicyVersion,
        exitCode: run.exitCode, outputDigest: digest(run.output) }));
      await this.post({ action: 'complete', eventId: claim.eventId, claimToken: claim.claimToken, status,
        resultDigest: status === 'passed' ? resultDigest : undefined, exitCode: run.exitCode, durationMs: Date.now() - started });
    } finally {
      fs.rmSync(jobRoot, { recursive: true, force: true });
    }
  }
}

export function loadRigVerificationWorkerConfig(env: NodeJS.ProcessEnv = process.env): RigVerificationWorkerConfig | null {
  const controlPlaneUrl = String(env.RIG_CONTROL_PLANE_URL || '').trim();
  const serviceSecret = String(env.RIG_GATEWAY_SERVICE_SECRET || '').trim();
  const jobsRoot = String(env.RIG_VERIFICATION_JOBS_ROOT || '').trim();
  if (!controlPlaneUrl || !jobsRoot) return null;
  return { controlPlaneUrl, serviceSecret, jobsRoot,
    pollIntervalMs: Math.max(5_000, Number(env.RIG_VERIFICATION_POLL_MS) || 15_000),
    timeoutMs: Math.max(30_000, Math.min(780_000, Number(env.RIG_VERIFICATION_TIMEOUT_MS) || 600_000)) };
}
