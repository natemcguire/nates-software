// Safe Git Filesystem Storage and Authoritative Git Command Runner
// Guarantees path sandboxing beneath configured explicit root, symlink protection,
// object format (sha1/sha256) support, and git update-ref compare-and-swap.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import type {
  AuthoritativeRefCasParams,
  AuthoritativeRefCasResult,
  ForkProvisionParams,
  ForkProvisionResult,
  GitCapabilities,
  GitCommitInfo,
  DiffHunk,
  GitFileDiff,
  ProposalDiffResult,
  ProvisionRepoParams,
  ProvisionRepoResult,
  RepositoryObjectFormat,
  StorageValidationResult
} from './types.ts';
import { validateGitRef, validateGitOid, isValidGitOid } from '../forgeDomain.ts';

export const SHA1_ZERO_OID = '0000000000000000000000000000000000000000';
export const SHA256_ZERO_OID = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Validates storage key format and ensures no traversal or illegal characters.
 */
export function validateStorageKey(storageKey: unknown): { valid: boolean; error?: string } {
  if (typeof storageKey !== 'string' || !storageKey.trim()) {
    return { valid: false, error: 'Storage key must be a non-empty string.' };
  }

  const trimmed = storageKey.trim();

  // No null bytes
  if (trimmed.includes('\0')) {
    return { valid: false, error: 'Storage key cannot contain null bytes.' };
  }

  // No absolute paths or Windows drive letters
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return { valid: false, error: 'Storage key must be a relative path.' };
  }

  // No traversal sequences
  if (trimmed.includes('..') || trimmed.includes('//') || trimmed.includes('\\\\') || trimmed.includes('/./')) {
    return { valid: false, error: 'Storage key cannot contain path traversal sequences (.., //, /./).' };
  }

  // Forbidden filesystem characters
  if (/[<>:"|?*]/.test(trimmed)) {
    return { valid: false, error: 'Storage key contains illegal filesystem characters.' };
  }

  // Safe pattern: e.g. repositories/repo_123, repo_123, users/nate/repo
  if (!/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/.test(trimmed)) {
    return { valid: false, error: 'Storage key contains invalid characters.' };
  }

  if (trimmed.endsWith('.lock') || trimmed.endsWith('/.') || trimmed.endsWith('.')) {
    return { valid: false, error: 'Storage key cannot end with .lock or a period.' };
  }

  return { valid: true };
}

/**
 * Resolves repository path strictly beneath reposRoot, validating against symlink escapes.
 * Rejects any symlink component in the path and the target itself.
 */
export function resolveRepoPath(reposRoot: string, storageKey: string): StorageValidationResult {
  if (!reposRoot || typeof reposRoot !== 'string' || !reposRoot.trim()) {
    return { valid: false, error: 'Configured reposRoot is required.' };
  }

  const keyVal = validateStorageKey(storageKey);
  if (!keyVal.valid) {
    return { valid: false, error: keyVal.error };
  }

  const cleanRoot = path.resolve(reposRoot.trim());
  const targetPath = path.resolve(cleanRoot, storageKey.trim());

  // Check 1: Target path must start with root + separator
  if (!targetPath.startsWith(cleanRoot + path.sep) && targetPath !== cleanRoot) {
    return { valid: false, error: 'Storage key attempts path traversal outside configured reposRoot.' };
  }

  // Check 2: Relative path must not start with ..
  const rel = path.relative(cleanRoot, targetPath);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    return { valid: false, error: 'Storage path must be a subdirectory beneath reposRoot.' };
  }

  // Check 3: Symlink protection across existing path components and target itself
  try {
    let current = cleanRoot;
    if (fs.existsSync(cleanRoot)) {
      const realRoot = fs.realpathSync(cleanRoot);
      const parts = rel.split(path.sep);

      for (const part of parts) {
        current = path.join(current, part);
        try {
          const lstat = fs.lstatSync(current);
          if (lstat.isSymbolicLink()) {
            return { valid: false, error: `Symbolic link rejected in repository storage path at '${part}'.` };
          }
          const realCurrent = fs.realpathSync(current);
          if (!realCurrent.startsWith(realRoot + path.sep) && realCurrent !== realRoot) {
            return { valid: false, error: 'Symbolic link points outside configured reposRoot (traversal blocked).' };
          }
        } catch (lstatErr: any) {
          if (lstatErr.code !== 'ENOENT') {
            return { valid: false, error: `Filesystem inspection error: ${lstatErr.message}` };
          }
        }
      }
    }
  } catch (err: any) {
    return { valid: false, error: `Filesystem resolution error: ${err.message}` };
  }

  return { valid: true, resolvedPath: targetPath };
}

