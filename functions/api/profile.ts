// GET /api/profile?username=nate
// POST /api/profile

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const username = url.searchParams.get('username') || 'nate';

    const user = await env.DB.prepare(`
      SELECT id, username, display_name AS displayName, avatar_url AS avatar, bio, ssh_public_key AS sshKey, is_verified_maker AS isVerified
      FROM users
      WHERE username = ?
    `).bind(username).first();

    if (!user) {
      return Response.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Fetch user shelf items
    const { results: shelf } = await env.DB.prepare(`
      SELECT s.id, s.license_key AS licenseKey, s.purchased_at AS purchasedDate,
             a.id AS appId, a.name, a.version, a.tagline, a.screenshots, a.binaries,
             u.avatar_url AS creatorAvatar
      FROM shelf_items s
      JOIN app_listings a ON s.app_id = a.id
      JOIN users u ON a.creator_id = u.id
      WHERE s.user_id = ?
    `).bind(user.id).all();

    const parsedShelf = shelf.map((s: any) => ({
      ...s,
      screenshots: JSON.parse(s.screenshots || '[]'),
      binaries: JSON.parse(s.binaries || '{}'),
      localDbSize: '1.4 MB'
    }));

    return Response.json({ success: true, user, shelf: parsedShelf });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { username, displayName, avatar, bio, sshKey } = await request.json();

    await env.DB.prepare(`
      INSERT INTO users (id, username, display_name, avatar_url, bio, ssh_public_key, is_verified_maker)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(username) DO UPDATE SET
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        bio = excluded.bio,
        ssh_public_key = excluded.ssh_public_key
    `).bind(
      `usr_${username}`, username, displayName, avatar, bio, sshKey
    ).run();

    return Response.json({ success: true, message: 'Profile saved to Cloudflare D1' });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
