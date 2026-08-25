// GET /api/inbox - Fetch user messages from D1
// POST /api/inbox - Execute merge or send reply

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const username = url.searchParams.get('username') || 'nate';

    const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    const userId = user ? user.id : 'usr_nate';

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

    return Response.json({ success: true, threads: results });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to retrieve inbox messages' }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json();
    const { action, messageId, toUser, subject, text } = body;

    if (action === 'merge' && messageId) {
      // Mark message as merged
      await env.DB.prepare(`
        UPDATE inbox_messages
        SET is_merged = 1, unread = 0
        WHERE id = ?
      `).bind(messageId).run();

      return Response.json({ success: true, message: 'CAS merge recorded in Cloudflare D1' });
    }

    if (action === 'reply' && toUser && text) {
      const msgId = `msg_${Date.now()}`;
      await env.DB.prepare(`
        INSERT INTO inbox_messages (id, user_id, category, from_user, from_avatar, subject, body, unread, feature_ref)
        VALUES (?, 'usr_nate', 'feedback', 'Nate McGuire (@nate)', '⚡', ?, ?, 0, 'n/a')
      `).bind(msgId, subject || 'Re: Message', text).run();

      return Response.json({ success: true, messageId: msgId });
    }

    return Response.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to process inbox action' }, { status: 500 });
  }
};
