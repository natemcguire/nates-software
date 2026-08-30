import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { BoundedDockerProvider, MockDockerCommandRunner, RigDockerControlApi } from '../src/lib/rigDockerProvider';
import { createRigGatewayServer, validateRigGatewayConfig } from '../src/lib/rig/server';

const servers: ReturnType<typeof createRigGatewayServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))));

async function start(daemonReady = true, customDeployExecutor?: (params: any) => Promise<any>) {
  const runner = new MockDockerCommandRunner();
  runner.setHandler('version', () => daemonReady
    ? { stdout: JSON.stringify({ Client: { Version: '29.4.0' }, Server: { Version: '29.4.0' } }), stderr: '', exitCode: 0 }
    : { stdout: '', stderr: 'daemon unavailable', exitCode: 1 });
  const api = new RigDockerControlApi({ dockerProvider: new BoundedDockerProvider({ runner }) });
  const server = createRigGatewayServer({
    port: 8790,
    host: '127.0.0.1',
    serviceSecret: 's'.repeat(32),
    productionEnabled: true,
    statePath: '/data/rig/instances.json',
    maxInstancesPerOwner: 2,
    maxTotalInstances: 3
  }, { api, deployExecutor: customDeployExecutor });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('RIG Docker provider gateway server', () => {
  it('fails production startup without a strong service secret', () => {
    expect(() => validateRigGatewayConfig({
      port: 8790,
      host: '0.0.0.0',
      serviceSecret: 'short',
      productionEnabled: true,
      statePath: '/data/rig/instances.json',
      maxInstancesPerOwner: 2,
      maxTotalInstances: 3
    })).toThrow('at least 32');
    expect(() => validateRigGatewayConfig({
      port: 8790,
      host: '0.0.0.0',
      serviceSecret: 's'.repeat(32),
      productionEnabled: true,
      statePath: '/data/rig/instances.json',
      maxInstancesPerOwner: 4,
      maxTotalInstances: 3
    })).toThrow('cannot exceed');
  });

  it('publishes capability proof only while the Docker daemon is reachable', async () => {
    const readyBase = await start(true);
    const ready = await fetch(`${readyBase}/capabilities`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      apiVersion: 1,
      provider: 'docker',
      liveContainers: true,
      ephemeralCleanup: true,
      limits: { maxInstancesPerOwner: 2, maxTotalInstances: 3 }
    });

    const downBase = await start(false);
    const down = await fetch(`${downBase}/capabilities`);
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ liveContainers: false });
  });

  it('requires both the service token and propagated owner identity', async () => {
    const base = await start(true);
    const unauthorized = await fetch(`${base}/v1/instances/list`, { method: 'POST', body: '{}' });
    expect(unauthorized.status).toBe(401);

    const missingOwner = await fetch(`${base}/v1/instances/list`, {
      method: 'POST', headers: { Authorization: `Bearer ${'s'.repeat(32)}`, 'Content-Type': 'application/json' }, body: '{}'
    });
    expect(missingOwner.status).toBe(400);

    const listed = await fetch(`${base}/v1/instances/list`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'s'.repeat(32)}`, 'Content-Type': 'application/json', 'X-Rig-Owner-Id': 'usr_nate' },
      body: '{}'
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ success: true, result: [] });
  });

  it('handles /v1/build requests with service secret authorization', async () => {
    const base = await start(true);
    const unauthorized = await fetch(`${base}/v1/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'app1' })
    });
    expect(unauthorized.status).toBe(401);

    const missingFields = await fetch(`${base}/v1/build`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'s'.repeat(32)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'app1' })
    });
    expect(missingFields.status).toBe(400);
  });

  it('handles /v1/build requests with large source archives (>64 KiB) and executes build', async () => {
    // Generate a payload significantly larger than the previous 64 KiB limit (e.g., 256 KiB)
    const largeBuffer = Buffer.alloc(256 * 1024, 'x');
    const largeBase64 = largeBuffer.toString('base64');

    let executedParams: any = null;
    const mockExecutor = async (params: any) => {
      executedParams = params;
      return {
        success: true,
        exitCode: 0,
        output: 'Build completed successfully.',
        artifactDigest: 'sha256:build_digest_123',
        artifactKind: 'static',
        staticFiles: [
          {
            path: 'index.html',
            contentBase64: Buffer.from('<h1>Drone Hunter</h1>').toString('base64'),
            mediaType: 'text/html; charset=utf-8',
            sizeBytes: 21,
            sha256: 'sha256:index_hash'
          }
        ],
        smokeCheck: {
          passed: true,
          statusCode: 200,
          durationMs: 12,
          responseSnippet: '<h1>Drone Hunter</h1>'
        },
        durationMs: 45
      };
    };

    const base = await start(true, mockExecutor);
    const res = await fetch(`${base}/v1/build`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${'s'.repeat(32)}`,
        'Content-Type': 'application/json',
        'X-Rig-Owner-Id': 'usr_nate'
      },
      body: JSON.stringify({
        appId: 'dronehunter',
        repositoryId: 'repo_dronehunter',
        commitOid: '5cdee6f000000000000000000000000000000000',
        plan: {
          detectedType: 'static',
          startCommand: 'static-pages-runtime',
          port: 80,
          healthEndpoint: '/',
          memoryMb: 128,
          entrypointFile: 'index.html',
          manifestApplied: false,
          inferredFrom: ['index.html']
        },
        sourceArchiveBase64: largeBase64
      })
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.result.artifactKind).toBe('static');
    expect(data.result.smokeCheck.passed).toBe(true);
    expect(executedParams).toBeDefined();
    expect(executedParams.appId).toBe('dronehunter');
    expect(executedParams.sourceArchive.length).toBe(largeBuffer.length);
  });
});
