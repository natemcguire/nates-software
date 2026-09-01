// Authenticated mailbox, replies, and immutable merge-attempt approvals.
// GITSMITH remains the only authority that may land a Git ref.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireAuth } from './_auth';
import { getProposalDiff, resolveRepoPath } from '../../src/lib/gitsmith/gitStorage';

type D1Database = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };
type R2Bucket = { get(key: string): Promise<any> };
const jsonError = (error: string, status: number) => Response.json({ success: false, error }, { status });
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

async function sha256HexOfBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

type InboxCursor = { userId: string; createdAt: string; id: string };

function encodeCursor(cursor: InboxCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(value: string | null, userId: string): InboxCursor | null {
  if (!value) return null;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    if (parsed?.userId !== userId || typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeKind(value: unknown): 'proposals' | 'agent_logs' | 'royalties' | 'feedback' {
  if (value === 'proposal') return 'proposals';
  if (value === 'agent_log') return 'agent_logs';
  if (value === 'royalty') return 'royalties';
  return 'feedback';
}

export const onRequestGet = async ({ request, env }: { request: Request; env: { DB?: D1Database; GITSMITH_REPOS_ROOT?: string; STORAGE?: R2Bucket } }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  if (!env.DB) return jsonError('Inbox storage is unavailable', 503);
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // 0. Global Unread Count Action (lightweight badge query; never loads message bodies)
    if (action === 'unread-count') {
      const row = await env.DB.prepare(`
        SELECT COUNT(*) AS n
        FROM inbox_messages
        WHERE user_id = ? AND unread = 1 AND (sender_id IS NULL OR sender_id != ?)
      `).bind(auth.user!.id, auth.user!.id).first();
      return Response.json({ success: true, unreadCount: Number((row as any)?.n) || 0 });
    }

    // 1. Proposal Diff Action
    if (action === 'diff') {
      const proposalId = url.searchParams.get('proposalId') || url.searchParams.get('messageId') || url.searchParams.get('mergeAttemptId');
      if (!proposalId) return jsonError('proposalId is required', 400);

      const proposal = await env.DB.prepare(`
        SELECT m.id, m.user_id AS recipientId, m.sender_id AS senderId,
          m.title, m.content, m.feature_ref AS featureRef,
          m.merge_attempt_id AS mergeAttemptId,
          ma.input_target_oid AS inputTargetOid, ma.result_commit_oid AS resultCommitOid,
          ma.status AS attemptStatus,
          mj.id AS mergeJobId, mj.target_ref AS targetRef, mj.status AS jobStatus,
          mj.landed_commit_oid AS landedCommitOid,
          mj.requested_by_user_id AS requestedByUserId,
          r.id AS repositoryId, r.storage_key AS storageKey, r.slug AS repositorySlug,
          r.owner_user_id AS repositoryOwnerId,
          r.grantable_bps AS grantableBps,
          fpv.git_ref AS versionFeatureRef,
          (SELECT build.evidence_bundle_r2_key FROM build_runs build
            WHERE build.merge_attempt_id = ma.id AND build.purpose = 'verification'
              AND build.status = 'passed' AND build.commit_oid = ma.result_commit_oid
            ORDER BY build.finished_at DESC LIMIT 1) AS evidenceBundleR2Key,
          (SELECT build.evidence_bundle_sha256 FROM build_runs build
            WHERE build.merge_attempt_id = ma.id AND build.purpose = 'verification'
              AND build.status = 'passed' AND build.commit_oid = ma.result_commit_oid
            ORDER BY build.finished_at DESC LIMIT 1) AS evidenceBundleSha256
        FROM inbox_messages m
        LEFT JOIN merge_attempts ma ON ma.id = m.merge_attempt_id
        LEFT JOIN merge_jobs mj ON mj.id = ma.merge_job_id
        LEFT JOIN repositories r ON r.id = mj.target_repository_id
        LEFT JOIN feature_package_versions fpv ON fpv.id = mj.feature_version_id
        WHERE (m.id = ? OR m.merge_attempt_id = ?)
          AND (m.user_id = ? OR m.sender_id = ?)
      `).bind(proposalId, proposalId, auth.user!.id, auth.user!.id).first();

      if (!proposal) return jsonError('Proposal not found or access denied', 404);
      if (!proposal.mergeAttemptId || !proposal.resultCommitOid) {
        return jsonError('Proposal is not bound to a valid merge attempt', 400);
      }

      const reposRoot = env.GITSMITH_REPOS_ROOT || process.env.GITSMITH_REPOS_ROOT || path.resolve(process.cwd(), '.gitsmith-repos');
      const storageKey = proposal.storageKey || `repositories/${proposal.repositoryId}`;
      const baseOid = proposal.inputTargetOid;
      const headOid = proposal.resultCommitOid;

      const diffResult = getProposalDiff(reposRoot, storageKey, baseOid, headOid);

      let grantableBps = 0;
      let grantedBps = 0;
      if (proposal.repositoryId) {
        grantableBps = Number(proposal.grantableBps || 0);
        const grantedRes = await env.DB.prepare(`
          SELECT COALESCE(SUM(basis_points), 0) AS totalGrantedBps
          FROM contributor_shares
          WHERE repository_id = ? AND status IN ('active', 'pending')
        `).bind(proposal.repositoryId).first();
        grantedBps = Number(grantedRes?.totalGrantedBps || 0);
      }
      const remainingGrantableBps = Math.max(0, grantableBps - grantedBps);

      return Response.json({
        proposalId: proposal.id,
        mergeAttemptId: proposal.mergeAttemptId,
        mergeJobId: proposal.mergeJobId,
        repositorySlug: proposal.repositorySlug,
        repositoryOwnerId: proposal.repositoryOwnerId,
        targetRef: proposal.targetRef,
        featureRef: proposal.featureRef || proposal.versionFeatureRef || 'feature',
        status: proposal.jobStatus,
        attemptStatus: proposal.attemptStatus,
        landed: Boolean(proposal.jobStatus === 'landed' && proposal.landedCommitOid === proposal.resultCommitOid),
        grantableBps,
        grantable_bps: grantableBps,
        grantedBps,
        granted_bps: grantedBps,
        remainingGrantableBps,
        remaining_grantable_bps: remainingGrantableBps,
        evidenceBundleR2Key: proposal.evidenceBundleR2Key || null,
        evidenceBundleSha256: proposal.evidenceBundleSha256 || null,
        evidenceBundleAvailable: Boolean(proposal.evidenceBundleR2Key && proposal.evidenceBundleSha256),
        ...diffResult
      });
    }

    // 1b. Verification Evidence Bundle Action — streams the exact signed R2
    // object a reviewer must load before approving (see the fail-closed gate
    // in onRequestPost's approve/reject handler below).
    if (action === 'evidence') {
      const proposalId = url.searchParams.get('proposalId') || url.searchParams.get('messageId') || url.searchParams.get('mergeAttemptId');
      if (!proposalId) return jsonError('proposalId is required', 400);
      const proposal = await env.DB.prepare(`
        SELECT m.merge_attempt_id AS mergeAttemptId,
          (SELECT build.evidence_bundle_r2_key FROM build_runs build
            WHERE build.merge_attempt_id = ma.id AND build.purpose = 'verification'
              AND build.status = 'passed' AND build.commit_oid = ma.result_commit_oid
            ORDER BY build.finished_at DESC LIMIT 1) AS evidenceBundleR2Key,
          (SELECT build.evidence_bundle_sha256 FROM build_runs build
            WHERE build.merge_attempt_id = ma.id AND build.purpose = 'verification'
              AND build.status = 'passed' AND build.commit_oid = ma.result_commit_oid
            ORDER BY build.finished_at DESC LIMIT 1) AS evidenceBundleSha256
        FROM inbox_messages m
        LEFT JOIN merge_attempts ma ON ma.id = m.merge_attempt_id
        WHERE (m.id = ? OR m.merge_attempt_id = ?) AND (m.user_id = ? OR m.sender_id = ?)
      `).bind(proposalId, proposalId, auth.user!.id, auth.user!.id).first();
      if (!proposal) return jsonError('Proposal not found or access denied', 404);
      if (!proposal.evidenceBundleR2Key || !proposal.evidenceBundleSha256) {
        return jsonError('No signed verification evidence bundle is recorded for this merge attempt', 404);
      }
      if (!env.STORAGE || typeof env.STORAGE.get !== 'function') {
        return jsonError('Evidence storage (R2 STORAGE) is unavailable', 503);
      }
      const bundleObject = await env.STORAGE.get(proposal.evidenceBundleR2Key).catch(() => null);
      if (!bundleObject) return jsonError('The recorded verification evidence bundle is missing from R2', 409);
      const bundleBytes: ArrayBuffer = typeof bundleObject.arrayBuffer === 'function'
        ? await bundleObject.arrayBuffer()
        : bundleObject;
      const recomputedSha256 = `sha256:${await sha256HexOfBytes(bundleBytes)}`;
      if (recomputedSha256 !== proposal.evidenceBundleSha256) {
        return jsonError('The verification evidence bundle in R2 does not match its recorded digest', 409);
      }
      return new Response(bundleBytes, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Evidence-Bundle-Sha256': recomputedSha256 }
      });
    }

    // 2. Proposal Comments & Discussion Thread Action
    if (action === 'comments' || action === 'conversation') {
      const proposalId = url.searchParams.get('proposalId') || url.searchParams.get('messageId');
      if (!proposalId) return jsonError('proposalId is required', 400);

      const proposal = await env.DB.prepare(`
        SELECT m.id, m.user_id AS recipientId, m.sender_id AS senderId, m.merge_attempt_id AS mergeAttemptId
        FROM inbox_messages m
        WHERE (m.id = ? OR m.merge_attempt_id = ?) AND (m.user_id = ? OR m.sender_id = ?)
      `).bind(proposalId, proposalId, auth.user!.id, auth.user!.id).first();

      if (!proposal) return jsonError('Proposal not found or access denied', 404);

      const messages = await env.DB.prepare(`
        SELECT m.id, m.sender_id AS senderId, m.user_id AS recipientId,
          m.title, m.content, m.created_at AS createdAt, m.message_kind AS messageKind,
          m.in_reply_to_id AS inReplyToId,
          COALESCE(sender.display_name, sender.username, 'System') AS authorName,
          sender.username AS authorUsername,
          COALESCE(sender.avatar_url, '⚡') AS authorAvatar,
          CASE WHEN m.sender_id = ? THEN 'sent' ELSE 'received' END AS direction
        FROM inbox_messages m
        LEFT JOIN users sender ON sender.id = m.sender_id
        WHERE (m.id = ? OR m.in_reply_to_id = ? OR (m.merge_attempt_id IS NOT NULL AND m.merge_attempt_id = ?))
          AND (m.user_id = ? OR m.sender_id = ?)
        ORDER BY CASE WHEN m.id = ? THEN 0 ELSE 1 END, m.created_at ASC, m.id ASC
      `).bind(auth.user!.id, proposal.id, proposal.id, proposal.mergeAttemptId, auth.user!.id, auth.user!.id, proposal.id).all();

      const approval = await env.DB.prepare(`
        SELECT ma.decision, ma.comment, ma.created_at AS createdAt,
          u.username AS approverUsername, COALESCE(u.display_name, u.username) AS approverDisplayName,
          u.avatar_url AS approverAvatar
        FROM merge_approvals ma
        JOIN users u ON u.id = ma.approver_user_id
        WHERE ma.merge_attempt_id = ?
      `).bind(proposal.mergeAttemptId).first();

      return Response.json({
        success: true,
        proposalId: proposal.id,
        messages: messages.results || [],
        approval: approval || null
      });
    }

    const requestedLimit = Number(url.searchParams.get('limit') || DEFAULT_PAGE_SIZE);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const cursorValue = url.searchParams.get('cursor');
    const cursor = decodeCursor(cursorValue, auth.user!.id);
    if (cursorValue && !cursor) return jsonError('Invalid inbox cursor', 400);
    const cursorClause = cursor ? 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))' : '';
    const statement = env.DB.prepare(`
      SELECT m.id, m.message_kind AS messageKind,
        CASE WHEN m.sender_id = ?
          THEN COALESCE(recipient.display_name || ' (@' || recipient.username || ')', 'Unknown recipient')
          ELSE COALESCE(sender.display_name || ' (@' || sender.username || ')', 'System')
        END AS counterpartName,
        CASE WHEN m.sender_id = ? THEN COALESCE(recipient.avatar_url, '📤') ELSE COALESCE(sender.avatar_url, '⚡') END AS counterpartAvatar,
        CASE WHEN m.sender_id = ? THEN 'sent' ELSE 'received' END AS direction,
        m.title, m.preview, m.content, m.feature_ref AS featureRef,
        m.cas_new_sha AS legacyResultOid, m.unread, m.created_at AS createdAt,
        m.merge_attempt_id AS mergeAttemptId, m.in_reply_to_id AS inReplyToId,
        ma.input_target_oid AS expectedTargetOid, ma.result_commit_oid AS resultCommitOid,
        ma.status AS mergeAttemptStatus, mj.status AS mergeJobStatus,
        mj.landed_commit_oid AS landedCommitOid, approval.decision AS approvalDecision,
        approval.comment AS approvalComment
      FROM inbox_messages m
      LEFT JOIN users sender ON sender.id = m.sender_id
      LEFT JOIN users recipient ON recipient.id = m.user_id
      LEFT JOIN merge_attempts ma ON ma.id = m.merge_attempt_id
      LEFT JOIN merge_jobs mj ON mj.id = ma.merge_job_id
      LEFT JOIN merge_approvals approval
        ON approval.merge_attempt_id = ma.id AND approval.approver_user_id = m.user_id
      WHERE (m.user_id = ? OR m.sender_id = ?)
      ${cursorClause}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    `);
    const bindings: unknown[] = [auth.user!.id, auth.user!.id, auth.user!.id, auth.user!.id, auth.user!.id];
    if (cursor) bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    bindings.push(limit + 1);
    const { results } = await statement.bind(...bindings).all();
    const rows = results || [];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const threads = page.map((row: any) => {
      const landed = Boolean(row.mergeJobStatus === 'landed' && row.resultCommitOid && row.landedCommitOid === row.resultCommitOid);
      return {
        id: row.id, category: normalizeKind(row.messageKind), from: row.counterpartName,
        fromAvatar: row.counterpartAvatar, direction: row.direction,
        subject: row.title, preview: row.preview, body: row.content,
        unread: row.direction === 'received' && Boolean(row.unread), featureRef: row.featureRef || 'n/a',
        inReplyToId: row.inReplyToId || undefined,
        casOldSha: row.expectedTargetOid || undefined,
        casNewSha: row.resultCommitOid || row.legacyResultOid || undefined,
        mergeAttemptId: row.mergeAttemptId || undefined,
        mergeStatus: landed ? 'landed' : row.mergeAttemptStatus || undefined,
        approvalStatus: row.approvalDecision || 'unreviewed', approvalComment: row.approvalComment || undefined,
        isMerged: landed, time: row.createdAt
      };
    });
    const last = page.at(-1) as any;
    const nextCursor = hasMore && last
      ? encodeCursor({ userId: auth.user!.id, createdAt: String(last.createdAt), id: String(last.id) })
      : null;
    return Response.json({ success: true, threads, page: { limit, hasMore, nextCursor } });
  } catch {
    return jsonError('Failed to retrieve inbox messages', 500);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: { DB?: D1Database; GITSMITH_REPOS_ROOT?: string; STORAGE?: R2Bucket } }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  if (!env.DB) return jsonError('Inbox storage is unavailable', 503);
  let body: any;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400); }
  const userId = auth.user!.id;
  const messageId = typeof body.messageId === 'string' ? body.messageId : '';
  try {
    if (body.action === 'submit_proposal') {
      const mergeAttemptId = typeof body.mergeAttemptId === 'string' ? body.mergeAttemptId.trim() : '';
      if (!mergeAttemptId) return jsonError('mergeAttemptId is required', 400);
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
      const rawContent = typeof body.content === 'string' ? body.content.trim() : '';
      if (rawTitle.length > 160) return jsonError('Proposal title must be 160 characters or fewer', 400);
      if (rawContent.length > 10_000) return jsonError('Proposal content must be 10,000 characters or fewer', 400);

      const attempt = await env.DB.prepare(`
        SELECT ma.id AS mergeAttemptId, ma.input_target_oid AS inputTargetOid,
          ma.result_commit_oid AS resultCommitOid, ma.status AS attemptStatus,
          mj.id AS mergeJobId, mj.status AS jobStatus, mj.target_ref AS targetRef,
          mj.requested_by_user_id AS requestedByUserId,
          r.id AS repositoryId, r.owner_user_id AS repositoryOwnerId,
          r.slug AS repositorySlug, r.status AS repositoryStatus,
          fpv.git_ref AS featureRef
        FROM merge_attempts ma
        JOIN merge_jobs mj ON mj.id = ma.merge_job_id
        JOIN repositories r ON r.id = mj.target_repository_id
        LEFT JOIN feature_package_versions fpv ON fpv.id = mj.feature_version_id
        WHERE ma.id = ?
      `).bind(mergeAttemptId).first();
      if (!attempt) return jsonError('Merge attempt not found', 404);
      if (attempt.requestedByUserId !== userId) return jsonError('Only the merge job requester may submit its proposal', 403);
      if (attempt.repositoryStatus !== 'active') return jsonError('Target repository is not active', 409);
      if (attempt.jobStatus !== 'preview_ready' || attempt.attemptStatus !== 'preview_ready' || !attempt.resultCommitOid) {
        return jsonError('Only a preview-ready immutable merge attempt may be proposed', 409);
      }

      const proposalId = `proposal:${mergeAttemptId}`;
      const title = rawTitle || `Merge proposal for ${attempt.repositorySlug}`;
      const content = rawContent || [
        `Preview-ready merge attempt ${mergeAttemptId}`,
        `Target: ${attempt.repositorySlug} ${attempt.targetRef}`,
        `CAS: ${attempt.inputTargetOid} → ${attempt.resultCommitOid}`
      ].join('\n');
      const insertResult = await env.DB.prepare(`
        INSERT OR IGNORE INTO inbox_messages
          (id, user_id, sender_id, title, preview, content, feature_ref, cas_new_sha,
           is_merged, unread, message_kind, merge_attempt_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'proposal', ?)
      `).bind(
        proposalId, attempt.repositoryOwnerId, userId, title, content.slice(0, 160), content,
        attempt.featureRef || attempt.targetRef, attempt.resultCommitOid, mergeAttemptId
      ).run();
      const stored = await env.DB.prepare(`
        SELECT id, user_id AS recipientId, sender_id AS senderId,
          merge_attempt_id AS mergeAttemptId, title, content, feature_ref AS featureRef,
          created_at AS createdAt
        FROM inbox_messages WHERE id = ?
      `).bind(proposalId).first();
      if (!stored || stored.recipientId !== attempt.repositoryOwnerId || stored.senderId !== userId ||
          stored.mergeAttemptId !== mergeAttemptId) {
        return jsonError('Proposal identity conflicts with an existing message', 409);
      }
      return Response.json({
        success: true,
        proposal: {
          id: stored.id, mergeAttemptId, mergeJobId: attempt.mergeJobId,
          repositoryId: attempt.repositoryId, recipientUserId: stored.recipientId,
          title: stored.title, content: stored.content, featureRef: stored.featureRef,
          expectedTargetOid: attempt.inputTargetOid, resultCommitOid: attempt.resultCommitOid,
          status: 'preview_ready', createdAt: stored.createdAt
        },
        idempotent: Number(insertResult?.meta?.changes || 0) === 0
      }, { status: 200 });
    }

    if (body.action === 'mark_read' || body.action === 'mark_unread') {
      if (!messageId) return jsonError('messageId is required', 400);
      const owned = await env.DB.prepare('SELECT id FROM inbox_messages WHERE id = ? AND user_id = ?').bind(messageId, userId).first();
      if (!owned) return jsonError('Message not found', 404);
      await env.DB.prepare('UPDATE inbox_messages SET unread = ? WHERE id = ? AND user_id = ?')
        .bind(body.action === 'mark_unread' ? 1 : 0, messageId, userId).run();
      return Response.json({ success: true, messageId, unread: body.action === 'mark_unread' });
    }

    if (body.action === 'reply' || body.action === 'comment' || body.action === 'proposal_comment') {
      const targetId = messageId || (typeof body.proposalId === 'string' ? body.proposalId : '');
      if (!targetId) return jsonError('messageId is required', 400);
      const text = typeof body.text === 'string' ? body.text.trim() : (typeof body.comment === 'string' ? body.comment.trim() : '');
      if (!text) return jsonError('Reply text is required', 400);
      if (text.length > 10_000) return jsonError('Reply text must be 10,000 characters or fewer', 400);
      const parent = await env.DB.prepare(`
        SELECT id, sender_id AS senderId, user_id AS recipientId, title, merge_attempt_id AS mergeAttemptId
        FROM inbox_messages WHERE (id = ? OR merge_attempt_id = ?) AND (user_id = ? OR sender_id = ?)
      `).bind(targetId, targetId, userId, userId).first();
      if (!parent) return jsonError('Parent message not found', 404);
      const counterpartId = parent.senderId === userId ? parent.recipientId : parent.senderId;
      if (!counterpartId) return jsonError('This system message cannot receive replies', 409);
      const recipient = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(counterpartId).first();
      if (!recipient) return jsonError('Recipient is unavailable', 409);
      const replyId = crypto.randomUUID();
      const title = String(parent.title || 'Message');
      const subject = title.startsWith('Re: ') ? title : `Re: ${title}`;
      await env.DB.prepare(`
        INSERT INTO inbox_messages
          (id, user_id, sender_id, title, preview, content, feature_ref, is_merged, unread, message_kind, in_reply_to_id, merge_attempt_id)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 1, 'feedback', ?, ?)
      `).bind(replyId, recipient.id, userId, subject, text.slice(0, 160), text, parent.id, parent.mergeAttemptId || null).run();
      const storedReply = await env.DB.prepare(`
        SELECT m.id, m.title, m.content, m.created_at AS createdAt,
          COALESCE(recipient.display_name || ' (@' || recipient.username || ')', 'Unknown recipient') AS counterpartName,
          COALESCE(recipient.avatar_url, '📤') AS counterpartAvatar
        FROM inbox_messages m
        LEFT JOIN users recipient ON recipient.id = m.user_id
        WHERE m.id = ? AND m.sender_id = ?
      `).bind(replyId, userId).first();
      if (!storedReply) return jsonError('Reply was stored but could not be confirmed', 500);
      return Response.json({
        success: true,
        messageId: replyId,
        commentId: replyId,
        thread: {
          id: storedReply.id,
          category: 'feedback',
          from: storedReply.counterpartName,
          fromAvatar: storedReply.counterpartAvatar,
          direction: 'sent',
          subject: storedReply.title,
          body: storedReply.content,
          unread: false,
          featureRef: 'n/a',
          inReplyToId: parent.id,
          mergeAttemptId: parent.mergeAttemptId || undefined,
          time: storedReply.createdAt
        }
      });
    }

    if (body.action === 'merge') return jsonError('INBOX does not land Git refs. Approve the immutable merge attempt instead.', 409);

    if (body.action === 'approve' || body.action === 'reject') {
      if (!messageId) return jsonError('messageId is required', 400);
      const proposal = await env.DB.prepare(`
        SELECT m.message_kind AS messageKind, m.merge_attempt_id AS mergeAttemptId,
          m.sender_id AS senderId,
          ma.merge_job_id AS mergeJobId, ma.input_target_oid AS inputTargetOid,
          ma.result_commit_oid AS resultCommitOid, ma.status AS attemptStatus,
          mj.target_ref AS targetRef, mj.status AS jobStatus,
          mj.requested_by_user_id AS requestedByUserId,
          r.id AS repositoryId, r.owner_user_id AS repositoryOwnerId,
          r.storage_key AS storageKey,
          r.grantable_bps AS grantableBps,
          (SELECT build.id FROM build_runs build
            WHERE build.merge_attempt_id = ma.id AND build.purpose = 'verification'
              AND build.status = 'passed' AND build.commit_oid = ma.result_commit_oid
            ORDER BY build.finished_at DESC LIMIT 1) AS buildRunId,
          (SELECT build.evidence_bundle_r2_key FROM build_runs build
            WHERE build.merge_attempt_id = ma.id AND build.purpose = 'verification'
              AND build.status = 'passed' AND build.commit_oid = ma.result_commit_oid
            ORDER BY build.finished_at DESC LIMIT 1) AS evidenceBundleR2Key,
          (SELECT build.evidence_bundle_sha256 FROM build_runs build
            WHERE build.merge_attempt_id = ma.id AND build.purpose = 'verification'
              AND build.status = 'passed' AND build.commit_oid = ma.result_commit_oid
            ORDER BY build.finished_at DESC LIMIT 1) AS evidenceBundleSha256
        FROM inbox_messages m
        LEFT JOIN merge_attempts ma ON ma.id = m.merge_attempt_id
        LEFT JOIN merge_jobs mj ON mj.id = ma.merge_job_id
        LEFT JOIN repositories r ON r.id = mj.target_repository_id
        WHERE m.id = ? AND m.user_id = ?
      `).bind(messageId, userId).first();
      if (!proposal) return jsonError('Message not found', 404);
      if (proposal.messageKind !== 'proposal') return jsonError('Message is not a merge proposal', 409);
      if (!proposal.mergeAttemptId || !proposal.resultCommitOid) return jsonError('Proposal is not bound to an immutable merge attempt', 409);
      if (proposal.repositoryOwnerId !== userId) return jsonError('Only the target repository owner may approve this attempt', 403);
      const decision = body.action === 'approve' ? 'approved' : 'rejected';
      const allowedStatuses = decision === 'approved' ? ['preview_ready', 'approved'] : ['preview_ready', 'rejected'];
      if (!allowedStatuses.includes(String(proposal.attemptStatus))) {
        return jsonError(`Merge attempt cannot be ${decision} from status ${proposal.attemptStatus}`, 409);
      }
      const allowedJobStatuses = decision === 'approved' ? ['preview_ready', 'landing'] : ['preview_ready', 'cancelled'];
      if (!allowedJobStatuses.includes(String(proposal.jobStatus))) {
        return jsonError(`Merge job cannot be ${decision} from status ${proposal.jobStatus}`, 409);
      }

      // Reviewer-saw-OID confirmation gate (fail closed on missing/mismatched evidence).
      // The client must submit the exact target/source OIDs it displayed to the reviewer
      // after successfully loading the diff/evidence. This is ADDITIONAL to the existing
      // CAS and fast-forward checks below — it exists to catch the case where the reviewer
      // approves based on stale evidence they saw before the underlying attempt moved.
      if (decision === 'approved') {
        const reviewedTargetOid = typeof body.reviewedTargetOid === 'string' ? body.reviewedTargetOid.trim() : '';
        const reviewedSourceOid = typeof body.reviewedSourceOid === 'string' ? body.reviewedSourceOid.trim() : '';
        if (!reviewedTargetOid || !reviewedSourceOid) {
          return jsonError('Approval requires the reviewedTargetOid and reviewedSourceOid the reviewer saw in the loaded evidence; the client did not submit them', 422);
        }
        if (reviewedTargetOid !== proposal.inputTargetOid || reviewedSourceOid !== proposal.resultCommitOid) {
          return jsonError('Cannot approve: the target or source OID has drifted since you loaded the evidence. Reload the proposal and re-review before approving.', 409);
        }
      }

      // Signed R2 verification-evidence bundle gate (fail closed on missing/mismatched
      // bundle). ADDITIONAL to the reviewer-saw-OID gate above and the CAS/fast-forward
      // checks below: a merge attempt may only be approved if its passing RIG
      // verification run recorded exactly one immutable evidence bundle in R2, and the
      // bytes at that R2 key still hash to the digest recorded on build_runs at
      // verification-complete time. Missing STORAGE, a missing object, or any digest
      // mismatch fails closed — approval never proceeds on unverifiable evidence.
      if (decision === 'approved') {
        if (!proposal.evidenceBundleR2Key || !proposal.evidenceBundleSha256) {
          return jsonError('Cannot approve: no signed verification evidence bundle is recorded for this merge attempt. A passing RIG verification run must produce an evidence bundle before it can be approved.', 409);
        }
        if (!env.STORAGE || typeof env.STORAGE.get !== 'function') {
          return jsonError('Cannot approve: evidence storage (R2 STORAGE) is unavailable, so the recorded evidence bundle cannot be verified.', 503);
        }
        const bundleObject = await env.STORAGE.get(proposal.evidenceBundleR2Key).catch(() => null);
        if (!bundleObject) {
          return jsonError('Cannot approve: the recorded verification evidence bundle is missing from R2.', 409);
        }
        const bundleBytes: ArrayBuffer = typeof bundleObject.arrayBuffer === 'function'
          ? await bundleObject.arrayBuffer()
          : bundleObject;
        const recomputedSha256 = `sha256:${await sha256HexOfBytes(bundleBytes)}`;
        if (recomputedSha256 !== proposal.evidenceBundleSha256) {
          return jsonError('Cannot approve: the verification evidence bundle in R2 does not match its recorded digest. The evidence may have been tampered with or corrupted.', 409);
        }
      }

      // Parse and validate contributor grant inputs
      const rawBps = body.grantBps ?? body.grant_bps ?? body.basisPoints ?? body.basis_points;
      const rawPct = body.grantPercent ?? body.grant_percent;

      let parsedBpsFromInput: number | null = null;
      let parsedBpsFromPct: number | null = null;

      if (rawBps !== undefined && rawBps !== null) {
        if (typeof rawBps === 'boolean' || (typeof rawBps === 'string' && rawBps.trim() === '')) {
          return jsonError('Grant basis points must be a valid integer between 0 and 10000', 422);
        }
        const num = Number(rawBps);
        if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > 10000) {
          return jsonError('Grant basis points must be a valid integer between 0 and 10000', 422);
        }
        parsedBpsFromInput = num;
      }

      if (rawPct !== undefined && rawPct !== null) {
        if (typeof rawPct === 'boolean' || (typeof rawPct === 'string' && rawPct.trim() === '')) {
          return jsonError('grantPercent must be a number', 422);
        }
        const num = Number(rawPct);
        if (!Number.isFinite(num) || Number.isNaN(num)) {
          return jsonError('grantPercent must be a number', 422);
        }
        if (num < 0 || num > 100) {
          return jsonError('grantPercent must be between 0 and 100', 422);
        }
        // Round to nearest basis point (2 decimal places of percent)
        parsedBpsFromPct = Math.round(num * 100);
      }

      if (parsedBpsFromInput !== null && parsedBpsFromPct !== null && parsedBpsFromInput !== parsedBpsFromPct) {
        return jsonError('grantBps and grantPercent conflict', 422);
      }

      const requestedBps = parsedBpsFromInput ?? parsedBpsFromPct ?? 0;

      if (decision === 'rejected' && requestedBps > 0) {
        return jsonError('Grants can only be awarded when approving a merge attempt', 422);
      }

      const contributorUserId = proposal.requestedByUserId || proposal.senderId;

      // State-aware check for existing contributor share
      const existingShare = await env.DB.prepare(`
        SELECT id, repository_id AS repositoryId, contributor_user_id AS contributorUserId,
               granted_by_user_id AS grantedByUserId, basis_points AS basisPoints,
               status, merge_approval_id AS mergeApprovalId
        FROM contributor_shares
        WHERE merge_attempt_id = ?
      `).bind(proposal.mergeAttemptId).first();

      let persistedBps = 0;
      let shouldInsertShare = false;

      if (decision === 'approved') {
        if (existingShare) {
          // Idempotent exact replay check
          const isExactReplay =
            existingShare.contributorUserId === contributorUserId &&
            existingShare.grantedByUserId === userId &&
            existingShare.repositoryId === proposal.repositoryId &&
            Number(existingShare.basisPoints) === requestedBps;

          if (isExactReplay) {
            persistedBps = Number(existingShare.basisPoints);
          } else {
            const currentPctStr = (Number(existingShare.basisPoints) / 100).toFixed(2);
            return jsonError(
              `This attempt already has a ${existingShare.basisPoints} bps (${currentPctStr}%) grant; reject and re-submit to change it`,
              409
            );
          }
        } else if (requestedBps > 0) {
          if (!contributorUserId) {
            return jsonError('Contributor user ID could not be resolved for this proposal', 422);
          }
          if (contributorUserId === proposal.repositoryOwnerId) {
            return jsonError('Repository owner cannot grant contributor shares to themselves', 422);
          }

          // UX-level cap check (friendly 422 error before hitting DB trigger)
          const grantableBps = Number(proposal.grantableBps || 0);
          const sharesRes = await env.DB.prepare(`
            SELECT COALESCE(SUM(basis_points), 0) AS totalGrantedBps
            FROM contributor_shares
            WHERE repository_id = ?
              AND status IN ('active', 'pending')
          `).bind(proposal.repositoryId).first();
          const totalGrantedBps = Number(sharesRes?.totalGrantedBps || 0);

          if (totalGrantedBps + requestedBps > grantableBps) {
            const remaining = Math.max(0, grantableBps - totalGrantedBps);
            return jsonError(`Grant of ${requestedBps} bps (${(requestedBps / 100).toFixed(2)}%) exceeds available repository grantable pool (${remaining} bps remaining)`, 422);
          }

          persistedBps = requestedBps;
          shouldInsertShare = true;
        }
      }

      const rawComment = typeof body.comment === 'string' ? body.comment.trim() : '';
      if (rawComment.length > 2_000) return jsonError('Review comment must be 2,000 characters or fewer', 400);
      if (decision === 'rejected' && rawComment.length < 3) return jsonError('A meaningful rejection comment is required', 400);

      // Server-side guard: verify that the proposal is not divergent before approving
      // Fail closed: return conflict/error UNLESS the repository exists AND getProposalDiff confirms a fast-forward
      if (decision === 'approved') {
        const reposRoot = env.GITSMITH_REPOS_ROOT || process.env.GITSMITH_REPOS_ROOT || path.resolve(process.cwd(), '.gitsmith-repos');
        const storageKey = proposal.storageKey || `repositories/${proposal.repositoryId}`;
        const pathRes = resolveRepoPath(reposRoot, storageKey);
        if (!pathRes.valid || !pathRes.resolvedPath || !fs.existsSync(pathRes.resolvedPath)) {
          return jsonError(`Cannot approve proposal: Repository storage '${storageKey}' does not exist or is unavailable for lineage verification`, 409);
        }
        const diffResult = getProposalDiff(reposRoot, storageKey, proposal.inputTargetOid, proposal.resultCommitOid);
        if (!diffResult.success) {
          return jsonError(`Cannot approve proposal: ${diffResult.error || 'Failed to verify Git lineage'}`, 409);
        }
        if (diffResult.diverged || !diffResult.isFastForward) {
          return jsonError('Cannot approve divergent proposal: branch is not a fast-forward descendant of target (rebase or merge required)', 409);
        }
      }
      const existingApproval = await env.DB.prepare(`
        SELECT id, result_commit_oid AS resultCommitOid FROM merge_approvals
        WHERE merge_attempt_id = ? AND approver_user_id = ?
      `).bind(proposal.mergeAttemptId, userId).first();
      if (existingApproval && existingApproval.resultCommitOid !== proposal.resultCommitOid) {
        return jsonError('Existing review is bound to a different result commit OID', 409);
      }

      const approvalId = crypto.randomUUID();

      const statements = [
        env.DB.prepare(`
          INSERT INTO merge_approvals (id, merge_attempt_id, approver_user_id, result_commit_oid, decision, comment)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(merge_attempt_id, approver_user_id) DO UPDATE SET
            decision = excluded.decision, comment = excluded.comment
          WHERE merge_approvals.result_commit_oid = excluded.result_commit_oid
        `).bind(approvalId, proposal.mergeAttemptId, userId, proposal.resultCommitOid, decision, rawComment),
        env.DB.prepare(`UPDATE merge_attempts SET status = ? WHERE id = ? AND status IN ('preview_ready', 'approved', 'rejected') AND result_commit_oid = ?`)
          .bind(decision, proposal.mergeAttemptId, proposal.resultCommitOid),
        env.DB.prepare('UPDATE inbox_messages SET unread = 0 WHERE id = ? AND user_id = ?').bind(messageId, userId)
      ];
      let outboxEventId: string | null = null;
      if (decision === 'approved') {
        outboxEventId = `merge_land_${proposal.mergeAttemptId}`;
        statements.push(
          env.DB.prepare(`
            UPDATE merge_jobs SET status = 'landing', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status IN ('preview_ready', 'landing')
          `).bind(proposal.mergeJobId),
          env.DB.prepare(`
            INSERT OR IGNORE INTO forge_outbox_events
              (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
            VALUES (?, 'merge', ?, 'merge.approved', ?, 0, CURRENT_TIMESTAMP)
          `).bind(outboxEventId, proposal.mergeAttemptId, JSON.stringify({
            mergeJobId: proposal.mergeJobId,
            mergeAttemptId: proposal.mergeAttemptId,
            repositoryId: proposal.repositoryId,
            storageKey: proposal.storageKey,
            targetRef: proposal.targetRef,
            expectedTargetOid: proposal.inputTargetOid,
            resultCommitOid: proposal.resultCommitOid,
            approverUserId: userId
          }))
        );
        if (shouldInsertShare) {
          const shareId = `cs_${crypto.randomUUID().replace(/-/g, '')}`;
          statements.push(
            env.DB.prepare(`
              INSERT INTO contributor_shares
                (id, repository_id, contributor_user_id, granted_by_user_id, merge_job_id, merge_attempt_id, merge_approval_id, basis_points, status)
              VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM merge_approvals WHERE merge_attempt_id = ? AND approver_user_id = ?), ?, 'pending')
            `).bind(
              shareId,
              proposal.repositoryId,
              contributorUserId,
              userId,
              proposal.mergeJobId,
              proposal.mergeAttemptId,
              proposal.mergeAttemptId,
              userId,
              requestedBps
            )
          );
        }
      } else {
        statements.push(env.DB.prepare(`
          UPDATE merge_jobs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP,
            completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
          WHERE id = ? AND status = 'preview_ready'
        `).bind(proposal.mergeJobId));
      }
      await env.DB.batch(statements);
      return Response.json({
        success: true, approvalStatus: decision, mergeStatus: decision, approvalComment: rawComment,
        outboxEventId,
        grantBps: persistedBps > 0 ? persistedBps : undefined,
        message: decision === 'approved'
          ? 'Exact merge attempt approved and queued for authoritative GITSMITH CAS landing.'
          : 'Exact merge attempt rejected. No Git ref was changed.'
      });
    }
    return jsonError('Invalid action', 400);
  } catch {
    return jsonError('Failed to process inbox action', 500);
  }
};
