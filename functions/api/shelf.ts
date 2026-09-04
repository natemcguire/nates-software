import { requireAuth } from './_auth';
import { safePublishedArtifacts } from '../../src/lib/profileDomain';
import { handleVerify } from './shelf/verify';
import { listingSourceIsPrivate } from './_sourcePolicy';

export { handleVerify };

const unavailable = () => Response.json(
  { success: false, error: 'Shelf service is temporarily unavailable' },
  { status: 503 }
);

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  if (url.searchParams.get('action') === 'verify') {
    return handleVerify({ request, env });
  }

  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  if (!env?.DB) return unavailable();

  try {
    const { results } = await env.DB.prepare(`
      SELECT cl.id, cl.app_id AS appId, cl.license_key_last4 AS licenseKeyLast4,
             cl.status, cl.issued_at AS purchasedDate, a.name, a.version,
             a.tagline, a.storage, a.binaries, u.avatar_url AS creatorAvatar,
             u.username AS creatorUsername, a.repository_id AS repositoryId,
             cp.app_id AS sourceProductAppId, cp.repository_id AS sourceProductRepositoryId,
             cp.forking_enabled AS forkingEnabled, cp.resale_enabled AS resaleEnabled,
             1 AS sourceCommerceEvidenceCount,
             cr.id AS releaseId, cr.commit_oid AS releaseCommitOid,
             cr.deployment_revision_id AS releaseDeploymentRevisionId,
             cr.build_run_id AS releaseBuildRunId, cr.version AS releaseVersion,
             cr.binaries_json AS releaseBinariesJson,
             cr.artifact_manifest_json AS releaseArtifactManifestJson,
             cr.resale_enabled AS releaseResaleEnabled,
             cr.forking_enabled AS releaseForkingEnabled,
             cr.visibility AS releaseVisibility, cr.published_at AS releasePublishedAt
      FROM commerce_licenses cl
      JOIN commerce_orders co ON co.id = cl.order_id
      JOIN app_listings a ON a.id = cl.app_id
      JOIN users u ON u.id = a.creator_id
      LEFT JOIN commerce_products cp ON cp.app_id = a.id
      LEFT JOIN commerce_releases cr ON cr.id = COALESCE(cl.release_id, co.release_id)
      WHERE cl.owner_user_id = ? AND cl.status = 'active'
      ORDER BY cl.issued_at DESC, cl.id ASC
    `).bind(auth.user!.id).all();

    const shelf = (results || []).map((row: any) => {
      const binaries = safePublishedArtifacts(parseObject(row.releaseId ? row.releaseBinariesJson : row.binaries));
      if (row.releaseId ? Number(row.releaseForkingEnabled) !== 1 : listingSourceIsPrivate(row)) {
        delete binaries.source;
      }
      return {
        id: row.id,
        appId: row.appId,
        name: row.name,
        version: row.releaseVersion || row.version,
        tagline: row.tagline,
        storage: row.storage,
        licenseKeyLast4: row.licenseKeyLast4,
        maskedKey: `NSW-${String(row.appId).slice(0, 2).toUpperCase()}-••••-${row.licenseKeyLast4}`,
        purchasedDate: row.purchasedDate,
        creatorAvatar: row.creatorAvatar,
        creatorUsername: row.creatorUsername,
        binaries,
        release: row.releaseId ? {
          id: row.releaseId,
          commitOid: row.releaseCommitOid,
          deploymentRevisionId: row.releaseDeploymentRevisionId,
          buildRunId: row.releaseBuildRunId,
          version: row.releaseVersion,
          resaleEnabled: Boolean(row.releaseResaleEnabled),
          forkingEnabled: Boolean(row.releaseForkingEnabled),
          visibility: row.releaseVisibility,
          artifactManifest: parseObject(row.releaseArtifactManifestJson),
          publishedAt: row.releasePublishedAt
        } : null,
        status: row.status,
        source: 'commerce'
      };
    });

    return Response.json({ success: true, shelf });
  } catch (error) {
    console.error('shelf lookup failed', error);
    return unavailable();
  }
};

export const onRequestPost = async (_context?: unknown) => Response.json({
  success: false,
  error: 'Direct license minting is disabled. Licenses are issued only after verified commerce fulfillment.'
}, { status: 405, headers: { Allow: 'GET' } });

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
