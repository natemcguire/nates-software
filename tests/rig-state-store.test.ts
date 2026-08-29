import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonRigInstanceStateStore, validateRigStatePath } from '../src/lib/rig/stateStore';
import type { RigInstance } from '../src/lib/rigDomain';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

const instance: RigInstance = {
  spec: {
    id: 'rig-recovery-1', appId: 'recovery', name: 'Recovery', ownerId: 'usr_nate',
    runtime: {
      adapter: 'docker', startCommand: 'node server.js', networkPolicy: 'none',
      imageDigest: `registry.example/recovery@sha256:${'a'.repeat(64)}`
    },
    resources: { memoryCapMb: 256, cpuCores: 1 }, ttlSeconds: 900,
    source: 'provider', createdAt: '2026-08-29T20:00:00.000Z'
  },
  observed: {
    lifecycle: 'healthy', allocatedPort: 3001, memoryMb: 0,
    expiresAt: '2026-08-29T20:15:00.000Z', events: []
  }
};

describe('RIG durable gateway registry', () => {
  it('atomically round-trips validated instance state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rig-state-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'instances.json');
    const store = new JsonRigInstanceStateStore(path);
    await store.save([instance]);
    await expect(store.load()).resolves.toEqual([instance]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ schemaVersion: 1 });
  });

  it('rejects corrupt state instead of starting with an invented empty fleet', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rig-state-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'instances.json');
    await writeFile(path, '{"schemaVersion":99,"instances":[]}');
    await expect(new JsonRigInstanceStateStore(path).load()).rejects.toThrow('unsupported or corrupt');
  });

  it('requires an absolute durable production path outside temporary storage', () => {
    expect(() => validateRigStatePath('relative/state.json', true)).toThrow('must be absolute');
    expect(() => validateRigStatePath('/tmp/rig/state.json', true)).toThrow('durable storage');
    expect(validateRigStatePath('/data/rig/instances.json', true)).toBe('/data/rig/instances.json');
  });
});
