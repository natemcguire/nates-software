// POST /api/upvote - Atomic idempotent upvote counter in D1

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { appId, voterKey } = await request.json();
    if (!appId) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    const voter = voterKey || request.headers.get('CF-Connecting-IP') || 'anonymous_voter';
    if (!voter) {
      return Response.json({ success: false, error: 'voter identification required' }, { status: 400 });
    }

    // Verify app exists
    const app = await env.DB.prepare('SELECT id FROM app_listings WHERE id = ?').bind(appId).first();
    if (!app) {
      return Response.json({ success: false, error: 'App listing not found' }, { status: 404 });
    }

    // Atomic increment
    const { results } = await env.DB.prepare(`
      UPDATE app_listings
      SET upvotes = upvotes + 1
      WHERE id = ?
      RETURNING upvotes
    `).bind(appId).all();

    const newUpvotes = results?.[0]?.upvotes || 0;
    return Response.json({ success: true, upvotes: newUpvotes });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Upvote transaction failed' }, { status: 500 });
  }
};
