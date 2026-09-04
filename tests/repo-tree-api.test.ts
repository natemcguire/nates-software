import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as repoTreeApi from '../functions/api/repo-tree';

describe('Public Repo-Tree Proxy API (NSW-53): real gateway file listing, no synthetic list', () => {
  let ctx: TestD1Context;
  let tempDir: string;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    tempDir = path.join('/tmp', `gitsmith-repotree-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  const publicCommitOid = '46e035f829e468aa8e12337e89e137ef04f75d64';
  let publicRepoId: string;
  let privateRepoId: string;

  beforeEach(async () => {
    publicRepoId = 'repo_tree_pub_123';
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, 'usr_nate', 'statementscan', 'public', 'refs/heads/main', ?, 'active')
    `).bind(publicRepoId, `repositories/${publicRepoId}`).run();

    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version)
      VALUES (?, 'refs/heads/main', ?, 1)
    `).bind(publicRepoId, publicCommitOid).run();

    privateRepoId = 'repo_tree_priv_456';
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, 'usr_nate', 'secret-tree-project', 'private', 'refs/heads/main', ?, 'active')
    `).bind(privateRepoId, `repositories/${privateRepoId}`).run();

    await ctx.d1.prepare(`
      INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version)
      VALUES (?, 'refs/heads/main', ?, 1)
    `).bind(privateRepoId, publicCommitOid).run();
  });

  it('returns the real recursive file list from the gateway tree endpoint for a public repo by repoId', async () => {
    const mockGatewayFetch = vi.fn(async (url: string, init: any) => {
      expect(init.headers.Authorization).toBe('Bearer test-gateway-token-xyz');
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/api/gateway/tree');
      expect(parsed.searchParams.get('storageKey')).toBe(`repositories/${publicRepoId}`);
      expect(parsed.searchParams.get('commitOid')).toBe(publicCommitOid);

      return new Response(JSON.stringify({
        success: true,
        exists: true,
        storageKey: `repositories/${publicRepoId}`,
        commitOid: publicCommitOid,
        files: ['README.md', 'src/index.ts', 'package.json'],
        manifestContents: { 'package.json': '{}' }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const req = new Request(`https://nates.software/api/repo-tree?repoId=${publicRepoId}`);
    const res = await repoTreeApi.onRequestGet({
      request: req,
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example.com',
        GITSMITH_GATEWAY_TOKEN: 'test-gateway-token-xyz',
        __GITSMITH_GATEWAY_FETCH: mockGatewayFetch
      }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.commitOid).toBe(publicCommitOid);
    expect(body.files).toEqual(['README.md', 'src/index.ts', 'package.json']);
    expect(res.headers.get('X-Gitsmith-Commit-Oid')).toBe(publicCommitOid);
    expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('resolves repo by owner and slug', async () => {
    const mockGatewayFetch = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      exists: true,
      storageKey: `repositories/${publicRepoId}`,
      commitOid: publicCommitOid,
      files: ['README.md']
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const req = new Request(`https://nates.software/api/repo-tree?owner=nate&slug=statementscan`);
    const res = await repoTreeApi.onRequestGet({
      request: req,
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example.com',
        GITSMITH_GATEWAY_TOKEN: 'test-gateway-token-xyz',
        __GITSMITH_GATEWAY_FETCH: mockGatewayFetch
      }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toEqual(['README.md']);
  });

  it('never leaks existence of PRIVATE repositories: identical 404 to a missing repo', async () => {
    const req = new Request(`https://nates.software/api/repo-tree?repoId=${privateRepoId}`);
    const res = await repoTreeApi.onRequestGet({
      request: req,
      env: { DB: ctx.d1, GITSMITH_GATEWAY_URL: 'https://gateway.example.com', GITSMITH_GATEWAY_TOKEN: 'tok' }
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Repository not found');

    const reqMissing = new Request(`https://nates.software/api/repo-tree?repoId=repo_does_not_exist`);
    const resMissing = await repoTreeApi.onRequestGet({
      request: reqMissing,
      env: { DB: ctx.d1, GITSMITH_GATEWAY_URL: 'https://gateway.example.com', GITSMITH_GATEWAY_TOKEN: 'tok' }
    });
    expect(resMissing.status).toBe(404);
    const missingBody = await resMissing.json();
    expect(missingBody.error).toBe(body.error);
  });

  it('returns 404 when the gateway reports the commit tree does not exist', async () => {
    const mockGatewayFetch = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      exists: false,
      storageKey: `repositories/${publicRepoId}`,
      commitOid: publicCommitOid,
      error: 'Commit does not exist in repository.'
    }), { status: 404, headers: { 'Content-Type': 'application/json' } }));

    const req = new Request(`https://nates.software/api/repo-tree?repoId=${publicRepoId}`);
    const res = await repoTreeApi.onRequestGet({
      request: req,
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example.com',
        GITSMITH_GATEWAY_TOKEN: 'test-gateway-token-xyz',
        __GITSMITH_GATEWAY_FETCH: mockGatewayFetch
      }
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 502 when the gateway is unreachable, without leaking the bearer token', async () => {
    const sensitiveToken = 'super-secret-tree-gateway-token';
    const mockGatewayFetch = vi.fn(async () => {
      throw new Error(`connect failed Authorization Bearer ${sensitiveToken}`);
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = new Request(`https://nates.software/api/repo-tree?repoId=${publicRepoId}`);
    const res = await repoTreeApi.onRequestGet({
      request: req,
      env: {
        DB: ctx.d1,
        GITSMITH_GATEWAY_URL: 'https://gateway.example.com',
        GITSMITH_GATEWAY_TOKEN: sensitiveToken,
        __GITSMITH_GATEWAY_FETCH: mockGatewayFetch
      }
    });

    expect(res.status).toBe(502);
    const bodyText = await res.text();
    expect(bodyText).not.toContain(sensitiveToken);
    expect(bodyText).not.toContain('Bearer');

    const loggedArgs = consoleSpy.mock.calls.flat().join(' ');
    expect(loggedArgs).not.toContain(sensitiveToken);
    consoleSpy.mockRestore();
  });

  it('fails with 500 without leaking token when GITSMITH_GATEWAY_URL is set but token is missing', async () => {
    const req = new Request(`https://nates.software/api/repo-tree?repoId=${publicRepoId}`);
    const res = await repoTreeApi.onRequestGet({
      request: req,
      env: { DB: ctx.d1, GITSMITH_GATEWAY_URL: 'https://gateway.example.com', GITSMITH_GATEWAY_TOKEN: undefined }
    });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('Bearer');
  });

  it('returns 500 when no gateway is configured at all (no synthetic list is ever fabricated)', async () => {
    const req = new Request(`https://nates.software/api/repo-tree?repoId=${publicRepoId}`);
    const res = await repoTreeApi.onRequestGet({
      request: req,
      env: { DB: ctx.d1 }
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Repository storage is not configured');
  });

  it('requires a repository identifier', async () => {
    const req = new Request(`https://nates.software/api/repo-tree`);
    const res = await repoTreeApi.onRequestGet({ request: req, env: { DB: ctx.d1 } });
    expect(res.status).toBe(400);
  });

  it('rejects repositories with no projected commit ref with 404', async () => {
    const unpushedId = 'repo_tree_unpushed';
    await ctx.d1.prepare(`
      INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
      VALUES (?, 'usr_nate', 'brand-new', 'public', 'refs/heads/main', ?, 'active')
    `).bind(unpushedId, `repositories/${unpushedId}`).run();

    const req = new Request(`https://nates.software/api/repo-tree?repoId=${unpushedId}`);
    const res = await repoTreeApi.onRequestGet({
      request: req,
      env: { DB: ctx.d1, GITSMITH_GATEWAY_URL: 'https://gateway.example.com', GITSMITH_GATEWAY_TOKEN: 'tok' }
    });
    expect(res.status).toBe(404);
  });
});
