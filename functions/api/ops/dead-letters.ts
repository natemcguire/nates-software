// GET /api/ops/dead-letters — stuck-money visibility list. super_admin ONLY.
//
// Lists the terminal_failure rows across the same three durable commerce
// tables the drain worker reconciles: stripe_event_inbox, commerce_transfer_outbox,
// commerce_reversal_outbox — each with its last_error so an operator can see
// exactly what's stuck and why.
//
// Read-only, on purpose: this pass adds visibility only. The scheduled drain
// worker already retries retryable_failure rows on its own backoff schedule;
// terminal_failure rows are the ones that exhausted retries and need a human
// to look at last_error. No retry/replay mutation is exposed here.

import { requireSuperAdmin, opsJson } from './_guard';
import { computeDeadLetterSnapshot, type D1Database } from '../../../src/lib/opsDomain';

export const onRequestGet = async ({ request, env }: { request: Request; env: { DB?: D1Database } }) => {
  const guard = await requireSuperAdmin(request, env);
  if (guard.errorResponse) return guard.errorResponse;

  if (!env.DB) {
    return opsJson({ success: false, error: 'Operator database is unavailable' }, 503);
  }

  try {
    const snapshot = await computeDeadLetterSnapshot(env.DB);
    return opsJson({ success: true, ...snapshot });
  } catch (err: any) {
    return opsJson({ success: false, error: `Failed to compute dead-letter snapshot: ${err?.message || String(err)}` }, 500);
  }
};
