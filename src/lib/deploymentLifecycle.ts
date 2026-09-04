import type { AppDeploymentState } from '../data/mockData';
export type { AppDeploymentState };

export const APP_DEPLOYMENT_STATES: readonly AppDeploymentState[] = [
  'draft',
  'source_ready',
  'building',
  'deployable',
  'active',
  'failed',
  'retired',
  'client_demo'
] as const;

export const DEPLOYMENT_STATE_TRANSITIONS: Readonly<Record<AppDeploymentState, readonly AppDeploymentState[]>> = {
  draft: ['source_ready', 'building', 'failed', 'retired', 'client_demo'],
  source_ready: ['building', 'failed', 'retired', 'draft'],
  building: ['deployable', 'active', 'failed', 'retired'],
  deployable: ['active', 'building', 'failed', 'retired'],
  active: ['building', 'deployable', 'failed', 'retired'],
  failed: ['source_ready', 'building', 'draft', 'retired'],
  retired: ['draft', 'source_ready'],
  client_demo: ['draft', 'source_ready', 'retired']
};

export function isValidDeploymentState(state: unknown): state is AppDeploymentState {
  return typeof state === 'string' && (APP_DEPLOYMENT_STATES as readonly string[]).includes(state);
}

export function canTransitionDeploymentState(from: AppDeploymentState, to: AppDeploymentState): boolean {
  if (from === to) return true;
  return DEPLOYMENT_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

export type RigProjectType =
  | 'node'
  | 'docker'
  | 'python'
  | 'rust'
  | 'go'
  | 'static'
  | 'worker-pages'
  | 'next-worker'
  | 'unsupported';

export interface StorageVolumeDeclaration {
  readonly name?: string;
  readonly mountPath: string;
  readonly persistence?: 'ephemeral' | 'persistent' | 'retained';
  readonly sizeMb?: number;
}

export interface DeploymentPlan {
  readonly detectedType: RigProjectType;
  readonly buildCommand?: string;
  readonly startCommand: string;
  readonly port: number;
  readonly healthEndpoint: string;
  readonly healthCommand?: string;
  readonly memoryMb: number;
  readonly env?: Record<string, string>;
  readonly volumes?: StorageVolumeDeclaration[];
  readonly entrypointFile?: string;
  readonly manifestApplied: boolean;
  readonly manifestFile?: string;
  readonly inferredFrom: string[];
  readonly postgres?: boolean;
}

export interface DeploymentPlanResult {
  readonly success: boolean;
  readonly isDeployable: boolean;
  readonly detectedType: RigProjectType;
  readonly plan?: DeploymentPlan;
  readonly error?: string;
  readonly reasons: string[];
  readonly repoSizeBytes?: number;
}

export interface DeploymentEvidence {
  readonly stage: 'detection' | 'source_verification' | 'build' | 'smoke_check' | 'promotion' | 'runtime';
  readonly timestamp: string;
  readonly details: string;
  readonly logs?: string[];
  readonly detectedType?: string;
  readonly plan?: DeploymentPlan;
  readonly exitCode?: number;
  readonly error?: string;
  readonly repositoryId?: string;
  readonly commitOid?: string;
  readonly buildRunId?: string;
  readonly deploymentRevisionId?: string;
}

export interface DeploymentExecutionResult {
  readonly success: boolean;
  readonly finalState: AppDeploymentState;
  readonly appId: string;
  readonly plan?: DeploymentPlan;
  readonly deploymentRevisionId?: string;
  readonly activeUrl?: string;
  readonly error?: string;
  readonly evidence: DeploymentEvidence;
  readonly logs: string[];
}

export function parseManifestOverride(
  manifestContent: string | Record<string, any>
): {
  buildCommand?: string;
  startCommand?: string;
  port?: number;
  healthEndpoint?: string;
  healthCommand?: string;
  memoryMb?: number;
  volumes?: StorageVolumeDeclaration[];
  env?: Record<string, string>;
  postgres?: boolean;
} | null {
  try {
    const data = typeof manifestContent === 'string' ? JSON.parse(manifestContent) : manifestContent;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const result: any = {};

    if (typeof data.buildCommand === 'string' && data.buildCommand.trim()) {
      result.buildCommand = data.buildCommand.trim();
    } else if (typeof data.build_command === 'string' && data.build_command.trim()) {
      result.buildCommand = data.build_command.trim();
    } else if (typeof data.build === 'string' && data.build.trim()) {
      result.buildCommand = data.build.trim();
    }

    if (typeof data.startCommand === 'string' && data.startCommand.trim()) {
      result.startCommand = data.startCommand.trim();
    } else if (typeof data.start_command === 'string' && data.start_command.trim()) {
      result.startCommand = data.start_command.trim();
    } else if (typeof data.start === 'string' && data.start.trim()) {
      result.startCommand = data.start.trim();
    }

    const rawPort = data.port ?? data.targetPort ?? data.target_port;
    if (typeof rawPort === 'number' && Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535) {
      result.port = rawPort;
    } else if (typeof rawPort === 'string' && /^\d+$/.test(rawPort)) {
      const p = parseInt(rawPort, 10);
      if (p > 0 && p <= 65535) result.port = p;
    }

    if (typeof data.healthEndpoint === 'string' && data.healthEndpoint.trim()) {
      result.healthEndpoint = data.healthEndpoint.trim();
    } else if (typeof data.health_endpoint === 'string' && data.health_endpoint.trim()) {
      result.healthEndpoint = data.health_endpoint.trim();
    } else if (typeof data.healthCheck === 'string' && data.healthCheck.trim()) {
      result.healthEndpoint = data.healthCheck.trim();
    } else if (typeof data.health_check === 'string' && data.health_check.trim()) {
      result.healthEndpoint = data.health_check.trim();
    }

    if (typeof data.healthCommand === 'string' && data.healthCommand.trim()) {
      result.healthCommand = data.healthCommand.trim();
    }

    const rawMem = data.memoryMb ?? data.memory_mb ?? data.memoryCapMb ?? data.memory;
    if (typeof rawMem === 'number' && rawMem > 0) {
      result.memoryMb = Math.min(Math.round(rawMem), 256);
    } else if (typeof rawMem === 'string' && /^\d+/.test(rawMem)) {
      const m = parseInt(rawMem, 10);
      if (m > 0) result.memoryMb = Math.min(m, 256);
    }

    const rawVolumes = data.volumes ?? data.storage ?? data.mounts;
    if (Array.isArray(rawVolumes)) {
      result.volumes = rawVolumes
        .filter((v: any) => v && typeof v === 'object' && typeof (v.mountPath || v.mount_path || v.path) === 'string')
        .map((v: any) => ({
          name: typeof v.name === 'string' ? v.name : undefined,
          mountPath: String(v.mountPath || v.mount_path || v.path).trim(),
          persistence: ['ephemeral', 'persistent', 'retained'].includes(v.persistence) ? v.persistence : 'ephemeral',
          sizeMb: typeof v.sizeMb === 'number' ? v.sizeMb : undefined
        }));
    }

    const rawEnv = data.env ?? data.envVars ?? data.env_vars;
    if (rawEnv && typeof rawEnv === 'object' && !Array.isArray(rawEnv)) {
      const cleanEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawEnv)) {
        if (typeof k === 'string' && k.trim() && typeof v === 'string') {
          cleanEnv[k.trim()] = v;
        }
      }
      result.env = cleanEnv;
    }

    if (typeof data.postgres === 'boolean') {
      result.postgres = data.postgres;
    } else if (typeof data.postgres === 'string') {
      result.postgres = data.postgres.toLowerCase() === 'true';
    }

    return result;
  } catch {
    return null;
  }
}

