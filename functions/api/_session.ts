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

// The registrable apex the whole product ecosystem lives under. The desktop
// (apex) and every standalone app subdomain (hotwire/gitsmith/inbox/chat/
// slopshop.nates-software.com) must share one identity, so the session cookie
// is scoped to this domain with a leading dot. We only attach Domain= when the
// request host actually ends in this apex — on localhost and *.pages.dev
// previews a Domain=.nates-software.com cookie would be rejected outright and
// break login, so there the cookie stays host-only (correct for those hosts).
const SESSION_COOKIE_APEX = 'nates-software.com';

function sessionCookieDomainAttr(request: Request): string {
  const host = new URL(request.url).hostname;
  if (host === SESSION_COOKIE_APEX || host.endsWith(`.${SESSION_COOKIE_APEX}`)) {
    return `; Domain=.${SESSION_COOKIE_APEX}`;
  }
  return '';
}

export function sessionCookie(request: Request, token: string, maxAge = 2_592_000): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const domain = sessionCookieDomainAttr(request);
  return `nsw_session=${token}; HttpOnly${secure}; SameSite=Lax; Path=/${domain}; Max-Age=${maxAge}`;
}

// Registrable-domain (eTLD+1) of a hostname, good enough for our single apex:
// treat any host that IS or ends with nates-software.com as that site.
function sameSiteRegistrableHost(hostname: string): string | null {
  if (hostname === SESSION_COOKIE_APEX || hostname.endsWith(`.${SESSION_COOKIE_APEX}`)) {
    return SESSION_COOKIE_APEX;
  }
  return hostname; // fall back to exact host for non-ecosystem origins (localhost, previews)
}

export function isSameOriginMutation(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  const { source } = extractSessionToken(request);
  if (source !== 'cookie') return true;
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  // The session cookie is shared across apex + subdomains within nates-software.com,
  // so a cookie-authenticated mutation from one app subdomain to another (or the
  // apex) is legitimate same-SITE traffic, not CSRF. Compare registrable domains,
  // not exact origins — while still blocking a genuinely cross-site origin.
  try {
    const originHost = new URL(origin).hostname;
    const targetHost = new URL(request.url).hostname;
    return sameSiteRegistrableHost(originHost) === sameSiteRegistrableHost(targetHost);
  } catch {
    return false;
  }
}
