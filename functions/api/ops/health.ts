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
