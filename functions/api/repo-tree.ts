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

// Same bounded-read contract as repo-file.ts's readBoundedBody: cap by Content-Length
// header when present, and always cap the actual streamed bytes read (a lying or
// missing Content-Length must not allow an unbounded read).
async function readBoundedBody(
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
      return { ok: false, status: 413, error: 'Tree listing exceeds maximum allowed size' };
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
            return { ok: false, status: 413, error: 'Tree listing exceeds maximum allowed size' };
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

const MAX_TREE_RESPONSE_BYTES = 2 * 1024 * 1024;

// Authoritative repository file listing, proxied from the GITSMITH gateway's
// /api/gateway/tree endpoint (src/lib/gitsmith/gitStorage.ts inspectCommitTree,
// backed by `git ls-tree -r --name-only`). Mirrors repo-file.ts's repository
// resolution and public-repo access rules exactly: only 'public' + 'active'
// repositories are ever resolved, and both missing and non-public repositories
// return an identical 404 so existence is never leaked.
export const onRequestGet = async ({ request, env }: { request: Request; env: any }): Promise<Response> => {
  try {
    const url = new URL(request.url);

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

    if (repoRow.visibility !== 'public' || repoRow.status !== 'active') {
      return jsonError('Repository not found', 404);
    }

    const targetCommitOid = repoRow.refCommitOid;
    if (!targetCommitOid || typeof targetCommitOid !== 'string' || !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(targetCommitOid) || targetCommitOid.startsWith('-')) {
      return jsonError('No commit found for repository ref', 404);
    }

    const storageKey = repoRow.storageKey || `repositories/${repoRow.id}`;

    if (!env.GITSMITH_GATEWAY_URL) {
      return jsonError('Repository storage is not configured', 500);
    }
    if (!env.GITSMITH_GATEWAY_TOKEN) {
      return jsonError('Gateway configuration error', 500);
    }

    const gatewayFetch: typeof fetch = env.__GITSMITH_GATEWAY_FETCH || env.GITSMITH_GATEWAY_FETCH || fetch;
    const gatewayTreeUrl = new URL('/api/gateway/tree', env.GITSMITH_GATEWAY_URL);
    gatewayTreeUrl.searchParams.set('storageKey', storageKey);
    gatewayTreeUrl.searchParams.set('commitOid', targetCommitOid);

    try {
      const res = await gatewayFetch(gatewayTreeUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${env.GITSMITH_GATEWAY_TOKEN}`
        }
      });

      if (res.status === 404) {
        if (res.body && typeof res.body.cancel === 'function') {
          try { await res.body.cancel(); } catch {}
        }
        return jsonError('Repository tree not found at commit', 404);
      }

      if (!res.ok) {
        if (res.body && typeof res.body.cancel === 'function') {
          try { await res.body.cancel(); } catch {}
        }
        return jsonError('Failed to retrieve tree from repository gateway', 502);
      }

      const bounded = await readBoundedBody(res, MAX_TREE_RESPONSE_BYTES);
      if (!bounded.ok) {
        return jsonError(bounded.error, bounded.status);
      }

      const bodyText = new TextDecoder().decode(bounded.bytes);
      let data: any = null;
      try {
        data = JSON.parse(bodyText);
      } catch {}

      if (!data?.success || !data?.exists || !Array.isArray(data.files)) {
        return jsonError('Invalid gateway payload', 502);
      }

      const files: string[] = data.files.filter((f: unknown) => typeof f === 'string' && f.length > 0);

      return new Response(JSON.stringify({
        success: true,
        commitOid: targetCommitOid,
        files
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
          'X-Gitsmith-Commit-Oid': targetCommitOid
        }
      });
    } catch (fetchErr: any) {
      console.error('Repository tree gateway fetch failure:', sanitizeLogMessage(fetchErr, [env.GITSMITH_GATEWAY_TOKEN]));
      return jsonError('Repository gateway unreachable', 502);
    }
  } catch (err: any) {
    console.error('Unhandled repo-tree proxy error:', sanitizeLogMessage(err, [env?.GITSMITH_GATEWAY_TOKEN]));
    return jsonError('Internal server error', 500);
  }
};
