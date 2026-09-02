// Single source of truth for FIRST-PARTY app-shell hosts that may participate in
// cross-subdomain SSO (task #38).
//
// SECURITY — this set is DELIBERATELY NARROWER than the router's
// EXCLUSION_HOSTNAMES. The exclusion list also contains tenant app hosts
// (dronehunter, certified-mailer, american-gardener, picfitai) that serve
// maker/attacker-controlled bytes. Those hosts MUST NOT be able to obtain an SSO
// ticket or a victim session — including them here would hand attacker-controlled
// origins a way to phish/redeem a real session. This list is ONLY the hosts whose
// bytes WE ship (the Web-OS app shell + first-party views).
//
// The apex (broker) itself is included because it is the origin that holds the
// canonical session cookie and mints tickets for the others.
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

// The canonical broker origin — the only host that holds the authoritative
// session and is allowed to mint SSO tickets.
export const SSO_BROKER_HOST = 'nates-software.com';
export const SSO_BROKER_ORIGIN = `https://${SSO_BROKER_HOST}`;

// Normalize a hostname: lowercase, trim, strip a single terminal trailing dot.
// (A trailing dot is a distinct-but-equivalent absolute FQDN and a classic
// allowlist-bypass trick — normalize it away before every comparison.)
export function normalizeHost(hostname: string): string {
  let h = (hostname || '').trim().toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

// True only for hosts whose bytes we control and which may share a login.
export function isFirstPartyHost(hostname: string): boolean {
  return FIRST_PARTY_SSO_HOSTS.has(normalizeHost(hostname));
}
