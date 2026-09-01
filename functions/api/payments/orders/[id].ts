// GET /api/payments/orders/:id
// Buyer-scoped order status, fulfillment polling, receipt, and license retrieval endpoint.
// Strictly requires authentication and returns ONLY the authenticated buyer's own order.
// Returns HTTP 404 if order does not exist or does not belong to the buyer (audit §11).

import { requireAuth } from '../../_auth';
import { safePublishedArtifacts } from '../../../../src/lib/profileDomain';
import { decryptLicenseSecret } from '../../../../src/lib/commerce/licenseCrypto';

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

export async function handleGetOrder(context: { request: Request; env: any; params?: { id?: string | string[] } }) {
  const { request, env, params } = context;

  if (!env?.DB) {
    return Response.json({ success: false, error: 'Database service is unavailable' }, { status: 500 });
  }

  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  const buyer = auth.user!;

  const url = new URL(request.url);
  const rawParamId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const rawQueryId = url.searchParams.get('id');
  const pathParts = url.pathname.split('/').filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1];
  const rawPathId = lastPart && lastPart !== 'orders' && lastPart !== 'order' ? lastPart : null;

  const orderId = (rawParamId || rawQueryId || rawPathId || '').trim();
  if (!orderId) {
    return Response.json({ success: false, error: 'Order ID is required' }, { status: 400 });
  }

  try {
    const order: any = await env.DB.prepare(`
      SELECT id, idempotency_key AS idempotencyKey, buyer_user_id AS buyerUserId,
             app_id AS appId, repository_id AS repositoryId, seller_user_id AS sellerUserId,
             app_version AS appVersion, price_version AS priceVersion, gross_cents AS grossCents,
             currency, lineage_policy AS lineagePolicy, lineage_snapshot_json AS lineageSnapshotJson,
             stripe_payment_intent_id AS stripePaymentIntentId, status, failure_code AS failureCode,
             created_at AS createdAt, updated_at AS updatedAt, paid_at AS paidAt, fulfilled_at AS fulfilledAt
      FROM commerce_orders
      WHERE id = ?
    `).bind(orderId).first();

    if (!order || order.buyerUserId !== buyer.id) {
      return Response.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const appListing: any = await env.DB.prepare(`
      SELECT id, name, version, tagline, storage, binaries
      FROM app_listings
      WHERE id = ?
    `).bind(order.appId).first();

    const seller: any = await env.DB.prepare(`
      SELECT id, username, display_name AS displayName, avatar_url AS avatar
      FROM users
      WHERE id = ?
    `).bind(order.sellerUserId).first();

    const licenseRow: any = await env.DB.prepare(`
      SELECT cl.id, cl.app_id AS appId, cl.license_key_hash AS licenseKeyHash,
             cl.license_key_last4 AS licenseKeyLast4, cl.status, cl.issued_at AS issuedAt,
             cls.ciphertext_base64 AS ciphertextBase64, cls.iv_base64 AS ivBase64,
             cls.algorithm, cls.key_version AS keyVersion
      FROM commerce_licenses cl
      LEFT JOIN commerce_license_secrets cls ON cls.license_id = cl.id
      WHERE cl.order_id = ? AND cl.owner_user_id = ?
    `).bind(order.id, buyer.id).first();

    let licensePayload: any = null;
    if (licenseRow) {
      let decryptedKey: string | null = null;
      if (licenseRow.ciphertextBase64 && licenseRow.ivBase64 && env?.LICENSE_ENCRYPTION_KEYS_JSON) {
        try {
          decryptedKey = await decryptLicenseSecret({
            ciphertextBase64: licenseRow.ciphertextBase64,
            ivBase64: licenseRow.ivBase64,
            keyVersion: licenseRow.keyVersion || 1
          }, env);
        } catch (decryptErr) {
          console.warn('[ORDER GET] License secret decryption skipped:', decryptErr);
        }
      }

      const maskedKey = `NSW-${String(order.appId).slice(0, 2).toUpperCase()}-••••-${licenseRow.licenseKeyLast4}`;
      licensePayload = {
        id: licenseRow.id,
        licenseKey: decryptedKey || maskedKey,
        licenseKeyLast4: licenseRow.licenseKeyLast4,
        maskedKey,
        status: licenseRow.status,
        issuedAt: licenseRow.issuedAt
      };
    }

    let lineageSnapshot: any = null;
    if (order.lineageSnapshotJson) {
      try {
        lineageSnapshot = JSON.parse(order.lineageSnapshotJson);
      } catch {}
    }

    return Response.json({
      success: true,
      order: {
        id: order.id,
        appId: order.appId,
        appName: appListing?.name || order.appId,
        appVersion: order.appVersion,
        tagline: appListing?.tagline || '',
        status: order.status,
        failureCode: order.failureCode || null,
        amountCents: order.grossCents,
        currency: order.currency,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        paidAt: order.paidAt,
        fulfilledAt: order.fulfilledAt,
        seller: seller ? {
          id: seller.id,
          username: seller.username,
          displayName: seller.displayName || seller.username,
          avatar: seller.avatar || '⚡'
        } : null,
        lineageSnapshot,
        storage: appListing?.storage || '',
        binaries: safePublishedArtifacts(parseObject(appListing?.binaries)),
        license: licensePayload
      }
    });
  } catch (err: any) {
    console.error('[ORDER GET ERROR]', err);
    return Response.json({ success: false, error: err?.message || 'Failed to retrieve order' }, { status: 500 });
  }
}

export const onRequestGet = handleGetOrder;

export const onRequestPost = async () => Response.json(
  { success: false, error: 'Method not allowed' },
  { status: 405, headers: { Allow: 'GET' } }
);

export const onRequestPut = onRequestPost;
export const onRequestDelete = onRequestPost;
