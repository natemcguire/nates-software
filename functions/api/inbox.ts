// Authenticated mailbox, replies, and immutable merge-attempt approvals.
// GITSMITH remains the only authority that may land a Git ref.
import { requireAuth } from './_auth';

type D1Database = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };
const jsonError = (error: string, status: number) => Response.json({ success: false, error }, { status });
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

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

export const onRequestGet = async ({ request, env }: { request: Request; env: { DB?: D1Database } }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  if (!env.DB) return jsonError('Inbox storage is unavailable', 503);
  try {
    const url = new URL(request.url);
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

export const onRequestPost = async ({ request, env }: { request: Request; env: { DB?: D1Database } }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  if (!env.DB) return jsonError('Inbox storage is unavailable', 503);
  let body: any;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400); }
  const userId = auth.user!.id;
  const messageId = typeof body.messageId === 'string' ? body.messageId : '';
  try {
    if (body.action === 'mark_read' || body.action === 'mark_unread') {
      if (!messageId) return jsonError('messageId is required', 400);
      const owned = await env.DB.prepare('SELECT id FROM inbox_messages WHERE id = ? AND user_id = ?').bind(messageId, userId).first();
      if (!owned) return jsonError('Message not found', 404);
      await env.DB.prepare('UPDATE inbox_messages SET unread = ? WHERE id = ? AND user_id = ?')
        .bind(body.action === 'mark_unread' ? 1 : 0, messageId, userId).run();
      return Response.json({ success: true, messageId, unread: body.action === 'mark_unread' });
    }

    if (body.action === 'reply') {
      if (!messageId) return jsonError('messageId is required', 400);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return jsonError('Reply text is required', 400);
      if (text.length > 10_000) return jsonError('Reply text must be 10,000 characters or fewer', 400);
      const parent = await env.DB.prepare(`
        SELECT sender_id AS senderId, user_id AS recipientId, title
        FROM inbox_messages WHERE id = ? AND (user_id = ? OR sender_id = ?)
      `).bind(messageId, userId, userId).first();
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
          (id, user_id, sender_id, title, preview, content, feature_ref, is_merged, unread, message_kind, in_reply_to_id)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 1, 'feedback', ?)
      `).bind(replyId, recipient.id, userId, subject, text.slice(0, 160), text, messageId).run();
      return Response.json({ success: true, messageId: replyId });
    }

    if (body.action === 'merge') return jsonError('INBOX does not land Git refs. Approve the immutable merge attempt instead.', 409);

    if (body.action === 'approve' || body.action === 'reject') {
      if (!messageId) return jsonError('messageId is required', 400);
      const proposal = await env.DB.prepare(`
        SELECT m.message_kind AS messageKind, m.merge_attempt_id AS mergeAttemptId,
          ma.result_commit_oid AS resultCommitOid, ma.status AS attemptStatus,
          r.owner_user_id AS repositoryOwnerId
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
      const allowedStatuses = decision === 'approved' ? ['preview_ready', 'approved'] : ['preview_ready', 'approved', 'rejected'];
      if (!allowedStatuses.includes(String(proposal.attemptStatus))) {
        return jsonError(`Merge attempt cannot be ${decision} from status ${proposal.attemptStatus}`, 409);
      }
      const approvalId = crypto.randomUUID();
      const rawComment = typeof body.comment === 'string' ? body.comment.trim() : '';
      if (rawComment.length > 2_000) return jsonError('Review comment must be 2,000 characters or fewer', 400);
      if (decision === 'rejected' && rawComment.length < 3) return jsonError('A meaningful rejection comment is required', 400);
      const existing = await env.DB.prepare(`
        SELECT result_commit_oid AS resultCommitOid FROM merge_approvals
        WHERE merge_attempt_id = ? AND approver_user_id = ?
      `).bind(proposal.mergeAttemptId, userId).first();
      if (existing && existing.resultCommitOid !== proposal.resultCommitOid) {
        return jsonError('Existing review is bound to a different result commit OID', 409);
      }
      await env.DB.batch([
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
      ]);
      return Response.json({
        success: true, approvalStatus: decision, mergeStatus: decision, approvalComment: rawComment,
        message: decision === 'approved'
          ? 'Exact merge attempt approved. GITSMITH has not landed the ref yet.'
          : 'Exact merge attempt rejected. No Git ref was changed.'
      });
    }
    return jsonError('Invalid action', 400);
  } catch {
    return jsonError('Failed to process inbox action', 500);
  }
};