function isRealBuildCommand(cmd: string | undefined): boolean {
  if (!cmd || typeof cmd !== 'string') return false;
  const trimmed = cmd.trim();
  if (!trimmed) return false;
  if (trimmed === ':' || trimmed === 'true' || trimmed === 'exit 0') return false;
  if (/^echo(\s+|$)/i.test(trimmed)) return false;
  if (/^exit\s+0$/i.test(trimmed)) return false;
  return true;
}

function isStaticServeCommand(cmd: string | undefined): boolean {
  if (!cmd || typeof cmd !== 'string') return false;
  const trimmed = cmd.trim().toLowerCase();
  return (
    trimmed.startsWith('npx serve') ||
    trimmed.startsWith('serve ') ||
    trimmed === 'serve' ||
    trimmed.startsWith('npx http-server') ||
    trimmed.startsWith('http-server') ||
    trimmed.startsWith('npx live-server') ||
    trimmed.startsWith('live-server') ||
    trimmed.startsWith('npx browser-sync') ||
    trimmed.startsWith('browser-sync')
  );
}

function extractPythonDependencies(
  getContent: (pattern: string) => string | undefined
): string[] {
  const deps: string[] = [];

  const extractReqLines = (content: string) => {
    for (let line of content.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#') || line.startsWith('-')) continue;
      const hashIdx = line.indexOf('#');
      if (hashIdx !== -1) {
        line = line.slice(0, hashIdx).trim();
      }
      const match = line.match(/^([a-zA-Z0-9_\-\.]+)/);
      if (match && match[1]) {
        deps.push(match[1].toLowerCase());
      }
    }
  };

  const reqContent = getContent('requirements.txt');
  if (reqContent) {
    extractReqLines(reqContent);
  }

  const pyprojectContent = getContent('pyproject.toml');
  if (pyprojectContent) {
    const extractDepsFromArray = (arrayText: string) => {
      const stringMatches = arrayText.matchAll(/["']\s*([a-zA-Z0-9_\-\.]+)[^"']*["']/g);
      for (const match of stringMatches) {
        if (match[1]) {
          deps.push(match[1].toLowerCase());
        }
      }
    };

    const projectDepMatch = pyprojectContent.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/i);
    if (projectDepMatch && projectDepMatch[1]) {
      extractDepsFromArray(projectDepMatch[1]);
    }

    const optDepMatch = pyprojectContent.match(/\[project\.optional-dependencies\]([\s\S]*?)(?:^\[|\z)/im);
    if (optDepMatch && optDepMatch[1]) {
      const arrayMatches = optDepMatch[1].matchAll(/=\s*\[([\s\S]*?)\]/g);
      for (const arr of arrayMatches) {
        if (arr[1]) {
          extractDepsFromArray(arr[1]);
        }
      }
    }

    if (!projectDepMatch) {
      const genericDepMatch = pyprojectContent.match(/dependencies\s*=\s*\[([\s\S]*?)\]/i);
      if (genericDepMatch && genericDepMatch[1]) {
        extractDepsFromArray(genericDepMatch[1]);
      }
    }

    const poetryMatch = pyprojectContent.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:^\[|\z)/im);
    if (poetryMatch && poetryMatch[1]) {
      for (const line of poetryMatch[1].split('\n')) {
        const match = line.match(/^\s*([a-zA-Z0-9_\-\.]+)\s*=/);
        if (match && match[1] && match[1].toLowerCase() !== 'python') {
          deps.push(match[1].toLowerCase());
        }
      }
    }
  }

  const pipfileContent = getContent('pipfile');
  if (pipfileContent) {
    const packagesMatch = pipfileContent.match(/\[packages\]([\s\S]*?)(?:^\[|\z)/im);
    if (packagesMatch && packagesMatch[1]) {
      for (const line of packagesMatch[1].split('\n')) {
        const match = line.match(/^\s*([a-zA-Z0-9_\-\.]+)\s*=/);
        if (match && match[1]) {
          deps.push(match[1].toLowerCase());
        }
      }
    }
  }

  return deps;
}

