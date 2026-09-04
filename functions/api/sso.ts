import { extractSessionToken, hashSessionToken, sessionCookie } from './_session';
import { generateSessionToken } from './auth';
import {
  isFirstPartyHost,
  normalizeHost,
  SSO_BROKER_HOST,
} from './_firstParty';

const TICKET_TTL_MS = 60_000;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

function redirect(location: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function bounceHome(reason: string): Response {
  return redirect(`/?sso=${encodeURIComponent(reason)}`);
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  const thisHost = normalizeHost(url.hostname);

  if (!env?.DB) {
    return bounceHome('unavailable');
  }

  if (action === 'authorize') {
    if (thisHost !== SSO_BROKER_HOST) {
      return bounceHome('not_broker');
    }

    const returnToRaw = url.searchParams.get('return_to') || '';
    let returnHost: string;
    try {
      returnHost = normalizeHost(
        returnToRaw.includes('://') ? new URL(returnToRaw).hostname : returnToRaw
      );
    } catch {
      return bounceHome('bad_return');
    }
    if (returnHost === SSO_BROKER_HOST || !isFirstPartyHost(returnHost)) {
      return bounceHome('forbidden_return');
    }

    const { token } = extractSessionToken(request);
    if (!token) return bounceHome('login_required');
    const session = await env.DB.prepare(`
      SELECT s.user_id FROM user_sessions s
      WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL
    `).bind(await hashSessionToken(token), Date.now()).first();
    if (!session) return bounceHome('login_required');

    const ticket = generateSessionToken();
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO sso_tickets (ticket_hash, user_id, return_host, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(await hashSessionToken(ticket), session.user_id, returnHost, now, now + TICKET_TTL_MS).run();

    return redirect(`https://${returnHost}/api/sso?action=callback&ticket=${ticket}`);
  }

  if (action === 'callback') {
    if (!isFirstPartyHost(thisHost) || thisHost === SSO_BROKER_HOST) {
      return bounceHome('forbidden_host');
    }

    const ticket = url.searchParams.get('ticket') || '';
    if (!ticket) return bounceHome('no_ticket');
    const ticketHash = await hashSessionToken(ticket);
    const now = Date.now();

    const redeemed = await env.DB.prepare(`
      UPDATE sso_tickets SET redeemed_at = ?
      WHERE ticket_hash = ? AND return_host = ? AND redeemed_at IS NULL AND expires_at > ?
    `).bind(now, ticketHash, thisHost, now).run();
    if (redeemed.meta?.changes !== 1) {
      return bounceHome('invalid_ticket');
    }

    const row = await env.DB.prepare(
      'SELECT user_id FROM sso_tickets WHERE ticket_hash = ?'
    ).bind(ticketHash).first();
    if (!row?.user_id) return bounceHome('invalid_ticket');

    const newToken = generateSessionToken();
    await env.DB.prepare(`
      INSERT INTO user_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(await hashSessionToken(newToken), row.user_id, now + SESSION_TTL_MS).run();

    return redirect('/', { 'Set-Cookie': sessionCookie(request, newToken) });
  }

  return bounceHome('unknown_action');
};
