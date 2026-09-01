export function extractSessionToken(request: Request): { token: string; source: 'bearer' | 'cookie' | null } {
  const authorization = request.headers.get('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    return { token: authorization.slice(7).trim(), source: 'bearer' };
  }
  const match = request.headers.get('Cookie')?.match(/(?:^|;\s*)nsw_session=([^;]+)/);
  return { token: match?.[1] || '', source: match ? 'cookie' : null };
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// The session cookie is HOST-ONLY (no Domain= attribute) on purpose. The
// platform hosts UNTRUSTED tenant apps at <app>.nates-software.com, whose bytes
// the maker controls and which the router proxies to attacker-controlled
// origins. A Domain=.nates-software.com cookie would be sent by the browser to
// those tenant origins — handing the victim's session token to attacker code
// (account takeover). Keeping the cookie host-only means it is only ever sent
// back to the exact first-party host that issued it, so tenant apps never see
// it. (Cross-subdomain login for the standalone app-shell hosts is therefore
// NOT via a shared cookie — that would reintroduce the exfiltration vector.)
export function sessionCookie(request: Request, token: string, maxAge = 2_592_000): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `nsw_session=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function isSameOriginMutation(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  const { source } = extractSessionToken(request);
  if (source !== 'cookie') return true;
  // The cookie is host-only, so a cookie-authenticated mutation can only ever be
  // issued by the exact origin that holds it. Require a strict same-origin match
  // (classic CSRF guard). Bearer-token mutations are exempt above.
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}
