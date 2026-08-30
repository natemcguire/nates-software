import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { GitsmithGatewayService } from '../src/lib/gitsmith/gatewayService';
import { GitsmithSshTransport } from '../src/lib/gitsmith/sshTransport';
import { selectRefPolicy } from '../src/lib/forgeDomain';

describe('GITSMITH SSH transport', () => {
  const execFileAsync = promisify(execFile);
  const tempDirs: string[] = [];
  const transports: GitsmithSshTransport[] = [];
  const httpServers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(transports.splice(0).map(transport => transport.stop()));
    await Promise.all(httpServers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve()))));
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function setupTransport(options: {
    refPolicies?: any[];
    liveRefPolicies?: any[];
    getRefPolicies?: () => any[];
    memberRole?: string;
    defaultRef?: string;
    authorizeError?: boolean;
    writeAuthorizeError?: boolean;
    checkPolicyError?: boolean;
    omitRefPolicies?: boolean;
  } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsmith-ssh-'));
    tempDirs.push(root);
    const reposRoot = path.join(root, 'repos');
    fs.mkdirSync(reposRoot, { recursive: true });
    const keyPath = path.join(root, 'maker-key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath]);
    const [keyType, keyBase64] = fs.readFileSync(`${keyPath}.pub`, 'utf8').trim().split(/\s+/);
    const callbacks: any[] = [];

    const server = http.createServer((req, res) => {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', () => {
        let body: any = {};
        try { body = JSON.parse(bodyStr); } catch {}

        if (body.action === 'gateway-identify-ssh-key') {
          if (body.keyType !== keyType || body.keyBase64 !== keyBase64) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, actorUserId: 'usr_nate' }));
          return;
        }

        if (body.action === 'gateway-authorize-ssh') {
          if (options.authorizeError || (body.operation === 'write' && options.writeAuthorizeError)) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Control plane database offline / policy query failed' }));
            return;
          }
          const authPayload: any = {
            success: true,
            actorUserId: 'usr_nate',
            repositoryId: 'repo_demo',
            storageKey: 'repositories/repo_demo',
            operation: body.operation,
            defaultRef: options.defaultRef || 'refs/heads/main',
            memberRole: options.memberRole || 'writer'
          };
          if (!options.omitRefPolicies) {
            authPayload.refPolicies = options.refPolicies !== undefined ? options.refPolicies : [];
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(authPayload));
          return;
        }

        if (body.action === 'gateway-check-ref-policy') {
          if (options.authorizeError || options.checkPolicyError) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Control plane unreachable' }));
            return;
          }
          const currentPolicies = typeof options.getRefPolicies === 'function'
            ? options.getRefPolicies()
            : (options.liveRefPolicies !== undefined ? options.liveRefPolicies : (options.refPolicies !== undefined ? options.refPolicies : []));
          const currentDefaultRef = options.defaultRef || 'refs/heads/main';
          const memberRole = options.memberRole || 'writer';

          const updates = Array.isArray(body.updates) ? body.updates : [];
          for (const update of updates) {
            const refName = String(update.refName || '').trim();
            const isDelete = Boolean(update.isDelete);
            const isCreate = update.oldOid === null || /^0+$/.test(update.oldOid || '');
            const isFastForward = update.isFastForward !== false;

            const normDefault = currentDefaultRef.startsWith('refs/') ? currentDefaultRef : `refs/heads/${currentDefaultRef}`;
            const isDefaultBranch = refName === normDefault || refName === currentDefaultRef;
            const matchingPolicy = selectRefPolicy(currentPolicies, refName);
            const isProtected = isDefaultBranch || Boolean(matchingPolicy);

            if (isProtected) {
              if (isDelete) {
                const allowDelete = matchingPolicy ? Boolean(matchingPolicy.allowDelete) : false;
                if (!allowDelete) {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    success: true,
                    allowed: false,
                    reason: `deletion of protected ref ${refName} is prohibited`
                  }));
                  return;
                }
              }
              if (!isCreate && !isDelete && !isFastForward) {
                const allowForce = matchingPolicy ? Boolean(matchingPolicy.allowForcePush) : false;
                if (!allowForce) {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    success: true,
                    allowed: false,
                    reason: `non-fast-forward update to protected ref ${refName} is prohibited`
                  }));
                  return;
                }
              }
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            allowed: true,
            defaultRef: currentDefaultRef,
            memberRole,
            refPolicies: currentPolicies
          }));
          return;
        }

        if (body.action === 'gateway-record-ref') {
          callbacks.push(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, eventId: 'evt_projection' }));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const serverPort = (server.address() as any).port;
    httpServers.push(server);

    const controlPlaneUrl = `http://127.0.0.1:${serverPort}`;
    const config = {
      reposRoot,
      controlPlaneUrl,
      gatewayToken: 'test-gateway-token-value',
      sshEnabled: true,
      sshHost: '127.0.0.1',
      sshPort: 0,
      isProduction: false
    };
    const service = new GitsmithGatewayService(config);
    expect(service.provisionRepository({ storageKey: 'repositories/repo_demo' }).success).toBe(true);
    const transport = new GitsmithSshTransport(config, service);
    transports.push(transport);
    await transport.start();
    const port = transport.getStatus().port!;
    const checkout = path.join(root, 'checkout');
    const sshCommand = `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;

    return {
      root,
      reposRoot,
      keyPath,
      callbacks,
      transport,
      port,
      checkout,
      sshCommand,
      service
    };
  }

  it('clones and pushes a real commit with registered-key authorization and projection evidence', async () => {
    const { reposRoot, callbacks, transport, port, checkout, sshCommand } = await setupTransport();
    expect(transport.getStatus()).toEqual(expect.objectContaining({ configured: true, active: true }));
    const scanned = await execFileAsync('ssh-keyscan', ['-T', '5', '-p', String(port), '127.0.0.1']);
    expect(scanned.stdout).toContain('ssh-ed25519');

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

  it('rejects deletion of the default branch with clear reason and preserves remote ref', async () => {
    const { reposRoot, checkout, sshCommand, port, callbacks } = await setupTransport();
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    fs.writeFileSync(path.join(checkout, 'README.md'), '# Protected default branch\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'README.md']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'initial commit']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:main'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    const initialRemoteOid = execFileSync('git', ['--git-dir', path.join(reposRoot, 'repositories/repo_demo'), 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
    expect(callbacks).toHaveLength(1);

    // Attempt to delete main branch
    let pushError: any = null;
    try {
      await execFileAsync('git', ['-C', checkout, 'push', 'origin', ':main'], {
        env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
      });
    } catch (err: any) {
      pushError = err;
    }

    expect(pushError).not.toBeNull();
    const output = (pushError.stderr || '') + (pushError.stdout || '') + (pushError.message || '');
    expect(output).toContain('deletion of protected ref refs/heads/main is prohibited');

    // Verify remote ref was NOT deleted on disk
    const currentRemoteOid = execFileSync('git', ['--git-dir', path.join(reposRoot, 'repositories/repo_demo'), 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
    expect(currentRemoteOid).toBe(initialRemoteOid);
    // No delete callback recorded
    expect(callbacks).toHaveLength(1);
  }, 20_000);

  it('rejects non-fast-forward updates to the default branch', async () => {
    const { reposRoot, checkout, sshCommand, port, callbacks } = await setupTransport();
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    fs.writeFileSync(path.join(checkout, 'file1.txt'), 'Commit 1\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'file1.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'c1']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:main'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    fs.writeFileSync(path.join(checkout, 'file2.txt'), 'Commit 2\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'file2.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'c2']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:main'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    const c2Oid = execFileSync('git', ['--git-dir', path.join(reposRoot, 'repositories/repo_demo'), 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
    expect(callbacks).toHaveLength(2);

    // Reset locally to C1 and make alternate commit C3
    await execFileAsync('git', ['-C', checkout, 'reset', '--hard', 'HEAD~1']);
    fs.writeFileSync(path.join(checkout, 'file3.txt'), 'Commit 3 (diverged)\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'file3.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'c3']);

    // Attempt force-push to main
    let pushError: any = null;
    try {
      await execFileAsync('git', ['-C', checkout, 'push', '--force', 'origin', 'HEAD:main'], {
        env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
      });
    } catch (err: any) {
      pushError = err;
    }

    expect(pushError).not.toBeNull();
    const output = (pushError.stderr || '') + (pushError.stdout || '') + (pushError.message || '');
    expect(output).toContain('non-fast-forward update to protected ref refs/heads/main is prohibited');

    // Verify remote ref still points to C2
    const afterOid = execFileSync('git', ['--git-dir', path.join(reposRoot, 'repositories/repo_demo'), 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
    expect(afterOid).toBe(c2Oid);
    expect(callbacks).toHaveLength(2);
  }, 20_000);

  it('allows normal fast-forward updates to a feature ref and projects them', async () => {
    const { reposRoot, checkout, sshCommand, port, callbacks } = await setupTransport();
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    fs.writeFileSync(path.join(checkout, 'feature.txt'), 'Feature work\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'feature.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'feature commit']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/feature/protect-test'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    const featureOid = execFileSync('git', ['--git-dir', path.join(reposRoot, 'repositories/repo_demo'), 'rev-parse', 'refs/heads/feature/protect-test'], { encoding: 'utf8' }).trim();
    const localOid = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(featureOid).toBe(localOid);
    expect(callbacks.some(c => c.refName === 'refs/heads/feature/protect-test' && c.newOid === localOid)).toBe(true);
  }, 20_000);

  it('fails closed when policy query throws or fails on write push', async () => {
    const { checkout, sshCommand, port } = await setupTransport({ writeAuthorizeError: true });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    fs.writeFileSync(path.join(checkout, 'write-test.txt'), 'Write test\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'write-test.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'write test']);

    let pushError: any = null;
    try {
      await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:main'], {
        env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
      });
    } catch (err: any) {
      pushError = err;
    }
    expect(pushError).not.toBeNull();
  }, 20_000);

  it('fails closed when authorization response omits refPolicies', async () => {
    const { checkout, sshCommand, port } = await setupTransport({ omitRefPolicies: true });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    fs.writeFileSync(path.join(checkout, 'omit-policy.txt'), 'Omit policy test\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'omit-policy.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'omit policy test']);

    let pushError: any = null;
    try {
      await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:main'], {
        env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
      });
    } catch (err: any) {
      pushError = err;
    }
    expect(pushError).not.toBeNull();
  }, 20_000);

  it('pre-receive hook fails closed when policy file is missing or invalid', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsmith-hook-test-'));
    tempDirs.push(root);
    const hookDir = path.join(root, '.gitsmith-hooks');
    const config = {
      reposRoot: root, controlPlaneUrl: 'http://control.test', gatewayToken: 'test-gateway-token-value',
      sshEnabled: true, sshHost: '127.0.0.1', sshPort: 0, isProduction: false
    };
    const service = new GitsmithGatewayService(config);
    const transport = new GitsmithSshTransport(config, service);
    transport.ensurePreReceiveHook();
    const hookPath = path.join(hookDir, 'pre-receive');
    expect(fs.existsSync(hookPath)).toBe(true);

    // Run hook without GITSMITH_POLICY_FILE
    let errWithoutEnv: any = null;
    try {
      execFileSync(hookPath, [], { input: '0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 refs/heads/main\n', stdio: 'pipe' });
    } catch (err: any) {
      errWithoutEnv = err;
    }
    expect(errWithoutEnv).not.toBeNull();
    expect(errWithoutEnv.stderr.toString()).toContain('rejected: policy check failed');

    // Run hook with non-existent policy file
    let errMissingFile: any = null;
    try {
      execFileSync(hookPath, [], {
        input: '0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 refs/heads/main\n',
        env: { ...process.env, GITSMITH_POLICY_FILE: '/tmp/non-existent-policy-file-12345.json' },
        stdio: 'pipe'
      });
    } catch (err: any) {
      errMissingFile = err;
    }
    expect(errMissingFile).not.toBeNull();
    expect(errMissingFile.stderr.toString()).toContain('rejected: policy check failed');

    // Run hook with policy marking error/unreachable
    const badPolicyPath = path.join(root, 'bad-policy.json');
    fs.writeFileSync(badPolicyPath, JSON.stringify({ unreachable: true, error: 'Database timeout' }));
    let errUnreachable: any = null;
    try {
      execFileSync(hookPath, [], {
        input: '0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 refs/heads/main\n',
        env: { ...process.env, GITSMITH_POLICY_FILE: badPolicyPath },
        stdio: 'pipe'
      });
    } catch (err: any) {
      errUnreachable = err;
    }
    expect(errUnreachable).not.toBeNull();
    expect(errUnreachable.stderr.toString()).toContain('rejected: policy check failed: Database timeout');

    // Run hook with policy missing refPolicies
    const missingRefPoliciesPath = path.join(root, 'missing-ref-policies.json');
    fs.writeFileSync(missingRefPoliciesPath, JSON.stringify({ defaultRef: 'refs/heads/main' }));
    let errMissingRefPolicies: any = null;
    try {
      execFileSync(hookPath, [], {
        input: '0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 refs/heads/main\n',
        env: { ...process.env, GITSMITH_POLICY_FILE: missingRefPoliciesPath },
        stdio: 'pipe'
      });
    } catch (err: any) {
      errMissingRefPolicies = err;
    }
    expect(errMissingRefPolicies).not.toBeNull();
    expect(errMissingRefPolicies.stderr.toString()).toContain('rejected: policy check failed: refPolicies data is missing or invalid');

    // Run hook with policy missing defaultRef
    const missingDefaultRefPath = path.join(root, 'missing-default-ref.json');
    fs.writeFileSync(missingDefaultRefPath, JSON.stringify({ refPolicies: [] }));
    let errMissingDefaultRef: any = null;
    try {
      execFileSync(hookPath, [], {
        input: '0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 refs/heads/main\n',
        env: { ...process.env, GITSMITH_POLICY_FILE: missingDefaultRefPath },
        stdio: 'pipe'
      });
    } catch (err: any) {
      errMissingDefaultRef = err;
    }
    expect(errMissingDefaultRef).not.toBeNull();
    expect(errMissingDefaultRef.stderr.toString()).toContain('rejected: policy check failed: defaultRef data is missing or invalid');

    // Run hook with malformed refPolicies entry
    const malformedEntryPath = path.join(root, 'malformed-entry.json');
    fs.writeFileSync(malformedEntryPath, JSON.stringify({ defaultRef: 'refs/heads/main', refPolicies: [{}] }));
    let errMalformedEntry: any = null;
    try {
      execFileSync(hookPath, [], {
        input: '0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 refs/heads/main\n',
        env: { ...process.env, GITSMITH_POLICY_FILE: malformedEntryPath },
        stdio: 'pipe'
      });
    } catch (err: any) {
      errMalformedEntry = err;
    }
    expect(errMalformedEntry).not.toBeNull();
    expect(errMalformedEntry.stderr.toString()).toContain('rejected: policy check failed: refPolicies data is missing or invalid');
  });

  it('pre-receive hook independently enforces most-specific policy in local defense-in-depth check', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsmith-hook-spec-'));
    tempDirs.push(root);
    const hookDir = path.join(root, '.gitsmith-hooks');
    const repoDir = path.join(root, 'repo.git');
    fs.mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', '--bare', repoDir]);

    // Create a commit in a temporary worktree so merge-base works
    const wtDir = path.join(root, 'wt');
    execFileSync('git', ['clone', repoDir, wtDir]);
    fs.writeFileSync(path.join(wtDir, 'file.txt'), 'init');
    execFileSync('git', ['-C', wtDir, 'add', 'file.txt']);
    execFileSync('git', ['-C', wtDir, '-c', 'user.name=N', '-c', 'user.email=n@test', 'commit', '-m', 'c1']);
    execFileSync('git', ['-C', wtDir, 'push', 'origin', 'HEAD:main']);
    const c1Oid = execFileSync('git', ['-C', wtDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(wtDir, 'file.txt'), 'c2');
    execFileSync('git', ['-C', wtDir, 'add', 'file.txt']);
    execFileSync('git', ['-C', wtDir, '-c', 'user.name=N', '-c', 'user.email=n@test', 'commit', '-m', 'c2']);
    execFileSync('git', ['-C', wtDir, 'push', 'origin', 'HEAD:release/1.0']);
    const c2Oid = execFileSync('git', ['-C', wtDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    const overlappingPolicies = [
      { refPattern: 'refs/heads/*', allowForcePush: 1, allowDelete: 1 },
      { refPattern: 'refs/heads/release/*', allowForcePush: 0, allowDelete: 0 }
    ];

    // Mock control plane server returning allowed: true to test defense-in-depth hook evaluation
    const server = http.createServer((req, res) => {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          allowed: true,
          defaultRef: 'refs/heads/main',
          refPolicies: overlappingPolicies
        }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const serverPort = (server.address() as any).port;
    httpServers.push(server);

    const config = {
      reposRoot: root, controlPlaneUrl: `http://127.0.0.1:${serverPort}`, gatewayToken: 'tok',
      sshEnabled: true, sshHost: '127.0.0.1', sshPort: 0, isProduction: false
    };
    const service = new GitsmithGatewayService(config);
    const transport = new GitsmithSshTransport(config, service);
    transport.ensurePreReceiveHook();
    const hookPath = path.join(hookDir, 'pre-receive');

    const policyFilePath = path.join(root, 'policy.json');
    fs.writeFileSync(policyFilePath, JSON.stringify({
      repositoryId: 'repo_1', actorUserId: 'usr_1', defaultRef: 'refs/heads/main',
      controlPlaneUrl: `http://127.0.0.1:${serverPort}`, gatewayToken: 'tok',
      refPolicies: overlappingPolicies
    }));

    const runHook = async (input: string) => {
      return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const cp = spawn(hookPath, [], {
          cwd: repoDir,
          env: { ...process.env, GITSMITH_POLICY_FILE: policyFilePath, GIT_DIR: repoDir },
          stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        cp.stdout.on('data', (d) => { stdout += d.toString(); });
        cp.stderr.on('data', (d) => { stderr += d.toString(); });
        cp.on('close', (code) => { resolve({ code, stdout, stderr }); });
        cp.stdin.write(input);
        cp.stdin.end();
      });
    };

    // Hook must reject deletion of release/1.0
    const delRes = await runHook(`${c2Oid} 0000000000000000000000000000000000000000 refs/heads/release/1.0\n`);
    expect(delRes.code).toBe(1);
    expect(delRes.stderr).toContain('rejected: deletion of protected ref refs/heads/release/1.0 is prohibited');

    // Hook must reject non-fast-forward update of release/1.0
    const forceRes = await runHook(`${c2Oid} ${c1Oid} refs/heads/release/1.0\n`);
    expect(forceRes.code).toBe(1);
    expect(forceRes.stderr).toContain('rejected: non-fast-forward update to protected ref refs/heads/release/1.0 is prohibited');
  });

  it('fails closed on malformed policy entry during push (empty object, missing refPattern, bad allow flags)', async () => {
    // 1. Policy with empty object [{}]
    const t1 = await setupTransport({ refPolicies: [{}] });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${t1.port}/nate/demo.git`, t1.checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: t1.sshCommand }
    });
    fs.writeFileSync(path.join(t1.checkout, 'malformed1.txt'), 'Malformed 1\n');
    await execFileAsync('git', ['-C', t1.checkout, 'add', 'malformed1.txt']);
    await execFileAsync('git', ['-C', t1.checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'm1']);

    let pushErr1: any = null;
    try {
      await execFileAsync('git', ['-C', t1.checkout, 'push', 'origin', 'HEAD:main'], {
        env: { ...process.env, GIT_SSH_COMMAND: t1.sshCommand }
      });
    } catch (err: any) {
      pushErr1 = err;
    }
    expect(pushErr1).not.toBeNull();

    // 2. Policy with empty refPattern [{ refPattern: '' }]
    const t2 = await setupTransport({ refPolicies: [{ refPattern: '' }] });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${t2.port}/nate/demo.git`, t2.checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: t2.sshCommand }
    });
    fs.writeFileSync(path.join(t2.checkout, 'malformed2.txt'), 'Malformed 2\n');
    await execFileAsync('git', ['-C', t2.checkout, 'add', 'malformed2.txt']);
    await execFileAsync('git', ['-C', t2.checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'm2']);

    let pushErr2: any = null;
    try {
      await execFileAsync('git', ['-C', t2.checkout, 'push', 'origin', 'HEAD:main'], {
        env: { ...process.env, GIT_SSH_COMMAND: t2.sshCommand }
      });
    } catch (err: any) {
      pushErr2 = err;
    }
    expect(pushErr2).not.toBeNull();

    // 3. Policy with bad allow flags [{ refPattern: 'refs/heads/*', allowForcePush: 'invalid-flag' }]
    const t3 = await setupTransport({ refPolicies: [{ refPattern: 'refs/heads/*', allowForcePush: 'invalid-flag' }] });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${t3.port}/nate/demo.git`, t3.checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: t3.sshCommand }
    });
    fs.writeFileSync(path.join(t3.checkout, 'malformed3.txt'), 'Malformed 3\n');
    await execFileAsync('git', ['-C', t3.checkout, 'add', 'malformed3.txt']);
    await execFileAsync('git', ['-C', t3.checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'm3']);

    let pushErr3: any = null;
    try {
      await execFileAsync('git', ['-C', t3.checkout, 'push', 'origin', 'HEAD:main'], {
        env: { ...process.env, GIT_SSH_COMMAND: t3.sshCommand }
      });
    } catch (err: any) {
      pushErr3 = err;
    }
    expect(pushErr3).not.toBeNull();
  }, 30_000);

  it('rejects push when ref becomes protected after auth but before pre-receive (TOCTOU prevention)', async () => {
    let currentPolicies: any[] = [];
    const { checkout, sshCommand, port } = await setupTransport({
      getRefPolicies: () => currentPolicies
    });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    // Create initial commit on custom branch feature/toctou
    fs.writeFileSync(path.join(checkout, 'toctou1.txt'), 'TOCTOU 1\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'toctou1.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'toctou1']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/feature/toctou'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Create a second commit and push
    fs.writeFileSync(path.join(checkout, 'toctou2.txt'), 'TOCTOU 2\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'toctou2.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'toctou2']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/feature/toctou'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Reset locally to commit 1 and commit a diverging commit 3
    await execFileAsync('git', ['-C', checkout, 'reset', '--hard', 'HEAD~1']);
    fs.writeFileSync(path.join(checkout, 'toctou3.txt'), 'TOCTOU 3 diverged\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'toctou3.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'toctou3']);

    // Now update policy on the control plane to protect refs/heads/feature/toctou
    currentPolicies = [
      { refPattern: 'refs/heads/feature/toctou', allowForcePush: 0, allowDelete: 0 }
    ];

    // Attempt force-push now (simulates push occurring after policy changed on control plane)
    let pushError: any = null;
    try {
      await execFileAsync('git', ['-C', checkout, 'push', '--force', 'origin', 'HEAD:refs/heads/feature/toctou'], {
        env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
      });
    } catch (err: any) {
      pushError = err;
    }
    expect(pushError).not.toBeNull();
    const output = (pushError.stderr || '') + (pushError.stdout || '') + (pushError.message || '');
    expect(output).toContain('non-fast-forward update to protected ref refs/heads/feature/toctou is prohibited');
  }, 20_000);

  it('fails closed when gateway-check-ref-policy is unreachable at pre-receive time', async () => {
    const { checkout, sshCommand, port } = await setupTransport({ checkPolicyError: true });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    fs.writeFileSync(path.join(checkout, 'unreachable.txt'), 'Unreachable test\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'unreachable.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'unreachable test']);

    let pushError: any = null;
    try {
      await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:main'], {
        env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
      });
    } catch (err: any) {
      pushError = err;
    }
    expect(pushError).not.toBeNull();
    const output = (pushError.stderr || '') + (pushError.stdout || '') + (pushError.message || '');
    expect(output).toContain('rejected: policy check failed');
  }, 20_000);

  it('allows normal fast-forward push to writable non-protected ref when policy is complete and current', async () => {
    const { checkout, sshCommand, port, callbacks } = await setupTransport({
      refPolicies: [
        { refPattern: 'refs/heads/release/*', allowForcePush: 0, allowDelete: 0 }
      ]
    });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    fs.writeFileSync(path.join(checkout, 'feature-ff.txt'), 'Fast forward feature\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'feature-ff.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'ff commit']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/feature/valid-ff'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    const localOid = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(callbacks.some(c => c.refName === 'refs/heads/feature/valid-ff' && c.newOid === localOid)).toBe(true);
  }, 20_000);

  it('enforces custom protected ref patterns from refPolicies', async () => {
    const { checkout, sshCommand, port } = await setupTransport({
      refPolicies: [
        { refPattern: 'refs/heads/release/*', allowForcePush: 0, allowDelete: 0 }
      ]
    });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });
    fs.writeFileSync(path.join(checkout, 'rel1.txt'), 'Release 1.0\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'rel1.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'rel1']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/release/v1.0'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Attempt to delete release branch
    let deleteError: any = null;
    try {
      await execFileAsync('git', ['-C', checkout, 'push', 'origin', ':refs/heads/release/v1.0'], {
        env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
      });
    } catch (err: any) {
      deleteError = err;
    }
    expect(deleteError).not.toBeNull();
    const output = (deleteError.stderr || '') + (deleteError.stdout || '') + (deleteError.message || '');
    expect(output).toContain('deletion of protected ref refs/heads/release/v1.0 is prohibited');
  }, 20_000);

  it('enforces most specific overlapping policy: broad allow + specific deny rejects force-push regardless of D1 row order', async () => {
    // Ordering 1: broad permissive first, specific restrictive second (simulates arbitrary D1 row order)
    const { checkout, sshCommand, port } = await setupTransport({
      refPolicies: [
        { refPattern: 'refs/heads/*', allowForcePush: 1, allowDelete: 1 },
        { refPattern: 'refs/heads/release/*', allowForcePush: 0, allowDelete: 0 }
      ]
    });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Push initial commit to release/1.0
    fs.writeFileSync(path.join(checkout, 'r1.txt'), 'Release 1.0 initial\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'r1.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'r1 initial']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/release/1.0'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Create a second commit
    fs.writeFileSync(path.join(checkout, 'r2.txt'), 'Release 1.0 second\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'r2.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'r2 second']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/release/1.0'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Reset locally and create diverged commit
    await execFileAsync('git', ['-C', checkout, 'reset', '--hard', 'HEAD~1']);
    fs.writeFileSync(path.join(checkout, 'r3.txt'), 'Release 1.0 diverged\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'r3.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'r3 diverged']);

    // Attempt force push to release/1.0: MUST be rejected by most-specific policy
    let forcePushError: any = null;
    try {
      await execFileAsync('git', ['-C', checkout, 'push', '--force', 'origin', 'HEAD:refs/heads/release/1.0'], {
        env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
      });
    } catch (err: any) {
      forcePushError = err;
    }
    expect(forcePushError).not.toBeNull();
    const fpOutput = (forcePushError.stderr || '') + (forcePushError.stdout || '') + (forcePushError.message || '');
    expect(fpOutput).toContain('non-fast-forward update to protected ref refs/heads/release/1.0 is prohibited');
  }, 25_000);

  it('enforces most specific overlapping policy: broad allow + specific deny rejects branch deletion regardless of D1 row order', async () => {
    // Ordering: broad allow first, specific deny second
    const { checkout, sshCommand, port } = await setupTransport({
      refPolicies: [
        { refPattern: 'refs/heads/*', allowForcePush: 1, allowDelete: 1 },
        { refPattern: 'refs/heads/release/*', allowForcePush: 0, allowDelete: 0 }
      ]
    });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Push initial commit to release/1.0
    fs.writeFileSync(path.join(checkout, 'r1.txt'), 'Release 1.0\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'r1.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'r1']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/release/1.0'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Attempt deletion of release/1.0: MUST be rejected
    let deleteError: any = null;
    try {
      await execFileAsync('git', ['-C', checkout, 'push', 'origin', ':refs/heads/release/1.0'], {
        env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
      });
    } catch (err: any) {
      deleteError = err;
    }
    expect(deleteError).not.toBeNull();
    const delOutput = (deleteError.stderr || '') + (deleteError.stdout || '') + (deleteError.message || '');
    expect(delOutput).toContain('deletion of protected ref refs/heads/release/1.0 is prohibited');
  }, 25_000);

  it('honors non-overlapping single policy and broad permissive policy on non-protected refs', async () => {
    const { checkout, sshCommand, port, callbacks } = await setupTransport({
      refPolicies: [
        { refPattern: 'refs/heads/*', allowForcePush: 1, allowDelete: 1 },
        { refPattern: 'refs/heads/release/*', allowForcePush: 0, allowDelete: 0 }
      ]
    });
    await execFileAsync('git', ['clone', `ssh://git@127.0.0.1:${port}/nate/demo.git`, checkout], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Normal push to feature/unprotected
    fs.writeFileSync(path.join(checkout, 'feat.txt'), 'Feature\n');
    await execFileAsync('git', ['-C', checkout, 'add', 'feat.txt']);
    await execFileAsync('git', ['-C', checkout, '-c', 'user.name=Nate', '-c', 'user.email=nate@example.test', 'commit', '-m', 'feat 1']);
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', 'HEAD:refs/heads/feature/unprotected'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    // Delete feature/unprotected (should succeed because broad policy allows delete)
    await execFileAsync('git', ['-C', checkout, 'push', 'origin', ':refs/heads/feature/unprotected'], {
      env: { ...process.env, GIT_SSH_COMMAND: sshCommand }
    });

    expect(callbacks.some(c => c.refName === 'refs/heads/feature/unprotected' && c.operation === 'delete')).toBe(true);
  }, 25_000);
});