/**
 * Probes system Git binary and checks support for object formats.
 */
export function checkGitCapabilities(): GitCapabilities {
  try {
    const out = execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 3000 }).trim();
    const versionMatch = out.match(/git version (\d+\.\d+\.\d+)/);
    const gitVersion = versionMatch ? versionMatch[1] : out;

    // Test sha256 support
    let supportsSha256 = false;
    try {
      const tempDir = path.join(process.cwd(), `.git-cap-check-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
      try {
        execFileSync('git', ['init', '--bare', '--object-format=sha256', tempDir], { stdio: 'pipe' });
        supportsSha256 = true;
      } finally {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }
    } catch {
      supportsSha256 = false;
    }

    return {
      gitAvailable: true,
      gitVersion,
      supportsSha1: true,
      supportsSha256
    };
  } catch (err: any) {
    return {
      gitAvailable: false,
      supportsSha1: false,
      supportsSha256: false,
      error: `Git binary check failed: ${err.message}`
    };
  }
}

export function getRepoObjectFormat(repoPath: string): RepositoryObjectFormat {
  try {
    const extFmt = execFileSync('git', ['config', '--get', 'extensions.objectFormat'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (extFmt === 'sha256') return 'sha256';
  } catch {}

  try {
    const coreFmt = execFileSync('git', ['config', '--get', 'core.objectFormat'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (coreFmt === 'sha256') return 'sha256';
  } catch {}

  return 'sha1';
}

/**
 * Safely provisions a bare git repository beneath configured reposRoot.
 */
export function initBareRepo(reposRoot: string, params: ProvisionRepoParams): ProvisionRepoResult {
  const { storageKey, objectFormat = 'sha1', defaultRef = 'refs/heads/main' } = params;

  const pathRes = resolveRepoPath(reposRoot, storageKey);
  if (!pathRes.valid || !pathRes.resolvedPath) {
    return {
      success: false,
      storageKey,
      repoPath: '',
      objectFormat,
      defaultRef,
      error: pathRes.error
    };
  }

  const repoPath = pathRes.resolvedPath;

  // Check if directory already exists
  if (fs.existsSync(repoPath)) {
    // Check if it's already a valid bare git repo
    try {
      const isBare = execFileSync('git', ['rev-parse', '--is-bare-repository'], {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      if (isBare === 'true') {
        const existingFormat = getRepoObjectFormat(repoPath);

        if (existingFormat !== objectFormat) {
          return {
            success: false,
            storageKey,
            repoPath,
            objectFormat,
            defaultRef,
            error: `Repository already exists with conflicting object format '${existingFormat}' (requested '${objectFormat}').`
          };
        }

        return {
          success: true,
          storageKey,
          repoPath,
          objectFormat: existingFormat,
          defaultRef,
          idempotent: true
        };
      }
    } catch {
      return {
        success: false,
        storageKey,
        repoPath,
        objectFormat,
        defaultRef,
        error: `Target path '${repoPath}' exists but is not a valid bare Git repository.`
      };
    }
  }

  // Create parent directories
  fs.mkdirSync(path.dirname(repoPath), { recursive: true });

  // Execute git init --bare --object-format=<format>
  try {
    const initArgs = ['init', '--bare', `--object-format=${objectFormat}`, repoPath];
    execFileSync('git', initArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    // Set default ref symbolic-ref HEAD
    if (defaultRef && defaultRef.startsWith('refs/')) {
      try {
        execFileSync('git', ['symbolic-ref', 'HEAD', defaultRef], { cwd: repoPath, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {}
    }

    return {
      success: true,
      storageKey,
      repoPath,
      objectFormat,
      defaultRef,
      idempotent: false
    };
  } catch (err: any) {
    return {
      success: false,
      storageKey,
      repoPath,
      objectFormat,
      defaultRef,
      error: `Failed to initialize bare repository: ${err.message}`
    };
  }
}

/**
 * Resolves a Git reference or OID to a canonical hexadecimal commit OID in a bare repository.
 * Rejects any option-like inputs (starting with '-'), non-string values, or references that
 * do not resolve to an actual commit object in the repository.
 */
export function resolveCanonicalCommitOid(repoPath: string, refOrOid: string): string | null {
  if (typeof refOrOid !== 'string' || !refOrOid.trim() || refOrOid.trim().startsWith('-')) {
    return null;
  }
  const cleanRef = refOrOid.trim();
  try {
    const out = execFileSync('git', ['rev-parse', '--verify', '-q', '--end-of-options', `${cleanRef}^{commit}`], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return isValidGitOid(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * Reads authoritative ref from bare git repository using git rev-parse / show-ref.
 */
export function readAuthoritativeRef(reposRoot: string, storageKey: string, refName: string): string | null {
  const pathRes = resolveRepoPath(reposRoot, storageKey);
  if (!pathRes.valid || !pathRes.resolvedPath || !fs.existsSync(pathRes.resolvedPath)) {
    return null;
  }

  if (typeof refName !== 'string' || !refName.trim() || refName.trim().startsWith('-')) {
    return null;
  }

  const cleanRef = refName.trim();
  const repoPath = pathRes.resolvedPath;
  try {
    const out = execFileSync('git', ['rev-parse', '--verify', '-q', '--end-of-options', `${cleanRef}^{commit}`], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    return isValidGitOid(out) ? out : null;
  } catch {
    // If ref^{commit} fails, try direct ref (for tags/notes)
    try {
      const outDirect = execFileSync('git', ['rev-parse', '--verify', '-q', '--end-of-options', cleanRef], {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return isValidGitOid(outDirect) ? outDirect : null;
    } catch {
      return null;
    }
  }
}

/**
 * Exports one exact commit from the authoritative bare repository as a tar archive.
 * The caller receives only the committed tree: no Git metadata, working tree state,
 * untracked files, or mutable ref lookup is involved.
 */
export function archiveAuthoritativeCommit(reposRoot: string, storageKey: string, commitOid: string): Buffer {
  const pathRes = resolveRepoPath(reposRoot, storageKey);
  if (!pathRes.valid || !pathRes.resolvedPath || !fs.existsSync(pathRes.resolvedPath)) {
    throw new Error(pathRes.error || 'Authoritative repository does not exist.');
  }
  if (!isValidGitOid(commitOid) || commitOid.startsWith('-')) throw new Error('commitOid must be a valid Git object ID.');
  if (!hasGitObject(reposRoot, storageKey, commitOid)) throw new Error('Requested commit does not exist in the authoritative repository.');
  try {
    return execFileSync('git', ['archive', '--format=tar', `${commitOid}^{commit}`, '--'], {
      cwd: pathRes.resolvedPath,
      encoding: 'buffer',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30_000
    });
  } catch (error: any) {
    throw new Error(`Unable to archive authoritative commit: ${String(error?.stderr || error?.message || error).trim()}`);
  }
}

/**
 * Lists all authoritative refs in a bare repository.
 */
export function listAuthoritativeRefs(
  reposRoot: string,
  storageKey: string,
  prefix?: string
): Array<{ refName: string; commitOid: string }> {
  const pathRes = resolveRepoPath(reposRoot, storageKey);
  if (!pathRes.valid || !pathRes.resolvedPath || !fs.existsSync(pathRes.resolvedPath)) {
    return [];
  }

  if (prefix !== undefined && (typeof prefix !== 'string' || prefix.startsWith('-'))) {
    return [];
  }

  const repoPath = pathRes.resolvedPath;
  try {
    const args = ['for-each-ref', '--format=%(refname) %(objectname)', '--'];
    if (prefix) args.push(prefix);

    const out = execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (!out) return [];

    const lines = out.split('\n');
    const results: Array<{ refName: string; commitOid: string }> = [];
    for (const line of lines) {
      const [refName, commitOid] = line.trim().split(' ');
      if (refName && commitOid && isValidGitOid(commitOid)) {
        results.push({ refName, commitOid });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Checks if a Git object exists in the repository object store.
 */
export function hasGitObject(reposRoot: string, storageKey: string, oid: string): boolean {
  const pathRes = resolveRepoPath(reposRoot, storageKey);
  if (!pathRes.valid || !pathRes.resolvedPath || !fs.existsSync(pathRes.resolvedPath)) {
    return false;
  }

  if (!isValidGitOid(oid) || oid.startsWith('-')) return false;

  const repoPath = pathRes.resolvedPath;
  try {
    const res = spawnSync('git', ['cat-file', '-e', '--', oid], { cwd: repoPath, stdio: 'pipe' });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Executes an authoritative ref compare-and-swap mutation using `git update-ref`.
 */
export function updateAuthoritativeRefCas(
  reposRoot: string,
  params: AuthoritativeRefCasParams
): AuthoritativeRefCasResult {
  const { storageKey, refName, newOid, expectedOldOid, operation = 'update' } = params;

  const pathRes = resolveRepoPath(reposRoot, storageKey);
  if (!pathRes.valid || !pathRes.resolvedPath) {
    return {
      success: false,
      refName,
      oldOid: null,
      newOid,
      currentOid: null,
      error: pathRes.error
    };
  }

  const repoPath = pathRes.resolvedPath;
  if (!fs.existsSync(repoPath)) {
    return {
      success: false,
      refName,
      oldOid: null,
      newOid,
      currentOid: null,
      error: `Repository directory '${repoPath}' does not exist on disk.`
    };
  }

  const refVal = validateGitRef(refName);
  if (!refVal.valid) {
    return {
      success: false,
      refName,
      oldOid: null,
      newOid,
      currentOid: null,
      error: refVal.error
    };
  }

  // Read current authoritative ref from disk
  const currentOid = readAuthoritativeRef(reposRoot, storageKey, refName);

  // Check object format of the repository
  const objectFormat = getRepoObjectFormat(repoPath);

  const zeroOid = objectFormat === 'sha256' ? SHA256_ZERO_OID : SHA1_ZERO_OID;

  // 1. OPERATION: CREATE
  if (operation === 'create' || (expectedOldOid === null && currentOid === null && newOid !== null)) {
    if (!newOid) {
      return { success: false, refName, oldOid: null, newOid: null, currentOid, error: 'newOid is required for create operation.' };
    }
    const newOidVal = validateGitOid(newOid, 'newOid');
    if (!newOidVal.valid) {
      return { success: false, refName, oldOid: null, newOid, currentOid, error: newOidVal.error };
    }

    // Idempotency check: if ref is already at newOid
    if (currentOid === newOid) {
      return {
        success: true,
        refName,
        oldOid: null,
        newOid,
        currentOid,
        idempotent: true
      };
    }

    // Verify target commit object exists
    if (!hasGitObject(reposRoot, storageKey, newOid)) {
      return {
        success: false,
        refName,
        oldOid: null,
        newOid,
        currentOid,
        error: `Git object '${newOid}' does not exist in repository.`
      };
    }

    // Execute atomic git update-ref -- <ref> <newOid> <zeroOid>
    const res = spawnSync('git', ['update-ref', '--', refName, newOid, zeroOid], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (res.status !== 0) {
      const refreshedOid = readAuthoritativeRef(reposRoot, storageKey, refName);
      return {
        success: false,
        refName,
        oldOid: null,
        newOid,
        currentOid: refreshedOid,
        stale: true,
        error: `CAS creation failed: ref '${refName}' already exists at ${refreshedOid || 'unknown OID'}. (${res.stderr.trim()})`
      };
    }

    return {
      success: true,
      refName,
      oldOid: null,
      newOid,
      currentOid: newOid
    };
  }

  // 2. OPERATION: UPDATE
  if (operation === 'update') {
    if (!newOid || !expectedOldOid) {
      return { success: false, refName, oldOid: expectedOldOid, newOid, currentOid, error: 'newOid and expectedOldOid are required for update.' };
    }

    // Idempotency check: if ref is already at newOid
    if (currentOid === newOid) {
      return {
        success: true,
        refName,
        oldOid: expectedOldOid,
        newOid,
        currentOid,
        idempotent: true
      };
    }

    // Authoritative CAS guard check before Git execution
    if (currentOid !== expectedOldOid) {
      return {
        success: false,
        refName,
        oldOid: expectedOldOid,
        newOid,
        currentOid,
        stale: true,
        error: `CAS check failed: expected old OID ${expectedOldOid}, but current Git ref is ${currentOid ?? 'null'}.`
      };
    }

    // Verify target commit object exists
    if (!hasGitObject(reposRoot, storageKey, newOid)) {
      return {
        success: false,
        refName,
        oldOid: expectedOldOid,
        newOid,
        currentOid,
        error: `Git object '${newOid}' does not exist in repository.`
      };
    }

    // Execute atomic git update-ref -- <ref> <newOid> <expectedOldOid>
    const res = spawnSync('git', ['update-ref', '--', refName, newOid, expectedOldOid], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (res.status !== 0) {
      const refreshedOid = readAuthoritativeRef(reposRoot, storageKey, refName);
      return {
        success: false,
        refName,
        oldOid: expectedOldOid,
        newOid,
        currentOid: refreshedOid,
        stale: true,
        error: `CAS update failed: remote ref moved concurrently. (${res.stderr.trim()})`
      };
    }

    return {
      success: true,
      refName,
      oldOid: expectedOldOid,
      newOid,
      currentOid: newOid
    };
  }

  // 3. OPERATION: DELETE
  if (operation === 'delete') {
    if (!expectedOldOid) {
      return { success: false, refName, oldOid: null, newOid: null, currentOid, error: 'expectedOldOid is required for delete.' };
    }

    if (currentOid === null) {
      return {
        success: true,
        refName,
        oldOid: expectedOldOid,
        newOid: null,
        currentOid: null,
        idempotent: true
      };
    }

    if (currentOid !== expectedOldOid) {
      return {
        success: false,
        refName,
        oldOid: expectedOldOid,
        newOid: null,
        currentOid,
        stale: true,
        error: `CAS delete failed: expected old OID ${expectedOldOid}, but current Git ref is ${currentOid}.`
      };
    }

    const res = spawnSync('git', ['update-ref', '-d', '--', refName, expectedOldOid], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (res.status !== 0) {
      const refreshedOid = readAuthoritativeRef(reposRoot, storageKey, refName);
      return {
        success: false,
        refName,
        oldOid: expectedOldOid,
        newOid: null,
        currentOid: refreshedOid,
        stale: true,
        error: `CAS delete failed: remote ref moved concurrently. (${res.stderr.trim()})`
      };
    }

    return {
      success: true,
      refName,
      oldOid: expectedOldOid,
      newOid: null,
      currentOid: null
    };
  }

  return {
    success: false,
    refName,
    oldOid: expectedOldOid ?? null,
    newOid,
    currentOid,
    error: `Unsupported operation: ${operation}`
  };
}

/**
 * Provisions a fork repository by cloning/fetching objects from parent repository on disk.
 */
export function cloneOrFetchForFork(reposRoot: string, params: ForkProvisionParams): ForkProvisionResult {
  const {
    childRepositoryId,
    childStorageKey,
    parentRepositoryId: _parentRepositoryId,
    parentStorageKey,
    parentRefName,
    parentCommitOid,
    childInitialCommitOid,
    objectFormat = 'sha1',
    defaultRef = parentRefName || 'refs/heads/main'
  } = params;

  // Validate parent and child storage keys
  const parentPathRes = resolveRepoPath(reposRoot, parentStorageKey);
  if (!parentPathRes.valid || !parentPathRes.resolvedPath) {
    return {
      success: false,
      childRepositoryId,
      childStorageKey,
      childRepoPath: '',
      parentCommitOid,
      childInitialCommitOid,
      error: `Parent storage key invalid: ${parentPathRes.error}`
    };
  }

  const childPathRes = resolveRepoPath(reposRoot, childStorageKey);
  if (!childPathRes.valid || !childPathRes.resolvedPath) {
    return {
      success: false,
      childRepositoryId,
      childStorageKey,
      childRepoPath: '',
      parentCommitOid,
      childInitialCommitOid,
      error: `Child storage key invalid: ${childPathRes.error}`
    };
  }

  const parentRepoPath = parentPathRes.resolvedPath;
  const childRepoPath = childPathRes.resolvedPath;

  if (!fs.existsSync(parentRepoPath)) {
    return {
      success: false,
      childRepositoryId,
      childStorageKey,
      childRepoPath,
      parentCommitOid,
      childInitialCommitOid,
      error: `Parent repository directory '${parentRepoPath}' does not exist on disk.`
    };
  }

  // Verify parent has commit object
  if (!hasGitObject(reposRoot, parentStorageKey, parentCommitOid)) {
    return {
      success: false,
      childRepositoryId,
      childStorageKey,
      childRepoPath,
      parentCommitOid,
      childInitialCommitOid,
      error: `Parent repository does not contain commit object '${parentCommitOid}'.`
    };
  }

  // If child repository already exists, check if already provisioned
  if (fs.existsSync(childRepoPath)) {
    try {
      const isBare = execFileSync('git', ['rev-parse', '--is-bare-repository'], {
        cwd: childRepoPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      if (isBare === 'true') {
        const childRefOid = readAuthoritativeRef(reposRoot, childStorageKey, defaultRef);
        if (childRefOid === childInitialCommitOid) {
          return {
            success: true,
            childRepositoryId,
            childStorageKey,
            childRepoPath,
            parentCommitOid,
            childInitialCommitOid,
            idempotent: true
          };
        }
      }
    } catch {}
  }

  // Provision child bare repo
  const initRes = initBareRepo(reposRoot, {
    storageKey: childStorageKey,
    objectFormat,
    defaultRef
  });

  if (!initRes.success) {
    return {
      success: false,
      childRepositoryId,
      childStorageKey,
      childRepoPath,
      parentCommitOid,
      childInitialCommitOid,
      error: `Failed to initialize child bare repo: ${initRes.error}`
    };
  }

  // Fetch objects from parent repo into child repo
  try {
    execFileSync('git', ['fetch', parentRepoPath, `+refs/*:refs/*`], {
      cwd: childRepoPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Set child default ref to childInitialCommitOid
    const casRes = updateAuthoritativeRefCas(reposRoot, {
      storageKey: childStorageKey,
      refName: defaultRef,
      newOid: childInitialCommitOid,
      expectedOldOid: null,
      operation: 'create'
    });

    if (!casRes.success && !casRes.idempotent) {
      return {
        success: false,
        childRepositoryId,
        childStorageKey,
        childRepoPath,
        parentCommitOid,
        childInitialCommitOid,
        error: `Failed to seed child initial ref: ${casRes.error}`
      };
    }

    // Set HEAD symbolic-ref
    try {
      execFileSync('git', ['symbolic-ref', 'HEAD', defaultRef], {
        cwd: childRepoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch {}

    return {
      success: true,
      childRepositoryId,
      childStorageKey,
      childRepoPath,
      parentCommitOid,
      childInitialCommitOid,
      idempotent: false
    };
  } catch (err: any) {
    return {
      success: false,
      childRepositoryId,
      childStorageKey,
      childRepoPath,
      parentCommitOid,
      childInitialCommitOid,
      error: `Failed to transfer objects for fork: ${err.message}`
    };
  }
}

/**
 * Parses diff hunks from a single file's patch text.
 */
export function parseDiffHunks(patch: string): DiffHunk[] {
  if (!patch || !patch.trim()) return [];

  const lines = patch.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let curOld = 0;
  let curNew = 0;

  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
      if (match) {
        const oldStart = parseInt(match[1], 10);
        const oldLines = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newLines = match[4] !== undefined ? parseInt(match[4], 10) : 1;
        curOld = oldStart;
        curNew = newStart;

        currentHunk = {
          oldStart,
          oldLines,
          newStart,
          newLines,
          header: line,
          lines: [{
            type: 'header',
            oldLineNumber: null,
            newLineNumber: null,
            content: line
          }]
        };
        hunks.push(currentHunk);
      }
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'add',
        oldLineNumber: null,
        newLineNumber: curNew++,
        content: line.substring(1)
      });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'delete',
        oldLineNumber: curOld++,
        newLineNumber: null,
        content: line.substring(1)
      });
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        oldLineNumber: curOld++,
        newLineNumber: curNew++,
        content: line.substring(1)
      });
    } else if (line.startsWith('\\')) {
      currentHunk.lines.push({
        type: 'context',
        oldLineNumber: null,
        newLineNumber: null,
        content: line
      });
    } else if (line === '') {
      currentHunk.lines.push({
        type: 'context',
        oldLineNumber: curOld++,
        newLineNumber: curNew++,
        content: ''
      });
    }
  }

  return hunks;
}

