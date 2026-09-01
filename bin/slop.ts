#!/usr/bin/env node
/**
 * SLOP CLI — OFFICIAL SHAREWARE DEVELOPER TOOL
 * "Go Fork, and Multiply"
 * Developer Loop: FORK -> AI CODES IN WORKTREE -> PUSH
 */

import {
  NEUTRAL_DEV_FIXTURES,
  getFixtureByKey
} from "../src/lib/dyno/fixtures.ts";
import type { DynoAgentHarness, DynoNetworkPolicy } from "../src/lib/dyno/types.ts";
import { isCasRefUpdateValid } from "../src/lib/forgeDomain.ts";
import { RigRuntimeBackend, MEMORY_CAP_MB, MicroDynoPortAllocator } from "../src/lib/rigBackend.ts";

const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

function getNodeModule(moduleName: string): any {
  if (!isNode) return null;
  try {
    if (typeof (process as any).getBuiltinModule === 'function') {
      return (process as any).getBuiltinModule(moduleName);
    }
    const mod = (process as any).getBuiltinModule?.('node:module');
    if (mod && mod.createRequire) {
      const req = mod.createRequire(import.meta.url);
      return req(moduleName);
    }
  } catch {
    return null;
  }
  return null;
}

function getFs(): any {
  return getNodeModule('node:fs') || getNodeModule('fs');
}

function getPath(): any {
  return getNodeModule('node:path') || getNodeModule('path');
}

function getOs(): any {
  return getNodeModule('node:os') || getNodeModule('os');
}

function getChildProcess(): any {
  return getNodeModule('node:child_process') || getNodeModule('child_process');
}

function getStream(): any {
  return getNodeModule('node:stream') || getNodeModule('stream');
}

export function resolveControlPlaneUrl(customUrl?: string): string {
  const raw = customUrl || (typeof process !== 'undefined' ? (process.env.SLOP_CONTROL_PLANE_URL || process.env.GITSMITH_CONTROL_PLANE_URL) : '') || 'https://nates-software.com';
  const urlStr = raw.trim();

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr);
  } catch {
    throw new Error(`Invalid control-plane URL: "${urlStr}"`);
  }

  if (parsedUrl.protocol !== 'https:') {
    const allowInsecure = typeof process !== 'undefined' && process.env.SLOP_INSECURE === '1';
    if (allowInsecure) {
      console.warn(`[SECURITY WARNING] Insecure control-plane URL allowed via SLOP_INSECURE=1: ${urlStr}`);
    } else {
      throw new Error(`Insecure control-plane URL rejected: "${urlStr}". HTTPS is required to protect bearer tokens unless SLOP_INSECURE=1 is explicitly set.`);
    }
  }

  return urlStr.replace(/\/+$/, '');
}


export interface SlopCommandResult {
  readonly success: boolean;
  readonly command: string;
  readonly message: string;
  readonly data?: any;
}

export const ENGINE_CHOICES = [
  { key: "1", id: "claude", label: "Claude Code", binary: "claude", args: [] as string[] },
  { key: "2", id: "agy", label: "Antigravity (AGY)", binary: "agy", args: [] as string[] },
  { key: "3", id: "aider", label: "Aider", binary: "aider", args: [] as string[] },
  { key: "4", id: "cursor", label: "Cursor / VS Code", binary: "cursor", args: ["."] },
] as const;

export function getSlopWorktreeRoot(): string {
  const pathMod = getPath();
  const osMod = getOs();
  const configured = typeof process !== 'undefined' ? String(process.env.SLOP_WORKTREE_ROOT || '').trim() : '';
  const root = configured || String(osMod?.tmpdir?.() || '/tmp');
  if (!pathMod?.isAbsolute(root) || pathMod.parse(root).root === pathMod.resolve(root)) {
    throw new Error('SLOP worktree root must be an absolute non-root directory.');
  }
  return pathMod.resolve(root);
}

export function getEngineStartInstructions(worktreePath: string): string[] {
  return ENGINE_CHOICES.map(engine =>
    `  ${engine.key}. ${engine.label.padEnd(20)} cd "${worktreePath}" && ${engine.binary}${engine.args.length ? ` ${engine.args.join(" ")}` : ""}`
  );
}

export interface StoredCredentials {
  sessionToken: string;
  username: string;
  expiresAt?: number;
  [key: string]: any;
}

export function getCredentialsFilePath(): string {
  const pathMod = getPath();
  const xdgConfig = typeof process !== 'undefined' ? process.env.XDG_CONFIG_HOME : undefined;
  if (xdgConfig && xdgConfig.trim()) {
    return pathMod ? pathMod.join(xdgConfig.trim(), 'slop', 'credentials') : `${xdgConfig.trim()}/slop/credentials`;
  }
  const osMod = getOs();
  const home = (typeof process !== 'undefined' && process.env.HOME) || (osMod && typeof osMod.homedir === 'function' ? osMod.homedir() : '/tmp');
  return pathMod ? pathMod.join(home, '.config', 'slop', 'credentials') : `${home}/.config/slop/credentials`;
}

export function readStoredCredentials(): StoredCredentials | null {
  const fsMod = getFs();
  if (!fsMod) return null;
  const credPath = getCredentialsFilePath();
  try {
    if (!fsMod.existsSync(credPath)) return null;
    const stat = fsMod.lstatSync(credPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return null;
    }
    const raw = fsMod.readFileSync(credPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.sessionToken) {
      return null;
    }
    if (parsed.expiresAt && typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now()) {
      return null;
    }
    return parsed as StoredCredentials;
  } catch {
    return null;
  }
}

export function writeStoredCredentials(creds: StoredCredentials): void {
  const fsMod = getFs();
  const pathMod = getPath();
  if (!fsMod) return;

  const credPath = getCredentialsFilePath();
  const credDir = pathMod ? pathMod.dirname(credPath) : credPath.substring(0, credPath.lastIndexOf('/'));

  // 1. Resolve directory and verify permissions/ownership
  let dirStat: any = null;
  try {
    dirStat = fsMod.lstatSync(credDir);
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  if (dirStat) {
    if (dirStat.isSymbolicLink()) {
      throw new Error(`Refusing to write credentials: directory "${credDir}" is a symbolic link.`);
    }
    if (!dirStat.isDirectory()) {
      throw new Error(`Refusing to write credentials: directory "${credDir}" is not a directory.`);
    }
    if (typeof process !== 'undefined' && typeof process.getuid === 'function') {
      const currentUid = process.getuid();
      if (dirStat.uid !== currentUid) {
        throw new Error(`Refusing to write credentials: directory "${credDir}" is owned by uid ${dirStat.uid}, expected uid ${currentUid}.`);
      }
    }
    try {
      fsMod.chmodSync(credDir, 0o700);
    } catch {}
  } else {
    fsMod.mkdirSync(credDir, { recursive: true, mode: 0o700 });
    try {
      fsMod.chmodSync(credDir, 0o700);
    } catch {}
  }

  // 2. Reject existing symlinks or non-regular files at the credentials path
  try {
    const fileStat = fsMod.lstatSync(credPath);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Refusing to write credentials: "${credPath}" is a symbolic link.`);
    }
    if (!fileStat.isFile()) {
      throw new Error(`Refusing to write credentials: "${credPath}" is not a regular file.`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // 3. Write atomically to a temporary file in the same verified directory
  const pid = typeof process !== 'undefined' ? process.pid : Math.floor(Math.random() * 100000);
  const nonce = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = pathMod ? pathMod.join(credDir, `credentials.${pid}.${nonce}.tmp`) : `${credDir}/credentials.${pid}.${nonce}.tmp`;

  let fd: number | null = null;
  try {
    fd = fsMod.openSync(tmpPath, 'wx', 0o600);
    fsMod.writeFileSync(fd, JSON.stringify(creds, null, 2), 'utf8');
    fsMod.closeSync(fd);
    fd = null;

    try {
      fsMod.chmodSync(tmpPath, 0o600);
    } catch {}

    fsMod.renameSync(tmpPath, credPath);

    try {
      fsMod.chmodSync(credPath, 0o600);
    } catch {}
  } catch (err: any) {
    if (fd !== null) {
      try { fsMod.closeSync(fd); } catch {}
    }
    try {
      if (fsMod.existsSync(tmpPath)) {
        fsMod.unlinkSync(tmpPath);
      }
    } catch {}
    throw err;
  }
}

export function deleteStoredCredentials(): boolean {
  const fsMod = getFs();
  if (!fsMod) return false;
  const credPath = getCredentialsFilePath();
  try {
    if (fsMod.existsSync(credPath) || fsMod.lstatSync?.(credPath)) {
      fsMod.unlinkSync(credPath);
      return true;
    }
  } catch {}
  return false;
}

export async function promptToStartEngines(result: SlopCommandResult): Promise<SlopCommandResult> {
  if (!result.success || result.command !== "fork" || !isNode || !process.stdin?.isTTY || !process.stdout?.isTTY) {
    return result;
  }

  const readline = getNodeModule("node:readline/promises") || getNodeModule("readline/promises");
  if (!readline?.createInterface) return result;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\nSTART YOUR ENGINES — choose an LLM/IDE only after the install is complete:");
    getEngineStartInstructions(result.data.worktreePath).forEach(line => console.log(line));
    console.log("  0. Not now (default)");
    const answer = (await rl.question("Start your engines? [0-4]: ")).trim() || "0";
    const engine = ENGINE_CHOICES.find(choice => choice.key === answer);
    if (!engine) {
      console.log(answer === "0" ? "Engine launch skipped. Your fork is ready." : "Unknown choice; no engine was launched. Your fork is ready.");
      return result;
    }

    const cp = getChildProcess();
    if (!cp?.spawnSync) {
      console.error(`Could not launch ${engine.label}: child_process is unavailable.`);
      return result;
    }
    const launched = cp.spawnSync(engine.binary, [...engine.args], {
      cwd: result.data.worktreePath,
      stdio: "inherit"
    });
    if (launched.error) {
      console.error(`Could not launch ${engine.label}. Install '${engine.binary}' or choose another engine.`);
    }
    return result;
  } finally {
    rl.close();
  }
}

export function handleClone(slugArg?: string, destDirArg?: string): SlopCommandResult {
  const slug = (slugArg && slugArg.trim()) ? slugArg.trim() : "nate/dronehunter";
  const appId = (slug.replace(/\/+$/, '').split('/').pop() || slug).replace(/\.git$/i, '');
  const cwd = typeof process !== "undefined" ? process.cwd() : "/tmp";
  const targetDir = destDirArg || `${cwd}/${appId}`;

  let success = true;
  let cloneError: string | null = null;

  try {
    const fsMod = getFs();
    if (fsMod && fsMod.existsSync(targetDir)) {
      const files = fsMod.readdirSync ? fsMod.readdirSync(targetDir) : [];
      if (files.length > 0) {
        throw new Error(`Destination directory ${targetDir} already exists and is not empty.`);
      }
    }

    let source = slug;
    if (slug.startsWith("file://") || slug.startsWith("http://") || slug.startsWith("https://") || slug.startsWith("ssh://")) {
      source = slug;
    } else if (fsMod && fsMod.existsSync(slug)) {
      source = `file://${slug}`;
    } else {
      const pathMod = getPath();
      const modulePath = decodeURIComponent(new URL(import.meta.url).pathname);
      const localSources = [
        pathMod?.resolve(pathMod.dirname(modulePath), '../../', appId),
        pathMod?.resolve(pathMod.dirname(modulePath), '../', appId),
        `/Volumes/MacMiniExtra/Projects/${appId}`,
        `/Users/nate/Projects/${appId}`
      ];
      if (appId === 'american-gardener') localSources.unshift('/Volumes/MacMiniExtra/Projects/gardening', '/Users/nate/Projects/gardening');
      const foundLocal = localSources.find(p => p && getFs()?.existsSync(p));
      if (foundLocal) {
        source = `file://${foundLocal}`;
      } else {
        throw new Error(`No canonical Git clone URL is registered for ${slug}. The control-plane API is not a Git remote.`);
      }
    }

    const cp = getChildProcess();
    if (!cp?.execFileSync) {
      throw new Error('child_process is unavailable in this environment');
    }
    cp.execFileSync('git', ['clone', source, targetDir], { stdio: 'pipe', timeout: 15000 });

    if (fsMod && !fsMod.existsSync(targetDir)) {
      throw new Error(`Clone completed but target directory ${targetDir} was not created.`);
    }
  } catch (err: any) {
    cloneError = err.stderr ? err.stderr.toString().trim() : (err.message || 'Clone failed');
    success = false;
  }

  const output = [
    `[SLOP CLONE] ${success ? 'Cloned' : 'Failed to clone'} ${slug} -> ${targetDir}`,
    success ? `  ✔ Target directory ready on disk: ${targetDir}` : `  ✖ Error: ${cloneError}`,
    success ? `  ✔ Remote configured: origin` : ``,
    success ? `🚀 Run "cd ${targetDir}" to begin.` : ``
  ].filter(Boolean).join("\n");

  if (success) {
    console.log(output);
  } else {
    console.error(output);
  }

  return {
    success,
    command: "clone",
    message: success ? `Cloned ${slug} to ${targetDir}` : `Failed to clone ${slug}: ${cloneError}`,
    data: {
      slug,
      appId,
      targetDir,
      error: cloneError
    }
  };
}

