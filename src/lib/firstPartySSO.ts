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

export function attemptFirstPartySSO(
  opts: { win?: Pick<Window, 'location' | 'sessionStorage'>; host?: string } = {}
): boolean {
  const win = opts.win ?? (typeof window !== 'undefined' ? window : undefined);
  if (!win) return false;

  const host = normalize(opts.host ?? win.location.hostname);

  if (host === APEX_HOST || !FIRST_PARTY_INHERIT_HOSTS.has(host)) return false;

  let attempted: string | null = null;
  try {
    attempted = win.sessionStorage.getItem(SSO_ATTEMPT_KEY);
  } catch {
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
