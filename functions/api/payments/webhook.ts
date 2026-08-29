// POST /api/payments/webhook
// Durable Stripe Webhook Ingestion Endpoint (P2 Architecture)
// Verifies Stripe v1 HMAC signatures, persists raw verified events to stripe_event_inbox,
// schedules background processing via context.waitUntil, and returns HTTP 202 Accepted.

import {
  hashPayload,
  recordInboxEvent,
  verifyStripeSignature,
  processStripeInboxEvent,
  InboxCollisionError
} from '../../../src/lib/commerce';

// Re-export processor for direct unit & integration testing
export { processStripeInboxEvent };

export const onRequestPost = async (context: { request: Request; env: any; waitUntil?: (p: Promise<any>) => void }) => {
  const { request, env, waitUntil } = context;

  // 1. Mandatory fail-closed guard: payments disabled in production until durable commerce is fully commissioned
  if (env?.PAYMENTS_ENABLED !== 'true') {
    return Response.json(
      { success: false, error: 'Payment settlement is not enabled.' },
      { status: 503 }
    );
  }

  // 2. Stripe webhook secret is mandatory in all environments (including tests)
  const webhookSecret = env?.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || typeof webhookSecret !== 'string' || !webhookSecret.trim()) {
    return Response.json(
      { success: false, error: 'STRIPE_WEBHOOK_SECRET must be configured' },
      { status: 500 }
    );
  }

  // 3. Reject missing or empty signature header
  const sigHeader = request.headers.get('stripe-signature');
  if (!sigHeader || !sigHeader.trim()) {
    return Response.json(
      { success: false, error: 'Missing stripe-signature header' },
      { status: 401 }
    );
  }

  // 4. Verify raw-body Stripe v1 HMAC with constant-time comparison and 5-minute tolerance
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_048_576) {
    return Response.json(
      { success: false, error: 'Stripe event payload exceeds the 1 MiB limit' },
      { status: 413 }
    );
  }
  const sigResult = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  if (!sigResult.valid) {
    return Response.json(
      { success: false, error: 'Invalid Stripe signature' },
      { status: 401 }
    );
  }

  // 5. Parse and validate JSON payload schema
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  if (!event || typeof event !== 'object' || !event.id || !event.type || typeof event.livemode !== 'boolean') {
    return Response.json(
      { success: false, error: 'Malformed Stripe event payload: missing id or type' },
      { status: 400 }
    );
  }

  if (!env?.DB) {
    return Response.json(
      { success: false, error: 'Database service is unavailable' },
      { status: 500 }
    );
  }

  // 6. Idempotently persist verified event into stripe_event_inbox
  const payloadSha256 = await hashPayload(rawBody);
  const eventId = String(event.id).trim();
  const eventType = String(event.type).trim();
  if (!/^evt_[A-Za-z0-9_]+$/.test(eventId) || eventId.length > 255 || eventType.length > 255) {
    return Response.json(
      { success: false, error: 'Malformed Stripe event payload: invalid event id or type' },
      { status: 400 }
    );
  }
  const stripeObjectId = event.data?.object?.id ? String(event.data.object.id).trim() : null;
  const livemode = Boolean(event.livemode);

  let inboxResult;
  try {
    inboxResult = await recordInboxEvent(env.DB, {
      eventId,
      eventType,
      apiVersion: event.api_version ? String(event.api_version) : null,
      livemode,
      payloadJson: rawBody,
      payloadSha256,
      stripeObjectId
    });
  } catch (err: any) {
    if (err instanceof InboxCollisionError || err?.statusCode === 409) {
      return Response.json(
        { success: false, error: err.message },
        { status: 409 }
      );
    }
    return Response.json(
      { success: false, error: `Failed to record inbox event: ${err?.message || 'database error'}` },
      { status: 500 }
    );
  }

  // 7. Schedule background processor asynchronously; never claim settled synchronously
  if (typeof waitUntil === 'function') {
    waitUntil(
      processStripeInboxEvent(env.DB, env, eventId).catch((procErr: any) => {
        console.error(`[BACKGROUND EVENT PROCESSOR ERROR ${eventId}]`, procErr);
      })
    );
  }

  // 8. Return HTTP 202 Accepted
  return Response.json(
    {
      success: true,
      received: true,
      eventId,
      duplicate: inboxResult.status === 'duplicate',
      status: 'received'
    },
    { status: 202 }
  );
};
