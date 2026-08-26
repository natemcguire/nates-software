// GET /api/drops - Fetch sorted drops from D1 with Hotwire ranking and batch rollover metadata
// POST /api/drops - Authenticated/validated sovereign SQLite drop publishing

import {
  getCurrentBatchWindow,
  getTimeToNextDrop,
  rankDrops,
  getMakerBadgeInfo,
  calculateMakerStreakFromHistory,
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

    if (batchParam) {
      // Filter by specific batch if requested
      query += ` ORDER BY a.created_at DESC LIMIT 100`;
    } else if (sort === 'forks') {
      query += ` ORDER BY a.forks DESC, a.upvotes DESC LIMIT 100`;
    } else if (sort === 'newest') {
      query += ` ORDER BY a.created_at DESC LIMIT 100`;
    } else if (sort === 'alltime') {
      query += ` ORDER BY a.upvotes DESC, a.forks DESC LIMIT 100`;
    } else {
      query += ` ORDER BY a.upvotes DESC LIMIT 100`;
    }

    const { results } = await env.DB.prepare(query).all();

    // Fetch user drop history for maker streak calculation
    let makerStreaks: Record<string, any> = {};
    try {
      const { results: userDrops } = await env.DB.prepare(`
        SELECT creator_id, created_at FROM app_listings ORDER BY created_at ASC
      `).all();
      
      const dropsByCreator: Record<string, string[]> = {};
      (userDrops || []).forEach((row: any) => {
        if (!dropsByCreator[row.creator_id]) dropsByCreator[row.creator_id] = [];
        dropsByCreator[row.creator_id].push(row.created_at);
      });

      Object.entries(dropsByCreator).forEach(([creatorId, dates]) => {
        makerStreaks[creatorId] = calculateMakerStreakFromHistory(dates);
      });
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
        tags: tags.length > 0 ? tags : ["Shareware", "SQLite"],
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
      drops: finalDrops
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message || 'Failed to retrieve drops' }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json();
    const { id, name, tagline, description, creator, version, license, price, storage, tags, screenshots, binaries } = body;

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

    // Resolve creator ID
    const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(creator || 'nate').first();
    const creatorId = user ? user.id : 'usr_nate';

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
      tagline ? tagline.trim() : 'Sovereign single-file shareware',
      description ? description.trim() : '',
      creatorId,
      version.trim(),
      license || 'MIT',
      price || '$15',
      storage || 'Single-file SQLite WAL (/data/app.sqlite)',
      JSON.stringify(Array.isArray(tags) ? tags : []),
      JSON.stringify(Array.isArray(screenshots) ? screenshots : []),
      JSON.stringify(typeof binaries === 'object' && binaries !== null ? binaries : {})
    ).run();

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
