// GET /api/feed - RSS 2.0 & JSON Feed 1.1 Syndication for 12:01 AM Daily Drops
import { generateFeedResponse, rankDrops, DropRankingInput } from '../../src/lib/hotwireBackend';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const formatParam = url.searchParams.get('format');
    const format = formatParam === 'json' ? 'json' : formatParam === 'rss' ? 'rss' : 'auto';
    const acceptHeader = request.headers.get('Accept') || '';

    let drops: DropRankingInput[] = [];

    if (env && env.DB) {
      try {
        const { results } = await env.DB.prepare(`
          SELECT 
            a.id, a.name, a.tagline, a.description, a.upvotes, a.forks, a.version, 
            a.license, a.price, a.moddability_score AS moddabilityScore, 
            a.merge_cleanliness AS mergeCleanliness, a.storage,
            a.screenshots, a.binaries, a.tags, a.created_at AS createdAt,
            u.username AS creator, u.avatar_url AS creatorAvatar, u.is_verified_maker AS isVerifiedMaker
          FROM app_listings a
          JOIN users u ON a.creator_id = u.id
          ORDER BY a.created_at DESC
          LIMIT 50
        `).all();

        drops = (results || []).map((r: any) => {
          let screenshots: string[] = [];
          let binaries: Record<string, string> = {};
          let tags: string[] = [];

          try { screenshots = Array.isArray(JSON.parse(r.screenshots)) ? JSON.parse(r.screenshots) : []; } catch {}
          try { binaries = typeof JSON.parse(r.binaries) === 'object' && JSON.parse(r.binaries) !== null ? JSON.parse(r.binaries) : {}; } catch {}
          try { tags = Array.isArray(JSON.parse(r.tags)) ? JSON.parse(r.tags) : []; } catch {}

          return {
            ...r,
            screenshots,
            binaries,
            tags,
            createdAt: r.createdAt || new Date().toISOString()
          };
        });
      } catch (dbErr) {
        // Fallback if query fails
        drops = [];
      }
    }

    // Rank drops for the feed
    const rankedDrops = rankDrops(drops, { now: new Date() });

    const { body, contentType } = generateFeedResponse(
      rankedDrops.length > 0 ? rankedDrops : drops,
      format,
      request.url,
      acceptHeader
    );

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=60, s-maxage=300',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err: any) {
    return new Response(`Error generating feed: ${err.message || 'Internal error'}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};
