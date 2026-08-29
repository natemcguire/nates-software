// Local/Dev HTTP Gateway Server for GITSMITH
// Serves /healthz, /readyz, authoritative CAS ref endpoint, and dispatcher controls.

import * as http from 'node:http';
import type { GatewayConfig } from './types.ts';
import { GitsmithGatewayService } from './gatewayService.ts';
import { ForgeOutboxDispatcher } from './outboxDispatcher.ts';
import { GatewayHealthChecker } from './health.ts';
import { constantTimeTokenCompare } from '../forgeDomain.ts';
import { archiveAuthoritativeCommit } from './gitStorage.ts';

export interface CreateServerOptions {
  service?: GitsmithGatewayService;
  dispatcher?: ForgeOutboxDispatcher;
  healthChecker?: GatewayHealthChecker;
}

export function createGatewayServer(config: GatewayConfig, options?: CreateServerOptions): http.Server {
  const service = options?.service || new GitsmithGatewayService(config);
  const dispatcher = options?.dispatcher || new ForgeOutboxDispatcher(config);
  const healthChecker = options?.healthChecker || new GatewayHealthChecker();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // 1. GET /healthz - Liveness probe
    if (req.method === 'GET' && url.pathname === '/healthz') {
      const health = healthChecker.getHealth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }

    // 2. GET /readyz - Readiness probe
    if (req.method === 'GET' && url.pathname === '/readyz') {
      const readiness = await healthChecker.getReadiness(config, dispatcher, true);
      const status = readiness.ready ? 200 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readiness));
      return;
    }

    // 3. Helper to read JSON request body
    const readJsonBody = async (): Promise<any> => {
      return new Promise((resolve, reject) => {
        let raw = '';
        let received = 0;
        req.on('data', chunk => {
          received += chunk.length;
          if (received > 64 * 1024) {
            reject(new Error('Request body exceeds 64 KiB limit.'));
            req.destroy();
            return;
          }
          raw += chunk;
        });
        req.on('end', () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch (e) {
            reject(e);
          }
        });
        req.on('error', reject);
      });
    };

    // 4. Authenticate gateway operations
    const verifyToken = (): boolean => {
      const authHeader = req.headers['authorization'] || '';
      const customHeader = req.headers['x-gitsmith-gateway-token'] || '';
      let token = '';
      if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
        token = authHeader.substring(7).trim();
      } else if (typeof customHeader === 'string') {
        token = customHeader.trim();
      }
      return constantTimeTokenCompare(token, config.gatewayToken);
    };

    // Authenticated immutable source export for the RIG verification worker.
    if (req.method === 'GET' && url.pathname === '/api/gateway/archive') {
      if (!verifyToken()) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized: Valid gateway token required.' }));
        return;
      }
      const storageKey = String(url.searchParams.get('storageKey') || '').trim();
      const commitOid = String(url.searchParams.get('commitOid') || '').trim();
      try {
        const archive = archiveAuthoritativeCommit(config.reposRoot, storageKey, commitOid);
        res.writeHead(200, {
          'Content-Type': 'application/x-tar',
          'Content-Length': archive.length,
          'Cache-Control': 'private, no-store',
          'X-Gitsmith-Commit-Oid': commitOid
        });
        res.end(archive);
      } catch (error: any) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: error?.message || 'Commit archive not found.' }));
      }
      return;
    }

    // 5. POST /api/gateway/cas - Authoritative CAS ref update
    if (req.method === 'POST' && url.pathname === '/api/gateway/cas') {
      if (!verifyToken()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized: Valid gateway token required.' }));
        return;
      }

      try {
        const body = await readJsonBody();
        const result = await service.updateAuthoritativeRef(body);
        const status = result.success ? 200 : (result.stale ? 409 : 400);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // 6. POST /api/gateway/dispatch - Trigger outbox dispatch batch
    if (req.method === 'POST' && url.pathname === '/api/gateway/dispatch') {
      if (!verifyToken()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized: Valid gateway token required.' }));
        return;
      }

      try {
        const batchRes = await dispatcher.dispatchBatch(20);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...batchRes }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // 404 fallback
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not found' }));
  });

  return server;
}