/**
 * Parses raw git unified diff output into structured per-file diffs.
 */
export function parseUnifiedDiff(
  rawDiff: string,
  numstatMap?: Map<string, { additions: number; deletions: number; isBinary: boolean }>
): GitFileDiff[] {
  if (!rawDiff || !rawDiff.trim()) return [];

  const fileChunks = rawDiff.split(/^diff --git /m).filter(chunk => chunk.trim());
  const results: GitFileDiff[] = [];

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');
    const headerLine = lines[0];
    const headerMatch = headerLine.match(/^a\/(.+?)\s+b\/(.+)$/);
    let oldPath = headerMatch ? headerMatch[1] : '';
    let newPath = headerMatch ? headerMatch[2] : '';

    let status: 'modified' | 'added' | 'deleted' | 'renamed' = 'modified';
    let isBinary = false;

    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const line = lines[i];
      if (line.startsWith('new file mode')) {
        status = 'added';
      } else if (line.startsWith('deleted file mode')) {
        status = 'deleted';
      } else if (line.startsWith('similarity index') || line.startsWith('rename from')) {
        status = 'renamed';
      } else if (line.startsWith('rename from ')) {
        oldPath = line.substring('rename from '.length).trim();
      } else if (line.startsWith('rename to ')) {
        newPath = line.substring('rename to '.length).trim();
      } else if (line.startsWith('Binary files ') || line.includes('differ')) {
        isBinary = true;
      }
    }

    if (!oldPath && !newPath) {
      const match = headerLine.split(' ');
      oldPath = match[0]?.replace(/^a\//, '') || 'unknown';
      newPath = match[1]?.replace(/^b\//, '') || oldPath;
    }

    const pathKey = newPath || oldPath;
    const stat = numstatMap?.get(pathKey) || numstatMap?.get(oldPath);

    const patch = 'diff --git ' + chunk;
    const hunks = parseDiffHunks(chunk);

    let additions = 0;
    let deletions = 0;

    if (stat) {
      additions = stat.additions;
      deletions = stat.deletions;
      if (stat.isBinary) isBinary = true;
    } else {
      for (const hunk of hunks) {
        for (const dl of hunk.lines) {
          if (dl.type === 'add') additions++;
          else if (dl.type === 'delete') deletions++;
        }
      }
    }

    results.push({
      oldPath: oldPath || newPath,
      newPath: newPath || oldPath,
      status,
      additions,
      deletions,
      isBinary,
      patch,
      hunks
    });
  }

  return results;
}

