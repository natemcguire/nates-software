import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  RigDockerControlApi,
  type RigControlApiOptions
} from '../rigDockerProvider.ts';
import type { RigOwnerIdentity } from '../rigDomain.ts';
import type { RigInstanceStateStore } from './stateStore.ts';
import { validateRigStatePath } from './stateStore.ts';

export interface RigGatewayConfig {
  port: number;
  host: string;
  serviceSecret: string;
  productionEnabled: boolean;
  statePath: string;
}

export function loadRigGatewayConfig(env: NodeJS.ProcessEnv = process.env): RigGatewayConfig {
  return {
    port: Number.parseInt(env.PORT || env.RIG_PORT || '8790', 10),
    host: env.HOST || '0.0.0.0',
    serviceSecret: env.RIG_GATEWAY_SERVICE_SECRET || '',
    productionEnabled: env.RIG_PRODUCTION_ENABLED === 'true' || env.NODE_ENV === 'production',
    statePath: env.RIG_STATE_PATH || './.rig-state/instances.json'
  };
}

export function validateRigGatewayConfig(config: RigGatewayConfig): void {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('RIG gateway port is invalid.');
  if (config.productionEnabled && config.serviceSecret.length < 32) {
    throw new Error('Production RIG gateway requires RIG_GATEWAY_SERVICE_SECRET of at least 32 characters.');
  }
  validateRigStatePath(config.statePath, config.productionEnabled);
}

function tokenMatches(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('Request body exceeds 64 KiB.'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function ownerFromHeaders(req: IncomingMessage): RigOwnerIdentity | null {
  const ownerId = String(req.headers['x-rig-owner-id'] || '').trim();
  if (!ownerId) return null;
  const roleHeader = String(req.headers['x-rig-owner-role'] || 'owner');
  return {
    ownerId,
    username: String(req.headers['x-rig-owner-username'] || '').trim() || undefined,
    role: roleHeader === 'admin' ? 'admin' : 'owner'
  };
}

export function createRigGatewayServer(
  config: RigGatewayConfig,
  options?: RigControlApiOptions & { api?: RigDockerControlApi; stateStore?: RigInstanceStateStore }
): Server {
  validateRigGatewayConfig(config);
  const api = options?.api || new RigDockerControlApi(options);

  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      send(res, 200, { success: true, service: 'RIG provider gateway', uptimeSeconds: process.uptime() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/capabilities') {
      const preflight = await api.getPreflight();
      const ready = preflight.available === true && preflight.daemonReachable === true;
      send(res, ready ? 200 : 503, {
        apiVersion: 1,
        provider: 'docker',
        liveContainers: ready,
        ephemeralCleanup: true,
        authRequired: true,
        limits: { maxMemoryMb: 256, maxTtlSeconds: 3600, maxInstancesPerOwner: 3, portRange: [3001, 3010] },
        isolation: { nonRoot: true, readOnlyRootfs: true, noDockerSocketMount: true, capDropAll: true },
        preflight
      });
      return;
    }

    const match = req.method === 'POST' ? url.pathname.match(/^\/v1\/instances\/(create|list|inspect|stop|restart|delete|logs)$/) : null;
    if (!match) {
      send(res, 404, { success: false, error: 'Not found' });
      return;
    }

    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!tokenMatches(bearer, config.serviceSecret)) {
      send(res, 401, { success: false, error: 'Unauthorized RIG control-plane caller.' });
      return;
    }
    const owner = ownerFromHeaders(req);
    if (!owner) {
      send(res, 400, { success: false, error: 'Authenticated owner identity headers are required.' });
      return;
    }

    try {
      const body = await readJson(req);
      const action = match[1];
      let result: unknown;
      if (action === 'create') result = await api.createInstance(owner, body.spec || body.params || body);
      else if (action === 'list') result = await api.listInstances(owner);
      else if (action === 'inspect') result = await api.getInstance(owner, String(body.instanceId || ''));
      else if (action === 'stop') result = await api.stopInstance(owner, String(body.instanceId || ''));
      else if (action === 'restart') result = await api.restartInstance(owner, String(body.instanceId || ''));
      else if (action === 'delete') result = await api.deleteInstance(owner, String(body.instanceId || ''));
      else result = await api.getLogs(owner, String(body.instanceId || ''), Number(body.tailLines || 200));
      if (options?.stateStore && ['create', 'stop', 'restart', 'delete'].includes(action)) {
        try {
          await options.stateStore.save(api.exportInstances());
        } catch (persistError) {
          let rollbackError: unknown;
          if (action === 'create' && result && typeof result === 'object' && 'spec' in result) {
            try { await api.deleteInstance(owner, (result as any).spec.id); } catch (error) { rollbackError = error; }
          }
          const failure = new Error(rollbackError
            ? `RIG registry persistence failed and created-container rollback also failed: ${(rollbackError as any)?.message || 'unknown rollback error'}`
            : `RIG registry persistence failed: ${(persistError as any)?.message || 'unknown persistence error'}`);
          failure.name = 'RigStatePersistenceError';
          throw failure;
        }
      }
      send(res, 200, { success: true, result });
    } catch (error: any) {
      const name = error?.name || '';
      const status = name === 'RigAuthenticationError' ? 401
        : name === 'RigAuthorizationError' ? 403
          : name === 'RigQuotaExceededError' ? 429
            : name === 'RigPreflightError' ? 503
              : name === 'RigStatePersistenceError' ? 503
              : name === 'RigSecurityViolationError' ? 400 : 400;
      send(res, status, { success: false, error: error?.message || 'RIG operation failed.' });
    }
  });
}