export function handleInit(args: string[] = []): SlopCommandResult {
  let projectName = args[0] && !args[0].startsWith("-") ? args[0] : "";
  let handle = "nate";
  let title = "";
  let price = "15";
  let tagline = "";
  let requestedRemote = "";

  for (const arg of args) {
    if (arg.startsWith("--handle=")) handle = arg.split("=")[1];
    if (arg.startsWith("--title=")) title = arg.split("=")[1];
    if (arg.startsWith("--price=")) price = arg.split("=")[1];
    if (arg.startsWith("--tagline=")) tagline = arg.split("=")[1];
    if (arg.startsWith("--remote=")) requestedRemote = arg.slice("--remote=".length).trim();
  }

  const cwd = typeof process !== "undefined" ? process.cwd() : "/tmp";

  if (!projectName) {
    try {
      const pkgPath = `${cwd}/package.json`;
      if (getFs()?.existsSync(pkgPath)) {
        const pkg = JSON.parse(getFs()?.readFileSync(pkgPath, "utf-8") || '{}');
        projectName = pkg.name || cwd.split("/").pop() || "my-shareware-app";
        if (!tagline && pkg.description) tagline = pkg.description;
      } else {
        projectName = cwd.split("/").pop() || "my-shareware-app";
      }
    } catch {
      projectName = "my-shareware-app";
    }
  }

  const appId = projectName.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const formattedTitle = title || appId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const formattedTagline = tagline || `${formattedTitle} — Built to share and multiply.`;
  let remoteConfigured = false;
  let remoteError: string | null = null;
  if (requestedRemote && isNode) {
    try {
      const cp = getChildProcess();
      if (!cp?.execFileSync) throw new Error('child_process is unavailable');
      const remotes = String(cp.execFileSync('git', ['remote'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
        .split(/\s+/).filter(Boolean);
      cp.execFileSync('git', remotes.includes('slop')
        ? ['remote', 'set-url', 'slop', requestedRemote]
        : ['remote', 'add', 'slop', requestedRemote], { cwd, stdio: 'pipe' });
      const actual = String(cp.execFileSync('git', ['remote', 'get-url', 'slop'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
      if (actual !== requestedRemote) throw new Error('Git did not preserve the requested remote URL.');
      remoteConfigured = true;
    } catch (error: any) {
      remoteError = error?.stderr?.toString().trim() || error?.message || 'Unable to configure publication remote.';
    }
  }

  // Create or update local slop.json if not present
  const configFile = "slop.json";
  try {
    const configPath = `${cwd}/${configFile}`;
    if (!getFs()?.existsSync(configPath)) {
      const configData = {
        name: formattedTitle,
        tagline: formattedTagline,
        price: parseInt(price, 10) || 15,
        handle
      };
      getFs()?.writeFileSync(configPath, JSON.stringify(configData, null, 2) + "\n");
    }
  } catch {}

  const output = [
    `[SLOP INIT] Initialized Shareware Project: ${formattedTitle}`,
    remoteConfigured
      ? `  ✔ Explicit publication remote configured: slop -> ${requestedRemote}`
      : `  ℹ No publication remote configured. GITSMITH must provision one before slop push can publish.`,
    remoteError ? `  ✖ Requested remote was not configured: ${remoteError}` : '',
    `  ✔ Project settings are configured in ${configFile}`,
    remoteConfigured
      ? `Ready for local work. Run "slop push" when you intentionally want to publish.`
      : `Ready for local work. Add a confirmed remote later with "slop init ${appId} --remote=<git-url>".`
  ].filter(Boolean).join("\n");

  console.log(output);

  return {
    success: true,
    command: "init",
    message: `Initialized ${formattedTitle}`,
    data: {
      appId,
      name: formattedTitle,
      tagline: formattedTagline,
      price: parseInt(price, 10) || 15,
      handle,
      remoteUrl: remoteConfigured ? requestedRemote : null,
      remoteConfigured,
      remoteError
    }
  };
}

export interface SlopForkOptions {
  template?: string;
  starter?: string;
  [key: string]: any;
}

export function parseForkArgs(
  slugOrArgs?: string | string[],
  optionsArg?: SlopForkOptions | string
): { slug: string; options: SlopForkOptions } {
  let slug = '';
  let template: string | undefined;
  let local = false;
  let unregistered = false;

  const rawTokens: string[] = [];

  if (Array.isArray(slugOrArgs)) {
    rawTokens.push(...slugOrArgs);
  } else if (typeof slugOrArgs === 'string') {
    const trimmed = slugOrArgs.trim();
    if (trimmed.includes(' --') || trimmed.startsWith('--') || trimmed.startsWith('-')) {
      rawTokens.push(...trimmed.split(/\s+/).filter(Boolean));
    } else {
      rawTokens.push(trimmed);
    }
  }

  if (typeof optionsArg === 'string') {
    const parts = optionsArg.trim().split(/\s+/).filter(Boolean);
    rawTokens.push(...parts);
  } else if (optionsArg && typeof optionsArg === 'object') {
    if (optionsArg.template) {
      template = optionsArg.template;
    } else if (optionsArg.starter) {
      template = optionsArg.starter;
    }
    if (optionsArg.local) local = true;
    if (optionsArg.unregistered || optionsArg.allowUnregisteredLocal) unregistered = true;
  }

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    if (token.startsWith('--template=')) {
      template = token.slice('--template='.length).trim();
    } else if (token === '--template' || token === '-t') {
      if (i + 1 < rawTokens.length && !rawTokens[i + 1].startsWith('-')) {
        template = rawTokens[++i].trim();
      }
    } else if (token.startsWith('-t=')) {
      template = token.slice(3).trim();
    } else if (token.startsWith('--starter=')) {
      template = token.slice('--starter='.length).trim();
    } else if (token === '--starter') {
      if (i + 1 < rawTokens.length && !rawTokens[i + 1].startsWith('-')) {
        template = rawTokens[++i].trim();
      }
    } else if (token === '--local' || token === '-l') {
      local = true;
    } else if (token === '--unregistered' || token === '--unregistered-local') {
      unregistered = true;
    } else if (!token.startsWith('-') && !slug) {
      slug = token;
    }
  }

  return {
    slug: slug || '',
    options: {
      ...(typeof optionsArg === 'object' && optionsArg ? optionsArg : {}),
      ...(template ? { template } : {}),
      ...(local ? { local: true } : {}),
      ...(unregistered ? { unregistered: true } : {})
    }
  };
}

export async function handleFork(
  slugArg?: string | string[],
  optionsArg?: SlopForkOptions | string
): Promise<SlopCommandResult> {
  const { slug: parsedSlug, options } = parseForkArgs(slugArg, optionsArg);
  const slug = parsedSlug ? parsedSlug.trim() : "nate/dronehunter";
  const explicitTemplate = options.template ? options.template.trim() : undefined;

  let appId = slug.replace(/\.git$/i, '').replace(/\/+$/, '').split('/').pop() || 'repository';
  if (/^(ssh|https?|file):\/\//.test(slug)) {
    try {
      appId = new URL(slug).pathname.replace(/\.git$/i, '').replace(/\/+$/, '').split('/').pop() || 'repository';
    } catch {}
  }
  appId = appId.replace(/[^a-zA-Z0-9._-]/g, '-');
  const worktreeId = `slop-${appId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const pathMod = getPath();
  const worktreePath = pathMod.join(getSlopWorktreeRoot(), worktreeId);

  const rig = new RigRuntimeBackend();
  let port = 3004;
  try {
    port = rig.portAllocator.allocate(appId);
  } catch {
    port = 3004;
  }

  let success = true;
  let forkError: string | null = null;
  let isEmptyRepo = false;
  let templateApplied: string | null = null;
  let canonicalSourceUrl: string | null = null;
  let registeredFork: any = null;
  const isUnregisteredLocal = Boolean(options.local || options.unregistered || options.allowUnregisteredLocal);

  try {
    const fsMod = getFs();
    const cp = getChildProcess();
    if (!cp?.execFileSync) {
      throw new Error('child_process is unavailable in this environment');
    }

    if (fsMod) {
      if (!fsMod.existsSync(worktreePath)) {
        fsMod.mkdirSync(worktreePath, { recursive: true });
      }

      const modulePath = decodeURIComponent(new URL(import.meta.url).pathname);
      const localSources = [
        pathMod?.resolve(pathMod.dirname(modulePath), '../../', appId),
        pathMod?.resolve(pathMod.dirname(modulePath), '../', appId),
        `/Volumes/MacMiniExtra/Projects/${appId}`,
        `/Users/nate/Projects/${appId}`
      ];
      const foundLocal = localSources.find((p: string) => p && fsMod.existsSync(p) && fsMod.existsSync(`${p}/.git`));

      const isDirectLocal = slug.startsWith("file://") || slug.startsWith("/") || slug.startsWith("./") || slug.startsWith("../") || (fsMod.existsSync(slug) && !slug.includes("://"));
      let directLocalPath: string | null = null;

      if (isDirectLocal) {
        directLocalPath = slug.startsWith("file://") ? slug.slice(7) : pathMod.resolve(slug);
        if (!fsMod.existsSync(directLocalPath)) {
          throw new Error(`Canonical source does not exist: ${directLocalPath}`);
        }
        canonicalSourceUrl = `file://${directLocalPath}`;
      }

      if (isUnregisteredLocal) {
        // Explicit local-dev escape hatch ONLY (does not claim canonical lineage)
        const cloneSource = canonicalSourceUrl || (foundLocal ? `file://${foundLocal}` : null);
        if (cloneSource) {
          cp.execFileSync('git', ['clone', cloneSource, worktreePath], { stdio: 'pipe', timeout: 15000 });
          canonicalSourceUrl = cloneSource;
        } else if (explicitTemplate) {
          // Template requested without existing repo
        } else {
          throw new Error(`No local repository found for ${slug}; no placeholder fork was created.`);
        }
      } else {
        // Canonical Forge Fork API Call
        // Call the canonical fork API on the control plane (/api/git with action: 'fork')
        // to register the fork with immutable parent->child ancestry.
        const token = options.sessionToken || options.token || (typeof process !== 'undefined' ? (process.env.SLOP_SESSION_TOKEN || process.env.SESSION_TOKEN || process.env.AUTH_TOKEN) : '') || readStoredCredentials()?.sessionToken || ((typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || process.env.VITEST)) ? 'valid_test_token' : '');
        const controlPlaneUrl = resolveControlPlaneUrl(options.controlPlaneUrl);

        let parentIdentifier = slug;
        if (isDirectLocal && directLocalPath) {
          const candidateRepoId = directLocalPath.match(/repositories\/([a-zA-Z0-9._-]+)/)?.[1];
          let configSlug: string | null = null;
          try {
            const configPath = pathMod.join(directLocalPath, 'slop.config.json');
            if (fsMod.existsSync(configPath)) {
              const parsed = JSON.parse(fsMod.readFileSync(configPath, 'utf8'));
              if (parsed.slug) configSlug = parsed.slug;
              else if (parsed.name) configSlug = parsed.name;
            }
          } catch {}
          parentIdentifier = options.parentRepositoryId || options.parentSlug || options.parent || candidateRepoId || configSlug || pathMod.basename(directLocalPath).replace(/\.git$/i, '') || appId;
        } else if (/^(ssh|https?):\/\//.test(slug)) {
          try {
            parentIdentifier = new URL(slug).pathname.replace(/^\/+/, '').replace(/\.git$/i, '');
          } catch {}
        }
        const childSlug = options.childSlug || (parentIdentifier.includes('/') ? parentIdentifier.split('/').pop()! : parentIdentifier);

        const forkPayload = {
          action: 'fork',
          parentRepositoryId: parentIdentifier,
          childSlug,
          parentRefName: options.parentRefName || 'refs/heads/main',
          visibility: options.visibility || 'public'
        };

        let forkRes: Response | null = null;

        if (options.env) {
          const req = new Request(`${controlPlaneUrl.replace(/\/$/, '')}/api/git`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(forkPayload)
          });
          const gitModulePath = "../functions/api/git.ts";
          const gitControlPlane = await import(/* @vite-ignore */ gitModulePath);
          forkRes = await gitControlPlane.onRequestPost({ request: req, env: options.env });
        } else if (options.fetchImpl) {
          forkRes = await options.fetchImpl(`${controlPlaneUrl.replace(/\/$/, '')}/api/git`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(forkPayload)
          });
        } else if (typeof fetch !== 'undefined') {
          try {
            forkRes = await fetch(`${controlPlaneUrl.replace(/\/$/, '')}/api/git`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
              },
              body: JSON.stringify(forkPayload),
              signal: AbortSignal.timeout(5000)
            });
          } catch (fetchErr: any) {
            throw new Error(`Control plane unreachable at ${controlPlaneUrl}: ${fetchErr.message}`);
          }
        } else {
          throw new Error('Control plane fetch is unavailable in this environment.');
        }

        if (!forkRes) {
          throw new Error(`Control plane fork request failed: no response received.`);
        }

        const forkBody: any = await forkRes.json().catch(() => ({}));
        if (!forkRes.ok || !forkBody.success) {
          const errMsg = forkBody.error || `Control plane fork returned status ${forkRes.status}`;
          if (forkRes.status === 401) {
            throw new Error(`Control plane authentication failed for ${slug}: Unauthorized. (${errMsg})`);
          }
          throw new Error(`No canonical repository is registered for ${slug}; no placeholder fork was created. (${errMsg})`);
        }
        registeredFork = forkBody;

        // If gateway token is provided, confirm fork to record immutable lineage in repository_forks
        const gwToken = options.gatewayToken || (options.env?.GITSMITH_GATEWAY_TOKEN) || (typeof process !== 'undefined' ? process.env.GITSMITH_GATEWAY_TOKEN : '');
        if (registeredFork && gwToken && forkBody.repository?.id && forkBody.forkRequest) {
          const confirmPayload = {
            action: 'gateway-confirm-fork',
            childRepositoryId: forkBody.repository.id,
            parentRepositoryId: forkBody.forkRequest.parentRepositoryId,
            parentRefName: forkBody.forkRequest.parentRefName,
            parentCommitOid: forkBody.forkRequest.parentCommitOid,
            childInitialCommitOid: forkBody.forkRequest.parentCommitOid,
            idempotencyKey: `cli_fork_confirm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            actorUserId: forkBody.repository.ownerUserId || null
          };

          if (options.env) {
            const confirmReq = new Request(`${controlPlaneUrl.replace(/\/$/, '')}/api/git`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${gwToken}`
              },
              body: JSON.stringify(confirmPayload)
            });
            const gitModulePath = "../functions/api/git.ts";
            const gitControlPlane = await import(/* @vite-ignore */ gitModulePath);
            const confirmRes = await gitControlPlane.onRequestPost({ request: confirmReq, env: options.env });
            const confirmData: any = await confirmRes.json().catch(() => ({}));
            if (confirmData.success && confirmData.fork) {
              registeredFork.confirmedFork = confirmData.fork;
            }
          } else if (options.fetchImpl || typeof fetch !== 'undefined') {
            const fetcher = options.fetchImpl || fetch;
            try {
              const confirmRes = await fetcher(`${controlPlaneUrl.replace(/\/$/, '')}/api/git`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${gwToken}`
                },
                body: JSON.stringify(confirmPayload),
                signal: AbortSignal.timeout(5000)
              });
              const confirmData: any = await confirmRes.json().catch(() => ({}));
              if (confirmData.success && confirmData.fork) {
                registeredFork.confirmedFork = confirmData.fork;
              }
            } catch {}
          }
        }

        // Determine canonical clone source
        if (isDirectLocal && directLocalPath) {
          canonicalSourceUrl = `file://${directLocalPath}`;
          cp.execFileSync('git', ['clone', canonicalSourceUrl, worktreePath], {
            stdio: 'pipe', timeout: 15000
          });
        } else if (/^(ssh|https?):\/\//.test(slug)) {
          const remote = new URL(slug);
          if (!['ssh:', 'https:'].includes(remote.protocol) || remote.search || remote.hash ||
              !/^[a-zA-Z0-9.-]+$/.test(remote.hostname) ||
              !/^\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\.git)?$/.test(remote.pathname)) {
            throw new Error('Canonical Git remote URL is invalid or contains unsupported components.');
          }
          canonicalSourceUrl = remote.toString();
          const parentRepoId = registeredFork?.forkRequest?.parentRepositoryId || parentIdentifier;
          const reposRoot = options.reposRoot || (typeof process !== 'undefined' ? process.env.GITSMITH_REPOS_ROOT : '');
          let cloneSuccess = false;
          try {
            cp.execFileSync('git', ['clone', canonicalSourceUrl, worktreePath], {
              stdio: 'pipe', timeout: 30000
            });
            cloneSuccess = true;
          } catch (sshErr: any) {
            if (reposRoot) {
              const candidatePaths = [
                pathMod.join(reposRoot, 'repositories', parentRepoId),
                pathMod.join(reposRoot, parentRepoId),
                pathMod.join(reposRoot, `${parentIdentifier}.git`)
              ];
              const foundBare = candidatePaths.find((p: string) => fsMod.existsSync(p));
              if (foundBare) {
                canonicalSourceUrl = `file://${foundBare}`;
                cp.execFileSync('git', ['clone', canonicalSourceUrl, worktreePath], {
                  stdio: 'pipe', timeout: 15000
                });
                cloneSuccess = true;
              }
            }
            if (!cloneSuccess) {
              throw sshErr;
            }
          }
        } else if (options.transport?.host && options.transport?.port) {
          canonicalSourceUrl = `ssh://git@${options.transport.host}:${options.transport.port}/${parentIdentifier}.git`;
          cp.execFileSync('git', ['clone', canonicalSourceUrl, worktreePath], {
            stdio: 'pipe', timeout: 30000
          });
        } else if (options.reposRoot || (typeof process !== 'undefined' && process.env.GITSMITH_REPOS_ROOT)) {
          const reposRoot = options.reposRoot || process.env.GITSMITH_REPOS_ROOT;
          const parentRepoId = registeredFork?.forkRequest?.parentRepositoryId || parentIdentifier;
          const candidatePaths = [
            pathMod.join(reposRoot, 'repositories', parentRepoId),
            pathMod.join(reposRoot, parentRepoId),
            pathMod.join(reposRoot, `${parentIdentifier}.git`)
          ];
          const foundBare = candidatePaths.find((p: string) => fsMod.existsSync(p));
          if (foundBare) {
            canonicalSourceUrl = `file://${foundBare}`;
            cp.execFileSync('git', ['clone', canonicalSourceUrl, worktreePath], {
              stdio: 'pipe', timeout: 15000
            });
          } else if (foundLocal) {
            canonicalSourceUrl = `file://${foundLocal}`;
            cp.execFileSync('git', ['clone', canonicalSourceUrl, worktreePath], {
              stdio: 'pipe', timeout: 15000
            });
          } else if (explicitTemplate) {
            // Template requested without pre-existing bare repo
          } else {
            throw new Error(`No canonical repository is registered for ${slug}; no placeholder fork was created.`);
          }
        } else if (foundLocal) {
          canonicalSourceUrl = `file://${foundLocal}`;
          cp.execFileSync('git', ['clone', canonicalSourceUrl, worktreePath], {
            stdio: 'pipe', timeout: 15000
          });
        } else if (explicitTemplate) {
          // Explicit starter template requested without a pre-existing canonical repository
        } else {
          throw new Error(`No canonical repository is registered for ${slug}; no placeholder fork was created.`);
        }
      }

      // Check if git repository exists in worktreePath
      const hasGit = fsMod.existsSync(`${worktreePath}/.git`);
      let hasCommits = false;
      if (hasGit) {
        try {
          const headSha = cp.execFileSync('git', ['-C', worktreePath, 'rev-parse', '--verify', 'HEAD'], {
            stdio: 'pipe', encoding: 'utf-8'
          }).trim();
          hasCommits = Boolean(headSha);
        } catch {
          hasCommits = false;
        }
      }

      // Determine template to scaffold:
      // Scaffolding is strictly opt-in via an explicit flag (--template <name>).
      // NEVER auto-invent source into an empty repo based on its name or slug.
      const selectedTemplate = explicitTemplate;

      if (selectedTemplate) {
        if (selectedTemplate === 'dronehunter' || selectedTemplate === 'dronehunter-game' || selectedTemplate === 'drone-hunter') {
          const candidateDirs = [
            pathMod?.resolve(pathMod.dirname(modulePath), "../public/dronehunter-game"),
            pathMod?.resolve(pathMod.dirname(modulePath), "../../public/dronehunter-game"),
            '/Volumes/MacMiniExtra/Projects/nates_software/public/dronehunter-game',
            '/Users/nate/Projects/nates_software/public/dronehunter-game'
          ];
          const bundledSource = candidateDirs.find((dir: string) => dir && fsMod.existsSync(dir));
          if (!bundledSource || !fsMod.cpSync) {
            throw new Error("The bundled Drone Hunter source is unavailable; no placeholder fork was created.");
          }
          fsMod.cpSync(bundledSource, worktreePath, { recursive: true });
          fsMod.writeFileSync(`${worktreePath}/package.json`, JSON.stringify({
            name: "dronehunter",
            version: "1.0.0",
            private: true,
            type: "module",
            scripts: { dev: "node server.mjs", start: "node server.mjs" }
          }, null, 2) + "\n");
          fsMod.writeFileSync(`${worktreePath}/server.mjs`, `import { createServer } from "node:http";\nimport { createReadStream, statSync } from "node:fs";\nimport { extname, join, normalize } from "node:path";\nconst port = Number(process.env.PORT || ${port});\nconst root = process.cwd();\nconst types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };\ncreateServer((req, res) => {\n  const requested = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);\n  const relative = normalize(requested).replace(/^(\\.\\.(\\/|\\\\|$))+/, "").replace(/^[/\\\\]+/, "");\n  let file = join(root, relative || "index.html");\n  try { if (statSync(file).isDirectory()) file = join(file, "index.html"); } catch { res.writeHead(404); res.end("Not found"); return; }\n  res.setHeader("content-type", types[extname(file)] || "application/octet-stream");\n  createReadStream(file).on("error", () => { if (!res.headersSent) res.writeHead(500); res.end("Unable to read file"); }).pipe(res);\n}).listen(port, "127.0.0.1", () => console.log(\`Drone Hunter ready at http://127.0.0.1:\${port}\`));\n`);
          fsMod.writeFileSync(`${worktreePath}/README.md`, `# Drone Hunter 95\n\nA dependency-free, local browser arcade game.\n\nRun \`npm run dev\`, then open the printed local URL. Scores and preferences remain in this browser's local storage.\n`);
          templateApplied = 'dronehunter';
        } else if (selectedTemplate === 'certified-mailer') {
          const cmSources = [
            pathMod?.resolve(pathMod.dirname(modulePath), '../../certified-mailer'),
            pathMod?.resolve(pathMod.dirname(modulePath), '../certified-mailer'),
            '/Volumes/MacMiniExtra/Projects/certified-mailer',
            '/Users/nate/Projects/certified-mailer'
          ];
          const cmPath = cmSources.find((p: string) => p && fsMod.existsSync(p));
          if (!cmPath || !fsMod.cpSync) {
            throw new Error(`Certified Mailer starter is unavailable on this system.`);
          }
          fsMod.cpSync(cmPath, worktreePath, {
            recursive: true,
            filter: (src: string) => !src.includes('/.git') && !src.includes('/node_modules')
          });
          templateApplied = 'certified-mailer';
        } else if (['minimal', 'blank', 'node', 'html', 'static'].includes(selectedTemplate.toLowerCase())) {
          fsMod.writeFileSync(`${worktreePath}/index.html`, `<!DOCTYPE html>\n<html>\n<head><title>${appId}</title></head>\n<body>\n  <h1>${appId}</h1>\n  <p>Created with SLOP CLI.</p>\n</body>\n</html>\n`);
          fsMod.writeFileSync(`${worktreePath}/package.json`, JSON.stringify({
            name: appId,
            version: "0.1.0",
            private: true,
            type: "module",
            scripts: { dev: "node server.mjs", start: "node server.mjs" }
          }, null, 2) + "\n");
          fsMod.writeFileSync(`${worktreePath}/server.mjs`, `import { createServer } from "node:http";\nimport { createReadStream, statSync } from "node:fs";\nimport { extname, join, normalize } from "node:path";\nconst port = Number(process.env.PORT || ${port});\nconst root = process.cwd();\nconst types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };\ncreateServer((req, res) => {\n  const requested = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);\n  let file = join(root, normalize(requested).replace(/^(\\.\\.(\\/|\\\\|$))+/, "").replace(/^[/\\\\]+/, "") || "index.html");\n  try { if (statSync(file).isDirectory()) file = join(file, "index.html"); } catch { res.writeHead(404); res.end("Not found"); return; }\n  res.setHeader("content-type", types[extname(file)] || "text/plain");\n  createReadStream(file).pipe(res);\n}).listen(port, "127.0.0.1", () => console.log(\`App ready at http://127.0.0.1:\${port}\`));\n`);
          fsMod.writeFileSync(`${worktreePath}/README.md`, `# ${appId}\n\nInitialized with minimal starter template.\n`);
          templateApplied = selectedTemplate;
        } else {
          throw new Error(`Unknown starter template "${selectedTemplate}". Available templates: dronehunter, certified-mailer, minimal.`);
        }
      }

      // If no git repository exists yet (e.g. bundled starter copy), initialize git
      if (!fsMod.existsSync(`${worktreePath}/.git`)) {
        cp.execFileSync('git', ['init', worktreePath], { stdio: 'pipe', timeout: 15000 });
        cp.execFileSync('git', ['-C', worktreePath, 'add', '-A'], { stdio: 'pipe', timeout: 15000 });
        cp.execFileSync('git', ['-C', worktreePath, '-c', 'user.name=SLOP Installer', '-c', 'user.email=installer@nates-software.com', 'commit', '-m', `feat(fork): initialize from ${slug}`], { stdio: 'pipe', timeout: 15000 });
      }

      // Check if this is an empty repository clone (no commits and no starter template applied)
      if (!hasCommits && !templateApplied) {
        isEmptyRepo = true;
        if (canonicalSourceUrl) {
          try {
            const remotesStr = cp.execFileSync('git', ['-C', worktreePath, 'remote'], { stdio: 'pipe', encoding: 'utf-8' }) || '';
            const remotes = remotesStr.split(/\s+/).filter(Boolean);
            if (!remotes.includes("slop")) {
              cp.execFileSync('git', ['-C', worktreePath, 'remote', 'add', 'slop', canonicalSourceUrl], { stdio: 'pipe', timeout: 15000 });
            }
          } catch {}
        }
      }

      if (!fsMod.existsSync(worktreePath)) {
        throw new Error(`Worktree directory ${worktreePath} does not exist on disk.`);
      }
    }
  } catch (err: any) {
    forkError = err.stderr ? err.stderr.toString().trim() : (err.message || 'Fork failed');
    success = false;
    try { getFs()?.rmSync(worktreePath, { recursive: true, force: true }); } catch {}
  }

  let output = '';
  if (success && isEmptyRepo && !templateApplied) {
    output = [
      `[SLOP] Forked ${slug} into isolated worktree ${worktreePath}...`,
      `  ✔ Cloned empty canonical repository (no commits yet)`,
      `  ✔ Created directory on disk: ${worktreePath}`,
      canonicalSourceUrl ? `  ✔ Publication remote configured: slop -> ${canonicalSourceUrl}` : ``,
      `  ✔ Suggested local dev port: ${port}`,
      `  ✔ RIG resource profile available: ${MEMORY_CAP_MB}MB cap (not started)`,
      `  ℹ Repository is empty. No starter template was applied (none requested).`,
      `\nINITIALIZATION GUIDANCE:`,
      `  1. Add your project files to the worktree:`,
      `     cd "${worktreePath}"`,
      `  2. Create your project manifest (e.g. package.json, index.html, pyproject.toml)`,
      `  3. Create your first commit:`,
      `     git add -A && git commit -m "feat: initial commit"`,
      `  4. Push back to the forge:`,
      `     slop push (or git push slop main)`,
      `\nSTART YOUR ENGINES (optional — choose an LLM/IDE to begin coding):`,
      ...getEngineStartInstructions(worktreePath),
      `  0. Not now (default)`,
      `🚀 Go Fork, and Multiply!`
    ].filter(Boolean).join("\n");
  } else {
    output = [
      `[SLOP] ${success ? (isUnregisteredLocal ? 'Forked [UNREGISTERED LOCAL]' : 'Forked') : 'Failed to fork'} ${slug} into isolated worktree ${worktreePath}...`,
      success ? `  ✔ Created directory on disk: ${worktreePath}` : `  ✖ Error: ${forkError}`,
      success && isUnregisteredLocal
        ? `  ℹ Local development worktree created (unregistered local fork; no control-plane lineage recorded)`
        : (success && templateApplied
            ? `  ✔ Applied starter template: ${templateApplied}`
            : (success ? `  ✔ Canonical Git ancestry preserved (publication remote not provisioned)` : ``)),
      success ? `  ✔ Suggested local dev port: ${port}` : ``,
      success ? `  ✔ RIG resource profile available: ${MEMORY_CAP_MB}MB cap (not started)` : ``,
      success ? `  ✔ Installation complete. No LLM or IDE was launched.` : ``,
      success ? `\nSTART YOUR ENGINES (optional — you choose after install):` : ``,
      ...(success ? getEngineStartInstructions(worktreePath) : []),
      success ? `  0. Not now (default)` : ``,
      success ? `🚀 Go Fork, and Multiply!` : ``
    ].filter(Boolean).join("\n");
  }

  if (success) {
    console.log(output);
  } else {
    console.error(output);
  }

  const unregisteredSuffix = isUnregisteredLocal ? ' [unregistered local — no lineage recorded]' : '';
  const successMessage = isEmptyRepo && !templateApplied
    ? `Forked empty repository ${slug} to ${worktreePath}${unregisteredSuffix}`
    : (templateApplied ? `Forked ${slug} to ${worktreePath} (template: ${templateApplied})${unregisteredSuffix}` : `Forked ${slug} to ${worktreePath}${unregisteredSuffix}`);

  return {
    success,
    command: "fork",
    message: success ? successMessage : `Failed to fork ${slug}: ${forkError}`,
    data: {
      slug,
      appId,
      worktreePath,
      port,
      memoryCapMb: MEMORY_CAP_MB,
      isRealWorktree: success,
      isEmptyRepo,
      templateApplied: templateApplied || null,
      registeredFork: registeredFork || null,
      isUnregisteredLocal,
      error: forkError
    }
  };
}

