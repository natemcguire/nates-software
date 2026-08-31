// Public proxy Pages Function for retrieving committed repository files (e.g. spec.md, screenshots, business.md)
// Authoritative Git storage is token-gated on the GITSMITH gateway; this endpoint securely proxies
// reads for PUBLIC repositories only, fail-closed against path traversal and private repo access.

import { isValidGitOid } from '../../src/lib/forgeDomain';

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

export const onRequestGet = async ({ request, env }: { request: Request; env: any }): Promise<Response> => {
  try {
    const url = new URL(request.url);

    // 1. Validate requested file path (Security: fail-closed against traversal, absolute paths, null bytes)
    const rawPath = url.searchParams.get('path') || url.searchParams.get('file') || url.searchParams.get('filePath');
    if (!rawPath || typeof rawPath !== 'string') {
      return jsonError('File path is required', 400);
    }

    const filePath = rawPath.trim();
    if (!filePath) {
      return jsonError('File path cannot be empty', 400);
    }

    // Reject leading slashes, absolute paths, Windows drive paths, backslashes, CLI flag injection, null bytes
    if (
      filePath.startsWith('/') ||
      filePath.startsWith('\\') ||
      filePath.startsWith('-') ||
      filePath.includes('\0') ||
      /^[a-zA-Z]:/.test(filePath)
    ) {
      return jsonError('Invalid file path: absolute paths and leading slashes are forbidden', 400);
    }

    // Split segments and verify no segment is '..' or '.'
    const segments = filePath.split(/[/\\]+/);
    for (const segment of segments) {
      if (segment === '..' || segment === '.') {
        return jsonError('Path traversal is forbidden', 400);
      }
    }

    if (filePath.includes('..')) {
      return jsonError('Path traversal is forbidden', 400);
    }

    // 2. Parse repo identification parameters
    let repoId = url.searchParams.get('repoId') || url.searchParams.get('repositoryId') || url.searchParams.get('id');
    let owner = url.searchParams.get('owner');
    let slug = url.searchParams.get('slug');
    const repoParam = url.searchParams.get('repo') || url.searchParams.get('repoSlug');
    const refParam = url.searchParams.get('ref');
    const commitOidParam = url.searchParams.get('commitOid') || url.searchParams.get('oid') || url.searchParams.get('commit');

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
    // PUBLIC repos only (visibility='public') — reject private/unlisted with 404 to avoid leaking existence
    let repoRow: any = null;

    if (repoId) {
      repoRow = await env.DB.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.visibility, r.default_ref AS defaultRef, r.status,
               rf.commit_oid AS refCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(?, r.default_ref, 'refs/heads/main')
        WHERE (r.id = ? OR r.app_id = ?)
        LIMIT 1
      `).bind(refParam || null, repoId, repoId).first();
    } else if (owner && slug) {
      repoRow = await env.DB.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.visibility, r.default_ref AS defaultRef, r.status,
               rf.commit_oid AS refCommitOid
        FROM repositories r
        JOIN users u ON u.id = r.owner_user_id
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(?, r.default_ref, 'refs/heads/main')
        WHERE u.username = ? AND r.slug = ?
        LIMIT 1
      `).bind(refParam || null, owner, slug).first();
    } else if (slug) {
      repoRow = await env.DB.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.visibility, r.default_ref AS defaultRef, r.status,
               rf.commit_oid AS refCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(?, r.default_ref, 'refs/heads/main')
        WHERE r.slug = ? OR r.app_id = ?
        LIMIT 1
      `).bind(refParam || null, slug, slug).first();
    }

    if (!repoRow) {
      return jsonError('Repository not found', 404);
    }

    // Fail-closed: Only serve public repos
    if (repoRow.visibility !== 'public') {
      return jsonError('Repository not found', 404);
    }

    // 4. Resolve commit OID
    let targetCommitOid: string = '';
    if (commitOidParam) {
      if (!isValidGitOid(commitOidParam) || commitOidParam.startsWith('-')) {
        return jsonError('Invalid commit OID format', 400);
      }
      targetCommitOid = commitOidParam.trim();
    } else if (repoRow.refCommitOid) {
      targetCommitOid = repoRow.refCommitOid;
    } else {
      return jsonError('No commit found for repository ref', 404);
    }

    const storageKey = repoRow.storageKey || `repositories/${repoRow.id}`;
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
          return jsonError(`File '${filePath}' not found in repository`, 404);
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
                fileBytes = Buffer.from(treeData.manifestContents[filePath], 'utf8');
              }
            }
          }

          if (!fileBytes) {
            return jsonError('Failed to retrieve file from repository gateway', 502);
          }
        } else {
          const data: any = await res.json().catch(() => ({}));
          if (data?.success && typeof data.base64 === 'string') {
            fileBytes = Buffer.from(data.base64, 'base64');
          } else {
            return jsonError('Invalid gateway payload', 502);
          }
        }
      } catch (fetchErr: any) {
        return jsonError(`Repository gateway unreachable: ${fetchErr?.message || 'network error'}`, 502);
      }
    }

    // 6. Priority 2: Fallback to local filesystem for offline dev/tests
    if (!fileBytes) {
      const reposRoot = env.GITSMITH_REPOS_ROOT || (typeof process !== 'undefined' ? process.env?.GITSMITH_REPOS_ROOT : undefined);
      if (reposRoot) {
        try {
          const { readCommitFileBuffer } = await import('../../src/lib/gitsmith/gitStorage');
          fileBytes = readCommitFileBuffer(reposRoot, storageKey, targetCommitOid, filePath);
        } catch {}
      }
    }

    if (!fileBytes) {
      if (!env.GITSMITH_GATEWAY_URL && !(env.GITSMITH_REPOS_ROOT || (typeof process !== 'undefined' && process.env?.GITSMITH_REPOS_ROOT))) {
        return jsonError('Repository storage is not configured', 500);
      }
      return jsonError(`File '${filePath}' not found in repository`, 404);
    }

    // 7. Format and return HTTP response with correct MIME type and cache controls
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
    return jsonError(err?.message || 'Internal server error while reading repository file', 500);
  }
};
