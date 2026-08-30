import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  executeRigDeployBuild,
  getMediaType
} from '../src/lib/rig/deployExecutor';
import { MockDockerCommandRunner } from '../src/lib/rigDockerProvider';
import type { DeploymentPlan } from '../src/lib/deploymentLifecycle';

describe('RIG Deploy Executor Suite', () => {
  let tempDir: string;
  let jobsRoot: string;

  beforeEach(() => {
    tempDir = path.join('/tmp', `rig-deploy-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    jobsRoot = path.join(tempDir, 'jobs');
    fs.mkdirSync(jobsRoot, { recursive: true });
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  // Helper to create a tar buffer from files
  function createSourceArchive(files: Record<string, string>): Buffer {
    const srcDir = path.join(tempDir, `src-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(srcDir, { recursive: true });
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(srcDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    const tarPath = path.join(tempDir, `archive-${Math.random().toString(36).substring(2, 7)}.tar`);
    execFileSync('tar', ['-cf', tarPath, '-C', srcDir, '.'], { stdio: 'pipe' });
    return fs.readFileSync(tarPath);
  }

  describe('Media Type Mapping', () => {
    it('correctly identifies common web asset MIME types', () => {
      expect(getMediaType('index.html')).toBe('text/html; charset=utf-8');
      expect(getMediaType('app.js')).toBe('application/javascript; charset=utf-8');
      expect(getMediaType('styles.css')).toBe('text/css; charset=utf-8');
      expect(getMediaType('data.json')).toBe('application/json');
      expect(getMediaType('icon.svg')).toBe('image/svg+xml');
      expect(getMediaType('photo.png')).toBe('image/png');
      expect(getMediaType('unknown.bin')).toBe('application/octet-stream');
    });
  });

  describe('Static Application Build and Smoke Check', () => {
    it('builds static web app directly without buildCommand when index.html is present', async () => {
      const archive = createSourceArchive({
        'index.html': '<!DOCTYPE html><html><body><h1>Hello Static</h1></body></html>',
        'styles.css': 'body { color: blue; }'
      });

      const plan: DeploymentPlan = {
        detectedType: 'static',
        startCommand: 'static-pages-runtime',
        port: 80,
        healthEndpoint: '/',
        memoryMb: 128,
        entrypointFile: 'index.html',
        manifestApplied: false,
        inferredFrom: ['index.html']
      };

      const result = await executeRigDeployBuild({
        appId: 'static-app',
        repositoryId: 'repo_static_1',
        commitOid: 'a'.repeat(40),
        sourceArchive: archive,
        plan,
        jobsRoot
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.artifactKind).toBe('static');
      expect(result.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.staticFiles?.length).toBe(2);
      expect(result.smokeCheck.passed).toBe(true);
      expect(result.smokeCheck.statusCode).toBe(200);
      expect(result.smokeCheck.responseSnippet).toContain('Hello Static');
    });

    it('locates static output in out/ directory for Next.js static export', async () => {
      const archive = createSourceArchive({
        'package.json': JSON.stringify({ name: 'next-app', scripts: { build: 'next build' } }),
        'out/index.html': '<!DOCTYPE html><html><body><h1>Next Static Export</h1></body></html>',
        'out/_next/static/chunks/main.js': 'console.log("main chunk");'
      });

      const plan: DeploymentPlan = {
        detectedType: 'static',
        buildCommand: 'next build',
        startCommand: 'next start',
        port: 3000,
        healthEndpoint: '/',
        memoryMb: 256,
        entrypointFile: 'package.json',
        manifestApplied: false,
        inferredFrom: ['package.json']
      };

      const runner = new MockDockerCommandRunner();
      runner.setHandler('run', () => ({
        stdout: 'info  - Exported static site successfully',
        stderr: '',
        exitCode: 0
      }));

      const result = await executeRigDeployBuild({
        appId: 'next-app',
        repositoryId: 'repo_next_1',
        commitOid: 'b'.repeat(40),
        sourceArchive: archive,
        plan,
        jobsRoot,
        runner
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.artifactKind).toBe('static');
      expect(result.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.staticFiles?.some(f => f.path === 'index.html')).toBe(true);
      expect(result.smokeCheck.passed).toBe(true);
      expect(result.smokeCheck.responseSnippet).toContain('Next Static Export');
    });

    it('reports failure when container build command returns non-zero exit code', async () => {
      const archive = createSourceArchive({
        'package.json': JSON.stringify({ name: 'fail-app', scripts: { build: 'exit 1' } }),
        'src/index.js': 'console.log("fail");'
      });

      const plan: DeploymentPlan = {
        detectedType: 'node',
        buildCommand: 'npm run build',
        startCommand: 'npm start',
        port: 3000,
        healthEndpoint: '/',
        memoryMb: 256,
        entrypointFile: 'package.json',
        manifestApplied: false,
        inferredFrom: ['package.json']
      };

      const runner = new MockDockerCommandRunner();
      runner.setHandler('run', () => ({
        stdout: '',
        stderr: 'npm ERR! Command failed with exit code 1',
        exitCode: 1
      }));

      const result = await executeRigDeployBuild({
        appId: 'fail-app',
        repositoryId: 'repo_fail_1',
        commitOid: 'c'.repeat(40),
        sourceArchive: archive,
        plan,
        jobsRoot,
        runner
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Command failed with exit code 1');
      expect(result.smokeCheck.passed).toBe(false);
      expect(result.error).toContain('Build command failed with exit code 1');
    });
  });

  describe('Server Application Build & Smoke Check', () => {
    it('verifies server application entrypoint file in workspace', async () => {
      const archive = createSourceArchive({
        'requirements.txt': 'fastapi==0.110.0\n',
        'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n'
      });

      const plan: DeploymentPlan = {
        detectedType: 'python',
        buildCommand: 'pip install -r requirements.txt',
        startCommand: 'python main.py',
        port: 8000,
        healthEndpoint: '/',
        memoryMb: 256,
        entrypointFile: 'requirements.txt',
        manifestApplied: false,
        inferredFrom: ['requirements.txt']
      };

      const runner = new MockDockerCommandRunner();
      runner.setHandler('run', () => ({
        stdout: 'Successfully installed fastapi',
        stderr: '',
        exitCode: 0
      }));

      const result = await executeRigDeployBuild({
        appId: 'py-server',
        repositoryId: 'repo_py_server',
        commitOid: 'd'.repeat(40),
        sourceArchive: archive,
        plan,
        jobsRoot,
        runner
      });

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.artifactKind).toBe('bundle');
      expect(result.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.smokeCheck.passed).toBe(true);
    });
  });
});
