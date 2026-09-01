// GET /api/product-readiness[?appId=...]
// Unified, server-computed product-readiness projection.
//
// Today "is this app real" is scattered across commerce_products.status,
// app_listings, repositories.status, and deployment_state. Sellers, buyers,
// and the acceptance test all need ONE authoritative honest read instead of
// re-deriving it (and drifting) in five different places.
//
// This endpoint NEVER fabricates readiness. Every field is a direct
// projection of an existing row; missing rows/relationships fail closed to
// 'false'/null, and 'overall' is computed deterministically from them below.
// Public read (no auth) — the projection only exposes fields that are
// already public on /hotwire and the app listing itself. No seller PII
// (emails, Stripe account IDs, session data, etc.) is included.

export interface ProductReadiness {
  appId: string;
  product: {
    exists: boolean;
    active: boolean;
    priceCents: number | null;
    currency: string | null;
  };
  listing: {
    exists: boolean;
    name: string | null;
  };
  repository: {
    exists: boolean;
    active: boolean;
    id: string | null;
  };
  deployment: {
    active: boolean;
    hostname: string | null;
    deploymentState: string | null;
  };
  overall: 'buyable' | 'forkable' | 'draft' | 'unavailable';
}

/**
 * Computes the honest overall status from the four sub-projections.
 *
 * - 'buyable': product exists+active AND listing exists. This is the
 *   minimum bar for /api/payments/create-intent to succeed — deployment and
 *   repository are surfaced separately (a buyable app can still be a static
 *   client-side demo with no live hostname, and still be legitimately for sale).
 * - 'forkable': not buyable, but the listing exists and has an active,
 *   linked repository — safe to `slop fork`, just not (yet) for sale.
 * - 'draft': the listing exists but neither buyable nor forkable.
 * - 'unavailable': no listing at all (nothing to show).
 */
function computeOverall(input: {
  listingExists: boolean;
  productExists: boolean;
  productActive: boolean;
  repositoryActive: boolean;
}): ProductReadiness['overall'] {
  if (!input.listingExists) return 'unavailable';
  if (input.productExists && input.productActive) return 'buyable';
  if (input.repositoryActive) return 'forkable';
  return 'draft';
}

async function buildReadiness(db: any, appId: string): Promise<ProductReadiness> {
  const listing: any = await db.prepare(`
    SELECT id, name, deployment_state AS deploymentState, hostname,
           active_deployment_id AS activeDeploymentId
    FROM app_listings
    WHERE id = ?
  `).bind(appId).first();

  const listingExists = Boolean(listing);

  const product: any = await db.prepare(`
    SELECT app_id AS appId, repository_id AS repositoryId, price_cents AS priceCents,
           currency, status
    FROM commerce_products
    WHERE app_id = ?
  `).bind(appId).first();

  const productExists = Boolean(product);
  const productActive = productExists && product.status === 'active';

  // A product's repository_id is authoritative when present; otherwise fall
  // back to any repository linked to the app so 'forkable' can still be
  // computed for apps that have a repo but no commerce_products row yet.
  let repositoryId: string | null = product?.repositoryId || null;
  if (!repositoryId) {
    const repoRow: any = await db.prepare(`
      SELECT id FROM repositories WHERE app_id = ? ORDER BY created_at ASC, id ASC LIMIT 1
    `).bind(appId).first();
    repositoryId = repoRow?.id || null;
  }

  let repository: any = null;
  if (repositoryId) {
    repository = await db.prepare(`
      SELECT id, status FROM repositories WHERE id = ?
    `).bind(repositoryId).first();
  }

  const repositoryExists = Boolean(repository);
  const repositoryActive = repositoryExists && repository.status === 'active';

  const deploymentState: string | null = listingExists ? (listing.deploymentState || null) : null;
  const hostname: string | null = listingExists ? (listing.hostname || null) : null;
  // Fail-closed: a hostname alone never implies an active deployment. Both
  // the explicit deployment_state === 'active' AND a resolvable hostname
  // (what "open live" needs) must be true.
  const deploymentActive = deploymentState === 'active' && Boolean(hostname);

  const overall = computeOverall({
    listingExists,
    productExists,
    productActive,
    repositoryActive
  });

  return {
    appId,
    product: {
      exists: productExists,
      active: productActive,
      priceCents: productExists ? product.priceCents : null,
      currency: productExists ? product.currency : null
    },
    listing: {
      exists: listingExists,
      name: listingExists ? listing.name : null
    },
    repository: {
      exists: repositoryExists,
      active: repositoryActive,
      id: repositoryExists ? repository.id : null
    },
    deployment: {
      active: deploymentActive,
      hostname: deploymentActive ? hostname : null,
      deploymentState
    },
    overall
  };
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  if (!env?.DB) {
    return Response.json(
      { success: false, error: 'Product readiness service is unavailable' },
      { status: 503 }
    );
  }

  try {
    const url = new URL(request.url);
    const appId = (url.searchParams.get('appId') || '').trim();

    if (appId) {
      const readiness = await buildReadiness(env.DB, appId);
      return Response.json({ success: true, readiness });
    }

    // No appId supplied: project readiness for every app in the catalog.
    const { results } = await env.DB.prepare(`
      SELECT id FROM app_listings ORDER BY created_at ASC, id ASC
    `).all();

    const appIds: string[] = (results || []).map((row: any) => row.id);
    const readiness = await Promise.all(appIds.map((id) => buildReadiness(env.DB, id)));

    return Response.json({ success: true, readiness });
  } catch (error: any) {
    console.error('[PRODUCT READINESS ERROR]', error);
    return Response.json(
      { success: false, error: 'Failed to compute product readiness' },
      { status: 500 }
    );
  }
};

export const onRequestPost = async () => Response.json(
  { success: false, error: 'Method not allowed' },
  { status: 405, headers: { Allow: 'GET' } }
);
