import type { RigInstance, RigSpec } from './rigDomain';

export type RigControlAction = 'create' | 'list' | 'inspect' | 'stop' | 'restart' | 'delete' | 'logs';

export interface RigControlPayload {
  action: RigControlAction;
  instanceId?: string;
  spec?: RigSpec;
  tailLines?: number;
}

export async function requestRigControl<T>(
  payload: RigControlPayload,
  fetcher: typeof fetch = fetch
): Promise<T> {
  const response = await fetcher('/api/rig', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error(body?.error || `RIG control request failed (${response.status}).`);
  }
  return body.result as T;
}

export const listRigInstances = (fetcher?: typeof fetch) =>
  requestRigControl<RigInstance[]>({ action: 'list' }, fetcher);

export const createRigInstance = (spec: RigSpec, fetcher?: typeof fetch) =>
  requestRigControl<RigInstance>({ action: 'create', spec }, fetcher);

export const mutateRigInstance = (
  action: 'stop' | 'restart',
  instanceId: string,
  fetcher?: typeof fetch
) => requestRigControl<RigInstance>({ action, instanceId }, fetcher);

export const deleteRigInstance = (instanceId: string, fetcher?: typeof fetch) =>
  requestRigControl<boolean>({ action: 'delete', instanceId }, fetcher);

export const getRigInstanceLogs = (instanceId: string, tailLines = 200, fetcher?: typeof fetch) =>
  requestRigControl<string>({ action: 'logs', instanceId, tailLines }, fetcher);
