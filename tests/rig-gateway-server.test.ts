import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { BoundedDockerProvider, MockDockerCommandRunner, RigDockerControlApi } from '../src/lib/rigDockerProvider';
import { createRigGatewayServer, validateRigGatewayConfig } from '../src/lib/rig/server';

const servers: ReturnType<typeof createRigGatewayServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))));

async function start(daemonReady = true) {
  const runner = new MockDockerCommandRunner();
  runner.setHandler('version', () => daemonReady
    ? { stdout: JSON.stringify({ Client: { Version: '29.4.0' }, Server: { Version: '29.4.0' } }), stderr: '', exitCode: 0 }
    : { stdout: '', stderr: 'daemon unavailable', exitCode: 1 });
  const api = new RigDockerControlApi({ dockerProvider: new BoundedDockerProvider({ runner }) });
  const server = createRigGatewayServer({ port: 8790, host: '127.0.0.1', serviceSecret: 's'.repeat(32), productionEnabled: true }, { api });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('RIG Docker provider gateway server', () => {
  it('fails production startup without a strong service secret', () => {
    expect(() => validateRigGatewayConfig({ port: 8790, host: '0.0.0.0', serviceSecret: 'short', productionEnabled: true })).toThrow('at least 32');
  });

  it('publishes capability proof only while the Docker daemon is reachable', async () => {
    const readyBase = await start(true);
    const ready = await fetch(`${readyBase}/capabilities`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ apiVersion: 1, provider: 'docker', liveContainers: true, ephemeralCleanup: true });

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
});