/**
 * Computes the real Git unified diff, commit list, ahead/behind counts, and
 * mergeability/divergence status between base and head in an on-disk bare repository.
 */
export function getProposalDiff(
  reposRoot: string,
  storageKey: string,
  baseRefOrOid: string,
  headRefOrOid: string,
  options?: { maxBuffer?: number }
): ProposalDiffResult {
  const emptyDiff = (error?: string): ProposalDiffResult => ({
    success: false,
    baseOid: typeof baseRefOrOid === 'string' ? baseRefOrOid : '',
    headOid: typeof headRefOrOid === 'string' ? headRefOrOid : '',
    mergeBaseOid: null,
    isFastForward: false,
    diverged: false,
    aheadCount: 0,
    behindCount: 0,
    commits: [],
    files: [],
    totalAdditions: 0,
    totalDeletions: 0,
    filesChanged: 0,
    unifiedDiff: '',
    error
  });

  if (typeof baseRefOrOid !== 'string' || !baseRefOrOid.trim() || baseRefOrOid.trim().startsWith('-')) {
    return emptyDiff('Base commit reference is invalid or contains prohibited option flags.');
  }

  if (typeof headRefOrOid !== 'string' || !headRefOrOid.trim() || headRefOrOid.trim().startsWith('-')) {
    return emptyDiff('Head commit reference is invalid or contains prohibited option flags.');
  }

  const pathRes = resolveRepoPath(reposRoot, storageKey);
  if (!pathRes.valid || !pathRes.resolvedPath || !fs.existsSync(pathRes.resolvedPath)) {
    return emptyDiff(pathRes.error || `Repository directory '${storageKey}' does not exist on disk.`);
  }

  const repoPath = pathRes.resolvedPath;

  // Resolve base to canonical commit OID first and validate existence
  const canonicalBaseOid = resolveCanonicalCommitOid(repoPath, baseRefOrOid);
  if (!canonicalBaseOid || !isValidGitOid(canonicalBaseOid)) {
    return emptyDiff(`Base commit '${baseRefOrOid}' does not exist or does not resolve to a commit in repository.`);
  }

  // Resolve head to canonical commit OID first and validate existence
  const canonicalHeadOid = resolveCanonicalCommitOid(repoPath, headRefOrOid);
  if (!canonicalHeadOid || !isValidGitOid(canonicalHeadOid)) {
    return emptyDiff(`Head commit '${headRefOrOid}' does not exist or does not resolve to a commit in repository.`);
  }

  const baseOid = canonicalBaseOid;
  const headOid = canonicalHeadOid;

  // If base and head are identical
  if (baseOid === headOid) {
    return {
      success: true,
      baseOid,
      headOid,
      mergeBaseOid: baseOid,
      isFastForward: true,
      diverged: false,
      aheadCount: 0,
      behindCount: 0,
      commits: [],
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      filesChanged: 0,
      unifiedDiff: ''
    };
  }

  // 1. Find merge-base with canonical OIDs and -- argument terminator
  let mergeBaseOid: string | null = null;
  try {
    const mbOut = execFileSync('git', ['merge-base', '--', baseOid, headOid], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (isValidGitOid(mbOut)) mergeBaseOid = mbOut;
  } catch {}

  // 2. Check if base is an ancestor of head (clean fast-forward)
  let isFastForward = false;
  try {
    const res = spawnSync('git', ['merge-base', '--is-ancestor', baseOid, headOid], {
      cwd: repoPath,
      stdio: 'pipe'
    });
    isFastForward = res.status === 0;
  } catch {}

  const diverged = !isFastForward;

  // 3. Ahead / Behind counts with canonical OIDs and -- argument terminator
  let aheadCount = 0;
  let behindCount = 0;
  try {
    const aheadOut = execFileSync('git', ['rev-list', '--count', `${baseOid}..${headOid}`, '--'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    aheadCount = parseInt(aheadOut, 10) || 0;
  } catch {}

  try {
    const behindOut = execFileSync('git', ['rev-list', '--count', `${headOid}..${baseOid}`, '--'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    behindCount = parseInt(behindOut, 10) || 0;
  } catch {}

  // 4. Commit list: git log base..head with canonical OIDs and -- argument terminator
  const commits: GitCommitInfo[] = [];
  try {
    const logOut = execFileSync('git', [
      'log',
      '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e',
      `${baseOid}..${headOid}`,
      '--'
    ], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (logOut) {
      const records = logOut.split('\x1e').filter(r => r.trim());
      for (const record of records) {
        const [sha, shortSha, authorName, authorEmail, authorDate, summary, body] = record.split('\x1f');
        if (sha && isValidGitOid(sha.trim())) {
          commits.push({
            sha: sha.trim(),
            shortSha: shortSha?.trim() || sha.trim().slice(0, 7),
            authorName: authorName?.trim() || 'Unknown',
            authorEmail: authorEmail?.trim() || '',
            authorDate: authorDate?.trim() || '',
            summary: summary?.trim() || '',
            message: body ? `${summary?.trim() || ''}\n\n${body.trim()}` : (summary?.trim() || '')
          });
        }
      }
    }
  } catch {}

  // 5. Unified diff (three-dot diff relative to merge base, or direct diff)
  let unifiedDiff = '';
  const diffTarget = mergeBaseOid ? `${mergeBaseOid}..${headOid}` : `${baseOid}..${headOid}`;
  const maxDiffBuffer = options?.maxBuffer ?? (20 * 1024 * 1024);
  try {
    unifiedDiff = execFileSync('git', ['diff', '-u', diffTarget, '--'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: maxDiffBuffer
    });
  } catch (err1: any) {
    try {
      unifiedDiff = execFileSync('git', ['diff', '-u', `${baseOid}...${headOid}`, '--'], {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: maxDiffBuffer
      });
    } catch (err2: any) {
      const err = err2 || err1;
      const isBufferExceeded =
        err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
        err?.code === 'ENOBUFS' ||
        err1?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
        err1?.code === 'ENOBUFS' ||
        String(err?.message || '').includes('maxBuffer') ||
        String(err?.message || '').includes('ENOBUFS') ||
        String(err1?.message || '').includes('maxBuffer') ||
        String(err1?.message || '').includes('ENOBUFS');

      const errorMessage = isBufferExceeded
        ? 'Diff generation failed: diff output exceeded maximum buffer limit.'
        : `Diff generation failed: ${err?.message || err1?.message || 'Git diff command failed.'}`;

      return emptyDiff(errorMessage);
    }
  }

  // 6. Numstat for file counts and line additions/deletions
  const numstatMap = new Map<string, { additions: number; deletions: number; isBinary: boolean }>();
  try {
    const numstatOut = execFileSync('git', ['diff', '--numstat', diffTarget, '--'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: maxDiffBuffer
    }).trim();
    if (numstatOut) {
      for (const line of numstatOut.split('\n')) {
        const parts = line.trim().split(/\t+/);
        if (parts.length >= 3) {
          const isBin = parts[0] === '-' && parts[1] === '-';
          const adds = isBin ? 0 : parseInt(parts[0], 10) || 0;
          const dels = isBin ? 0 : parseInt(parts[1], 10) || 0;
          const fPath = parts.slice(2).join('\t');
          numstatMap.set(fPath, { additions: adds, deletions: dels, isBinary: isBin });
        }
      }
    }
  } catch {}

  // 7. Parse unified diff into per-file chunks
  const files = parseUnifiedDiff(unifiedDiff, numstatMap);
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  return {
    success: true,
    baseOid,
    headOid,
    mergeBaseOid,
    isFastForward,
    diverged,
    aheadCount: aheadCount || commits.length,
    behindCount,
    commits,
    files,
    totalAdditions,
    totalDeletions,
    filesChanged: files.length,
    unifiedDiff
  };
}

