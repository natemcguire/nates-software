// Client trigger for first-party cross-subdomain SSO (task #38).
//
// When a TRUSTED first-party host (gitsmith, hotwire, slopshop, rig, chat) loads
// and the visitor has no local session, silently bounce to the apex broker once
// to inherit an existing apex login. The apex answers with a single-use ticket
// that this host redeems for its own host-only cookie (see functions/api/sso.ts).
//
// Hard rails enforced here (belt-and-braces with the server allowlist):
//   - NEVER runs on the apex itself (it IS the broker — nothing to inherit).
//   - NEVER runs on a tenant app host (only the enumerated first-party views).
//   - Runs AT MOST ONCE per tab (sessionStorage guard) to avoid redirect loops
//     when the visitor is genuinely logged out everywhere.

// Mirror of the SERVER allowlist (functions/api/_firstParty.ts). Kept in sync by
// the shared-list test. The apex is intentionally EXCLUDED here — it brokers, it
// does not inherit.
const FIRST_PARTY_INHERIT_HOSTS: ReadonlySet<string> = new Set([
  'gitsmith.nates-software.com',
  'git.nates-software.com',
  'hotwire.nates-software.com',
  'slopshop.nates-software.com',
  'rig.nates-software.com',
  'chat.nates-software.com',
]);

const APEX_HOST = 'nates-software.com';
const SSO_ATTEMPT_KEY = 'nsw_sso_attempted';

function normalize(host: string): string {
  let h = (host || '').trim().toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/**
 * If the current host is a first-party view (not the apex, not a tenant app) and
 * we haven't already tried this tab, redirect to the apex broker to inherit a
 * login. Returns true if a redirect was initiated (caller should stop rendering
 * decisions — navigation is happening).
 *
 * `opts.now`/`opts.win` injectable for tests.
 */
export function attemptFirstPartySSO(
  opts: { win?: Pick<Window, 'location' | 'sessionStorage'>; host?: string } = {}
): boolean {
  const win = opts.win ?? (typeof window !== 'undefined' ? window : undefined);
  if (!win) return false;

  const host = normalize(opts.host ?? win.location.hostname);

  // Only inherit on enumerated first-party views. Apex and tenant hosts: never.
  if (host === APEX_HOST || !FIRST_PARTY_INHERIT_HOSTS.has(host)) return false;

  // Once per tab. A genuinely-logged-out visitor bounces to apex, apex has no
  // session, apex bounces back with ?sso=login_required — the guard stops a loop.
  let attempted: string | null = null;
  try {
    attempted = win.sessionStorage.getItem(SSO_ATTEMPT_KEY);
  } catch {
    // sessionStorage unavailable (private mode edge) — skip SSO rather than risk
    // a loop we can't guard.
    return false;
  }
  if (attempted) return false;

  try {
    win.sessionStorage.setItem(SSO_ATTEMPT_KEY, '1');
  } catch {
    return false;
  }

  const returnTo = encodeURIComponent(host);
  win.location.href = `https://${APEX_HOST}/api/sso?action=authorize&return_to=${returnTo}`;
  return true;
}
