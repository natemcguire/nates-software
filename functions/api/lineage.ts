import { fetchLineageTree, resolveRepositoryIdForApp } from '../../src/lib/lineageDomain';

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
          'Cache-Control': 'public, max-age=60, s-maxage=120',
        },
      }
    );
  } catch (err: any) {
    console.error('[LINEAGE] tree error:', err?.message || err);
    return Response.json({ success: false, error: 'Failed to build lineage tree.' }, { status: 500 });
  }
};
