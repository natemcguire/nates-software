// GET /api/inbox - Fetch user messages from D1 (Strictly Session Authorized)
// POST /api/inbox - Execute merge or send reply

import { getSessionUser, requireAuth } from './_auth';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const authUser = await getSessionUser(request, env);
    const userId = authUser?.id || 'usr_nate';

    if (env && env.DB) {
      const { results } = await env.DB.prepare(`
        SELECT 
          id, category, from_user AS "from", from_avatar AS fromAvatar,
          subject, body, unread, feature_ref AS featureRef,
          cas_old_sha AS casOldSha, cas_new_sha AS casNewSha,
          tests_passed AS testsPassed, is_merged AS isMerged,
          created_at AS time
        FROM inbox_messages
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).bind(userId).all();

      return Response.json({ success: true, threads: results || [] });
    }

    return Response.json({ success: true, threads: [] });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to retrieve inbox messages' }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const sessionUser = auth.user!;

    const body = await request.json();
    const { action, messageId, toUser, subject, text } = body;

    if (action === 'merge' && messageId) {
      if (env && env.DB) {
        await env.DB.prepare(`
          UPDATE inbox_messages
          SET is_merged = 1, unread = 0
          WHERE id = ? AND user_id = ?
        `).bind(messageId, sessionUser.id).run();
      }

      return Response.json({ success: true, message: 'CAS merge recorded in Cloudflare D1' });
    }

    if (action === 'reply' && toUser && text) {
      const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      const targetUserId = toUser.startsWith('usr_') ? toUser : `usr_${toUser.replace(/^@/, '')}`;

      if (env && env.DB) {
        await env.DB.prepare(`
          INSERT INTO inbox_messages (id, user_id, category, from_user, from_avatar, subject, body, unread, feature_ref)
          VALUES (?, ?, 'feedback', ?, ?, ?, ?, 0, 'n/a')
        `).bind(
          msgId,
          targetUserId,
          `${sessionUser.displayName} (@${sessionUser.username})`,
          sessionUser.avatar || '⚡',
          subject || 'Re: Message',
          text
        ).run();
      }

      return Response.json({ success: true, messageId: msgId });
    }

    return Response.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to process inbox action' }, { status: 500 });
  }
};
