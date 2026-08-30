import { requireAuth } from './_auth';

const APP_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_COMMENT_LENGTH = 2000;

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  if (!env?.DB) return json({ success: false, error: 'Comment storage is unavailable.' }, 503);
  const appId = new URL(request.url).searchParams.get('app_id') || new URL(request.url).searchParams.get('appId');
  if (appId && !APP_ID.test(appId)) return json({ success: false, error: 'Invalid appId.' }, 400);

  try {
    const base = `SELECT c.id, c.app_id AS appId, c.text, c.upvotes,
      c.created_at AS time, u.username AS author, u.avatar_url AS avatar,
      u.is_verified_maker AS isMaker
      FROM comments c JOIN users u ON c.user_id = u.id`;
    const query = appId
      ? env.DB.prepare(`${base} WHERE c.app_id = ? ORDER BY c.created_at DESC, c.id ASC`).bind(appId)
      : env.DB.prepare(`${base} ORDER BY c.created_at DESC, c.id ASC LIMIT 50`);
    const { results } = await query.all();
    return json({ success: true, comments: results || [] });
  } catch (error: any) {
    return json({ success: false, error: `Comment query failed: ${error.message}` }, 503);
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse || !auth.user) return auth.errorResponse || json({ success: false, error: 'Unauthorized' }, 401);
  if (!env?.DB) return json({ success: false, error: 'Comment storage is unavailable.' }, 503);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Request body must be valid JSON.' }, 400);
  }
  const appId = String(body?.appId || '').trim();
  const text = String(body?.text || '').trim();
  if (!appId || !text) return json({ success: false, error: 'appId and text are required' }, 400);
  if (!APP_ID.test(appId)) return json({ success: false, error: 'Invalid appId.' }, 400);
  if (text.length > MAX_COMMENT_LENGTH) return json({ success: false, error: `text must be ${MAX_COMMENT_LENGTH} characters or fewer` }, 400);

  try {
    const app = await env.DB.prepare("SELECT id FROM app_listings WHERE id = ? AND listing_status = 'active'").bind(appId).first();
    if (!app) return json({ success: false, error: 'App listing not found.' }, 404);
    const commentId = `c_${crypto.randomUUID().replaceAll('-', '')}`;
    await env.DB.prepare(`INSERT INTO comments (id, app_id, user_id, text, upvotes)
      VALUES (?, ?, ?, ?, 0)`).bind(commentId, appId, auth.user.id, text).run();
    const comment = await env.DB.prepare(`SELECT c.id, c.app_id AS appId, c.text, c.upvotes,
      c.created_at AS time, u.username AS author, u.avatar_url AS avatar,
      u.is_verified_maker AS isMaker
      FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).bind(commentId).first();
    if (!comment) return json({ success: false, error: 'Stored comment could not be confirmed.' }, 503);
    return json({ success: true, commentId, comment }, 201);
  } catch (error: any) {
    return json({ success: false, error: `Comment persistence failed: ${error.message}` }, 503);
  }
};
