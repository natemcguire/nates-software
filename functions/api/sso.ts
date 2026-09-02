// First-party cross-subdomain SSO broker (task #38).
//
// GET /api/sso?action=authorize&return_to=<host>   (runs on the APEX broker)
//   - Requires an authenticated apex session (host-only cookie).
//   - Validates return_to is a TRUSTED first-party host (never a tenant app host).
//   - Mints a single-use, 60s ticket bound to (user, return_host).
//   - 302 -> https://<return_to>/api/sso?action=callback&ticket=<opaque>
//
// GET /api/sso?action=callback&ticket=<opaque>      (runs on the DESTINATION host)
//   - Re-validates that THIS host is a trusted first-party host.
//   - Atomically redeems the ticket (race-safe; single-use).
//   - Issues a NEW host-only session cookie for THIS host, same user.
//   - 302 -> /
//
// Why this is safe: the real session token never appears in a URL or a
// cross-origin body — only an opaque, single-use, 60s ticket does, and it can
// only be redeemed at the exact allowlisted host it was minted for. Tenant app
// hosts (dronehunter.nates-software.com, attacker-controlled bytes) are NOT in
// the allowlist, so `authorize` refuses to mint a ticket for them and `callback`
// refuses to run on them. This preserves the host-only-cookie invariant that
// keeps tenant apps from ever seeing a victim's session.

import { extractSessionToken, hashSessionToken, sessionCookie } from './_session';
import { generateSessionToken } from './auth';
import {
  isFirstPartyHost,
  normalizeHost,
  SSO_BROKER_HOST,
} from './_firstParty';

const TICKET_TTL_MS = 60_000; // 60 seconds — a redirect round-trip, no more.
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // match the normal login session TTL.

function redirect(location: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

// A logged-out first-party host that can't broker sends the visitor back home
// rather than looping. Never leak internals in the redirect target.
function bounceHome(reason: string): Response {
  return redirect(`/?sso=${encodeURIComponent(reason)}`);
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  const thisHost = normalizeHost(url.hostname);

  if (!env?.DB) {
    // SSO is a convenience layer; if the ledger is down, fail SOFT to home
    // (never a scary 500) — the user can still log in normally on this host.
    return bounceHome('unavailable');
  }

  // ── authorize: only the apex broker mints tickets ────────────────────────
  if (action === 'authorize') {
    if (thisHost !== SSO_BROKER_HOST) {
      // Only the apex holds the canonical session and may broker. Anything else
      // asking to "authorize" is misrouted — bounce it home.
      return bounceHome('not_broker');
    }

    const returnToRaw = url.searchParams.get('return_to') || '';
    // return_to may arrive as a bare host or a full origin; accept either, but
    // resolve to a host and validate it against the first-party allowlist.
    let returnHost: string;
    try {
      returnHost = normalizeHost(
        returnToRaw.includes('://') ? new URL(returnToRaw).hostname : returnToRaw
      );
    } catch {
      return bounceHome('bad_return');
    }
    // Refuse to broker for the apex itself (nothing to do) or any non-first-party
    // host. THIS is the hard rail: a tenant app host can never be a return target.
    if (returnHost === SSO_BROKER_HOST || !isFirstPartyHost(returnHost)) {
      return bounceHome('forbidden_return');
    }

    // Must have an authenticated apex session to mint a ticket for it.
    const { token } = extractSessionToken(request);
    if (!token) return bounceHome('login_required');
    const session = await env.DB.prepare(`
      SELECT s.user_id FROM user_sessions s
      WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
    `).bind(await hashSessionToken(token), Date.now()).first();
    if (!session) return bounceHome('login_required');

    // Mint an opaque single-use ticket bound to (user, returnHost).
    const ticket = generateSessionToken();
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO sso_tickets (ticket_hash, user_id, return_host, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(await hashSessionToken(ticket), session.user_id, returnHost, now, now + TICKET_TTL_MS).run();

    return redirect(`https://${returnHost}/api/sso?action=callback&ticket=${ticket}`);
  }

  // ── callback: the destination host redeems the ticket ────────────────────
  if (action === 'callback') {
    // Defense in depth: callback must only ever run on a trusted first-party host.
    // (The route is only reachable on our own Pages project, but re-check anyway
    // so a misconfigured Custom Domain can't turn this into a token oracle.)
    if (!isFirstPartyHost(thisHost) || thisHost === SSO_BROKER_HOST) {
      return bounceHome('forbidden_host');
    }

    const ticket = url.searchParams.get('ticket') || '';
    if (!ticket) return bounceHome('no_ticket');
    const ticketHash = await hashSessionToken(ticket);
    const now = Date.now();

    // Atomically redeem: single conditional UPDATE guarded on redeemed_at IS NULL
    // and bound to THIS host. D1 serializes this write, so a replayed/raced ticket
    // yields meta.changes === 0 (mirrors terminal_session_tickets redemption).
    const redeemed = await env.DB.prepare(`
      UPDATE sso_tickets SET redeemed_at = ?
      WHERE ticket_hash = ? AND return_host = ? AND redeemed_at IS NULL AND expires_at > ?
    `).bind(now, ticketHash, thisHost, now).run();
    if (redeemed.meta?.changes !== 1) {
      // Expired, wrong host, already used, or forged. Fail closed to home.
      return bounceHome('invalid_ticket');
    }

    const row = await env.DB.prepare(
      'SELECT user_id FROM sso_tickets WHERE ticket_hash = ?'
    ).bind(ticketHash).first();
    if (!row?.user_id) return bounceHome('invalid_ticket');

    // Issue a brand-new HOST-ONLY session cookie for THIS host, same user. The
    // token is per-host: it is only ever sent back to this exact origin, so the
    // host-only invariant that protects against tenant-app exfiltration holds.
    const newToken = generateSessionToken();
    await env.DB.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(await hashSessionToken(newToken), row.user_id, now + SESSION_TTL_MS).run();

    return redirect('/', { 'Set-Cookie': sessionCookie(request, newToken) });
  }

  return bounceHome('unknown_action');
};
