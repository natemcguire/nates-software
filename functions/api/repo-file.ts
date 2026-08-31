// Public proxy Pages Function for retrieving committed repository files (e.g. spec.md, screenshots, business.md)
// Authoritative Git storage is token-gated on the GITSMITH gateway; this endpoint securely proxies
// reads for PUBLIC repositories only, fail-closed against path traversal and private repo access.
// Bound to the public default_ref tip only; no historical OID parameter accepted.

import {
  isValidGitOid,
  validateRepoFilePath,
  getMaxFileSizeBytes
} from '../../src/lib/forgeDomain';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8'
};

function getMimeType(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot !== -1) {
    const ext = filePath.slice(lastDot).toLowerCase();
    if (MIME_TYPES[ext]) {
      return MIME_TYPES[ext];
    }
  }
  return 'application/octet-stream';
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function sanitizeLogMessage(msg: unknown, sensitiveTokens: (string | undefined | null)[] = []): string {
  let str = typeof msg === 'string' ? msg : (msg instanceof Error ? msg.message : String(msg ?? ''));
  str = str.replace(/bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
  str = str.replace(/authorization:\s*[^\r\n,]+/gi, 'authorization: [REDACTED]');
  for (const token of sensitiveTokens) {
    if (token && typeof token === 'string' && token.length > 3) {
      str = str.replaceAll(token, '[REDACTED]');
    }
  }
  str = str.replace(/(https?:\/\/)[^/@\s]+@/g, '$1[REDACTED]@');
  return str;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }): Promise<Response> => {
  try {
    const url = new URL(request.url);

    // 1. Validate requested file path (Security: fail-closed against traversal, absolute paths, backslashes, null bytes)
    const rawPath = url.searchParams.get('path') || url.searchParams.get('file') || url.searchParams.get('filePath');
    if (!rawPath || typeof rawPath !== 'string') {
      return jsonError('File path is required', 400);
    }

    const filePath = rawPath.trim();
    if (!filePath) {
      return jsonError('File path cannot be empty', 400);
    }

    const pathVal = validateRepoFilePath(filePath);
    if (!pathVal.valid) {
      return jsonError(pathVal.error || 'Invalid file path', 400);
    }

    // 2. Parse repo identification parameters
    // Note: caller-supplied commitOid is deliberately REMOVED entirely per security policy:
    // this endpoint serves ONLY the current public default_ref tip resolved server-side from D1.
    let repoId = url.searchParams.get('repoId') || url.searchParams.get('repositoryId') || url.searchParams.get('id');
    let owner = url.searchParams.get('owner');
    let slug = url.searchParams.get('slug');
    const repoParam = url.searchParams.get('repo') || url.searchParams.get('repoSlug');

    if (repoParam && !owner && !slug) {
      if (repoParam.includes('/')) {
        const parts = repoParam.split('/');
        owner = parts[0].trim();
        slug = parts[1].trim();
      } else {
        repoId = repoParam.trim();
      }
    }

    if (!repoId && (!owner || !slug) && !slug) {
      return jsonError('Repository identifier (repoId, owner+slug, or slug) is required', 400);
    }

    if (!env || !env.DB) {
      return jsonError('Database service is unavailable', 503);
    }

    // 3. Resolve repository and commit OID from D1
    // PUBLIC repos only (visibility='public' AND status='active') — reject private/unlisted/inactive with 404
    let repoRow: any = null;

    if (repoId) {
      repoRow = await env.DB.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.visibility, r.default_ref AS defaultRef, r.status,
               rf.commit_oid AS refCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(r.default_ref, 'refs/heads/main')
        WHERE (r.id = ? OR r.app_id = ?)
        LIMIT 1
      `).bind(repoId, repoId).first();
    } else if (owner && slug) {
      repoRow = await env.DB.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.visibility, r.default_ref AS defaultRef, r.status,
               rf.commit_oid AS refCommitOid
        FROM repositories r
        JOIN users u ON u.id = r.owner_user_id
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(r.default_ref, 'refs/heads/main')
        WHERE u.username = ? AND r.slug = ?
        LIMIT 1
      `).bind(owner, slug).first();
    } else if (slug) {
      repoRow = await env.DB.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.visibility, r.default_ref AS defaultRef, r.status,
               rf.commit_oid AS refCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(r.default_ref, 'refs/heads/main')
        WHERE r.slug = ? OR r.app_id = ?
        LIMIT 1
      `).bind(slug, slug).first();
    }

    if (!repoRow) {
      return jsonError('Repository not found', 404);
    }

    // Fail-closed: Only serve active public repos
    if (repoRow.visibility !== 'public' || repoRow.status !== 'active') {
      return jsonError('Repository not found', 404);
    }

    // 4. Resolve commit OID from DB default ref ONLY
    const targetCommitOid = repoRow.refCommitOid;
    if (!targetCommitOid || !isValidGitOid(targetCommitOid) || targetCommitOid.startsWith('-')) {
      return jsonError('No commit found for repository ref', 404);
    }

    const storageKey = repoRow.storageKey || `repositories/${repoRow.id}`;
    const maxAllowedBytes = getMaxFileSizeBytes(filePath);
    let fileBytes: Buffer | Uint8Array | null = null;

    // 5. Priority 1: Delegate to live token-gated GITSMITH gateway if configured
    if (env.GITSMITH_GATEWAY_URL) {
      if (!env.GITSMITH_GATEWAY_TOKEN) {
        // Token must be configured; fail safely without leaking details
        return jsonError('Gateway configuration error', 500);
      }

      const gatewayFetch: typeof fetch = env.__GITSMITH_GATEWAY_FETCH || env.GITSMITH_GATEWAY_FETCH || fetch;
      const gatewayBlobUrl = new URL('/api/gateway/blob', env.GITSMITH_GATEWAY_URL);
      gatewayBlobUrl.searchParams.set('storageKey', storageKey);
      gatewayBlobUrl.searchParams.set('commitOid', targetCommitOid);
      gatewayBlobUrl.searchParams.set('path', filePath);

      try {
        const res = await gatewayFetch(gatewayBlobUrl.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${env.GITSMITH_GATEWAY_TOKEN}`
          }
        });

        if (res.status === 404) {
          return jsonError('File not found in repository', 404);
        }

        if (res.status === 413) {
          return jsonError('File size exceeds maximum allowed limit', 413);
        }

        if (res.status === 400) {
          return jsonError('Invalid file request', 400);
        }

        if (!res.ok) {
          // If gateway doesn't support /blob yet, fallback to /tree for text files
          if (filePath.endsWith('.md') || filePath.endsWith('.json') || filePath.endsWith('.txt')) {
            const gatewayTreeUrl = new URL('/api/gateway/tree', env.GITSMITH_GATEWAY_URL);
            gatewayTreeUrl.searchParams.set('storageKey', storageKey);
            gatewayTreeUrl.searchParams.set('commitOid', targetCommitOid);
            gatewayTreeUrl.searchParams.set('manifests', filePath);

            const treeRes = await gatewayFetch(gatewayTreeUrl.toString(), {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${env.GITSMITH_GATEWAY_TOKEN}`
              }
            });

            if (treeRes.ok) {
              const treeData: any = await treeRes.json().catch(() => ({}));
              if (treeData?.manifestContents && typeof treeData.manifestContents[filePath] === 'string') {
                const textContent = treeData.manifestContents[filePath];
                const textBuf = Buffer.from(textContent, 'utf8');
                if (textBuf.length > maxAllowedBytes) {
                  return jsonError('File size exceeds maximum allowed limit', 413);
                }
                fileBytes = textBuf;
              }
            }
          }

          if (!fileBytes) {
            return jsonError('Failed to retrieve file from repository gateway', 502);
          }
        } else {
          // Check Content-Length header if present
          const cl = res.headers.get('content-length');
          if (cl) {
            const clNum = parseInt(cl, 10);
            if (Number.isFinite(clNum) && clNum > maxAllowedBytes * 2) {
              return jsonError('File size exceeds maximum allowed limit', 413);
            }
          }

          const data: any = await res.json().catch(() => ({}));
          if (data?.success && typeof data.base64 === 'string') {
            const decoded = Buffer.from(data.base64, 'base64');
            if (decoded.length > maxAllowedBytes) {
              return jsonError('File size exceeds maximum allowed limit', 413);
            }
            fileBytes = decoded;
          } else {
            return jsonError('Invalid gateway payload', 502);
          }
        }
      } catch (fetchErr: any) {
        console.error('Repository gateway fetch failure:', sanitizeLogMessage(fetchErr, [env.GITSMITH_GATEWAY_TOKEN]));
        return jsonError('Repository gateway unreachable', 502);
      }
    }

    // 6. Priority 2: Fallback to local filesystem for offline dev/tests
    if (!fileBytes) {
      const reposRoot = env.GITSMITH_REPOS_ROOT || (typeof process !== 'undefined' ? process.env?.GITSMITH_REPOS_ROOT : undefined);
      if (reposRoot) {
        try {
          const { readCommitFileBuffer } = await import('../../src/lib/gitsmith/gitStorage');
          fileBytes = readCommitFileBuffer(reposRoot, storageKey, targetCommitOid, filePath, maxAllowedBytes);
        } catch (storageErr: any) {
          if (storageErr?.code === 'ERR_FILE_TOO_LARGE') {
            return jsonError('File size exceeds maximum allowed limit', 413);
          }
        }
      }
    }

    if (!fileBytes) {
      if (!env.GITSMITH_GATEWAY_URL && !(env.GITSMITH_REPOS_ROOT || (typeof process !== 'undefined' && process.env?.GITSMITH_REPOS_ROOT))) {
        return jsonError('Repository storage is not configured', 500);
      }
      return jsonError('File not found in repository', 404);
    }

    // 7. Hard size check and return HTTP response with correct MIME type and cache controls
    if (fileBytes.length > maxAllowedBytes) {
      return jsonError('File size exceeds maximum allowed limit', 413);
    }

    const contentType = getMimeType(filePath);

    return new Response(fileBytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileBytes.length),
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'X-Content-Type-Options': 'nosniff',
        'X-Gitsmith-Commit-Oid': targetCommitOid
      }
    });
  } catch (err: any) {
    console.error('Unhandled repo-file proxy error:', sanitizeLogMessage(err, [env?.GITSMITH_GATEWAY_TOKEN]));
    return jsonError('Internal server error', 500);
  }
};