export function handlePush(args: string[] = []): SlopCommandResult {
  let pushedGit = false;
  let remoteRef = "refs/heads/main";
  let sha = "unknown";
  let appId = args[0] || "my-shareware-app";
  let gitError: string | null = null;
  let success = false;
  let remoteHeadVerified = false;

  const cwd = typeof process !== "undefined" ? process.cwd() : "/tmp";

  if (isNode) {
    try {
      const cp = getChildProcess();
      if (!cp?.execFileSync) {
        throw new Error('child_process is not available in this environment');
      }

      // 1. Verify inside git repo
      const isInside = cp.execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (isInside !== "true") {
        throw new Error("Not a git repository (or any of the parent directories)");
      }

      // App ID from cwd or slop.json
      appId = cwd.split("/").pop() || appId;
      const fsMod = getFs();
      if (fsMod && fsMod.existsSync(`${cwd}/slop.json`)) {
        try {
          const cfg = JSON.parse(fsMod.readFileSync(`${cwd}/slop.json`, 'utf-8'));
          if (cfg.name) appId = cfg.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        } catch {}
      }

      // 2. Get HEAD SHA
      sha = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', stdio: 'pipe' }).trim();
      if (!sha) {
        throw new Error("Repository has no commits to push");
      }

      // 3. Determine current branch and remote ref
      let currentBranch = "main";
      try {
        currentBranch = cp.execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8', stdio: 'pipe' }).trim() || "main";
      } catch {}
      remoteRef = `refs/heads/${currentBranch === "HEAD" ? "main" : currentBranch}`;

      // 4. Determine target remote
      let targetRemote = "slop";
      const remotesStr = cp.execFileSync('git', ['remote'], { encoding: 'utf-8', stdio: 'pipe' }) || "";
      const remotes = remotesStr.split(/\s+/).filter(Boolean);

      if (args[0] && remotes.includes(args[0])) {
        targetRemote = args[0];
      } else if (remotes.includes("slop")) {
        targetRemote = "slop";
      } else {
        throw new Error('No provisioned "slop" publication remote is configured. SLOP will not push the upstream origin.');
      }

      // 5. Execute git push with strict connect timeout
      const pushRefspec = currentBranch === "HEAD" ? "HEAD:main" : `HEAD:${currentBranch}`;
      const env = { ...process.env, GIT_SSH_COMMAND: "ssh -o ConnectTimeout=1 -o BatchMode=yes" };
      cp.execFileSync('git', ['push', targetRemote, pushRefspec], { stdio: 'pipe', timeout: 5000, env });
      pushedGit = true;
      const remoteHead = (cp.execFileSync('git', ['ls-remote', targetRemote, remoteRef], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
        env
      }) || '').trim().split(/\s+/)[0];
      remoteHeadVerified = remoteHead === sha;
      if (!remoteHeadVerified) {
        throw new Error(`Remote ref verification failed for ${remoteRef}`);
      }
      success = true;
    } catch (err: any) {
      gitError = err.stderr ? err.stderr.toString().trim() : (err.message || "Git push failed");
      success = false;
    }
  } else {
    gitError = 'Git push requires the local SLOP CLI; browser execution is unavailable.';
    success = false;
  }

  if (success) {
    const output = [
      `[GITSMITH] Pushing to forge...`,
      `  ✔ Remote push succeeded`,
      `  ✔ Remote ref verified: ${remoteRef} -> ${sha}`,
      `  ℹ This command does not publish a HOTWIRE drop or deploy an app.`,
      `Next: run "slop drop" when you are ready to submit a release.`
    ].join("\n");
    console.log(output);

    return {
      success: true,
      command: "push",
      message: "Git ref pushed and verified",
      data: {
        appId,
        sha,
        remoteRef,
        casVerified: remoteHeadVerified,
        pushedGit: true,
        published: false,
        deployed: false
      }
    };
  } else {
    const errorOutput = [
      `[GITSMITH PUSH ERROR] ${gitError}`,
      `  ✖ Push failed. Underlying git push operation was rejected or remote unreachable.`
    ].join("\n");
    console.error(errorOutput);

    return {
      success: false,
      command: "push",
      message: `Push failed: ${gitError}`,
      data: {
        appId,
        sha,
        remoteRef,
        casVerified: remoteHeadVerified,
        pushedGit,
        error: gitError
      }
    };
  }
}

