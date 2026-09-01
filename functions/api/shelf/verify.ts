// Server-authoritative license & shelf verification endpoint.
// Confirms that the authenticated session user holds an active commerce license for the requested app.
// Plaintext license keys are never stored or compared at rest beyond SHA-256 hash matching.

import { requireAuth } from '../_auth';
import { hashLicenseKey } from '../../../src/lib/commerce/licenseCrypto';

const unavailable = () => Response.json(
  { success: false, error: 'Shelf verification service is temporarily unavailable' },
  { status: 503 }
);

export interface ShelfVerifyResponse {
  success: boolean;
  verified: boolean;
  isOwned: boolean;
  appId?: string;
  license?: {
    id: string;
    appId: string;
    licenseKeyLast4: string;
    status: string;
    purchasedDate: string;
  };
  error?: string;
}

export const handleVerify = async ({ request, env }: { request: Request; env: any }): Promise<Response> => {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  if (!env?.DB) return unavailable();

  try {
    let appId: string | null = null;
    let presentedKey: string | null = null;

    if (request.method === 'GET') {
      const url = new URL(request.url);
      appId = url.searchParams.get('appId') || url.searchParams.get('app_id');
      presentedKey = url.searchParams.get('licenseKey') || url.searchParams.get('key');
    } else if (request.method === 'POST') {
      try {
        const body = await request.json() as any;
        if (body && typeof body === 'object') {
          appId = body.appId || body.app_id || null;
          presentedKey = body.licenseKey || body.key || null;
        }
      } catch {
        return Response.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 });
      }
    }

    if (!appId && !presentedKey) {
      return Response.json(
        { success: false, error: 'appId or licenseKey parameter is required for verification' },
        { status: 400 }
      );
    }

    if (appId && presentedKey) {
      // Both appId and licenseKey provided: verify that session user owns this appId WITH this key
      const keyHash = await hashLicenseKey(presentedKey);
      const row = await env.DB.prepare(`
        SELECT cl.id, cl.app_id AS appId, cl.license_key_last4 AS licenseKeyLast4,
               cl.status, cl.issued_at AS purchasedDate
        FROM commerce_licenses cl
        WHERE cl.owner_user_id = ? AND cl.app_id = ? AND cl.license_key_hash = ? AND cl.status = 'active'
        LIMIT 1
      `).bind(auth.user!.id, appId, keyHash).first();

      if (row) {
        return Response.json({
          success: true,
          verified: true,
          isOwned: true,
          appId: row.appId,
          license: {
            id: row.id,
            appId: row.appId,
            licenseKeyLast4: row.licenseKeyLast4,
            status: row.status,
            purchasedDate: row.purchasedDate
          }
        });
      }

      return Response.json({
        success: true,
        verified: false,
        isOwned: false,
        appId
      });
    }

    if (appId) {
      // Gated ownership check for session user by appId
      const row = await env.DB.prepare(`
        SELECT cl.id, cl.app_id AS appId, cl.license_key_last4 AS licenseKeyLast4,
               cl.status, cl.issued_at AS purchasedDate
        FROM commerce_licenses cl
        WHERE cl.owner_user_id = ? AND cl.app_id = ? AND cl.status = 'active'
        LIMIT 1
      `).bind(auth.user!.id, appId).first();

      if (row) {
        return Response.json({
          success: true,
          verified: true,
          isOwned: true,
          appId: row.appId,
          license: {
            id: row.id,
            appId: row.appId,
            licenseKeyLast4: row.licenseKeyLast4,
            status: row.status,
            purchasedDate: row.purchasedDate
          }
        });
      }

      return Response.json({
        success: true,
        verified: false,
        isOwned: false,
        appId
      });
    }

    if (presentedKey) {
      // License key verification for session user (presentedKey only)
      const keyHash = await hashLicenseKey(presentedKey);
      const row = await env.DB.prepare(`
        SELECT cl.id, cl.app_id AS appId, cl.license_key_last4 AS licenseKeyLast4,
               cl.status, cl.issued_at AS purchasedDate
        FROM commerce_licenses cl
        WHERE cl.owner_user_id = ? AND cl.license_key_hash = ? AND cl.status = 'active'
        LIMIT 1
      `).bind(auth.user!.id, keyHash).first();

      if (row) {
        return Response.json({
          success: true,
          verified: true,
          isOwned: true,
          appId: row.appId,
          license: {
            id: row.id,
            appId: row.appId,
            licenseKeyLast4: row.licenseKeyLast4,
            status: row.status,
            purchasedDate: row.purchasedDate
          }
        });
      }

      return Response.json({
        success: true,
        verified: false,
        isOwned: false
      });
    }

    return Response.json(
      { success: false, error: 'appId or licenseKey parameter is required for verification' },
      { status: 400 }
    );
  } catch (error) {
    console.error('license verification failed', error);
    return unavailable();
  }
};

export const onRequestGet = handleVerify;
export const onRequestPost = handleVerify;
