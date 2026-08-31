/**
 * RIG.EXE & GITSMITH Deployment Lifecycle State Machine & Plan Generator
 * 
 * CORE INVARIANTS:
 * 1. Apps must reach a verified deployment revision before appearing 'active'.
 * 2. Publication (catalog listing) sets 'draft' (or 'source_ready'), NEVER 'active'.
 * 3. App deployment states:
 *    - draft: metadata only
 *    - source_ready: canonical GITSMITH repository + commit exist
 *    - building: candidate build in progress
 *    - deployable: verified build artifact exists
 *    - active: promoted revision + hostname healthy
 *    - failed: deployment failed, with logs/evidence
 *    - retired: no longer offered
 * 4. RIG runtime detection: detects Node, Docker, Python, Rust, Go, Static HTML, and applies optional manifest overrides.
 * 5. Fail-closed deployment: where a real execution backend isn't available, fail closed with specific evidence; NEVER mock success.
 */

import type { AppDeploymentState } from '../data/mockData';
export type { AppDeploymentState };

export const APP_DEPLOYMENT_STATES: readonly AppDeploymentState[] = [
  'draft',
  'source_ready',
  'building',
  'deployable',
  'deploying',
  'active',
  'failed',
  'retired',
  'client_demo'
] as const;

export const DEPLOYMENT_STATE_TRANSITIONS: Readonly<Record<AppDeploymentState, readonly AppDeploymentState[]>> = {
  draft: ['source_ready', 'building', 'failed', 'retired', 'client_demo'],
  source_ready: ['building', 'failed', 'retired', 'draft'],
  building: ['deployable', 'deploying', 'failed', 'retired'],
  deployable: ['deploying', 'active', 'building', 'failed', 'retired'],
  deploying: ['active', 'failed', 'retired', 'building'],
  active: ['building', 'deploying', 'deployable', 'failed', 'retired'],
  failed: ['source_ready', 'building', 'deploying', 'draft', 'retired'],
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

/**
 * Parses an optional manifest (slop.json, deploy.json, rig.json, app.json)
 */
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
} | null {
  try {
    const data = typeof manifestContent === 'string' ? JSON.parse(manifestContent) : manifestContent;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const result: any = {};

    // Build command
    if (typeof data.buildCommand === 'string' && data.buildCommand.trim()) {
      result.buildCommand = data.buildCommand.trim();
    } else if (typeof data.build_command === 'string' && data.build_command.trim()) {
      result.buildCommand = data.build_command.trim();
    } else if (typeof data.build === 'string' && data.build.trim()) {
      result.buildCommand = data.build.trim();
    }

    // Start command
    if (typeof data.startCommand === 'string' && data.startCommand.trim()) {
      result.startCommand = data.startCommand.trim();
    } else if (typeof data.start_command === 'string' && data.start_command.trim()) {
      result.startCommand = data.start_command.trim();
    } else if (typeof data.start === 'string' && data.start.trim()) {
      result.startCommand = data.start.trim();
    }

    // Port
    const rawPort = data.port ?? data.targetPort ?? data.target_port;
    if (typeof rawPort === 'number' && Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535) {
      result.port = rawPort;
    } else if (typeof rawPort === 'string' && /^\d+$/.test(rawPort)) {
      const p = parseInt(rawPort, 10);
      if (p > 0 && p <= 65535) result.port = p;
    }

    // Health check
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

    // Memory (capped at 256MB per RIG invariant)
    const rawMem = data.memoryMb ?? data.memory_mb ?? data.memoryCapMb ?? data.memory;
    if (typeof rawMem === 'number' && rawMem > 0) {
      result.memoryMb = Math.min(Math.round(rawMem), 256);
    } else if (typeof rawMem === 'string' && /^\d+/.test(rawMem)) {
      const m = parseInt(rawMem, 10);
      if (m > 0) result.memoryMb = Math.min(m, 256);
    }

    // Volumes
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

    // Environment variables
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

/**
 * RIG runtime detection: inspects repository file list and contents to produce a deployment plan.
 */
export function detectRigRuntime(
  files: string[],
  fileContents: Record<string, string> = {}
): DeploymentPlanResult {
  const normalizedFiles = files.map(f => f.replace(/^\/+/, '').trim());
  const fileSet = new Set(normalizedFiles.map(f => f.toLowerCase()));
  const hasStaticEntry = fileSet.has('index.html') || fileSet.has('public/index.html') || fileSet.has('dist/index.html');
  const staticEntry = fileSet.has('index.html') ? 'index.html' : (fileSet.has('dist/index.html') ? 'dist/index.html' : 'public/index.html');

  // 1. Check for optional manifest override
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

  // Helper to extract content if present
  const getContent = (pattern: string): string | undefined => {
    const key = Object.keys(fileContents).find(k => k.toLowerCase() === pattern.toLowerCase() || k.toLowerCase().endsWith(`/${pattern.toLowerCase()}`));
    return key ? fileContents[key] : undefined;
  };

  // 2. Dockerfile Detection
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

  // 3. Node.js (package.json) Detection vs Static Web with package.json
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

    // If repo has index.html and no real build script and no real Node server start script (e.g. dronehunter),
    // and no standalone server file (server.js, etc.), classify as STATIC!
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

    const buildCmd = hasBuildScript ? 'npm run build' : undefined;
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

  // 4. Python (requirements.txt / pyproject.toml / Pipfile) Detection
  if (fileSet.has('requirements.txt') || fileSet.has('pyproject.toml') || fileSet.has('pipfile')) {
    const inferredEntry = fileSet.has('main.py') ? 'main.py' : (fileSet.has('app.py') ? 'app.py' : 'main.py');
    const inferredBuild = fileSet.has('requirements.txt') ? 'pip install -r requirements.txt' : (fileSet.has('pyproject.toml') ? 'pip install -e .' : undefined);

    const defaultPlan: DeploymentPlan = {
      detectedType: 'python',
      buildCommand: inferredBuild,
      startCommand: `python ${inferredEntry}`,
      port: 8000,
      healthEndpoint: '/',
      memoryMb: 256,
      entrypointFile: fileSet.has('requirements.txt') ? 'requirements.txt' : 'pyproject.toml',
      manifestApplied: false,
      inferredFrom: fileSet.has('requirements.txt') ? ['requirements.txt'] : ['pyproject.toml']
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

  // 5. Rust (Cargo.toml) Detection
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

  // 6. Go (go.mod) Detection
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

  // 7. Static Web (index.html / public/index.html / dist/index.html) Detection
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

  // 8. Cloudflare Worker / Pages Functions
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

  // 9. If manifest provided startCommand directly even without indicator file:
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
      inferredFrom: [manifestFile || 'manifest']
    };

    return {
      success: true,
      isDeployable: true,
      detectedType: 'docker',
      plan: manifestPlan,
      reasons: [`Explicit deployment manifest applied from '${manifestFile}'.`]
    };
  }

  // 10. Unsupported project type -> fail closed with specific error & reasons
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
    inferredFrom: [...basePlan.inferredFrom, ...(manifestFile ? [manifestFile] : [])]
  };
}

/**
 * Renders user-facing honest message describing why an app has no verified deployment.
 */
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

  if (state === 'failed') {
    return {
      headline: `Deployment failed for ${name}.`,
      subtext: app.deploymentError || 'The candidate build or smoke test failed with recorded evidence.',
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
      subtext: app.deploymentError || 'Source has not been imported into GITSMITH and built by RIG.',
      state: 'draft',
      guidance: [
        `1. Add GITSMITH remote: git remote add gitsmith git@gitsmith.nates-software.com:${app.id}.git`,
        '2. Push your project source code (Node, Python, Rust, Go, Dockerfile, or static HTML).',
        '3. RIG will automatically detect project type, execute candidate build, verify health, and promote to active.'
      ]
    };
  }

  if (state === 'source_ready') {
    return {
      headline: `Source repository is ready for ${name}.`,
      subtext: app.deploymentError || 'Canonical Git commit received; candidate build is awaiting RIG execution.',
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

  if (state === 'deploying') {
    return {
      headline: `Deployment in progress for ${name}.`,
      subtext: 'Deploying container worker to Cloudflare and running runtime smoke checks.',
      state: 'deploying',
      guidance: [
        'Container image is being deployed to Cloudflare Containers.',
        'Runtime smoke verification is in progress.',
        'Standalone hostname will be promoted to active once smoke test passes.'
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
      headline: `${name} is running as a client-side demo.`,
      subtext: 'This studio runs directly in your browser without a backend deployment revision.',
      state: 'client_demo',
      guidance: [
        'The application operates locally in the browser.',
        'To deploy a standalone backend container, import source to GITSMITH and trigger RIG.'
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
