import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RigInstance } from '../rigDomain.ts';
import { validateRigSpec } from '../rigDomain.ts';

export interface RigInstanceStateStore {
  load(): Promise<RigInstance[]>;
  save(instances: readonly RigInstance[]): Promise<void>;
}

export function validateRigStatePath(path: string, productionEnabled: boolean): string {
  const clean = path.trim();
  if (!clean) throw new Error('RIG_STATE_PATH is required.');
  if (productionEnabled && !isAbsolute(clean)) throw new Error('Production RIG_STATE_PATH must be absolute.');
  const absolute = resolve(clean);
  if (productionEnabled && (absolute === '/tmp' || absolute.startsWith('/tmp/') || absolute === '/private/tmp' || absolute.startsWith('/private/tmp/'))) {
    throw new Error('Production RIG_STATE_PATH must use durable storage, not a temporary directory.');
  }
  return absolute;
}

export class JsonRigInstanceStateStore implements RigInstanceStateStore {
  readonly path: string;

  constructor(path: string, productionEnabled = false) {
    this.path = validateRigStatePath(path, productionEnabled);
  }

  async load(): Promise<RigInstance[]> {
    let raw: string;
    try { raw = await readFile(this.path, 'utf8'); }
    catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const document = JSON.parse(raw);
    if (document?.schemaVersion !== 1 || !Array.isArray(document.instances)) {
      throw new Error('RIG state registry has an unsupported or corrupt schema.');
    }
    return document.instances.map((instance: any) => {
      const validation = validateRigSpec(instance?.spec);
      if (!validation.valid) throw new Error(`RIG state registry contains an invalid spec: ${validation.errors.join('; ')}`);
      if (!instance?.observed || !Array.isArray(instance.observed.events)) throw new Error('RIG state registry contains invalid observed state.');
      return { spec: validation.data, observed: instance.observed } as RigInstance;
    });
  }

  async save(instances: readonly RigInstance[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const payload = JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), instances }, null, 2);
    await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, this.path);
  }
}
