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

// TRUSTED first-party app-shell hosts for cookie-authenticated mutations.
// CRITICAL: the session cookie is Domain-scoped to .nates-software.com so login
// carries across the app shell — but the platform ALSO hosts UNTRUSTED tenant
// apps at <app>.nates-software.com (attacker-controlled bytes). So CSRF trust
// must NOT be "any nates-software.com subdomain" (that would let evil.nates-
// software.com forge authenticated mutations with the shared cookie). It is an
// explicit allowlist of the first-party origins that serve the desktop SPA and
// legitimately issue cross-subdomain authenticated writes. Everything else —
// tenant apps, standalone project sites, foreign sites — is treated as cross-site.
const TRUSTED_MUTATION_HOSTS = new Set([
  'nates-software.com',
  'www.nates-software.com',
  'chat.nates-software.com',
  'gitsmith.nates-software.com',
  'git.nates-software.com',
  'hotwire.nates-software.com',
  'inbox.nates-software.com',
  'slopshop.nates-software.com',
  'rig.nates-software.com',
  'dyno.nates-software.com',
  'profile.nates-software.com',
]);

function isTrustedMutationHost(hostname: string): boolean {
  if (TRUSTED_MUTATION_HOSTS.has(hostname)) return true;
  // Preview/local hosts serve the trusted app shell too (never tenant apps):
  // the *.pages.dev deployment and localhost. Tenant apps only live under the
  // real nates-software.com apex, so these are safe to trust.
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (hostname.endsWith('.nates-software.pages.dev') || hostname === 'nates-software.pages.dev') return true;
  return false;
}

export function isSameOriginMutation(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  const { source } = extractSessionToken(request);
  if (source !== 'cookie') return true;
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    const originHost = new URL(origin).hostname;
    const targetHost = new URL(request.url).hostname;
    // Exact-origin is always fine. Otherwise the Origin must be a TRUSTED
    // first-party app-shell host AND the request target must also be one —
    // a cookie mutation from an untrusted tenant subdomain is blocked as CSRF.
    if (origin === new URL(request.url).origin) return true;
    return isTrustedMutationHost(originHost) && isTrustedMutationHost(targetHost);
  } catch {
    return false;
  }
}
