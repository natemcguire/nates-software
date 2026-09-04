import {
  isValidGitOid,
  validateRepoFilePath,
  getMaxFileSizeBytes
} from '../../src/lib/forgeDomain';
import { repositorySourceIsPrivate, repositorySourcePolicyColumns, repositorySourcePolicyJoin } from './_sourcePolicy';

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

export async function readBoundedBody(
  res: Response,
  maxBytes: number
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: 413; error: string }> {
  const clHeader = res.headers?.get?.('content-length');
  if (clHeader) {
    const cl = parseInt(clHeader, 10);
    if (Number.isFinite(cl) && cl > maxBytes) {
      if (res.body && typeof res.body.cancel === 'function') {
        try {
          await res.body.cancel();
        } catch {}
      }
      return { ok: false, status: 413, error: 'File size exceeds maximum allowed limit' };
    }
  }

  if (!res.body) {
    return { ok: true, bytes: new Uint8Array(0) };
  }

  if (typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          const chunkBytes = value instanceof Uint8Array ? value : new Uint8Array(value);
          totalBytes += chunkBytes.byteLength;
          if (totalBytes > maxBytes) {
            try {
              await reader.cancel('Payload too large');
            } catch {}
            return { ok: false, status: 413, error: 'File size exceeds maximum allowed limit' };
          }
          chunks.push(chunkBytes);
        }
      }
    } catch (err) {
      try {
        await reader.cancel('Stream read error');
      } catch {}
      throw err;
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, bytes: combined };
  }

  throw new Error('Gateway response body is not a streamable ReadableStream');
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }): Promise<Response> => {
  try {
    const url = new URL(request.url);

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

    let repoRow: any = null;

    if (repoId) {
      repoRow = await env.DB.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.visibility, r.default_ref AS defaultRef, r.status,
               ${repositorySourcePolicyColumns},
               rf.commit_oid AS refCommitOid
        FROM repositories r
        ${repositorySourcePolicyJoin}
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(r.default_ref, 'refs/heads/main')
        WHERE (r.id = ? OR r.app_id = ?)
        LIMIT 1
      `).bind(repoId, repoId).first();
    } else if (owner && slug) {
      repoRow = await env.DB.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.visibility, r.default_ref AS defaultRef, r.status,
               ${repositorySourcePolicyColumns},
               rf.commit_oid AS refCommitOid
        FROM repositories r
        JOIN users u ON u.id = r.owner_user_id
        ${repositorySourcePolicyJoin}
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(r.default_ref, 'refs/heads/main')
        WHERE u.username = ? AND r.slug = ?
        LIMIT 1
      `).bind(owner, slug).first();
    } else if (slug) {
      repoRow = await env.DB.prepare(`
        SELECT r.id, r.storage_key AS storageKey, r.visibility, r.default_ref AS defaultRef, r.status,
               ${repositorySourcePolicyColumns},
               rf.commit_oid AS refCommitOid
        FROM repositories r
        ${repositorySourcePolicyJoin}
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(r.default_ref, 'refs/heads/main')
        WHERE r.slug = ? OR r.app_id = ?
        LIMIT 1
      `).bind(slug, slug).first();
    }

    if (!repoRow) {
      return jsonError('Repository not found', 404);
    }

    if (repoRow.visibility !== 'public' || repoRow.status !== 'active') {
      return jsonError('Repository not found', 404);
    }

    if (repositorySourceIsPrivate(repoRow)) {
      return jsonError('Source is private for this app', 403);
    }

    const targetCommitOid = repoRow.refCommitOid;
    if (!targetCommitOid || !isValidGitOid(targetCommitOid) || targetCommitOid.startsWith('-')) {
      return jsonError('No commit found for repository ref', 404);
    }

    const storageKey = repoRow.storageKey || `repositories/${repoRow.id}`;
    const maxAllowedBytes = getMaxFileSizeBytes(filePath);
    const maxGatewayBlobBytes = Math.ceil(maxAllowedBytes * 1.36) + 32 * 1024;
    let fileBytes: Buffer | Uint8Array | null = null;

    if (env.GITSMITH_GATEWAY_URL) {
      if (!env.GITSMITH_GATEWAY_TOKEN) {
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

        if (res.status === 413) {
          if (res.body && typeof res.body.cancel === 'function') {
            try { await res.body.cancel(); } catch {}
          }
          return jsonError('File size exceeds maximum allowed limit', 413);
        }

        if (res.status === 400) {
          if (res.body && typeof res.body.cancel === 'function') {
            try { await res.body.cancel(); } catch {}
          }
          return jsonError('Invalid file request', 400);
        }

        if (!res.ok) {
          const blobStatus = res.status;
          if (res.body && typeof res.body.cancel === 'function') {
            try { await res.body.cancel(); } catch {}
          }

          // The gateway's single-blob read (/api/gateway/blob -> readCommitFileBase64 ->
          // git cat-file -s "<oid>:<path>") can 404 even for a file that is genuinely
          // present in the commit tree, e.g. when that specific plumbing lookup fails.
          // For the extensions the tree endpoint indexes as "manifest" content, retry via
          // /api/gateway/tree (git ls-tree -r, a more resilient whole-tree read) before
          // giving up. This must run for 404s too, not just non-404 gateway errors.
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
              const maxGatewayTreeBytes = maxAllowedBytes + 512 * 1024;
              const boundedTree = await readBoundedBody(treeRes, maxGatewayTreeBytes);
              if (!boundedTree.ok) {
                return jsonError(boundedTree.error, boundedTree.status);
              }

              const treeText = new TextDecoder().decode(boundedTree.bytes);
              let treeData: any = null;
              try {
                treeData = JSON.parse(treeText);
              } catch {}

              if (treeData?.manifestContents && typeof treeData.manifestContents[filePath] === 'string') {
                const textContent = treeData.manifestContents[filePath];
                const textBuf = Buffer.from(textContent, 'utf8');
                if (textBuf.length > maxAllowedBytes) {
                  return jsonError('File size exceeds maximum allowed limit', 413);
                }
                fileBytes = textBuf;
              }
            } else {
              if (treeRes.body && typeof treeRes.body.cancel === 'function') {
                try { await treeRes.body.cancel(); } catch {}
              }
            }
          }

          if (!fileBytes) {
            if (blobStatus === 404) {
              return jsonError('File not found in repository', 404);
            }
            return jsonError('Failed to retrieve file from repository gateway', 502);
          }
        } else {
          const boundedBlob = await readBoundedBody(res, maxGatewayBlobBytes);
          if (!boundedBlob.ok) {
            return jsonError(boundedBlob.error, boundedBlob.status);
          }

          const blobText = new TextDecoder().decode(boundedBlob.bytes);
          let data: any = null;
          try {
            data = JSON.parse(blobText);
          } catch {}

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
