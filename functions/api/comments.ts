// GET /api/comments?app_id=dronehunter
// POST /api/comments - Submit feedback or maker commentary

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const appId = url.searchParams.get('app_id') || url.searchParams.get('appId');

    let query = `
      SELECT 
        c.id, c.app_id AS appId, c.text, c.upvotes, c.created_at AS time,
        u.username AS author, u.avatar_url AS avatar, u.is_verified_maker AS isMaker
      FROM comments c
      JOIN users u ON c.user_id = u.id
    `;
    if (env && env.DB) {
      if (appId) {
        query += ` WHERE c.app_id = ? ORDER BY c.created_at DESC`;
        const { results } = await env.DB.prepare(query).bind(appId).all();
        return Response.json({ success: true, comments: results || [] });
      } else {
        query += ` ORDER BY c.created_at DESC LIMIT 50`;
        const { results } = await env.DB.prepare(query).all();
        return Response.json({ success: true, comments: results || [] });
      }
    }
    return Response.json({ success: true, comments: [] });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { appId, text, author, avatar } = await request.json() as any;
    if (!appId || !text || text.trim().length === 0) {
      return Response.json({ success: false, error: 'appId and text are required' }, { status: 400 });
    }

    const cleanText = text.trim();
    const commentId = `c_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const rawAuthor = author || 'nate';
    const commentAuthor = rawAuthor.startsWith('@') ? rawAuthor : `@${rawAuthor}`;
    const commentAvatar = avatar || '⚡';
    const userId = `usr_${rawAuthor.replace(/^@/, '')}`;

    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO comments (id, app_id, user_id, text, upvotes)
          VALUES (?, ?, ?, ?, 1)
        `).bind(commentId, appId, userId, cleanText).run();
      } catch {}
    }

    return Response.json({
      success: true,
      commentId,
      comment: {
        id: commentId,
        appId,
        author: commentAuthor,
        avatar: commentAvatar,
        text: cleanText,
        time: 'Just now',
        upvotes: 1
      }
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
