import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import routerWorker, {
  handleRequest,
  EXCLUSION_HOSTNAMES,
  extractSubdomain,
  Env,
  AppListingRecord,
  R2ObjectBody
} from '../src/index';
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

  // ==========================================================================
  // 1. AUTHORITATIVE EXCLUSION LIST (13 PROXIED HOSTNAMES PASSTHROUGH)
  // ==========================================================================
  describe('1. Authoritative 13 Proxied Hostnames (Exclusion Passthrough)', () => {
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

    it('extracts subdomain correctly across standard, canary, and naked domains', () => {
      const u1 = new URL('https://app.nates-software.com/path');
      const r1 = new Request(u1);
      expect(extractSubdomain('app.nates-software.com', u1, r1)).toEqual({ isCanary: false, subdomain: 'app' });

      const u2 = new URL('https://router-canary.nates-software.com/?app=my-drop');
      const r2 = new Request(u2);
      expect(extractSubdomain('router-canary.nates-software.com', u2, r2)).toEqual({ isCanary: true, subdomain: 'my-drop' });

      const u3 = new URL('https://router-canary.nates-software.com/');
      const r3 = new Request(u3, { headers: { 'x-app-id': 'header-drop' } });
      expect(extractSubdomain('router-canary.nates-software.com', u3, r3)).toEqual({ isCanary: true, subdomain: 'header-drop' });

      const u4 = new URL('https://nates-software.com/');
      const r4 = new Request(u4);
      expect(extractSubdomain('nates-software.com', u4, r4)).toEqual({ isCanary: false, subdomain: '' });
    });

    expected13Hosts.forEach((hostname) => {
      it(`passes through ${hostname} untouched without D1 or R2 hits`, async () => {
        const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();
        const request = new Request(`https://${hostname}/some/path?query=1`, {
          headers: { Host: hostname }
        });

        const response = await handleRequest(request, env);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(request);

        // Zero D1 queries, zero R2 storage accesses
        expect(d1PrepareSpy).not.toHaveBeenCalled();
        expect(r2GetSpy).not.toHaveBeenCalled();

        expect(response.status).toBe(200);
        expect(response.headers.get('X-Passthrough')).toBe('true');
        const text = await response.text();
        expect(text).toBe(`PASSTHROUGH_TO_ORIGIN:https://${hostname}/some/path?query=1`);
      });
    });
  });

  // ==========================================================================
  // 2. D1-DRIVEN HOST RESOLUTION & ACTIVE R2 STATIC SERVING
  // ==========================================================================
  describe('2. D1 Host Resolution and Active R2 Serving (origin_kind=r2_static)', () => {
    it('serves active static application index.html from R2 revision key', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const activeRecord: AppListingRecord = {
        id: 'cool-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_999'
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

      const req = new Request('https://cool-app.nates-software.com/', {
        headers: { Host: 'cool-app.nates-software.com' }
      });

      const res = await routerWorker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=86400');
      expect(res.headers.get('ETag')).toBe('"rev_999-index.html"');

      const body = await res.text();
      expect(body).toBe(htmlBody);

      expect(mockStmt.bind).toHaveBeenCalledWith('cool-app', 'cool-app');
      expect(r2GetSpy).toHaveBeenCalledWith('apps/cool-app/revisions/rev_999/index.html');
    });

    it('serves assets with correct media type inference (JS, CSS, SVG, JSON, WASM)', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const activeRecord: AppListingRecord = {
        id: 'asset-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_asset'
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

        const req = new Request(`https://asset-app.nates-software.com/${filename}`, {
          headers: { Host: 'asset-app.nates-software.com' }
        });

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
        active_deployment_id: 'rev_nest'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord)
      });

      r2GetSpy.mockImplementation((key: string) => {
        // Direct path not found, index.html found
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

      const req = new Request('https://nested-app.nates-software.com/settings', {
        headers: { Host: 'nested-app.nates-software.com' }
      });

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
        active_deployment_id: 'rev_leg'
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

      const req = new Request('https://legacy-app.nates-software.com/bundle.js', {
        headers: { Host: 'legacy-app.nates-software.com' }
      });

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('console.log("live fallback");');
    });
  });

  // ==========================================================================
  // 3. INACTIVE, DRAFT, FAILED, OR MISSING APPS (CLEAN 404 / 503 / 400)
  // ==========================================================================
  describe('3. Inactive, Draft, Missing, or Traversal Error Handling', () => {
    it('returns clean 404 JSON when app is not found in D1', async () => {
      const { env, d1PrepareSpy } = createMockEnv();

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null)
      });

      const req = new Request('https://unknown-app.nates-software.com/', {
        headers: { Host: 'unknown-app.nates-software.com' }
      });

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

      const req = new Request('https://draft-tool.nates-software.com/', {
        headers: { Host: 'draft-tool.nates-software.com' }
      });

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
        active_deployment_id: 'rev_bad'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(failedRecord)
      });

      const req = new Request('https://broken-app.nates-software.com/', {
        headers: { Host: 'broken-app.nates-software.com' }
      });

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
        active_deployment_id: 'rev_good'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord)
      });

      r2GetSpy.mockResolvedValue(null);

      const req = new Request('https://good-app.nates-software.com/nonexistent.png', {
        headers: { Host: 'good-app.nates-software.com' }
      });

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
        active_deployment_id: 'rev_sec'
      };

      d1PrepareSpy.mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(activeRecord)
      });

      const req = new Request('https://secure-app.nates-software.com/..%2f..%2fetc/passwd', {
        headers: { Host: 'secure-app.nates-software.com' }
      });

      const res = await handleRequest(req, env);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({
        success: false,
        error: 'Invalid path'
      });
    });
  });

  // ==========================================================================
  // 4. KV HOST CACHING BEHAVIOR
  // ==========================================================================
  describe('4. KV Host Lookup Caching', () => {
    it('uses KV cache on hit and skips D1 query', async () => {
      const cachedListing: AppListingRecord = {
        id: 'cached-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_cache'
      };

      const { env, d1PrepareSpy, r2GetSpy, kvGetSpy, kvPutSpy } = createMockEnv();
      kvGetSpy.mockResolvedValue(cachedListing);

      r2GetSpy.mockResolvedValue({
        body: '<h1>Cached App</h1>',
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        httpEtag: '"rev_cache-index"',
        size: 19
      });

      const req = new Request('https://cached-app.nates-software.com/', {
        headers: { Host: 'cached-app.nates-software.com' }
      });

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
        active_deployment_id: 'rev_uncached'
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

      const req = new Request('https://uncached-app.nates-software.com/', {
        headers: { Host: 'uncached-app.nates-software.com' }
      });

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

  // ==========================================================================
  // 5. CANARY ROUTING
  // ==========================================================================
  describe('5. Canary Route Handling (router-canary.nates-software.com)', () => {
    it('returns canary health JSON when queried directly without app parameter', async () => {
      const { env } = createMockEnv();

      const req = new Request('https://router-canary.nates-software.com/', {
        headers: { Host: 'router-canary.nates-software.com' }
      });

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.service).toBe('nates-software-router');
      expect(json.canary).toBe(true);
    });

    it('resolves app via ?app= query parameter on router canary host', async () => {
      const { env, d1PrepareSpy, r2GetSpy } = createMockEnv();

      const canaryApp: AppListingRecord = {
        id: 'canary-test-app',
        origin_kind: 'r2_static',
        origin_ref: null,
        deployment_state: 'active',
        active_deployment_id: 'rev_canary'
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
        headers: { Host: 'router-canary.nates-software.com' }
      });

      const res = await handleRequest(req, env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<h1>Canary App Bytes</h1>');
    });
  });

  // ==========================================================================
  // 6. SPA ROUTE RESOLUTION DECOUPLING (NO INITIAL_APPS DEPENDENCY)
  // ==========================================================================
  describe('6. resolveAppRoute Decoupling from INITIAL_APPS', () => {
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
});
