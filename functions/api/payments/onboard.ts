import { requireAuth } from '../_auth';

function jsonError(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status });
}

async function stripePost(path: string, key: string, params: URLSearchParams): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString(),
      // Bound the Stripe call so a hang can't run past the Worker CPU/subrequest limit
      // (which would make Cloudflare kill the isolate and emit a raw empty-body 502).
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    throw new Error('Stripe is temporarily unreachable. No onboarding link was created.');
  }
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message.slice(0, 300)
      : 'Stripe rejected the onboarding request.';
    throw new Error(message);
  }
  return payload;
}

const handleOnboard = async ({ request, env }: { request: Request; env: any }) => {
  if (env?.PAYMENTS_ENABLED !== 'true') {
    return jsonError('Maker payouts are temporarily unavailable while Stripe Connect settlement is being commissioned.', 503);
  }
  if (!env?.DB) return jsonError('Payment database service is unavailable.', 503);

  const auth = await requireAuth(request, env);
  if (auth.errorResponse || !auth.user) return auth.errorResponse!;

  const stripeKey = String(env?.STRIPE_SECRET_KEY || '').trim();
  if (!stripeKey || stripeKey.includes('mock') || stripeKey.includes('test_mock')) {
    return jsonError('Stripe Connect is not configured. No account was created.', 503);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError('Request body must be valid JSON.', 400);
  }

  const country = String(body?.country || 'US').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return jsonError('country must be a two-letter ISO country code.', 400);
  const email = body?.email === undefined ? '' : String(body.email).trim();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return jsonError('email must be a valid email address.', 400);
  }

  const userId = auth.user.id;
  let accountId = '';
  try {
    const existing = await env.DB.prepare(`
      SELECT stripe_account_id AS accountId
      FROM stripe_accounts
      WHERE user_id = ?
    `).bind(userId).first();
    accountId = String((existing as any)?.accountId || '').trim();
  } catch {
    return jsonError('Unable to read the maker payout account.', 503);
  }

  if (!accountId) {
    const accountParams = new URLSearchParams();
    accountParams.set('type', 'express');
    accountParams.set('country', country);
    accountParams.set('capabilities[transfers][requested]', 'true');
    accountParams.set('business_type', 'individual');
    accountParams.set('metadata[userId]', userId);
    if (email) accountParams.set('email', email);

    let account: any;
    try {
      account = await stripePost('/v1/accounts', stripeKey, accountParams);
    } catch (error: any) {
      return jsonError(error.message || 'Stripe account creation failed.', 502);
    }
    if (typeof account?.id !== 'string' || !account.id.startsWith('acct_')) {
      return jsonError('Stripe returned an invalid account response.', 502);
    }
    accountId = account.id;

    try {
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO stripe_accounts (
            user_id, stripe_account_id, charges_enabled, payouts_enabled,
            onboarding_status, country, created_at, updated_at
          ) VALUES (?, ?, 0, 0, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET
            stripe_account_id = excluded.stripe_account_id,
            country = excluded.country,
            onboarding_status = 'pending',
            updated_at = CURRENT_TIMESTAMP
        `).bind(userId, accountId, country),
        env.DB.prepare(`
          UPDATE users SET stripe_account_id = ? WHERE id = ?
        `).bind(accountId, userId)
      ]);
    } catch {
      return jsonError('Stripe created the account, but local persistence failed. Contact support before retrying.', 503);
    }
  }

  const requestOrigin = new URL(request.url).origin;
  const publicOrigin = String(env?.PUBLIC_APP_ORIGIN || requestOrigin).replace(/\/$/, '');
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(publicOrigin);
  } catch {
    return jsonError('Public application origin is not configured correctly.', 503);
  }
  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.hostname !== 'localhost') {
    return jsonError('Public application origin must use HTTPS.', 503);
  }

  const linkParams = new URLSearchParams();
  linkParams.set('account', accountId);
  linkParams.set('type', 'account_onboarding');
  linkParams.set('refresh_url', `${parsedOrigin.origin}/profile?stripe=refresh`);
  linkParams.set('return_url', `${parsedOrigin.origin}/profile?stripe=success`);

  let link: any;
  try {
    link = await stripePost('/v1/account_links', stripeKey, linkParams);
  } catch (error: any) {
    return jsonError(error.message || 'Stripe onboarding-link creation failed.', 502);
  }
  if (typeof link?.url !== 'string' || !link.url.startsWith('https://connect.stripe.com/')) {
    return jsonError('Stripe returned an invalid onboarding link.', 502);
  }

  return Response.json({
    success: true,
    accountId,
    onboardingUrl: link.url,
    expiresAt: Number.isFinite(link.expires_at) ? link.expires_at : null,
    message: 'Stripe Connect Express onboarding link created.'
  });
};

// Outer boundary: any throw that escapes handleOnboard (auth, URL parsing, an isolate-killing
// Stripe hang) returns a clean JSON error instead of a raw empty-body Cloudflare 502.
export const onRequestPost = async (ctx: { request: Request; env: any }) => {
  try {
    return await handleOnboard(ctx);
  } catch (err: any) {
    console.error('[ONBOARD] unhandled error:', err?.message || err);
    return jsonError('Payout onboarding is temporarily unavailable. Please try again shortly.', 503);
  }
};
