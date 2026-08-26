// GET /api/comments?app_id=wallart
// POST /api/comments

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const appId = url.searchParams.get('app_id');

    let query = `
      SELECT 
        c.id, c.app_id, c.text, c.upvotes, c.created_at AS time,
        u.username AS author, u.avatar_url AS avatar, u.is_verified_maker AS isMaker
      FROM comments c
      JOIN users u ON c.user_id = u.id
    `;
    if (env && env.DB) {
      if (appId) {
        query += ` WHERE c.app_id = ? ORDER BY c.created_at DESC`;
        const { results } = await env.DB.prepare(query).bind(appId).all();
        return Response.json({ success: true, comments: results });
      } else {
        query += ` ORDER BY c.created_at DESC LIMIT 50`;
        const { results } = await env.DB.prepare(query).all();
        return Response.json({ success: true, comments: results });
      }
    }
    return Response.json({ success: true, comments: [] });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { appId, text, author } = await request.json();
    if (!appId || !text) {
      return Response.json({ success: false, error: 'appId and text are required' }, { status: 400 });
    }

    const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(author || 'nate').first();
    const userId = user ? user.id : 'usr_nate';
    const commentId = `c_${Date.now()}`;

    await env.DB.prepare(`
      INSERT INTO comments (id, app_id, user_id, text, upvotes)
      VALUES (?, ?, ?, ?, 1)
    `).bind(commentId, appId, userId, text).run();

    return Response.json({ success: true, commentId });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
