// GET /api/drops - Fetch all drops from D1
// POST /api/drops - Publish new drop to D1

export const onRequestGet = async ({ env }: { env: any }) => {
  try {
    const { results } = await env.DB.prepare(`
      SELECT 
        a.id, a.name, a.tagline, a.description, a.upvotes, a.forks, a.version, 
        a.license, a.price, a.moddability_score AS moddabilityScore, 
        a.merge_cleanliness AS mergeCleanliness, a.storage,
        a.screenshots, a.binaries, a.tags,
        u.username AS creator, u.avatar_url AS creatorAvatar
      FROM app_listings a
      JOIN users u ON a.creator_id = u.id
      ORDER BY a.upvotes DESC
    `).all();

    // Parse JSON fields
    const parsed = results.map((r: any) => ({
      ...r,
      screenshots: JSON.parse(r.screenshots || '[]'),
      binaries: JSON.parse(r.binaries || '{}'),
      tags: JSON.parse(r.tags || '[]'),
      comments: []
    }));

    return Response.json({ success: true, drops: parsed });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json();
    const { id, name, tagline, description, creator, version, license, price, tags, screenshots, binaries } = body;

    // Check if user exists or default to usr_nate
    const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(creator || 'nate').first();
    const creatorId = user ? user.id : 'usr_nate';

    await env.DB.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, tags, screenshots, binaries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        tagline = excluded.tagline,
        description = excluded.description,
        version = excluded.version,
        price = excluded.price,
        tags = excluded.tags,
        screenshots = excluded.screenshots,
        binaries = excluded.binaries
    `).bind(
      id, name, tagline, description, creatorId, version || 'v1.0.0', license || 'MIT', price || '$15',
      JSON.stringify(tags || []),
      JSON.stringify(screenshots || []),
      JSON.stringify(binaries || {})
    ).run();

    return Response.json({ success: true, message: 'Drop published successfully to Cloudflare D1' });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
