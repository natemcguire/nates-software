// Shared super_admin gate for the OPS operator health/reconciliation surface.
// Both GET /api/ops/health and GET /api/ops/dead-letters use this — a single
// choke point so the "never leak internal queue state to non-admins" rule
// can't drift between the two routes.
//
// 401: no valid authenticated session (requireAuth's own failure path).
// 403: authenticated, but role !== 'super_admin'. The 403 body is
// deliberately generic — it does not confirm or deny that the resource
// exists beyond "you may not see it."

import { requireAuth, type AuthenticatedUser } from '../_auth';

export interface OpsGuardResult {
  user: AuthenticatedUser | null;
  errorResponse: Response | null;
}

export async function requireSuperAdmin(request: Request, env: any): Promise<OpsGuardResult> {
  const auth = await requireAuth(request, env);
  if (auth.errorResponse) {
    return { user: null, errorResponse: auth.errorResponse };
  }

  if (auth.user!.role !== 'super_admin') {
    return {
      user: null,
      errorResponse: Response.json(
        { success: false, error: 'Forbidden: super_admin role required' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      )
    };
  }

  return { user: auth.user, errorResponse: null };
}

export function opsJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
