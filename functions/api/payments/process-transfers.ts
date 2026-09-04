import {
  processTransferBatch,
  processTransferOutboxItem,
  claimTransferOutboxRow,
  releaseTransferClaim,
  markTransferTerminalFailure,
  calculateBackoffSeconds,
  buildStripeTransferPayload,
  validatePayoutWorkerConfig,
  STRIPE_IDEMPOTENCY_SAFETY_WINDOW_SECONDS
} from '../../../src/lib/commerce/transferWorker';
import { constantTimeCompare } from '../../../src/lib/commerce/stripeSignature';

export {
  processTransferBatch,
  processTransferOutboxItem,
  claimTransferOutboxRow,
  releaseTransferClaim,
  markTransferTerminalFailure,
  calculateBackoffSeconds,
  buildStripeTransferPayload,
  validatePayoutWorkerConfig,
  STRIPE_IDEMPOTENCY_SAFETY_WINDOW_SECONDS
};

export const onRequestPost = async (context: { request: Request; env: any }) => {
  const { request, env } = context;

  if (env?.PAYOUTS_ENABLED !== 'true') {
    return Response.json(
      { success: false, error: 'Payout execution is disabled.' },
      { status: 503 }
    );
  }

  const workerSecret = env?.PAYOUT_WORKER_SECRET;
  if (!workerSecret || typeof workerSecret !== 'string' || !workerSecret.trim()) {
    return Response.json(
      { success: false, error: 'PAYOUT_WORKER_SECRET must be configured' },
      { status: 500 }
    );
  }

  const stripeSecretKey = env?.STRIPE_SECRET_KEY;
  if (!stripeSecretKey || typeof stripeSecretKey !== 'string' || !stripeSecretKey.trim()) {
    return Response.json(
      { success: false, error: 'STRIPE_SECRET_KEY must be configured' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return Response.json(
      { success: false, error: 'Missing or malformed Authorization header' },
      { status: 401 }
    );
  }

  const providedToken = authHeader.slice(7).trim();
  if (!providedToken || !constantTimeCompare(providedToken, workerSecret)) {
    return Response.json(
      { success: false, error: 'Unauthorized: invalid bearer token' },
      { status: 401 }
    );
  }

  if (!env?.DB) {
    return Response.json(
      { success: false, error: 'Database service is unavailable' },
      { status: 500 }
    );
  }

  let limit = 10;
  try {
    const text = await request.text();
    if (text && text.trim()) {
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        return Response.json(
          { success: false, error: 'Invalid JSON body' },
          { status: 400 }
        );
      }

      if (body && typeof body === 'object') {
        const forbiddenKeys = [
          'destination',
          'destination_user_id',
          'destination_stripe_account',
          'destinationUserId',
          'destinationStripeAccount',
          'amount',
          'amount_cents',
          'amountCents',
          'price',
          'price_cents',
          'priceCents',
          'currency',
          'order_id',
          'orderId',
          'allocation_id',
          'allocationId',
          'outbox_id',
          'outboxId',
          'stripe_transfer_id',
          'stripeTransferId',
          'id',
          'user_id',
          'userId'
        ];

        for (const key of forbiddenKeys) {
          if (key in body) {
            return Response.json(
              {
                success: false,
                error: `Transfer execution endpoint rejects caller override parameter '${key}'. Economic state is loaded exclusively from authoritative database rows.`
              },
              { status: 400 }
            );
          }
        }

        if (body.limit !== undefined) {
          const parsedLimit = Number(body.limit);
          if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1) {
            return Response.json(
              { success: false, error: 'limit must be a positive integer between 1 and 25' },
              { status: 400 }
            );
          }
          limit = Math.min(25, parsedLimit);
        }
      }
    }
  } catch (err: any) {
    return Response.json(
      { success: false, error: `Invalid request: ${err.message}` },
      { status: 400 }
    );
  }

  const batchResult = await processTransferBatch(env.DB, env, { limit });

  return Response.json(batchResult, { status: 200 });
};
