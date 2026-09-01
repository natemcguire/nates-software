import { requireAuth } from './_auth';

const CHANNEL = /^#[a-z0-9_-]{1,40}$/i;
const ALLOWED_TYPES = new Set(['PRIVMSG', 'ACTION', 'TOPIC', 'SYSTEM']);
const MAX_TEXT = 2000;
const PRESENCE_ACTIVE_SECONDS = 60;
const PRESENCE_PRUNE_MINUTES = 10;
const DEFAULT_TOPIC = "Welcome to Nate's Software Global Lounge · 12:01 AM UTC Daily Releases & Indie Modding";

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  if (!env?.DB) return response({ success: false, error: 'Chat storage is unavailable.' }, 503);
  const url = new URL(request.url);
  const channel = url.searchParams.get('channel') || '#lounge';
  const action = url.searchParams.get('action');
  if (!CHANNEL.test(channel)) return response({ success: false, error: 'Invalid channel.' }, 400);

  try {
    // 1. Purge expired ephemeral data
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM chat_messages WHERE created_at < datetime('now', '-24 hours')`),
      env.DB.prepare(`DELETE FROM chat_presence WHERE last_seen < datetime('now', '-${PRESENCE_PRUNE_MINUTES} minutes')`)
    ]);

    // 2. Fetch presence (active within last 60s)
    const { results: presenceResults } = await env.DB.prepare(`
      SELECT u.id, u.username AS nick, u.display_name AS displayName, u.avatar_url AS avatar,
             CASE WHEN u.role IN ('admin', 'super_admin') THEN 1 ELSE 0 END AS isOp,
             p.last_seen AS lastSeen
        FROM chat_presence p
        JOIN users u ON u.id = p.user_id
       WHERE p.channel = ? AND p.last_seen >= datetime('now', '-${PRESENCE_ACTIVE_SECONDS} seconds')
       ORDER BY isOp DESC, u.username ASC
    `).bind(channel).all();

    const presence = (presenceResults || []).map((p: any) => ({
      nick: p.nick,
      displayName: p.displayName,
      avatar: p.avatar,
      isOp: Boolean(p.isOp),
      lastSeen: p.lastSeen
    }));

    if (action === 'presence' || action === 'who' || action === 'names') {
      return response({ success: true, channel, presence, transport: 'web' });
    }

    // 3. Fetch topic
    let topic = DEFAULT_TOPIC;
    try {
      const topicRow = await env.DB.prepare(`
        SELECT topic FROM chat_channels WHERE name = ?
      `).bind(channel).first();
      if (topicRow && typeof topicRow.topic === 'string') {
        topic = topicRow.topic;
      }
    } catch {}

    // 4. Fetch real messages (last 24h)
    const { results: messageResults } = await env.DB.prepare(`
      SELECT m.id, m.channel, u.username AS sender,
             COALESCE(m.message_type, 'PRIVMSG') AS type,
             m.text,
             CASE WHEN u.role IN ('admin', 'super_admin') THEN 1 ELSE 0 END AS isOp,
             m.created_at AS timestamp
        FROM chat_messages m
        JOIN users u ON u.id = m.user_id
       WHERE m.channel = ? AND m.created_at >= datetime('now', '-24 hours')
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT 100
    `).bind(channel).all();

    return response({
      success: true,
      channel,
      topic,
      presence,
      messages: messageResults || [],
      ttlHours: 24,
      transport: 'web'
    });
  } catch (error: any) {
    return response({ success: false, error: `Chat query failed: ${error.message}` }, 503);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse || !auth.user) {
    return auth.errorResponse || response({ success: false, error: 'Unauthorized: Valid authenticated session required' }, 401);
  }
  if (!env?.DB) return response({ success: false, error: 'Chat storage is unavailable.' }, 503);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return response({ success: false, error: 'Request body must be valid JSON.' }, 400);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || body?.action || 'message';
  const channel = String(body?.channel || url.searchParams.get('channel') || '#lounge');

  if (!CHANNEL.test(channel)) return response({ success: false, error: 'Invalid channel.' }, 400);

  // Heartbeat Action
  if (action === 'heartbeat') {
    try {
      await env.DB.prepare(`
        INSERT INTO chat_presence (user_id, channel, last_seen)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, channel) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
      `).bind(auth.user.id, channel).run();

      return response({
        success: true,
        heartbeat: true,
        channel,
        user: auth.user.username
      }, 200);
    } catch (error: any) {
      return response({ success: false, error: `Heartbeat failed: ${error.message}` }, 503);
    }
  }

  // Topic Update Action
  if (action === 'topic') {
    const newTopic = String(body?.topic || '').trim();
    if (!newTopic) return response({ success: false, error: 'topic is required' }, 400);
    if (newTopic.length > 500) return response({ success: false, error: 'topic must be 500 characters or fewer' }, 400);

    try {
      const topicMsgId = `msg_${crypto.randomUUID().replaceAll('-', '')}`;
      const topicMsgText = `*** ${auth.user.username} changed topic to: "${newTopic}"`;

      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO chat_channels (name, topic, topic_setter, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(name) DO UPDATE SET topic = excluded.topic, topic_setter = excluded.topic_setter, updated_at = CURRENT_TIMESTAMP
        `).bind(channel, newTopic, auth.user.id),
        env.DB.prepare(`
          INSERT INTO chat_presence (user_id, channel, last_seen)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, channel) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
        `).bind(auth.user.id, channel),
        env.DB.prepare(`
          INSERT INTO chat_messages (id, channel, user_id, message_type, text, created_at)
          VALUES (?, ?, ?, 'TOPIC', ?, CURRENT_TIMESTAMP)
        `).bind(topicMsgId, channel, auth.user.id, topicMsgText)
      ]);

      return response({
        success: true,
        channel,
        topic: newTopic,
        setter: auth.user.username
      }, 200);
    } catch (error: any) {
      return response({ success: false, error: `Topic update failed: ${error.message}` }, 503);
    }
  }

  // Standard Message (PRIVMSG / ACTION)
  const type = String(body?.type || 'PRIVMSG').toUpperCase();
  const text = String(body?.text || '').trim();

  if (!ALLOWED_TYPES.has(type)) return response({ success: false, error: 'Unsupported message type.' }, 400);
  if (!text) return response({ success: false, error: 'text is required' }, 400);
  if (text.length > MAX_TEXT) return response({ success: false, error: `text must be ${MAX_TEXT} characters or fewer` }, 400);

  const messageId = `msg_${crypto.randomUUID().replaceAll('-', '')}`;
  try {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM chat_messages WHERE created_at < datetime('now', '-24 hours')`),
      env.DB.prepare(`
        INSERT INTO chat_messages (id, channel, user_id, message_type, text, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(messageId, channel, auth.user.id, type, text),
      env.DB.prepare(`
        INSERT INTO chat_presence (user_id, channel, last_seen)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, channel) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
      `).bind(auth.user.id, channel)
    ]);

    const stored = await env.DB.prepare(`
      SELECT m.id, m.channel, u.username AS sender,
             COALESCE(m.message_type, ?) AS type,
             m.text,
             CASE WHEN u.role IN ('admin', 'super_admin') THEN 1 ELSE 0 END AS isOp,
             m.created_at AS timestamp
        FROM chat_messages m
        JOIN users u ON u.id = m.user_id
       WHERE m.id = ?
    `).bind(type, messageId).first();

    if (!stored) return response({ success: false, error: 'Stored chat message could not be confirmed.' }, 503);
    return response({ success: true, message: stored }, 201);
  } catch (error: any) {
    return response({ success: false, error: `Chat persistence failed: ${error.message}` }, 503);
  }
};