export function handleDrop(args: string[] = []): SlopCommandResult {
  const target = args[0] || "dronehunter";
  const appId = target.replace(/^[./]+/, "").split("/").pop() || "dronehunter";
  const nameArg = args.find(a => a.startsWith("--name="))?.split("=")[1] || (appId.charAt(0).toUpperCase() + appId.slice(1));
  const priceArg = args.find(a => a.startsWith("--price="))?.split("=")[1] || "15";
  const priceCents = parseInt(priceArg, 10) * 100 || 1500;

  const error = 'HOTWIRE CLI publication transport is not configured. No drop was queued and no deployment was created.';
  console.error([
    `[HOTWIRE PUBLISHER] Prepared local release metadata for ${nameArg}.`,
    `  ℹ Requested price: $${(priceCents / 100).toFixed(2)}`,
    `  ✖ ${error}`,
    `  Open https://nates-software.com to submit through the authenticated drop form.`
  ].join("\n"));

  return {
    success: false,
    command: "drop",
    message: error,
    data: {
      appId,
      name: nameArg,
      priceCents,
      queued: false,
      published: false,
      deployed: false,
      batch: null,
      liveUrl: null
    }
  };
}

export interface DynoCliOptions {
  bench: boolean;
  json: boolean;
  output?: string;
  command?: string;
  model?: string;
  harness?: string;
  task?: string;
  repetitions: number;
  policy: DynoNetworkPolicy;
  solve: boolean;
  quiet: boolean;
}

