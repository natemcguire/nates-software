import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import ssh2, { type Connection, type AuthContext, type Session } from 'ssh2';
import type { GatewayConfig } from './types.ts';
import { resolveRepoPath, initBareRepo } from './gitStorage.ts';
import { GitsmithGatewayService } from './gatewayService.ts';
import { isValidRefPolicies } from '../forgeDomain.ts';

const { Server, utils } = ssh2;

interface SshIdentity {
  actorUserId: string;
  keyType: string;
  keyBase64: string;
}

interface Authorization {
  actorUserId: string;
  repositoryId: string;
  storageKey: string;
  operation: 'read' | 'write';
  defaultRef?: string;
  memberRole?: string;
  refPolicies?: Array<{
    refPattern: string;
    requireSignedCommits?: boolean | number;
    requirePassingBuild?: boolean | number;
    minimumApprovals?: number;
    allowForcePush?: boolean | number;
    allowDelete?: boolean | number;
  }>;
}

export interface SshTransportStatus {
  configured: boolean;
  active: boolean;
  host?: string;
  port?: number;
  error?: string;
}

export class GitsmithSshTransport {
  private readonly config: GatewayConfig;
  private readonly gatewayService: GitsmithGatewayService;
  private readonly fetchImpl: typeof fetch;
  private server: InstanceType<typeof Server> | null = null;
  private active = false;
  private boundPort: number | undefined;
  private error: string | undefined;
  private readonly identities = new WeakMap<Connection, SshIdentity>();

  constructor(config: GatewayConfig, gatewayService: GitsmithGatewayService, fetchImpl: typeof fetch = globalThis.fetch) {
    this.config = config;
    this.gatewayService = gatewayService;
    this.fetchImpl = fetchImpl;
  }

  public getStatus(): SshTransportStatus {
    const configured = this.config.sshEnabled === true && Boolean(this.config.sshHost?.trim());
    return {
      configured,
      active: configured && this.active,
      host: this.config.sshHost || undefined,
      port: this.config.sshPublicPort ?? this.boundPort ?? this.config.sshPort,
      error: this.error || (!configured ? 'SSH transport is not configured.' : undefined)
    };
  }

