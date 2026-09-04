import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import { handleFork } from '../bin/slop.ts';
import { coordinateFromForgeRepository, generateLocalAgentPlan } from '../src/lib/slopshopDomain';

import { hashSessionToken } from '../functions/api/_session';

const OID_ROOT = '1111111111111111111111111111111111111111';

const READY_GATEWAY_FETCH = async () => Response.json({
  ready: true,
  configured: true,
  active: true,
  checks: {
    git: { available: true },
    storage: { writable: true },
    controlPlane: { reachable: true },
    dispatcher: { running: true },
    transport: { configured: true, active: true, host: 'forge.example.test', port: 22 }
  }
});

describe('Wave 2 — Canonical Immutable Lineage (slop fork & SLOPSHOP)', () => {
  let ctx: TestD1Context;
  let testEnv: any;
  let testReposDir: string;
  const createdWorktrees: string[] = [];

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    testReposDir = join(tmpdir(), `slop-lineage-repos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(testReposDir, { recursive: true });

    testEnv = {
      DB: ctx.d1,
      GITSMITH_GATEWAY_URL: 'https://gateway.test',
      GITSMITH_GATEWAY_FETCH: READY_GATEWAY_FETCH,
      GITSMITH_GATEWAY_TOKEN: 'gw_test_secret_token_123',
      GITSMITH_REPOS_ROOT: testReposDir
    };

    await ctx.d1.prepare(`
      INSERT OR IGNORE INTO users (id, username, display_name, role)
      VALUES
        ('usr_nate', 'nate', 'Nate McGuire', 'user'),
        ('usr_sam', 'sam', 'Sam Maker', 'user'),
        ('usr_josh', 'josh', 'Josh Modder', 'user'),
        ('usr_alice', 'alice', 'Alice Coder', 'user')
    `).run();

    const expiresAt = Date.now() + 7 * 86400 * 1000;
    await ctx.d1.batch([
      ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
        VALUES (?, 'usr_nate', ?, CURRENT_TIMESTAMP)
      `).bind(await hashSessionToken('token_nate_secret'), expiresAt),
      ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
        VALUES (?, 'usr_sam', ?, CURRENT_TIMESTAMP)
      `).bind(await hashSessionToken('token_sam_secret'), expiresAt),
      ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
        VALUES (?, 'usr_josh', ?, CURRENT_TIMESTAMP)
      `).bind(await hashSessionToken('token_josh_secret'), expiresAt),
      ctx.d1.prepare(`
        INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
        VALUES (?, 'usr_alice', ?, CURRENT_TIMESTAMP)
      `).bind(await hashSessionToken('token_alice_secret'), expiresAt)
    ]);
  });

  afterEach(() => {
    for (const wt of createdWorktrees.splice(0)) {
      if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
    }
    if (existsSync(testReposDir)) rmSync(testReposDir, { recursive: true, force: true });
  });

  async function seedCanonicalRepository(options: {
    id: string;
    ownerUserId: string;
    slug: string;
    commitOid: string;
    refName?: string;
  }) {
    const { id, ownerUserId, slug, commitOid, refName = 'refs/heads/main' } = options;
    const storageKey = `repositories/${id}`;

    const barePath = join(testReposDir, 'repositories', id);
    mkdirSync(barePath, { recursive: true });
    execSync('git init --bare -b main', { cwd: barePath, stdio: 'pipe' });

    const tmpWork = join(testReposDir, `tmp-work-${id}`);
    mkdirSync(tmpWork, { recursive: true });
    execSync('git init -b main', { cwd: tmpWork, stdio: 'pipe' });
    execSync('git config user.name "Canonical Maker"', { cwd: tmpWork, stdio: 'pipe' });
    execSync('git config user.email "maker@nates-software.com"', { cwd: tmpWork, stdio: 'pipe' });
    execSync(`echo "# ${slug}" > README.md`, { cwd: tmpWork, stdio: 'pipe' });
    execSync('git add -A', { cwd: tmpWork, stdio: 'pipe' });
    execSync(`git commit -m "feat(init): seed canonical ${slug}"`, { cwd: tmpWork, stdio: 'pipe' });
    execSync(`git remote add origin "file://${barePath}"`, { cwd: tmpWork, stdio: 'pipe' });
    execSync('git push -u origin main', { cwd: tmpWork, stdio: 'pipe' });
    const realCommitOid = execSync('git rev-parse HEAD', { cwd: tmpWork, encoding: 'utf8' }).trim();
    rmSync(tmpWork, { recursive: true, force: true });

    await ctx.d1.batch([
      ctx.d1.prepare(`
        INSERT INTO repositories (
          id, app_id, owner_user_id, slug, visibility, object_format,
          default_ref, storage_key, status, created_at, updated_at
        ) VALUES (?, NULL, ?, ?, 'public', 'sha1', ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(id, ownerUserId, slug, refName, storageKey),
      ctx.d1.prepare(`
        INSERT INTO repository_members (repository_id, user_id, role, granted_by_user_id, created_at)
        VALUES (?, ?, 'owner', ?, CURRENT_TIMESTAMP)
      `).bind(id, ownerUserId, ownerUserId),
      ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      `).bind(id, refName, realCommitOid || commitOid, ownerUserId)
    ]);

    return { id, storageKey, realCommitOid: realCommitOid || commitOid, barePath };
  }

  it('Requirement 1 & 4: slop fork of canonical repo registers immutable parent->child lineage row in repository_forks', async () => {
    const rootRepo = await seedCanonicalRepository({
      id: 'repo_dronehunter_root',
      ownerUserId: 'usr_nate',
      slug: 'dronehunter',
      commitOid: OID_ROOT
    });

    const forkResult = await handleFork('nate/dronehunter', {
      env: testEnv,
      sessionToken: 'token_sam_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });

    expect(forkResult.success).toBe(true);
    expect(forkResult.data.isRealWorktree).toBe(true);
    const worktreePath = forkResult.data.worktreePath;
    createdWorktrees.push(worktreePath);

    const childRepo = await ctx.d1.prepare(`
      SELECT id, owner_user_id AS ownerUserId, slug, status
      FROM repositories WHERE owner_user_id = 'usr_sam' AND slug = 'dronehunter'
    `).first<any>();
    expect(childRepo).toBeDefined();
    expect(childRepo.ownerUserId).toBe('usr_sam');
    expect(childRepo.status).toBe('active');

    const lineageRow = await ctx.d1.prepare(`
      SELECT child_repository_id AS childRepositoryId,
             parent_repository_id AS parentRepositoryId,
             forked_by_user_id AS forkedByUserId,
             parent_ref_name AS parentRefName,
             parent_commit_oid AS parentCommitOid,
             child_initial_commit_oid AS childInitialCommitOid,
             lineage_root_repository_id AS lineageRootRepositoryId,
             depth, created_at AS createdAt
      FROM repository_forks
      WHERE child_repository_id = ?
    `).bind(childRepo.id).first<any>();

    expect(lineageRow).toBeDefined();
    expect(lineageRow.childRepositoryId).toBe(childRepo.id);
    expect(lineageRow.parentRepositoryId).toBe(rootRepo.id);
    expect(lineageRow.forkedByUserId).toBe('usr_sam');
    expect(lineageRow.lineageRootRepositoryId).toBe(rootRepo.id);
    expect(lineageRow.depth).toBe(1);
    expect(lineageRow.parentRefName).toBe('refs/heads/main');
    expect(lineageRow.parentCommitOid).toBe(rootRepo.realCommitOid);
    expect(lineageRow.childInitialCommitOid).toBe(rootRepo.realCommitOid);

    expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
    expect(existsSync(join(worktreePath, '.git'))).toBe(true);
  });

  it('Requirement 1: Multi-generation fork chaining preserves lineage root and increments depth', async () => {
    const rootRepo = await seedCanonicalRepository({
      id: 'repo_root_app',
      ownerUserId: 'usr_nate',
      slug: 'dronehunter',
      commitOid: OID_ROOT
    });

    const gen1Result = await handleFork('nate/dronehunter', {
      env: testEnv,
      sessionToken: 'token_sam_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });
    expect(gen1Result.success).toBe(true);
    createdWorktrees.push(gen1Result.data.worktreePath);

    const samRepo = await ctx.d1.prepare(`
      SELECT id FROM repositories WHERE owner_user_id = 'usr_sam' AND slug = 'dronehunter'
    `).first<any>();
    expect(samRepo).toBeDefined();

    const samBare = join(testReposDir, 'repositories', samRepo.id);
    if (!existsSync(samBare)) {
      mkdirSync(samBare, { recursive: true });
      execSync('git init --bare -b main', { cwd: samBare, stdio: 'pipe' });
      execSync(`git -C "${rootRepo.barePath}" push "file://${samBare}" refs/heads/main:refs/heads/main`, { stdio: 'pipe' });
    }

    const gen2Result = await handleFork('sam/dronehunter', {
      env: testEnv,
      sessionToken: 'token_josh_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });
    expect(gen2Result.success).toBe(true);
    createdWorktrees.push(gen2Result.data.worktreePath);

    const joshRepo = await ctx.d1.prepare(`
      SELECT id FROM repositories WHERE owner_user_id = 'usr_josh' AND slug = 'dronehunter'
    `).first<any>();
    expect(joshRepo).toBeDefined();

    const joshLineage = await ctx.d1.prepare(`
      SELECT child_repository_id AS childRepositoryId,
             parent_repository_id AS parentRepositoryId,
             forked_by_user_id AS forkedByUserId,
             lineage_root_repository_id AS lineageRootRepositoryId,
             depth
      FROM repository_forks
      WHERE child_repository_id = ?
    `).bind(joshRepo.id).first<any>();

    expect(joshLineage).toBeDefined();
    expect(joshLineage.parentRepositoryId).toBe(samRepo.id);
    expect(joshLineage.forkedByUserId).toBe('usr_josh');
    expect(joshLineage.lineageRootRepositoryId).toBe(rootRepo.id);
    expect(joshLineage.depth).toBe(2);

    const joshBare = join(testReposDir, 'repositories', joshRepo.id);
    if (!existsSync(joshBare)) {
      mkdirSync(joshBare, { recursive: true });
      execSync('git init --bare -b main', { cwd: joshBare, stdio: 'pipe' });
      execSync(`git -C "${rootRepo.barePath}" push "file://${joshBare}" refs/heads/main:refs/heads/main`, { stdio: 'pipe' });
    }

    const gen3Result = await handleFork('josh/dronehunter', {
      env: testEnv,
      sessionToken: 'token_alice_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });
    expect(gen3Result.success).toBe(true);
    createdWorktrees.push(gen3Result.data.worktreePath);

    const aliceRepo = await ctx.d1.prepare(`
      SELECT id FROM repositories WHERE owner_user_id = 'usr_alice' AND slug = 'dronehunter'
    `).first<any>();

    const aliceLineage = await ctx.d1.prepare(`
      SELECT child_repository_id AS childRepositoryId,
             parent_repository_id AS parentRepositoryId,
             forked_by_user_id AS forkedByUserId,
             lineage_root_repository_id AS lineageRootRepositoryId,
             depth
      FROM repository_forks
      WHERE child_repository_id = ?
    `).bind(aliceRepo.id).first<any>();

    expect(aliceLineage).toBeDefined();
    expect(aliceLineage.parentRepositoryId).toBe(joshRepo.id);
    expect(aliceLineage.forkedByUserId).toBe('usr_alice');
    expect(aliceLineage.lineageRootRepositoryId).toBe(rootRepo.id);
    expect(aliceLineage.depth).toBe(3);
  });

  it('Requirement 2: Unknown repository slug fails honestly with zero github fallbacks or directory invention', async () => {
    const unknownSlug = 'nate/nonexistent-arcade-game';
    const forkResult = await handleFork(unknownSlug, {
      env: testEnv,
      sessionToken: 'token_sam_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });

    expect(forkResult.success).toBe(false);
    expect(forkResult.message).toContain('no placeholder fork was created');
    expect(existsSync(forkResult.data.worktreePath)).toBe(false);

    const repoCount = await ctx.d1.prepare(`
      SELECT COUNT(*) AS total FROM repositories WHERE slug = 'nonexistent-arcade-game'
    `).first<any>();
    expect(repoCount.total).toBe(0);

    const forkCount = await ctx.d1.prepare(`
      SELECT COUNT(*) AS total FROM repository_forks
    `).first<any>();
    expect(forkCount.total).toBe(0);
  });

  it('Requirement 3: SLOPSHOP fork plan coordinates route through canonical fork API', async () => {
    const rootRepo = await seedCanonicalRepository({
      id: 'repo_mailer_canonical',
      ownerUserId: 'usr_nate',
      slug: 'certified-mailer',
      commitOid: OID_ROOT
    });

    const coordinate = coordinateFromForgeRepository({
      id: rootRepo.id,
      slug: 'certified-mailer',
      ownerUsername: 'nate',
      status: 'active'
    }, {
      protocol: 'ssh',
      configured: true,
      active: true,
      host: 'forge.example.test',
      port: 22
    });

    expect(coordinate.slug).toBe('nate/certified-mailer');
    expect(coordinate.repoUrl).toBe('ssh://git@forge.example.test:22/nate/certified-mailer.git');

    const plan = generateLocalAgentPlan({
      coordinate,
      feature: {
        id: 'cm-export',
        name: 'Export Journal',
        description: 'Export logs to JSON format.',
        category: 'Features',
        targetFiles: ['src/export.ts'],
        blueprintDiffPreview: '+ export function dump() {}',
        prompt: 'Implement journal export.',
        verificationCriteria: ['Clean build']
      },
      agent: 'agy'
    });

    expect(plan.singleLineCommand).toBe('slop fork "ssh://git@forge.example.test:22/nate/certified-mailer.git"');

    const forkResult = await handleFork(coordinate.repoUrl, {
      env: testEnv,
      sessionToken: 'token_sam_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });

    expect(forkResult.success).toBe(true);
    createdWorktrees.push(forkResult.data.worktreePath);

    const childRepo = await ctx.d1.prepare(`
      SELECT id FROM repositories WHERE owner_user_id = 'usr_sam' AND slug = 'certified-mailer'
    `).first<any>();
    expect(childRepo).toBeDefined();

    const lineage = await ctx.d1.prepare(`
      SELECT parent_repository_id AS parentRepositoryId, forked_by_user_id AS forkedByUserId, depth
      FROM repository_forks WHERE child_repository_id = ?
    `).bind(childRepo.id).first<any>();

    expect(lineage).toBeDefined();
    expect(lineage.parentRepositoryId).toBe(rootRepo.id);
    expect(lineage.forkedByUserId).toBe('usr_sam');
    expect(lineage.depth).toBe(1);
  });

  it('Requirement 4: Unauthenticated fork attempt fails honestly with 401', async () => {
    await seedCanonicalRepository({
      id: 'repo_auth_test',
      ownerUserId: 'usr_nate',
      slug: 'dronehunter',
      commitOid: OID_ROOT
    });

    const forkResult = await handleFork('nate/dronehunter', {
      env: testEnv,
      sessionToken: 'invalid_unrecognized_token',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });

    expect(forkResult.success).toBe(false);
    expect(forkResult.message).toContain('Unauthorized');
    expect(existsSync(forkResult.data.worktreePath)).toBe(false);
  });


  it('Constraint: Honest empty-repo onboarding from B5 is preserved without fabricating files', async () => {
    const emptyRepoId = 'repo_empty_canonical';
    const emptyBarePath = join(testReposDir, 'repositories', emptyRepoId);
    mkdirSync(emptyBarePath, { recursive: true });
    execSync('git init --bare -b main', { cwd: emptyBarePath, stdio: 'pipe' });

    await ctx.d1.batch([
      ctx.d1.prepare(`
        INSERT INTO repositories (
          id, app_id, owner_user_id, slug, visibility, object_format,
          default_ref, storage_key, status, created_at, updated_at
        ) VALUES (?, NULL, 'usr_nate', 'empty-app', 'public', 'sha1', 'refs/heads/main', ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(emptyRepoId, `repositories/${emptyRepoId}`),
      ctx.d1.prepare(`
        INSERT INTO repository_members (repository_id, user_id, role, granted_by_user_id, created_at)
        VALUES (?, 'usr_nate', 'owner', 'usr_nate', CURRENT_TIMESTAMP)
      `).bind(emptyRepoId)
    ]);

    const res = await handleFork(emptyBarePath, { local: true });
    expect(res.success).toBe(true);
    expect(res.data.isEmptyRepo).toBe(true);
    expect(res.data.templateApplied).toBeNull();
    createdWorktrees.push(res.data.worktreePath);

    expect(existsSync(join(res.data.worktreePath, 'package.json'))).toBe(false);
    expect(existsSync(join(res.data.worktreePath, 'index.html'))).toBe(false);
    expect(existsSync(join(res.data.worktreePath, 'server.mjs'))).toBe(false);
    expect(existsSync(join(res.data.worktreePath, 'README.md'))).toBe(false);
  });

  it('[P1 Security] local path with `"` + `;` metacharacters does NOT execute shell commands (execFileSync immunity)', async () => {
    const canaryPath = join(tmpdir(), `slop-canary-inject-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.txt`);
    if (existsSync(canaryPath)) rmSync(canaryPath, { force: true });

    const injectedSlug = `file:///tmp/repo"; touch "${canaryPath}"; "`;

    const res = await handleFork(injectedSlug, {
      env: testEnv,
      sessionToken: 'token_sam_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });

    expect(existsSync(canaryPath)).toBe(false);
    expect(res.success).toBe(false);
    if (res.data?.worktreePath) {
      expect(existsSync(res.data.worktreePath)).toBe(false);
    }

    const funnyDir = join(testReposDir, 'funny"; touch canary; "');
    mkdirSync(funnyDir, { recursive: true });
    execSync('git init -b main', { cwd: funnyDir, stdio: 'pipe' });
    execSync('git config user.name "Tester"', { cwd: funnyDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: funnyDir, stdio: 'pipe' });
    execSync('echo "safe content" > README.md', { cwd: funnyDir, stdio: 'pipe' });
    execSync('git add -A && git commit -m "init"', { cwd: funnyDir, stdio: 'pipe' });

    const funnyRes = await handleFork(funnyDir, { local: true });
    expect(existsSync(canaryPath)).toBe(false);
    expect(funnyRes.success).toBe(true);
    createdWorktrees.push(funnyRes.data.worktreePath);
    expect(existsSync(join(funnyRes.data.worktreePath, 'README.md'))).toBe(true);
  });

  it('[P1 Honest Failure] fork API unreachable with local checkout present FAILS fatally without silent local fallback', async () => {
    await seedCanonicalRepository({
      id: 'repo_fail_test',
      ownerUserId: 'usr_nate',
      slug: 'dronehunter',
      commitOid: OID_ROOT
    });

    const forkRes = await handleFork('nate/dronehunter', {
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED: Control plane unreachable')),
      reposRoot: testReposDir
    });

    expect(forkRes.success).toBe(false);
    expect(forkRes.message).toContain('Control plane unreachable');
    expect(forkRes.data.registeredFork).toBeNull();
    expect(existsSync(forkRes.data.worktreePath)).toBe(false);
  });

  it('[P1 Lineage Integrity] file:// / local source registers canonical lineage when resolvable, rejects unregistered sources', async () => {
    const canonicalRepo = await seedCanonicalRepository({
      id: 'repo_local_lineage_test',
      ownerUserId: 'usr_nate',
      slug: 'local-arcade',
      commitOid: OID_ROOT
    });

    const fileUrl = `file://${canonicalRepo.barePath}`;
    const resSuccess = await handleFork(fileUrl, {
      env: testEnv,
      sessionToken: 'token_sam_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });

    expect(resSuccess.success).toBe(true);
    expect(resSuccess.data.isRealWorktree).toBe(true);
    createdWorktrees.push(resSuccess.data.worktreePath);

    expect(resSuccess.data.registeredFork?.repository?.id).toBeDefined();
    const childRepoId = resSuccess.data.registeredFork.repository.id;
    const childRepo = await ctx.d1.prepare(`
      SELECT id, owner_user_id AS ownerUserId FROM repositories WHERE id = ?
    `).bind(childRepoId).first<any>();
    expect(childRepo).toBeDefined();
    expect(childRepo.ownerUserId).toBe('usr_sam');

    const lineageRow = await ctx.d1.prepare(`
      SELECT child_repository_id AS childRepositoryId,
             parent_repository_id AS parentRepositoryId,
             forked_by_user_id AS forkedByUserId
      FROM repository_forks
      WHERE child_repository_id = ?
    `).bind(childRepoId).first<any>();

    expect(lineageRow).toBeDefined();
    expect(lineageRow.childRepositoryId).toBe(childRepoId);
    expect(lineageRow.parentRepositoryId).toBe(canonicalRepo.id);
    expect(lineageRow.forkedByUserId).toBe('usr_sam');

    const unregDir = join(testReposDir, 'unregistered-random-git');
    mkdirSync(unregDir, { recursive: true });
    execSync('git init -b main', { cwd: unregDir, stdio: 'pipe' });
    execSync('git config user.name "Tester"', { cwd: unregDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: unregDir, stdio: 'pipe' });
    execSync('echo "unregistered" > README.md', { cwd: unregDir, stdio: 'pipe' });
    execSync('git add -A && git commit -m "init"', { cwd: unregDir, stdio: 'pipe' });

    const resUnregistered = await handleFork(`file://${unregDir}`, {
      env: testEnv,
      sessionToken: 'token_sam_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });

    expect(resUnregistered.success).toBe(false);
    expect(resUnregistered.message).toContain('no placeholder fork was created');
    expect(existsSync(resUnregistered.data.worktreePath)).toBe(false);

    const unregForkCount = await ctx.d1.prepare(`
      SELECT COUNT(*) AS total FROM repository_forks WHERE child_repository_id = ?
    `).bind('unregistered-random-git').first<any>();
    expect(Number(unregForkCount.total)).toBe(0);
  });

  it('[P1 Lineage Integrity] valid remote canonical fork records immutable ancestry and clones repository', async () => {
    const rootRepo = await seedCanonicalRepository({
      id: 'repo_remote_test',
      ownerUserId: 'usr_nate',
      slug: 'dronehunter',
      commitOid: OID_ROOT
    });

    const remoteUrl = 'ssh://git@forge.example.test:22/nate/dronehunter.git';
    const forkRes = await handleFork(remoteUrl, {
      env: testEnv,
      sessionToken: 'token_josh_secret',
      gatewayToken: testEnv.GITSMITH_GATEWAY_TOKEN,
      reposRoot: testReposDir
    });

    expect(forkRes.success).toBe(true);
    expect(forkRes.data.isRealWorktree).toBe(true);
    createdWorktrees.push(forkRes.data.worktreePath);

    const childRepo = await ctx.d1.prepare(`
      SELECT id FROM repositories WHERE owner_user_id = 'usr_josh' AND slug = 'dronehunter'
    `).first<any>();
    expect(childRepo).toBeDefined();

    const lineage = await ctx.d1.prepare(`
      SELECT parent_repository_id AS parentRepositoryId, forked_by_user_id AS forkedByUserId, depth
      FROM repository_forks WHERE child_repository_id = ?
    `).bind(childRepo.id).first<any>();

    expect(lineage).toBeDefined();
    expect(lineage.parentRepositoryId).toBe(rootRepo.id);
    expect(lineage.forkedByUserId).toBe('usr_josh');
    expect(lineage.depth).toBe(1);

    expect(existsSync(join(forkRes.data.worktreePath, 'README.md'))).toBe(true);
    expect(existsSync(join(forkRes.data.worktreePath, '.git'))).toBe(true);
  });
});
