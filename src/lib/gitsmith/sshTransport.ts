import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import ssh2, { type Connection, type AuthContext, type Session } from 'ssh2';
import type { GatewayConfig } from './types.ts';
import { resolveRepoPath } from './gitStorage.ts';
import { GitsmithGatewayService } from './gatewayService.ts';

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

  private ensureReceiveHook(): string {
    const hookDir = path.join(this.config.reposRoot, '.gitsmith-hooks');
    const hookPath = path.join(hookDir, 'post-receive');
    fs.mkdirSync(hookDir, { recursive: true, mode: 0o700 });
    const script = '#!/bin/sh\nset -eu\n: "${GITSMITH_UPDATES_FILE:?}"\nwhile read old_oid new_oid ref_name; do\n  printf "%s %s %s\\n" "$old_oid" "$new_oid" "$ref_name" >> "$GITSMITH_UPDATES_FILE"\ndone\n';
    if (!fs.existsSync(hookPath) || fs.readFileSync(hookPath, 'utf8') !== script) {
      fs.writeFileSync(hookPath, script, { mode: 0o700 });
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
    const payload: any = await response.json();
    return payload?.success ? payload as Authorization : null;
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
      const resolved = resolveRepoPath(this.config.reposRoot, authorization.storageKey);
      if (!resolved.valid || !resolved.resolvedPath || !fs.existsSync(resolved.resolvedPath)) return rejectExec();

      const channel = acceptExec();
      const hookDir = operation === 'write' ? this.ensureReceiveHook() : '';
      const updatesFile = operation === 'write'
        ? path.join(this.config.reposRoot, '.gitsmith-ssh', `updates-${randomUUID()}.txt`)
        : '';
      const args = operation === 'write'
        ? ['-c', `core.hooksPath=${hookDir}`, 'receive-pack', resolved.resolvedPath]
        : ['upload-pack', resolved.resolvedPath];
      const child = spawn('git', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GITSMITH_UPDATES_FILE: updatesFile }
      });
      channel.pipe(child.stdin);
      // Keep the SSH channel open until the child exit status and any durable
      // projection receipt have been recorded. A default pipe would end the
      // channel before we can send SSH_MSG_CHANNEL_REQUEST(exit-status).
      child.stdout.pipe(channel, { end: false });
      child.stderr.pipe(channel.stderr);
      child.on('error', () => { channel.exit(1); channel.end(); });
      child.on('close', async code => {
        if (operation === 'write' && code === 0 && fs.existsSync(updatesFile)) {
          const zero = /^0+$/;
          const lines = fs.readFileSync(updatesFile, 'utf8').trim().split('\n').filter(Boolean);
          for (const line of lines) {
            const [oldRaw, newRaw, refName] = line.split(' ');
            const oldOid = zero.test(oldRaw) ? null : oldRaw;
            const newOid = zero.test(newRaw) ? null : newRaw;
            const idempotencyKey = `ssh:${authorization.repositoryId}:${refName}:${oldRaw}:${newRaw}`;
            await this.gatewayService.recordAppliedRef({
              repositoryId: authorization.repositoryId, refName, oldOid, newOid,
              actorUserId: authorization.actorUserId, idempotencyKey
            });
          }
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
    // ssh2 prepends the RFC 4253 `SSH-2.0-` protocol marker.
    this.server = new Server({ hostKeys: [hostKey], ident: 'GITSMITH' }, client => {
      // Probes such as ssh-keyscan intentionally try several incompatible
      // algorithm sets and reset rejected sockets. Those are per-connection
      // failures, not process-level transport failures.
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
          // A signature-less request is the SSH public-key offer probe. ssh2
          // turns accept() into PK_OK and invokes authentication again with a
          // signature; only the signed request establishes an identity.
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
