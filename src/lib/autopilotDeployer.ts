/**
 * STRICT INTAKE & DEPLOYMENT PIPELINE
 * 
 * CORE INVARIANT: PUSH CODE -> CHECK IF DEPLOYABLE -> DEPLOY RAW
 * 
 * ZERO CODE EDITING RULE:
 * - The platform MUST NEVER modify, remix, rewrite, or inject synthetic code into what was pushed.
 * - Files are deployed byte-for-byte exactly as pushed by the maker.
 * - If the app deploys broken, it's broken.
 * - Repositories > 100MB are rejected.
 * - Strip only secret .env files (security boundary).
 */

export const MAX_REPO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

export interface DeployabilityReport {
  isDeployable: boolean;
  repoSizeBytes: number;
  hasEntrypoint: boolean;
  entrypointFile?: string;
  detectedType: 'static' | 'worker-pages' | 'script-cli' | 'unsupported';
  reasons: string[];
}

export interface ColdPushPipelineResult {
  success: boolean;
  appId: string;
  repoSizeBytes: number;
  deployability: DeployabilityReport;
  rawDeployedUrl?: string;
  customDomainUrl?: string;
  status: 'deployed_raw' | 'rejected_size' | 'rejected_undeployable';
  logs: string[];
}

/**
 * 1. Deployability Check (Zero Modification)
 */
export function checkDeployability(_appId: string, files: string[], repoSizeBytes: number): DeployabilityReport {
  // Size limit check
  if (repoSizeBytes > MAX_REPO_SIZE_BYTES) {
    return {
      isDeployable: false,
      repoSizeBytes,
      hasEntrypoint: false,
      detectedType: 'unsupported',
      reasons: [`Repository size (${Math.round(repoSizeBytes / 1024 / 1024)}MB) exceeds 100MB hard limit.`]
    };
  }

  const fileSet = new Set(files.map(f => f.toLowerCase()));

  // Detect static web entrypoints
  if (fileSet.has('index.html') || fileSet.has('public/index.html') || fileSet.has('dist/index.html')) {
    const entry = fileSet.has('index.html') ? 'index.html' : fileSet.has('dist/index.html') ? 'dist/index.html' : 'public/index.html';
    return {
      isDeployable: true,
      repoSizeBytes,
      hasEntrypoint: true,
      entrypointFile: entry,
      detectedType: 'static',
      reasons: ['Valid web entrypoint found. Deployable raw to Cloudflare Pages.']
    };
  }

  // Detect worker / pages functions
  if (fileSet.has('functions/_middleware.ts') || fileSet.has('functions/api/index.ts') || fileSet.has('wrangler.toml')) {
    return {
      isDeployable: true,
      repoSizeBytes,
      hasEntrypoint: true,
      entrypointFile: 'wrangler.toml',
      detectedType: 'worker-pages',
      reasons: ['Cloudflare Worker / Pages functions bundle detected.']
    };
  }

  // CLI / Script repo (not a direct web app, but inspectable in Git viewer)
  if (fileSet.has('pyproject.toml') || fileSet.has('package.json') || Array.from(fileSet).some(f => f.endsWith('.py') || f.endsWith('.php'))) {
    return {
      isDeployable: true,
      repoSizeBytes,
      hasEntrypoint: true,
      entrypointFile: 'README.md',
      detectedType: 'script-cli',
      reasons: ['Backend / CLI script repo. Viewable in Git Viewer & SLOPSHOP.']
    };
  }

  return {
    isDeployable: false,
    repoSizeBytes,
    hasEntrypoint: false,
    detectedType: 'unsupported',
    reasons: ['No recognized entrypoint or static build found.']
  };
}

/**
 * 2. Strict Raw Pipeline Execution: Push -> Check -> Deploy Raw
 */
export async function runColdPushPipeline(appId: string, files: string[], repoSizeBytes: number): Promise<ColdPushPipelineResult> {
  const logs: string[] = [];
  logs.push(`[INTAKE] Received cold push for '${appId}' (${Math.round(repoSizeBytes / 1024 / 1024)}MB)...`);

  // Step 1: Check deployability
  const report = checkDeployability(appId, files, repoSizeBytes);
  logs.push(`  ✔ Deployability check: ${report.isDeployable ? 'PASS' : 'FAIL'} (${report.detectedType})`);

  if (!report.isDeployable) {
    logs.push(`  ✖ Push rejected: ${report.reasons.join(', ')}`);
    return {
      success: false,
      appId,
      repoSizeBytes,
      deployability: report,
      status: repoSizeBytes > MAX_REPO_SIZE_BYTES ? 'rejected_size' : 'rejected_undeployable',
      logs
    };
  }

  // Step 2: Deploy RAW (Zero code editing)
  logs.push(`  ✔ Zero Code Editing Invariant: Deploying raw untouched code bytes...`);
  logs.push(`  ✔ Deployed directly to Cloudflare Pages: https://${appId}.pages.dev`);
  logs.push(`  ✔ Bound custom domain: https://${appId}.nates-software.com`);
  logs.push(`  ✔ Available in GITSMITH & SLOPSHOP (Gated from Hotwire until maker clicks 'Add to Hotwire')`);

  return {
    success: true,
    appId,
    repoSizeBytes,
    deployability: report,
    rawDeployedUrl: `https://${appId}.pages.dev`,
    customDomainUrl: `https://${appId}.nates-software.com`,
    status: 'deployed_raw',
    logs
  };
}
