// POST /api/shelf - Claim or purchase software license in D1

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { appId, username } = await request.json();
    if (!appId) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

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
      message: 'App successfully added to your sovereign shelf'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to add item to shelf' }, { status: 500 });
  }
};
