import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  initBareRepo,
  readAuthoritativeRef,
  hasGitObject,
  updateAuthoritativeRefCas,
  cloneOrFetchForFork,
  validateStorageKey,
  resolveRepoPath,
  checkGitCapabilities,
  getRepoObjectFormat
} from '../src/lib/gitsmith/gitStorage';
import { GitsmithGatewayService } from '../src/lib/gitsmith/gatewayService';
import {
  ForgeOutboxDispatcher,
  calculateBackoffSeconds
} from '../src/lib/gitsmith/outboxDispatcher';
import {
  validateProductionStartup,
  ProductionStartupError
} from '../src/lib/gitsmith/config';
import { GatewayHealthChecker } from '../src/lib/gitsmith/health';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as gitApi from '../functions/api/git';

const GATEWAY_SECRET = 'secret_gateway_token_xyz_123';

/**
 * Helper to create a real commit in a bare git repository using Git plumbing commands.
 */
function createRealGitCommit(
  repoPath: string,
  message: string,
  parentOid?: string
): string {
  // 1. Create an empty tree
  const treeOid = execFileSync('git', ['write-tree'], {
    cwd: repoPath,
    encoding: 'utf8',
    env: { ...process.env, GIT_INDEX_FILE: path.join(repoPath, 'index.temp') }
  }).trim();

  // 2. Create commit object
  const args = ['commit-tree', treeOid, '-m', message];
  if (parentOid) {
    args.push('-p', parentOid);
  }

  const commitOid = execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Nate Maker',
      GIT_AUTHOR_EMAIL: 'nate@nates-software.com',
      GIT_COMMITTER_NAME: 'Nate Maker',
      GIT_COMMITTER_EMAIL: 'nate@nates-software.com',
      GIT_AUTHOR_DATE: '2026-08-29T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-29T12:00:00Z'
    }
  }).trim();

  return commitOid;
}

