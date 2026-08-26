// GET /api/shelf?username=nate
// POST /api/shelf - Claim or purchase software license in D1

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const username = url.searchParams.get('username') || 'nate';
    const userId = url.searchParams.get('userId');

    if (env && env.DB) {
      let targetUserId = userId;
      if (!targetUserId) {
        const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
        targetUserId = user ? user.id : 'usr_nate';
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
    const { appId, username } = await request.json() as any;
    if (!appId) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    if (env && env.DB) {
      const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username || 'nate').first();
      const userId = user ? user.id : 'usr_nate';

      const shelfId = `shelf_${Date.now()}`;
      const licenseKey = `NSW-${appId.substring(0, 2).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString(36).substring(4).toUpperCase()}`;

      await env.DB.prepare(`
        INSERT INTO shelf_items (id, user_id, app_id, license_key)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(shelfId, userId, appId, licenseKey).run();

      return Response.json({
        success: true,
        shelfId,
        licenseKey,
        message: 'App successfully added to your shelf'
      });
    }

    return Response.json({
      success: true,
      shelfId: `shelf_${Date.now()}`,
      licenseKey: `NSW-${appId.substring(0, 2).toUpperCase()}-9812-77F2`,
      message: 'App successfully added to your shelf'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to add item to shelf' }, { status: 500 });
  }
};
