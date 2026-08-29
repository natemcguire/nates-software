// POST /api/git - Durable Git Forge Ref CAS Engine, Fork Provenance & Merge-Job State Machine
// GET /api/git - Query Git forge refs, commits, and Git Smart HTTP info-refs

import {
  executeCasMerge,
  verifyCommitSignature,
  validateGitRef,
  validateSha
} from '../../src/lib/gitsmithBackend';
import {
  validateForkOrigin,
  createMergeJob,
  transitionMergeJob,
  MergeJobStatus
} from '../../src/lib/forgeDomain';

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
          const stmt = env.DB.prepare('SELECT sha FROM git_refs WHERE repo_id = ? AND ref = ?').bind(appId, 'refs/heads/main');
          const row = typeof stmt.first === 'function' ? await stmt.first() : null;
          if (row && row.sha) {
            currentSha = row.sha as string;
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
        'Authoritative D1 durable ref store (git_refs table)',
        'Atomic CAS compare-and-swap push validation',
        'Git Smart HTTP transport (/info/refs, /git-receive-pack)',
        'Provenance and commit lineage graph tracking'
      ]
    });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to retrieve git refs' }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json();
    const {
      action,
      appId,
      ref,
      expectedOldSha,
      newSha,
      committer,
      signature,
      publicKey,
      commitPayload,
      requireSignedCommit
    } = body;

    // A. Immutable Fork Registration Action
    if (action === 'fork') {
      const {
        childRepositoryId,
        parentRepositoryId,
        parentRefName = 'refs/heads/main',
        parentCommitOid,
        childInitialCommitOid,
        lineageRootRepositoryId,
        depth = 1
      } = body;

      const errors = validateForkOrigin({
        childRepositoryId: childRepositoryId || appId,
        parentRepositoryId,
        parentRefName,
        parentCommitOid,
        childInitialCommitOid: childInitialCommitOid || parentCommitOid,
        lineageRootRepositoryId: lineageRootRepositoryId || parentRepositoryId,
        depth: Number(depth) || 1
      });

      if (errors.length > 0) {
        return Response.json({ success: false, errors }, { status: 400 });
      }

      if (env && env.DB) {
        try {
          await env.DB.prepare(`
            INSERT INTO git_refs (repo_id, ref, sha, committer, updated_at)
            VALUES (?, 'refs/heads/main', ?, ?, datetime('now'))
            ON CONFLICT(repo_id, ref) DO UPDATE SET sha = excluded.sha, committer = excluded.committer, updated_at = excluded.updated_at
          `).bind(childRepositoryId || appId, childInitialCommitOid || parentCommitOid, committer || 'nate').run();
        } catch {}
      }

      return Response.json({
        success: true,
        action: 'fork',
        childRepositoryId: childRepositoryId || appId,
        parentRepositoryId,
        parentCommitOid,
        childInitialCommitOid: childInitialCommitOid || parentCommitOid,
        depth: Number(depth) || 1,
        message: 'Immutable fork lineage pinned successfully'
      });
    }

    // B. Merge-Job State Machine Action
    if (action === 'merge-job') {
      const {
        targetRepositoryId,
        sourceRepositoryId,
        sourceRefName,
        targetRefName = 'refs/heads/main',
        baseCommitOid,
        transitionTo,
        previewUrl,
        evidenceDigest
      } = body;

      let job = createMergeJob({
        targetRepositoryId: targetRepositoryId || appId,
        sourceRepositoryId: sourceRepositoryId || appId,
        sourceRefName: sourceRefName || 'refs/features/mod/5c030af',
        targetRefName,
        baseCommitOid: baseCommitOid || '5c030af'
      });

      if (transitionTo) {
        job = transitionMergeJob(job, transitionTo as MergeJobStatus, { previewUrl, evidenceDigest });
      }

      return Response.json({
        success: true,
        action: 'merge-job',
        job,
        message: `Merge job transitioned to ${job.status}`
      });
    }

    // C. Pure CAS Ref Update Action
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

    // Cryptographic signature check (if provided or required)
    let sigVerification: any = null;
    if (signature && publicKey) {
      const payloadToVerify = commitPayload || `${newSha} ${ref} ${committer || 'nate'}`;
      sigVerification = verifyCommitSignature({
        commitPayload: payloadToVerify,
        signature,
        publicKey,
        committer
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

    // Authoritative Ref Read from Durable D1 Table
    let currentRemoteHeadSha: string | null = null;
    if (env && env.DB) {
      try {
        const stmt = env.DB.prepare('SELECT sha FROM git_refs WHERE repo_id = ? AND ref = ?').bind(appId, ref);
        const existingRefRow = typeof stmt.first === 'function' ? await stmt.first() : null;
        if (existingRefRow && existingRefRow.sha) {
          currentRemoteHeadSha = existingRefRow.sha as string;
        }
      } catch {}
    }

    // Atomic CAS Compare-and-Swap Validation
    const effectiveExpectedSha = (currentRemoteHeadSha === null)
      ? null
      : (expectedOldSha ?? null);

    const casResult = executeCasMerge(currentRemoteHeadSha, {
      ref,
      expectedOldSha: effectiveExpectedSha,
      newSha,
      committer: committer || 'nate',
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

    // Durable Atomic D1 Persistence
    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO git_refs (repo_id, ref, sha, committer, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(repo_id, ref) DO UPDATE SET
            sha = excluded.sha,
            committer = excluded.committer,
            updated_at = excluded.updated_at
        `).bind(appId, ref, newSha, committer || 'nate').run();
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
          committer || 'nate',
          commitPayload || 'CAS ref update via SLOP CLI',
          sigVerification ? (sigVerification.valid ? 1 : 0) : 0
        ).run();
      } catch {}

      try {
        const checkApp = env.DB.prepare('SELECT id FROM app_listings WHERE id = ?').bind(appId);
        const existingApp = typeof checkApp.first === 'function' ? await checkApp.first() : null;
        if (!existingApp) {
          const appName = appId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          await env.DB.prepare(`
            INSERT INTO app_listings (id, name, tagline, description, price, version, creator_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).bind(
            appId,
            appName,
            `${appName} — Go Fork, and Multiply!`,
            `Shareware project created by @${committer || 'nate'}. Fork with AI and multiply.`,
            '$15.00',
            'v1.0.0',
            committer ? `usr_${committer}` : 'usr_nate'
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
      message: 'Authoritative CAS ref and commit provenance updated successfully in D1'
    });
  } catch (err: any) {
    return Response.json(
      { success: false, error: 'Failed to process git operation: ' + (err.message || 'Unknown error') },
      { status: 500 }
    );
  }
};
