import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  handleInit,
  handleClone,
  handleFork,
  handlePush
} from '../bin/slop.ts';

describe('Local Bare Repository Git Integration', () => {
  let testRootDir: string;
  let bareRepoPath: string;
  let workRepoPath: string;
  const originalCwd = process.cwd();

  beforeAll(() => {
    testRootDir = mkdtempSync(join(tmpdir(), 'slop-git-integ-'));
    bareRepoPath = join(testRootDir, 'remote-forge.git');
    workRepoPath = join(testRootDir, 'local-work-app');

    // 1. Initialize local bare repository (simulates local forge repository)
    mkdirSync(bareRepoPath, { recursive: true });
    execSync('git init --bare', { cwd: bareRepoPath, stdio: 'pipe' });
    execSync('git symbolic-ref HEAD refs/heads/main', { cwd: bareRepoPath, stdio: 'pipe' });

    // 2. Initialize local working repository
    mkdirSync(workRepoPath, { recursive: true });
    execSync('git init -b main', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git config user.name "Nate McGuire"', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git config user.email "nate@nates-software.com"', { cwd: workRepoPath, stdio: 'pipe' });

    // 3. Create initial commit
    writeFileSync(join(workRepoPath, 'README.md'), '# Shareware Retro Arcade\nReal Git mechanics verified.\n');
    writeFileSync(join(workRepoPath, 'package.json'), JSON.stringify({ name: 'retro-arcade', version: '1.0.0' }, null, 2));
    execSync('git add -A', { cwd: workRepoPath, stdio: 'pipe' });
    execSync('git commit -m "feat(init): seed initial retro arcade commit"', { cwd: workRepoPath, stdio: 'pipe' });

    // 4. Configure real local bare repo as remote "slop"
    execSync(`git remote add slop "file://${bareRepoPath}"`, { cwd: workRepoPath, stdio: 'pipe' });
  });

  afterAll(() => {
    process.chdir(originalCwd);
    if (existsSync(testRootDir)) {
      rmSync(testRootDir, { recursive: true, force: true });
    }
  });

  it('should push real commits to local bare repository and update remote refs with genuine SHA', () => {
    process.chdir(workRepoPath);

    const localShaBefore = execSync('git rev-parse HEAD', { cwd: workRepoPath, encoding: 'utf-8' }).trim();
    const pushRes = handlePush();

    expect(pushRes.success).toBe(true);
    expect(pushRes.command).toBe('push');
    expect(pushRes.data.pushedGit).toBe(true);
    expect(pushRes.data.casVerified).toBe(true);
    expect(pushRes.data.published).toBe(false);
    expect(pushRes.data.deployed).toBe(false);
    expect(pushRes.message).toBe('Git ref pushed and verified');
    expect(pushRes.data.sha).toBe(localShaBefore);
    expect(pushRes.data.remoteRef).toBe('refs/heads/main');

    // Verify on disk inside the bare repository that ref was actually updated
    const bareHeadSha = execSync('git rev-parse refs/heads/main', { cwd: bareRepoPath, encoding: 'utf-8' }).trim();
    const fullLocalSha = execSync('git rev-parse HEAD', { cwd: workRepoPath, encoding: 'utf-8' }).trim();
    expect(bareHeadSha).toBe(fullLocalSha);
  });

  it('should clone from local bare repository to a target directory with verified disk contents', () => {
    const cloneTargetDir = join(testRootDir, 'cloned-from-bare');

    const cloneRes = handleClone(`file://${bareRepoPath}`, cloneTargetDir);

    expect(cloneRes.success).toBe(true);
    expect(cloneRes.command).toBe('clone');
    expect(existsSync(cloneTargetDir)).toBe(true);
    expect(existsSync(join(cloneTargetDir, 'README.md'))).toBe(true);
    expect(readFileSync(join(cloneTargetDir, 'README.md'), 'utf-8')).toContain('Shareware Retro Arcade');

    // Verify cloned HEAD matches the bare repository HEAD
    const clonedHeadSha = execSync('git rev-parse HEAD', { cwd: cloneTargetDir, encoding: 'utf-8' }).trim();
    const bareHeadSha = execSync('git rev-parse refs/heads/main', { cwd: bareRepoPath, encoding: 'utf-8' }).trim();
    expect(clonedHeadSha).toBe(bareHeadSha);
  });

  it('should fail truthfully when attempting to clone into an already existing non-empty directory', () => {
    const existingDir = join(testRootDir, 'cloned-from-bare');
    const cloneRes = handleClone(`file://${bareRepoPath}`, existingDir);

    expect(cloneRes.success).toBe(false);
    expect(cloneRes.command).toBe('clone');
    expect(cloneRes.message).toContain('already exists');
    expect(cloneRes.data.error).toContain('already exists');
  });

  it('should fail truthfully when cloning from a non-existent git source', () => {
    const badSource = join(testRootDir, 'does-not-exist.git');
    const badTarget = join(testRootDir, 'bad-clone-target');

    const cloneRes = handleClone(badSource, badTarget);

    expect(cloneRes.success).toBe(false);
    expect(cloneRes.command).toBe('clone');
    expect(cloneRes.message).toContain('Failed to clone');
    expect(existsSync(badTarget)).toBe(false);
  });

  it('should fail truthfully when push operation fails due to unreachable remote', () => {
    const badRemoteRepoPath = join(testRootDir, 'bad-remote-work-app');
    mkdirSync(badRemoteRepoPath, { recursive: true });
    execSync('git init -b main', { cwd: badRemoteRepoPath, stdio: 'pipe' });
    execSync('git config user.name "Nate McGuire"', { cwd: badRemoteRepoPath, stdio: 'pipe' });
    execSync('git config user.email "nate@nates-software.com"', { cwd: badRemoteRepoPath, stdio: 'pipe' });
    writeFileSync(join(badRemoteRepoPath, 'README.md'), '# Bad Remote Test\n');
    execSync('git add -A && git commit -m "initial"', { cwd: badRemoteRepoPath, stdio: 'pipe' });

    // Set invalid unreachable remote URL with immediate failure
    execSync('git remote add slop "file:///tmp/nonexistent-bare-dir-48912.git"', { cwd: badRemoteRepoPath, stdio: 'pipe' });

    process.chdir(badRemoteRepoPath);
    const pushRes = handlePush();

    expect(pushRes.success).toBe(false);
    expect(pushRes.data.pushedGit).toBe(false);
    expect(pushRes.data.casVerified).toBe(false);
    expect(pushRes.message).toContain('Push failed');
    expect(pushRes.data.error).toBeDefined();
  });

  it('should fail truthfully when pushing from a non-git directory', () => {
    const nonGitDir = join(testRootDir, 'plain-folder');
    mkdirSync(nonGitDir, { recursive: true });

    process.chdir(nonGitDir);
    const pushRes = handlePush();

    expect(pushRes.success).toBe(false);
    expect(pushRes.data.pushedGit).toBe(false);
    expect(pushRes.data.casVerified).toBe(false);
    expect(pushRes.message.toLowerCase()).toContain('not a git repository');
  });

  it('should initialize slop project configuration and create slop.json on disk', () => {
    const initAppDir = join(testRootDir, 'fresh-app');
    mkdirSync(initAppDir, { recursive: true });
    writeFileSync(join(initAppDir, 'package.json'), JSON.stringify({ name: 'fresh-project', description: 'Fresh shareware' }));

    process.chdir(initAppDir);
    const res = handleInit(['fresh-project', '--title=Fresh Project', '--price=25']);

    expect(res.success).toBe(true);
    expect(res.command).toBe('init');
    expect(res.data.appId).toBe('fresh-project');
    expect(res.data.price).toBe(25);
    expect(existsSync(join(initAppDir, 'slop.json'))).toBe(true);

    const savedConfig = JSON.parse(readFileSync(join(initAppDir, 'slop.json'), 'utf-8'));
    expect(savedConfig.name).toBe('Fresh Project');
    expect(savedConfig.price).toBe(25);
  });

  it('should fork a project into an isolated real worktree with git repository initialized', () => {
    const forkRes = handleFork('retro-arcade');

    expect(forkRes.success).toBe(true);
    expect(forkRes.command).toBe('fork');
    expect(forkRes.data.isRealWorktree).toBe(true);
    expect(forkRes.data.port).toBeGreaterThanOrEqual(3001);
    expect(forkRes.data.port).toBeLessThanOrEqual(3010);

    const worktreePath = forkRes.data.worktreePath;
    expect(existsSync(worktreePath)).toBe(true);
    expect(existsSync(join(worktreePath, 'package.json'))).toBe(true);
    expect(existsSync(join(worktreePath, 'slop.json'))).toBe(true);
    expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
    expect(existsSync(join(worktreePath, '.git'))).toBe(true);

    // Clean up created worktree
    rmSync(worktreePath, { recursive: true, force: true });
  });
});
