// Functions API: /api/serve
// R2-Backed Static Application Artifact Server
// Serves built static artifacts for active application revisions

import { getMediaType } from '../../src/lib/rig/deployExecutor';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const appId = String(url.searchParams.get('app') || url.searchParams.get('appId') || '').trim();
    let assetPath = String(url.searchParams.get('path') || 'index.html').replace(/^\/+/, '').trim();

    if (!appId) {
      return json({ success: false, error: 'app parameter is required' }, 400);
    }

    if (!assetPath || assetPath === '') {
      assetPath = 'index.html';
    }

    // Safety check: Prevent traversal
    if (assetPath.includes('..') || assetPath.includes('\0')) {
      return json({ success: false, error: 'Invalid path' }, 400);
    }

    // 1. Verify app is active in D1
    if (env?.DB) {
      const listing = await env.DB.prepare(`
        SELECT a.id, a.deployment_state AS deploymentState, a.active_deployment_id AS activeDeploymentId,
               dr.status AS revisionStatus
        FROM app_listings a
        LEFT JOIN deployment_revisions dr ON dr.id = a.active_deployment_id
        WHERE a.id = ?
      `).bind(appId).first();

      if (!listing) {
        return json({ success: false, error: `App '${appId}' not found` }, 404);
      }

      if (listing.deploymentState !== 'active' || !listing.activeDeploymentId || listing.revisionStatus !== 'healthy') {
        return json({
          success: false,
          error: `App '${appId}' does not have an active verified deployment (current state: ${listing.deploymentState || 'draft'}).`
        }, 503);
      }

      // 2. Fetch from R2 STORAGE
      if (env?.STORAGE) {
        const revKey = `apps/${appId}/revisions/${listing.activeDeploymentId}/${assetPath}`;
        let object = await env.STORAGE.get(revKey);

        if (!object) {
          // Try fallback to index.html if path doesn't have an extension
          if (!pathHasExtension(assetPath)) {
            const indexKey = `apps/${appId}/revisions/${listing.activeDeploymentId}/${assetPath}/index.html`.replace(/\/+/g, '/');
            object = await env.STORAGE.get(indexKey);
          }
        }

        if (!object) {
          // Try fallback to live key
          const liveKey = `apps/${appId}/live/${assetPath}`;
          object = await env.STORAGE.get(liveKey);
        }

        if (object) {
          const mediaType = object.httpMetadata?.contentType || getMediaType(assetPath);
          return new Response(object.body, {
            status: 200,
            headers: {
              'Content-Type': mediaType,
              'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
              'ETag': object.httpEtag || `"${listing.activeDeploymentId}-${assetPath}"`
            }
          });
        }
      }
    }

    return json({
      success: false,
      error: `Asset '${assetPath}' not found for active deployment of '${appId}'.`
    }, 404);
  } catch (err: any) {
    console.error('[SERVE] error:', err?.message || err);
    return json({ success: false, error: 'Failed to serve deployed asset' }, 500);
  }
};

function pathHasExtension(p: string): boolean {
  const lastPart = p.split('/').pop() || '';
  return lastPart.includes('.') && !lastPart.startsWith('.');
}
