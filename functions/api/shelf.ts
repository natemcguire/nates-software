// GET /api/shelf
// POST /api/shelf - Claim or purchase software license in D1 (Strictly Session Authorized)

import { getSessionUser, requireAuth } from './_auth';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const authUser = await getSessionUser(request, env);
    const url = new URL(request.url);
    const requestedUsername = url.searchParams.get('username');

    let targetUserId = authUser?.id || 'usr_nate';

    if (env && env.DB) {
      if (requestedUsername && requestedUsername !== authUser?.username) {
        const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(requestedUsername).first();
        if (user) targetUserId = user.id as string;
      }

      const { results } = await env.DB.prepare(`
        SELECT s.id, s.license_key AS licenseKey, s.purchased_at AS purchasedDate,
               a.id AS appId, a.name, a.version, a.tagline
        FROM shelf_items s
        JOIN app_listings a ON s.app_id = a.id
        WHERE s.user_id = ?
      `).bind(targetUserId).all();

      return Response.json({ success: true, shelf: results || [] });
    }

    return Response.json({ success: true, shelf: [] });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;
    const sessionUser = auth.user!;

    const { appId } = await request.json() as any;
    if (!appId) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    if (env && env.DB) {
      const shelfId = `shelf_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      const licenseKey = `NSW-${appId.substring(0, 2).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString(36).substring(4).toUpperCase()}`;

      await env.DB.prepare(`
        INSERT INTO shelf_items (id, user_id, app_id, license_key)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, app_id) DO NOTHING
      `).bind(shelfId, sessionUser.id, appId, licenseKey).run();

      return Response.json({
        success: true,
        shelfId,
        licenseKey,
        message: 'App successfully added to your authenticated shelf'
      });
    }

    return Response.json({ success: true, message: 'Shelf updated in memory' });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