describe('GITSMITH Authoritative Gateway & Durable Outbox Dispatcher Suite', () => {
  let tempRoot: string;
  let d1Ctx: TestD1Context;

  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsmith-test-repos-'));
    d1Ctx = await createTestD1Database({ foreignKeys: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  // =========================================================================
  // 1. SAFE BARE REPOSITORY PROVISIONING (SHA-1 & SHA-256)
  // =========================================================================
  describe('1. Safe Bare Repository Provisioning', () => {
    it('provisions a bare repo beneath configured explicit root with sha1 format', () => {
      const res = initBareRepo(tempRoot, {
        storageKey: 'repositories/repo_alpha',
        objectFormat: 'sha1',
        defaultRef: 'refs/heads/main'
      });

      expect(res.success).toBe(true);
      expect(res.repoPath).toBe(path.join(tempRoot, 'repositories/repo_alpha'));
      expect(fs.existsSync(path.join(res.repoPath, 'HEAD'))).toBe(true);
      expect(fs.existsSync(path.join(res.repoPath, 'objects'))).toBe(true);
      expect(fs.existsSync(path.join(res.repoPath, 'refs'))).toBe(true);

      // Verify Git bare repository
      const isBare = execFileSync('git', ['rev-parse', '--is-bare-repository'], {
        cwd: res.repoPath,
        encoding: 'utf8'
      }).trim();
      expect(isBare).toBe('true');
    });

    it('provisions a bare repo with sha256 format if supported by git', () => {
      const caps = checkGitCapabilities();
      if (!caps.supportsSha256) return;

      const res = initBareRepo(tempRoot, {
        storageKey: 'repositories/repo_sha256',
        objectFormat: 'sha256',
        defaultRef: 'refs/heads/main'
      });

      expect(res.success).toBe(true);
      expect(getRepoObjectFormat(res.repoPath)).toBe('sha256');
    });

    it('handles idempotent re-initialization gracefully without mutating state', () => {
      const res1 = initBareRepo(tempRoot, { storageKey: 'repositories/repo_idemp' });
      expect(res1.success).toBe(true);
      expect(res1.idempotent).toBe(false);

      const res2 = initBareRepo(tempRoot, { storageKey: 'repositories/repo_idemp' });
      expect(res2.success).toBe(true);
      expect(res2.idempotent).toBe(true);
    });

    it('fails closed if directory exists with conflicting object format', () => {
      const caps = checkGitCapabilities();
      if (!caps.supportsSha256) return;

      initBareRepo(tempRoot, { storageKey: 'repositories/repo_conflict', objectFormat: 'sha1' });

      // Attempt to re-initialize with sha256
      const resConflict = initBareRepo(tempRoot, { storageKey: 'repositories/repo_conflict', objectFormat: 'sha256' });
      expect(resConflict.success).toBe(false);
      expect(resConflict.error).toContain('conflicting object format');
    });
  });

  // =========================================================================
  // 2. PATH TRAVERSAL & SYMLINK PROTECTION
  // =========================================================================
  describe('2. Path Traversal & Symlink Sandboxing', () => {
    it('rejects illegal storage keys containing traversal sequences', () => {
      const invalidKeys = [
        '../evil',
        'foo/../../bar',
        '/etc/passwd',
        'repositories/../../../tmp/evil',
        'repo\0null',
        'repo:stream',
        'repo?.git',
        'repo.lock',
        'repo/.'
      ];

      for (const badKey of invalidKeys) {
        const val = validateStorageKey(badKey);
        expect(val.valid).toBe(false);

        const res = resolveRepoPath(tempRoot, badKey);
        expect(res.valid).toBe(false);
      }
    });

    it('detects and blocks symbolic links pointing outside reposRoot', () => {
      // Create an external secret directory
      const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsmith-external-'));
      const symlinkParent = path.join(tempRoot, 'symlink_escape');

      try {
        fs.symlinkSync(externalDir, symlinkParent, 'dir');

        const res = resolveRepoPath(tempRoot, 'symlink_escape/repo_inside');
        expect(res.valid).toBe(false);
        expect(res.error).toContain('Symbolic link rejected');
      } finally {
        if (fs.existsSync(externalDir)) {
          fs.rmSync(externalDir, { recursive: true, force: true });
        }
      }
    });
  });

  // =========================================================================
  // 3. AUTHORITATIVE GIT CAS & REF OPERATIONS
  // =========================================================================
  describe('3. Authoritative Git CAS & Ref Operations', () => {
    let repoPath: string;
    const storageKey = 'repositories/repo_cas_test';

    beforeEach(() => {
      const res = initBareRepo(tempRoot, { storageKey, objectFormat: 'sha1' });
      repoPath = res.repoPath;
    });

    it('creates ref via atomic CAS (zeros -> commit1)', () => {
      const commit1 = createRealGitCommit(repoPath, 'Initial commit');

      const casRes = updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/main',
        newOid: commit1,
        expectedOldOid: null,
        operation: 'create'
      });

      expect(casRes.success).toBe(true);
      expect(casRes.newOid).toBe(commit1);

      // Verify authoritative ref in Git
      const currentRef = readAuthoritativeRef(tempRoot, storageKey, 'refs/heads/main');
      expect(currentRef).toBe(commit1);
    });

    it('updates ref via atomic CAS (commit1 -> commit2)', () => {
      const commit1 = createRealGitCommit(repoPath, 'Initial commit');
      const commit2 = createRealGitCommit(repoPath, 'Second commit', commit1);

      // Create initial ref
      updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/main',
        newOid: commit1,
        expectedOldOid: null,
        operation: 'create'
      });

      // Update to commit2 with expectedOldOid = commit1
      const updateRes = updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/main',
        newOid: commit2,
        expectedOldOid: commit1,
        operation: 'update'
      });

      expect(updateRes.success).toBe(true);
      expect(updateRes.newOid).toBe(commit2);
      expect(readAuthoritativeRef(tempRoot, storageKey, 'refs/heads/main')).toBe(commit2);
    });

    it('rejects stale CAS update when remote ref has moved, leaving ref untouched', () => {
      const commit1 = createRealGitCommit(repoPath, 'Initial commit');
      const commit2 = createRealGitCommit(repoPath, 'Second commit', commit1);
      const commit3 = createRealGitCommit(repoPath, 'Third commit', commit1);

      // Create initial ref at commit1
      updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/main',
        newOid: commit1,
        expectedOldOid: null,
        operation: 'create'
      });

      // Advance ref to commit2
      updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/main',
        newOid: commit2,
        expectedOldOid: commit1,
        operation: 'update'
      });

      // Attempt stale update expecting commit1 when ref is actually at commit2
      const staleRes = updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/main',
        newOid: commit3,
        expectedOldOid: commit1, // Stale!
        operation: 'update'
      });

      expect(staleRes.success).toBe(false);
      expect(staleRes.stale).toBe(true);
      expect(staleRes.currentOid).toBe(commit2);
      expect(staleRes.error).toContain('CAS check failed');

      // Verify ref is still untouched at commit2
      expect(readAuthoritativeRef(tempRoot, storageKey, 'refs/heads/main')).toBe(commit2);
    });

    it('deletes ref via atomic CAS', () => {
      const commit1 = createRealGitCommit(repoPath, 'Initial commit');
      updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/feature',
        newOid: commit1,
        expectedOldOid: null,
        operation: 'create'
      });

      expect(readAuthoritativeRef(tempRoot, storageKey, 'refs/heads/feature')).toBe(commit1);

      const delRes = updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/feature',
        newOid: null,
        expectedOldOid: commit1,
        operation: 'delete'
      });

      expect(delRes.success).toBe(true);
      expect(readAuthoritativeRef(tempRoot, storageKey, 'refs/heads/feature')).toBeNull();
    });
  });

  // =========================================================================
  // 4. FORK OBJECT TRANSFER & LINEAGE PROVISIONING ON DISK
  // =========================================================================
  describe('4. Fork Object Transfer & Lineage on Disk', () => {
    it('provisions a child fork on disk and transfers parent commit objects', () => {
      // 1. Setup parent repo with real commit
      const parentStorageKey = 'repositories/parent_repo';
      const parentInit = initBareRepo(tempRoot, { storageKey: parentStorageKey });
      const parentCommit = createRealGitCommit(parentInit.repoPath, 'Genesis commit in parent');

      updateAuthoritativeRefCas(tempRoot, {
        storageKey: parentStorageKey,
        refName: 'refs/heads/main',
        newOid: parentCommit,
        expectedOldOid: null,
        operation: 'create'
      });

      // 2. Provision fork
      const childStorageKey = 'repositories/child_repo';
      const forkRes = cloneOrFetchForFork(tempRoot, {
        childRepositoryId: 'child_repo',
        childStorageKey,
        parentRepositoryId: 'parent_repo',
        parentStorageKey,
        parentRefName: 'refs/heads/main',
        parentCommitOid: parentCommit,
        childInitialCommitOid: parentCommit,
        lineageRootRepositoryId: 'parent_repo',
        depth: 1,
        idempotencyKey: 'idemp_fork_disk_test'
      });

      expect(forkRes.success).toBe(true);
      expect(forkRes.childInitialCommitOid).toBe(parentCommit);

      // Verify commit is reachable in child repo
      expect(hasGitObject(tempRoot, childStorageKey, parentCommit)).toBe(true);
      expect(readAuthoritativeRef(tempRoot, childStorageKey, 'refs/heads/main')).toBe(parentCommit);
    });
  });

  // =========================================================================
  // 5. DURABLE OUTBOX DISPATCHER LEASING & RACE CONDITIONS
  // =========================================================================
  describe('5. Durable Outbox Dispatcher Leasing & Race Conditions', () => {
    it('grants lease to exactly one worker during concurrent claims', async () => {
      // Seed outbox event
      const eventId = 'evt_race_1';
      await d1Ctx.d1.prepare(`
        INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
        VALUES (?, 'repository', 'repo_race', 'repository.provisioning_requested', ?, 0, CURRENT_TIMESTAMP)
      `).bind(
        eventId,
        JSON.stringify({ repositoryId: 'repo_race', storageKey: 'repositories/repo_race' })
      ).run();

      const config = {
        reposRoot: tempRoot,
        controlPlaneUrl: 'http://localhost:8788',
        gatewayToken: GATEWAY_SECRET,
        leaseDurationSeconds: 30
      };

      const dispatcher1 = new ForgeOutboxDispatcher(config, { db: d1Ctx.d1 });
      const dispatcher2 = new ForgeOutboxDispatcher(config, { db: d1Ctx.d1 });

      // Run concurrent claims
      const [claimed1, claimed2] = await Promise.all([
        dispatcher1.claimDueEvents(10, 30),
        dispatcher2.claimDueEvents(10, 30)
      ]);

      const totalClaimed = claimed1.length + claimed2.length;
      expect(totalClaimed).toBe(1);
      expect(claimed1.length === 1 || claimed2.length === 1).toBe(true);
    });

    it('allows re-claiming after lease duration expires', async () => {
      const eventId = 'evt_lease_exp';
      await d1Ctx.d1.prepare(`
        INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, available_at, lease_expires_at, created_at)
        VALUES (?, 'repository', 'repo_lease', 'repository.provisioning_requested', ?, 0, datetime('now', '-5 seconds'), datetime('now', '-1 second'), CURRENT_TIMESTAMP)
      `).bind(
        eventId,
        JSON.stringify({ repositoryId: 'repo_lease', storageKey: 'repositories/repo_lease' })
      ).run();

      const config = {
        reposRoot: tempRoot,
        controlPlaneUrl: 'http://localhost:8788',
        gatewayToken: GATEWAY_SECRET
      };

      const dispatcher = new ForgeOutboxDispatcher(config, { db: d1Ctx.d1 });
      const claimed = await dispatcher.claimDueEvents(10, 30);

      expect(claimed.length).toBe(1);
      expect(claimed[0].id).toBe(eventId);
    });

    it('dispatches through the authenticated remote control-plane API without a direct D1 connection', async () => {
      const repoId = 'repo_remote_dispatch';
      const storageKey = `repositories/${repoId}`;
      const eventId = 'evt_remote_dispatch';
      await d1Ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, storage_key, status)
        VALUES (?, 'usr_nate', 'remote-dispatch', 'public', ?, 'provisioning')
      `).bind(repoId, storageKey).run();
      await d1Ctx.d1.prepare(`
        INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts)
        VALUES (?, 'repository', ?, 'repository.provisioning_requested', ?, 0)
      `).bind(eventId, repoId, JSON.stringify({
        repositoryId: repoId, storageKey, objectFormat: 'sha1', defaultRef: 'refs/heads/main'
      })).run();

      const apiFetch: typeof fetch = async (url, init) => gitApi.onRequestPost({
        request: new Request(url, init),
        env: { DB: d1Ctx.d1, GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }
      });
      const dispatcher = new ForgeOutboxDispatcher({
        reposRoot: tempRoot,
        controlPlaneUrl: 'http://control-plane.test',
        gatewayToken: GATEWAY_SECRET
      }, { fetchOverride: apiFetch });

      const result = await dispatcher.dispatchBatch(1);
      expect(result.claimed).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(fs.existsSync(path.join(tempRoot, storageKey, 'HEAD'))).toBe(true);
      const event = await d1Ctx.d1.prepare(
        'SELECT attempts, delivered_at, claim_token FROM forge_outbox_events WHERE id = ?'
      ).bind(eventId).first();
      expect((event as any).attempts).toBe(1);
      expect((event as any).delivered_at).not.toBeNull();
      expect((event as any).claim_token).toBeNull();
      const repo = await d1Ctx.d1.prepare('SELECT status FROM repositories WHERE id = ?').bind(repoId).first();
      expect((repo as any).status).toBe('active');
    });

    it('never claims non-work audit events', async () => {
      await d1Ctx.d1.prepare(`
        INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts)
        VALUES ('evt_audit_only', 'repository', 'repo_audit', 'repository.provisioned', '{}', 0)
      `).run();
      const dispatcher = new ForgeOutboxDispatcher({
        reposRoot: tempRoot,
        controlPlaneUrl: 'http://localhost:8788',
        gatewayToken: GATEWAY_SECRET
      }, { db: d1Ctx.d1 });
      expect(await dispatcher.claimDueEvents()).toEqual([]);
    });
  });

  // =========================================================================
  // 6. CALLBACK FAILURE AFTER GIT SUCCESS & RETRY RECOVERY
  // =========================================================================
  describe('6. Callback Failure After Git Success & Durable Recovery', () => {
    it('persists a post-CAS callback receipt and replays it after service restart', async () => {
      const storageKey = 'repositories/repo_receipt_restart';
      const init = initBareRepo(tempRoot, { storageKey });
      const commit = createRealGitCommit(init.repoPath, 'Receipt restart');
      const config = {
        reposRoot: tempRoot,
        controlPlaneUrl: 'http://control-plane.test',
        gatewayToken: GATEWAY_SECRET
      };
      const offline: typeof fetch = async () => { throw new Error('network offline'); };
      const service = new GitsmithGatewayService(config, { fetchOverride: offline });
      const result = await service.updateAuthoritativeRef({
        repositoryId: 'repo_receipt_restart', storageKey,
        refName: 'refs/heads/main', newOid: commit, expectedOldOid: null,
        operation: 'create', idempotencyKey: 'receipt-restart-1'
      });
      expect(result.success).toBe(true);
      expect(result.reconciled).toBe(false);
      expect(result.receiptPersisted).toBe(true);
      const receiptDir = path.join(tempRoot, '.gitsmith-receipts');
      expect(fs.readdirSync(receiptDir).filter(file => file.endsWith('.json'))).toHaveLength(1);

      const deliveredPayloads: any[] = [];
      const online: typeof fetch = async (_url, request) => {
        deliveredPayloads.push(JSON.parse(String(request?.body)));
        return Response.json({ success: true, idempotent: true });
      };
      const restarted = new GitsmithGatewayService(config, { fetchOverride: online });
      expect(await restarted.replayPendingCallbacks()).toMatchObject({ replayed: 1, failed: 0 });
      expect(deliveredPayloads[0].idempotencyKey).toBe('receipt-restart-1');
      expect(fs.readdirSync(receiptDir).filter(file => file.endsWith('.json'))).toHaveLength(0);
    });

    it('re-attempts callback without corrupting disk git repo when callback fails transiently', async () => {
      const eventId = 'evt_cb_fail';
      const repoId = 'repo_cb_recovery';
      const storageKey = `repositories/${repoId}`;

      await d1Ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, storage_key, status)
        VALUES (?, 'usr_nate', 'cb-recovery', 'public', ?, 'provisioning')
      `).bind(repoId, storageKey).run();

      await d1Ctx.d1.prepare(`
        INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
        VALUES (?, 'repository', ?, 'repository.provisioning_requested', ?, 0, CURRENT_TIMESTAMP)
      `).bind(
        eventId, repoId,
        JSON.stringify({ repositoryId: repoId, storageKey })
      ).run();

      let callbackAttempt = 0;
      const mockFetch: typeof fetch = async (url, init) => {
        callbackAttempt++;
        if (callbackAttempt === 1) {
          // Simulate transient 500 network error on first try
          return new Response(JSON.stringify({ success: false, error: 'Transient upstream timeout' }), { status: 500 });
        }
        // Direct call to real control plane endpoint on second try
        const req = new Request(url, init);
        return gitApi.onRequestPost({ request: req, env: { DB: d1Ctx.d1, GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET } });
      };

      const config = {
        reposRoot: tempRoot,
        controlPlaneUrl: 'http://localhost:8788',
        gatewayToken: GATEWAY_SECRET
      };

      const dispatcher = new ForgeOutboxDispatcher(config, { db: d1Ctx.d1, fetchOverride: mockFetch });

      // 1. First run -> Git repo is created on disk, callback fails, event backoff scheduled
      const claim1 = await dispatcher.claimDueEvents(1);
      expect(claim1.length).toBe(1);
      const res1 = await dispatcher.processEvent(claim1[0]);
      expect(res1.success).toBe(false);
      expect(res1.retryable).toBe(true);

      // Verify Git repo exists on disk even though callback failed
      expect(fs.existsSync(path.join(tempRoot, storageKey, 'HEAD'))).toBe(true);

      // Verify outbox event is in retry status with attempts = 1
      const eventInDb = await d1Ctx.d1.prepare('SELECT attempts, last_error, delivered_at FROM forge_outbox_events WHERE id = ?')
        .bind(eventId).first();
      expect((eventInDb as any).attempts).toBe(1);
      expect((eventInDb as any).delivered_at).toBeNull();
      expect((eventInDb as any).last_error).toContain('Provisioning callback failed');

      // 2. Reset available_at to now to simulate backoff window passing
      await d1Ctx.d1.prepare("UPDATE forge_outbox_events SET available_at = datetime('now', '-1 second'), lease_expires_at = NULL WHERE id = ?")
        .bind(eventId).run();

      // 3. Second run -> Re-attempts callback, succeeds, marks delivered
      const claim2 = await dispatcher.claimDueEvents(1);
      expect(claim2.length).toBe(1);
      const res2 = await dispatcher.processEvent(claim2[0]);
      expect(res2.success).toBe(true);

      // Verify outbox event is marked delivered
      const eventAfter = await d1Ctx.d1.prepare('SELECT delivered_at FROM forge_outbox_events WHERE id = ?').bind(eventId).first();
      expect((eventAfter as any).delivered_at).not.toBeNull();

      // Verify repository status in D1 is active
      const repoInDb = await d1Ctx.d1.prepare('SELECT status FROM repositories WHERE id = ?').bind(repoId).first();
      expect((repoInDb as any).status).toBe('active');
    });
  });

  // =========================================================================
  // 7. RESTART RECONCILIATION & DISCREPANCY AUDITING
  // =========================================================================
  describe('7. Restart Reconciliation & Discrepancy Auditing', () => {
    it('detects git_missing_in_d1 and oid_mismatch discrepancies and writes reconciliation rows', async () => {
      const repoId = 'repo_recon_test';
      const storageKey = `repositories/${repoId}`;

      // Create repository in D1
      await d1Ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, storage_key, status)
        VALUES (?, 'usr_nate', 'recon-slug', 'public', ?, 'active')
      `).bind(repoId, storageKey).run();

      // Initialize bare git repo on disk
      const initRes = initBareRepo(tempRoot, { storageKey });
      const commit1 = createRealGitCommit(initRes.repoPath, 'Commit 1');
      const commit2 = createRealGitCommit(initRes.repoPath, 'Commit 2', commit1);
      const unprojectedCommit = createRealGitCommit(initRes.repoPath, 'Unprojected feature');

      // On disk: refs/heads/main is at commit2, refs/heads/feature is at unprojectedCommit
      updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/main',
        newOid: commit2,
        expectedOldOid: null,
        operation: 'create'
      });
      updateAuthoritativeRefCas(tempRoot, {
        storageKey,
        refName: 'refs/heads/feature',
        newOid: unprojectedCommit,
        expectedOldOid: null,
        operation: 'create'
      });

      // In D1: repository_refs has refs/heads/main at commit1 (OID mismatch!) and no refs/heads/feature (git_missing_in_d1!)
      await d1Ctx.d1.prepare(`
        INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version)
        VALUES (?, 'refs/heads/main', ?, 1)
      `).bind(repoId, commit1).run();

      const config = {
        reposRoot: tempRoot,
        controlPlaneUrl: 'http://localhost:8788',
        gatewayToken: GATEWAY_SECRET
      };

      const dispatcher = new ForgeOutboxDispatcher(config, { db: d1Ctx.d1 });
      const summary = await dispatcher.reconcileDiscrepancies();

      expect(summary.openIssuesFound).toBeGreaterThanOrEqual(2);

      const issueTypes = summary.issues.map(i => i.issue_type);
      expect(issueTypes).toContain('oid_mismatch');
      expect(issueTypes).toContain('git_missing_in_d1');

      // Verify issues recorded in forge_reconciliation_issues table
      const rows = await d1Ctx.d1.prepare('SELECT * FROM forge_reconciliation_issues WHERE repository_id = ?').bind(repoId).all();
      expect(rows.results?.length).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // 8. PRODUCTION STARTUP FAIL-CLOSED INVARIANTS
  // =========================================================================
  describe('8. Production Startup Fail-Closed Invariants', () => {
    it('fails closed when GITSMITH_PRODUCTION_ENABLED is missing in production mode', () => {
      expect(() => {
        validateProductionStartup({
          reposRoot: tempRoot,
          controlPlaneUrl: 'https://nates-software.pages.dev',
          gatewayToken: 'a'.repeat(32),
          productionEnabled: false,
          isProduction: true
        });
      }).toThrow(ProductionStartupError);
    });

    it('fails closed when reposRoot is raw /tmp in production mode', () => {
      expect(() => {
        validateProductionStartup({
          reposRoot: '/tmp',
          controlPlaneUrl: 'https://nates-software.pages.dev',
          gatewayToken: 'a'.repeat(32),
          productionEnabled: true,
          isProduction: true
        });
      }).toThrow(/cannot be system root or raw \/tmp/);
    });

    it('fails closed when controlPlaneUrl is invalid', () => {
      expect(() => {
        validateProductionStartup({
          reposRoot: tempRoot,
          controlPlaneUrl: 'not_a_valid_url',
          gatewayToken: 'a'.repeat(32),
          productionEnabled: true,
          isProduction: true
        });
      }).toThrow(/GITSMITH_CONTROL_PLANE_URL/);
    });

    it('fails closed when gatewayToken is too short (<16 chars)', () => {
      expect(() => {
        validateProductionStartup({
          reposRoot: tempRoot,
          controlPlaneUrl: 'https://nates-software.pages.dev',
          gatewayToken: 'short_token',
          productionEnabled: true,
          isProduction: true
        });
      }).toThrow(/at least 16 characters/);
    });

    it('passes production startup when all 4 invariants are satisfied', () => {
      expect(() => {
        validateProductionStartup({
          reposRoot: tempRoot,
          controlPlaneUrl: 'https://nates-software.pages.dev',
          gatewayToken: 'super_secure_production_secret_key_123',
          productionEnabled: true,
          isProduction: true
        });
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 9. HEALTH & READINESS TRUTHFULNESS
  // =========================================================================
  describe('9. Health & Readiness Truthfulness', () => {
    const healthChecker = new GatewayHealthChecker();

    it('returns healthy status on /healthz probe', () => {
      const health = healthChecker.getHealth();
      expect(health.status).toBe('ok');
      expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('truthfully distinguishes unconfigured vs active on /readyz', async () => {
      // 1. Unconfigured
      const unconfigured = await healthChecker.getReadiness({
        reposRoot: '',
        controlPlaneUrl: '',
        gatewayToken: ''
      });
      expect(unconfigured.configured).toBe(false);
      expect(unconfigured.active).toBe(false);
      expect(unconfigured.ready).toBe(false);

      // 2. Configured but not active until both the authenticated control plane
      // and the dispatcher loop are live.
      const config = {
        reposRoot: tempRoot,
        controlPlaneUrl: 'http://localhost:8788',
        gatewayToken: GATEWAY_SECRET
      };
      const configuredOnly = await healthChecker.getReadiness(config);
      expect(configuredOnly.configured).toBe(true);
      expect(configuredOnly.active).toBe(false);

      const fetchOk: typeof fetch = async () => Response.json({ success: true, claimed: [] });
      const dispatcher = new ForgeOutboxDispatcher(config, { fetchOverride: fetchOk });
      dispatcher.startPolling(10_000);
      const active = await healthChecker.getReadiness(config, dispatcher, true, fetchOk);
      dispatcher.stopPolling();
      expect(active.configured).toBe(true);
      expect(active.active).toBe(true);
      expect(active.ready).toBe(true);
      expect(active.checks.git.available).toBe(true);
      expect(active.checks.storage.writable).toBe(true);
      expect(active.checks.transport).toEqual(expect.objectContaining({
        protocol: 'ssh', configured: false, active: false
      }));
    });

    it('reports the externally reachable SSH proxy port instead of the internal listener port', async () => {
      const checker = new GatewayHealthChecker();
      checker.setTransportStatus({
        protocol: 'ssh', configured: true, active: true,
        host: 'forge.proxy.example', port: 10609
      });
      const config = {
        reposRoot: tempRoot,
        controlPlaneUrl: 'http://localhost:8788',
        gatewayToken: GATEWAY_SECRET,
        sshEnabled: true,
        sshHost: 'forge.proxy.example',
        sshPort: 2222,
        sshPublicPort: 10609
      };
      const fetchOk: typeof fetch = async () => Response.json({ success: true, claimed: [] });
      const dispatcher = new ForgeOutboxDispatcher(config, { fetchOverride: fetchOk });
      dispatcher.startPolling(10_000);
      const readiness = await checker.getReadiness(config, dispatcher, true, fetchOk);
      dispatcher.stopPolling();
      expect(readiness.checks.transport).toEqual(expect.objectContaining({
        active: true, host: 'forge.proxy.example', port: 10609
      }));
    });
  });

  // =========================================================================
  // 10. BACKOFF EXPONENTIAL CALCULATION
  // =========================================================================
  describe('10. Exponential Backoff Schedule', () => {
    it('computes exponential bounded backoff correctly', () => {
      expect(calculateBackoffSeconds(1, 2, 300)).toBe(2);
      expect(calculateBackoffSeconds(2, 2, 300)).toBe(4);
      expect(calculateBackoffSeconds(3, 2, 300)).toBe(8);
      expect(calculateBackoffSeconds(4, 2, 300)).toBe(16);
      expect(calculateBackoffSeconds(5, 2, 300)).toBe(32);
      expect(calculateBackoffSeconds(10, 2, 300)).toBe(300); // Capped at max 300s
    });
  });
});