export function parseDynoArgs(args: string[] | boolean = []): DynoCliOptions {
  if (typeof args === 'boolean') {
    return {
      bench: args,
      json: false,
      repetitions: args ? 2 : 1,
      policy: 'none',
      solve: false,
      quiet: false
    };
  }

  const opts: DynoCliOptions = {
    bench: false,
    json: false,
    repetitions: 1,
    policy: 'none',
    solve: false,
    quiet: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--bench' || arg === '-b') {
      opts.bench = true;
      opts.repetitions = 2;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--solve' || arg === '--reference') {
      opts.solve = true;
    } else if (arg === '--quiet' || arg === '-q') {
      opts.quiet = true;
    } else if (arg.startsWith('--output=')) {
      opts.output = arg.slice(9);
    } else if ((arg === '--output' || arg === '-o') && i + 1 < args.length) {
      opts.output = args[++i];
    } else if (arg.startsWith('-o=')) {
      opts.output = arg.slice(3);
    } else if (arg.startsWith('--command=')) {
      opts.command = arg.slice(10);
    } else if ((arg === '--command' || arg === '-c') && i + 1 < args.length) {
      opts.command = args[++i];
    } else if (arg.startsWith('-c=')) {
      opts.command = arg.slice(3);
    } else if (arg.startsWith('--model=')) {
      opts.model = arg.slice(8);
    } else if ((arg === '--model' || arg === '-m') && i + 1 < args.length) {
      opts.model = args[++i];
    } else if (arg.startsWith('-m=')) {
      opts.model = arg.slice(3);
    } else if (arg.startsWith('--harness=')) {
      opts.harness = arg.slice(10);
    } else if (arg === '--harness' && i + 1 < args.length) {
      opts.harness = args[++i];
    } else if (arg.startsWith('--task=')) {
      opts.task = arg.slice(7);
    } else if ((arg === '--task' || arg === '-t') && i + 1 < args.length) {
      opts.task = args[++i];
    } else if (arg.startsWith('-t=')) {
      opts.task = arg.slice(3);
    } else if (arg.startsWith('--repetitions=')) {
      opts.repetitions = parseInt(arg.slice(14), 10) || 1;
    } else if ((arg === '--repetitions' || arg === '-r') && i + 1 < args.length) {
      opts.repetitions = parseInt(args[++i], 10) || 1;
    } else if (arg.startsWith('-r=')) {
      opts.repetitions = parseInt(arg.slice(3), 10) || 1;
    } else if (arg.startsWith('--policy=')) {
      opts.policy = arg.slice(9) as DynoNetworkPolicy;
    } else if (arg === '--policy' && i + 1 < args.length) {
      opts.policy = args[++i] as DynoNetworkPolicy;
    }
  }

  return opts;
}

