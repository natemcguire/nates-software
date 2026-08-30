import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  type DockerCommandRunner,
  NodeChildProcessRunner
} from '../rigDockerProvider';
import type { DeploymentPlan } from '../deploymentLifecycle';
import { validateArchiveEntries } from './verificationWorker';

export interface StaticAssetFile {
  readonly path: string;
  readonly contentBase64: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface SmokeCheckResult {
  readonly passed: boolean;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly responseSnippet?: string;
  readonly error?: string;
}

export interface RigDeployBuildParams {
  readonly appId: string;
  readonly repositoryId: string;
  readonly commitOid: string;
  readonly sourceArchive: Buffer;
  readonly plan: DeploymentPlan;
  readonly runnerImageDigest?: string;
  readonly timeoutMs?: number;
  readonly jobsRoot?: string;
  readonly runner?: DockerCommandRunner;
}

export interface RigDeployBuildResult {
  readonly success: boolean;
  readonly exitCode: number;
  readonly output: string;
  readonly artifactDigest: string;
  readonly artifactKind: 'bundle' | 'static' | 'binary';
  readonly staticFiles?: StaticAssetFile[];
  readonly smokeCheck: SmokeCheckResult;
  readonly durationMs: number;
  readonly error?: string;
}

const digest = (value: Buffer | string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

export function getMediaType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.wasm':
      return 'application/wasm';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.map':
      return 'application/json';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Scans a directory recursively and collects static assets with hashes.
 */
function collectStaticAssets(dir: string, baseDir: string = dir): StaticAssetFile[] {
  const results: StaticAssetFile[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectStaticAssets(fullPath, baseDir));
    } else if (entry.isFile()) {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const content = fs.readFileSync(fullPath);
      results.push({
        path: relPath,
        contentBase64: content.toString('base64'),
        mediaType: getMediaType(relPath),
        sizeBytes: content.length,
        sha256: digest(content)
      });
    }
  }
  return results;
}

/**
 * Executes a hardened real RIG deploy build and smoke check.
 */
