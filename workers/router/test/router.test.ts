import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import routerWorker, {
  handleRequest,
  EXCLUSION_HOSTNAMES,
  RESERVED_ROUTER_SUBDOMAINS,
  extractSubdomain,
  normalizeHostname,
  Env,
  AppListingRecord,
  R2ObjectBody
} from '../src/index';
import { buildOriginAuthToken, deriveOriginAppKey } from '../src/originAuth';

async function verifyOriginAuthToken(
  token: string,
  expected: { globalSecret: string; appId: string; host: string; method: string; path: string; nowSeconds?: number }
): Promise<boolean> {
  const parts = token.split('~');
  if (parts.length !== 6) return false;
  const [version, appId, host, expiresAtStr, nonce] = parts;
  if (version !== 'v1') return false;
  if (appId !== expected.appId || host !== expected.host) return false;
  const expiresAt = Number(expiresAtStr);
  const nowSeconds = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expiresAt) || expiresAt < nowSeconds) return false;

  const expectedToken = await buildOriginAuthToken({
    globalSecret: expected.globalSecret,
    appId: expected.appId,
    host: expected.host,
    method: expected.method,
    path: expected.path,
    now: expiresAt * 1000 - 60 * 1000,
    nonce
  });
  return expectedToken === token;
}
import { resolveAppRoute } from '../../../src/App';

