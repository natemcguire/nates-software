import { requireAuth } from './_auth';

const CHANNEL = /^#[a-z0-9_-]{1,40}$/i;
const ALLOWED_TYPES = new Set(['PRIVMSG', 'ACTION']);
const MAX_TEXT = 2000;

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  if (!env?.DB) return response({ success: false, error: 'Chat storage is unavailable.' }, 503);
  const channel = new URL(request.url).searchParams.get('channel') || '#lounge';
  if (!CHANNEL.test(channel)) return response({ success: false, error: 'Invalid channel.' }, 400);

  try {
    await env.DB.prepare(`DELETE FROM chat_messages WHERE created_at < datetime('now', '-24 hours')`).run();
    const { results } = await env.DB.prepare(`
      SELECT m.id, m.channel, u.username AS sender, 'PRIVMSG' AS type, m.text,
             CASE WHEN u.role IN ('admin', 'super_admin') THEN 1 ELSE 0 END AS isOp,
             m.created_at AS timestamp
        FROM chat_messages m
        JOIN users u ON u.id = m.user_id
       WHERE m.channel = ? AND m.created_at >= datetime('now', '-24 hours')
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT 100
    `).bind(channel).all();
    return response({ success: true, channel, messages: results || [], ttlHours: 24, transport: 'web' });
  } catch (error: any) {
    return response({ success: false, error: `Chat query failed: ${error.message}` }, 503);
  }
};
export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse || !auth.user) return auth.errorResponse || response({ success: false, error: 'Unauthorized' }, 401);
  if (!env?.DB) return response({ success: false, error: 'Chat storage is unavailable.' }, 503);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return response({ success: false, error: 'Request body must be valid JSON.' }, 400);
  }

  const channel = String(body?.channel || '#lounge');
  const type = String(body?.type || 'PRIVMSG').toUpperCase();
  const text = String(body?.text || '').trim();
  if (!CHANNEL.test(channel)) return response({ success: false, error: 'Invalid channel.' }, 400);
  if (!ALLOWED_TYPES.has(type)) return response({ success: false, error: 'Unsupported message type.' }, 400);
  if (!text) return response({ success: false, error: 'text is required' }, 400);
  if (text.length > MAX_TEXT) return response({ success: false, error: `text must be ${MAX_TEXT} characters or fewer` }, 400);

  const messageId = `msg_${crypto.randomUUID().replaceAll('-', '')}`;
  try {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM chat_messages WHERE created_at < datetime('now', '-24 hours')`),
      env.DB.prepare(`INSERT INTO chat_messages (id, channel, user_id, text, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).bind(messageId, channel, auth.user.id, text)
    ]);
    const stored = await env.DB.prepare(`
      SELECT m.id, m.channel, u.username AS sender, ? AS type, m.text,
             CASE WHEN u.role IN ('admin', 'super_admin') THEN 1 ELSE 0 END AS isOp,
             m.created_at AS timestamp
        FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
    `).bind(type, messageId).first();
    if (!stored) return response({ success: false, error: 'Stored chat message could not be confirmed.' }, 503);
    return response({ success: true, message: stored }, 201);
  } catch (error: any) {
    return response({ success: false, error: `Chat persistence failed: ${error.message}` }, 503);
  }
};
