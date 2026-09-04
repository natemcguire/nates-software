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
