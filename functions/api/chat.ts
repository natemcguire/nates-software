// GET /api/chat?channel=#lounge
// POST /api/chat
// Ephemeral 24-Hour Sliding Window Auto-Purge

const TTL_24_HOURS_MS = 24 * 60 * 60 * 1000;

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel') || '#lounge';
    const cutoff = Date.now() - TTL_24_HOURS_MS;

    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            channel TEXT NOT NULL,
            sender TEXT NOT NULL,
            type TEXT NOT NULL,
            text TEXT NOT NULL,
            is_op INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
          );
        `).run();

        // 1. Auto-purge records older than 24 hours
        await env.DB.prepare(`
          DELETE FROM chat_messages WHERE created_at < ?
        `).bind(cutoff).run();

        // 2. Fetch only unexpired messages within the 24-hour window
        const { results } = await env.DB.prepare(`
          SELECT id, channel, sender, type, text, is_op AS isOp, created_at AS timestamp
          FROM chat_messages
          WHERE channel = ? AND created_at >= ?
          ORDER BY created_at ASC
          LIMIT 100
        `).bind(channel, cutoff).all();

        return Response.json({
          success: true,
          channel,
          messages: results || [],
          ttlHours: 24,
          server: 'irc.nates-software.com',
          port: 6667
        });
      } catch (dbErr) {
        // Fall back gracefully
      }
    }

    return Response.json({
      success: true,
      channel,
      messages: [],
      ttlHours: 24,
      server: 'irc.nates-software.com',
      port: 6667
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json() as any;
    const { channel = '#lounge', sender = 'nate', type = 'PRIVMSG', text, isOp = 0 } = body;

    if (!text || !text.trim()) {
      return Response.json({ success: false, error: 'text is required' }, { status: 400 });
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = Date.now();
    const cutoff = timestamp - TTL_24_HOURS_MS;

    if (env && env.DB) {
      try {
        // Auto-purge old logs before insert
        await env.DB.prepare(`
          DELETE FROM chat_messages WHERE created_at < ?
        `).bind(cutoff).run();

        await env.DB.prepare(`
          INSERT INTO chat_messages (id, channel, sender, type, text, is_op, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(messageId, channel, sender, type, text.trim(), isOp ? 1 : 0, timestamp).run();
      } catch (dbErr) {
        // Continue if DB unavailable
      }
    }

    return Response.json({
      success: true,
      message: {
        id: messageId,
        channel,
        sender,
        type,
        text: text.trim(),
        isOp: !!isOp,
        timestamp: new Date(timestamp).toISOString()
      }
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
