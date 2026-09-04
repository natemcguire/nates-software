import { requireSuperAdmin } from '../ops/_guard';

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const onRequestPost = async ({ request, env, stripeFetchOverride }: {
  request: Request;
  env: any;
  stripeFetchOverride?: typeof fetch;
}) => {
  const guard = await requireSuperAdmin(request, env);
  if (guard.errorResponse) return guard.errorResponse;

  if (!env?.DB) {
    return json({ success: false, error: 'Database service is unavailable' }, 503);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Request body must be valid JSON' }, 400);
  }

  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  if (!orderId) {
    return json({ success: false, error: 'orderId is required' }, 400);
  }

  let amountCents: number | null = null;
  if (body?.amountCents !== undefined && body?.amountCents !== null) {
    const n = Number(body.amountCents);
    if (!Number.isSafeInteger(n) || n <= 0) {
      return json({ success: false, error: 'amountCents must be a positive integer when provided' }, 400);
    }
    amountCents = n;
  }

  let order: any;
  try {
    order = await env.DB.prepare(`
      SELECT id, gross_cents, refunded_cents, currency, status, stripe_payment_intent_id
      FROM commerce_orders WHERE id = ?
    `).bind(orderId).first();
  } catch (err: any) {
    console.error('[REFUND] order lookup failed:', err?.message || err);
    return json({ success: false, error: 'Failed to look up order' }, 500);
  }

  if (!order) {
    return json({ success: false, error: 'Order not found' }, 404);
  }
  if (!order.stripe_payment_intent_id) {
    return json({ success: false, error: 'Order has no Stripe payment intent to refund' }, 400);
  }

  const alreadyRefunded = Number(order.refunded_cents ?? 0);
  const grossCents = Number(order.gross_cents);
  if (alreadyRefunded >= grossCents) {
    return json({ success: false, error: 'Order is already fully refunded' }, 400);
  }
  if (amountCents !== null && alreadyRefunded + amountCents > grossCents) {
    return json({ success: false, error: 'amountCents exceeds the remaining refundable balance' }, 400);
  }

  const stripeSecretKey = env?.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return json({ success: false, error: 'Stripe is not configured on the server' }, 503);
  }

  const idempotencyKey = `refund:${orderId}:${amountCents ?? 'full'}`;
  const params = new URLSearchParams();
  params.append('payment_intent', order.stripe_payment_intent_id);
  if (amountCents !== null) {
    params.append('amount', String(amountCents));
  }

  const fetchImpl = stripeFetchOverride || globalThis.fetch;
  let stripeRes: Response;
  try {
    stripeRes = await fetchImpl('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
  } catch (err: any) {
    console.error('[REFUND] network error calling Stripe:', err?.message || err);
    return json({ success: false, error: 'Network error contacting Stripe' }, 502);
  }

  let payload: any;
  try {
    payload = await stripeRes.json();
  } catch (err: any) {
    console.error('[REFUND] failed to parse Stripe response:', err?.message || err);
    return json({ success: false, error: 'Stripe returned an unreadable response' }, 502);
  }

  if (!stripeRes.ok) {
    console.error('[REFUND] Stripe refund creation failed:', payload?.error?.message || payload);
    const status = stripeRes.status >= 400 && stripeRes.status < 500 ? stripeRes.status : 502;
    return json({ success: false, error: payload?.error?.message || 'Stripe refund creation failed' }, status);
  }

  if (payload?.object !== 'refund' || typeof payload?.id !== 'string') {
    console.error('[REFUND] Stripe returned a malformed refund object for order', orderId);
    return json({ success: false, error: 'Stripe returned an unexpected response' }, 502);
  }

  return json({ success: true, refundId: payload.id }, 200);
};
