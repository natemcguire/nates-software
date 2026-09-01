// GET /api/marketplace/opportunities
//
// Fix 2 (INBOX marketplace) — discoverable contribution marketplace, part 1.
//
// Public, read-only projection of repositories that currently have room for
// new contributor grants: grantable_bps > 0 AND remaining (grantable_bps -
// SUM(active+pending contributor_shares.basis_points)) > 0. This is the
// "opportunities board" makers and contributors browse to find apps that are
// still accepting merged-PR revenue-share grants.
//
// No auth required (this is a discovery surface, same trust level as the
// public HOTWIRE drop list) and no PII is exposed: only public repo/app
// identity (slug, app name, owner USERNAME — already public everywhere else
// on the site) plus the numeric grant-room fields. No emails, no Stripe
// account ids, no session data.

export interface MarketplaceOpportunity {
  repositoryId: string;
  appId: string | null;
  appName: string | null;
  ownerUsername: string | null;
  repoSlug: string;
  grantableBps: number;
  grantedBps: number;
  remainingBps: number;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  if (!env?.DB) {
    return Response.json(
      { success: false, error: 'Marketplace service is unavailable' },
      { status: 503 }
    );
  }

  try {
    const url = new URL(request.url);
    // Optional cap so a maker/browser can request a smaller page; defaults to
    // a sane bound so this never returns an unbounded table scan payload.
    const limitParam = parseInt(url.searchParams.get('limit') || '', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : 100;

    const { results } = await env.DB.prepare(`
      SELECT
        r.id AS repositoryId,
        r.app_id AS appId,
        r.slug AS repoSlug,
        r.grantable_bps AS grantableBps,
        u.username AS ownerUsername,
        a.name AS appName,
        COALESCE((
          SELECT SUM(cs.basis_points)
          FROM contributor_shares cs
          WHERE cs.repository_id = r.id AND cs.status IN ('active', 'pending')
        ), 0) AS grantedBps
      FROM repositories r
      JOIN users u ON u.id = r.owner_user_id
      LEFT JOIN app_listings a ON a.id = r.app_id
      WHERE r.status != 'quarantined'
        AND r.grantable_bps > 0
      ORDER BY r.grantable_bps DESC, r.created_at ASC
      LIMIT ?
    `).bind(limit).all();

    const opportunities: MarketplaceOpportunity[] = (results || [])
      .map((row: any) => {
        const grantableBps = Number(row.grantableBps) || 0;
        const grantedBps = Number(row.grantedBps) || 0;
        const remainingBps = Math.max(0, grantableBps - grantedBps);
        return {
          repositoryId: row.repositoryId,
          appId: row.appId ?? null,
          appName: row.appName ?? null,
          ownerUsername: row.ownerUsername ?? null,
          repoSlug: row.repoSlug,
          grantableBps,
          grantedBps,
          remainingBps
        };
      })
      // Only surface genuine room — a repo that has granted its entire pool
      // is not an "opportunity" anymore, even though grantable_bps > 0.
      .filter((opp: MarketplaceOpportunity) => opp.remainingBps > 0);

    return Response.json({ success: true, opportunities });
  } catch (error: any) {
    console.error('[MARKETPLACE OPPORTUNITIES ERROR]', error);
    return Response.json(
      { success: false, error: 'Failed to load marketplace opportunities' },
      { status: 500 }
    );
  }
};

export const onRequestPost = async () => Response.json(
  { success: false, error: 'Method not allowed' },
  { status: 405, headers: { Allow: 'GET' } }
);
