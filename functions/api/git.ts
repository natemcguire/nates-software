// POST /api/git - Atomic CAS merge verification and 70/20/10 Lineage Royalty Settlement in Cloudflare D1
// GET /api/git - Query Git forge ref status, lineage ledger settlements, and audit records

import {
  executeCasMerge,
  createSettlementRecord,
  verifyCommitSignature,
  validateGitRef,
  validateSha,
  AncestorNode
} from '../../src/lib/gitsmithBackend';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const appId = url.searchParams.get('appId');
    const action = url.searchParams.get('action');

    if (env.DB) {
      if (appId) {
        const { results } = await env.DB.prepare(`
          SELECT 
            id, app_id AS appId, buyer_user_id AS buyerUserId,
            gross_cents AS grossCents, maker_cents AS makerCents,
            lineage_cents AS lineageCents, pool_cents AS poolCents,
            stripe_transfer_id AS stripeTransferId, settled_at AS settledAt
          FROM royalty_settlements
          WHERE app_id = ?
          ORDER BY settled_at DESC
          LIMIT 20
        `).bind(appId).all();

        return Response.json({ success: true, appId, settlements: results });
      }

      if (action === 'settlements' || !appId) {
        const { results } = await env.DB.prepare(`
          SELECT 
            id, app_id AS appId, buyer_user_id AS buyerUserId,
            gross_cents AS grossCents, maker_cents AS makerCents,
            lineage_cents AS lineageCents, pool_cents AS poolCents,
            stripe_transfer_id AS stripeTransferId, settled_at AS settledAt
          FROM royalty_settlements
          ORDER BY settled_at DESC
          LIMIT 50
        `).all();

        return Response.json({ success: true, settlements: results });
      }
    }

    return Response.json({
      success: true,
      service: 'GITSMITH Bare Forge & Lineage Ledger API',
      status: 'active',
      invariants: [
        'Atomic CAS publication boundary (refs/heads/*, refs/features/*)',
        'Multi-generational 70% Maker / 20% Ancestor / 10% Pool conservation',
        'Cryptographic Ed25519 / SSH commit signature verification',
        'Immutable DAG ancestry traversal'
      ]
    });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to retrieve git lineage settlements' }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
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
      grossCents,
      ancestors,
      distributionMethod,
      buyerUserId,
      requireSignedCommit
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

    // 3. Atomic CAS Merge Check
    // If expectedOldSha is given, verify CAS match
    const casResult = executeCasMerge(expectedOldSha ?? null, {
      ref,
      expectedOldSha: expectedOldSha ?? null,
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

    // 4. Multi-Generational Lineage Ledger Settlement Engine
    const amount = Number.isFinite(grossCents) && grossCents > 0 ? Math.floor(grossCents) : 2500;
    const ancestorList: AncestorNode[] = Array.isArray(ancestors) ? ancestors : [];

    const settlementRecord = createSettlementRecord({
      appId,
      buyerUserId: buyerUserId || 'usr_sam',
      makerId: committer ? `usr_${committer}` : 'usr_nate',
      grossCents: amount,
      ancestors: ancestorList.length > 0 ? ancestorList : 1,
      casTransactionId: casResult.transactionId,
      options: {
        distributionMethod: distributionMethod === 'decay' ? 'decay' : 'equal'
      }
    });

    // 5. Persist to Cloudflare D1 if database binding is available
    if (env && env.DB) {
      // Auto-create repository and Hotwire drop listing if repo is new
      try {
        const existing = await env.DB.prepare('SELECT id FROM app_listings WHERE id = ?').bind(appId).first();
        if (!existing) {
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

      await env.DB.prepare(`
        INSERT INTO royalty_settlements (
          id, app_id, buyer_user_id, gross_cents, maker_cents, lineage_cents, pool_cents, stripe_transfer_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        settlementRecord.id,
        appId,
        settlementRecord.buyerUserId,
        settlementRecord.grossCents,
        settlementRecord.split.makerCents,
        settlementRecord.split.lineageTotalCents,
        settlementRecord.split.poolCents,
        settlementRecord.stripeTransferId
      ).run();

      // Automatically mark matching proposal in inbox as merged
      await env.DB.prepare(`
        UPDATE inbox_messages
        SET is_merged = 1, unread = 0
        WHERE feature_ref = ? OR cas_new_sha = ?
      `).bind(ref, newSha).run();
    }

    return Response.json({
      success: true,
      settlementId: settlementRecord.id,
      transactionId: casResult.transactionId,
      casResult,
      signatureVerification: sigVerification,
      split: {
        grossCents: settlementRecord.split.grossCents,
        makerCents: settlementRecord.split.makerCents,
        lineageCents: settlementRecord.split.lineageTotalCents,
        poolCents: settlementRecord.split.poolCents,
        ancestorSplits: settlementRecord.split.ancestorSplits,
        conservationVerified: settlementRecord.split.conservationVerified
      },
      message: 'CAS merge and lineage royalties settled successfully in D1'
    });
  } catch (err: any) {
    return Response.json(
      { success: false, error: 'Failed to process git merge settlement: ' + (err.message || 'Unknown error') },
      { status: 500 }
    );
  }
};
