import { getAwsCredentials, createEcrRepository, DEFAULT_AWS_ACCOUNT_ID } from './_aws';
import { requireAuth } from './_auth';

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
    ecrRepositoryProvisioned: boolean | null;
  };
}

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

async function buildDeployReadiness(db: any, env: any, appId: string, repositoryActive: boolean): Promise<DeployReadiness> {
  const reasons: string[] = [];

  const listing: any = await db.prepare(`
    SELECT origin_kind AS originKind, origin_ref AS originRef, hostname
    FROM app_listings WHERE id = ?
  `).bind(appId).first();

  const repositoryLinked = repositoryActive;
  if (!repositoryLinked) reasons.push('No active repository is linked to this app; there is no source to build.');

  const routerBindable = Boolean(listing?.hostname) &&
    ['r2_static', 'worker', 'cf_container', 'fargate_warm'].includes(String(listing?.originKind || ''));
  if (!routerBindable) reasons.push('No routable hostname/origin is configured for this app; the router cannot bind it.');

  const storageConfigured = Boolean(env?.STORAGE);
  if (!storageConfigured) reasons.push('Artifact storage (R2 STORAGE) is not bound in this environment.');

  const buildSubstrateConfigured = Boolean(
    env?.AWS_CODEBUILD_DEPLOY_PROJECT || env?.AWS_CODEBUILD_BUILD_PROJECT ||
    env?.AWS_ACCESS_KEY_ID
  );
  if (!buildSubstrateConfigured) reasons.push('No AWS build substrate (CodeBuild project / credentials) is configured in this environment.');

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
      if (includeDeploy) {
        const auth = await requireAuth(request, env);
        if (auth.errorResponse || !auth.user) {
          return auth.errorResponse || Response.json(
            { success: false, error: 'Authentication required' },
            { status: 401 }
          );
        }

        const listing: any = await env.DB.prepare(`
          SELECT creator_id AS creatorId FROM app_listings WHERE id = ?
        `).bind(appId).first();
        if (!listing) {
          return Response.json(
            { success: false, error: `Application '${appId}' not found in catalog` },
            { status: 404 }
          );
        }
        if (listing.creatorId !== auth.user.id && auth.user.role !== 'super_admin') {
          return Response.json(
            { success: false, error: 'Forbidden: you do not own this application listing' },
            { status: 403 }
          );
        }
      }

      const readiness = await buildReadiness(env.DB, appId);
      if (includeDeploy) {
        readiness.deploy = await buildDeployReadiness(env.DB, env, appId, readiness.repository.active);
      }
      return Response.json({ success: true, readiness });
    }

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
