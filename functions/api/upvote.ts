// POST /api/upvote - Atomic idempotent upvote counter in D1 with cryptographic voter hashing
import { validateAndHashVote } from '../../src/lib/hotwireBackend';

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { appId, voterKey } = await request.json();
    if (!appId) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'anonymous_ip';
    const validation = await validateAndHashVote(appId, clientIp, voterKey);

    if (!validation.valid || !validation.voterHash) {
      return Response.json({ success: false, error: validation.error || 'Invalid vote payload' }, { status: 400 });
    }

    // Verify app exists
    const app = await env.DB.prepare('SELECT id, upvotes FROM app_listings WHERE id = ?').bind(appId).first();
    if (!app) {
      return Response.json({ success: false, error: 'App listing not found' }, { status: 404 });
    }

    // Attempt to record in idempotent vote registry if table exists
    try {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS drop_upvotes (
          app_id TEXT NOT NULL,
          voter_hash TEXT NOT NULL,
          voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (app_id, voter_hash)
        )
      `).run();

      const existing = await env.DB.prepare(`
        SELECT 1 FROM drop_upvotes WHERE app_id = ? AND voter_hash = ?
      `).bind(appId, validation.voterHash).first();

      if (existing) {
        // Idempotent return - vote already counted
        return Response.json({
          success: true,
          alreadyVoted: true,
          upvotes: app.upvotes,
          voterHash: validation.voterHash,
          message: 'Vote already recorded for this drop.'
        });
      }

      await env.DB.prepare(`
        INSERT INTO drop_upvotes (app_id, voter_hash) VALUES (?, ?)
      `).bind(appId, validation.voterHash).run();
    } catch {
      // Fall through to update if table migration skipped
    }

    // Atomic increment
    const { results } = await env.DB.prepare(`
      UPDATE app_listings
      SET upvotes = upvotes + 1
      WHERE id = ?
      RETURNING upvotes
    `).bind(appId).all();

    const newUpvotes = results?.[0]?.upvotes || (app.upvotes + 1);
    return Response.json({
      success: true,
      alreadyVoted: false,
      upvotes: newUpvotes,
      voterHash: validation.voterHash
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || 'Upvote transaction failed' }, { status: 500 });
  }
};