  private ensureHostKey(): Buffer {
    const keyDir = path.join(this.config.reposRoot, '.gitsmith-ssh');
    const keyPath = path.join(keyDir, 'ssh_host_ed25519_key');
    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(keyPath)) {
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath], { stdio: 'pipe' });
      fs.chmodSync(keyPath, 0o600);
    }
    return fs.readFileSync(keyPath);
  }

  public ensurePreReceiveHook(): string {
    const hookDir = path.join(this.config.reposRoot, '.gitsmith-hooks');
    const hookPath = path.join(hookDir, 'pre-receive');
    fs.mkdirSync(hookDir, { recursive: true, mode: 0o700 });
    const script = `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function failClosed(reason) {
  process.stderr.write('rejected: ' + reason + '\\n');
  process.exit(1);
}

function isZeroOid(oid) {
  return !oid || /^0+$/.test(oid.trim());
}

function normalizeRef(ref) {
  if (!ref) return '';
  ref = ref.trim();
  if (ref.startsWith('refs/')) return ref;
  return 'refs/heads/' + ref;
}

function matchesPattern(refName, pattern) {
  if (!pattern || typeof pattern !== 'string') return false;
  if (!refName || typeof refName !== 'string') return false;
  pattern = pattern.trim();
  refName = refName.trim();
  const normalizedPattern = normalizeRef(pattern);
  const normalizedRef = normalizeRef(refName);
  if (refName === normalizedPattern || refName === pattern || normalizedRef === normalizedPattern || normalizedRef === pattern) return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    const normalizedPrefix = normalizeRef(prefix);
    if (refName.startsWith(normalizedPrefix) || refName.startsWith(prefix) || normalizedRef.startsWith(normalizedPrefix) || normalizedRef.startsWith(prefix)) return true;
  }
  return false;
}

function comparePolicySpecificity(a, b) {
  const normA = normalizeRef(a.refPattern);
  const normB = normalizeRef(b.refPattern);
  const hasWildcardA = normA.endsWith('*') ? 1 : 0;
  const hasWildcardB = normB.endsWith('*') ? 1 : 0;
  const prefixLenA = hasWildcardA ? normA.slice(0, -1).length : normA.length;
  const prefixLenB = normB.endsWith('*') ? normB.slice(0, -1).length : normB.length;

  if (prefixLenB !== prefixLenA) {
    return prefixLenB - prefixLenA;
  }
  if (hasWildcardA !== hasWildcardB) {
    return hasWildcardA - hasWildcardB;
  }
  return 0;
}

function selectRefPolicy(policies, refName) {
  if (!Array.isArray(policies) || policies.length === 0 || !refName) return null;
  const matches = policies.filter(p => p && typeof p.refPattern === 'string' && matchesPattern(refName, p.refPattern));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const sorted = matches.slice().sort(comparePolicySpecificity);
  const best = sorted[0];
  const topTier = sorted.filter(p => comparePolicySpecificity(best, p) === 0);

  if (topTier.length === 1) return topTier[0];

  const allowForcePush = topTier.every(p => Boolean(p.allowForcePush));
  const allowDelete = topTier.every(p => Boolean(p.allowDelete));
  const requireSignedCommits = topTier.some(p => Boolean(p.requireSignedCommits));
  const requirePassingBuild = topTier.some(p => Boolean(p.requirePassingBuild));
  const minimumApprovals = Math.max(...topTier.map(p => Number(p.minimumApprovals) || 0));
  const sortedPatterns = topTier.slice().sort((a, b) => normalizeRef(a.refPattern).localeCompare(normalizeRef(b.refPattern)));

  return {
    refPattern: sortedPatterns[0].refPattern,
    allowForcePush,
    allowDelete,
    requireSignedCommits,
    requirePassingBuild,
    minimumApprovals
  };
}

function isValidPolicyEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }
  if (typeof entry.refPattern !== 'string' || !entry.refPattern.trim()) {
    return false;
  }
  if (entry.allowForcePush === undefined || (typeof entry.allowForcePush !== 'boolean' && entry.allowForcePush !== 0 && entry.allowForcePush !== 1)) {
    return false;
  }
  if (entry.allowDelete === undefined || (typeof entry.allowDelete !== 'boolean' && entry.allowDelete !== 0 && entry.allowDelete !== 1)) {
    return false;
  }
  if (entry.requireSignedCommits === undefined || (typeof entry.requireSignedCommits !== 'boolean' && entry.requireSignedCommits !== 0 && entry.requireSignedCommits !== 1)) {
    return false;
  }
  if (entry.requirePassingBuild === undefined || (typeof entry.requirePassingBuild !== 'boolean' && entry.requirePassingBuild !== 0 && entry.requirePassingBuild !== 1)) {
    return false;
  }
  if (entry.minimumApprovals === undefined || typeof entry.minimumApprovals !== 'number' || !Number.isFinite(entry.minimumApprovals) || entry.minimumApprovals < 0) {
    return false;
  }
  return true;
}

function isValidRefPolicies(policies) {
  if (!Array.isArray(policies)) return false;
  return policies.every(isValidPolicyEntry);
}

function isFastForward(oldOid, newOid) {
  if (isZeroOid(oldOid)) return true;
  if (isZeroOid(newOid)) return false;
  try {
    const res = spawnSync('git', ['merge-base', '--is-ancestor', oldOid, newOid], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    return res.status === 0;
  } catch (err) {
    return false;
  }
}

async function main() {
  const policyFile = process.env.GITSMITH_POLICY_FILE;
  if (!policyFile) {
    failClosed('policy check failed: GITSMITH_POLICY_FILE is not set');
    return;
  }

  let policy;
  try {
    if (!fs.existsSync(policyFile)) {
      failClosed('policy check failed: policy file not found');
      return;
    }
    const content = fs.readFileSync(policyFile, 'utf8');
    policy = JSON.parse(content);
  } catch (err) {
    failClosed('policy check failed: unable to read policy file: ' + err.message);
    return;
  }

  if (!policy || policy.unreachable || policy.error) {
    failClosed('policy check failed: ' + (policy?.error || 'policy is unreachable or invalid'));
    return;
  }

  if (!isValidRefPolicies(policy.refPolicies)) {
    failClosed('policy check failed: refPolicies data is missing or invalid');
    return;
  }

  if (!policy.defaultRef || typeof policy.defaultRef !== 'string') {
    failClosed('policy check failed: defaultRef data is missing or invalid');
    return;
  }

  if (!policy.controlPlaneUrl || !policy.gatewayToken || !policy.repositoryId || !policy.actorUserId) {
    failClosed('policy check failed: missing required gateway connection parameters');
    return;
  }

  let input = '';
  try {
    input = fs.readFileSync(0, 'utf8');
  } catch (err) {
    failClosed('unable to read ref updates from stdin: ' + err.message);
    return;
  }

  const lines = input.trim().split('\\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    process.exit(0);
  }

  const updates = [];
  for (const line of lines) {
    const parts = line.split(/\\s+/);
    if (parts.length < 3) {
      failClosed('invalid ref update line: ' + line);
      return;
    }
    const [oldOid, newOid, rawRefName] = parts;
    const refName = rawRefName.trim();
    if (!refName) {
      failClosed('invalid ref update: empty ref name');
      return;
    }
    const isDelete = isZeroOid(newOid);
    const isCreate = isZeroOid(oldOid);
    if (isDelete && isCreate) {
      failClosed('invalid ref update: both old and new OIDs are zero');
      return;
    }

    const ff = (!isCreate && !isDelete) ? isFastForward(oldOid, newOid) : true;
    updates.push({
      refName,
      oldOid: isCreate ? null : oldOid,
      newOid: isDelete ? null : newOid,
      isFastForward: ff,
      isDelete
    });
  }

  const endpoint = policy.controlPlaneUrl.replace(/\\/$/, '') + '/api/git';
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + policy.gatewayToken
      },
      body: JSON.stringify({
        action: 'gateway-check-ref-policy',
        repositoryId: policy.repositoryId,
        actorUserId: policy.actorUserId,
        updates: updates
      })
    });
  } catch (err) {
    failClosed('policy check failed: Control plane unreachable: ' + err.message);
    return;
  }

  if (!response || !response.ok) {
    let errMsg = 'HTTP ' + (response ? response.status : 'unknown error');
    try {
      const errBody = await response.json();
      if (errBody && errBody.error) errMsg = errBody.error;
    } catch (_) {}
    failClosed('policy check failed: ' + errMsg);
    return;
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    failClosed('policy check failed: unable to parse policy response: ' + err.message);
    return;
  }

  if (!data || typeof data !== 'object' || data.success !== true) {
    failClosed('policy check failed: ' + (data && data.error ? data.error : 'policy check unsuccessful'));
    return;
  }

  if (data.allowed === false) {
    failClosed(data.reason || 'ref update prohibited by policy');
    return;
  }

  if (data.allowed !== true) {
    failClosed('policy check failed: policy decision missing or invalid');
    return;
  }

  if (!isValidRefPolicies(data.refPolicies)) {
    failClosed('policy check failed: refPolicies data is missing or invalid');
    return;
  }

  if (!data.defaultRef || typeof data.defaultRef !== 'string') {
    failClosed('policy check failed: defaultRef data is missing or invalid');
    return;
  }


  const liveDefaultRef = normalizeRef(data.defaultRef);
  const liveRefPolicies = data.refPolicies;

  for (const update of updates) {
    const refName = update.refName;
    const isDefaultBranch = refName === liveDefaultRef;
    const matchingPolicy = selectRefPolicy(liveRefPolicies, refName);
    const isProtected = isDefaultBranch || Boolean(matchingPolicy);

    if (isProtected) {
      if (matchingPolicy) {
        if (Boolean(matchingPolicy.requireSignedCommits)) {
          failClosed('protected ref requires signed commits which this gateway cannot verify');
          return;
        }
        if (Boolean(matchingPolicy.requirePassingBuild)) {
          failClosed('protected ref requires passing build which this gateway cannot verify');
          return;
        }
        if (typeof matchingPolicy.minimumApprovals === 'number' && matchingPolicy.minimumApprovals > 0) {
          failClosed('protected ref requires approvals which this gateway cannot verify');
          return;
        }
      }

      if (update.isDelete) {
        const allowDelete = matchingPolicy ? Boolean(matchingPolicy.allowDelete) : false;
        if (!allowDelete) {
          failClosed('deletion of protected ref ' + refName + ' is prohibited');
          return;
        }
      }

      if (!update.isCreate && !update.isDelete) {
        if (!update.isFastForward) {
          const allowForce = matchingPolicy ? Boolean(matchingPolicy.allowForcePush) : false;
          if (!allowForce) {
            failClosed('non-fast-forward update to protected ref ' + refName + ' is prohibited');
            return;
          }
        }
      }
    }
  }

  process.exit(0);
}

main().catch(err => {
  failClosed('policy check failed: ' + (err?.message || 'unexpected error'));
});
`;
    if (!fs.existsSync(hookPath) || fs.readFileSync(hookPath, 'utf8') !== script) {
      fs.writeFileSync(hookPath, script, { mode: 0o700 });
      fs.chmodSync(hookPath, 0o700);
    }
    return hookDir;
  }

  public ensureReceiveHook(): string {
    const hookDir = path.join(this.config.reposRoot, '.gitsmith-hooks');
    const hookPath = path.join(hookDir, 'post-receive');
    fs.mkdirSync(hookDir, { recursive: true, mode: 0o700 });
    const script = '#!/bin/sh\nset -eu\n: "${GITSMITH_UPDATES_FILE:?}"\nwhile read old_oid new_oid ref_name; do\n  printf "%s %s %s\\n" "$old_oid" "$new_oid" "$ref_name" >> "$GITSMITH_UPDATES_FILE"\ndone\n';
    if (!fs.existsSync(hookPath) || fs.readFileSync(hookPath, 'utf8') !== script) {
      fs.writeFileSync(hookPath, script, { mode: 0o700 });
      fs.chmodSync(hookPath, 0o700);
    }
    return hookDir;
  }

  private async authorizeKey(keyType: string, keyBase64: string): Promise<SshIdentity | null> {
    const actorResponse = await this.fetchImpl(`${this.config.controlPlaneUrl.replace(/\/$/, '')}/api/git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.gatewayToken}` },
      body: JSON.stringify({ action: 'gateway-identify-ssh-key', keyType, keyBase64 })
    });
    if (!actorResponse.ok) return null;
    const payload: any = await actorResponse.json();
    return payload?.success && payload?.actorUserId ? { actorUserId: payload.actorUserId, keyType, keyBase64 } : null;
  }

  private async authorizeRepository(identity: SshIdentity, owner: string, slug: string, operation: 'read' | 'write'): Promise<Authorization | null> {
    const response = await this.fetchImpl(`${this.config.controlPlaneUrl.replace(/\/$/, '')}/api/git`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.gatewayToken}` },
      body: JSON.stringify({ action: 'gateway-authorize-ssh', keyType: identity.keyType, keyBase64: identity.keyBase64, owner, slug, operation })
    });
    if (!response.ok) return null;
    const payload: any = await response.json().catch(() => null);
    if (!payload?.success || !payload?.storageKey) return null;
    if (operation === 'write' && (!isValidRefPolicies(payload.refPolicies) || typeof payload.defaultRef !== 'string' || !payload.defaultRef.trim())) {
      return null;
    }
    return payload as Authorization;
  }

  private parseCommand(command: string): { service: 'git-upload-pack' | 'git-receive-pack'; owner: string; slug: string } | null {
    const match = command.match(/^git-(upload|receive)-pack '\/?([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+?)(?:\.git)?'$/);
    if (!match) return null;
    const service: 'git-upload-pack' | 'git-receive-pack' = match[1] === 'upload'
      ? 'git-upload-pack'
      : 'git-receive-pack';
    return { service, owner: match[2], slug: match[3] };
  }

  private handleSession(client: Connection, accept: () => Session, reject: () => void): void {
    const identity = this.identities.get(client);
    if (!identity) return reject();
    const session = accept();
    session.on('pty', (_accept, rejectPty) => rejectPty());
    session.on('shell', (_accept, rejectShell) => rejectShell());
    session.on('exec', async (acceptExec, rejectExec, info) => {
      const parsed = this.parseCommand(info.command);
      if (!parsed) return rejectExec();
      const operation = parsed.service === 'git-receive-pack' ? 'write' : 'read';
      const authorization = await this.authorizeRepository(identity, parsed.owner, parsed.slug, operation).catch(() => null);
      if (!authorization) return rejectExec();
      if (operation === 'write' && (!isValidRefPolicies(authorization.refPolicies) || typeof authorization.defaultRef !== 'string' || !authorization.defaultRef.trim())) {
        return rejectExec();
      }
      let resolved = resolveRepoPath(this.config.reposRoot, authorization.storageKey);
      if (!resolved.valid || !resolved.resolvedPath) return rejectExec();

      // Lazy-init the bare repo on first push. A repo can be provisioned in D1 (via slop init
      // / create-repository) before its on-disk bare git dir exists — e.g. repos seeded
      // pre-forge. Without this, the FIRST push to any such repo is rejected forever. On a
      // write to a not-yet-created path, initialize the bare repo, then proceed. Reads still
      // reject a missing repo (nothing to serve).
      if (!fs.existsSync(resolved.resolvedPath)) {
        if (operation !== 'write') return rejectExec();
        const init = initBareRepo(this.config.reposRoot, {
          storageKey: authorization.storageKey,
          defaultRef: authorization.defaultRef || 'refs/heads/main'
        });
        if (!init.success) return rejectExec();
        resolved = resolveRepoPath(this.config.reposRoot, authorization.storageKey);
        if (!resolved.valid || !resolved.resolvedPath || !fs.existsSync(resolved.resolvedPath)) return rejectExec();
      }

      const channel = acceptExec();
      if (operation === 'write') {
        this.ensurePreReceiveHook();
        this.ensureReceiveHook();
      }
      const hookDir = operation === 'write' ? path.join(this.config.reposRoot, '.gitsmith-hooks') : '';
      const updatesFile = operation === 'write'
        ? path.join(this.config.reposRoot, '.gitsmith-ssh', `updates-${randomUUID()}.txt`)
        : '';
      const policyFile = operation === 'write'
        ? path.join(this.config.reposRoot, '.gitsmith-ssh', `policy-${randomUUID()}.json`)
        : '';

      if (operation === 'write' && policyFile) {
        const policyDir = path.dirname(policyFile);
        fs.mkdirSync(policyDir, { recursive: true, mode: 0o700 });
        const policyData = {
          repositoryId: authorization.repositoryId,
          actorUserId: authorization.actorUserId,
          defaultRef: authorization.defaultRef,
          memberRole: authorization.memberRole || 'writer',
          refPolicies: authorization.refPolicies,
          controlPlaneUrl: this.config.controlPlaneUrl,
          gatewayToken: this.config.gatewayToken
        };
        fs.writeFileSync(policyFile, JSON.stringify(policyData), { mode: 0o600 });
      }

      // Untrusted writers push here. Cap the pack size (receive.maxInputSize rejects an
      // oversized pack during ingest, before hooks run — protects shared disk from a
      // multi-GB push) and validate object integrity (transfer.fsckObjects) so malformed
      // objects can't enter the authoritative store.
      const maxPushBytes = this.config.maxPushBytes && this.config.maxPushBytes > 0
        ? this.config.maxPushBytes
        : 500 * 1024 * 1024;
      const args = operation === 'write'
        ? [
            '-c', `core.hooksPath=${hookDir}`,
            '-c', `receive.maxInputSize=${maxPushBytes}`,
            '-c', 'transfer.fsckObjects=true',
            'receive-pack', resolved.resolvedPath
          ]
        : ['upload-pack', resolved.resolvedPath];
      const child = spawn('git', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GITSMITH_UPDATES_FILE: updatesFile,
          GITSMITH_POLICY_FILE: policyFile
        }
      });
      channel.pipe(child.stdin);
      child.stdout.pipe(channel, { end: false });
      child.stderr.pipe(channel.stderr);
      child.on('error', () => {
        if (policyFile) { try { fs.unlinkSync(policyFile); } catch {} }
        if (updatesFile) { try { fs.unlinkSync(updatesFile); } catch {} }
        channel.exit(1);
        channel.end();
      });
      child.on('close', async code => {
        if (policyFile) {
          try { fs.unlinkSync(policyFile); } catch {}
        }
        if (operation === 'write' && code === 0 && fs.existsSync(updatesFile)) {
          const zero = /^0+$/;
          const lines = fs.readFileSync(updatesFile, 'utf8').trim().split('\n').filter(Boolean);
          for (const line of lines) {
            const [oldRaw, newRaw, refName] = line.split(' ');
            const oldOid = zero.test(oldRaw) ? null : oldRaw;
            const newOid = zero.test(newRaw) ? null : newRaw;
            const idempotencyKey = `ssh:${authorization.repositoryId}:${refName}:${oldRaw}:${newRaw}`;
            const applied = await this.gatewayService.recordAppliedRef({
              repositoryId: authorization.repositoryId, refName, oldOid, newOid,
              actorUserId: authorization.actorUserId, idempotencyKey
            });
            // The ref has already moved on disk. If the control-plane projection failed AND
            // the durable receipt did not persist, this ref move is not recoverable by the
            // periodic replay — surface it loudly so it is observable rather than silently lost.
            if (applied && applied.reconciled === false && (applied as any).receiptPersisted === false) {
              console.error(
                `[GITSMITH][CRITICAL] Ref move applied on disk but NOT projected and receipt NOT persisted: ` +
                `repo=${authorization.repositoryId} ref=${refName} ${oldRaw}->${newRaw}. D1 projection is now stale.`
              );
            }
          }
          try { fs.unlinkSync(updatesFile); } catch {}
        } else if (updatesFile) {
          try { fs.unlinkSync(updatesFile); } catch {}
        }
        channel.exit(code ?? 1);
        channel.end();
      });
    });
  }

  public async start(): Promise<void> {
    if (this.config.sshEnabled !== true) return;
    if (!this.config.sshHost?.trim()) throw new Error('GITSMITH_SSH_HOST is required when SSH transport is enabled.');
    const hostKey = this.ensureHostKey();
    this.server = new Server({ hostKeys: [hostKey], ident: 'GITSMITH' }, client => {
      client.on('error', () => {});
      client.on('authentication', (ctx: AuthContext) => {
        if (ctx.method !== 'publickey' || ctx.username !== 'git') return ctx.reject();
        const keyType = ctx.key.algo;
        const keyBase64 = ctx.key.data.toString('base64');
        void this.authorizeKey(keyType, keyBase64).then(identity => {
          if (!identity) return ctx.reject();
          const parsedKey = utils.parseKey(`${keyType} ${keyBase64}`);
          if (parsedKey instanceof Error || Array.isArray(parsedKey)) return ctx.reject();
          if (ctx.signature && (!ctx.blob || parsedKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true)) return ctx.reject();
          if (ctx.signature) this.identities.set(client, identity);
          ctx.accept();
        }).catch(() => ctx.reject());
      });
      client.on('ready', () => client.on('session', (accept, reject) => this.handleSession(client, accept, reject)));
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.sshPort ?? 2222, '0.0.0.0', () => {
        this.server!.off('error', reject);
        const address = this.server!.address();
        this.boundPort = typeof address === 'object' && address ? address.port : this.config.sshPort;
        this.active = true;
        this.error = undefined;
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.active = false;
    this.boundPort = undefined;
    this.server = null;
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