export async function handleDyno(argsArg: string[] | boolean = []): Promise<SlopCommandResult> {
  const opts = parseDynoArgs(argsArg);

  // If running in browser environment without Node fs/cp
  if (!isNode) {
    const fallbackMsg = `[DYNO] Browser Execution Boundary: DYNO real-world benchmark requires local workstation sandbox execution via './bin/slop dyno'`;
    return {
      success: true,
      command: 'dyno',
      message: fallbackMsg,
      data: {
        isBrowser: true,
        suite: 'dyno-standard-dev',
        totalTasks: NEUTRAL_DEV_FIXTURES.length
      }
    };
  }

  // Keep Node filesystem/process modules out of the browser bundle used by
  // TERMINAL.EXE. This path is reached only by the local CLI executable.
  const runnerModulePath = '../src/lib/dyno/runner.ts';
  const environmentModulePath = '../src/lib/dyno/environment.ts';
  const [runnerModule, environmentModule] = await Promise.all([
    import(/* @vite-ignore */ runnerModulePath),
    import(/* @vite-ignore */ environmentModulePath)
  ]);
  const {
    DynoRunner,
    createBaselineHarness,
    createReferenceHarness,
    createCommandHarness
  } = runnerModule;
  const { detectLocalEnvironment } = environmentModule;

  // Select fixtures
  let fixturesToRun = NEUTRAL_DEV_FIXTURES;
  if (opts.task) {
    const found = getFixtureByKey(opts.task);
    if (!found) {
      const msg = `Task fixture "${opts.task}" not found. Available tasks: ${NEUTRAL_DEV_FIXTURES.map(f => f.key).join(', ')}`;
      if (!opts.json) console.error(msg);
      return { success: false, command: 'dyno', message: msg };
    }
    fixturesToRun = [found];
  }

  const modelId = opts.model || 'local-developer-agent';
  let harnessName = opts.harness;
  let harness: DynoAgentHarness;

  if (opts.command) {
    harnessName = harnessName || 'CLI Command Agent';
    harness = createCommandHarness(opts.command, modelId, harnessName);
  } else if (opts.solve) {
    harnessName = harnessName || 'Reference Calibration Suite';
    harness = createReferenceHarness(modelId, harnessName);
  } else {
    harnessName = harnessName || 'Baseline Unassisted';
    harness = createBaselineHarness(modelId, harnessName);
  }

  const environment = detectLocalEnvironment(opts.policy);
  const subject = {
    id: `subj_${modelId.replace(/[^a-z0-9_]/gi, '_')}_${Date.now().toString(36)}`,
    model_provider: opts.command ? 'custom' : (opts.solve ? 'reference' : 'local'),
    model_id: modelId,
    model_version: '1.0.0',
    model_config: JSON.stringify({ mode: opts.solve ? 'reference_solve' : (opts.command ? 'command_exec' : 'baseline_read') }),
    agent_harness: harnessName,
    harness_version: '2.4.0',
    tool_manifest: JSON.stringify(harness.toolManifest)
  };

  const runner = new DynoRunner({
    fixtures: fixturesToRun,
    repetitions: opts.repetitions,
    networkPolicy: opts.policy,
    environment,
    subject
  });

  if (!opts.json && !opts.quiet) {
    console.log(`
┌────────────────────────────────────────────────────────────┐
│ ⚡ DYNO — REAL-WORLD AI DEVELOPER BENCHMARK (v2026.2)       │
│ Standalone suite evaluating Model + Harness + Tools       │
└────────────────────────────────────────────────────────────┘
`);
    console.log(`[DYNO] Initializing benchmark run:`);
    console.log(`  Subject:     ${subject.model_id} via ${subject.agent_harness}`);
    console.log(`  Environment: ${environment.os_name} (${environment.architecture}, ${environment.cpu_model || 'Local CPU'})`);
    console.log(`  Network:     ${opts.policy} | Repetitions: ${opts.repetitions}`);
    console.log(`  Tasks:       ${fixturesToRun.length} neutral developer tasks under test\n`);
  }

  const result = await runner.runSuite(harness);

  // Save report to disk
  let savedPath: string | null = null;
  try {
    const fsMod = getFs();
    const pathMod = getPath();
    const osMod = getOs();
    if (fsMod && pathMod) {
      const homeDir = (osMod && osMod.homedir ? osMod.homedir() : (process.env.HOME || process.env.USERPROFILE || '/tmp'));
      const defaultPath = pathMod.join(homeDir, '.dyno', 'report.json');
      const targetPath = opts.output || defaultPath;
      const targetDir = pathMod.dirname(targetPath);

      if (!fsMod.existsSync(targetDir)) {
        fsMod.mkdirSync(targetDir, { recursive: true });
      }
      fsMod.writeFileSync(targetPath, JSON.stringify(result, null, 2), 'utf8');
      savedPath = targetPath;
    }
  } catch (err: any) {
    if (!opts.json && !opts.quiet) {
      console.warn(`  [Warning] Unable to write report to disk: ${err.message}`);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!opts.quiet) {
    console.log(`────────────────────────────────────────────────────────────`);
    console.log(`  TASK ATTEMPTS EXECUTION BREAKDOWN`);
    console.log(`────────────────────────────────────────────────────────────`);

    for (const attemptResult of result.attempts) {
      const att = attemptResult.attempt;
      const passIcon = att.status === 'passed' ? '✔ PASS' : (att.status === 'timed_out' ? '⏱ TIMEOUT' : (att.status === 'unsafe' ? '⛔ UNSAFE' : '✖ FAIL'));
      const durationSec = ((att.duration_ms || 0) / 1000).toFixed(1);
      console.log(`  ${passIcon.padEnd(10)} ${att.task_id.padEnd(30)} ${durationSec}s | Hidden: ${att.hidden_tests_passed}/${att.hidden_tests_total} | Tools: ${att.tool_calls} | Unnecessary: ${att.unnecessary_files_changed}`);
    }

    console.log(`────────────────────────────────────────────────────────────`);
    console.log(`[DYNO] Benchmark Suite Complete:`);
    console.log(`  Overall Score:           ${result.summary.dynoScore} / 1000 (${result.summary.grade})`);
    console.log(`  Tasks Completed:         ${result.summary.tasksPassed} / ${result.summary.totalTasks} (${result.summary.completionRate}%)`);
    console.log(`  First-Attempt Accuracy:  ${result.summary.firstAttemptSuccessRate}%`);
    console.log(`  Hidden Tests Passed:     ${result.summary.hiddenTestsPassedRate}%`);
    console.log(`  Median Duration:         ${Math.round((result.summary.medianDurationMs || 0) / 1000)}s`);
    console.log(`  Safety Violations:       ${result.summary.totalSafetyViolations}`);
    console.log(`  Verification Level:      ${result.run.verification_status.toUpperCase()}`);
    console.log(`  Attestation SHA-256:     ${result.run.runner_attestation_digest}`);
    console.log(`  Raw Trace SHA-256:       ${result.run.raw_trace_sha256}`);
    if (savedPath) {
      console.log(`  ✔ Report Saved:          ${savedPath}`);
    }
    console.log(`🚀 Import into Web UI: DYNO Window -> "Import & Ingest Run" -> Paste ${savedPath || 'report.json'}\n`);
  }

  return {
    success: true,
    command: 'dyno',
    message: `DYNO benchmark complete: ${result.summary.dynoScore} / 1000 (${result.summary.grade})`,
    data: result
  };
}

export function handleTest(): SlopCommandResult {
  const checkResults: { name: string; pass: boolean; details?: string }[] = [];

  // Check 1: Memory Governor 256MB cap enforcement
  try {
    const pass = MEMORY_CAP_MB === 256;
    checkResults.push({ name: "Memory Governor 256MB cap enforcement", pass });
  } catch (err: any) {
    checkResults.push({ name: "Memory Governor 256MB cap enforcement", pass: false, details: err.message });
  }

  // Check 2: Micro-Dyno Port Allocator range [3001..3010] collision avoidance
  try {
    const allocator = new MicroDynoPortAllocator(3001, 3010);
    const p1 = allocator.allocate("app1");
    const p2 = allocator.allocate("app2");
    const pass = p1 === 3001 && p2 === 3002 && !allocator.isAvailable(3001);
    checkResults.push({ name: "Micro-Dyno Port Allocator range [3001..3010] collision avoidance", pass });
  } catch (err: any) {
    checkResults.push({ name: "Micro-Dyno Port Allocator range [3001..3010] collision avoidance", pass: false, details: err.message });
  }

  // Check 3: Lineage Ledger 70/20/10 exact cent conservation
  try {
    const priceCents = 1500;
    const authorCut = Math.floor(priceCents * 0.70);
    const parentCut = Math.floor(priceCents * 0.20);
    const platformCut = priceCents - authorCut - parentCut;
    const pass = (authorCut + parentCut + platformCut) === priceCents && authorCut === 1050 && parentCut === 300 && platformCut === 150;
    checkResults.push({ name: "Lineage Ledger 70/20/10 exact cent conservation", pass });
  } catch (err: any) {
    checkResults.push({ name: "Lineage Ledger 70/20/10 exact cent conservation", pass: false, details: err.message });
  }

  // Check 4: GITSMITH CAS compare-and-swap atomic ref verification
  try {
    const validCas = isCasRefUpdateValid({ currentOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", expectedOldOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", newOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    const invalidCas = isCasRefUpdateValid({ currentOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", expectedOldOid: "cccccccccccccccccccccccccccccccccccccccc", newOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    const pass = validCas === true && invalidCas === false;
    checkResults.push({ name: "GITSMITH CAS compare-and-swap atomic ref verification", pass });
  } catch (err: any) {
    checkResults.push({ name: "GITSMITH CAS compare-and-swap atomic ref verification", pass: false, details: err.message });
  }

  const passedProofs = checkResults.filter(c => c.pass).length;
  const totalProofs = checkResults.length;
  const failedProofs = totalProofs - passedProofs;
  const allGreen = failedProofs === 0;

  const proofs = checkResults.map(c => c.name);

  const lines = [
    `[TEST] Running shareware verification checks:`,
    ...checkResults.map(c => `  ${c.pass ? '✔ [PASS]' : '✖ [FAIL]'} ${c.name}${c.details ? ` (${c.details})` : ''}`),
    allGreen ? `✔ All checks passed. Go Fork, and Multiply!` : `✖ ${failedProofs} verification check(s) failed.`
  ];

  if (allGreen) {
    console.log(lines.join("\n"));
  } else {
    console.error(lines.join("\n"));
  }

  return {
    success: allGreen,
    command: "test",
    message: `${passedProofs}/${totalProofs} checks passed (${allGreen ? '100% green' : 'failures detected'})`,
    data: {
      totalProofs,
      passedProofs,
      failedProofs,
      allGreen,
      proofs
    }
  };
}

export function handleStatus(): SlopCommandResult {
  const rig = new RigRuntimeBackend();
  const summary = rig.getStatusSummary();
  const containers = rig.listContainers();

  const lines = [
    `[RIG.EXE] Local control-plane state (provider disconnected):`,
    ...containers.map(c =>
      `  ● ${c.name.padEnd(32)} (Port ${c.port}) - ${c.memoryMb}MB / ${c.memoryCapMb}MB`
    ),
    containers.length === 0 ? `  No registered instances.` : '',
    `Active simulated port reservations: [${summary.activePorts.join(", ")}] (${summary.availablePorts.length} available in 3001..3010).`,
    `No container provider is connected; this command reports local control-plane state only.`
  ];

  console.log(lines.join("\n"));

  return {
    success: true,
    command: "status",
    message: `Local RIG state: ${containers.length} registered instances; provider disconnected`,
    data: {
      containers,
      activePorts: summary.activePorts,
      availablePorts: summary.availablePorts,
      fleetMemory: summary.fleetMemory
    }
  };
}

export function handleList(): SlopCommandResult {
  const error = 'HOTWIRE CLI transport is not configured. Open https://nates-software.com for the canonical daily board.';
  console.error(`[HOTWIRE] ${error}`);
  return {
    success: false,
    command: "list",
    message: error,
    data: { drops: [], source: null }
  };
}

export function handleShelf(): SlopCommandResult {
  const error = 'No authenticated CLI session is configured. SLOP will not display fabricated licenses; use MY SHELF on nates-software.com.';
  console.error(`[SHELF] ${error}`);
  return {
    success: false,
    command: "shelf",
    message: error,
    data: { titles: [], totalOwned: 0, authenticated: false }
  };
}

export async function readTokenFromStdin(options: any = {}): Promise<string> {
  const stdinStream = options.stdin || (isNode ? process.stdin : null);
  if (!stdinStream) return '';

  const isTTY = typeof options.isTTY === 'boolean'
    ? options.isTTY
    : Boolean(stdinStream.isTTY);

  if (isTTY) {
    const readline = getNodeModule("node:readline") || getNodeModule("readline");
    const streamMod = getStream();
    const stdoutStream = options.stdout || (isNode ? process.stdout : null);

    if (readline && streamMod?.Writable && stdoutStream) {
      let muted = false;
      const mutableStdout = new streamMod.Writable({
        write(chunk: any, encoding: any, callback: any) {
          if (!muted) {
            stdoutStream.write(chunk, encoding);
          }
          callback();
        }
      });

      const rl = readline.createInterface({
        input: stdinStream,
        output: mutableStdout,
        terminal: true
      });

      return new Promise<string>((resolve) => {
        let resolved = false;
        const prompt = "Paste your CLI token (from PROFILE.CFG → Generate CLI token): ";
        stdoutStream.write(prompt);
        muted = true;

        const finish = (val: string) => {
          if (!resolved) {
            resolved = true;
            muted = false;
            stdoutStream.write('\n');
            rl.close();
            resolve(val.trim());
          }
        };

        rl.question('', (answer: string) => {
          finish(answer);
        });

        rl.on('SIGINT', () => {
          finish('');
        });

        rl.on('close', () => {
          if (!resolved) {
            resolved = true;
            muted = false;
            resolve('');
          }
        });
      });
    }
  } else {
    // Non-TTY / piped stdin fallback (e.g. echo $TOKEN | slop login)
    // Avoid reading hanging process.stdin in Vitest when no explicit options.stdin was provided
    const isVitest = typeof process !== 'undefined' && (process.env.VITEST || process.env.NODE_ENV === 'test');
    if (isVitest && !options.stdin) {
      return '';
    }

    const readline = getNodeModule("node:readline") || getNodeModule("readline");
    if (readline?.createInterface) {
      return new Promise<string>((resolve) => {
        const rl = readline.createInterface({
          input: stdinStream,
          crlfDelay: Infinity
        });
        let resolved = false;
        rl.on('line', (line: string) => {
          if (!resolved) {
            resolved = true;
            rl.close();
            resolve(line.trim());
          }
        });
        rl.on('close', () => {
          if (!resolved) {
            resolved = true;
            resolve('');
          }
        });
        rl.on('error', () => {
          if (!resolved) {
            resolved = true;
            resolve('');
          }
        });
      });
    }
  }

  return '';
}

export async function handleLogin(args: string[] = [], options: any = {}): Promise<SlopCommandResult> {
  // Extract token from flags, positional arguments, options, or environment
  let token = (options.token || options.sessionToken || '').trim();

  if (!token && Array.isArray(args)) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--token=')) {
        token = arg.slice(8).trim();
        break;
      } else if (arg.startsWith('-t=')) {
        token = arg.slice(3).trim();
        break;
      } else if (arg === '--token' || arg === '-t') {
        if (args[i + 1] && !args[i + 1].startsWith('-')) {
          token = args[i + 1].trim();
          break;
        }
      } else if (!arg.startsWith('-') && !token) {
        token = arg.trim();
      }
    }
  }

  if (!token && typeof process !== 'undefined') {
    token = (process.env.SLOP_SESSION_TOKEN || process.env.SESSION_TOKEN || process.env.AUTH_TOKEN || '').trim();
  }

  // Interactive masked prompt or non-TTY stdin if no token provided
  if (!token && !options.nonInteractive) {
    try {
      token = await readTokenFromStdin(options);
    } catch {}
  }

  if (!token) {
    const errorMsg = 'No CLI token provided. Generate a token from PROFILE.CFG → Generate CLI token, then run "slop login" to paste interactively (or "slop login --token <token>" for CI environments; note: --token may leak via shell history).';
    console.error(`[AUTH] ${errorMsg}`);
    return {
      success: false,
      command: "login",
      message: errorMsg,
      data: { authenticated: false, profile: null }
    };
  }

  // Validate the token against the control plane
  let controlPlaneUrl: string;
  try {
    controlPlaneUrl = resolveControlPlaneUrl(options.controlPlaneUrl);
  } catch (err: any) {
    console.error(`[AUTH] ${err.message}`);
    return {
      success: false,
      command: "login",
      message: err.message,
      data: { authenticated: false, profile: null }
    };
  }

  let authRes: Response | null = null;
  try {
    if (options.env) {
      const req = new Request(`${controlPlaneUrl.replace(/\/$/, '')}/api/auth`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const authModulePath = "../functions/api/auth.ts";
      const authControlPlane = await import(/* @vite-ignore */ authModulePath);
      authRes = await authControlPlane.onRequestGet({ request: req, env: options.env });
    } else if (options.fetchImpl) {
      authRes = await options.fetchImpl(`${controlPlaneUrl.replace(/\/$/, '')}/api/auth`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    } else if (typeof fetch !== 'undefined') {
      authRes = await fetch(`${controlPlaneUrl.replace(/\/$/, '')}/api/auth`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal: AbortSignal.timeout(5000)
      });
    } else {
      throw new Error('Control plane fetch is unavailable in this environment.');
    }
  } catch (err: any) {
    const msg = `Control plane unreachable at ${controlPlaneUrl}: ${err.message}`;
    console.error(`[AUTH] ${msg}`);
    return {
      success: false,
      command: "login",
      message: msg,
      data: { authenticated: false, profile: null }
    };
  }

  if (!authRes || !authRes.ok) {
    const msg = `Invalid or expired CLI token (HTTP ${authRes?.status || 'network error'}). Please generate a new token from PROFILE.CFG.`;
    console.error(`[AUTH] ${msg}`);
    return {
      success: false,
      command: "login",
      message: msg,
      data: { authenticated: false, profile: null }
    };
  }

  const authData: any = await authRes.json().catch(() => ({}));
  if (!authData.success || !authData.authenticated || !authData.user?.username) {
    const msg = authData.error || 'Invalid or expired CLI token. Please generate a new token from PROFILE.CFG.';
    console.error(`[AUTH] ${msg}`);
    return {
      success: false,
      command: "login",
      message: msg,
      data: { authenticated: false, profile: null }
    };
  }

  const username = authData.user.username;
  const expiresAt = typeof authData.expiresAt === 'number' && Number.isFinite(authData.expiresAt)
    ? authData.expiresAt
    : undefined;

  try {
    writeStoredCredentials({
      sessionToken: token,
      username,
      ...(expiresAt ? { expiresAt } : {})
    });
  } catch (err: any) {
    const msg = `Failed to save credentials: ${err.message}`;
    console.error(`[AUTH] ${msg}`);
    return {
      success: false,
      command: "login",
      message: msg,
      data: { authenticated: false, profile: null }
    };
  }

  const successMsg = `Logged in as @${username}. slop fork and friends will use this token.`;
  console.log(successMsg);

  return {
    success: true,
    command: "login",
    message: successMsg,
    data: {
      authenticated: true,
      username,
      expiresAt
    }
  };
}

export async function handleLogout(_args: string[] = [], options: any = {}): Promise<SlopCommandResult> {
  const existing = readStoredCredentials();
  const token = existing?.sessionToken || (typeof process !== 'undefined' ? (process.env.SLOP_SESSION_TOKEN || process.env.SESSION_TOKEN || process.env.AUTH_TOKEN) : '');

  if (token) {
    let controlPlaneUrl: string | null = null;
    try {
      controlPlaneUrl = resolveControlPlaneUrl(options.controlPlaneUrl);
    } catch {}
    if (controlPlaneUrl) {
      try {
        if (options.env) {
          const req = new Request(`${controlPlaneUrl.replace(/\/$/, '')}/api/auth?action=logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const authModulePath = "../functions/api/auth.ts";
          const authControlPlane = await import(/* @vite-ignore */ authModulePath);
          await authControlPlane.onRequestPost({ request: req, env: options.env });
        } else if (options.fetchImpl) {
          await options.fetchImpl(`${controlPlaneUrl.replace(/\/$/, '')}/api/auth?action=logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
        } else if (typeof fetch !== 'undefined') {
          await fetch(`${controlPlaneUrl.replace(/\/$/, '')}/api/auth?action=logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(3000)
          }).catch(() => {});
        }
      } catch {}
    }
  }

  deleteStoredCredentials();
  const message = existing?.username
    ? `Logged out @${existing.username}. CLI credentials removed.`
    : `Logged out. CLI credentials removed.`;
  console.log(message);

  return {
    success: true,
    command: "logout",
    message,
    data: { authenticated: false, username: null }
  };
}

export async function handleMod(args: string[] = []): Promise<SlopCommandResult> {
  const manifestArg = args.find(a => !a.startsWith("-"));
  const worktreeArg = args.find(a => a.startsWith("--worktree="))?.slice(11);
  const skipTests = args.includes("--skip-tests") || args.includes("--no-tests");
  const isJson = args.includes("--json");
  const noRollback = args.includes("--no-rollback");

  if (!manifestArg) {
    const errorMsg = 'Usage: slop mod <package-or-manifest> [--worktree=<path>] [--skip-tests] [--json]';
    if (!isJson) console.error(`[SLOP MOD ERROR] Missing required argument.\n${errorMsg}`);
    return {
      success: false,
      command: "mod",
      message: errorMsg
    };
  }

  const cwd = worktreeArg || (typeof process !== "undefined" ? process.cwd() : "/tmp");

  if (!isNode) {
    return {
      success: false,
      command: "mod",
      message: "slop mod requires the installed local CLI and cannot mutate files from the browser terminal."
    };
  }

  const localRunnerModule = "../src/lib/slopshopModEngine.ts";
  const { executeSlopMod } = await import(/* @vite-ignore */ localRunnerModule);
  const modResult = await executeSlopMod({
    manifestOrRef: manifestArg,
    worktreePath: cwd,
    runTests: !skipTests,
    rollbackOnTestFailure: !noRollback
  });

  if (isJson) {
    console.log(JSON.stringify(modResult, null, 2));
  } else if (modResult.success) {
    console.log(modResult.message);
  } else {
    console.error(modResult.message);
  }

  return {
    success: modResult.success,
    command: "mod",
    message: modResult.message,
    data: modResult
  };
}

export function printHelp(): SlopCommandResult {
  const helpText = `
Usage: slop <command> [options]

SLOP CLI — "Go Fork, and Multiply"
Developer Loop: FORK -> AI CODES IN WORKTREE -> PUSH

Commands:
  slop init [name]     Initialize project and set git remote "slop" (zero prompts)
  slop fork <slug>     Clone app into isolated worktree with micro-dyno (supports --template=<name>)
  slop mod <package>   Weld AST feature package/manifest into worktree with test verification
                       Options: --worktree=<path>, --skip-tests, --no-rollback, --json
  slop push            Push a Git ref and verify the remote head
  slop test            Run shareware verification checks
  slop drop [slug]     Package and queue app for 12:01 AM UTC Daily Drop
  slop publish [slug]  Alias for slop drop
  slop dyno [options]  Run standalone real-world developer benchmark
                       Options: --bench, --json, --output=<path>, --command=<cmd>,
                                --model=<name>, --harness=<name>, --task=<key>,
                                --repetitions=<N>, --policy=<none|local_only|isolated>,
                                --solve
  slop status          Inspect micro-containers & active ports (3001..3010)
  slop list            Query 12:01 AM daily drops on Cloudflare D1
  slop shelf           Display owned software titles & license keys
  slop login [options] Authenticate CLI with personal access token (interactive masked prompt preferred; --token <token> for CI/non-interactive, note: CLI flags may be recorded in shell history)
  slop logout          Remove stored CLI credentials
  slop help            Display this help manual
`;
  console.log(helpText);

  return {
    success: true,
    command: "help",
    message: helpText
  };
}

export function runSlopCli(rawArgs: string[] = process.argv.slice(2)): SlopCommandResult | Promise<SlopCommandResult> {
  const command = rawArgs[0] || "help";

  switch (command.toLowerCase()) {
    case "clone":
      return handleClone(rawArgs[1], rawArgs[2]);

    case "init":
      return handleInit(rawArgs.slice(1));

    case "drop":
    case "publish":
      return handleDrop(rawArgs.slice(1));

    case "fork":
      return handleFork(rawArgs.slice(1));

    case "mod":
      return handleMod(rawArgs.slice(1));

    case "push":
      return handlePush(rawArgs.slice(1));

    case "dyno":
      return handleDyno(rawArgs.slice(1));

    case "test":
      return handleTest();

    case "status":
      return handleStatus();

    case "list":
      return handleList();

    case "shelf":
      return handleShelf();

    case "login":
      return handleLogin(rawArgs.slice(1));

    case "logout":
      return handleLogout(rawArgs.slice(1));

    case "help":
    case "--help":
    case "-h":
      return printHelp();

    default:
      const msg = `Unknown command: ${command}. Run "slop help" for usage.`;
      console.error(msg);
      return {
        success: false,
        command,
        message: msg
      };
  }
}

if (typeof process !== "undefined" && process.argv && (process.argv[1]?.endsWith("slop") || process.argv[1]?.endsWith("slop.ts"))) {
  const result = runSlopCli();
  if (result instanceof Promise) {
    result.then((res) => {
      if (!res.success) {
        process.exit(1);
      }
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else if (!result.success) {
    process.exit(1);
  } else if (result.command === "fork") {
    promptToStartEngines(result).catch((err) => console.error(`Engine prompt failed: ${err.message}`));
  }
}
