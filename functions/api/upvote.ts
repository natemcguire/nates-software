// GET /api/upvote - Viewer-scoped vote state inspection (have-I-voted read endpoint)
// POST /api/upvote - Atomic idempotent upvote counter in D1 with cryptographic voter hashing
import { validateAndHashVote, hashVoterKey } from '../../src/lib/hotwireBackend';
import { requireAuth, getSessionUser } from './_auth';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const appId = url.searchParams.get('appId');

    if (!env || !env.DB) {
      return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
    }

    const authUser = await getSessionUser(request, env);
    if (!authUser) {
      return Response.json({
        success: true,
        hasVoted: false,
        votedAppIds: []
      });
    }

    const secretSalt = env?.UPVOTE_HASH_SECRET;

    if (appId && appId.trim()) {
      const cleanAppId = appId.trim();
      const voterHash = await hashVoterKey(authUser.id, cleanAppId, secretSalt);
      const row = await env.DB.prepare(
        'SELECT 1 FROM drop_upvotes WHERE app_id = ? AND voter_hash = ?'
      ).bind(cleanAppId, voterHash).first();
      const hasVoted = Boolean(row);

      return Response.json({
        success: true,
        hasVoted,
        votedAppIds: hasVoted ? [cleanAppId] : []
      });
    }

    // Return all apps this viewer has voted on
    const { results } = await env.DB.prepare(
      'SELECT app_id, voter_hash FROM drop_upvotes'
    ).all();

    const votedAppIds: string[] = [];
    if (Array.isArray(results)) {
      for (const row of results) {
        const expectedHash = await hashVoterKey(authUser.id, row.app_id, secretSalt);
        if (row.voter_hash === expectedHash) {
          votedAppIds.push(row.app_id);
        }
      }
    }

    return Response.json({
      success: true,
      hasVoted: votedAppIds.length > 0,
      votedAppIds
    });
  } catch (err: any) {
    console.error('[UPVOTE] error:', err?.message || err);
    return Response.json({ success: false, error: 'Failed to inspect vote state' }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { appId } = body || {};
    if (!appId || typeof appId !== 'string' || !appId.trim()) {
      return Response.json({ success: false, error: 'appId is required' }, { status: 400 });
    }

    if (!env || !env.DB) {
      return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
    }

    const auth = await requireAuth(request, env);
    if (auth.errorResponse) return auth.errorResponse;

    const cleanAppId = appId.trim();
    const validation = await validateAndHashVote(cleanAppId, auth.user!.id, undefined, env.UPVOTE_HASH_SECRET);

    if (!validation.valid || !validation.voterHash) {
      return Response.json({ success: false, error: validation.error || 'Invalid vote payload' }, { status: 400 });
    }

    // Verify app exists
    const app = await env.DB.prepare("SELECT id, upvotes FROM app_listings WHERE id = ? AND listing_status = 'active'").bind(cleanAppId).first();
    if (!app) {
      return Response.json({ success: false, error: 'App listing not found' }, { status: 404 });
    }

    // D1 batch is one transaction. SQLite changes() in the second statement
    // reflects whether INSERT OR IGNORE inserted a new vote, so the vote record
    // and denormalized leaderboard count cannot diverge.
    const insertStmt = env.DB.prepare(`
      INSERT OR IGNORE INTO drop_upvotes (app_id, voter_hash) VALUES (?, ?)
    `).bind(cleanAppId, validation.voterHash);
    const incrementStmt = env.DB.prepare(`
      UPDATE app_listings
      SET upvotes = upvotes + 1
      WHERE id = ? AND changes() > 0
      RETURNING upvotes
    `).bind(cleanAppId);
    const countStmt = env.DB.prepare('SELECT upvotes FROM app_listings WHERE id = ?').bind(cleanAppId);
    const [insertResult, incrementResult, countResult] = await env.DB.batch([
      insertStmt,
      incrementStmt,
      countStmt
    ]);
    const inserted = (insertResult?.meta?.changes ?? 0) > 0;
    const currentUpvotes = Number(countResult?.results?.[0]?.upvotes ?? app.upvotes ?? 0);

    if (!inserted) {
      // Idempotent return - duplicate vote already counted
      return Response.json({
        success: true,
        alreadyVoted: true,
        upvotes: currentUpvotes,
        message: 'Vote already recorded for this drop.'
      });
    }

    return Response.json({
      success: true,
      alreadyVoted: false,
      upvotes: Number(incrementResult?.results?.[0]?.upvotes ?? currentUpvotes)
    });
  } catch (err: any) {
    console.error('[UPVOTE] error:', err?.message || err);
    return Response.json({ success: false, error: 'Upvote transaction failed' }, { status: 500 });
  }
};