export function detectRigRuntime(
  files: string[],
  fileContents: Record<string, string> = {}
): DeploymentPlanResult {
  const normalizedFiles = (Array.isArray(files) ? files : [])
    .filter((f): f is string => typeof f === 'string')
    .map(f => f.replace(/^\/+/, '').trim());
  const fileSet = new Set(normalizedFiles.map(f => f.toLowerCase()));
  const hasStaticEntry = fileSet.has('index.html') || fileSet.has('public/index.html') || fileSet.has('dist/index.html');
  const staticEntry = fileSet.has('index.html') ? 'index.html' : (fileSet.has('dist/index.html') ? 'dist/index.html' : 'public/index.html');

  const manifestCandidates = ['slop.json', 'deploy.json', 'rig.json', 'app.json', 'manifest.json'];
  let manifestFile: string | undefined;
  let manifestOverrides: ReturnType<typeof parseManifestOverride> = null;

  for (const m of manifestCandidates) {
    const matching = normalizedFiles.find(f => f.toLowerCase() === m || f.toLowerCase().endsWith(`/${m}`));
    if (matching && fileContents[matching]) {
      manifestFile = matching;
      manifestOverrides = parseManifestOverride(fileContents[matching]);
      if (manifestOverrides) break;
    }
  }

  const getContent = (pattern: string): string | undefined => {
    const key = Object.keys(fileContents).find(k => k.toLowerCase() === pattern.toLowerCase() || k.toLowerCase().endsWith(`/${pattern.toLowerCase()}`));
    return key ? fileContents[key] : undefined;
  };

  if (fileSet.has('dockerfile') || Array.from(fileSet).some(f => f.endsWith('/dockerfile') || f.endsWith('.dockerfile'))) {
    const dockerContent = getContent('dockerfile') || '';
    let exposedPort = 8080;
    const exposeMatch = dockerContent.match(/EXPOSE\s+(\d+)/i);
    if (exposeMatch && exposeMatch[1]) {
      exposedPort = parseInt(exposeMatch[1], 10);
    }

    const defaultPlan: DeploymentPlan = {
      detectedType: 'docker',
      buildCommand: 'docker build -t app .',
      startCommand: 'docker run -p ${PORT}:' + exposedPort + ' app',
      port: exposedPort,
      healthEndpoint: '/',
      memoryMb: 256,
      entrypointFile: 'Dockerfile',
      manifestApplied: false,
      inferredFrom: ['Dockerfile']
    };

    const finalPlan = applyManifest(defaultPlan, manifestOverrides, manifestFile);
    return {
      success: true,
      isDeployable: true,
      detectedType: 'docker',
      plan: finalPlan,
      reasons: ['Dockerfile detected with container isolation build plan.']
    };
  }

  if (fileSet.has('package.json')) {
    const pkgForNextContent = getContent('package.json');
    let pkgForNext: any = {};
    if (pkgForNextContent) {
      try { pkgForNext = JSON.parse(pkgForNextContent); } catch {}
    }
    const hasNextDep = Boolean(pkgForNext?.dependencies?.next || pkgForNext?.devDependencies?.next);
    const hasNextConfig = fileSet.has('next.config.js') || fileSet.has('next.config.mjs') || fileSet.has('next.config.ts');
    const hasAppOrPages = normalizedFiles.some(f => {
      const l = f.toLowerCase();
      return l === 'app' || l.startsWith('app/') || l === 'pages' || l.startsWith('pages/');
    });
    const isNext = hasNextDep && (hasNextConfig || hasAppOrPages);

    if (isNext) {
      const nextConfigFilename = fileSet.has('next.config.js')
        ? 'next.config.js'
        : fileSet.has('next.config.mjs')
          ? 'next.config.mjs'
          : fileSet.has('next.config.ts')
            ? 'next.config.ts'
            : undefined;
      const nextConfigContent = getContent('next.config.js') || getContent('next.config.mjs') || getContent('next.config.ts') || '';
      const isStaticExport = /output\s*:\s*['"]export['"]/.test(nextConfigContent);

      const reasons: string[] = [];
      if (isStaticExport) {
        reasons.push('Next.js static-export detected; served via SSR-capable worker lane in v1.');
      } else {
        reasons.push('Next.js application detected with OpenNext Cloudflare Worker deployment plan.');
      }

      const defaultPlan: DeploymentPlan = {
        detectedType: 'next-worker',
        buildCommand: 'npx opennextjs-cloudflare build',
        startCommand: 'opennext-worker-runtime',
        port: 0,
        healthEndpoint: '/',
        memoryMb: 128,
        env: { NEXT_OUTPUT: isStaticExport ? 'export' : 'ssr' },
        entrypointFile: nextConfigFilename || 'package.json',
        manifestApplied: false,
        inferredFrom: ['package.json', nextConfigFilename ? 'next.config' : 'app/pages']
      };

      const finalPlan = applyManifest(defaultPlan, manifestOverrides, manifestFile);
      return {
        success: true,
        isDeployable: true,
        detectedType: 'next-worker',
        plan: finalPlan,
        reasons
      };
    }
  }

  if (fileSet.has('package.json')) {
    const pkgContent = getContent('package.json');
    let pkg: any = {};
    if (pkgContent) {
      try { pkg = JSON.parse(pkgContent); } catch {}
    }

    const rawBuild = typeof pkg?.scripts?.build === 'string' ? pkg.scripts.build : undefined;
    const rawStart = typeof pkg?.scripts?.start === 'string' ? pkg.scripts.start : undefined;
    const hasBuildScript = isRealBuildCommand(rawBuild);
    const hasStartScript = Boolean(rawStart && rawStart.trim().length > 0 && !isStaticServeCommand(rawStart));
    const mainField = typeof pkg?.main === 'string' ? pkg.main.trim() : '';
    const mainIsHtml = mainField.toLowerCase().endsWith('.html') || mainField.toLowerCase().endsWith('.htm');

    if (hasStaticEntry && !hasBuildScript && (!hasStartScript || isStaticServeCommand(rawStart))) {
      const hasServerFile = !mainIsHtml && (fileSet.has('server.js') || fileSet.has('server.mjs') || fileSet.has('server.ts') || fileSet.has('app.js'));
      if (!hasServerFile) {
        const defaultPlan: DeploymentPlan = {
          detectedType: 'static',
          buildCommand: undefined,
          startCommand: 'static-pages-runtime',
          port: 80,
          healthEndpoint: '/',
          memoryMb: 128,
          entrypointFile: staticEntry,
          manifestApplied: false,
          inferredFrom: ['package.json', staticEntry]
        };

        const finalPlan = applyManifest(defaultPlan, manifestOverrides, manifestFile);
        return {
          success: true,
          isDeployable: true,
          detectedType: 'static',
          plan: finalPlan,
          reasons: [`Static web entrypoint found at '${staticEntry}' with no Node build/server script required.`]
        };
      }
    }

    const mainCandidate = mainField || (fileSet.has('index.js') ? 'index.js' : (fileSet.has('server.js') ? 'server.js' : (fileSet.has('app.js') ? 'app.js' : 'dist/index.js')));
    const mainFile = mainIsHtml ? (fileSet.has('index.js') ? 'index.js' : (fileSet.has('server.js') ? 'server.js' : (fileSet.has('app.js') ? 'app.js' : 'index.js'))) : mainCandidate;

    const hasLockfile = fileSet.has('package-lock.json') || fileSet.has('npm-shrinkwrap.json');
    const installCmd = hasLockfile
      ? 'npm ci --no-audit --no-fund || npm install --no-audit --no-fund'
      : 'npm install --no-audit --no-fund';
    const buildCmd = hasBuildScript ? `${installCmd} && npm run build` : undefined;
    const startCmd = hasStartScript ? 'npm start' : (mainIsHtml ? 'static-pages-runtime' : `node ${mainFile}`);

    const defaultPlan: DeploymentPlan = {
      detectedType: 'node',
      buildCommand: buildCmd,
      startCommand: startCmd,
      port: 3000,
      healthEndpoint: '/',
      memoryMb: 256,
      entrypointFile: 'package.json',
      manifestApplied: false,
      inferredFrom: ['package.json']
    };

    const finalPlan = applyManifest(defaultPlan, manifestOverrides, manifestFile);
    return {
      success: true,
      isDeployable: true,
      detectedType: 'node',
      plan: finalPlan,
      reasons: ['Node.js project detected from package.json.']
    };
  }

  if (fileSet.has('requirements.txt') || fileSet.has('pyproject.toml') || fileSet.has('pipfile')) {
    const pyDeps = extractPythonDependencies(getContent);
    const hasFastApi = pyDeps.some(d => /(^|[^a-z])fastapi/i.test(d));
    const hasUvicorn = pyDeps.some(d => d === 'uvicorn' || /(^|[^a-z])uvicorn/i.test(d));
    const hasGunicorn = pyDeps.some(d => d === 'gunicorn' || /(^|[^a-z])gunicorn/i.test(d));
    const hasWsgi = pyDeps.some(d => /(^|[^a-z])(flask|django)([^a-z]|$)/i.test(d));
    const hasProcfile = fileSet.has('procfile');

    const inferredEntry = fileSet.has('main.py') ? 'main.py' : (fileSet.has('app.py') ? 'app.py' : 'main.py');
    const moduleName = inferredEntry.replace(/\.py$/i, '').split('/').pop() || 'main';
    const inferredBuild = fileSet.has('requirements.txt') ? 'pip install -r requirements.txt' : (fileSet.has('pyproject.toml') ? 'pip install -e .' : undefined);

    let startCmd: string;
    if (hasFastApi || hasUvicorn) {
      startCmd = `uvicorn ${moduleName}:app --host 0.0.0.0 --port $PORT`;
    } else if (hasGunicorn) {
      startCmd = `gunicorn --bind 0.0.0.0:$PORT ${moduleName}:app`;
    } else if (hasWsgi && !hasProcfile && !manifestOverrides?.startCommand) {
      const guidance = "Add gunicorn (or uvicorn) to requirements.txt, or declare a Procfile 'web:' line.";
      return {
        success: false,
        isDeployable: false,
        detectedType: 'python',
        error: `WSGI web framework detected without a production application server. ${guidance}`,
        reasons: [guidance]
      };
    } else {
      startCmd = `python ${inferredEntry}`;
    }

    const inferredFrom: string[] = [];
    if (fileSet.has('requirements.txt')) inferredFrom.push('requirements.txt');
    if (fileSet.has('pyproject.toml')) inferredFrom.push('pyproject.toml');
    if (fileSet.has('pipfile')) inferredFrom.push('Pipfile');
    if (inferredFrom.length === 0) inferredFrom.push('requirements.txt');

    const defaultPlan: DeploymentPlan = {
      detectedType: 'python',
      buildCommand: inferredBuild,
      startCommand: startCmd,
      port: 8000,
      healthEndpoint: '/',
      memoryMb: 256,
      entrypointFile: fileSet.has('requirements.txt') ? 'requirements.txt' : (fileSet.has('pyproject.toml') ? 'pyproject.toml' : 'Pipfile'),
      manifestApplied: false,
      inferredFrom
    };

    const finalPlan = applyManifest(defaultPlan, manifestOverrides, manifestFile);
    return {
      success: true,
      isDeployable: true,
      detectedType: 'python',
      plan: finalPlan,
      reasons: ['Python runtime detected from requirements.txt / pyproject.toml.']
    };
  }

  if (fileSet.has('cargo.toml')) {
    const cargoContent = getContent('cargo.toml') || '';
    let binName = 'app';
    const nameMatch = cargoContent.match(/name\s*=\s*["']([^"']+)["']/);
    if (nameMatch && nameMatch[1]) {
      binName = nameMatch[1];
    }

    const defaultPlan: DeploymentPlan = {
      detectedType: 'rust',
      buildCommand: 'cargo build --release',
      startCommand: `./target/release/${binName}`,
      port: 8080,
      healthEndpoint: '/',
      memoryMb: 256,
      entrypointFile: 'Cargo.toml',
      manifestApplied: false,
      inferredFrom: ['Cargo.toml']
    };

    const finalPlan = applyManifest(defaultPlan, manifestOverrides, manifestFile);
    return {
      success: true,
      isDeployable: true,
      detectedType: 'rust',
      plan: finalPlan,
      reasons: ['Rust project detected from Cargo.toml.']
    };
  }

  if (fileSet.has('go.mod')) {
    const defaultPlan: DeploymentPlan = {
      detectedType: 'go',
      buildCommand: 'go build -o app .',
      startCommand: './app',
      port: 8080,
      healthEndpoint: '/',
      memoryMb: 256,
      entrypointFile: 'go.mod',
      manifestApplied: false,
      inferredFrom: ['go.mod']
    };

    const finalPlan = applyManifest(defaultPlan, manifestOverrides, manifestFile);
    return {
      success: true,
      isDeployable: true,
      detectedType: 'go',
      plan: finalPlan,
      reasons: ['Go project detected from go.mod.']
    };
  }

  if (fileSet.has('index.html') || fileSet.has('public/index.html') || fileSet.has('dist/index.html')) {
    const entry = fileSet.has('index.html') ? 'index.html' : (fileSet.has('dist/index.html') ? 'dist/index.html' : 'public/index.html');
    const defaultPlan: DeploymentPlan = {
      detectedType: 'static',
      buildCommand: undefined,
      startCommand: 'static-pages-runtime',
      port: 80,
      healthEndpoint: '/',
      memoryMb: 128,
      entrypointFile: entry,
      manifestApplied: false,
      inferredFrom: [entry]
    };

    const finalPlan = applyManifest(defaultPlan, manifestOverrides, manifestFile);
    return {
      success: true,
      isDeployable: true,
      detectedType: 'static',
      plan: finalPlan,
      reasons: [`Static web entrypoint found at '${entry}'. Deployable to Pages.`]
    };
  }

  if (fileSet.has('functions/_middleware.ts') || fileSet.has('functions/api/index.ts') || fileSet.has('wrangler.toml')) {
    const defaultPlan: DeploymentPlan = {
      detectedType: 'worker-pages',
      buildCommand: undefined,
      startCommand: 'wrangler pages dev',
      port: 8788,
      healthEndpoint: '/',
      memoryMb: 128,
      entrypointFile: 'wrangler.toml',
      manifestApplied: false,
      inferredFrom: ['wrangler.toml']
    };

    const finalPlan = applyManifest(defaultPlan, manifestOverrides, manifestFile);
    return {
      success: true,
      isDeployable: true,
      detectedType: 'worker-pages',
      plan: finalPlan,
      reasons: ['Cloudflare Worker / Pages functions bundle detected.']
    };
  }

  if (manifestOverrides && manifestOverrides.startCommand) {
    const manifestPlan: DeploymentPlan = {
      detectedType: 'docker',
      buildCommand: manifestOverrides.buildCommand,
      startCommand: manifestOverrides.startCommand,
      port: manifestOverrides.port || 8080,
      healthEndpoint: manifestOverrides.healthEndpoint || '/',
      healthCommand: manifestOverrides.healthCommand,
      memoryMb: manifestOverrides.memoryMb || 256,
      env: manifestOverrides.env,
      volumes: manifestOverrides.volumes,
      manifestApplied: true,
      manifestFile,
      inferredFrom: [manifestFile || 'manifest'],
      postgres: manifestOverrides.postgres
    };

    return {
      success: true,
      isDeployable: true,
      detectedType: 'docker',
      plan: manifestPlan,
      reasons: [`Explicit deployment manifest applied from '${manifestFile}'.`]
    };
  }

  return {
    success: false,
    isDeployable: false,
    detectedType: 'unsupported',
    error: 'Unsupported project type: No recognized project configuration found (expected package.json, Dockerfile, requirements.txt, pyproject.toml, Cargo.toml, go.mod, or static index.html).',
    reasons: [
      'No recognized build/start file found in repository root.',
      'Supported project types: Node (package.json), Docker (Dockerfile), Python (requirements.txt/pyproject.toml), Rust (Cargo.toml), Go (go.mod), or Static Web (index.html).',
      'You can also provide a slop.json / deploy.json manifest to declare custom build and start commands.'
    ]
  };
}

function applyManifest(
  basePlan: DeploymentPlan,
  overrides: ReturnType<typeof parseManifestOverride>,
  manifestFile?: string
): DeploymentPlan {
  if (!overrides) return basePlan;

  return {
    ...basePlan,
    buildCommand: overrides.buildCommand !== undefined ? overrides.buildCommand : basePlan.buildCommand,
    startCommand: overrides.startCommand || basePlan.startCommand,
    port: overrides.port || basePlan.port,
    healthEndpoint: overrides.healthEndpoint || basePlan.healthEndpoint,
    healthCommand: overrides.healthCommand || basePlan.healthCommand,
    memoryMb: overrides.memoryMb || basePlan.memoryMb,
    volumes: overrides.volumes || basePlan.volumes,
    env: overrides.env ? { ...basePlan.env, ...overrides.env } : basePlan.env,
    manifestApplied: true,
    manifestFile,
    inferredFrom: [...basePlan.inferredFrom, ...(manifestFile ? [manifestFile] : [])],
    postgres: overrides.postgres !== undefined ? overrides.postgres : basePlan.postgres
  };
}

export function getHonestDeploymentMessage(
  app: { name: string; id: string; deploymentState?: AppDeploymentState; deploymentError?: string }
): {
  headline: string;
  subtext: string;
  state: AppDeploymentState;
  guidance: string[];
} {
  const state = app.deploymentState || 'draft';
  const name = app.name || app.id;

  const firstErrLine = (app.deploymentError || '')
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0);
  const cleanError = firstErrLine
    ? (firstErrLine.length > 160 ? `${firstErrLine.slice(0, 160)}…` : firstErrLine)
    : '';

  if (state === 'failed') {
    return {
      headline: `Deployment failed for ${name}.`,
      subtext: cleanError || 'The candidate build or smoke test failed with recorded evidence.',
      state: 'failed',
      guidance: [
        'Inspect the deployment error logs below for compiler, runtime, or network failures.',
        'Fix the issue in your local worktree and push a new commit to GITSMITH.',
        'RIG will re-trigger candidate build and verification automatically.'
      ]
    };
  }

  if (state === 'draft') {
    return {
      headline: `No deployable revision exists for ${name}.`,
      subtext: cleanError || 'Source has not been imported into GITSMITH and built by RIG.',
      state: 'draft',
      guidance: [
        `1. Add GITSMITH remote: git remote add slop ssh://git@gitsmith-ssh.nates-software.com:22/<handle>/${app.id}.git (or just run: slop init ${app.id})`,
        '2. Push your project source code (Node, Python, Rust, Go, Dockerfile, or static HTML).',
        '3. RIG will automatically detect project type, execute candidate build, verify health, and promote to active.'
      ]
    };
  }

  if (state === 'source_ready') {
    return {
      headline: `Source repository is ready for ${name}.`,
      subtext: cleanError || 'Canonical Git commit received; candidate build is awaiting RIG execution.',
      state: 'source_ready',
      guidance: [
        'A canonical repository and commit exist in GITSMITH.',
        'Awaiting isolated container build and smoke test execution by RIG.'
      ]
    };
  }

  if (state === 'building') {
    return {
      headline: `Candidate build in progress for ${name}.`,
      subtext: 'RIG is building the candidate container and preparing health verification.',
      state: 'building',
      guidance: [
        'Building isolated container artifact.',
        'Standalone hostname will be bound once smoke test passes.'
      ]
    };
  }

  if (state === 'deployable') {
    return {
      headline: `Build artifact verified for ${name}.`,
      subtext: 'Verified artifact is ready for revision promotion and live hostname binding.',
      state: 'deployable',
      guidance: [
        'Candidate build passed assertions.',
        'Revision promotion in progress.'
      ]
    };
  }


  if (state === 'retired') {
    return {
      headline: `${name} has been retired.`,
      subtext: 'This application version is no longer active or offered on this standalone domain.',
      state: 'retired',
      guidance: [
        'The catalog entry or deployment has been decommissioned by the maker.'
      ]
    };
  }

  if (state === 'client_demo') {
    return {
      headline: `${name} ships as a client-side app.`,
      subtext: 'It has no backend deployment revision. Open it at its own address to run it, or read the source below.',
      state: 'client_demo',
      guidance: [
        'This app is designed to run entirely in the browser once opened at its own address.',
        'To publish a live backend container instead, import source to GITSMITH and trigger a build.'
      ]
    };
  }

  return {
    headline: `Verified deployment required for ${name}.`,
    subtext: 'Apps must reach a verified deployment before appearing active.',
    state: state,
    guidance: ['Push code to GITSMITH to trigger RIG deployment.']
  };
}
