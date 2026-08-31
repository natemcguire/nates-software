// Standalone Cloudflare Router Worker
// Wildcard front-door router for *.nates-software.com
// Resolves <app>.nates-software.com -> D1 app listing -> R2 static assets (for origin_kind='r2_static')
// Preserves all 13 authoritative proxied hostnames via passthrough allowlist.

import { getMediaType } from './mediaType';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[]; success: boolean; error?: string }>;
  run(): Promise<{ success: boolean; error?: string }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface R2HttpMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2ObjectBody {
  body: ReadableStream | ArrayBuffer | Uint8Array | any;
  httpMetadata?: R2HttpMetadata;
  httpEtag?: string;
  size: number;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2ObjectBody | null>;
}

export interface KVNamespace {
  get(key: string, type?: 'text'): Promise<string | null>;
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { expiration?: number; expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  HOST_CACHE?: KVNamespace;
}

export interface AppListingRecord {
  readonly id: string;
  readonly origin_kind: string | null;
  readonly origin_ref: string | null;
  readonly deployment_state: string;
  readonly active_deployment_id: string | null;
}

/**
 * Authoritative exclusion list for proxied hostnames in zone nates-software.com (id: 3a1a7fed796a2d4b09b3c4e9ac1cfeea).
 * In-Worker allowlist defense-in-depth: if the router ever runs for any of these hostnames, it returns fetch(request) unchanged.
 */
export const EXCLUSION_HOSTNAMES = new Set([
  'nates-software.com',
  'www.nates-software.com',
  'chat.nates-software.com',
  'git.nates-software.com',
  'gitsmith.nates-software.com',
  'hotwire.nates-software.com',
  'rig.nates-software.com',
  'slopshop.nates-software.com',
  'dronehunter.nates-software.com',
  'certified-mailer.nates-software.com',
  'picfitai.nates-software.com',
  'american-gardener.nates-software.com',
  'rig-provider.nates-software.com',
]);

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });

export function extractSubdomain(hostname: string, url: URL, request: Request): { isCanary: boolean; subdomain: string } {
  const host = hostname.toLowerCase().trim();

  if (host === 'router-canary.nates-software.com') {
    const appParam = url.searchParams.get('app')?.toLowerCase().trim() ||
                     request.headers.get('x-app-id')?.toLowerCase().trim() ||
                     '';
    return { isCanary: true, subdomain: appParam };
  }

  if (host === 'nates-software.com' || host === 'www.nates-software.com') {
    return { isCanary: false, subdomain: '' };
  }

  if (host.endsWith('.nates-software.com')) {
    const sub = host.slice(0, -'.nates-software.com'.length);
    return { isCanary: false, subdomain: sub };
  }

  if (host.includes('.')) {
    return { isCanary: false, subdomain: host.split('.')[0] };
  }

  return { isCanary: false, subdomain: host };
}

export async function handleRequest(request: Request, env: Env, _ctx?: any): Promise<Response> {
  try {
    const url = new URL(request.url);
    const hostHeader = request.headers.get('host') || url.host;
    const hostname = (hostHeader.split(':')[0] || url.hostname).toLowerCase().trim();

    // 1. Authoritative exclusion allowlist defense-in-depth
    if (EXCLUSION_HOSTNAMES.has(hostname)) {
      return fetch(request);
    }

    // 2. Extract subdomain
    const { isCanary, subdomain } = extractSubdomain(hostname, url, request);

    if (isCanary && !subdomain) {
      return json({
        success: true,
        service: 'nates-software-router',
        canary: true,
        message: 'Router canary active. Query ?app=<app-id> to test D1+R2 host routing.',
        timestamp: new Date().toISOString()
      }, 200);
    }

    if (!subdomain || EXCLUSION_HOSTNAMES.has(subdomain) || subdomain === 'www') {
      return fetch(request);
    }

    // 3. D1 host lookup with KV caching
    const cacheKey = `host:${subdomain}`;
    let listing: AppListingRecord | null = null;

    if (env?.HOST_CACHE) {
      try {
        listing = await env.HOST_CACHE.get<AppListingRecord>(cacheKey, 'json');
      } catch {
        listing = null;
      }
    }

    if (!listing && env?.DB) {
      listing = await env.DB.prepare(`
        SELECT id, origin_kind, origin_ref, deployment_state, active_deployment_id
        FROM app_listings
        WHERE hostname = ? OR id = ?
      `).bind(subdomain, subdomain).first<AppListingRecord>();

      if (listing && env?.HOST_CACHE) {
        try {
          await env.HOST_CACHE.put(cacheKey, JSON.stringify(listing), { expirationTtl: 60 });
        } catch {}
      }
    }

    // 4. Validate listing and active deployment state
    if (!listing) {
      return json({
        success: false,
        error: `App '${subdomain}' not found`
      }, 404);
    }

    if (listing.deployment_state !== 'active' || !listing.active_deployment_id) {
      return json({
        success: false,
        error: `App '${listing.id || subdomain}' does not have an active verified deployment (current state: ${listing.deployment_state || 'draft'}).`
      }, 503);
    }

    // 5. Origin kind dispatch (Phase 0 only supports r2_static)
    if (listing.origin_kind !== 'r2_static') {
      return json({
        success: false,
        error: `Unsupported origin_kind '${listing.origin_kind}' in Phase 0.`
      }, 501);
    }

    // 6. Serve from R2
    let rawPath = url.pathname;
    let assetPath = rawPath.replace(/^\/+/, '').trim();
    if (!assetPath) assetPath = 'index.html';

    let decodedAssetPath = assetPath;
    try {
      decodedAssetPath = decodeURIComponent(assetPath);
    } catch {}

    if (
      assetPath.includes('..') ||
      assetPath.includes('\0') ||
      decodedAssetPath.includes('..') ||
      decodedAssetPath.includes('\0')
    ) {
      return json({ success: false, error: 'Invalid path' }, 400);
    }

    if (!env?.STORAGE) {
      return json({ success: false, error: 'Storage binding not configured' }, 500);
    }

    const appId = listing.id;
    const activeDeploymentId = listing.active_deployment_id;

    // (i) Revision key: apps/{appId}/revisions/{activeDeploymentId}/{assetPath}
    const revKey = `apps/${appId}/revisions/${activeDeploymentId}/${assetPath}`;
    let object = await env.STORAGE.get(revKey);

    // (ii) Directory index fallback: apps/{appId}/revisions/{activeDeploymentId}/{assetPath}/index.html
    if (!object && !assetPath.includes('.')) {
      const indexKey = `apps/${appId}/revisions/${activeDeploymentId}/${assetPath}/index.html`.replace(/\/+/g, '/');
      object = await env.STORAGE.get(indexKey);
    }

    // (iii) Live key fallback: apps/{appId}/live/{assetPath}
    if (!object) {
      const liveKey = `apps/${appId}/live/${assetPath}`;
      object = await env.STORAGE.get(liveKey);
    }

    if (object) {
      const mediaType = object.httpMetadata?.contentType || getMediaType(assetPath);
      return new Response(object.body, {
        status: 200,
        headers: {
          'Content-Type': mediaType,
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
          'ETag': object.httpEtag || `"${activeDeploymentId}-${assetPath}"`
        }
      });
    }

    return json({
      success: false,
      error: `Asset '${assetPath}' not found for active deployment of '${appId}'.`
    }, 404);
  } catch (err: any) {
    return json({
      success: false,
      error: err?.message || 'Internal Router Error'
    }, 500);
  }
}

export default {
  fetch(request: Request, env: Env, ctx?: any): Promise<Response> {
    return handleRequest(request, env, ctx);
  }
};
