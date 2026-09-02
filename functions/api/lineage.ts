// GET /api/lineage?appId=<id>   (or ?repositoryId=<id>)
//
// Public, read-only lineage tree for an app: the fork family (root → forks → forks) with
// each maker's handle, fork count, and real earnings. This is the data behind the
// embeddable tree and the share cards. It is intentionally UNAUTHENTICATED — a lineage
// tree is a public, shareable artifact — but it exposes only already-public facts
// (handles, app ids, fork structure, aggregate earnings), never emails, sessions, or keys.

import { fetchLineageTree, resolveRepositoryIdForApp } from '../../src/lib/lineageDomain';

// Ids are constrained to the same safe alphabet used across the platform (app ids,
// repo ids, usernames). Reject anything else before it ever reaches a bound query.
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function bad(error: string, status = 400) {
  return Response.json({ success: false, error }, { status });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    if (!env?.DB) {
      return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
    }
    const url = new URL(request.url);
    const appId = (url.searchParams.get('appId') || '').trim();
    const repositoryId = (url.searchParams.get('repositoryId') || '').trim();

    if (!appId && !repositoryId) {
      return bad('Provide an appId or repositoryId.');
    }
    if (appId && !SAFE_ID.test(appId)) return bad('Invalid appId.');
    if (repositoryId && !SAFE_ID.test(repositoryId)) return bad('Invalid repositoryId.');

    // Resolve to a repository id. An explicit repositoryId wins; otherwise map the app.
    let repoId: string | null = repositoryId || null;
    if (!repoId && appId) {
      repoId = await resolveRepositoryIdForApp(env.DB, appId);
    }
    if (!repoId) {
      return Response.json(
        { success: false, error: 'No repository found for that app — it may not have a forge repo yet.' },
        { status: 404 }
      );
    }

    const tree = await fetchLineageTree(env.DB, repoId);
    if (!tree) {
      return Response.json({ success: false, error: 'Lineage tree not found.' }, { status: 404 });
    }

    return Response.json(
      { success: true, tree },
      {
        headers: {
          // A shareable, public artifact — cache briefly at the edge so an embed on a
          // popular README doesn't hammer D1, while staying fresh enough for new forks.
          'Cache-Control': 'public, max-age=60, s-maxage=120',
        },
      }
    );
  } catch (err: any) {
    // Never leak internals to an unauthenticated caller.
    console.error('[LINEAGE] tree error:', err?.message || err);
    return Response.json({ success: false, error: 'Failed to build lineage tree.' }, { status: 500 });
  }
};
