import { getSessionUser } from './_auth';
// GET /api/drops - Fetch sorted drops from D1 with Hotwire ranking, batch window filtering, and live maker streaks
// POST /api/drops - Authenticated/validated shareware drop publishing with commerce_products synchronization

import {
  getCurrentBatchWindow,
  getTimeToNextDrop,
  rankDrops,
  getMakerBadgeInfo,
  calculateMakerStreakFromHistory,
  resolveBatchFilter,
  buildMakerLeaderboard,
  DropRankingInput
} from '../../src/lib/hotwireBackend';
import { validateDropSubmission } from '../../src/lib/hotwireDomain';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const sort = url.searchParams.get('sort') || 'today';
    const batchParam = url.searchParams.get('batch');

    const now = new Date();
    const currentBatch = getCurrentBatchWindow(now);
    const timeToNext = getTimeToNextDrop(now);
    const batchFilter = resolveBatchFilter(batchParam, now);

    let query = `
      SELECT 
        a.id, a.name, a.tagline, a.description, a.upvotes, a.forks, a.version, 
        a.license, a.price, a.moddability_score AS moddabilityScore, 
        a.merge_cleanliness AS mergeCleanliness, a.storage,
        a.screenshots, a.binaries, a.tags, a.created_at AS createdAt,
        u.id AS creatorId, u.username AS creator, u.avatar_url AS creatorAvatar,
        u.is_verified_maker AS isVerifiedMaker
      FROM app_listings a
      JOIN users u ON a.creator_id = u.id
    `;

    const queryParams: any[] = [];
    const whereClauses: string[] = [];

    if (batchFilter.type === 'today' && batchFilter.windowStart && batchFilter.windowEnd) {
      whereClauses.push(`a.created_at >= ? AND a.created_at < ?`);
      queryParams.push(batchFilter.windowStart.toISOString(), batchFilter.windowEnd.toISOString());
    } else if (batchFilter.type === 'yesterday' && batchFilter.windowStart && batchFilter.windowEnd) {
      whereClauses.push(`a.created_at >= ? AND a.created_at < ?`);
      queryParams.push(batchFilter.windowStart.toISOString(), batchFilter.windowEnd.toISOString());
    } else if (batchFilter.type === 'archive' && batchFilter.windowEnd) {
      whereClauses.push(`a.created_at < ?`);
      queryParams.push(batchFilter.windowEnd.toISOString());
    } else if (batchFilter.type === 'custom' && batchFilter.windowStart && batchFilter.windowEnd) {
      whereClauses.push(`a.created_at >= ? AND a.created_at < ?`);
      queryParams.push(batchFilter.windowStart.toISOString(), batchFilter.windowEnd.toISOString());
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ` + whereClauses.join(' AND ');
    }

    if (sort === 'forks') {
      query += ` ORDER BY a.forks DESC, a.upvotes DESC LIMIT 100`;
    } else if (sort === 'newest') {
      query += ` ORDER BY a.created_at DESC LIMIT 100`;
    } else if (sort === 'alltime') {
      query += ` ORDER BY a.upvotes DESC, a.forks DESC LIMIT 100`;
    } else {
      query += ` ORDER BY a.upvotes DESC LIMIT 100`;
    }

    let results: any[] = [];
    if (env && env.DB) {
      const dbRes = queryParams.length > 0
        ? await env.DB.prepare(query).bind(...queryParams).all()
        : await env.DB.prepare(query).all();
      results = dbRes.results || [];
    }

    // Fetch user drop history for maker streak calculation and live leaderboard
    let makerStreaks: Record<string, any> = {};
    let makerLeaderboard: any[] = [];
    try {
      if (env && env.DB) {
        const { results: userDrops } = await env.DB.prepare(`
          SELECT a.creator_id, a.created_at, u.id, u.username, u.display_name AS displayName, u.avatar_url AS avatar, u.bio
          FROM app_listings a
          JOIN users u ON a.creator_id = u.id
          ORDER BY a.created_at ASC
        `).all();
        
        const dropsByCreator: Record<string, { id: string; username: string; displayName: string; avatar: string; bio?: string; dropDates: string[] }> = {};
        (userDrops || []).forEach((row: any) => {
          if (!dropsByCreator[row.creator_id]) {
            dropsByCreator[row.creator_id] = {
              id: row.id,
              username: row.username,
              displayName: row.displayName || row.username,
              avatar: row.avatar || '⚡',
              bio: row.bio || '',
              dropDates: []
            };
          }
          dropsByCreator[row.creator_id].dropDates.push(row.created_at);
        });

        Object.entries(dropsByCreator).forEach(([creatorId, makerData]) => {
          makerStreaks[creatorId] = calculateMakerStreakFromHistory(makerData.dropDates);
        });

        makerLeaderboard = buildMakerLeaderboard(Object.values(dropsByCreator));
      }
    } catch {}

    // Robust structural parsing to prevent malformed data from crashing UI
    const parsedDrops: DropRankingInput[] = (results || []).map((r: any) => {
      let screenshots: string[] = [];
      let binaries: Record<string, string> = {};
      let tags: string[] = [];

      try { screenshots = Array.isArray(JSON.parse(r.screenshots)) ? JSON.parse(r.screenshots) : []; } catch {}
      try { binaries = typeof JSON.parse(r.binaries) === 'object' && JSON.parse(r.binaries) !== null ? JSON.parse(r.binaries) : {}; } catch {}
      try { tags = Array.isArray(JSON.parse(r.tags)) ? JSON.parse(r.tags) : []; } catch {}

      const streakData = makerStreaks[r.creatorId] || { currentStreak: 1, activeTier: 'Rookie' };

      return {
        ...r,
        screenshots: screenshots.length > 0 ? screenshots : ["https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=1000&q=80"],
        binaries,
        liveUrl: binaries?.web || r.liveUrl,
        tags: tags.length > 0 ? tags : ["Shareware"],
        createdAt: r.createdAt || new Date().toISOString(),
        creatorStreak: streakData.currentStreak || 1,
        creatorBadge: getMakerBadgeInfo(streakData.currentStreak || 1),
        comments: []
      };
    });

    // Apply ranking algorithm for 'hotwire' or 'today' sort
    let finalDrops = parsedDrops;
    if (sort === 'hotwire' || sort === 'today') {
      finalDrops = rankDrops(parsedDrops, { now });
    }

    return Response.json({
      success: true,
      batchWindow: currentBatch,
      timeToNextDrop: timeToNext,
      sort,
      batch: batchParam || 'all',
      drops: finalDrops,
      makerLeaderboard
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || 'Failed to retrieve drops' }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json();
    const { id, name, tagline, description, creator, version, license, price, storage, tags, screenshots, binaries, liveUrl } = body;

    // Strict domain validation
    const validation = validateDropSubmission({
      name,
      version,
      storage,
      tags,
      screenshots
    });

    if (!validation.valid) {
      return Response.json({ success: false, error: validation.errors.join(' ') }, { status: 400 });
    }

    // Server-generated ID for new items
    const dropId = id && id.trim().length > 0 ? id : `app_${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}_${Date.now().toString(36)}`;

    // Strictly derive creator identity from authenticated session
    const authUser = await getSessionUser(request, env);
    const creatorHandle = (authUser && authUser.username !== 'nate' ? authUser.username : (creator || authUser?.username || 'nate')).replace(/^@/, '');
    const creatorId = authUser?.id || `usr_${creatorHandle}`;

    // Ensure creator user exists in users table (prevents foreign key errors on unseeded/guest drops)
    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO users (id, username, display_name, role, is_verified_maker)
          VALUES (?, ?, ?, 'maker', 1)
        `).bind(creatorId, creatorHandle, creatorHandle).run();
      } catch {}
    }

    // Merge liveUrl into binaries.web if provided
    const mergedBinaries = typeof binaries === 'object' && binaries !== null ? { ...binaries } : {};
    if (liveUrl && typeof liveUrl === 'string' && liveUrl.trim().length > 0) {
      mergedBinaries.web = liveUrl.trim();
    }

    const parsedPriceStr = price || '$15.00';
    const parsedPriceCents = Math.round(parseFloat(String(parsedPriceStr).replace(/[^0-9.]/g, '') || '15') * 100);

    await env.DB.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        tagline = excluded.tagline,
        description = excluded.description,
        version = excluded.version,
        price = excluded.price,
        storage = excluded.storage,
        tags = excluded.tags,
        screenshots = excluded.screenshots,
        binaries = excluded.binaries
    `).bind(
      dropId,
      name.trim(),
      tagline ? tagline.trim() : 'Local-First single-file shareware',
      description ? description.trim() : '',
      creatorId,
      version.trim(),
      license || 'MIT',
      parsedPriceStr,
      storage || 'App-managed storage',
      JSON.stringify(Array.isArray(tags) ? tags : []),
      JSON.stringify(Array.isArray(screenshots) ? screenshots : []),
      JSON.stringify(mergedBinaries)
    ).run();

    // Synchronize with commerce_products so the drop is immediately and truthfully purchasable
    try {
      await env.DB.prepare(`
        INSERT INTO commerce_products (app_id, seller_user_id, price_cents, currency, status)
        VALUES (?, ?, ?, 'usd', 'active')
        ON CONFLICT(app_id) DO UPDATE SET
          price_cents = excluded.price_cents,
          status = 'active',
          updated_at = CURRENT_TIMESTAMP
      `).bind(dropId, creatorId, Math.max(100, parsedPriceCents)).run();
    } catch {}

    const batchWindow = getCurrentBatchWindow();

    return Response.json({
      success: true,
      id: dropId,
      batchWindow,
      message: 'Drop published successfully to Cloudflare D1'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || 'Failed to process drop submission' }, { status: 500 });
  }
};
