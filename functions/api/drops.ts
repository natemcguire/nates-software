import { requireAuth, getSessionUser } from './_auth';

import {
  getCurrentBatchWindow,
  getTimeToNextDrop,
  rankDrops,
  getMakerBadgeInfo,
  calculateMakerStreakFromHistory,
  resolveBatchFilter,
  buildMakerLeaderboard,
  hashVoterKey,
  DropRankingInput
} from '../../src/lib/hotwireBackend';
import { validateDropSubmission, parseAndValidatePrice, RESERVED_APP_IDS } from '../../src/lib/hotwireDomain';
import { buildRepositoryStorageKey } from '../../src/lib/forgeDomain';

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
        a.origin_kind AS originKind, a.origin_ref AS originRef, a.hostname AS hostname,
        a.repository_id AS repositoryId,
        r.id AS canonicalRepositoryId,
        r.slug AS repoSlugName,
        r.visibility AS repoVisibility,
        r.status AS repoStatus,
        r.default_ref AS repoDefaultRef,
        r.grantable_bps AS grantable_bps,
        r.grantable_bps AS grantableBps,
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

    
    
    
    
    const baseWhere = `a.listing_status = 'active'`;
    let windowClause = '';
    const windowParams: any[] = [];
    if (batchFilter.type === 'today' && batchFilter.windowStart && batchFilter.windowEnd) {
      windowClause = `datetime(a.created_at) >= datetime(?) AND datetime(a.created_at) < datetime(?)`;
      windowParams.push(batchFilter.windowStart.toISOString(), batchFilter.windowEnd.toISOString());
    } else if (batchFilter.type === 'yesterday' && batchFilter.windowStart && batchFilter.windowEnd) {
      windowClause = `datetime(a.created_at) >= datetime(?) AND datetime(a.created_at) < datetime(?)`;
      windowParams.push(batchFilter.windowStart.toISOString(), batchFilter.windowEnd.toISOString());
    } else if (batchFilter.type === 'archive' && batchFilter.windowEnd) {
      windowClause = `datetime(a.created_at) < datetime(?)`;
      windowParams.push(batchFilter.windowEnd.toISOString());
    } else if (batchFilter.type === 'custom' && batchFilter.windowStart && batchFilter.windowEnd) {
      windowClause = `datetime(a.created_at) >= datetime(?) AND datetime(a.created_at) < datetime(?)`;
      windowParams.push(batchFilter.windowStart.toISOString(), batchFilter.windowEnd.toISOString());
    }

    const orderClause =
      sort === 'forks' ? ` ORDER BY a.forks DESC, a.upvotes DESC LIMIT 100`
      : sort === 'newest' ? ` ORDER BY a.created_at DESC LIMIT 100`
      : sort === 'alltime' ? ` ORDER BY a.upvotes DESC, a.forks DESC LIMIT 100`
      : ` ORDER BY a.upvotes DESC LIMIT 100`;

    const buildQuery = (where: string) => `${query} WHERE ${where}${orderClause}`;

    let results: any[] = [];
    let windowFellBack = false;
    if (env && env.DB) {
      const scopedWhere = windowClause ? `${baseWhere} AND ${windowClause}` : baseWhere;
      const scopedQuery = buildQuery(scopedWhere);
      const dbRes = windowParams.length > 0
        ? await env.DB.prepare(scopedQuery).bind(...windowParams).all()
        : await env.DB.prepare(scopedQuery).all();
      results = dbRes.results || [];

      
      
      
      
      const isCurrentBoard = batchFilter.type === 'today' || batchFilter.type === 'yesterday';
      if (results.length === 0 && windowClause && isCurrentBoard) {
        const allRes = await env.DB.prepare(buildQuery(baseWhere)).all();
        results = allRes.results || [];
        windowFellBack = results.length > 0;
      }
    }

    
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

    
    const authUser = await getSessionUser(request, env);
    const viewerVotedAppIds = new Set<string>();

    if (authUser && env && env.DB && results && results.length > 0) {
      try {
        const secretSalt = env.UPVOTE_HASH_SECRET;
        const { results: voteRows } = await env.DB.prepare(
          'SELECT app_id, voter_hash FROM drop_upvotes'
        ).all();

        if (Array.isArray(voteRows)) {
          for (const row of voteRows) {
            const expectedHash = await hashVoterKey(authUser.id, row.app_id, secretSalt);
            if (row.voter_hash === expectedHash) {
              viewerVotedAppIds.add(row.app_id);
            }
          }
        }
      } catch {}
    }

    
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
      const resolvedOwner = r.repoOwnerUsername || r.creator || null;
      const resolvedSlugName = r.repoSlugName;
      const repoSlug = resolvedSlugName ? (resolvedOwner ? `${resolvedOwner}/${resolvedSlugName}` : resolvedSlugName) : null;
      const repoName = resolvedSlugName || null;
      const repoOwner = r.repoOwnerUsername || (resolvedSlugName ? resolvedOwner : null);
      const repoHeadCommitOid = r.repoHeadCommitOid || null;
      const repoVisibility = r.repoVisibility || null;
      const repoStatus = r.repoStatus || null;
      const repoDefaultRef = r.repoDefaultRef || null;
      const repositoryId = r.canonicalRepositoryId || r.repositoryId || null;
      const grantable_bps = typeof r.grantable_bps === 'number'
        ? r.grantable_bps
        : (typeof r.grantableBps === 'number' ? r.grantableBps : 0);
      const grantableBps = grantable_bps;
      const hasVoted = viewerVotedAppIds.has(r.id);

      
      
      
      
      
      
      
      
      
      const originHost = (r.hostname || r.id) as string;
      const isActive = r.deploymentState === 'active' && Boolean(r.activeDeploymentId);
      const isStatic = !r.originKind || r.originKind === 'r2_static';
      const activeServeUrl = isActive
        ? (isStatic
            ? `/serve/${encodeURIComponent(r.id)}/index.html`
            : `https://${originHost}.nates-software.com/`)
        : undefined;
      const resolvedLiveUrl = binaries?.web || r.liveUrl || activeServeUrl;

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
        grantable_bps,
        grantableBps,
        screenshots,
        binaries,
        liveUrl: resolvedLiveUrl,
        tags,
        createdAt: r.createdAt || new Date().toISOString(),
        creatorStreak: streakData.currentStreak || 1,
        creatorBadge: getMakerBadgeInfo(streakData.currentStreak || 1),
        hasVoted,
        comments: []
      };
    });

    
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
      
      
      showingAllApps: windowFellBack,
      drops: finalDrops,
      makerLeaderboard,
      votedAppIds: Array.from(viewerVotedAppIds)
    });
  } catch (err: any) {
    
    console.error('[DROPS] error:', err?.message || err);
    return Response.json({ success: false, error: 'Failed to retrieve drops' }, { status: 500 });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    if (!env || !env.DB) {
      return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
    }

    
    const { user: authUser, errorResponse } = await requireAuth(request, env);
    if (errorResponse || !authUser) {
      return errorResponse || Response.json({ success: false, error: 'Unauthorized: Valid authenticated session required' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ success: false, error: 'Request body must be valid JSON object' }, { status: 400 });
    }
    const { id, name, tagline, description, version, license, price, storage, tags, screenshots, binaries, liveUrl } = body;

    
    let dropId: string;
    if (id && typeof id === 'string' && id.trim().length > 0) {
      dropId = id.trim();
    } else {
      const cleanSlug = typeof name === 'string'
        ? name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        : 'drop';
      dropId = `app_${cleanSlug || 'drop'}_${Date.now().toString(36)}`;
    }

    
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

    
    
    
    
    
    
    
    
    
    
    
    if (RESERVED_APP_IDS.has(dropId.toLowerCase())) {
      return Response.json({
        success: false,
        error: `Drop ID '${dropId}' is reserved and cannot be used.`
      }, { status: 400 });
    }

    
    const priceValidation = parseAndValidatePrice(price);
    if (!priceValidation.valid) {
      return Response.json({ success: false, error: priceValidation.error || 'Invalid price' }, { status: 400 });
    }

    
    const creatorId = authUser.id;

    
    const existingListing = await env.DB.prepare('SELECT id, creator_id FROM app_listings WHERE id = ?').bind(dropId).first();
    if (existingListing && existingListing.creator_id !== creatorId) {
      return Response.json({
        success: false,
        error: 'Forbidden: drop listing ID is owned by another maker'
      }, { status: 403 });
    }

    
    const mergedBinaries = typeof binaries === 'object' && binaries !== null ? { ...binaries } : {};
    if (liveUrl && typeof liveUrl === 'string' && liveUrl.trim().length > 0) {
      mergedBinaries.web = liveUrl.trim();
    }

    
    let initialDeploymentState = 'draft';
    
    
    
    
    
    const candidateRepositoryId: string | null = body.repositoryId ? String(body.repositoryId).trim() : null;
    let linkedRepositoryId: string | null = null;
    let repositoryHasCommit = false;
    try {
      
      const repoRecord = await env.DB.prepare(`
        SELECT r.id, rf.commit_oid AS defaultCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
        WHERE (r.id = ? OR r.app_id = ? OR r.slug = ?) AND r.owner_user_id = ?
      `).bind(candidateRepositoryId || dropId, dropId, dropId, creatorId).first();
      if (repoRecord) {
        linkedRepositoryId = repoRecord.id;
        if (repoRecord.defaultCommitOid) {
          initialDeploymentState = 'source_ready';
          repositoryHasCommit = true;
        }
      }
    } catch {}

    const initialDeploymentError = initialDeploymentState === 'draft'
      ? `No deployable revision exists for ${name.trim()}. Source has not been imported into GITSMITH and built by RIG.`
      : null;

    
    
    
    
    
    
    let newRepositoryStmt: any = null;
    let newRepositoryId: string | null = null;
    if (!linkedRepositoryId) {
      newRepositoryId = `repo_${crypto.randomUUID()}`;
      
      
      
      const baseSlug = (dropId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'drop')
        .slice(0, 80) + '-' + newRepositoryId.slice(-8);
      const storageKey = buildRepositoryStorageKey(newRepositoryId);
      
      
      
      
      
      
      
      
      newRepositoryStmt = env.DB.prepare(`
        INSERT INTO repositories (
          id, app_id, owner_user_id, slug, visibility, object_format,
          default_ref, storage_key, status, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, 'public', 'sha1', 'refs/heads/main', ?, 'provisioning', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE EXISTS (SELECT 1 FROM app_listings WHERE id = ? AND creator_id = ?)
      `).bind(newRepositoryId, dropId, creatorId, baseSlug, storageKey, dropId, creatorId);
      linkedRepositoryId = newRepositoryId;
      
      
    }

    
    
    
    
    
    const rawRoyaltyBps = body.royaltyBps !== undefined ? body.royaltyBps : body.royalty_bps;
    let validatedRoyaltyBps = 0;
    if (rawRoyaltyBps !== undefined && rawRoyaltyBps !== null) {
      if (typeof rawRoyaltyBps !== 'number' || !Number.isSafeInteger(rawRoyaltyBps)) {
        return Response.json({
          success: false,
          error: 'royaltyBps must be an integer between 0 and 10000'
        }, { status: 422 });
      }
      if (rawRoyaltyBps < 0 || rawRoyaltyBps > 10000) {
        return Response.json({
          success: false,
          error: 'royaltyBps must be between 0 and 10000'
        }, { status: 422 });
      }
      validatedRoyaltyBps = rawRoyaltyBps;
    }

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    const listingStmt = env.DB.prepare(`
      INSERT INTO app_listings (id, name, tagline, description, creator_id, version, license, price, storage, tags, screenshots, binaries, listing_status, deployment_state, deployment_error, repository_id, hostname)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
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
        hostname = COALESCE(app_listings.hostname, excluded.hostname),
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
      
      
      newRepositoryStmt ? null : linkedRepositoryId,
      dropId
    );

    const linkRepositoryToListingStmt = newRepositoryStmt
      ? env.DB.prepare(`UPDATE app_listings SET repository_id = ? WHERE id = ? AND creator_id = ?`)
          .bind(newRepositoryId, dropId, creatorId)
      : null;

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    const productPriceCents = priceValidation.priceCents;
    const honestProductStatus = repositoryHasCommit ? 'active' : 'draft';
    const productStmt = env.DB.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps)
      SELECT id, ?, creator_id, ?, 'usd', ?, ?
      FROM app_listings
      WHERE id = ? AND creator_id = ?
      ON CONFLICT(app_id) DO UPDATE SET
        repository_id = excluded.repository_id,
        price_cents = excluded.price_cents,
        status = excluded.status,
        royalty_bps = excluded.royalty_bps,
        updated_at = CURRENT_TIMESTAMP
      WHERE commerce_products.seller_user_id = excluded.seller_user_id
      RETURNING app_id
    `).bind(linkedRepositoryId, productPriceCents, honestProductStatus, validatedRoyaltyBps, dropId, creatorId);

    
    
    
    
    
    const statements: any[] = [listingStmt];
    if (newRepositoryStmt) statements.push(newRepositoryStmt);
    if (linkRepositoryToListingStmt) statements.push(linkRepositoryToListingStmt);
    statements.push(productStmt);

    const batchResults = await env.DB.batch(statements);
    if (!batchResults || batchResults.length < statements.length || batchResults.some((r: any) => !r.success)) {
      return Response.json({ success: false, error: 'Failed to atomically persist listing and commerce product' }, { status: 500 });
    }
    const productResultIdx = statements.indexOf(productStmt);
    const listingWritten = Boolean(batchResults?.[0]?.results?.[0]);
    const productWritten = Boolean(batchResults?.[productResultIdx]?.results?.[0]);
    if (!listingWritten || !productWritten) {
      return Response.json({ success: false, error: 'Drop ID was claimed concurrently by another maker' }, { status: 409 });
    }

    const batchWindow = getCurrentBatchWindow();

    return Response.json({
      success: true,
      id: dropId,
      deploymentState: initialDeploymentState,
      repositoryId: linkedRepositoryId,
      repositoryProvisioned: Boolean(newRepositoryStmt),
      productStatus: honestProductStatus,
      batchWindow,
      message: honestProductStatus === 'active'
        ? 'Drop published successfully to Cloudflare D1'
        : 'Drop published as a draft — link a deployable repository (slop push / GITSMITH build) before it can be sold as active.'
    });
  } catch (err: any) {
    console.error('HOTWIRE drop publication failed', err);
    return Response.json({ success: false, error: 'Failed to process drop submission' }, { status: 500 });
  }
};
