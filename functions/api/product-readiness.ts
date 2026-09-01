// GET /api/product-readiness[?appId=...][&deploy=1]
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
//
// Deploy-readiness preflight (Fix 2, RIG spec): when `?appId=` is given
// together with `&deploy=1`, the projection additionally includes `deploy`,
// a preflight over the prerequisites the publish/deploy control needs
// (build substrate config, per-app ECR repository, R2 artifact storage,
// router binding). This is opt-in and per-app only — it is never computed
// for the "all apps" catalog sweep, because unlike the rest of this
// projection it is NOT a pure D1 read: per-app ECR provisioning is never
// persisted in D1 (functions/api/deploy.ts checks it live against AWS on
// every deploy attempt — see AGENTS.md notes), so an honest preflight has to
// make the same live, idempotent AWS call deploy.ts itself relies on. When
// AWS credentials aren't configured in this environment, the ECR field
// fails closed to `null` ("not verifiable here") rather than fabricating
// `true`.

import { getAwsCredentials, createEcrRepository, DEFAULT_AWS_ACCOUNT_ID } from './_aws';

interface ProductReadiness {
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
  deploy?: DeployReadiness;
}

export interface DeployReadiness {
  ready: boolean;
  reasons: string[];
  checks: {
    repositoryLinked: boolean;
    routerBindable: boolean;
    storageConfigured: boolean;
    buildSubstrateConfigured: boolean;
    // true/false when live-verifiable against AWS; null when AWS credentials
    // are not configured in this environment (honestly "not verifiable here",
    // never fabricated as ready).
    ecrRepositoryProvisioned: boolean | null;
  };
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

/**
 * Deploy-readiness preflight for the publish/deploy control (Fix 2).
 *
 * Gates what the UI is allowed to offer, NOT what the server enforces —
 * functions/api/deploy.ts keeps its own fail-closed checks unconditionally;
 * this preflight exists purely so the client doesn't lead a user into a dead
 * publish attempt. It fails closed the same way: any prerequisite that can't
 * be confirmed leaves `ready: false` with an honest reason, never `true`.
 */
async function buildDeployReadiness(db: any, env: any, appId: string, repositoryActive: boolean): Promise<DeployReadiness> {
  const reasons: string[] = [];

  const listing: any = await db.prepare(`
    SELECT origin_kind AS originKind, origin_ref AS originRef, hostname
    FROM app_listings WHERE id = ?
  `).bind(appId).first();

  const repositoryLinked = repositoryActive;
  if (!repositoryLinked) reasons.push('No active repository is linked to this app; there is no source to build.');

  // Router binding: the wildcard router Worker resolves purely from
  // app_listings.hostname + origin_kind/origin_ref at request time (there is
  // no separate "router commissioned" row) — a bindable hostname plus a
  // valid origin_kind is the full honest signal this projection can read.
  const routerBindable = Boolean(listing?.hostname) &&
    ['r2_static', 'worker', 'cf_container', 'fargate_warm'].includes(String(listing?.originKind || ''));
  if (!routerBindable) reasons.push('No routable hostname/origin is configured for this app; the router cannot bind it.');

  const storageConfigured = Boolean(env?.STORAGE);
  if (!storageConfigured) reasons.push('Artifact storage (R2 STORAGE) is not bound in this environment.');

  const buildSubstrateConfigured = Boolean(
    env?.AWS_CODEBUILD_DEPLOY_PROJECT || env?.AWS_CODEBUILD_BUILD_PROJECT ||
    env?.AWS_ACCESS_KEY_ID // presence of any AWS wiring is the closest honest signal without a dedicated CodeBuild project lookup
  );
  if (!buildSubstrateConfigured) reasons.push('No AWS build substrate (CodeBuild project / credentials) is configured in this environment.');

  // ECR per-app repository: genuinely NOT tracked in D1 — deploy.ts checks
  // this live against AWS on every attempt (createEcrRepository is
  // idempotent: it treats "already exists" as success, same call deploy.ts
  // makes at its ecr_provisioning stage). Mirror that exact call here rather
  // than fabricating a persisted flag. Only attempted when AWS credentials
  // are present; otherwise fails closed to null (not verifiable), never true.
  let ecrRepositoryProvisioned: boolean | null = null;
  const creds = getAwsCredentials(env);
  if (creds.accessKeyId && creds.secretAccessKey) {
    const ecrResult = await createEcrRepository(env, { repositoryName: `nsw/${appId}`, registryId: env?.AWS_ACCOUNT_ID || DEFAULT_AWS_ACCOUNT_ID })
      .catch((error: any) => ({ success: false, error: error?.message || 'ECR check failed' }));
    ecrRepositoryProvisioned = Boolean((ecrResult as any).success);
    if (!ecrRepositoryProvisioned) reasons.push(`Per-app ECR repository is not provisioned or unreachable: ${(ecrResult as any).error || 'unknown ECR error'}.`);
  } else {
    reasons.push('AWS credentials are not configured in this environment; ECR provisioning cannot be verified.');
  }

  const ready = repositoryLinked && routerBindable && storageConfigured && buildSubstrateConfigured && ecrRepositoryProvisioned === true;

  return {
    ready,
    reasons,
    checks: { repositoryLinked, routerBindable, storageConfigured, buildSubstrateConfigured, ecrRepositoryProvisioned }
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
    const includeDeploy = ['1', 'true'].includes((url.searchParams.get('deploy') || '').trim().toLowerCase());

    if (appId) {
      const readiness = await buildReadiness(env.DB, appId);
      if (includeDeploy) {
        readiness.deploy = await buildDeployReadiness(env.DB, env, appId, readiness.repository.active);
      }
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
