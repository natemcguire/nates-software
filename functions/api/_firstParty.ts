

export const FIRST_PARTY_SSO_HOSTS: ReadonlySet<string> = new Set([
  'nates-software.com',
  'www.nates-software.com',
  'gitsmith.nates-software.com',
  'git.nates-software.com',
  'hotwire.nates-software.com',
  'slopshop.nates-software.com',
  'rig.nates-software.com',
  'chat.nates-software.com',
]);

export const SSO_BROKER_HOST = 'nates-software.com';
export const SSO_BROKER_ORIGIN = `https://${SSO_BROKER_HOST}`;

export function normalizeHost(hostname: string): string {
  let h = (hostname || '').trim().toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

export function isFirstPartyHost(hostname: string): boolean {
  return FIRST_PARTY_SSO_HOSTS.has(normalizeHost(hostname));
}
