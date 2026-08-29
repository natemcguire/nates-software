// Authenticated mailbox, replies, and immutable merge-attempt approvals.
// GITSMITH remains the only authority that may land a Git ref.
import { requireAuth } from './_auth';

type D1Database = { prepare(sql: string): any; batch(statements: any[]): Promise<any[]> };
const jsonError = (error: string, status: number) => Response.json({ success: false, error }, { status });

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
    const { results } = await env.DB.prepare(`
      SELECT m.id, m.message_kind AS messageKind,
        COALESCE(sender.display_name || ' (@' || sender.username || ')', 'System') AS senderName,
        COALESCE(sender.avatar_url, '⚡') AS senderAvatar,
        m.title, m.preview, m.content, m.feature_ref AS featureRef,
        m.cas_new_sha AS legacyResultOid, m.unread, m.created_at AS createdAt,
        m.merge_attempt_id AS mergeAttemptId,
        ma.input_target_oid AS expectedTargetOid, ma.result_commit_oid AS resultCommitOid,
        ma.status AS mergeAttemptStatus, mj.status AS mergeJobStatus,
        mj.landed_commit_oid AS landedCommitOid, approval.decision AS approvalDecision
      FROM inbox_messages m
      LEFT JOIN users sender ON sender.id = m.sender_id
      LEFT JOIN merge_attempts ma ON ma.id = m.merge_attempt_id
      LEFT JOIN merge_jobs mj ON mj.id = ma.merge_job_id
      LEFT JOIN merge_approvals approval
        ON approval.merge_attempt_id = ma.id AND approval.approver_user_id = m.user_id
      WHERE m.user_id = ?
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 200
    `).bind(auth.user!.id).all();
    const threads = (results || []).map((row: any) => {
      const landed = Boolean(row.mergeJobStatus === 'landed' && row.resultCommitOid && row.landedCommitOid === row.resultCommitOid);
      return {
        id: row.id, category: normalizeKind(row.messageKind), from: row.senderName,
        fromAvatar: row.senderAvatar, subject: row.title, preview: row.preview,
        body: row.content, unread: Boolean(row.unread), featureRef: row.featureRef || 'n/a',
        casOldSha: row.expectedTargetOid || undefined,
        casNewSha: row.resultCommitOid || row.legacyResultOid || undefined,
        mergeAttemptId: row.mergeAttemptId || undefined,
        mergeStatus: landed ? 'landed' : row.mergeAttemptStatus || undefined,
        approvalStatus: row.approvalDecision || 'unreviewed', isMerged: landed, time: row.createdAt
      };
    });
    return Response.json({ success: true, threads });
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
      const parent = await env.DB.prepare(`SELECT sender_id AS senderId, title FROM inbox_messages WHERE id = ? AND user_id = ?`)
        .bind(messageId, userId).first();
      if (!parent) return jsonError('Parent message not found', 404);
      if (!parent.senderId) return jsonError('This system message cannot receive replies', 409);
      const recipient = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(parent.senderId).first();
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

    if (body.action === 'approve') {
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
      if (!['preview_ready', 'approved'].includes(String(proposal.attemptStatus))) {
        return jsonError(`Merge attempt cannot be approved from status ${proposal.attemptStatus}`, 409);
      }
      const approvalId = crypto.randomUUID();
      const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2_000) : '';
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO merge_approvals (id, merge_attempt_id, approver_user_id, result_commit_oid, decision, comment)
          VALUES (?, ?, ?, ?, 'approved', ?)
          ON CONFLICT(merge_attempt_id, approver_user_id) DO UPDATE SET decision = 'approved', comment = excluded.comment
        `).bind(approvalId, proposal.mergeAttemptId, userId, proposal.resultCommitOid, comment),
        env.DB.prepare(`UPDATE merge_attempts SET status = 'approved' WHERE id = ? AND status = 'preview_ready' AND result_commit_oid = ?`)
          .bind(proposal.mergeAttemptId, proposal.resultCommitOid),
        env.DB.prepare('UPDATE inbox_messages SET unread = 0 WHERE id = ? AND user_id = ?').bind(messageId, userId)
      ]);
      return Response.json({ success: true, approvalStatus: 'approved', mergeStatus: 'approved', message: 'Exact merge attempt approved. GITSMITH has not landed the ref yet.' });
    }
    return jsonError('Invalid action', 400);
  } catch {
    return jsonError('Failed to process inbox action', 500);
  }
};
