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

export function sessionCookie(request: Request, token: string, maxAge = 2_592_000): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `nsw_session=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function isSameOriginMutation(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  const { source } = extractSessionToken(request);
  if (source !== 'cookie') return true;
  
  
  
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}
