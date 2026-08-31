import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { initBareRepo, readCommitFileBuffer, readCommitFileBase64 } from '../src/lib/gitsmith/gitStorage';
import * as repoFileApi from '../functions/api/repo-file';

describe('Public Repo-File Proxy API & Storage Suite (Phase C-render)', () => {
  let ctx: TestD1Context;
  let tempDir: string;
  let reposRoot: string;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    tempDir = path.join('/tmp', `gitsmith-repofile-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    reposRoot = path.join(tempDir, 'repos');
    fs.mkdirSync(reposRoot, { recursive: true });
    process.env.GITSMITH_REPOS_ROOT = reposRoot;
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  function createCommittedRepo(storageKey: string, files: Record<string, string | Buffer>): { commitOid: string; repoPath: string } {
    const initRes = initBareRepo(reposRoot, {
      storageKey,
      objectFormat: 'sha1',
      defaultRef: 'refs/heads/main'
    });
    expect(initRes.success).toBe(true);

    const workTree = path.join(tempDir, `wt-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(workTree, { recursive: true });
    execFileSync('git', ['init', workTree], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@nates.software'], { cwd: workTree, stdio: 'pipe' });

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(workTree, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (typeof content === 'string') {
        fs.writeFileSync(fullPath, content, 'utf8');
      } else {
        fs.writeFileSync(fullPath, content);
      }
    }

    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: workTree, stdio: 'pipe' });
    const commitOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: 'pipe' }).trim();
    execFileSync('git', ['push', initRes.repoPath!, 'HEAD:refs/heads/main'], { cwd: workTree, stdio: 'pipe' });

    return { commitOid, repoPath: initRes.repoPath! };
  }

  // PNG header magic bytes: 89 50 4E 47 0D 0A 1A 0A
  const samplePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const sampleMarkdown = '# DroneHunter Idea Spec\n\nDouble-barrel shotgun arcade game.\n\n![Hero](screenshots/hero.png)\n';

  describe('1. gitStorage primitive binary & base64 reads', () => {
    it('reads binary buffers and base64 strings accurately from bare repository', () => {
      const storageKey = 'repositories/test-binary-repo';
      const { commitOid } = createCommittedRepo(storageKey, {
        'spec.md': sampleMarkdown,
        'screenshots/hero.png': samplePngBuffer
      });

      const textBuffer = readCommitFileBuffer(reposRoot, storageKey, commitOid, 'spec.md');
      expect(textBuffer).not.toBeNull();
      expect(textBuffer!.toString('utf8')).toBe(sampleMarkdown);

      const imageBuffer = readCommitFileBuffer(reposRoot, storageKey, commitOid, 'screenshots/hero.png');
      expect(imageBuffer).not.toBeNull();
      expect(Buffer.compare(imageBuffer!, samplePngBuffer)).toBe(0);

      const imageBase64 = readCommitFileBase64(reposRoot, storageKey, commitOid, 'screenshots/hero.png');
      expect(imageBase64).toBe(samplePngBuffer.toString('base64'));

      // Non-existent file returns null
      expect(readCommitFileBuffer(reposRoot, storageKey, commitOid, 'nonexistent.png')).toBeNull();
      expect(readCommitFileBase64(reposRoot, storageKey, commitOid, 'nonexistent.png')).toBeNull();
    });
  });

  describe('2. Public Repo Proxy GET /api/repo-file', () => {
    let publicRepoId: string;
    let privateRepoId: string;
    let publicCommitOid: string;

    beforeEach(async () => {
      // Create public repo
      publicRepoId = 'repo_pub_123';
      const pubStorageKey = `repositories/${publicRepoId}`;
      const pubRepo = createCommittedRepo(pubStorageKey, {
        'spec.md': sampleMarkdown,
        'business.md': '# Business Model\n\nUp to 50% revenue share for contributors.',
        'screenshots/hero.png': samplePngBuffer
      });
      publicCommitOid = pubRepo.commitOid;

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
        VALUES (?, 'usr_nate', 'dronehunter-spec', 'public', 'refs/heads/main', ?, 'active')
      `).bind(publicRepoId, pubStorageKey).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version)
        VALUES (?, 'refs/heads/main', ?, 1)
      `).bind(publicRepoId, publicCommitOid).run();

      // Create private repo
      privateRepoId = 'repo_priv_456';
      const privStorageKey = `repositories/${privateRepoId}`;
      const privRepo = createCommittedRepo(privStorageKey, {
        'spec.md': '# Top Secret Spec\n',
        'screenshots/secret.png': samplePngBuffer
      });

      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
        VALUES (?, 'usr_nate', 'secret-project', 'private', 'refs/heads/main', ?, 'active')
      `).bind(privateRepoId, privStorageKey).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version)
        VALUES (?, 'refs/heads/main', ?, 1)
      `).bind(privateRepoId, privRepo.commitOid).run();
    });

    it('successfully serves spec.md with markdown Content-Type from public repo by repoId', async () => {
      const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=spec.md`);
      const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/markdown');
      const text = await res.text();
      expect(text).toBe(sampleMarkdown);
    });

    it('successfully serves screenshots/hero.png with image/png Content-Type from public repo', async () => {
      const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=screenshots/hero.png`);
      const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      const arrayBuf = await res.arrayBuffer();
      const resBuffer = Buffer.from(arrayBuf);
      expect(Buffer.compare(resBuffer, samplePngBuffer)).toBe(0);
    });

    it('resolves repo by owner and slug (owner=nate&slug=dronehunter-spec)', async () => {
      const req = new Request(`https://nates.software/api/repo-file?owner=nate&slug=dronehunter-spec&path=spec.md`);
      const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe(sampleMarkdown);
    });

    it('resolves repo by repo=owner/slug format', async () => {
      const req = new Request(`https://nates.software/api/repo-file?repo=nate/dronehunter-spec&path=business.md`);
      const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('# Business Model');
    });

    it('returns 404 for missing file in public repo', async () => {
      const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=nonexistent.md`);
      const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('not found');
    });

    describe('Security & Fail-Closed Invariants', () => {
      it('rejects path traversal attempts with 400', async () => {
        const traversalPaths = [
          '../secret.txt',
          '../../etc/passwd',
          'screenshots/../../secret.txt',
          '..',
          'foo/..',
          '/absolute/path/spec.md',
          '\\windows\\system32',
          '-v',
          'spec.md\0.png'
        ];

        for (const badPath of traversalPaths) {
          const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=${encodeURIComponent(badPath)}`);
          const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
          expect(res.status, `Path '${badPath}' should be rejected with 400`).toBe(400);
          const body = await res.json();
          expect(body.success).toBe(false);
        }
      });

      it('rejects access to PRIVATE repositories with 404 (never leaks existence)', async () => {
        const req = new Request(`https://nates.software/api/repo-file?repoId=${privateRepoId}&path=spec.md`);
        const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('Repository not found');
      });

      it('rejects access to UNLISTED repositories with 404', async () => {
        await ctx.d1.prepare(`
          UPDATE repositories SET visibility = 'unlisted' WHERE id = ?
        `).bind(publicRepoId).run();

        const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=spec.md`);
        const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });

        expect(res.status).toBe(404);
      });

      it('fails with 500 without leaking token when GITSMITH_GATEWAY_URL is set but GITSMITH_GATEWAY_TOKEN is missing', async () => {
        const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=spec.md`);
        const res = await repoFileApi.onRequestGet({
          request: req,
          env: {
            DB: ctx.d1,
            GITSMITH_GATEWAY_URL: 'https://gateway.example.com',
            GITSMITH_GATEWAY_TOKEN: undefined
          }
        });

        expect(res.status).toBe(500);
        const text = await res.text();
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('Bearer');
      });

      it('delegates to GITSMITH gateway over HTTP using bearer token and returns response', async () => {
        const mockGatewayFetch = vi.fn(async (url: string, init: any) => {
          expect(init.headers.Authorization).toBe('Bearer test-gateway-token-xyz');
          const parsedUrl = new URL(url);
          expect(parsedUrl.pathname).toBe('/api/gateway/blob');
          expect(parsedUrl.searchParams.get('path')).toBe('spec.md');

          return new Response(JSON.stringify({
            success: true,
            storageKey: `repositories/${publicRepoId}`,
            commitOid: publicCommitOid,
            path: 'spec.md',
            base64: Buffer.from('# Gateway Spec Content\n').toString('base64')
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        });

        const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=spec.md`);
        const res = await repoFileApi.onRequestGet({
          request: req,
          env: {
            DB: ctx.d1,
            GITSMITH_GATEWAY_URL: 'https://gateway.example.com',
            GITSMITH_GATEWAY_TOKEN: 'test-gateway-token-xyz',
            __GITSMITH_GATEWAY_FETCH: mockGatewayFetch
          }
        });

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe('# Gateway Spec Content\n');
        expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
      });
    });
  });
});