describe('Cloudflare Router Worker (workers/router)', () => {
  let mockFetch: any;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn().mockImplementation((req: Request) => {
      return Promise.resolve(
        new Response(`PASSTHROUGH_TO_ORIGIN:${req.url}`, {
          status: 200,
          headers: { 'X-Passthrough': 'true' }
        })
      );
    });
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function createMockEnv(overrides: Partial<Env> = {}): {
    env: Env;
    d1PrepareSpy: ReturnType<typeof vi.fn>;
    r2GetSpy: ReturnType<typeof vi.fn>;
    kvGetSpy: ReturnType<typeof vi.fn>;
    kvPutSpy: ReturnType<typeof vi.fn>;
  } {
    const d1PrepareSpy = vi.fn();
    const r2GetSpy = vi.fn();
    const kvGetSpy = vi.fn().mockResolvedValue(null);
    const kvPutSpy = vi.fn().mockResolvedValue(undefined);

    const defaultEnv: Env = {
      DB: {
        prepare: d1PrepareSpy
      },
      STORAGE: {
        get: r2GetSpy,
        head: vi.fn()
      },
      HOST_CACHE: {
        get: kvGetSpy,
        put: kvPutSpy,
        delete: vi.fn()
      },
      CANARY_SECRET: 'test-canary-secret-123',
      ORIGIN_SHARED_SECRET: 'test-origin-secret-xyz',
      ...overrides
    };

    return {
      env: defaultEnv,
      d1PrepareSpy,
      r2GetSpy,
      kvGetSpy,
      kvPutSpy
    };
  }

  describe('1. Authoritative 13 Proxied Hostnames & Trailing-Dot Passthrough (FIX 2)', () => {
    const expected13Hosts = [
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
      'rig-provider.nates-software.com'
    ];

    it('contains exactly the 13 authoritative proxied hostnames in EXCLUSION_HOSTNAMES', () => {
      expect(EXCLUSION_HOSTNAMES.size).toBe(13);
      for (const host of expected13Hosts) {
        expect(EXCLUSION_HOSTNAMES.has(host)).toBe(true);
      }
    });

    it('normalizes hostnames by lowercasing, trimming, and stripping one terminal dot', () => {
      expect(normalizeHostname('Rig-Provider.nates-software.com.')).toBe('rig-provider.nates-software.com');
      expect(normalizeHostname('  PicFitAI.nates-software.com.  ')).toBe('picfitai.nates-software.com');
      expect(normalizeHostname('nates-software.com')).toBe('nates-software.com');
      expect(normalizeHostname('nates-software.com.')).toBe('nates-software.com');
    });

    it('extracts subdomain correctly across standard, trailing-dot, canary, and apex domains', () => {
      const u1 = new URL('https://app.nates-software.com/path');
      const r1 = new Request(u1);
      expect(extractSubdomain('app.nates-software.com', u1, r1)).toEqual({ isCanary: false, subdomain: 'app' });

      const u1Dot = new URL('https://app.nates-software.com./path');
      const r1Dot = new Request(u1Dot);
      expect(extractSubdomain('app.nates-software.com.', u1Dot, r1Dot)).toEqual({ isCanary: false, subdomain: 'app' });

      const u2 = new URL('https://router-canary.nates-software.com/?app=my-drop');
      const r2 = new Request(u2, { headers: { 'x-canary-secret': 'secret123' } });
      const canaryEnv = { CANARY_SECRET: 'secret123' } as any;
      expect(extractSubdomain('router-canary.nates-software.com', u2, r2, canaryEnv)).toEqual({ isCanary: true, subdomain: 'my-drop' });

      const u3 = new URL('https://router-canary.nates-software.com/');
      const r3 = new Request(u3, { headers: { 'x-app-id': 'header-drop', 'x-canary-secret': 'secret123' } });
      expect(extractSubdomain('router-canary.nates-software.com', u3, r3, canaryEnv)).toEqual({ isCanary: true, subdomain: 'header-drop' });

      const r3NoSecret = new Request(u3, { headers: { 'x-app-id': 'header-drop' } });
      expect(extractSubdomain('router-canary.nates-software.com', u3, r3NoSecret, canaryEnv)).toEqual({ isCanary: true, subdomain: '' });

      const u4 = new URL('https://nates-software.com/');
      const r4 = new Request(u4);
      expect(extractSubdomain('nates-software.com', u4, r4)).toEqual({ isCanary: false, subdomain: '' });
      expect(extractSubdomain('www.nates-software.com', u4, r4)).toEqual({ isCanary: false, subdomain: '' });
    });


    expected13Hosts.forEach((hostname) => {
      it(`passes through ${hostname} untouched without D1 or R2 hits`, async () => {
        const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();
        const request = new Request(`https://${hostname}/some/path?query=1`);

        const response = await handleRequest(request, env);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(request);

        expect(d1PrepareSpy).not.toHaveBeenCalled();
        expect(r2GetSpy).not.toHaveBeenCalled();

        expect(response.status).toBe(200);
        expect(response.headers.get('X-Passthrough')).toBe('true');
        const text = await response.text();
        expect(text).toBe(`PASSTHROUGH_TO_ORIGIN:https://${hostname}/some/path?query=1`);
      });
    });

    it('passes through trailing-dot FQDN rig-provider.nates-software.com. with zero D1 hits (FIX 2)', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();
      const request = new Request('https://rig-provider.nates-software.com./build/events');

      const response = await handleRequest(request, env);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(request);
      expect(d1PrepareSpy).not.toHaveBeenCalled();
      expect(r2GetSpy).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('PASSTHROUGH_TO_ORIGIN:https://rig-provider.nates-software.com./build/events');
    });

    it('passes through trailing-dot variants for multiple exclusion hosts (FIX 2)', async () => {
      const trailingDotHosts = [
        'picfitai.nates-software.com.',
        'american-gardener.nates-software.com.',
        'slopshop.nates-software.com.',
        'chat.nates-software.com.',
        'nates-software.com.'
      ];

      for (const host of trailingDotHosts) {
        const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();
        const request = new Request(`https://${host}/view`);

        const response = await handleRequest(request, env);
        expect(mockFetch).toHaveBeenCalledWith(request);
        expect(d1PrepareSpy).not.toHaveBeenCalled();
        expect(r2GetSpy).not.toHaveBeenCalled();
        expect(response.status).toBe(200);
      }
    });
  });

  describe('2. Suffix Guard & URL-Only Hostname Derivation (FIX 3)', () => {
    it('passes through foreign hostnames untouched via suffix guard without D1 lookup', async () => {
      const foreignUrls = [
        'https://evil.com/app',
        'https://attacker-nates-software.com/target',
        'https://evil.com./something',
        'https://nates-software.com.attacker.com/steal',
        'https://otherzone.org/'
      ];

      for (const rawUrl of foreignUrls) {
        const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();
        const request = new Request(rawUrl);

        const response = await handleRequest(request, env);
        expect(mockFetch).toHaveBeenCalledWith(request);
        expect(d1PrepareSpy).not.toHaveBeenCalled();
        expect(r2GetSpy).not.toHaveBeenCalled();
        expect(response.status).toBe(200);
      }
    });

    it('derives hostname solely from routed URL, ignoring spoofed Host headers', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const activeRecord: AppListingRecord = {
        id: 'real-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_real',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord)
      });

      r2GetSpy.mockResolvedValue({
        body: '<h1>Real App Content</h1>',
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        httpEtag: '"rev_real-index"',
        size: 24
      });

      const request = new Request('https://real-app.nates-software.com/', {
        headers: { Host: 'evil.com' }
      });

      const response = await handleRequest(request, env);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<h1>Real App Content</h1>');
      expect(d1PrepareSpy).toHaveBeenCalled();
    });

    it('does not route D1 when request URL is apex nates-software.com even if Host header is spoofed', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const request = new Request('https://nates-software.com/', {
        headers: { Host: 'unauthorized-app.nates-software.com' }
      });

      const response = await handleRequest(request, env);
      expect(mockFetch).toHaveBeenCalledWith(request);
      expect(d1PrepareSpy).not.toHaveBeenCalled();
      expect(r2GetSpy).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
    });
  });

  describe('3. D1 Host Resolution and Revision Healthy Gating (FIX 1)', () => {
    it('serves active static application index.html when revisionStatus is healthy', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const activeRecord: AppListingRecord = {
        id: 'cool-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_999',
        revisionStatus: 'healthy'
      };

      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord),
        all: vi.fn(),
        run: vi.fn()
      };
      d1PrepareSpy.mockReturnValue(mockStmt);

      const htmlBody = '<!DOCTYPE html><html><head><title>Cool App</title></head><body><h1>Hello from R2</h1></body></html>';
      const mockR2Obj: R2ObjectBody = {
        body: htmlBody,
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        httpEtag: '"rev_999-index.html"',
        size: htmlBody.length
      };

      r2GetSpy.mockImplementation((key: string) => {
        if (key === 'apps/cool-app/revisions/rev_999/index.html') {
          return Promise.resolve(mockR2Obj);
        }
        return Promise.resolve(null);
      });

      const req = new Request('https://cool-app.nates-software.com/');

      const res = await routerWorker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=86400');
      expect(res.headers.get('ETag')).toBe('"rev_999-index.html"');

      const body = await res.text();
      expect(body).toBe(htmlBody);

      expect(mockStmt.bind).toHaveBeenCalledWith('cool-app');
      expect(mockStmt.bind).not.toHaveBeenCalledWith('cool-app', 'cool-app');
      expect(r2GetSpy).toHaveBeenCalledWith('apps/cool-app/revisions/rev_999/index.html');
    });

    it('returns 503 and does NOT serve bytes when active_deployment_id points at superseded revision (FIX 1 regression)', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const supersededRecord: AppListingRecord = {
        id: 'stale-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_old',
        revisionStatus: 'superseded'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(supersededRecord)
      });

      const req = new Request('https://stale-app.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: "App 'stale-app' does not have an active verified deployment (current state: active)."
      });
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('returns 503 and does NOT serve bytes when active revision status is failed (FIX 1)', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const failedRevRecord: AppListingRecord = {
        id: 'failed-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_failed',
        revisionStatus: 'failed'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(failedRevRecord)
      });

      const req = new Request('https://failed-app.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(503);
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('returns 503 and does NOT serve bytes when active revision status is null / missing (FIX 1)', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const nullRevRecord: AppListingRecord = {
        id: 'dangling-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_dangling',
        revisionStatus: null
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(nullRevRecord)
      });

      const req = new Request('https://dangling-app.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(503);
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('serves assets with correct media type inference (JS, CSS, SVG, JSON, WASM)', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const activeRecord: AppListingRecord = {
        id: 'asset-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_asset',
        revisionStatus: 'healthy'
      };

      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord),
        all: vi.fn(),
        run: vi.fn()
      };
      d1PrepareSpy.mockReturnValue(mockStmt);

      const assets: Record<string, { content: string; expectedType: string }> = {
        'bundle.js': { content: 'console.log("ok");', expectedType: 'application/javascript; charset=utf-8' },
        'styles.css': { content: 'body { color: red; }', expectedType: 'text/css; charset=utf-8' },
        'icon.svg': { content: '<svg></svg>', expectedType: 'image/svg+xml' },
        'manifest.json': { content: '{"name":"app"}', expectedType: 'application/json' },
        'module.wasm': { content: 'wasm_bytes', expectedType: 'application/wasm' }
      };

      for (const [filename, asset] of Object.entries(assets)) {
        r2GetSpy.mockImplementation((key: string) => {
          if (key === `apps/asset-app/revisions/rev_asset/${filename}`) {
            return Promise.resolve({
              body: asset.content,
              httpMetadata: {},
              httpEtag: `"${filename}-etag"`,
              size: asset.content.length
            });
          }
          return Promise.resolve(null);
        });

        const req = new Request(`https://asset-app.nates-software.com/${filename}`);

        const res = await handleRequest(req, env);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe(asset.expectedType);
        expect(await res.text()).toBe(asset.content);
      }
    });

    it('falls back to subdirectory index.html for extensionless directory paths', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const activeRecord: AppListingRecord = {
        id: 'nested-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_nest',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord)
      });

      r2GetSpy.mockImplementation((key: string) => {
        if (key === 'apps/nested-app/revisions/rev_nest/settings/index.html') {
          return Promise.resolve({
            body: '<h1>Settings Page</h1>',
            httpMetadata: { contentType: 'text/html; charset=utf-8' },
            httpEtag: '"rev_nest-settings-index"',
            size: 23
          });
        }
        return Promise.resolve(null);
      });

      const req = new Request('https://nested-app.nates-software.com/settings');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(await res.text()).toBe('<h1>Settings Page</h1>');
    });

    it('falls back to live key path if revision path is not found in R2', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const activeRecord: AppListingRecord = {
        id: 'legacy-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_leg',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord)
      });

      r2GetSpy.mockImplementation((key: string) => {
        if (key === 'apps/legacy-app/live/bundle.js') {
          return Promise.resolve({
            body: 'console.log("live fallback");',
            httpMetadata: { contentType: 'application/javascript; charset=utf-8' },
            httpEtag: '"live-bundle"',
            size: 30
          });
        }
        return Promise.resolve(null);
      });

      const req = new Request('https://legacy-app.nates-software.com/bundle.js');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('console.log("live fallback");');
    });
  });

  describe('4. Inactive, Draft, Missing, or Traversal Error Handling', () => {
    it('returns clean 404 JSON when app is not found in D1', async () => {
      const { env, d1PrepareSpy } = createMockEnv();

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null)
      });

      const req = new Request('https://unknown-app.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: "App 'unknown-app' not found"
      });
    });

    it('returns 503 JSON when app is in draft state or missing active_deployment_id', async () => {
      const { env, d1PrepareSpy } = createMockEnv();

      const draftRecord: AppListingRecord = {
        id: 'draft-tool',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'draft',
        active_deployment_id: null
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(draftRecord)
      });

      const req = new Request('https://draft-tool.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: "App 'draft-tool' does not have an active verified deployment (current state: draft)."
      });
    });

    it('returns 503 JSON when app is in failed state', async () => {
      const { env, d1PrepareSpy } = createMockEnv();

      const failedRecord: AppListingRecord = {
        id: 'broken-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'failed',
        active_deployment_id: 'rev_bad',
        revisionStatus: 'failed'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(failedRecord)
      });

      const req = new Request('https://broken-app.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toContain('current state: failed');
    });

    it('returns 404 JSON when active app asset is missing in R2', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const activeRecord: AppListingRecord = {
        id: 'good-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_good',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord)
      });

      r2GetSpy.mockResolvedValue(null);

      const req = new Request('https://good-app.nates-software.com/nonexistent.png');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: "Asset 'nonexistent.png' not found for active deployment of 'good-app'."
      });
    });

    it('rejects path traversal attempts with 400 Bad Request', async () => {
      const { env, d1PrepareSpy } = createMockEnv();

      const activeRecord: AppListingRecord = {
        id: 'secure-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_sec',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord)
      });

      const req = new Request('https://secure-app.nates-software.com/..%2f..%2fetc/passwd');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: 'Invalid path'
      });
    });
  });

  describe('5. KV Host Lookup Caching', () => {
    it('uses KV cache on hit and skips D1 query', async () => {
      const cachedListing: AppListingRecord = {
        id: 'cached-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_cache',
        revisionStatus: 'healthy'
      };

      const { env, d1PrepareSpy, r2GetSpy, kvGetSpy, kvPutSpy } = createMockEnv();
      kvGetSpy.mockResolvedValue(cachedListing);

      r2GetSpy.mockResolvedValue({
        body: '<h1>Cached App</h1>',
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        httpEtag: '"rev_cache-index"',
        size: 19
      });

      const req = new Request('https://cached-app.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<h1>Cached App</h1>');

      expect(kvGetSpy).toHaveBeenCalledWith('host:cached-app', 'json');
      expect(d1PrepareSpy).not.toHaveBeenCalled();
      expect(kvPutSpy).not.toHaveBeenCalled();
    });

    it('populates KV cache with 60s TTL on D1 query miss', async () => {
      const d1Listing: AppListingRecord = {
        id: 'uncached-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_uncached',
        revisionStatus: 'healthy'
      };

      const { env, d1PrepareSpy, r2GetSpy, kvGetSpy, kvPutSpy } = createMockEnv();
      kvGetSpy.mockResolvedValue(null);

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(d1Listing)
      });

      r2GetSpy.mockResolvedValue({
        body: '<h1>Uncached App</h1>',
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        httpEtag: '"rev_uncached-index"',
        size: 21
      });

      const req = new Request('https://uncached-app.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);

      expect(kvGetSpy).toHaveBeenCalledWith('host:uncached-app', 'json');
      expect(d1PrepareSpy).toHaveBeenCalled();
      expect(kvPutSpy).toHaveBeenCalledWith(
        'host:uncached-app',
        JSON.stringify(d1Listing),
        { expirationTtl: 60 }
      );
    });
  });

  describe('6. Canary Route Handling with Secret Gating (FIX 4)', () => {
    it('returns canary info JSON without D1 lookup when requested without secret', async () => {
      const { env, d1PrepareSpy } = createMockEnv({ CANARY_SECRET: 'secret-xyz' });

      const req = new Request('https://router-canary.nates-software.com/?app=some-app');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.service).toBe('nates-software-router');
      expect(json.canary).toBe(true);
      expect(json.message).toContain('Router canary active');

      expect(d1PrepareSpy).not.toHaveBeenCalled();
    });

    it('returns canary info JSON without D1 lookup when requested with invalid secret', async () => {
      const { env, d1PrepareSpy } = createMockEnv({ CANARY_SECRET: 'secret-xyz' });

      const req = new Request('https://router-canary.nates-software.com/?app=some-app', {
        headers: { 'x-canary-secret': 'wrong-secret' }
      });

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.canary).toBe(true);
      expect(d1PrepareSpy).not.toHaveBeenCalled();
    });

    it('resolves app via ?app= query parameter when matching x-canary-secret header is provided', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv({ CANARY_SECRET: 'secret-xyz' });

      const canaryApp: AppListingRecord = {
        id: 'canary-test-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_canary',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(canaryApp)
      });

      r2GetSpy.mockResolvedValue({
        body: '<h1>Canary App Bytes</h1>',
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        httpEtag: '"canary-etag"',
        size: 24
      });

      const req = new Request('https://router-canary.nates-software.com/?app=canary-test-app', {
        headers: { 'x-canary-secret': 'secret-xyz' }
      });

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<h1>Canary App Bytes</h1>');
      expect(d1PrepareSpy).toHaveBeenCalled();
    });

    it('resolves app via x-app-id header when matching x-canary-secret header is provided', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv({ CANARY_SECRET: 'secret-xyz' });

      const canaryApp: AppListingRecord = {
        id: 'header-canary-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_canary_hdr',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(canaryApp)
      });

      r2GetSpy.mockResolvedValue({
        body: '<h1>Header Canary Bytes</h1>',
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        httpEtag: '"canary-hdr-etag"',
        size: 27
      });

      const req = new Request('https://router-canary.nates-software.com/', {
        headers: {
          'x-app-id': 'header-canary-app',
          'x-canary-secret': 'secret-xyz'
        }
      });

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<h1>Header Canary Bytes</h1>');
      expect(d1PrepareSpy).toHaveBeenCalled();
    });
  });

  describe('7. resolveAppRoute Decoupling from INITIAL_APPS', () => {
    it('resolves standalone views correctly', () => {
      expect(resolveAppRoute('chat.nates-software.com', '/')).toEqual({
        type: 'standalone_view',
        id: 'chat',
        title: 'CHAT IRC CHATROOM (#lounge)'
      });
      expect(resolveAppRoute('gitsmith.nates-software.com', '/')).toEqual({
        type: 'standalone_view',
        id: 'gitsmith',
        title: 'GITSMITH FORGE'
      });
      expect(resolveAppRoute('hotwire.nates-software.com', '/')).toEqual({
        type: 'standalone_view',
        id: 'hotwire',
        title: 'HOTWIRE DAILY DROPS'
      });
    });

    it('resolves standalone apps by subdomain or query param without INITIAL_APPS', () => {
      expect(resolveAppRoute('dronehunter.nates-software.com', '/')).toEqual({
        type: 'standalone_app',
        id: 'dronehunter',
        title: 'DroneHunter 95'
      });
      expect(resolveAppRoute('new-user-app.nates-software.com', '/')).toEqual({
        type: 'standalone_app',
        id: 'new-user-app',
        title: 'New User App'
      });
      expect(resolveAppRoute('', '', '', 'my-custom-drop')).toEqual({
        type: 'standalone_app',
        id: 'my-custom-drop',
        title: 'My Custom Drop'
      });
    });

    it('resolves root apex to desktop', () => {
      expect(resolveAppRoute('nates-software.com', '/')).toEqual({
        type: 'desktop'
      });
      expect(resolveAppRoute('www.nates-software.com', '/')).toEqual({
        type: 'desktop'
      });
    });
  });

  describe('8. Phase 3 Origin Kind Dispatch', () => {
    it('proxies to origin_ref for active and healthy cf_container app preserving method, path, and query', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const containerRecord: AppListingRecord = {
        id: 'container-app',
        origin_kind: 'cf_container',
        origin_ref: 'https://container-app-worker.internal.workers.dev',
        deployment_state: 'active',
        active_deployment_id: 'rev_cnt_1',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(containerRecord)
      });

      mockFetch.mockImplementation(async (req: Request) => {
        return new Response(JSON.stringify({ message: 'Hello from container', url: req.url, method: req.method }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Container-Origin': 'true'
          }
        });
      });

      const req = new Request('https://container-app.nates-software.com/api/v1/items?limit=10&page=2', {
        method: 'GET',
        headers: {
          'X-Custom-Header': 'custom-val'
        }
      });

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Container-Origin')).toBe('true');
      const data = await res.json();
      expect(data).toEqual({
        message: 'Hello from container',
        url: 'https://container-app-worker.internal.workers.dev/api/v1/items?limit=10&page=2',
        method: 'GET'
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const forwardedReq = mockFetch.mock.calls[0][0] as Request;
      expect(forwardedReq.url).toBe('https://container-app-worker.internal.workers.dev/api/v1/items?limit=10&page=2');
      expect(forwardedReq.method).toBe('GET');
      expect(forwardedReq.headers.get('X-Custom-Header')).toBe('custom-val');
      const originAuthToken = forwardedReq.headers.get('X-NSW-Origin-Auth');
      expect(originAuthToken).not.toBeNull();
      expect(originAuthToken).not.toBe('test-origin-secret-xyz');
      expect(
        await verifyOriginAuthToken(originAuthToken!, {
          globalSecret: 'test-origin-secret-xyz',
          appId: 'container-app',
          host: 'container-app-worker.internal.workers.dev',
          method: 'GET',
          path: '/api/v1/items'
        })
      ).toBe(true);
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('forwards POST request with body and headers to cf_container origin', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const containerRecord: AppListingRecord = {
        id: 'api-container',
        origin_kind: 'cf_container',
        origin_ref: 'https://api-container.workers.dev',
        deployment_state: 'active',
        active_deployment_id: 'rev_api_1',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(containerRecord)
      });

      mockFetch.mockImplementation(async (req: Request) => {
        const bodyText = await req.text();
        return new Response(`RECEIVED:${bodyText}`, {
          status: 201,
          headers: { 'X-Created': 'true' }
        });
      });

      const req = new Request('https://api-container.nates-software.com/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer victim-session-token',
          'Cookie': 'nsw_session=victim-token'
        },
        body: JSON.stringify({ action: 'create', count: 42 })
      });

      const res = await handleRequest(req, env);
      expect(res.status).toBe(201);
      expect(res.headers.get('X-Created')).toBe('true');
      expect(await res.text()).toBe('RECEIVED:{"action":"create","count":42}');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const forwardedReq = mockFetch.mock.calls[0][0] as Request;
      expect(forwardedReq.url).toBe('https://api-container.workers.dev/submit');
      expect(forwardedReq.method).toBe('POST');
      expect(forwardedReq.headers.get('Content-Type')).toBe('application/json');
      expect(forwardedReq.headers.get('Authorization')).toBeNull();
      expect(forwardedReq.headers.get('Cookie')).toBeNull();
      const originAuthToken = forwardedReq.headers.get('X-NSW-Origin-Auth');
      expect(originAuthToken).not.toBeNull();
      expect(originAuthToken).not.toBe('test-origin-secret-xyz');
      expect(
        await verifyOriginAuthToken(originAuthToken!, {
          globalSecret: 'test-origin-secret-xyz',
          appId: 'api-container',
          host: 'api-container.workers.dev',
          method: 'POST',
          path: '/submit'
        })
      ).toBe(true);
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('proxies worker and fargate_warm origin kinds to origin_ref', async () => {
      for (const originKind of ['worker', 'fargate_warm'] as const) {
        const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

        const record: AppListingRecord = {
          id: `${originKind}-app`,
          origin_kind: originKind,
          origin_ref: `https://${originKind}-app.workers.dev`,
          deployment_state: 'active',
          active_deployment_id: 'rev_1',
          revisionStatus: 'healthy'
        };

        d1PrepareSpy.mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(record)
        });

        mockFetch.mockResolvedValue(new Response(`OK from ${originKind}`, { status: 200 }));

        const req = new Request(`https://${originKind}-app.nates-software.com/status`);
        const res = await handleRequest(req, env);

        expect(res.status).toBe(200);
        expect(await res.text()).toBe(`OK from ${originKind}`);
        expect(r2GetSpy).not.toHaveBeenCalled();
      }
    });

    it('rejects a non-allowlisted origin_ref with 502 SSRF guard and does not fetch it', async () => {
      const { env, d1PrepareSpy } = createMockEnv();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope'));
      const rec: AppListingRecord = {
        id: 'evil-app', origin_kind: 'cf_container',
        origin_ref: 'https://169.254.169.254/latest/meta-data',
        deployment_state: 'active', active_deployment_id: 'rev_evil', revisionStatus: 'healthy'
      };
      d1PrepareSpy.mockReturnValue({ bind: vi.fn().mockReturnThis(), first: vi.fn().mockResolvedValue(rec) });
      const res = await handleRequest(new Request('https://evil-app.nates-software.com/'), env);
      expect(res.status).toBe(502);
      const calledEvil = fetchSpy.mock.calls.some(c => {
        const a = c[0] as any;
        const u = typeof a === 'string' ? a : (a && a.url) || String(a);
        return String(u).includes('169.254');
      });
      expect(calledEvil).toBe(false);
      fetchSpy.mockRestore();
    });

    it('returns 503 when cf_container app is active+healthy but origin_ref is null', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const containerRecord: AppListingRecord = {
        id: 'no-origin-app',
        origin_kind: 'cf_container',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_no_orig',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(containerRecord)
      });

      const req = new Request('https://no-origin-app.nates-software.com/dashboard');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: "App 'no-origin-app' has no origin configured."
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('returns 503 when cf_container app is active+healthy but origin_ref is empty/whitespace', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const containerRecord: AppListingRecord = {
        id: 'empty-origin-app',
        origin_kind: 'cf_container',
        origin_ref: '   ',
        deployment_state: 'active',
        active_deployment_id: 'rev_empty_orig',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(containerRecord)
      });

      const req = new Request('https://empty-origin-app.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: "App 'empty-origin-app' has no origin configured."
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('returns 503 when cf_container app has revisionStatus=failed (healthy-gate not bypassed)', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const containerRecord: AppListingRecord = {
        id: 'failed-container-app',
        origin_kind: 'cf_container',
        origin_ref: 'https://failed-container.workers.dev',
        deployment_state: 'active',
        active_deployment_id: 'rev_failed',
        revisionStatus: 'failed'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(containerRecord)
      });

      const req = new Request('https://failed-container-app.nates-software.com/health');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toContain('does not have an active verified deployment');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('returns 503 when cf_container app is in draft state or missing active_deployment_id', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const containerRecord: AppListingRecord = {
        id: 'draft-container-app',
        origin_kind: 'cf_container',
        origin_ref: 'https://draft-container.workers.dev',
        deployment_state: 'draft',
        active_deployment_id: null
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(containerRecord)
      });

      const req = new Request('https://draft-container-app.nates-software.com/');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(503);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('returns 501 for unknown origin_kind even when active and healthy', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const unknownRecord: AppListingRecord = {
        id: 'unknown-app',
        origin_kind: 'unsupported_substrate',
        origin_ref: 'https://somewhere.internal',
        deployment_state: 'active',
        active_deployment_id: 'rev_unk_1',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(unknownRecord)
      });

      const req = new Request('https://unknown-app.nates-software.com/test');

      const res = await handleRequest(req, env);
      expect(res.status).toBe(501);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: "Unsupported origin_kind 'unsupported_substrate'."
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('sets a request-scoped, app-scoped signed X-NSW-Origin-Auth token, never the raw ORIGIN_SHARED_SECRET (Codex #4)', async () => {
      const { env, d1PrepareSpy } = createMockEnv({ ORIGIN_SHARED_SECRET: 'custom-secret-456' });

      const containerRecord: AppListingRecord = {
        id: 'auth-container',
        origin_kind: 'cf_container',
        origin_ref: 'https://auth-container.workers.dev',
        deployment_state: 'active',
        active_deployment_id: 'rev_auth_1',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(containerRecord)
      });

      mockFetch.mockResolvedValue(new Response('OK', { status: 200 }));

      const req = new Request('https://auth-container.nates-software.com/api/test');
      const res = await handleRequest(req, env);

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const forwardedReq = mockFetch.mock.calls[0][0] as Request;
      const originAuthToken = forwardedReq.headers.get('X-NSW-Origin-Auth');

      expect(originAuthToken).not.toBeNull();
      expect(originAuthToken).not.toBe('custom-secret-456');
      expect(originAuthToken).not.toContain('custom-secret-456');

      expect(
        await verifyOriginAuthToken(originAuthToken!, {
          globalSecret: 'custom-secret-456',
          appId: 'auth-container',
          host: 'auth-container.workers.dev',
          method: 'GET',
          path: '/api/test'
        })
      ).toBe(true);
    });

    it('an origin-auth token minted for one app cannot authenticate as a different app (Codex #4 cross-tenant forgery)', async () => {
      const globalSecret = 'shared-platform-secret';

      const tokenForVictim = await buildOriginAuthToken({
        globalSecret,
        appId: 'victim-app',
        host: 'victim-app.workers.dev',
        method: 'GET',
        path: '/api/data'
      });

      expect(
        await verifyOriginAuthToken(tokenForVictim, {
          globalSecret,
          appId: 'attacker-app',
          host: 'attacker-app.workers.dev',
          method: 'GET',
          path: '/api/data'
        })
      ).toBe(false);

      const attackerDerivedKey = await deriveOriginAppKey(globalSecret, 'attacker-app');
      const victimDerivedKey = await deriveOriginAppKey(globalSecret, 'victim-app');
      expect(Buffer.from(attackerDerivedKey).toString('hex')).not.toBe(
        Buffer.from(victimDerivedKey).toString('hex')
      );
    });

    it('rejects an origin-auth token whose bound host/method/path does not match the actual proxied request', async () => {
      const globalSecret = 'rebind-secret';
      const token = await buildOriginAuthToken({
        globalSecret,
        appId: 'app-x',
        host: 'app-x.workers.dev',
        method: 'GET',
        path: '/read-only'
      });

      expect(
        await verifyOriginAuthToken(token, {
          globalSecret,
          appId: 'app-x',
          host: 'app-x.workers.dev',
          method: 'POST',
          path: '/admin/delete'
        })
      ).toBe(false);
    });

    it('rejects an expired origin-auth token', async () => {
      const globalSecret = 'expiry-secret';
      const mintedAt = Date.now() - 10 * 60 * 1000;
      const token = await buildOriginAuthToken({
        globalSecret,
        appId: 'app-y',
        host: 'app-y.workers.dev',
        method: 'GET',
        path: '/status',
        now: mintedAt
      });

      expect(
        await verifyOriginAuthToken(token, {
          globalSecret,
          appId: 'app-y',
          host: 'app-y.workers.dev',
          method: 'GET',
          path: '/status',
          nowSeconds: Math.floor(Date.now() / 1000)
        })
      ).toBe(false);
    });

    it('fails closed (503) and does not proxy when ORIGIN_SHARED_SECRET is undefined/missing', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv({ ORIGIN_SHARED_SECRET: undefined });

      const containerRecord: AppListingRecord = {
        id: 'unauth-container',
        origin_kind: 'cf_container',
        origin_ref: 'https://unauth-container.workers.dev',
        deployment_state: 'active',
        active_deployment_id: 'rev_unauth_1',
        revisionStatus: 'healthy'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(containerRecord)
      });

      const req = new Request('https://unauth-container.nates-software.com/api/test');
      const res = await handleRequest(req, env);

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: 'Router origin auth secret is not configured.'
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(r2GetSpy).not.toHaveBeenCalled();
    });

    it('fails closed (503) and does not proxy when ORIGIN_SHARED_SECRET is empty string or whitespace', async () => {
      for (const emptySecret of ['', '   ']) {
        const { env, d1PrepareSpy, r2GetSpy } = createMockEnv({ ORIGIN_SHARED_SECRET: emptySecret });

        const containerRecord: AppListingRecord = {
          id: 'unauth-container',
          origin_kind: 'cf_container',
          origin_ref: 'https://unauth-container.workers.dev',
          deployment_state: 'active',
          active_deployment_id: 'rev_unauth_1',
          revisionStatus: 'healthy'
        };

        d1PrepareSpy.mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(containerRecord)
        });

        const req = new Request('https://unauth-container.nates-software.com/api/test');
        const res = await handleRequest(req, env);

        expect(res.status).toBe(503);
        const json = await res.json();
        expect(json).toEqual({
          success: false,
          error: 'Router origin auth secret is not configured.'
        });
        expect(mockFetch).not.toHaveBeenCalled();
        expect(r2GetSpy).not.toHaveBeenCalled();
      }
    });
  });

  describe('9. Reserved-Subdomain id-Fallback Guard (Codex #5)', () => {
    it('never issues the id-fallback D1 query for a reserved subdomain, even if hostname lookup misses', async () => {
      const { env, d1PrepareSpy } = createMockEnv();

      const bindSpy = vi.fn().mockReturnThis();
      d1PrepareSpy.mockReturnValue({
        bind: bindSpy,
        first: vi.fn().mockResolvedValue(null)
      });

      const req = new Request('https://inbox.nates-software.com/');
      const res = await handleRequest(req, env);

      expect(res.status).toBe(404);
      expect(d1PrepareSpy).toHaveBeenCalledTimes(1);
      expect(bindSpy).toHaveBeenCalledWith('inbox');
      expect(bindSpy).not.toHaveBeenCalledWith('inbox', 'inbox');
    });

    it('never dispatches a tenant listing to a reserved subdomain via the id-fallback match', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const maliciousRow: AppListingRecord = {
        id: 'inbox',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_evil',
        revisionStatus: 'healthy'
      };

      const bindSpy = vi.fn().mockReturnThis();
      d1PrepareSpy.mockReturnValue({
        bind: bindSpy,
        first: vi.fn().mockResolvedValue(null)
      });

      const req = new Request('https://inbox.nates-software.com/secret-plan.html');
      const res = await handleRequest(req, env);

      expect(res.status).toBe(404);
      expect(d1PrepareSpy).toHaveBeenCalledTimes(1);
      expect(r2GetSpy).not.toHaveBeenCalled();
      expect(maliciousRow.id).toBe('inbox');
    });

    it('still resolves a legitimate tenant app whose subdomain is not reserved via the id-fallback', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const legitRecord: AppListingRecord = {
        id: 'my-cool-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_legit',
        revisionStatus: 'healthy'
      };

      const bindSpy = vi.fn().mockReturnThis();
      let callCount = 0;
      d1PrepareSpy.mockImplementation(() => ({
        bind: bindSpy,
        first: vi.fn().mockImplementation(() => {
          callCount += 1;
          return Promise.resolve(callCount === 1 ? null : legitRecord);
        })
      }));

      r2GetSpy.mockResolvedValue({
        body: '<h1>Legit</h1>',
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        httpEtag: '"rev_legit-index"',
        size: 14
      });

      const req = new Request('https://my-cool-app.nates-software.com/');
      const res = await handleRequest(req, env);

      expect(res.status).toBe(200);
      expect(d1PrepareSpy).toHaveBeenCalledTimes(2);
      expect(bindSpy).toHaveBeenCalledWith('my-cool-app');
    });

    it('RESERVED_ROUTER_SUBDOMAINS matches RESERVED_APP_IDS in src/lib/hotwireDomain.ts', async () => {
      const { RESERVED_APP_IDS } = await import('../../../src/lib/hotwireDomain');
      expect(Array.from(RESERVED_ROUTER_SUBDOMAINS).sort()).toEqual(
        Array.from(RESERVED_APP_IDS as Set<string>).sort()
      );
    });
  });
});
