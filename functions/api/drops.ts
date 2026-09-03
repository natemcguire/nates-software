import { requireAuth, getSessionUser } from './_auth';
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

    // Build an optional time-window clause for date-scoped batches. This is kept
    // SEPARATE from the base filter so the board can fall back to the full catalog when
    // the window is empty (Reddit-style: if there's nothing new, show what we have —
    // never a blank board).
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

      // Reddit-style fallback: the CURRENT board (today/yesterday) should never be blank
      // — if that window is empty, fall through to the full active catalog so we always
      // show the apps we have. Archive/custom are explicit historical queries where an
      // empty result is a legitimate answer, so they do NOT fall back.
      const isCurrentBoard = batchFilter.type === 'today' || batchFilter.type === 'yesterday';
      if (results.length === 0 && windowClause && isCurrentBoard) {
        const allRes = await env.DB.prepare(buildQuery(baseWhere)).all();
        results = allRes.results || [];
        windowFellBack = results.length > 0;
      }
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

    // Check viewer-scoped upvotes if authenticated
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

      // Resolve the app's real live URL for the in-app runner. An explicit binaries.web
      // wins. Otherwise, for an ACTIVE app the serve path depends on origin_kind:
      //  - r2_static → `/serve/<id>/index.html`. Its bare host <id>.nates-software.com is
      //    a Custom Domain on the MAIN Pages project and is EXCLUDED from the wildcard
      //    router, so that host serves the marketplace SPA, NOT the R2 bytes. The
      //    /serve/<id> Pages Function is the only thing that serves this app's R2 bytes.
      //    (This was the "American Gardener iframes the marketplace into itself" bug.)
      //  - worker/container → the wildcard router DOES proxy these at <host>.nates-
      //    software.com, so use the real host.
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
      // True when a date-scoped batch (e.g. today) was empty and we fell back to the
      // full active catalog — lets the UI honestly label it "showing all apps".
      showingAllApps: windowFellBack,
      drops: finalDrops,
      makerLeaderboard,
      votedAppIds: Array.from(viewerVotedAppIds)
    });
  } catch (err: any) {
    // Never leak internals to an unauthenticated public caller.
    console.error('[DROPS] error:', err?.message || err);
    return Response.json({ success: false, error: 'Failed to retrieve drops' }, { status: 500 });
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

    // SECURITY (Codex #5): reserved-name enforcement at the DB/creation
    // BOUNDARY, not only inside the pure validator. dropId is the
    // server-resolved id (client-supplied id is only ever a candidate —
    // trimmed above) that will become both app_listings.id and
    // app_listings.hostname, i.e. the literal <id>.nates-software.com
    // subdomain the router serves. Redundant with validateDropSubmission's
    // internal RESERVED_APP_IDS check by design: this is the endpoint itself
    // refusing to write a reserved id/hostname, independent of validator
    // internals, so this guard survives even if validateDropSubmission's
    // rules ever drift. Migration 0035 adds the same rule as a DB trigger
    // as the final backstop for any other write path.
    if (RESERVED_APP_IDS.has(dropId.toLowerCase())) {
      return Response.json({
        success: false,
        error: `Drop ID '${dropId}' is reserved and cannot be used.`
      }, { status: 400 });
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
    // The client-supplied repositoryId is only a CANDIDATE. linkedRepositoryId
    // is set below strictly from an ownership-verified lookup — it must never
    // retain the raw client value, or a maker could link (and write
    // grantable_bps onto) a repository owned by someone else (a cross-user
    // economic write). Unowned / unknown candidate => stays null (no link).
    const candidateRepositoryId: string | null = body.repositoryId ? String(body.repositoryId).trim() : null;
    let linkedRepositoryId: string | null = null;
    let repositoryHasCommit = false;
    try {
      // Only ever link a repository the AUTHENTICATED maker owns (owner_user_id = creatorId).
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

    // Fix 1 (HOTWIRE #6): provision the real product loop. If the maker has no
    // repository linked yet, commission one now (server-derived owner, honest
    // 'provisioning' status — no git objects exist yet, so it is NOT 'active')
    // so the drop is actually forkable and has a lineage root the moment it's
    // published. This is inserted into the SAME atomic D1 batch as the listing
    // and commerce product below — never a partial write.
    let newRepositoryStmt: any = null;
    let newRepositoryId: string | null = null;
    if (!linkedRepositoryId) {
      newRepositoryId = `repo_${crypto.randomUUID()}`;
      // Suffix with a slice of the repository UUID so two drops whose names
      // slugify identically never collide on the (owner_user_id, slug) unique
      // index — no retry loop needed for a server-generated ID.
      const baseSlug = (dropId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'drop')
        .slice(0, 80) + '-' + newRepositoryId.slice(-8);
      const storageKey = buildRepositoryStorageKey(newRepositoryId);
      // Guarded with "WHERE EXISTS (... owned by creatorId)" instead of a bare
      // VALUES insert: the listing write above can lose an ownership race (a
      // concurrent claim on the same drop ID) and report 0 rows written
      // without D1 throwing — a bare INSERT here would still commit inside
      // the same batch/transaction and leave an ORPHANED repository owned by
      // the loser of the race. Tying this insert to the listing's actual
      // post-write ownership means it only ever lands together with a
      // genuinely successful, correctly-owned listing write.
      newRepositoryStmt = env.DB.prepare(`
        INSERT INTO repositories (
          id, app_id, owner_user_id, slug, visibility, object_format,
          default_ref, storage_key, status, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, 'public', 'sha1', 'refs/heads/main', ?, 'provisioning', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE EXISTS (SELECT 1 FROM app_listings WHERE id = ? AND creator_id = ?)
      `).bind(newRepositoryId, dropId, creatorId, baseSlug, storageKey, dropId, creatorId);
      linkedRepositoryId = newRepositoryId;
      // A freshly-provisioned repository has no commit yet — deployment state
      // stays honestly 'draft' regardless of the earlier lookup.
    }

    // Validate grantable pool basis points (Phase A)
    const hasGrantableField = 'grantableBps' in body || 'grantable_bps' in body;
    const rawGrantableBps = body.grantableBps !== undefined ? body.grantableBps : body.grantable_bps;
    let validatedGrantableBps: number | null = null;
    if (hasGrantableField && rawGrantableBps !== undefined) {
      if (typeof rawGrantableBps !== 'number' || !Number.isSafeInteger(rawGrantableBps)) {
        return Response.json({
          success: false,
          error: 'grantableBps must be an integer between 0 and 10000'
        }, { status: 422 });
      }
      if (rawGrantableBps < 0 || rawGrantableBps > 10000) {
        return Response.json({
          success: false,
          error: 'grantableBps must be between 0 and 10000'
        }, { status: 422 });
      }

      if (!linkedRepositoryId) {
        if (rawGrantableBps > 0) {
          return Response.json({
            success: false,
            error: 'Link a repository to set a grantable pool'
          }, { status: 422 });
        }
      } else {
        // Lineage lookup for root vs fork grantable cap. The cap MUST equal the
        // buy-path contributor carve cap (commerceDomain calculateAllocations:
        // makerBasisPoints - MAKER_FLOOR_BPS), i.e. root 9000-1000=8000, fork
        // 7000-1000=6000. Allowing a higher grantable pool here would let an
        // owner grant more than the buy path can carve, permanently failing
        // checkout closed once those grants activate (they are irrevocable).
        const forkEdge = await env.DB.prepare(
          'SELECT 1 FROM repository_forks WHERE child_repository_id = ? LIMIT 1'
        ).bind(linkedRepositoryId).first();
        const isRoot = !forkEdge;
        const maxAllowedBps = isRoot ? 8000 : 6000;

        if (rawGrantableBps > maxAllowedBps) {
          return Response.json({
            success: false,
            error: `Grantable pool ${rawGrantableBps} bps exceeds maximum allowable cap of ${maxAllowedBps} bps (${maxAllowedBps / 100}%) for ${isRoot ? 'root' : 'fork'} repository`
          }, { status: 422 });
        }

        // Lowering check: cannot drop pool below sum of active + pending grants (Decision #2)
        const grantedRow = await env.DB.prepare(`
          SELECT COALESCE(SUM(basis_points), 0) AS totalGranted
          FROM contributor_shares
          WHERE repository_id = ? AND status IN ('active', 'pending')
        `).bind(linkedRepositoryId).first();
        const totalGranted = Number(grantedRow?.totalGranted || 0);
        if (rawGrantableBps < totalGranted) {
          return Response.json({
            success: false,
            error: `${totalGranted / 100}% is already granted; can't drop the pool below that`
          }, { status: 422 });
        }

        validatedGrantableBps = rawGrantableBps;
      }
    }

    // Validate the maker-chosen per-listing royalty rate (Shareware, Restored
    // money model). Stored as integer basis points in [0, 10000] (0–100%).
    // NEVER hardcoded: a maker who omits it (blank field) is choosing 0%
    // (free to fork & resell). Mirrors the grantableBps validation above; also
    // accepts the snake_case `royalty_bps` alias for symmetry.
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

    // NOTE on ordering: repositories.app_id references app_listings(id), and
    // app_listings.repository_id references repositories(id) — a genuine
    // circular FK pair. When we're provisioning a BRAND NEW repository in
    // this same request, the listing must be written FIRST with
    // repository_id NULL (so repositories.app_id has a row to point at),
    // THEN the repository, THEN a follow-up UPDATE binds repository_id onto
    // the listing. All of this stays inside the one atomic D1 batch below —
    // still never a partial/fake write, just FK-legal statement order.
    // SECURITY (Codex #5): hostname is the router's AUTHORITATIVE host-match
    // column (`WHERE hostname = ? OR id = ?`) and migration 0035 now enforces
    // a DB-level trigger rejecting NULL/reserved hostnames on every insert.
    // Explicitly bind hostname = dropId here so new listings never rely on
    // the router's `OR id = ?` fallback and never hit that trigger's
    // NULL-hostname rejection. dropId was already run through
    // validateDropSubmission() above (which rejects RESERVED_APP_IDS), so
    // this is defense-in-depth on top of the DB trigger, not the only guard.
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
      // A brand-new repository doesn't exist as a row yet — bind it onto the
      // listing in the follow-up UPDATE once it's been inserted below.
      newRepositoryStmt ? null : linkedRepositoryId,
      dropId
    );

    const linkRepositoryToListingStmt = newRepositoryStmt
      ? env.DB.prepare(`UPDATE app_listings SET repository_id = ? WHERE id = ? AND creator_id = ?`)
          .bind(newRepositoryId, dropId, creatorId)
      : null;

    // Synchronize with commerce_products so the product record exists the
    // moment a drop is published. Fix 1 (HOTWIRE #6): status must reflect
    // REAL readiness, never a fake 'active'. A product is only 'active'
    // (immediately purchasable) once its repository is genuinely deployable
    // (has a resolvable default-ref commit); otherwise it is honestly 'draft'
    // until GITSMITH/RIG actually produce a deployable revision.
    //
    // ETHOS (Shareware, Restored spec §3.7 — "prove-it" publish gate): a
    // Resale listing may only become purchasable once the platform has
    // actually watched its repo build/run at least once. You can only buy
    // software the platform has watched boot. `repositoryHasCommit` (set
    // above from a resolvable default_ref commit) is the sole source of
    // truth for that proof — this line is the enforcement point, and
    // functions/api/payments/create-intent.ts re-checks `status === 'active'`
    // at buy time as the second, independent half of the same invariant.
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

    // Statement order matters for FK legality: listing (repo_id NULL for a
    // new repo) -> new repository (app_id now resolvable) -> link update ->
    // product (repository_id now resolvable) -> optional grantable_bps.
    // All execute atomically in one D1 batch — if any leg fails, nothing is
    // persisted (never a partial/fake write).
    const statements: any[] = [listingStmt];
    if (newRepositoryStmt) statements.push(newRepositoryStmt);
    if (linkRepositoryToListingStmt) statements.push(linkRepositoryToListingStmt);
    statements.push(productStmt);
    if (linkedRepositoryId && validatedGrantableBps !== null) {
      statements.push(
        env.DB.prepare('UPDATE repositories SET grantable_bps = ? WHERE id = ?').bind(validatedGrantableBps, linkedRepositoryId)
      );
    }

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
