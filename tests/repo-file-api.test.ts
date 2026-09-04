import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import {
  initBareRepo,
  readCommitFileBuffer,
  readCommitFileBase64,
  readCommitFileContent,
  getCommitFileSize
} from '../src/lib/gitsmith/gitStorage';
import { validateRepoFilePath, getMaxFileSizeBytes } from '../src/lib/forgeDomain';
import * as repoFileApi from '../functions/api/repo-file';

describe('Public Repo-File Proxy API & Storage Suite (Phase C-render FIX)', () => {
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

  function createCommittedRepo(storageKey: string, files: Record<string, string | Buffer>): { commitOid: string; repoPath: string; workTree: string } {
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

    return { commitOid, repoPath: initRes.repoPath!, workTree };
  }

  function appendCommitToRepo(workTree: string, repoPath: string, filesToAdd: Record<string, string | Buffer>, filesToRemove: string[] = []): string {
    for (const file of filesToRemove) {
      const fullPath = path.join(workTree, file);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        execFileSync('git', ['rm', file], { cwd: workTree, stdio: 'pipe' });
      }
    }

    for (const [filePath, content] of Object.entries(filesToAdd)) {
      const fullPath = path.join(workTree, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (typeof content === 'string') {
        fs.writeFileSync(fullPath, content, 'utf8');
      } else {
        fs.writeFileSync(fullPath, content);
      }
    }

    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'Subsequent commit'], { cwd: workTree, stdio: 'pipe' });
    const commitOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: 'pipe' }).trim();
    execFileSync('git', ['push', repoPath, 'HEAD:refs/heads/main'], { cwd: workTree, stdio: 'pipe' });
    return commitOid;
  }

  const samplePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const sampleMarkdown = '# DroneHunter Idea Spec\n\nDouble-barrel shotgun arcade game.\n\n![Hero](screenshots/hero.png)\n';

  describe('1. gitStorage primitive binary, base64, size check & backslash validation', () => {
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

      expect(readCommitFileBuffer(reposRoot, storageKey, commitOid, 'nonexistent.png')).toBeNull();
      expect(readCommitFileBase64(reposRoot, storageKey, commitOid, 'nonexistent.png')).toBeNull();
    });

    it('measures object size accurately via git cat-file -s without reading full blob', () => {
      const storageKey = 'repositories/test-size-repo';
      const { commitOid } = createCommittedRepo(storageKey, {
        'spec.md': sampleMarkdown,
        'screenshots/hero.png': samplePngBuffer
      });

      const specSize = getCommitFileSize(reposRoot, storageKey, commitOid, 'spec.md');
      expect(specSize).toBe(Buffer.byteLength(sampleMarkdown, 'utf8'));

      const pngSize = getCommitFileSize(reposRoot, storageKey, commitOid, 'screenshots/hero.png');
      expect(pngSize).toBe(samplePngBuffer.length);

      expect(getCommitFileSize(reposRoot, storageKey, commitOid, 'missing.txt')).toBeNull();
    });

    it('rejects files exceeding size limits with ERR_FILE_TOO_LARGE before buffering', () => {
      const storageKey = 'repositories/test-large-file-repo';
      const largeContent = 'X'.repeat(300 * 1024);
      const { commitOid } = createCommittedRepo(storageKey, {
        'large-spec.md': largeContent
      });

      expect(() => {
        readCommitFileContent(reposRoot, storageKey, commitOid, 'large-spec.md', 256 * 1024);
      }).toThrow(/exceeds maximum limit/);

      expect(() => {
        readCommitFileBuffer(reposRoot, storageKey, commitOid, 'large-spec.md', 256 * 1024);
      }).toThrow(/exceeds maximum limit/);
    });

    it('rejects all backslashes in gitStorage file operations', () => {
      const storageKey = 'repositories/test-backslash-repo';
      const { commitOid } = createCommittedRepo(storageKey, {
        'screenshots/hero.png': samplePngBuffer
      });

      expect(readCommitFileBuffer(reposRoot, storageKey, commitOid, 'screenshots\\hero.png')).toBeNull();
      expect(readCommitFileContent(reposRoot, storageKey, commitOid, 'screenshots\\hero.png')).toBeNull();
      expect(getCommitFileSize(reposRoot, storageKey, commitOid, 'screenshots\\hero.png')).toBeNull();
      expect(readCommitFileBase64(reposRoot, storageKey, commitOid, 'screenshots\\hero.png')).toBeNull();
    });
  });

  describe('2. Path Policy & Centralized Validation', () => {
    it('validates safe relative paths and rejects all invalid variants', () => {
      expect(validateRepoFilePath('spec.md').valid).toBe(true);
      expect(validateRepoFilePath('screenshots/hero.png').valid).toBe(true);
      expect(validateRepoFilePath('docs/sub/spec.markdown').valid).toBe(true);

      expect(validateRepoFilePath('images\\secret.png').valid).toBe(false);
      expect(validateRepoFilePath('foo\\bar/baz.png').valid).toBe(false);
      expect(validateRepoFilePath('\\root.png').valid).toBe(false);

      expect(validateRepoFilePath('../secret.txt').valid).toBe(false);
      expect(validateRepoFilePath('foo/../bar').valid).toBe(false);
      expect(validateRepoFilePath('foo/./bar').valid).toBe(false);
      expect(validateRepoFilePath('foo//bar').valid).toBe(false);
      expect(validateRepoFilePath('/etc/passwd').valid).toBe(false);
      expect(validateRepoFilePath('C:file.txt').valid).toBe(false);
      expect(validateRepoFilePath('-v').valid).toBe(false);
      expect(validateRepoFilePath('file\0.txt').valid).toBe(false);
      expect(validateRepoFilePath('').valid).toBe(false);
    });

    it('computes correct max size bounds by extension', () => {
      expect(getMaxFileSizeBytes('spec.md')).toBe(256 * 1024);
      expect(getMaxFileSizeBytes('data.json')).toBe(256 * 1024);
      expect(getMaxFileSizeBytes('hero.png')).toBe(2 * 1024 * 1024);
      expect(getMaxFileSizeBytes('hero.jpg')).toBe(2 * 1024 * 1024);
      expect(getMaxFileSizeBytes('unknown.bin')).toBe(2 * 1024 * 1024);
    });
  });

  describe('3. Public Repo Proxy GET /api/repo-file', () => {
    let publicRepoId: string;
    let privateRepoId: string;
    let publicCommitOid: string;

    beforeEach(async () => {
      publicRepoId = 'repo_pub_123';
      const pubStorageKey = `repositories/${publicRepoId}`;
      const pubRepo = createCommittedRepo(pubStorageKey, {
        'spec.md': sampleMarkdown,
        'business.md': '# Business Model\n\nUp to 50% revenue share for contributors.',
        'screenshots/hero.png': samplePngBuffer,
        'payload.html': '<script>document.title=document.cookie</script>',
        'evil.js': 'fetch("/api/profile")',
        'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
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

    it('downgrades executable maker source (html/js/svg) to inert text/plain with a sandbox CSP (NSW-133)', async () => {
      for (const path of ['payload.html', 'evil.js', 'logo.svg']) {
        const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=${path}`);
        const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
        expect(res.status, path).toBe(200);
        // Never served with an executable content-type on the marketplace origin.
        expect(res.headers.get('Content-Type'), path).toContain('text/plain');
        expect(res.headers.get('Content-Type'), path).not.toContain('text/html');
        expect(res.headers.get('Content-Type'), path).not.toContain('javascript');
        expect(res.headers.get('Content-Type'), path).not.toContain('svg');
        expect(res.headers.get('X-Content-Type-Options'), path).toBe('nosniff');
        expect(res.headers.get('Content-Security-Policy'), path).toContain('sandbox');
      }
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

    describe('Security Fixes: OID Lock, Status Check, Bounds, Sanitization, Backslashes', () => {
      it('HIGH FIX #1: Ignores caller-supplied commitOid and strictly serves the current default_ref tip', async () => {
        const pubStorageKey = `repositories/repo_oid_lock`;
        const initialRepo = createCommittedRepo(pubStorageKey, {
          '.env': 'SECRET_KEY=12345_should_not_leak',
          'spec.md': '# Spec V1\n'
        });
        const oldCommitOid = initialRepo.commitOid;

        const v2CommitOid = appendCommitToRepo(
          initialRepo.workTree,
          initialRepo.repoPath,
          { 'spec.md': '# Spec V2 (Public Tip)\n' },
          ['.env']
        );

        const repoId = 'repo_oid_lock';
        await ctx.d1.prepare(`
          INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
          VALUES (?, 'usr_nate', 'oid-lock-test', 'public', 'refs/heads/main', ?, 'active')
        `).bind(repoId, pubStorageKey).run();

        await ctx.d1.prepare(`
          INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version)
          VALUES (?, 'refs/heads/main', ?, 1)
        `).bind(repoId, v2CommitOid).run();

        const evilEnvReq = new Request(`https://nates.software/api/repo-file?repoId=${repoId}&commitOid=${oldCommitOid}&path=.env`);
        const evilEnvRes = await repoFileApi.onRequestGet({ request: evilEnvReq, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });

        expect(evilEnvRes.status).toBe(404);
        const envBody = await evilEnvRes.json();
        expect(envBody.success).toBe(false);

        const specReq = new Request(`https://nates.software/api/repo-file?repoId=${repoId}&commitOid=${oldCommitOid}&path=spec.md`);
        const specRes = await repoFileApi.onRequestGet({ request: specReq, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });

        expect(specRes.status).toBe(200);
        const specText = await specRes.text();
        expect(specText).toBe('# Spec V2 (Public Tip)\n');
        expect(specRes.headers.get('X-Gitsmith-Commit-Oid')).toBe(v2CommitOid);
      });

      it('HIGH FIX #1: Enforces status="active" — rejects non-active (archived, quarantined, provisioning) repos with 404', async () => {
        await ctx.d1.prepare(`UPDATE repositories SET status = 'archived' WHERE id = ?`).bind(publicRepoId).run();
        const reqArchived = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=spec.md`);
        const resArchived = await repoFileApi.onRequestGet({ request: reqArchived, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
        expect(resArchived.status).toBe(404);

        await ctx.d1.prepare(`UPDATE repositories SET status = 'quarantined' WHERE id = ?`).bind(publicRepoId).run();
        const reqQuarantined = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=spec.md`);
        const resQuarantined = await repoFileApi.onRequestGet({ request: reqQuarantined, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
        expect(resQuarantined.status).toBe(404);

        await ctx.d1.prepare(`UPDATE repositories SET status = 'provisioning' WHERE id = ?`).bind(publicRepoId).run();
        const reqProv = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=spec.md`);
        const resProv = await repoFileApi.onRequestGet({ request: reqProv, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
        expect(resProv.status).toBe(404);

        await ctx.d1.prepare(`UPDATE repositories SET status = 'active' WHERE id = ?`).bind(publicRepoId).run();
        const reqActive = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=spec.md`);
        const resActive = await repoFileApi.onRequestGet({ request: reqActive, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
        expect(resActive.status).toBe(200);
      });

      it('MEDIUM FIX #2: Enforces size caps (413 Payload Too Large) on oversized markdown and images', async () => {
        const largeStorageKey = 'repositories/repo_large_caps';
        const overLimitMarkdown = '# Large Spec\n' + 'A'.repeat(300 * 1024);
        const overLimitImage = Buffer.alloc(2.5 * 1024 * 1024, 0x50);

        const largeRepo = createCommittedRepo(largeStorageKey, {
          'large-spec.md': overLimitMarkdown,
          'large-image.png': overLimitImage
        });

        const repoId = 'repo_large_caps';
        await ctx.d1.prepare(`
          INSERT INTO repositories (id, owner_user_id, slug, visibility, default_ref, storage_key, status)
          VALUES (?, 'usr_nate', 'large-caps-test', 'public', 'refs/heads/main', ?, 'active')
        `).bind(repoId, largeStorageKey).run();

        await ctx.d1.prepare(`
          INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version)
          VALUES (?, 'refs/heads/main', ?, 1)
        `).bind(repoId, largeRepo.commitOid).run();

        const mdReq = new Request(`https://nates.software/api/repo-file?repoId=${repoId}&path=large-spec.md`);
        const mdRes = await repoFileApi.onRequestGet({ request: mdReq, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
        expect(mdRes.status).toBe(413);
        const mdBody = await mdRes.json();
        expect(mdBody.success).toBe(false);
        expect(mdBody.error).toContain('exceeds maximum allowed limit');

        const imgReq = new Request(`https://nates.software/api/repo-file?repoId=${repoId}&path=large-image.png`);
        const imgRes = await repoFileApi.onRequestGet({ request: imgReq, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
        expect(imgRes.status).toBe(413);
        const imgBody = await imgRes.json();
        expect(imgBody.success).toBe(false);
        expect(imgBody.error).toContain('exceeds maximum allowed limit');
      });

      it('LOW FIX #3: Never reflects gateway error text or authorization headers in responses or logs', async () => {
        const sensitiveGatewayToken = 'secret-gateway-bearer-token-1234567890';
        const mockGatewayFetch = vi.fn(async () => {
          throw new Error(`Failed to connect to gateway: Authorization Bearer ${sensitiveGatewayToken} connection refused`);
        });

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=spec.md`);
        const res = await repoFileApi.onRequestGet({
          request: req,
          env: {
            DB: ctx.d1,
            GITSMITH_GATEWAY_URL: 'https://gateway.example.com',
            GITSMITH_GATEWAY_TOKEN: sensitiveGatewayToken,
            __GITSMITH_GATEWAY_FETCH: mockGatewayFetch
          }
        });

        expect(res.status).toBe(502);
        const bodyText = await res.text();

        expect(bodyText).toBe(JSON.stringify({ success: false, error: 'Repository gateway unreachable' }));

        expect(bodyText).not.toContain('Bearer');
        expect(bodyText).not.toContain(sensitiveGatewayToken);
        expect(bodyText).not.toContain('connection refused');

        expect(consoleSpy).toHaveBeenCalled();
        const loggedArgs = consoleSpy.mock.calls.flat().join(' ');
        expect(loggedArgs).not.toContain(sensitiveGatewayToken);
        expect(loggedArgs).toContain('[REDACTED]');

        consoleSpy.mockRestore();
      });

      it('LOW FIX #4: Rejects ALL backslashes in file paths with 400', async () => {
        const backslashPaths = [
          'images\\secret.png',
          'foo\\bar/baz.png',
          '\\windows\\system32',
          'spec.md\\',
          'sub\\dir\\spec.md'
        ];

        for (const badPath of backslashPaths) {
          const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=${encodeURIComponent(badPath)}`);
          const res = await repoFileApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
          expect(res.status, `Path '${badPath}' must be rejected with 400`).toBe(400);
          const body = await res.json();
          expect(body.success).toBe(false);
          expect(body.error).toContain('backslashes');
        }
      });

      it('rejects path traversal attempts with 400', async () => {
        const traversalPaths = [
          '../secret.txt',
          '../../etc/passwd',
          'screenshots/../../secret.txt',
          '..',
          'foo/..',
          '/absolute/path/spec.md',
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

      describe('NSW-53: gateway /api/gateway/blob 404 must retry via /api/gateway/tree for text manifests', () => {
        it('recovers README.md when the blob endpoint 404s but the tree endpoint has manifestContents for it', async () => {
          // Reproduces the exact prod contract: /api/gateway/blob (readCommitFileBase64 ->
          // git cat-file -s "<oid>:<path>") can 404 for a file that is genuinely present
          // in the commit tree. The gateway also exposes /api/gateway/tree
          // (inspectCommitTree -> git ls-tree -r + per-file git show via manifestCandidates),
          // which is more resilient. repo-file.ts must retry through it for .md/.json/.txt
          // paths even when the blob call's failure was specifically a 404 (not just other
          // non-2xx statuses) -- previously the 404 branch returned early before the retry
          // could ever run.
          const mockGatewayFetch = vi.fn(async (url: string) => {
            const parsed = new URL(url);
            if (parsed.pathname === '/api/gateway/blob') {
              expect(parsed.searchParams.get('storageKey')).toBe(`repositories/${publicRepoId}`);
              expect(parsed.searchParams.get('commitOid')).toBe(publicCommitOid);
              expect(parsed.searchParams.get('path')).toBe('README.md');
              return new Response(JSON.stringify({ success: false, error: "File 'README.md' not found in commit." }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (parsed.pathname === '/api/gateway/tree') {
              expect(parsed.searchParams.get('storageKey')).toBe(`repositories/${publicRepoId}`);
              expect(parsed.searchParams.get('commitOid')).toBe(publicCommitOid);
              expect(parsed.searchParams.get('manifests')).toBe('README.md');
              return new Response(JSON.stringify({
                success: true,
                exists: true,
                storageKey: `repositories/${publicRepoId}`,
                commitOid: publicCommitOid,
                files: ['README.md'],
                manifestContents: {
                  'README.md': '# DroneHunter Idea Spec\n\nRecovered via tree fallback.\n'
                }
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            throw new Error(`Unexpected gateway path: ${parsed.pathname}`);
          });

          const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=README.md`);
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
          expect(text).toBe('# DroneHunter Idea Spec\n\nRecovered via tree fallback.\n');
          expect(mockGatewayFetch).toHaveBeenCalledTimes(2);
        });

        it('still returns a genuine 404 when both the blob AND tree endpoints agree the file is absent', async () => {
          const mockGatewayFetch = vi.fn(async (url: string) => {
            const parsed = new URL(url);
            if (parsed.pathname === '/api/gateway/blob') {
              return new Response(JSON.stringify({ success: false, error: "File 'ghost.md' not found in commit." }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (parsed.pathname === '/api/gateway/tree') {
              return new Response(JSON.stringify({
                success: true,
                exists: true,
                storageKey: `repositories/${publicRepoId}`,
                commitOid: publicCommitOid,
                files: ['spec.md', 'business.md'],
                manifestContents: {}
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            throw new Error(`Unexpected gateway path: ${parsed.pathname}`);
          });

          const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=ghost.md`);
          const res = await repoFileApi.onRequestGet({
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
          expect(body.error).toBe('File not found in repository');
        });

        it('returns a genuine 404 immediately for non-manifest extensions without attempting the tree fallback', async () => {
          const mockGatewayFetch = vi.fn(async (url: string) => {
            const parsed = new URL(url);
            if (parsed.pathname === '/api/gateway/blob') {
              return new Response(JSON.stringify({ success: false, error: "File 'hero.png' not found in commit." }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            throw new Error(`Tree endpoint must not be called for non-manifest extensions, got: ${parsed.pathname}`);
          });

          const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=missing.png`);
          const res = await repoFileApi.onRequestGet({
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
          expect(body.error).toBe('File not found in repository');
          expect(mockGatewayFetch).toHaveBeenCalledTimes(1);
        });

        it('falls through to a 502 (not a false 404) when the blob endpoint has a real non-404 failure and no tree recovery is possible', async () => {
          const mockGatewayFetch = vi.fn(async (url: string) => {
            const parsed = new URL(url);
            if (parsed.pathname === '/api/gateway/blob') {
              return new Response(JSON.stringify({ success: false, error: 'Endpoint not implemented' }), {
                status: 501,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (parsed.pathname === '/api/gateway/tree') {
              return new Response(JSON.stringify({ success: false, exists: false, error: 'gateway disk error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            throw new Error(`Unexpected gateway path: ${parsed.pathname}`);
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

          expect(res.status).toBe(502);
          const body = await res.json();
          expect(body.success).toBe(false);
          expect(body.error).toBe('Failed to retrieve file from repository gateway');
        });
      });

      describe('PROXY Bounded Stream Reader & Size Enforcement', () => {
        function createMockStream(chunkSize: number, totalChunks: number) {
          let chunksRead = 0;
          let cancelled = false;
          let cancelReason: any = null;

          const stream = new ReadableStream({
            pull(controller) {
              if (chunksRead < totalChunks) {
                chunksRead++;
                const chunk = new Uint8Array(chunkSize);
                chunk.fill(0x61);
                controller.enqueue(chunk);
              } else {
                controller.close();
              }
            },
            cancel(reason) {
              cancelled = true;
              cancelReason = reason;
            }
          });

          return {
            stream,
            getChunksRead: () => chunksRead,
            isCancelled: () => cancelled,
            getCancelReason: () => cancelReason
          };
        }

        it('helper: readBoundedBody successfully reads stream within byte limits', async () => {
          const smallContent = new TextEncoder().encode('Hello bounded world');
          const res = new Response(smallContent, {
            status: 200,
            headers: { 'Content-Length': String(smallContent.length) }
          });

          const result = await repoFileApi.readBoundedBody(res, 1024);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(new TextDecoder().decode(result.bytes)).toBe('Hello bounded world');
          }
        });

        it('helper: readBoundedBody fast-rejects if Content-Length header exceeds limit', async () => {
          const mockStream = createMockStream(1024, 10);
          const res = new Response(mockStream.stream, {
            status: 200,
            headers: { 'Content-Length': '2048' }
          });

          const result = await repoFileApi.readBoundedBody(res, 1024);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.status).toBe(413);
            expect(result.error).toContain('exceeds maximum allowed limit');
          }
          expect(mockStream.isCancelled()).toBe(true);
          expect(mockStream.getChunksRead()).toBe(0);
        });

        it('helper: readBoundedBody cancels stream and returns 413 when total read exceeds limit', async () => {
          const mockStream = createMockStream(100 * 1024, 50);
          const res = new Response(mockStream.stream, {
            status: 200
          });

          const result = await repoFileApi.readBoundedBody(res, 250 * 1024);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.status).toBe(413);
          }
          expect(mockStream.isCancelled()).toBe(true);
          expect(mockStream.getChunksRead()).toBeLessThanOrEqual(4);
          expect(mockStream.getChunksRead()).toBeGreaterThanOrEqual(3);
        });

        it('helper: readBoundedBody catches lying Content-Length via streaming bound', async () => {
          const mockStream = createMockStream(100 * 1024, 50);
          const res = new Response(mockStream.stream, {
            status: 200,
            headers: { 'Content-Length': '50' }
          });

          const result = await repoFileApi.readBoundedBody(res, 250 * 1024);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.status).toBe(413);
          }
          expect(mockStream.isCancelled()).toBe(true);
          expect(mockStream.getChunksRead()).toBeLessThanOrEqual(4);
        });

        it('proxy: gateway response whose body exceeds the cap returns 413 and cancels reader early', async () => {
          const mockStream = createMockStream(100 * 1024, 50);
          const mockGatewayFetch = vi.fn(async () => {
            return new Response(mockStream.stream, {
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

          expect(res.status).toBe(413);
          const body = await res.json();
          expect(body.success).toBe(false);
          expect(body.error).toContain('exceeds maximum allowed limit');

          expect(mockStream.isCancelled()).toBe(true);
          expect(mockStream.getChunksRead()).toBeLessThan(10);
        });

        it('proxy: gateway response with Content-Length header over cap fast-rejects with 413', async () => {
          const mockStream = createMockStream(100 * 1024, 50);
          const mockGatewayFetch = vi.fn(async () => {
            return new Response(mockStream.stream, {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': '10485760'
              }
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

          expect(res.status).toBe(413);
          const body = await res.json();
          expect(body.success).toBe(false);
          expect(body.error).toContain('exceeds maximum allowed limit');
          expect(mockStream.isCancelled()).toBe(true);
          expect(mockStream.getChunksRead()).toBeLessThanOrEqual(1);
        });

        it('proxy: lying Content-Length header is still caught and rejected with 413 via streaming bound', async () => {
          const mockStream = createMockStream(100 * 1024, 50);
          const mockGatewayFetch = vi.fn(async () => {
            return new Response(mockStream.stream, {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': '100'
              }
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

          expect(res.status).toBe(413);
          const body = await res.json();
          expect(body.success).toBe(false);
          expect(body.error).toContain('exceeds maximum allowed limit');
          expect(mockStream.isCancelled()).toBe(true);
          expect(mockStream.getChunksRead()).toBeLessThan(10);
        });

        it('proxy: fallback /tree path enforces bounded streaming read and returns 413 on over-cap stream', async () => {
          const mockTreeStream = createMockStream(100 * 1024, 50);
          const mockGatewayFetch = vi.fn(async (url: string) => {
            if (url.includes('/api/gateway/blob')) {
              return new Response(JSON.stringify({ success: false, error: 'Endpoint not implemented' }), {
                status: 501,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (url.includes('/api/gateway/tree')) {
              return new Response(mockTreeStream.stream, {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return new Response('Not found', { status: 404 });
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

          expect(res.status).toBe(413);
          const body = await res.json();
          expect(body.success).toBe(false);
          expect(body.error).toContain('exceeds maximum allowed limit');
          expect(mockTreeStream.isCancelled()).toBe(true);
          expect(mockTreeStream.getChunksRead()).toBeLessThan(12);
        });

        it('proxy: fallback /tree path successfully returns valid small markdown', async () => {
          const mockGatewayFetch = vi.fn(async (url: string) => {
            if (url.includes('/api/gateway/blob')) {
              return new Response(JSON.stringify({ success: false, error: 'Endpoint not implemented' }), {
                status: 501,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (url.includes('/api/gateway/tree')) {
              return new Response(JSON.stringify({
                success: true,
                manifestContents: {
                  'spec.md': '# Spec From Tree Fallback\n'
                }
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return new Response('Not found', { status: 404 });
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
          expect(text).toBe('# Spec From Tree Fallback\n');
        });

        it('proxy: normal small binary image via gateway returns 200 unchanged', async () => {
          const mockGatewayFetch = vi.fn(async () => {
            return new Response(JSON.stringify({
              success: true,
              storageKey: `repositories/${publicRepoId}`,
              commitOid: publicCommitOid,
              path: 'screenshots/hero.png',
              base64: samplePngBuffer.toString('base64')
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          });

          const req = new Request(`https://nates.software/api/repo-file?repoId=${publicRepoId}&path=screenshots/hero.png`);
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
          expect(res.headers.get('Content-Type')).toBe('image/png');
          const arrayBuf = await res.arrayBuffer();
          expect(Buffer.compare(Buffer.from(arrayBuf), samplePngBuffer)).toBe(0);
        });
      });
    });
  });
});
