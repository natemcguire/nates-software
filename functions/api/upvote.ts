// POST /api/upvote - Atomic upvote counter in D1

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { appId } = await request.json();
    if (!appId) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    const { results } = await env.DB.prepare(`
      UPDATE app_listings
      SET upvotes = upvotes + 1
      WHERE id = ?
      RETURNING upvotes
    `).bind(appId).all();

    const newUpvotes = results?.[0]?.upvotes || 0;
    return Response.json({ success: true, upvotes: newUpvotes });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
