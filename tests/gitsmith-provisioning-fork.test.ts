import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';
import * as gitApi from '../functions/api/git';
import { hashSessionToken } from '../functions/api/_session';

const OID_1 = '1111111111111111111111111111111111111111';
const OID_2 = '2222222222222222222222222222222222222222';
const OID_3 = '3333333333333333333333333333333333333333';
const OID_SHA256 = '4444444444444444444444444444444444444444444444444444444444444444';

const GATEWAY_SECRET = 'secret_gateway_token_xyz_123';
const READY_GATEWAY_FETCH = async () => Response.json({
  ready: true,
  configured: true,
  active: true,
  checks: {
    git: { available: true },
    storage: { writable: true },
    controlPlane: { reachable: true },
    dispatcher: { running: true }
  }
});

describe('GITSMITH Repository Provisioning & Two-Phase Fork Lifecycle', () => {
  let ctx: TestD1Context;
  const testEnv = (extra: Record<string, unknown> = {}) => ({
    DB: ctx.d1,
    GITSMITH_GATEWAY_URL: 'https://gateway.test',
    GITSMITH_GATEWAY_FETCH: READY_GATEWAY_FETCH,
    ...extra
  });

  const createSession = async (userId: string, token: string) => {
    const tokenHash = await hashSessionToken(token);
    await ctx.d1.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(tokenHash, userId, Date.now() + 3600000).run();
  };

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });

    await createSession('usr_nate', 'session_nate');
    await createSession('usr_sam', 'session_sam');
    await createSession('usr_josh', 'session_josh');
  });

  // =========================================================================
  // 1. FIRST-RUN REPOSITORY PROVISIONING
  // =========================================================================
  describe('1. First-Run Repository Provisioning', () => {
    it('creates no repository or outbox event when gateway readiness is not proven', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_nate',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({ action: 'create-repository', slug: 'must-not-queue' })
      });

      const res = await gitApi.onRequestPost({
        request: req,
        env: testEnv({ GITSMITH_GATEWAY_FETCH: async () => { throw new Error('offline'); } })
      });
      expect(res.status).toBe(503);
      expect((await res.json() as any).error).toContain('No provisioning request was created');
      expect(await ctx.d1.prepare('SELECT id FROM repositories WHERE slug = ?').bind('must-not-queue').first()).toBeNull();
      expect(Number(await ctx.d1.prepare("SELECT COUNT(*) AS count FROM forge_outbox_events WHERE event_type = 'repository.provisioning_requested'").first('count'))).toBe(0);
    });

    it('creates a provisioning repository with server-generated ID and outbox event', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_nate',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          action: 'create-repository',
          slug: 'retro-synth',
          visibility: 'public',
          defaultRef: 'refs/heads/main',
          id: 'client_specified_id_should_be_ignored' // Caller provided ID must NOT be used
        })
      });

      const res = await gitApi.onRequestPost({
        request: req,
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      expect(res.status).toBe(201);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.repository).toBeDefined();
      expect(data.repository.id).toMatch(/^repo_[0-9a-f-]+$/);
      expect(data.repository.id).not.toBe('client_specified_id_should_be_ignored');
      expect(data.repository.slug).toBe('retro-synth');
      expect(data.repository.status).toBe('provisioning');
      expect(data.repository.storageKey).toBe(`repositories/${data.repository.id}`);
      expect(data.outboxEventId).toMatch(/^evt_/);

      // Verify row in D1 repositories table
      const repoInDb = await ctx.d1.prepare('SELECT * FROM repositories WHERE id = ?').bind(data.repository.id).first();
      expect(repoInDb).not.toBeNull();
      expect((repoInDb as any).status).toBe('provisioning');
      expect((repoInDb as any).owner_user_id).toBe('usr_nate');
      expect((repoInDb as any).storage_key).toBe(`repositories/${data.repository.id}`);

      // Verify membership granted to owner
      const memberInDb = await ctx.d1.prepare(
        'SELECT * FROM repository_members WHERE repository_id = ? AND user_id = ?'
      ).bind(data.repository.id, 'usr_nate').first();
      expect(memberInDb).not.toBeNull();
      expect((memberInDb as any).role).toBe('owner');

      // Verify outbox event in forge_outbox_events
      const outboxInDb = await ctx.d1.prepare('SELECT * FROM forge_outbox_events WHERE id = ?').bind(data.outboxEventId).first();
      expect(outboxInDb).not.toBeNull();
      expect((outboxInDb as any).aggregate_type).toBe('repository');
      expect((outboxInDb as any).event_type).toBe('repository.provisioning_requested');
      expect((outboxInDb as any).attempts).toBe(0);
    });

    it('handles repository creation idempotently on duplicate (owner, slug)', async () => {
      const payload = {
        action: 'create-repository',
        slug: 'dronehunter-custom',
        visibility: 'public'
      };

      const req1 = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
        body: JSON.stringify(payload)
      });
      const res1 = await gitApi.onRequestPost({ request: req1, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(res1.status).toBe(201);
      const data1 = await res1.json();

      // Second identical call
      const req2 = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
        body: JSON.stringify(payload)
      });
      const res2 = await gitApi.onRequestPost({ request: req2, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();

      expect(data2.success).toBe(true);
      expect(data2.idempotent).toBe(true);
      expect(data2.repository.id).toBe(data1.repository.id);

      // Verify only 1 row exists in DB
      const count = await ctx.d1.prepare('SELECT COUNT(*) as count FROM repositories WHERE owner_user_id = ? AND slug = ?')
        .bind('usr_nate', 'dronehunter-custom').first();
      expect((count as any).count).toBe(1);
    });
  });

  // =========================================================================
  // 2. ATOMIC SQL CAS REF PROJECTION, RECONCILIATION, AND ACTIVATION
  // =========================================================================
  describe('2. Gateway Ref Projection & Atomic SQL CAS', () => {
    let repoId: string;

    beforeEach(async () => {
      // Provision a repository
      const createReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
        body: JSON.stringify({ action: 'create-repository', slug: 'wallart-core' })
      });
      const createRes = await gitApi.onRequestPost({ request: createReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      const createData = await createRes.json();
      repoId = createData.repository.id;
    });

    it('records authoritative ref creation from gateway and activates provisioning repo', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GATEWAY_SECRET}`
        },
        body: JSON.stringify({
          action: 'gateway-record-ref',
          repositoryId: repoId,
          refName: 'refs/heads/main',
          oldOid: null,
          newOid: OID_1,
          operation: 'create',
          idempotencyKey: 'idemp_init_ref_1',
          actorUserId: 'usr_nate',
          signatureVerified: true
        })
      });

      const res = await gitApi.onRequestPost({ request: req, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(res.status).toBe(201);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.ref.commitOid).toBe(OID_1);
      expect(data.ref.version).toBe(1);
      expect(data.repositoryStatus).toBe('active');

      // Verify repository status in D1
      const repo = await ctx.d1.prepare('SELECT status FROM repositories WHERE id = ?').bind(repoId).first();
      expect((repo as any).status).toBe('active');

      // Verify repository_refs in D1
      const ref = await ctx.d1.prepare('SELECT * FROM repository_refs WHERE repository_id = ? AND ref_name = ?')
        .bind(repoId, 'refs/heads/main').first();
      expect(ref).not.toBeNull();
      expect((ref as any).commit_oid).toBe(OID_1);
      expect((ref as any).version).toBe(1);

      // Verify repository_ref_events in D1
      const event = await ctx.d1.prepare('SELECT * FROM repository_ref_events WHERE repository_id = ? AND idempotency_key = ?')
        .bind(repoId, 'idemp_init_ref_1').first();
      expect(event).not.toBeNull();
      expect((event as any).operation).toBe('create');
      expect((event as any).new_oid).toBe(OID_1);
      expect((event as any).old_oid).toBeNull();

      // Verify paired outbox events
      const outbox = await ctx.d1.prepare('SELECT * FROM forge_outbox_events WHERE aggregate_id = ? ORDER BY created_at')
        .bind(repoId).all();
      const eventTypes = outbox.results?.map((r: any) => r.event_type);
      expect(eventTypes).toContain('repository.provisioning_requested');
      expect(eventTypes).toContain('repository.ref_projected');
      expect(eventTypes).toContain('repository.activated');
    });

    it('performs CAS ref update with version increment', async () => {
      // 1. Initial ref
      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({
            action: 'gateway-record-ref',
            repositoryId: repoId,
            refName: 'refs/heads/main',
            oldOid: null,
            newOid: OID_1,
            operation: 'create',
            idempotencyKey: 'idemp_init_ref_cas'
          })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });

      // 2. Update ref with CAS
      const updateReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
        body: JSON.stringify({
          action: 'gateway-record-ref',
          repositoryId: repoId,
          refName: 'refs/heads/main',
          oldOid: OID_1,
          newOid: OID_2,
          expectedOldOid: OID_1,
          operation: 'update',
          idempotencyKey: 'idemp_update_ref_cas',
          actorUserId: 'usr_nate'
        })
      });

      const updateRes = await gitApi.onRequestPost({ request: updateReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(updateRes.status).toBe(201);
      const updateData = await updateRes.json();

      expect(updateData.success).toBe(true);
      expect(updateData.ref.commitOid).toBe(OID_2);
      expect(updateData.ref.version).toBe(2);

      const refInDb = await ctx.d1.prepare('SELECT * FROM repository_refs WHERE repository_id = ? AND ref_name = ?')
        .bind(repoId, 'refs/heads/main').first();
      expect((refInDb as any).commit_oid).toBe(OID_2);
      expect((refInDb as any).version).toBe(2);
    });

    it('rejects stale CAS update with 409, writes forge_reconciliation_issues row, and writes NO orphan ref/outbox events', async () => {
      // 1. Initial ref at OID_1
      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({
            action: 'gateway-record-ref',
            repositoryId: repoId,
            refName: 'refs/heads/main',
            oldOid: null,
            newOid: OID_1,
            operation: 'create',
            idempotencyKey: 'idemp_stale_init'
          })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });

      // Count events before stale attempt
      const eventsBefore = await ctx.d1.prepare('SELECT COUNT(*) as count FROM repository_ref_events WHERE repository_id = ?').bind(repoId).first();
      const outboxBefore = await ctx.d1.prepare('SELECT COUNT(*) as count FROM forge_outbox_events WHERE aggregate_id = ?').bind(repoId).first();

      // 2. Attempt update expecting wrong old OID
      const staleReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
        body: JSON.stringify({
          action: 'gateway-record-ref',
          repositoryId: repoId,
          refName: 'refs/heads/main',
          oldOid: OID_3,
          newOid: OID_2,
          expectedOldOid: OID_3, // Stale!
          operation: 'update',
          idempotencyKey: 'idemp_stale_fail'
        })
      });

      const staleRes = await gitApi.onRequestPost({ request: staleReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(staleRes.status).toBe(409);
      const staleData = await staleRes.json();
      expect(staleData.success).toBe(false);
      expect(staleData.error).toContain('CAS check failed');

      // Verify NO orphan ref event was written
      const eventsAfter = await ctx.d1.prepare('SELECT COUNT(*) as count FROM repository_ref_events WHERE repository_id = ?').bind(repoId).first();
      expect((eventsAfter as any).count).toBe((eventsBefore as any).count);

      // Verify NO orphan outbox event was written
      const outboxAfter = await ctx.d1.prepare('SELECT COUNT(*) as count FROM forge_outbox_events WHERE aggregate_id = ?').bind(repoId).first();
      expect((outboxAfter as any).count).toBe((outboxBefore as any).count);

      // Verify ref is still at OID_1 with version 1 (no version mutation)
      const ref = await ctx.d1.prepare('SELECT * FROM repository_refs WHERE repository_id = ? AND ref_name = ?')
        .bind(repoId, 'refs/heads/main').first();
      expect((ref as any).commit_oid).toBe(OID_1);
      expect((ref as any).version).toBe(1);

      // Verify a forge_reconciliation_issues oid_mismatch row WAS written
      const reconRow = await ctx.d1.prepare(`
        SELECT * FROM forge_reconciliation_issues
        WHERE repository_id = ? AND issue_type = 'oid_mismatch'
      `).bind(repoId).first();
      expect(reconRow).not.toBeNull();
      expect((reconRow as any).d1_oid).toBe(OID_1);
      expect((reconRow as any).status).toBe('open');
    });

    it('handles ref projection idempotently on duplicate idempotencyKey', async () => {
      const payload = {
        action: 'gateway-record-ref',
        repositoryId: repoId,
        refName: 'refs/heads/main',
        oldOid: null,
        newOid: OID_1,
        operation: 'create',
        idempotencyKey: 'idemp_duplicate_test'
      };

      const res1 = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify(payload)
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      expect(res1.status).toBe(201);

      const res2 = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify(payload)
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.success).toBe(true);
      expect(data2.idempotent).toBe(true);

      // Verify single event row in DB
      const eventRows = await ctx.d1.prepare('SELECT * FROM repository_ref_events WHERE repository_id = ? AND idempotency_key = ?')
        .bind(repoId, 'idemp_duplicate_test').all();
      expect(eventRows.results?.length).toBe(1);
    });
  });

  // =========================================================================
  // 3. AUTHENTICATION SEPARATION & BOUNDARIES
  // =========================================================================
  describe('3. Authentication Separation & Boundaries', () => {
    it('rejects user session tokens from accessing gateway actions with 403', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_nate' // User session, NOT gateway secret!
        },
        body: JSON.stringify({
          action: 'gateway-record-ref',
          repositoryId: 'repo_any',
          refName: 'refs/heads/main',
          newOid: OID_1,
          idempotencyKey: 'idemp_unauthorized'
        })
      });

      const res = await gitApi.onRequestPost({
        request: req,
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('User session tokens cannot authorize gateway');
    });

    it('fails safely with 500 when GITSMITH_GATEWAY_TOKEN is not configured', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GATEWAY_SECRET}`
        },
        body: JSON.stringify({
          action: 'gateway-record-ref',
          repositoryId: 'repo_any',
          refName: 'refs/heads/main',
          newOid: OID_1,
          idempotencyKey: 'idemp_unconfigured'
        })
      });

      const res = await gitApi.onRequestPost({
        request: req,
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: undefined }) // No token configured!
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain('GITSMITH_GATEWAY_TOKEN must be configured');
    });

    it('rejects missing or invalid gateway token with 401', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong_token_xyz'
        },
        body: JSON.stringify({
          action: 'gateway-record-ref',
          repositoryId: 'repo_any',
          refName: 'refs/heads/main',
          newOid: OID_1,
          idempotencyKey: 'idemp_unauthorized'
        })
      });

      const res = await gitApi.onRequestPost({
        request: req,
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid GITSMITH gateway token');
    });

    it('retains 501 rejection for user ref-update/push/cas requests', async () => {
      for (const forbiddenAction of ['ref-update', 'push', 'cas']) {
        const req = new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
          body: JSON.stringify({
            action: forbiddenAction,
            repositoryId: 'repo_any',
            ref: 'refs/heads/main',
            newSha: OID_1
          })
        });

        const res = await gitApi.onRequestPost({
          request: req,
          env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
        });
        expect(res.status).toBe(501);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error).toContain('Ref mutation is accepted only from the authenticated GITSMITH gateway');
      }
    });

    it('rejects unsupported actions and aliases with 400', async () => {
      const unsupportedActions = ['record-ref', 'confirm-fork', 'create_repository', 'request-fork', 'unknown-action'];
      for (const badAction of unsupportedActions) {
        const req = new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
          body: JSON.stringify({ action: badAction })
        });
        const res = await gitApi.onRequestPost({ request: req, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain('Supported control-plane actions');
      }
    });
  });

  // =========================================================================
  // 4. TWO-PHASE FORK LIFECYCLE & PINNED CONFIRMATION
  // =========================================================================
  describe('4. Reachable Two-Phase Fork Lifecycle', () => {
    let parentRepoId: string;

    beforeEach(async () => {
      // Create and activate parent repository
      const createReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
        body: JSON.stringify({ action: 'create-repository', slug: 'wallart-genesis' })
      });
      const createRes = await gitApi.onRequestPost({ request: createReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      const createData = await createRes.json();
      parentRepoId = createData.repository.id;

      // Seed parent ref via gateway to make parent active
      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({
            action: 'gateway-record-ref',
            repositoryId: parentRepoId,
            refName: 'refs/heads/main',
            oldOid: null,
            newOid: OID_1,
            operation: 'create',
            idempotencyKey: 'parent_init_oid1'
          })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
    });

    it('rejects fork request if parent repository is not active (provisioning parent)', async () => {
      // Create an un-activated provisioning repository
      const provRes = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
          body: JSON.stringify({ action: 'create-repository', slug: 'unactivated-repo' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      const provId = (await provRes.json()).repository.id;

      const forkReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_sam', Origin: 'http://localhost' },
        body: JSON.stringify({ action: 'fork', parentRepositoryId: provId, childSlug: 'sam-fork-fail' })
      });
      const forkRes = await gitApi.onRequestPost({ request: forkReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(forkRes.status).toBe(409);
      const data = await forkRes.json();
      expect(data.error).toContain('Parent repository must be active');
    });

    it('executes full Phase 1 (Fork Request) and Phase 2 (Gateway Confirmation)', async () => {
      // PHASE 1: User Sam requests a fork
      const forkReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer session_sam',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          action: 'fork',
          parentRepositoryId: parentRepoId,
          childSlug: 'wallart-sam-mod',
          parentRefName: 'refs/heads/main'
        })
      });

      const forkRes = await gitApi.onRequestPost({ request: forkReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(forkRes.status).toBe(201);
      const forkData = await forkRes.json();

      expect(forkData.success).toBe(true);
      expect(forkData.repository.status).toBe('provisioning');
      expect(forkData.repository.ownerUserId).toBe('usr_sam');
      expect(forkData.forkRequest.parentCommitOid).toBe(OID_1);
      expect(forkData.forkRequest.lineageRootRepositoryId).toBe(parentRepoId);
      expect(forkData.forkRequest.depth).toBe(1);

      const childRepoId = forkData.repository.id;

      // Verify outbox event for fork request
      const forkOutbox = await ctx.d1.prepare('SELECT * FROM forge_outbox_events WHERE id = ?').bind(forkData.outboxEventId).first();
      expect(forkOutbox).not.toBeNull();
      expect((forkOutbox as any).event_type).toBe('repository.fork_requested');

      // PHASE 2: Gateway confirms fork
      const confirmReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GATEWAY_SECRET}`
        },
        body: JSON.stringify({
          action: 'gateway-confirm-fork',
          childRepositoryId: childRepoId,
          parentRepositoryId: parentRepoId,
          parentRefName: 'refs/heads/main',
          parentCommitOid: OID_1,
          childInitialCommitOid: OID_1,
          idempotencyKey: 'idemp_confirm_fork_1',
          actorUserId: 'usr_sam'
        })
      });

      const confirmRes = await gitApi.onRequestPost({ request: confirmReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(confirmRes.status).toBe(201);
      const confirmData = await confirmRes.json();

      expect(confirmData.success).toBe(true);
      expect(confirmData.status).toBe('active');

      // Verify immutable repository_forks row in D1
      const forkRow = await ctx.d1.prepare('SELECT * FROM repository_forks WHERE child_repository_id = ?').bind(childRepoId).first();
      expect(forkRow).not.toBeNull();
      expect((forkRow as any).parent_repository_id).toBe(parentRepoId);
      expect((forkRow as any).parent_commit_oid).toBe(OID_1);
      expect((forkRow as any).child_initial_commit_oid).toBe(OID_1);
      expect((forkRow as any).lineage_root_repository_id).toBe(parentRepoId);
      expect((forkRow as any).depth).toBe(1);

      // Verify child ref in repository_refs
      const childRef = await ctx.d1.prepare('SELECT * FROM repository_refs WHERE repository_id = ? AND ref_name = ?')
        .bind(childRepoId, 'refs/heads/main').first();
      expect(childRef).not.toBeNull();
      expect((childRef as any).commit_oid).toBe(OID_1);
      expect((childRef as any).version).toBe(1);

      // Verify child repository is active
      const childRepo = await ctx.d1.prepare('SELECT status FROM repositories WHERE id = ?').bind(childRepoId).first();
      expect((childRepo as any).status).toBe('active');
    });

    it('returns existing pending fork request idempotently when retrying fork request', async () => {
      // 1. Initial fork request
      const forkReq1 = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_sam', Origin: 'http://localhost' },
        body: JSON.stringify({ action: 'fork', parentRepositoryId: parentRepoId, childSlug: 'idemp-fork-slug' })
      });
      const res1 = await gitApi.onRequestPost({ request: forkReq1, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(res1.status).toBe(201);
      const data1 = await res1.json();

      // 2. Retry before gateway confirmation (still provisioning)
      const forkReq2 = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_sam', Origin: 'http://localhost' },
        body: JSON.stringify({ action: 'fork', parentRepositoryId: parentRepoId, childSlug: 'idemp-fork-slug' })
      });
      const res2 = await gitApi.onRequestPost({ request: forkReq2, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();

      expect(data2.success).toBe(true);
      expect(data2.idempotent).toBe(true);
      expect(data2.repository.id).toBe(data1.repository.id);
      expect(data2.forkRequest.parentRepositoryId).toBe(parentRepoId);
    });

    it('rejects gateway-confirm-fork when confirmation parameters mismatch pinned outbox request', async () => {
      // 1. Request fork
      const forkReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_sam', Origin: 'http://localhost' },
        body: JSON.stringify({ action: 'fork', parentRepositoryId: parentRepoId, childSlug: 'mismatch-check' })
      });
      const forkRes = await gitApi.onRequestPost({ request: forkReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      const childId = (await forkRes.json()).repository.id;

      // 2. Attempt confirm with mismatching parentCommitOid vs pinned request (OID_2 instead of pinned OID_1)
      const badConfirmReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
        body: JSON.stringify({
          action: 'gateway-confirm-fork',
          childRepositoryId: childId,
          parentRepositoryId: parentRepoId,
          parentRefName: 'refs/heads/main',
          parentCommitOid: OID_2, // Mismatch!
          childInitialCommitOid: OID_2,
          idempotencyKey: 'idemp_mismatch_oid'
        })
      });

      const badConfirmRes = await gitApi.onRequestPost({ request: badConfirmReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(badConfirmRes.status).toBe(409);
      const data = await badConfirmRes.json();
      expect(data.error).toContain('does not match pinned fork request');

      // 3. Attempt confirm with unequal parentCommitOid and childInitialCommitOid
      const unequalOidReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
        body: JSON.stringify({
          action: 'gateway-confirm-fork',
          childRepositoryId: childId,
          parentRepositoryId: parentRepoId,
          parentRefName: 'refs/heads/main',
          parentCommitOid: OID_1,
          childInitialCommitOid: OID_2, // Unequal!
          idempotencyKey: 'idemp_unequal'
        })
      });
      const unequalRes = await gitApi.onRequestPost({ request: unequalOidReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(unequalRes.status).toBe(400);
      expect((await unequalRes.json()).error).toContain('Child initial commit OID must match parent');
    });

    it('enforces immutability triggers on repository_forks (rejects UPDATE/DELETE)', async () => {
      // Create child and confirm fork
      const childRepoId = 'repo_immutable_child';
      await ctx.d1.prepare(`
        INSERT INTO repositories (id, owner_user_id, slug, visibility, storage_key, status)
        VALUES (?, 'usr_sam', 'immutable-child', 'public', 'repositories/repo_immutable_child', 'active')
      `).bind(childRepoId).run();

      await ctx.d1.prepare(`
        INSERT INTO repository_forks (
          child_repository_id, parent_repository_id, forked_by_user_id,
          parent_ref_name, parent_commit_oid, child_initial_commit_oid,
          lineage_root_repository_id, depth
        ) VALUES (?, ?, 'usr_sam', 'refs/heads/main', ?, ?, ?, 1)
      `).bind(childRepoId, parentRepoId, OID_1, OID_1, parentRepoId).run();

      // Try updating depth -> trigger abort
      await expect(
        ctx.d1.prepare('UPDATE repository_forks SET depth = 5 WHERE child_repository_id = ?').bind(childRepoId).run()
      ).rejects.toThrow(/immutable/i);

      // Try deleting fork row -> trigger abort
      await expect(
        ctx.d1.prepare('DELETE FROM repository_forks WHERE child_repository_id = ?').bind(childRepoId).run()
      ).rejects.toThrow(/immutable/i);
    });
  });

  // =========================================================================
  // 5. GRANDCHILD LINEAGE DEPTH & ROOT PINNING
  // =========================================================================
  describe('5. Grandchild Lineage Depth & Root Pinning', () => {
    it('correctly derives lineage root and increments depth from pinned server payload', async () => {
      // 1. Root repository (Nate)
      const rootRes = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
          body: JSON.stringify({ action: 'create-repository', slug: 'root-engine' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      const rootId = (await rootRes.json()).repository.id;

      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({
            action: 'gateway-record-ref',
            repositoryId: rootId,
            refName: 'refs/heads/main',
            newOid: OID_1,
            operation: 'create',
            idempotencyKey: 'idemp_root_ref'
          })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });

      // 2. Child repository (Sam, Depth 1)
      const childRes = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_sam', Origin: 'http://localhost' },
          body: JSON.stringify({ action: 'fork', parentRepositoryId: rootId, childSlug: 'child-engine' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      const childData = await childRes.json();
      const childId = childData.repository.id;
      expect(childData.forkRequest.depth).toBe(1);
      expect(childData.forkRequest.lineageRootRepositoryId).toBe(rootId);

      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({
            action: 'gateway-confirm-fork',
            childRepositoryId: childId,
            parentRepositoryId: rootId,
            parentRefName: 'refs/heads/main',
            parentCommitOid: OID_1,
            childInitialCommitOid: OID_1,
            idempotencyKey: 'idemp_child_confirm',
            actorUserId: 'usr_sam'
          })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });

      // Advance child ref to OID_2
      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({
            action: 'gateway-record-ref',
            repositoryId: childId,
            refName: 'refs/heads/main',
            oldOid: OID_1,
            newOid: OID_2,
            operation: 'update',
            idempotencyKey: 'idemp_child_advance'
          })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });

      // 3. Grandchild repository (Josh, Depth 2, Root = Root Engine)
      const grandRes = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_josh', Origin: 'http://localhost' },
          body: JSON.stringify({ action: 'fork', parentRepositoryId: childId, childSlug: 'grandchild-engine' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      const grandData = await grandRes.json();
      const grandId = grandData.repository.id;

      expect(grandData.forkRequest.depth).toBe(2);
      expect(grandData.forkRequest.lineageRootRepositoryId).toBe(rootId);
      expect(grandData.forkRequest.parentCommitOid).toBe(OID_2);

      // Confirm grandchild - root/depth are derived server-side from pinned outbox request
      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({
            action: 'gateway-confirm-fork',
            childRepositoryId: grandId,
            parentRepositoryId: childId,
            parentRefName: 'refs/heads/main',
            parentCommitOid: OID_2,
            childInitialCommitOid: OID_2,
            idempotencyKey: 'idemp_grand_confirm',
            actorUserId: 'usr_josh'
          })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });

      // Verify Grandchild in D1
      const grandFork = await ctx.d1.prepare('SELECT * FROM repository_forks WHERE child_repository_id = ?').bind(grandId).first();
      expect(grandFork).not.toBeNull();
      expect((grandFork as any).parent_repository_id).toBe(childId);
      expect((grandFork as any).lineage_root_repository_id).toBe(rootId);
      expect((grandFork as any).depth).toBe(2);
      expect((grandFork as any).parent_commit_oid).toBe(OID_2);
      expect((grandFork as any).child_initial_commit_oid).toBe(OID_2);
    });
  });

  // =========================================================================
  // 6. VISIBILITY, UNLISTED OMISSIONS, AND ACCESS CONTROL
  // =========================================================================
  describe('6. Visibility Rules, Unlisted Handling, and Direct Access', () => {
    let privateRepoId: string;
    let unlistedRepoId: string;
    let publicRepoId: string;

    beforeEach(async () => {
      // Private repo
      const resPriv = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
          body: JSON.stringify({ action: 'create-repository', slug: 'secret-kernel', visibility: 'private' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      privateRepoId = (await resPriv.json()).repository.id;
      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({ action: 'gateway-record-ref', repositoryId: privateRepoId, refName: 'refs/heads/main', newOid: OID_1, idempotencyKey: 'priv_init' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });

      // Unlisted repo
      const resUnlisted = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
          body: JSON.stringify({ action: 'create-repository', slug: 'unlisted-plugin', visibility: 'unlisted' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      unlistedRepoId = (await resUnlisted.json()).repository.id;
      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({ action: 'gateway-record-ref', repositoryId: unlistedRepoId, refName: 'refs/heads/main', newOid: OID_1, idempotencyKey: 'unlisted_init' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });

      // Public repo
      const resPub = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
          body: JSON.stringify({ action: 'create-repository', slug: 'public-lib', visibility: 'public' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      publicRepoId = (await resPub.json()).repository.id;
      await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
          body: JSON.stringify({ action: 'gateway-record-ref', repositoryId: publicRepoId, refName: 'refs/heads/main', newOid: OID_1, idempotencyKey: 'pub_init' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
    });

    it('guards private repository detail: 401 for unauthenticated, 403 for non-members, 200 for owner', async () => {
      // Unauthenticated
      const unauthReq = new Request(`http://localhost/api/git?id=${privateRepoId}`, { method: 'GET' });
      const unauthRes = await gitApi.onRequestGet({ request: unauthReq, env: testEnv() });
      expect(unauthRes.status).toBe(401);

      // Non-member Sam
      const nonMemberReq = new Request(`http://localhost/api/git?id=${privateRepoId}`, {
        method: 'GET',
        headers: { Authorization: 'Bearer session_sam' }
      });
      const nonMemberRes = await gitApi.onRequestGet({ request: nonMemberReq, env: testEnv() });
      expect(nonMemberRes.status).toBe(403);

      // Owner Nate
      const ownerReq = new Request(`http://localhost/api/git?id=${privateRepoId}`, {
        method: 'GET',
        headers: { Authorization: 'Bearer session_nate' }
      });
      const ownerRes = await gitApi.onRequestGet({ request: ownerReq, env: testEnv() });
      expect(ownerRes.status).toBe(200);
      const ownerData = await ownerRes.json();
      expect(ownerData.success).toBe(true);
      expect(ownerData.repository.slug).toBe('secret-kernel');
      expect(ownerData.repository.memberRole).toBe('owner');
    });

    it('allows direct access to unlisted repository by ID/slug, but omits it from unauthenticated collection query', async () => {
      // Direct access allowed for unauthenticated user
      const directReq = new Request(`http://localhost/api/git?id=${unlistedRepoId}`, { method: 'GET' });
      const directRes = await gitApi.onRequestGet({ request: directReq, env: testEnv() });
      expect(directRes.status).toBe(200);
      const directData = await directRes.json();
      expect(directData.repository.slug).toBe('unlisted-plugin');

      // Unauthenticated collection query omits unlisted repository
      const unauthCollReq = new Request('http://localhost/api/git?list=1', { method: 'GET' });
      const unauthCollRes = await gitApi.onRequestGet({ request: unauthCollReq, env: testEnv() });
      const unauthCollData = await unauthCollRes.json();
      const listedIds = unauthCollData.repositories.map((r: any) => r.id);
      expect(listedIds).toContain(publicRepoId);
      expect(listedIds).not.toContain(unlistedRepoId); // OMITTED!
      expect(listedIds).not.toContain(privateRepoId);  // OMITTED!
      const publicProjection = unauthCollData.repositories.find((r: any) => r.id === publicRepoId);
      expect(publicProjection.ownerUsername).toBe('nate');
      expect(Number(publicProjection.forkCount)).toBe(0);
      expect(publicProjection.defaultCommitOid).toMatch(/^[0-9a-f]{40}$/);

      // Non-member authenticated collection query also omits unlisted repository
      const samCollReq = new Request('http://localhost/api/git?list=1', {
        method: 'GET',
        headers: { Authorization: 'Bearer session_sam' }
      });
      const samCollRes = await gitApi.onRequestGet({ request: samCollReq, env: testEnv() });
      const samCollData = await samCollRes.json();
      const samListedIds = samCollData.repositories.map((r: any) => r.id);
      expect(samListedIds).toContain(publicRepoId);
      expect(samListedIds).not.toContain(unlistedRepoId); // OMITTED!
      expect(samListedIds).not.toContain(privateRepoId);  // OMITTED!

      // Owner authenticated collection query DOES include unlisted and private repositories
      const nateCollReq = new Request('http://localhost/api/git?list=1', {
        method: 'GET',
        headers: { Authorization: 'Bearer session_nate' }
      });
      const nateCollRes = await gitApi.onRequestGet({ request: nateCollReq, env: testEnv() });
      const nateCollData = await nateCollRes.json();
      const nateListedIds = nateCollData.repositories.map((r: any) => r.id);
      expect(nateListedIds).toContain(publicRepoId);
      expect(nateListedIds).toContain(unlistedRepoId);
      expect(nateListedIds).toContain(privateRepoId);
    });

    it('rejects fork request of private repository by non-member with 403', async () => {
      const req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_sam', Origin: 'http://localhost' },
        body: JSON.stringify({ action: 'fork', parentRepositoryId: privateRepoId, childSlug: 'sam-stolen-fork' })
      });

      const res = await gitApi.onRequestPost({ request: req, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Parent repository is not accessible');
    });
  });

  // =========================================================================
  // 7. INPUT VALIDATION (FULL OIDS, LOWERCASE SLUGS, REFS)
  // =========================================================================
  describe('7. Input Validation & Constraints', () => {
    it('rejects short SHA or invalid OID in gateway projection and fork confirmation', async () => {
      // Create repo
      const createRes = await gitApi.onRequestPost({
        request: new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
          body: JSON.stringify({ action: 'create-repository', slug: 'val-test', objectFormat: 'sha256' })
        }),
        env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET })
      });
      const repoId = (await createRes.json()).repository.id;

      // Short SHA-1 (7 chars) -> rejected
      const shortShaReq = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
        body: JSON.stringify({
          action: 'gateway-record-ref',
          repositoryId: repoId,
          refName: 'refs/heads/main',
          newOid: '5c030af', // Short SHA
          idempotencyKey: 'idemp_short'
        })
      });
      const shortShaRes = await gitApi.onRequestPost({ request: shortShaReq, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(shortShaRes.status).toBe(400);
      const shortShaData = await shortShaRes.json();
      expect(shortShaData.error).toContain('Git object ID');

      // Full 64-char SHA-256 -> accepted
      const sha256Req = new Request('http://localhost/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GATEWAY_SECRET}` },
        body: JSON.stringify({
          action: 'gateway-record-ref',
          repositoryId: repoId,
          refName: 'refs/heads/main',
          newOid: OID_SHA256,
          idempotencyKey: 'idemp_sha256'
        })
      });
      const sha256Res = await gitApi.onRequestPost({ request: sha256Req, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
      expect(sha256Res.status).toBe(201);
    });

    it('rejects uppercase or invalid repository slugs during creation', async () => {
      const invalidSlugs = ['MyApp', 'My_Repo', 'UPPERCASE', '', '-leading-dash', 'trailing-dot.', 'repo.git', 'has spaces', 'has..dots'];
      for (const badSlug of invalidSlugs) {
        const req = new Request('http://localhost/api/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session_nate', Origin: 'http://localhost' },
          body: JSON.stringify({ action: 'create-repository', slug: badSlug })
        });
        const res = await gitApi.onRequestPost({ request: req, env: testEnv({ GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET }) });
        expect(res.status).toBe(400);
      }
    });
  });
});
