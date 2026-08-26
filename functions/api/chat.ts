// GET /api/chat?channel=#lounge
// POST /api/chat

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const channel = url.searchParams.get('channel') || '#lounge';

    // In Cloudflare D1 or in-memory fallback
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

        const { results } = await env.DB.prepare(`
          SELECT id, channel, sender, type, text, is_op AS isOp, created_at AS timestamp
          FROM chat_messages
          WHERE channel = ?
          ORDER BY created_at ASC
          LIMIT 100
        `).bind(channel).all();

        return Response.json({
          success: true,
          channel,
          messages: results || [],
          server: 'irc.nates-software.com',
          port: 6667
        });
      } catch (dbErr) {
        // Fall back to success if table query fails
      }
    }

    return Response.json({
      success: true,
      channel,
      messages: [],
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

    if (env && env.DB) {
      try {
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
