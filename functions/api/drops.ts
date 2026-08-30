import { requireAuth } from './_auth';
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
import { validateDropSubmission, parseAndValidatePrice } from '../../src/lib/hotwireDomain';

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
        a.listing_status AS listingStatus, a.deployment_state AS deploymentState,
        a.deployment_error AS deploymentError, a.deployment_evidence_json AS deploymentEvidenceJson,
        a.detected_project_type AS detectedProjectType, a.deployment_plan_json AS deploymentPlanJson,
        a.active_deployment_id AS activeDeploymentId, a.active_commit_oid AS activeCommitOid,
        a.repository_id AS repositoryId,
        r.id AS canonicalRepositoryId,
        r.slug AS repoSlugName,
        r.visibility AS repoVisibility,
        r.status AS repoStatus,
        r.default_ref AS repoDefaultRef,
        ru.username AS repoOwnerUsername,
        rf.commit_oid AS repoHeadCommitOid,
        u.id AS creatorId, u.username AS creator, u.avatar_url AS creatorAvatar,
        u.is_verified_maker AS isVerifiedMaker
      FROM app_listings a
      JOIN users u ON a.creator_id = u.id
      LEFT JOIN repositories r ON (
        r.id = a.repository_id
        OR (a.repository_id IS NULL AND r.id = (
          SELECT r2.id FROM repositories r2
          WHERE r2.app_id = a.id
          ORDER BY (CASE WHEN r2.status = 'active' THEN 0 ELSE 1 END), r2.created_at ASC
          LIMIT 1
        ))
      )
      LEFT JOIN users ru ON ru.id = r.owner_user_id
      LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = COALESCE(r.default_ref, 'refs/heads/main')
    `;

    const queryParams: any[] = [];
    const whereClauses: string[] = [`a.listing_status = 'active'`];

    if (batchFilter.type === 'today' && batchFilter.windowStart && batchFilter.windowEnd) {
      whereClauses.push(`datetime(a.created_at) >= datetime(?) AND datetime(a.created_at) < datetime(?)`);
      queryParams.push(batchFilter.windowStart.toISOString(), batchFilter.windowEnd.toISOString());
    } else if (batchFilter.type === 'yesterday' && batchFilter.windowStart && batchFilter.windowEnd) {
      whereClauses.push(`datetime(a.created_at) >= datetime(?) AND datetime(a.created_at) < datetime(?)`);
      queryParams.push(batchFilter.windowStart.toISOString(), batchFilter.windowEnd.toISOString());
    } else if (batchFilter.type === 'archive' && batchFilter.windowEnd) {
      whereClauses.push(`datetime(a.created_at) < datetime(?)`);
      queryParams.push(batchFilter.windowEnd.toISOString());
    } else if (batchFilter.type === 'custom' && batchFilter.windowStart && batchFilter.windowEnd) {
      whereClauses.push(`datetime(a.created_at) >= datetime(?) AND datetime(a.created_at) < datetime(?)`);
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
          WHERE a.listing_status = 'active'
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

      const hasCanonicalRepo = Boolean(r.canonicalRepositoryId || r.repositoryId);
      const isRepoActive = r.repoStatus === 'active';
      const resolvedOwner = r.repoOwnerUsername || r.creator || 'nate';
      const resolvedSlugName = r.repoSlugName;
      const repoSlug = resolvedSlugName ? `${resolvedOwner}/${resolvedSlugName}` : null;
      const repoName = resolvedSlugName || null;
      const repoOwner = r.repoOwnerUsername || (resolvedSlugName ? resolvedOwner : null);
      const repoHeadCommitOid = r.repoHeadCommitOid || null;
      const repoVisibility = r.repoVisibility || null;
      const repoStatus = r.repoStatus || null;
      const repoDefaultRef = r.repoDefaultRef || null;
      const repositoryId = r.canonicalRepositoryId || r.repositoryId || null;

      return {
        ...r,
        repositoryId,
        hasCanonicalRepo,
        isRepoActive,
        repoSlug,
        repoName,
        repoOwner,
        repoHeadCommitOid,
        repoVisibility,
        repoStatus,
        repoDefaultRef,
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
    if (!env || !env.DB) {
      return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
    }

    // Strictly require same-origin authenticated session
    const { user: authUser, errorResponse } = await requireAuth(request, env);
    if (errorResponse || !authUser) {
      return errorResponse || Response.json({ success: false, error: 'Unauthorized: Valid authenticated session required' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ success: false, error: 'Request body must be valid JSON object' }, { status: 400 });
    }
    const { id, name, tagline, description, version, license, price, storage, tags, screenshots, binaries, liveUrl } = body;

    // Server-generated ID for new items or sanitized provided ID
    let dropId: string;
    if (id && typeof id === 'string' && id.trim().length > 0) {
      dropId = id.trim();
    } else {
      const cleanSlug = typeof name === 'string'
        ? name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        : 'drop';
      dropId = `app_${cleanSlug || 'drop'}_${Date.now().toString(36)}`;
    }

    // Strict domain validation
    const validation = validateDropSubmission({
      id: dropId,
      name,
      version,
      storage,
      tags,
      screenshots
    });

    if (!validation.valid) {
      return Response.json({ success: false, error: validation.errors.join(' ') }, { status: 400 });
    }

    // Strict price validation
    const priceValidation = parseAndValidatePrice(price);
    if (!priceValidation.valid) {
      return Response.json({ success: false, error: priceValidation.error || 'Invalid price' }, { status: 400 });
    }

    // Strictly derive creator identity from authenticated session ONLY
    const creatorId = authUser.id;

    // Prevent one maker overwriting another maker's existing listing ID
    const existingListing = await env.DB.prepare('SELECT id, creator_id FROM app_listings WHERE id = ?').bind(dropId).first();
    if (existingListing && existingListing.creator_id !== creatorId) {
      return Response.json({
        success: false,
        error: 'Forbidden: drop listing ID is owned by another maker'
      }, { status: 403 });
    }

    // Merge liveUrl into binaries.web if provided
    const mergedBinaries = typeof binaries === 'object' && binaries !== null ? { ...binaries } : {};
    if (liveUrl && typeof liveUrl === 'string' && liveUrl.trim().length > 0) {
      mergedBinaries.web = liveUrl.trim();
    }

    // Determine initial deployment state: publication sets draft or source_ready (NEVER active)
    let initialDeploymentState = 'draft';
    let linkedRepositoryId: string | null = body.repositoryId ? String(body.repositoryId).trim() : null;
    try {
      const repoRecord = await env.DB.prepare(`
        SELECT r.id, rf.commit_oid AS defaultCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
        WHERE r.id = ? OR r.app_id = ? OR r.slug = ?
      `).bind(linkedRepositoryId || dropId, dropId, dropId).first();
      if (repoRecord) {
        linkedRepositoryId = repoRecord.id;
        if (repoRecord.defaultCommitOid) {
          initialDeploymentState = 'source_ready';
        }
      }
    } catch {}

    const initialDeploymentError = initialDeploymentState === 'draft'
      ? `No deployable revision exists for ${name.trim()}. Source has not been imported into GITSMITH and built by RIG.`
      : null;

    const listingStmt = env.DB.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, listing_status, deployment_state, deployment_error, repository_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        tagline = excluded.tagline,
        description = excluded.description,
        version = excluded.version,
        price = excluded.price,
        storage = excluded.storage,
        tags = excluded.tags,
        screenshots = excluded.screenshots,
        binaries = excluded.binaries,
        deployment_state = excluded.deployment_state,
        deployment_error = excluded.deployment_error,
        repository_id = COALESCE(excluded.repository_id, app_listings.repository_id),
        deployment_evidence_json = NULL,
        active_deployment_id = NULL,
        active_commit_oid = NULL
      WHERE app_listings.creator_id = excluded.creator_id
      RETURNING id, deployment_state
    `).bind(
      dropId,
      name.trim(),
      tagline ? String(tagline).trim() : 'Local-First single-file shareware',
      description ? String(description).trim() : '',
      creatorId,
      version.trim(),
      license || 'MIT',
      priceValidation.priceStr,
      storage || 'App-managed storage',
      JSON.stringify(Array.isArray(tags) ? tags : []),
      JSON.stringify(Array.isArray(screenshots) ? screenshots : []),
      JSON.stringify(mergedBinaries),
      initialDeploymentState,
      initialDeploymentError,
      linkedRepositoryId
    );

    // Synchronize with commerce_products so the drop is immediately purchasable
    // Atomic listing + commerce product write using D1 batch
    const productPriceCents = priceValidation.priceCents;
    const productStmt = env.DB.prepare(`
      INSERT INTO commerce_products (app_id, seller_user_id, price_cents, currency, status)
      SELECT id, creator_id, ?, 'usd', 'active'
      FROM app_listings
      WHERE id = ? AND creator_id = ?
      ON CONFLICT(app_id) DO UPDATE SET
        price_cents = excluded.price_cents,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
      WHERE commerce_products.seller_user_id = excluded.seller_user_id
      RETURNING app_id
    `).bind(productPriceCents, dropId, creatorId);

    const batchResults = await env.DB.batch([listingStmt, productStmt]);
    const listingWritten = Boolean(batchResults?.[0]?.results?.[0]);
    const productWritten = Boolean(batchResults?.[1]?.results?.[0]);
    if (!batchResults || batchResults.length < 2 || !batchResults[0].success || !batchResults[1].success) {
      return Response.json({ success: false, error: 'Failed to atomically persist listing and commerce product' }, { status: 500 });
    }
    if (!listingWritten || !productWritten) {
      return Response.json({ success: false, error: 'Drop ID was claimed concurrently by another maker' }, { status: 409 });
    }

    const batchWindow = getCurrentBatchWindow();

    return Response.json({
      success: true,
      id: dropId,
      deploymentState: initialDeploymentState,
      batchWindow,
      message: 'Drop published successfully to Cloudflare D1'
    });
  } catch (err: any) {
    console.error('HOTWIRE drop publication failed', err);
    return Response.json({ success: false, error: 'Failed to process drop submission' }, { status: 500 });
  }
};
