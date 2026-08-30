import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as inboxApi from '../functions/api/inbox';
import * as gitApi from '../functions/api/git';
import { AuthProvider } from '../src/context/AuthContext';
import { InboxView } from '../src/views/InboxView';
import {
  initBareRepo,
  getProposalDiff,
  updateAuthoritativeRefCas,
  readAuthoritativeRef,
  parseUnifiedDiff
} from '../src/lib/gitsmith/gitStorage';
import { formatProposalStatus } from '../src/lib/inboxDomain';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

const authHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' };

describe('Wave 2 — Real GitHub-Style PR Flow in INBOX', () => {
  let ctx: TestD1Context;
  let tempDir: string;
  let reposRoot: string;
  let bareRepoPath: string;
  const storageKey = 'repositories/repo-pr-test';

  let commit1Oid: string;
  let commit2Oid: string;
  let commit3Oid: string;
  let commit4DivergedOid: string;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });

    // Create a temporary sandbox for real bare git repos
    tempDir = path.join('/tmp', `gitsmith-pr-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    reposRoot = path.join(tempDir, 'repos');
    fs.mkdirSync(reposRoot, { recursive: true });
    process.env.GITSMITH_REPOS_ROOT = reposRoot;

    // 1. Initialize bare repository on disk
    const initRes = initBareRepo(reposRoot, {
      storageKey,
      objectFormat: 'sha1',
      defaultRef: 'refs/heads/main'
    });
    expect(initRes.success).toBe(true);
    bareRepoPath = initRes.repoPath;

    // 2. Create a temporary work tree to build real commits
    const workTree = path.join(tempDir, 'worktree');
    fs.mkdirSync(workTree, { recursive: true });
    execFileSync('git', ['init', workTree], { stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Alice Submitter'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'alice@nates.software'], { cwd: workTree, stdio: 'pipe' });

    // Commit 1: Initial base commit
    fs.writeFileSync(path.join(workTree, 'README.md'), '# My Cool Project\nInitial release.\n');
    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feat: initial commit'], { cwd: workTree, stdio: 'pipe' });
    commit1Oid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    // Commit 2: Feature modification
    fs.writeFileSync(path.join(workTree, 'README.md'), '# My Cool Project\nEnhanced release with features.\n');
    fs.writeFileSync(path.join(workTree, 'feature.ts'), 'export const runFeature = () => "v1";\n');
    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feat: add runFeature helper'], { cwd: workTree, stdio: 'pipe' });
    commit2Oid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    // Commit 3: Second feature commit
    fs.writeFileSync(path.join(workTree, 'utils.ts'), 'export const format = (v: string) => v.trim();\n');
    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'refactor: add string formatting utility'], { cwd: workTree, stdio: 'pipe' });
    commit3Oid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    // Push objects to bare repo
    execFileSync('git', ['remote', 'add', 'origin', bareRepoPath], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/feature'], { cwd: workTree, stdio: 'pipe' });

    // Set main ref to commit1
    const casInit = updateAuthoritativeRefCas(reposRoot, {
      storageKey,
      refName: 'refs/heads/main',
      newOid: commit1Oid,
      expectedOldOid: null,
      operation: 'create'
    });
    expect(casInit.success).toBe(true);

    // Commit 4: Create a divergent commit on a separate worktree branch for divergence testing
    execFileSync('git', ['checkout', commit1Oid], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['checkout', '-b', 'divergent-branch'], { cwd: workTree, stdio: 'pipe' });
    fs.writeFileSync(path.join(workTree, 'CONFLICT.md'), 'Upstream changed concurrently\n');
    execFileSync('git', ['add', '.'], { cwd: workTree, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'chore: upstream target modification'], { cwd: workTree, stdio: 'pipe' });
    commit4DivergedOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workTree, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/divergent'], { cwd: workTree, stdio: 'pipe' });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 1. REAL GIT DIFF & COMMIT LIST ENGINE ON BARE REPO
  // =========================================================================
  describe('1. Real Git Diff & Commit List Engine', () => {
    it('returns real unified diff and commit list for a known multi-commit branch', () => {
      const result = getProposalDiff(reposRoot, storageKey, commit1Oid, commit3Oid);

      expect(result.success).toBe(true);
      expect(result.baseOid).toBe(commit1Oid);
      expect(result.headOid).toBe(commit3Oid);
      expect(result.isFastForward).toBe(true);
      expect(result.diverged).toBe(false);
      expect(result.aheadCount).toBe(2);
      expect(result.behindCount).toBe(0);

      // Verify commit list contains exactly Commit 2 and Commit 3
      expect(result.commits).toHaveLength(2);
      expect(result.commits[0].sha).toBe(commit3Oid);
      expect(result.commits[0].summary).toBe('refactor: add string formatting utility');
      expect(result.commits[0].authorName).toBe('Alice Submitter');
      expect(result.commits[1].sha).toBe(commit2Oid);
      expect(result.commits[1].summary).toBe('feat: add runFeature helper');

      // Verify files changed
      expect(result.filesChanged).toBe(3);
      expect(result.totalAdditions).toBeGreaterThanOrEqual(3);
      expect(result.totalDeletions).toBeGreaterThanOrEqual(1);

      const readmeFile = result.files.find(f => f.newPath === 'README.md');
      expect(readmeFile).toBeDefined();
      expect(readmeFile?.status).toBe('modified');
      expect(readmeFile?.additions).toBe(1);
      expect(readmeFile?.deletions).toBe(1);

      const featureFile = result.files.find(f => f.newPath === 'feature.ts');
      expect(featureFile).toBeDefined();
      expect(featureFile?.status).toBe('added');

      const utilsFile = result.files.find(f => f.newPath === 'utils.ts');
      expect(utilsFile).toBeDefined();
      expect(utilsFile?.status).toBe('added');

      // Verify unified diff string
      expect(result.unifiedDiff).toContain('diff --git a/README.md b/README.md');
      expect(result.unifiedDiff).toContain('+Enhanced release with features.');
      expect(result.unifiedDiff).toContain('+export const runFeature');
    });

    it('accurately parses unified diff hunks with line numbers and line types', () => {
      const samplePatch = [
        'diff --git a/hello.ts b/hello.ts',
        'index 1234567..89abcdef 100644',
        '--- a/hello.ts',
        '+++ b/hello.ts',
        '@@ -1,3 +1,4 @@',
        ' const a = 1;',
        '-const b = 2;',
        '+const b = 20;',
        '+const c = 30;',
        ' console.log(a);'
      ].join('\n');

      const files = parseUnifiedDiff(samplePatch);
      expect(files).toHaveLength(1);
      expect(files[0].newPath).toBe('hello.ts');
      expect(files[0].status).toBe('modified');
      expect(files[0].hunks).toBeDefined();
      expect(files[0].hunks).toHaveLength(1);

      const hunk = files[0].hunks![0];
      expect(hunk.oldStart).toBe(1);
      expect(hunk.newStart).toBe(1);

      const addLines = hunk.lines.filter(l => l.type === 'add');
      expect(addLines).toHaveLength(2);
      expect(addLines[0].content).toBe('const b = 20;');
      expect(addLines[0].newLineNumber).toBe(2);
      expect(addLines[0].oldLineNumber).toBeNull();

      const delLines = hunk.lines.filter(l => l.type === 'delete');
      expect(delLines).toHaveLength(1);
      expect(delLines[0].content).toBe('const b = 2;');
      expect(delLines[0].oldLineNumber).toBe(2);
      expect(delLines[0].newLineNumber).toBeNull();
    });

    it('truthfully detects divergence when base is not an ancestor of head', () => {
      // Divergent comparison: base is commit 4 (on divergent-branch), head is commit 3 (on feature-branch)
      // Both branched from commit 1
      const result = getProposalDiff(reposRoot, storageKey, commit4DivergedOid, commit3Oid);

      expect(result.success).toBe(true);
      expect(result.isFastForward).toBe(false);
      expect(result.diverged).toBe(true);
      expect(result.mergeBaseOid).toBe(commit1Oid);
      expect(result.behindCount).toBe(1); // target has 1 commit ahead of merge-base
      expect(result.aheadCount).toBe(2);  // feature has 2 commits ahead of merge-base

      // Shows status badge logic reports divergence
      const status = formatProposalStatus({
        id: 'prop-1',
        category: 'proposals',
        from: 'Alice',
        fromAvatar: '👩‍💻',
        subject: 'PR',
        time: 'now',
        body: 'PR body',
        unread: false,
        featureRef: 'refs/heads/feature',
        mergeAttemptId: 'attempt-1',
        mergeStatus: 'preview_ready',
        approvalStatus: 'unreviewed'
      }, result);

      expect(status.isDiverged).toBe(true);
      expect(status.isFastForward).toBe(false);
      expect(status.badgeLabel).toContain('Diverged');
      expect(status.description).toContain('histories have diverged');
    });

    it('returns an honest error if bare repository or commit does not exist', () => {
      const badRepoResult = getProposalDiff(reposRoot, 'repositories/nonexistent', commit1Oid, commit3Oid);
      expect(badRepoResult.success).toBe(false);
      expect(badRepoResult.error).toContain('does not exist');

      const badCommitResult = getProposalDiff(reposRoot, storageKey, commit1Oid, 'f'.repeat(40));
      expect(badCommitResult.success).toBe(false);
      expect(badCommitResult.error).toContain('does not exist');
    });
  });

  // =========================================================================
  // 2. HTTP DIFF & COMMENTS ENDPOINTS INTEGRATION
  // =========================================================================
  describe('2. HTTP Diff & Comment Endpoints', () => {
    async function seedProposalInD1() {
      await ctx.d1.prepare(`INSERT INTO repositories
        (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
        VALUES ('repo-pr','dronehunter','usr_nate','nate/dronehunter','public','refs/heads/main',?,'active')`).bind(storageKey).run();

      await ctx.d1.prepare(`INSERT INTO merge_jobs
        (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
        VALUES ('job-pr','repo-pr','refs/heads/main','usr_sam','preview_ready','pr-test-1')`).run();

      await ctx.d1.prepare(`INSERT INTO merge_attempts
        (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
        VALUES ('attempt-pr','job-pr',1,?,?,'tool-v1','policy-v1','preview_ready')`).bind(commit1Oid, commit3Oid).run();

      await ctx.d1.prepare(`INSERT INTO inbox_messages
        (id,user_id,sender_id,title,preview,content,feature_ref,cas_new_sha,is_merged,unread,message_kind,merge_attempt_id)
        VALUES ('proposal:attempt-pr','usr_nate','usr_sam','feat: add dronehunter exporter','Export PR','Please review this real diff','refs/heads/feature',?,0,1,'proposal','attempt-pr')`)
        .bind(commit3Oid).run();
    }

    it('serves real diff, commit list, and files via /api/inbox?action=diff', async () => {
      await seedProposalInD1();

      const req = new Request('http://localhost/api/inbox?action=diff&proposalId=proposal:attempt-pr', {
        headers: authHeaders
      });
      const res = await inboxApi.onRequestGet({ request: req, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.proposalId).toBe('proposal:attempt-pr');
      expect(data.baseOid).toBe(commit1Oid);
      expect(data.headOid).toBe(commit3Oid);
      expect(data.isFastForward).toBe(true);
      expect(data.commits).toHaveLength(2);
      expect(data.files).toHaveLength(3);
      expect(data.unifiedDiff).toContain('diff --git a/README.md b/README.md');
    });

    it('serves real diff via /api/git?action=diff for proposal and repo params', async () => {
      await seedProposalInD1();

      // Query by proposalId
      const req1 = new Request('http://localhost/api/git?action=diff&proposalId=proposal:attempt-pr', {
        headers: authHeaders
      });
      const res1 = await gitApi.onRequestGet({ request: req1, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
      expect(res1.status).toBe(200);
      const data1: any = await res1.json();
      expect(data1.success).toBe(true);
      expect(data1.commits).toHaveLength(2);

      // Query by repo + base + head
      const req2 = new Request(`http://localhost/api/git?action=diff&repositoryId=repo-pr&base=${commit1Oid}&head=${commit3Oid}`, {
        headers: authHeaders
      });
      const res2 = await gitApi.onRequestGet({ request: req2, env: { DB: ctx.d1, GITSMITH_REPOS_ROOT: reposRoot } });
      expect(res2.status).toBe(200);
      const data2: any = await res2.json();
      expect(data2.success).toBe(true);
      expect(data2.commits).toHaveLength(2);
    });

    it('allows reviewer and submitter to post and retrieve PR review comments', async () => {
      await seedProposalInD1();

      // 1. Post a review comment from reviewer
      const commentReq = new Request('http://localhost/api/inbox', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action: 'comment',
          messageId: 'proposal:attempt-pr',
          text: 'Great work! Could you verify the export function performance?'
        })
      });
      const commentRes = await inboxApi.onRequestPost({ request: commentReq, env: { DB: ctx.d1 } });
      expect(commentRes.status).toBe(200);
      const commentData: any = await commentRes.json();
      expect(commentData.success).toBe(true);
      expect(commentData.commentId).toBeDefined();

      // 2. Retrieve conversation messages via /api/inbox?action=comments
      const getCommentsReq = new Request('http://localhost/api/inbox?action=comments&proposalId=proposal:attempt-pr', {
        headers: authHeaders
      });
      const getCommentsRes = await inboxApi.onRequestGet({ request: getCommentsReq, env: { DB: ctx.d1 } });
      expect(getCommentsRes.status).toBe(200);
      const getCommentsData: any = await getCommentsRes.json();
      expect(getCommentsData.success).toBe(true);
      expect(getCommentsData.messages).toHaveLength(2); // Initial proposal + 1 reply
      expect(getCommentsData.messages[1].content).toBe('Great work! Could you verify the export function performance?');
    });

    it('authoritatively approves and lands PR commit OID via CAS', async () => {
      await seedProposalInD1();

      // Approve proposal
      const approveReq = new Request('http://localhost/api/inbox', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action: 'approve',
          messageId: 'proposal:attempt-pr',
          comment: 'Approved for production landing.'
        })
      });
      const approveRes = await inboxApi.onRequestPost({ request: approveReq, env: { DB: ctx.d1 } });
      expect(approveRes.status).toBe(200);
      const approveData: any = await approveRes.json();
      expect(approveData.success).toBe(true);
      expect(approveData.approvalStatus).toBe('approved');
      expect(approveData.outboxEventId).toBe('merge_land_attempt-pr');

      // Verify outbox event contains exact OID binding
      const outboxEvent: any = await ctx.d1.prepare("SELECT payload FROM forge_outbox_events WHERE id='merge_land_attempt-pr'").first();
      expect(outboxEvent).toBeDefined();
      const payload = JSON.parse(outboxEvent.payload);
      expect(payload.expectedTargetOid).toBe(commit1Oid);
      expect(payload.resultCommitOid).toBe(commit3Oid);
      expect(payload.targetRef).toBe('refs/heads/main');

      // Perform real CAS update on disk
      const casLandRes = updateAuthoritativeRefCas(reposRoot, {
        storageKey,
        refName: 'refs/heads/main',
        newOid: commit3Oid,
        expectedOldOid: commit1Oid,
        operation: 'update'
      });
      expect(casLandRes.success).toBe(true);

      // Verify authoritative ref on disk is now commit 3
      const currentRef = readAuthoritativeRef(reposRoot, storageKey, 'refs/heads/main');
      expect(currentRef).toBe(commit3Oid);
    });
  });

  // =========================================================================
  // 3. UI RENDERING AND PR TAB INTEGRATION
  // =========================================================================
  describe('3. UI Rendering & Win95 PR Layout', () => {
    it('renders the PR review interface without mocks or fake merge claims', () => {
      const html = renderToString(React.createElement(AuthProvider, null, React.createElement(InboxView)));
      expect(html).toContain('INBOX.EXE');
      expect(html).toContain('Pull Requests');
      expect(html).toContain('All Inbound');
      expect(html).toContain('GITSMITH CAS');
    });
  });
});
