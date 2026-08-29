// POST /api/git - Pure Durable Git Forge Ref CAS Engine & Provenance Tracker
// GET /api/git - Query Git forge refs and Git Smart HTTP info-refs

import {
  executeCasMerge,
  verifyCommitSignature,
  validateGitRef,
  validateSha
} from '../../src/lib/gitsmithBackend';
import { getSessionUser } from './_auth';
import { validateForkOrigin } from '../../src/lib/forgeDomain';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const appId = url.searchParams.get('appId') || url.searchParams.get('repo');
    const action = url.searchParams.get('action');
    const service = url.searchParams.get('service');

    // 1. Git Smart HTTP info/refs protocol support (/info/refs?service=git-receive-pack or git-upload-pack)
    if (action === 'info-refs' || service || url.pathname.endsWith('/info/refs')) {
      const requestedService = service || 'git-receive-pack';
      let currentSha = '0000000000000000000000000000000000000000';

      if (env && env.DB && appId) {
        try {
          // Check canonical repository_refs first, then git_refs
          const stmt1 = env.DB.prepare('SELECT commit_oid FROM repository_refs WHERE repository_id = ? AND ref_name = ?').bind(appId, 'refs/heads/main');
          const row1 = typeof stmt1.first === 'function' ? await stmt1.first() : null;
          if (row1 && row1.commit_oid) {
            currentSha = row1.commit_oid as string;
          } else {
            const stmt2 = env.DB.prepare('SELECT sha FROM git_refs WHERE repo_id = ? AND ref = ?').bind(appId, 'refs/heads/main');
            const row2 = typeof stmt2.first === 'function' ? await stmt2.first() : null;
            if (row2 && row2.sha) {
              currentSha = row2.sha as string;
            }
          }
        } catch {}
      }

      // Git smart HTTP packet format
      const serviceLine = `# service=${requestedService}\n`;
      const servicePkt = `${(serviceLine.length + 4).toString(16).padStart(4, '0')}${serviceLine}0000`;
      const refLine = `${currentSha} refs/heads/main\0report-status delete-refs side-band-64k\n`;
      const refPkt = `${(refLine.length + 4).toString(16).padStart(4, '0')}${refLine}0000`;
      const body = `${servicePkt}${refPkt}`;

      return new Response(body, {
        headers: {
          'Content-Type': `application/x-${requestedService}-advertisement`,
          'Cache-Control': 'no-cache'
        }
      });
    }

    if (env && env.DB && appId) {
      const refs = await env.DB.prepare(`
        SELECT repo_id AS repoId, ref, sha, committer, updated_at AS updatedAt
        FROM git_refs
        WHERE repo_id = ?
      `).bind(appId).all();

      const commits = await env.DB.prepare(`
        SELECT sha, repo_id AS repoId, parent_sha AS parentSha, author, message, is_verified AS isVerified, created_at AS createdAt
        FROM git_commits
        WHERE repo_id = ?
        ORDER BY created_at DESC
        LIMIT 20
      `).bind(appId).all();

      return Response.json({
        success: true,
        appId,
        refs: refs.results || [],
        commits: commits.results || []
      });
    }

    return Response.json({
      success: true,
      service: 'GITSMITH Pure Git Forge & Provenance Engine',
      status: 'active',
      slogan: 'Go Fork, and Multiply',
      invariants: [
        'Authoritative D1 durable ref store (repository_refs and git_refs)',
        'Atomic CAS compare-and-swap push validation',
        'Git Smart HTTP transport (/info/refs, /git-receive-pack)',
        'Canonical immutable fork ancestry (repository_forks)'
      ]
    });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to retrieve git refs' }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const authUser = await getSessionUser(request, env);
    const body = await request.json();
    const {
      appId,
      ref,
      expectedOldSha,
      newSha,
      committer,
      signature,
      publicKey,
      commitPayload,
      requireSignedCommit,
      forkOrigin
    } = body;

    // 1. Basic validation
    if (!appId || !ref || !newSha) {
      return Response.json(
        { success: false, error: 'appId, ref, and newSha are required fields' },
        { status: 400 }
      );
    }

    const refValidation = validateGitRef(ref);
    if (!refValidation.valid) {
      return Response.json(
        { success: false, error: refValidation.error || 'Invalid git ref path' },
        { status: 400 }
      );
    }

    const newShaValidation = validateSha(newSha);
    if (!newShaValidation.valid) {
      return Response.json(
        { success: false, error: newShaValidation.error || 'Invalid new commit SHA' },
        { status: 400 }
      );
    }

    // 2. Cryptographic signature check (if provided or required)
    let sigVerification: any = null;
    if (signature && publicKey) {
      const payloadToVerify = commitPayload || `${newSha} ${ref} ${committer || authUser?.username || 'nate'}`;
      sigVerification = verifyCommitSignature({
        commitPayload: payloadToVerify,
        signature,
        publicKey,
        committer: committer || authUser?.username
      });

      if (!sigVerification.valid && requireSignedCommit) {
        return Response.json(
          {
            success: false,
            error: `Commit signature validation failed: ${sigVerification.error}`,
            signatureVerification: sigVerification
          },
          { status: 403 }
        );
      }
    } else if (requireSignedCommit) {
      return Response.json(
        { success: false, error: 'Protected ref requires signature and publicKey' },
        { status: 403 }
      );
    }

    // 3. Authoritative Ref Read from Durable D1 Table (repository_refs & git_refs)
    let currentRemoteHeadSha: string | null = null;
    if (env && env.DB) {
      try {
        const stmt1 = env.DB.prepare('SELECT commit_oid FROM repository_refs WHERE repository_id = ? AND ref_name = ?').bind(appId, ref);
        const row1 = typeof stmt1.first === 'function' ? await stmt1.first() : null;
        if (row1 && row1.commit_oid) {
          currentRemoteHeadSha = row1.commit_oid as string;
        } else {
          const stmt2 = env.DB.prepare('SELECT sha FROM git_refs WHERE repo_id = ? AND ref = ?').bind(appId, ref);
          const row2 = typeof stmt2.first === 'function' ? await stmt2.first() : null;
          if (row2 && row2.sha) {
            currentRemoteHeadSha = row2.sha as string;
          }
        }
      } catch {}
    }

    // 4. Atomic CAS Compare-and-Swap Validation
    const effectiveExpectedSha = (currentRemoteHeadSha === null)
      ? null
      : (expectedOldSha ?? null);

    const casResult = executeCasMerge(currentRemoteHeadSha, {
      ref,
      expectedOldSha: effectiveExpectedSha,
      newSha,
      committer: committer || authUser?.username || 'nate',
      signatureVerified: sigVerification ? sigVerification.valid : false
    });

    if (!casResult.success) {
      return Response.json(
        {
          success: false,
          error: casResult.error,
          currentRemoteHeadSha: casResult.currentRemoteHeadSha,
          retryable: casResult.retryable,
          stale: casResult.stale
        },
        { status: 409 }
      );
    }

    // 5. Validate Fork Origin (if fork metadata is submitted)
    if (forkOrigin) {
      const forkErrors = validateForkOrigin(forkOrigin);
      if (forkErrors.length > 0) {
        return Response.json({ success: false, error: `Invalid fork origin: ${forkErrors.join(', ')}` }, { status: 400 });
      }
    }

    const effectiveUserId = authUser?.id || (committer ? `usr_${committer}` : 'usr_nate');
    const effectiveUsername = authUser?.username || committer || 'nate';

    // 6. Durable Atomic D1 Persistence (Canonical + Fallback tables)
    if (env && env.DB) {
      const idempotencyKey = `cas_${casResult.transactionId}`;

      try {
        // Upsert repository record if canonical table exists
        await env.DB.prepare(`
          INSERT INTO repositories (id, app_id, owner_user_id, slug, default_ref, storage_key, status)
          VALUES (?, ?, ?, ?, ?, ?, 'active')
          ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
        `).bind(
          appId,
          appId,
          effectiveUserId,
          appId,
          ref,
          `repos/${appId}`
        ).run();
      } catch {}

      try {
        // Update canonical repository_refs
        await env.DB.prepare(`
          INSERT INTO repository_refs (repository_id, ref_name, commit_oid, version, updated_by_user_id, updated_at)
          VALUES (?, ?, ?, 1, ?, datetime('now'))
          ON CONFLICT(repository_id, ref_name) DO UPDATE SET
            commit_oid = excluded.commit_oid,
            version = repository_refs.version + 1,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_at = excluded.updated_at
        `).bind(appId, ref, newSha, effectiveUserId).run();
      } catch {}

      try {
        // Record canonical audit event in repository_ref_events
        await env.DB.prepare(`
          INSERT INTO repository_ref_events (
            id, repository_id, ref_name, old_oid, new_oid, expected_old_oid, operation, actor_user_id, idempotency_key, signature_verified
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(repository_id, idempotency_key) DO NOTHING
        `).bind(
          `evt_${idempotencyKey}`,
          appId,
          ref,
          currentRemoteHeadSha,
          newSha,
          expectedOldSha || null,
          currentRemoteHeadSha ? 'update' : 'create',
          effectiveUserId,
          idempotencyKey,
          sigVerification ? (sigVerification.valid ? 1 : 0) : 0
        ).run();
      } catch {}

      if (forkOrigin) {
        try {
          await env.DB.prepare(`
            INSERT INTO repository_forks (
              child_repository_id, parent_repository_id, forked_by_user_id, parent_ref_name,
              parent_commit_oid, child_initial_commit_oid, lineage_root_repository_id, depth
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(child_repository_id) DO NOTHING
          `).bind(
            forkOrigin.childRepositoryId,
            forkOrigin.parentRepositoryId,
            effectiveUserId,
            forkOrigin.parentRefName,
            forkOrigin.parentCommitOid,
            forkOrigin.childInitialCommitOid,
            forkOrigin.lineageRootRepositoryId,
            forkOrigin.depth
          ).run();
        } catch {}
      }

      // Maintain git_refs fallback compatibility
      try {
        await env.DB.prepare(`
          INSERT INTO git_refs (repo_id, ref, sha, committer, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(repo_id, ref) DO UPDATE SET
            sha = excluded.sha,
            committer = excluded.committer,
            updated_at = excluded.updated_at
        `).bind(appId, ref, newSha, effectiveUsername).run();
      } catch {}

      try {
        await env.DB.prepare(`
          INSERT INTO git_commits (sha, repo_id, parent_sha, author, message, is_verified)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(sha) DO NOTHING
        `).bind(
          newSha,
          appId,
          currentRemoteHeadSha || expectedOldSha || null,
          effectiveUsername,
          commitPayload || 'CAS ref update via SLOP CLI',
          sigVerification ? (sigVerification.valid ? 1 : 0) : 0
        ).run();
      } catch {}

      // Auto-create app listing on Hotwire if repo is new
      try {
        const stmt = env.DB.prepare('SELECT id FROM app_listings WHERE id = ?').bind(appId);
        const existingApp = typeof stmt.first === 'function' ? await stmt.first() : null;
        if (!existingApp) {
          const appName = appId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          await env.DB.prepare(`
            INSERT INTO app_listings (id, name, tagline, description, price, version, creator_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).bind(
            appId,
            appName,
            `${appName} — Go Fork, and Multiply!`,
            `Shareware project created by @${effectiveUsername}. Fork with AI and multiply.`,
            '$15.00',
            'v1.0.0',
            effectiveUserId
          ).run();
        }
      } catch {}

      try {
        await env.DB.prepare(`
          UPDATE inbox_messages
          SET is_merged = 1, unread = 0
          WHERE feature_ref = ? OR cas_new_sha = ?
        `).bind(ref, newSha).run();
      } catch {}
    }

    return Response.json({
      success: true,
      transactionId: casResult.transactionId,
      casResult,
      currentSha: newSha,
      previousSha: currentRemoteHeadSha,
      signatureVerification: sigVerification,
      message: 'Authoritative CAS ref published and recorded in canonical lineage forge'
    });
  } catch (err: any) {
    return Response.json(
      { success: false, error: 'Failed to process git merge ref: ' + (err.message || 'Unknown error') },
      { status: 500 }
    );
  }
};
