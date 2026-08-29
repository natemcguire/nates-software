import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { GitsmithGatewayService } from '../src/lib/gitsmith/gatewayService';
import { GitsmithSshTransport } from '../src/lib/gitsmith/sshTransport';

describe('GITSMITH SSH transport', () => {
  const execFileAsync = promisify(execFile);
  const tempDirs: string[] = [];
  const transports: GitsmithSshTransport[] = [];

  afterEach(async () => {
    await Promise.all(transports.splice(0).map(transport => transport.stop()));
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('clones and pushes a real commit with registered-key authorization and projection evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsmith-ssh-'));
    tempDirs.push(root);
    const reposRoot = path.join(root, 'repos');
    fs.mkdirSync(reposRoot, { recursive: true });
    const keyPath = path.join(root, 'maker-key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath]);
    const [keyType, keyBase64] = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim().split(/\s+/);
    const callbacks: any[] = [];
    const fetchStub: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.action === 'gateway-identify-ssh-key') {
        if (body.keyType !== keyType || body.keyBase64 !== keyBase64) return Response.json({ success: false }, { status: 401 });
        return Response.json({ success: true, actorUserId: 'usr_nate' });
      }
      if (body.action === 'gateway-authorize-ssh') {
        return Response.json({
          success: true, actorUserId: 'usr_nate', repositoryId: 'repo_demo',
          storageKey: 'repositories/repo_demo', operation: body.operation
        });
      }
      if (body.action === 'gateway-record-ref') {
        callbacks.push(body);
        return Response.json({ success: true, eventId: 'evt_projection' });
      }
      return Response.json({ success: false }, { status: 400 });
    };
    const config = {
      reposRoot, controlPlaneUrl: 'http://control.test', gatewayToken: 'test-gateway-token-value',
      sshEnabled: true, sshHost: '127.0.0.1', sshPort: 0, isProduction: false
    };
    const service = new GitsmithGatewayService(config, { fetchOverride: fetchStub });
    expect(service.provisionRepository({ storageKey: 'repositories/repo_demo' }).success).toBe(true);
    const transport = new GitsmithSshTransport(config, service, fetchStub);
    transports.push(transport);
    await transport.start();
    const port = transport.getStatus().port!;
    expect(transport.getStatus()).toEqual(expect.objectContaining({ configured: true, active: true }));

    const checkout = path.join(root, 'checkout');
    const sshCommand = `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    fs.writeFileSync(path.join(checkout, 'README.md'), '# Real GITSMITH repository\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'README.md']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'initial commit']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:main'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    const remoteOid = execFileSync('git', ['--git-dir', path.join(reposRoot, 'repositories/repo_demo'), 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
    const localOid = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(remoteOid).toBe(localOid);
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toEqual(expect.objectContaining({
      action: 'gateway-record-ref', repositoryId: 'repo_demo', refName: 'refs/heads/main',
      oldOid: null, newOid: localOid, actorUserId: 'usr_nate', operation: 'create'
    }));
  }, 20_000);
});
