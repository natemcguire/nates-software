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
import { assertListingRoyaltyAllowed } from '../../src/lib/royaltyLiens';

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
        cp.royalty_bps AS royaltyBps,
        cp.resale_enabled AS resaleEnabled,
        cp.forking_enabled AS forkingEnabled,
        cp.status AS productStatus,
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
      LEFT JOIN commerce_products cp ON cp.app_id = a.id
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

    
    const inheritedLiensByRepository = new Map<string, Array<{ maker: string; bps: number }>>();
    const repositoryIds = Array.from(new Set(
      results.map((row: any) => row.canonicalRepositoryId || row.repositoryId).filter(Boolean)
    ));
    if (env?.DB && repositoryIds.length > 0) {
      const placeholders = repositoryIds.map(() => '?').join(', ');
      const lienResult = await env.DB.prepare(`
        SELECT l.holder_of_repository_id AS holderRepositoryId, l.bps, u.username AS maker
        FROM repository_fork_liens l
        JOIN users u ON u.id = l.ancestor_user_id
        WHERE l.holder_of_repository_id IN (${placeholders})
        ORDER BY l.holder_of_repository_id, l.depth DESC
      `).bind(...repositoryIds).all();
      for (const lien of lienResult.results || []) {
        const holderRepositoryId = String((lien as any).holderRepositoryId);
        const rows = inheritedLiensByRepository.get(holderRepositoryId) || [];
        rows.push({ maker: String((lien as any).maker), bps: Number((lien as any).bps) });
        inheritedLiensByRepository.set(holderRepositoryId, rows);
      }
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
      const royaltyBps = typeof r.royaltyBps === 'number' ? r.royaltyBps : 1000;
      const resaleEnabled = r.resaleEnabled === undefined || r.resaleEnabled === null
        ? true
        : Boolean(r.resaleEnabled);
      const forkingEnabled = r.forkingEnabled === undefined || r.forkingEnabled === null
        ? true
        : Boolean(r.forkingEnabled);
      if (!forkingEnabled) {
        delete binaries.source;
      }
      const inheritedLiens = repositoryId ? inheritedLiensByRepository.get(repositoryId) || [] : [];
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
        royaltyBps,
        resaleEnabled,
        forkingEnabled,
        inheritedLiens,
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

    
    const ownershipListing = await env.DB.prepare('SELECT id, creator_id FROM app_listings WHERE id = ?').bind(dropId).first();
    if (ownershipListing && ownershipListing.creator_id !== creatorId) {
      return Response.json({
        success: false,
        error: 'Forbidden: drop listing ID is owned by another maker'
      }, { status: 403 });
    }
    const existingListing = ownershipListing
      ? await env.DB.prepare(`
          SELECT id, creator_id, repository_id, deployment_state, deployment_error,
                 deployment_evidence_json, active_deployment_id, active_commit_oid
          FROM app_listings WHERE id = ?
        `).bind(dropId).first()
      : null;

    
    const mergedBinaries = typeof binaries === 'object' && binaries !== null ? { ...binaries } : {};
    if (liveUrl && typeof liveUrl === 'string' && liveUrl.trim().length > 0) {
      mergedBinaries.web = liveUrl.trim();
    }

    
    let initialDeploymentState = 'draft';
    
    
    
    
    
    const candidateRepositoryId: string | null = body.repositoryId ? String(body.repositoryId).trim() : null;
    let linkedRepositoryId: string | null = null;
    let linkedDefaultCommitOid: string | null = null;
    try {

      const repoRecord = await env.DB.prepare(`
        SELECT r.id, rf.commit_oid AS defaultCommitOid
        FROM repositories r
        LEFT JOIN repository_refs rf ON rf.repository_id = r.id AND rf.ref_name = r.default_ref
        WHERE (r.id = ? OR r.app_id = ? OR r.slug = ?) AND r.owner_user_id = ?
      `).bind(candidateRepositoryId || dropId, dropId, dropId, creatorId).first();
      if (repoRecord) {
        linkedRepositoryId = repoRecord.id;
        linkedDefaultCommitOid = (repoRecord as any).defaultCommitOid || null;
        if (repoRecord.defaultCommitOid) {
          initialDeploymentState = 'source_ready';
        }
      }
    } catch {}

    const initialDeploymentError = initialDeploymentState === 'draft'
      ? `No deployable revision exists for ${name.trim()}. Source has not been imported into GITSMITH and built by RIG.`
      : null;








    let repositoryHasProvenBuild = false;
    try {
      if (linkedRepositoryId) {


        const existingDeploymentStateRow = await env.DB.prepare(
          `SELECT deployment_state AS deploymentState FROM app_listings WHERE id = ?`
        ).bind(dropId).first();
        const hasDeployableListingState = Boolean(
          existingDeploymentStateRow &&
          ['deployable', 'active'].includes((existingDeploymentStateRow as any).deploymentState)
        );


        const healthyRevisionRow = hasDeployableListingState
          ? null
          : await env.DB.prepare(
              `SELECT id FROM deployment_revisions WHERE repository_id = ? AND status = 'healthy' LIMIT 1`
            ).bind(linkedRepositoryId).first();

        repositoryHasProvenBuild = hasDeployableListingState || Boolean(healthyRevisionRow);
      }
    } catch {}


    
    
    let newRepositoryStmt: any = null;
    let newRepositoryMemberStmt: any = null;
    let newRepositoryOutboxStmt: any = null;
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



      newRepositoryMemberStmt = env.DB.prepare(`
        INSERT INTO repository_members (repository_id, user_id, role, granted_by_user_id, created_at)
        SELECT ?, ?, 'owner', ?, CURRENT_TIMESTAMP
        WHERE EXISTS (SELECT 1 FROM app_listings WHERE id = ? AND creator_id = ?)
      `).bind(newRepositoryId, creatorId, creatorId, dropId, creatorId);



      const newRepositoryOutboxEventId = `evt_${crypto.randomUUID()}`;
      const newRepositoryOutboxPayload = JSON.stringify({
        repositoryId: newRepositoryId,
        ownerUserId: creatorId,
        slug: baseSlug,
        visibility: 'public',
        objectFormat: 'sha1',
        defaultRef: 'refs/heads/main',
        storageKey,
        status: 'provisioning',
        appId: dropId
      });
      newRepositoryOutboxStmt = env.DB.prepare(`
        INSERT INTO forge_outbox_events (id, aggregate_type, aggregate_id, event_type, payload, attempts, created_at)
        SELECT ?, 'repository', ?, 'repository.provisioning_requested', ?, 0, CURRENT_TIMESTAMP
        WHERE EXISTS (SELECT 1 FROM app_listings WHERE id = ? AND creator_id = ?)
      `).bind(newRepositoryOutboxEventId, newRepositoryId, newRepositoryOutboxPayload, dropId, creatorId);

      linkedRepositoryId = newRepositoryId;


    }

    const deploymentRanks: Record<string, number> = {
      draft: 0,
      source_ready: 1,
      building: 2,
      deployable: 3,
      active: 4
    };
    const existingDeploymentState = String((existingListing as any)?.deployment_state || '');
    const existingRepositoryId = (existingListing as any)?.repository_id || null;
    const existingActiveCommitOid = (existingListing as any)?.active_commit_oid || null;
    const sourceChanged = Boolean(existingListing && (
      (existingRepositoryId && linkedRepositoryId && existingRepositoryId !== linkedRepositoryId) ||
      (existingActiveCommitOid && linkedDefaultCommitOid && existingActiveCommitOid !== linkedDefaultCommitOid)
    ));
    const existingDeploymentRank = deploymentRanks[existingDeploymentState] ?? Number.POSITIVE_INFINITY;
    const initialDeploymentRank = deploymentRanks[initialDeploymentState] ?? 0;
    const preserveDeploymentMetadata = Boolean(
      existingListing && !sourceChanged && existingDeploymentRank >= initialDeploymentRank
    );
    const persistedDeploymentState = preserveDeploymentMetadata ? existingDeploymentState : initialDeploymentState;
    const deploymentStateUpdate = preserveDeploymentMetadata
      ? 'app_listings.deployment_state'
      : 'excluded.deployment_state';
    const deploymentErrorUpdate = preserveDeploymentMetadata
      ? 'app_listings.deployment_error'
      : 'excluded.deployment_error';
    const deploymentEvidenceUpdate = preserveDeploymentMetadata
      ? 'app_listings.deployment_evidence_json'
      : 'NULL';
    const activeDeploymentUpdate = preserveDeploymentMetadata
      ? 'app_listings.active_deployment_id'
      : 'NULL';
    const activeCommitUpdate = preserveDeploymentMetadata
      ? 'app_listings.active_commit_oid'
      : 'NULL';

    
    
    
    
    
    const rawRoyaltyBps = body.royaltyBps !== undefined ? body.royaltyBps : body.royalty_bps;
    let validatedRoyaltyBps = 1000;
    if (rawRoyaltyBps !== undefined && rawRoyaltyBps !== null && rawRoyaltyBps !== '') {
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

    const inheritedRoyaltyRow = linkedRepositoryId
      ? await env.DB.prepare(`
          SELECT COALESCE(SUM(bps), 0) AS inheritedRoyaltyBps
          FROM repository_fork_liens
          WHERE holder_of_repository_id = ?
        `).bind(linkedRepositoryId).first()
      : null;
    const inheritedRoyaltyBps = Number((inheritedRoyaltyRow as any)?.inheritedRoyaltyBps || 0);
    try {
      assertListingRoyaltyAllowed(inheritedRoyaltyBps, validatedRoyaltyBps);
    } catch (error: any) {
      return Response.json({ success: false, error: error.message }, { status: 422 });
    }

    const rawResaleEnabled = body.resaleEnabled !== undefined ? body.resaleEnabled : body.resale_enabled;
    if (rawResaleEnabled !== undefined && typeof rawResaleEnabled !== 'boolean') {
      return Response.json({ success: false, error: 'resaleEnabled must be a boolean' }, { status: 422 });
    }
    const rawForkingEnabled = body.forkingEnabled !== undefined ? body.forkingEnabled : body.forking_enabled;
    if (rawForkingEnabled !== undefined && typeof rawForkingEnabled !== 'boolean') {
      return Response.json({ success: false, error: 'forkingEnabled must be a boolean' }, { status: 422 });
    }
    const existingProductRights = ownershipListing
      ? await env.DB.prepare(`
          SELECT resale_enabled AS resaleEnabled, forking_enabled AS forkingEnabled
          FROM commerce_products WHERE app_id = ?
        `).bind(dropId).first()
      : null;
    const resaleEnabled = rawResaleEnabled === undefined
      ? ((existingProductRights as any)?.resaleEnabled === undefined ? true : Boolean((existingProductRights as any).resaleEnabled))
      : rawResaleEnabled;
    const forkingEnabled = rawForkingEnabled === undefined
      ? ((existingProductRights as any)?.forkingEnabled === undefined ? true : Boolean((existingProductRights as any).forkingEnabled))
      : rawForkingEnabled;

    if (linkedRepositoryId) {
      const blockedAncestor = await env.DB.prepare(`
        WITH RECURSIVE ancestors(repository_id) AS (
          SELECT parent_repository_id
          FROM repository_forks
          WHERE child_repository_id = ?
          UNION
          SELECT rf.parent_repository_id
          FROM repository_forks rf
          JOIN ancestors a ON rf.child_repository_id = a.repository_id
        )
        SELECT cp.app_id AS appId
        FROM ancestors a
        JOIN repositories ar ON ar.id = a.repository_id
        JOIN commerce_products cp
          ON cp.repository_id = a.repository_id
          OR (cp.repository_id IS NULL AND cp.app_id = ar.app_id)
        WHERE cp.resale_enabled = 0
        LIMIT 1
      `).bind(linkedRepositoryId).first();
      if (blockedAncestor) {
        return Response.json({
          success: false,
          error: 'This fork cannot be published for sale because an upstream author disabled fork resale.'
        }, { status: 403 });
      }
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
        deployment_state = ${deploymentStateUpdate},
        deployment_error = ${deploymentErrorUpdate},
        repository_id = COALESCE(excluded.repository_id, app_listings.repository_id),
        hostname = COALESCE(app_listings.hostname, excluded.hostname),
        deployment_evidence_json = ${deploymentEvidenceUpdate},
        active_deployment_id = ${activeDeploymentUpdate},
        active_commit_oid = ${activeCommitUpdate}
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
    const payoutAccount = await env.DB.prepare(`
      SELECT payouts_enabled AS payoutsEnabled
      FROM stripe_accounts
      WHERE user_id = ?
    `).bind(creatorId).first();
    const payoutsEnabled = Boolean((payoutAccount as any)?.payoutsEnabled);
    const honestProductStatus = repositoryHasProvenBuild && payoutsEnabled ? 'active' : 'draft';
    const productStmt = env.DB.prepare(`
      INSERT INTO commerce_products (app_id, repository_id, seller_user_id, price_cents, currency, status, royalty_bps, resale_enabled, forking_enabled)
      SELECT id, ?, creator_id, ?, 'usd', ?, ?, ?, ?
      FROM app_listings
      WHERE id = ? AND creator_id = ?
      ON CONFLICT(app_id) DO UPDATE SET
        repository_id = excluded.repository_id,
        price_cents = excluded.price_cents,
        status = excluded.status,
        royalty_bps = excluded.royalty_bps,
        resale_enabled = excluded.resale_enabled,
        forking_enabled = excluded.forking_enabled,
        updated_at = CURRENT_TIMESTAMP
      WHERE commerce_products.seller_user_id = excluded.seller_user_id
      RETURNING app_id
    `).bind(
      linkedRepositoryId,
      productPriceCents,
      honestProductStatus,
      validatedRoyaltyBps,
      resaleEnabled ? 1 : 0,
      forkingEnabled ? 1 : 0,
      dropId,
      creatorId
    );

    
    
    
    
    
    const statements: any[] = [listingStmt];
    if (newRepositoryStmt) statements.push(newRepositoryStmt);
    if (newRepositoryMemberStmt) statements.push(newRepositoryMemberStmt);
    if (newRepositoryOutboxStmt) statements.push(newRepositoryOutboxStmt);
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
      deploymentState: persistedDeploymentState,
      repositoryId: linkedRepositoryId,
      repositoryProvisioned: Boolean(newRepositoryStmt),
      productStatus: honestProductStatus,
      payoutsEnabled,
      batchWindow,
      message: honestProductStatus === 'active'
        ? 'Drop published successfully to Cloudflare D1'
        : !payoutsEnabled
          ? 'Drop saved as a draft — connect Stripe and enable payouts before this paid listing can go on sale.'
          : 'Drop published as a draft — link a deployable repository (slop push / GITSMITH build) before it can be sold as active.'
    });
  } catch (err: any) {
    console.error('HOTWIRE drop publication failed', err);
    return Response.json({ success: false, error: 'Failed to process drop submission' }, { status: 500 });
  }
};
