import * as http from 'node:http';
import type { GatewayConfig } from './types.ts';
import { GitsmithGatewayService } from './gatewayService.ts';
import { ForgeOutboxDispatcher } from './outboxDispatcher.ts';
import { GatewayHealthChecker } from './health.ts';
import { constantTimeTokenCompare, validateRepoFilePath, getMaxFileSizeBytes, isValidGitOid } from '../forgeDomain.ts';
import { archiveAuthoritativeCommit, getProposalDiff, hasGitObject, inspectCommitTree, readCommitFileBase64, readCommitFileBuffer } from './gitStorage.ts';

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

    if (req.method === 'GET' && url.pathname === '/healthz') {
      const health = healthChecker.getHealth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/readyz') {
      const readiness = await healthChecker.getReadiness(config, dispatcher, true);
      const status = readiness.ready ? 200 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readiness));
      return;
    }

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

    if (req.method === 'POST' && url.pathname === '/api/gateway/object-presence') {
      if (!verifyToken()) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized: Valid gateway token required.' }));
        return;
      }
      try {
        const body = await readJsonBody();
        const storageKey = typeof body?.storageKey === 'string' ? body.storageKey.trim() : '';
        const commitOids = Array.isArray(body?.commitOids) ? body.commitOids : [];
        if (!storageKey || commitOids.length === 0 || commitOids.length > 512 || commitOids.some((oid: unknown) => typeof oid !== 'string' || !isValidGitOid(oid))) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ success: false, error: 'storageKey and 1 to 512 valid commitOids are required.' }));
          return;
        }
        const matchedCommitOid = commitOids.find((oid: string) => hasGitObject(config.reposRoot, storageKey, oid)) || null;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
        res.end(JSON.stringify({ success: true, matchedCommitOid }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON request body.' }));
      }
      return;
    }

    if ((req.method === 'GET' || req.method === 'POST') && (url.pathname === '/api/gateway/archive' || url.pathname === '/v1/archive')) {
      if (!verifyToken()) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized: Valid gateway token required.' }));
        return;
      }
      let storageKey = String(url.searchParams.get('storageKey') || '').trim();
      let commitOid = String(url.searchParams.get('commitOid') || '').trim();
      if (req.method === 'POST' && (!storageKey || !commitOid)) {
        try {
          const body = await readJsonBody();
          if (body?.storageKey) storageKey = String(body.storageKey).trim();
          if (body?.commitOid) commitOid = String(body.commitOid).trim();
        } catch {}
      }
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

    if (
      (req.method === 'POST' || req.method === 'GET') &&
      (url.pathname === '/api/gateway/verify-commit' || url.pathname === '/v1/verify-commit' || url.pathname === '/api/gateway/tree' || url.pathname === '/v1/tree')
    ) {
      if (!verifyToken()) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized: Valid gateway token required.' }));
        return;
      }

      let storageKey = '';
      let commitOid = '';
      let manifestCandidates: string[] | undefined;

      if (req.method === 'GET') {
        storageKey = String(url.searchParams.get('storageKey') || '').trim();
        commitOid = String(url.searchParams.get('commitOid') || '').trim();
        const manifestsQuery = url.searchParams.get('manifests') || url.searchParams.get('manifestCandidates');
        if (manifestsQuery) {
          manifestCandidates = manifestsQuery.split(',').map(s => s.trim()).filter(Boolean);
        }
      } else {
        try {
          const body = await readJsonBody();
          storageKey = String(body?.storageKey || '').trim();
          commitOid = String(body?.commitOid || '').trim();
          if (Array.isArray(body?.manifestCandidates)) {
            manifestCandidates = body.manifestCandidates.map((s: any) => String(s).trim()).filter(Boolean);
          }
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON request body.' }));
          return;
        }
      }

      if (!storageKey || !commitOid) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: 'storageKey and commitOid are required.' }));
        return;
      }

      try {
        const result = inspectCommitTree(config.reposRoot, storageKey, commitOid, manifestCandidates);
        const statusCode = result.success && result.exists ? 200 : 404;
        res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to inspect commit tree.' }));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/gateway/diff') {
      if (!verifyToken()) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized: Valid gateway token required.' }));
        return;
      }
      const storageKey = String(url.searchParams.get('storageKey') || '').trim();
      const base = String(url.searchParams.get('base') || url.searchParams.get('baseOid') || '').trim();
      const head = String(url.searchParams.get('head') || url.searchParams.get('headOid') || '').trim();
      try {
        const diffRes = getProposalDiff(config.reposRoot, storageKey, base, head);
        res.writeHead(diffRes.success ? 200 : 404, {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store'
        });
        res.end(JSON.stringify(diffRes));
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: error?.message || 'Diff computation failed.' }));
      }
      return;
    }

    if (
      (req.method === 'GET' || req.method === 'POST') &&
      (url.pathname === '/api/gateway/blob' || url.pathname === '/v1/blob' || url.pathname === '/api/gateway/raw' || url.pathname === '/v1/raw')
    ) {
      if (!verifyToken()) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized: Valid gateway token required.' }));
        return;
      }

      let storageKey = String(url.searchParams.get('storageKey') || '').trim();
      let commitOid = String(url.searchParams.get('commitOid') || '').trim();
      let filePath = String(url.searchParams.get('path') || url.searchParams.get('filePath') || '').trim();

      if (req.method === 'POST' && (!storageKey || !commitOid || !filePath)) {
        try {
          const body = await readJsonBody();
          if (body?.storageKey) storageKey = String(body.storageKey).trim();
          if (body?.commitOid) commitOid = String(body.commitOid).trim();
          if (body?.path || body?.filePath) filePath = String(body.path || body.filePath).trim();
        } catch {}
      }

      if (!storageKey || !commitOid || !filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: 'storageKey, commitOid, and path are required.' }));
        return;
      }

      const pathVal = validateRepoFilePath(filePath);
      if (!pathVal.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: pathVal.error || 'Invalid file path.' }));
        return;
      }

      try {
        const maxLimit = getMaxFileSizeBytes(filePath);
        if (url.pathname === '/api/gateway/raw' || url.pathname === '/v1/raw') {
          const buf = readCommitFileBuffer(config.reposRoot, storageKey, commitOid, filePath, maxLimit);
          if (!buf) {
            res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ success: false, error: `File '${filePath}' not found in commit ${commitOid.slice(0, 8)}.` }));
            return;
          }
          const ext = filePath.includes('.') ? '.' + filePath.split('.').pop()!.toLowerCase() : '';
          const contentType = ext === '.png' ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : ext === '.gif' ? 'image/gif'
            : ext === '.svg' ? 'image/svg+xml'
            : ext === '.webp' ? 'image/webp'
            : ext === '.ico' ? 'image/x-icon'
            : ext === '.avif' ? 'image/avif'
            : ext === '.bmp' ? 'image/bmp'
            : ext === '.md' || ext === '.markdown' ? 'text/markdown; charset=utf-8'
            : ext === '.html' || ext === '.htm' ? 'text/html; charset=utf-8'
            : ext === '.css' ? 'text/css; charset=utf-8'
            : ext === '.js' || ext === '.mjs' || ext === '.ts' ? 'text/javascript; charset=utf-8'
            : ext === '.txt' ? 'text/plain; charset=utf-8'
            : ext === '.json' ? 'application/json; charset=utf-8'
            : 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': buf.length,
            'Cache-Control': 'private, no-store',
            'X-Gitsmith-Commit-Oid': commitOid
          });
          res.end(buf);
        } else {
          const base64 = readCommitFileBase64(config.reposRoot, storageKey, commitOid, filePath, maxLimit);
          if (base64 === null) {
            res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ success: false, error: `File '${filePath}' not found in commit ${commitOid.slice(0, 8)}.` }));
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-store'
          });
          res.end(JSON.stringify({
            success: true,
            storageKey,
            commitOid,
            path: filePath,
            base64
          }));
        }
      } catch (err: any) {
        if (err?.code === 'ERR_FILE_TOO_LARGE') {
          res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ success: false, error: 'File size exceeds maximum allowed limit.' }));
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to read commit file.' }));
      }
      return;
    }

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

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not found' }));
  });

  return server;
}