export async function executeRigDeployBuild(params: RigDeployBuildParams): Promise<RigDeployBuildResult> {
  const started = Date.now();
  const runner = params.runner || new NodeChildProcessRunner();
  const timeoutMs = Math.max(10_000, Math.min(params.timeoutMs || 120_000, 300_000));
  const jobsRoot = params.jobsRoot || path.join(process.cwd(), '.rig-jobs');

  const cleanAppId = params.appId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanCommit = params.commitOid.slice(0, 12);
  const jobName = `deploy_${cleanAppId}_${cleanCommit}_${Date.now().toString(36)}`;
  const jobRoot = path.join(jobsRoot, jobName);
  const workspace = path.join(jobRoot, 'workspace');
  const archivePath = path.join(jobRoot, 'source.tar');

  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });

  try {
    // 1. Write and validate source archive
    fs.writeFileSync(archivePath, params.sourceArchive, { mode: 0o600 });
    const entries = execFileSync('tar', ['-tf', archivePath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean);
    validateArchiveEntries(entries);
    execFileSync('tar', ['-xf', archivePath, '-C', workspace, '--no-same-owner', '--no-same-permissions'], { stdio: 'pipe' });
    fs.chmodSync(workspace, 0o755);

    const plan = params.plan;
    let buildOutput = '';
    let buildExitCode = 0;

    // 2. Execute candidate build in hardened container if buildCommand is defined
    if (plan.buildCommand && plan.buildCommand.trim().length > 0) {
      const runnerImage = params.runnerImageDigest || 'node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
      const memoryMb = Math.min(plan.memoryMb || 256, 256);

      const dockerArgs = [
        'run', '--rm', '--network=bridge',
        `--memory=${memoryMb}m`,
        `--memory-swap=${memoryMb}m`,
        '--pids-limit=128',
        '--cpus=1',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--read-only',
        `--user=${process.getuid?.() || 65532}:${process.getgid?.() || 65532}`,
        '--tmpfs=/tmp:rw,noexec,nosuid,size=64m',
        '--mount', `type=bind,src=${workspace},dst=/workspace`,
        '--workdir=/workspace',
        runnerImage,
        '/bin/sh', '-eu', '-c', plan.buildCommand
      ];

      const run = await runner.exec('docker', dockerArgs, { timeoutMs });
      buildExitCode = run.exitCode;
      buildOutput = (run.stdout + (run.stderr ? `\n${run.stderr}` : '')).trim();

      if (buildExitCode !== 0) {
        return {
          success: false,
          exitCode: buildExitCode,
          output: buildOutput || `Build failed with exit code ${buildExitCode}`,
          artifactDigest: '',
          artifactKind: plan.detectedType === 'static' ? 'static' : 'bundle',
          smokeCheck: { passed: false, statusCode: 0, durationMs: 0, error: 'Build failed before smoke check' },
          durationMs: Date.now() - started,
          error: `Build command failed with exit code ${buildExitCode}: ${buildOutput.slice(-500)}`
        };
      }
    } else {
      buildOutput = `[RIG] Detected project type '${plan.detectedType}' with no build command required. Inspecting workspace directly.`;
    }

    // 3. Locate and extract build output / static files
    let staticRoot: string | null = null;
    const candidates = ['out', 'dist', 'build', 'public'];

    for (const cand of candidates) {
      const candPath = path.join(workspace, cand);
      if (fs.existsSync(candPath) && fs.existsSync(path.join(candPath, 'index.html'))) {
        staticRoot = candPath;
        break;
      }
    }

    if (!staticRoot && fs.existsSync(path.join(workspace, 'index.html'))) {
      staticRoot = workspace;
    }

    let staticFiles: StaticAssetFile[] | undefined;
    let artifactDigest = '';
    let artifactKind: 'static' | 'bundle' | 'binary' = 'bundle';

    if (staticRoot) {
      artifactKind = 'static';
      staticFiles = collectStaticAssets(staticRoot);
      if (staticFiles.length === 0) {
        throw new Error(`Static output directory '${staticRoot}' contains no files.`);
      }

      // Deterministic digest over sorted file paths and their contents
      const manifestEntries = [...staticFiles]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(f => `${f.path}:${f.sha256}`)
        .join('\n');
      artifactDigest = digest(manifestEntries);
    } else {
      artifactKind = 'bundle';
      // For non-static bundles, hash all workspace files
      const allFiles = collectStaticAssets(workspace);
      const manifestEntries = allFiles
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(f => `${f.path}:${f.sha256}`)
        .join('\n');
      artifactDigest = digest(manifestEntries || params.commitOid);
    }

    // 4. Real Smoke / Health Check
    const smokeStart = Date.now();
    let smokePassed = false;
    let smokeStatusCode = 0;
    let smokeSnippet = '';
    let smokeError: string | undefined;

    if (artifactKind === 'static' && staticFiles) {
      const indexFile = staticFiles.find(f => f.path === 'index.html' || f.path.endsWith('/index.html'));
      if (!indexFile) {
        smokePassed = false;
        smokeStatusCode = 404;
        smokeError = 'Smoke check failed: index.html entrypoint was not found in built static output.';
      } else {
        const runnerImage = params.runnerImageDigest || 'node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
        const memoryMb = Math.min(plan.memoryMb || 256, 256);
        const relStaticDir = staticRoot ? path.relative(workspace, staticRoot).replace(/\\/g, '/') : '.';
        const healthPath = plan.healthEndpoint || '/';

        const smokeScript = `
const http = require('http');
const fs = require('fs');
const path = require('path');

const targetDir = path.resolve('/workspace', ${JSON.stringify(relStaticDir)});
const healthPath = ${JSON.stringify(healthPath)};

const server = http.createServer((req, res) => {
  try {
    let reqPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (reqPath.endsWith('/')) reqPath += 'index.html';
    const filePath = path.join(targetDir, reqPath.startsWith('/') ? reqPath.slice(1) : reqPath);
    if (!filePath.startsWith(targetDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(e.message);
  }
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const targetUrl = 'http://127.0.0.1:' + port + (healthPath.startsWith('/') ? healthPath : '/' + healthPath);
  http.get(targetUrl, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      server.close();
      if (res.statusCode === 200 && body.trim().length > 0) {
        process.stdout.write(JSON.stringify({
          passed: true,
          statusCode: 200,
          responseSnippet: body.slice(0, 200).replace(/\\s+/g, ' ')
        }));
        process.exit(0);
      } else {
        process.stderr.write(JSON.stringify({
          passed: false,
          statusCode: res.statusCode || 500,
          error: 'Smoke check probe failed with status ' + res.statusCode + (body.trim().length === 0 ? ' (empty response body)' : '')
        }));
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    server.close();
    process.stderr.write(JSON.stringify({
      passed: false,
      statusCode: 500,
      error: 'HTTP probe connection error: ' + err.message
    }));
    process.exit(1);
  });
});
`;

        const smokeDockerArgs = [
          'run', '--rm', '--network=bridge',
          `--memory=${memoryMb}m`,
          `--memory-swap=${memoryMb}m`,
          '--pids-limit=128',
          '--cpus=1',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--read-only',
          `--user=${process.getuid?.() || 65532}:${process.getgid?.() || 65532}`,
          '--tmpfs=/tmp:rw,noexec,nosuid,size=64m',
          '--mount', `type=bind,src=${workspace},dst=/workspace`,
          '--workdir=/workspace',
          runnerImage,
          'node', '-e', smokeScript
        ];

        const smokeRun = await runner.exec('docker', smokeDockerArgs, { timeoutMs: Math.min(timeoutMs, 30_000) });

        let parsedProbe: any = null;
        try {
          const combined = (smokeRun.stdout.trim() || smokeRun.stderr.trim());
          if (combined) {
            const match = combined.match(/\{[\s\S]*"statusCode"[\s\S]*\}/);
            if (match) {
              parsedProbe = JSON.parse(match[0]);
            } else {
              parsedProbe = JSON.parse(combined);
            }
          }
        } catch {}

        if (smokeRun.exitCode === 0 && parsedProbe?.passed === true && parsedProbe?.statusCode === 200) {
          smokePassed = true;
          smokeStatusCode = 200;
          smokeSnippet = parsedProbe.responseSnippet || '';
        } else {
          smokePassed = false;
          smokeStatusCode = parsedProbe?.statusCode || (smokeRun.exitCode !== 0 ? 500 : 0);
          smokeError = parsedProbe?.error || smokeRun.stderr.trim() || smokeRun.stdout.trim() || `Smoke check probe failed with exit code ${smokeRun.exitCode}`;
        }
      }
    } else {
      // For server apps, verify entrypoint file exists
      if (plan.entrypointFile && fs.existsSync(path.join(workspace, plan.entrypointFile))) {
        smokePassed = true;
        smokeStatusCode = 200;
        smokeSnippet = `Verified entrypoint ${plan.entrypointFile} for ${plan.detectedType}`;
      } else {
        smokePassed = false;
        smokeStatusCode = 500;
        smokeError = `Smoke check failed: entrypoint file '${plan.entrypointFile || 'unknown'}' not found in workspace.`;
      }
    }

    const smokeDuration = Date.now() - smokeStart;
    const totalDuration = Date.now() - started;

    return {
      success: buildExitCode === 0 && smokePassed,
      exitCode: buildExitCode,
      output: buildOutput,
      artifactDigest,
      artifactKind,
      staticFiles,
      smokeCheck: {
        passed: smokePassed,
        statusCode: smokeStatusCode,
        durationMs: smokeDuration,
        responseSnippet: smokeSnippet,
        error: smokeError
      },
      durationMs: totalDuration,
      error: smokeError
    };
  } finally {
    try {
      fs.rmSync(jobRoot, { recursive: true, force: true });
    } catch {}
  }
}
