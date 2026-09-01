// GET /api/ops/health — operator queue-health snapshot. super_admin ONLY.
//
// Returns honest, server-computed metrics reused from the exact tables the
// scheduled drain worker (workers/drain/src/index.ts) reconciles:
//   - stripe_event_inbox: counts by status, oldest un-processed
//     next_attempt_at (queue age), terminal_failure (dead-letter) count.
//   - commerce_transfer_outbox / commerce_reversal_outbox: counts by status,
//     oldest pending row, terminal_failure (dead-letter) count.
//   - workerFlags.payoutsEnabled: the real PAYOUTS_ENABLED env value the
//     drain worker itself gates on (see runTransferDrain/runRecoveryDrain) —
//     never inferred, never hardcoded true.
//
// Read-only: no row is claimed, retried, or mutated by this handler.

import { requireSuperAdmin, opsJson } from './_guard';
import { computeOpsHealthSnapshot, type D1Database } from '../../../src/lib/opsDomain';

export const onRequestGet = async ({ request, env }: { request: Request; env: { DB?: D1Database; PAYOUTS_ENABLED?: string } }) => {
  const guard = await requireSuperAdmin(request, env);
  if (guard.errorResponse) return guard.errorResponse;

  if (!env.DB) {
    return opsJson({ success: false, error: 'Operator database is unavailable' }, 503);
  }

  try {
    const snapshot = await computeOpsHealthSnapshot(env.DB, env);
    return opsJson({ success: true, ...snapshot });
  } catch (err: any) {
    return opsJson({ success: false, error: `Failed to compute ops health: ${err?.message || String(err)}` }, 500);
  }
};
