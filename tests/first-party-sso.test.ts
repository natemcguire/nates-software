import { describe, it, expect } from 'vitest';
import {
  FIRST_PARTY_SSO_HOSTS,
  SSO_BROKER_HOST,
  isFirstPartyHost,
  normalizeHost,
} from '../functions/api/_firstParty';
import { attemptFirstPartySSO } from '../src/lib/firstPartySSO';
import { onRequestGet as ssoGet } from '../functions/api/sso';

const TENANT_HOSTS = [
  'dronehunter.nates-software.com',
  'certified-mailer.nates-software.com',
  'american-gardener.nates-software.com',
  'picfitai.nates-software.com',
  'evil.nates-software.com',
  'wallart.nates-software.com',
];

describe('First-party SSO trust boundary (#38)', () => {
  describe('server allowlist (isFirstPartyHost)', () => {
    it('accepts the enumerated first-party hosts', () => {
      for (const h of ['nates-software.com', 'gitsmith.nates-software.com', 'hotwire.nates-software.com', 'slopshop.nates-software.com', 'rig.nates-software.com', 'chat.nates-software.com']) {
        expect(isFirstPartyHost(h)).toBe(true);
      }
    });

    it('REJECTS every tenant app host', () => {
      for (const h of TENANT_HOSTS) {
        expect(isFirstPartyHost(h)).toBe(false);
      }
    });

    it('rejects trailing-dot and case bypass attempts by normalizing first', () => {
      expect(isFirstPartyHost('DRONEHUNTER.nates-software.com')).toBe(false);
      expect(isFirstPartyHost('dronehunter.nates-software.com.')).toBe(false);
      expect(isFirstPartyHost('GITSMITH.NATES-SOFTWARE.COM')).toBe(true);
      expect(isFirstPartyHost('gitsmith.nates-software.com.')).toBe(true);
    });

    it('rejects lookalike and suffix-smuggling hosts', () => {
      expect(isFirstPartyHost('gitsmith.nates-software.com.evil.com')).toBe(false);
      expect(isFirstPartyHost('nates-software.com.attacker.net')).toBe(false);
      expect(isFirstPartyHost('notgitsmith.nates-software.com')).toBe(false);
      expect(isFirstPartyHost('')).toBe(false);
    });

    it('normalizeHost lowercases and strips exactly one trailing dot', () => {
      expect(normalizeHost('  GITSMITH.Nates-Software.com.  ')).toBe('gitsmith.nates-software.com');
    });
  });

  describe('authorize refuses to mint a ticket for a tenant return_to', () => {
    const makeEnv = () => ({
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ user_id: 'usr_victim' }),
            run: async () => ({ meta: { changes: 1 } }),
          }),
        }),
      },
    });

    it.each(TENANT_HOSTS)('does not 302 to tenant host %s', async (tenant) => {
      const req = new Request(
        `https://${SSO_BROKER_HOST}/api/sso?action=authorize&return_to=${encodeURIComponent(tenant)}`,
        { headers: { Cookie: 'nsw_session=validtoken' } }
      );
      const res = await ssoGet({ request: req, env: makeEnv() });
      expect(res.status).toBe(302);
      const loc = res.headers.get('Location') || '';
      expect(loc).not.toContain(tenant);
      expect(loc).toContain('forbidden_return');
    });

    it('mints and 302s to a genuine first-party return host', async () => {
      const req = new Request(
        `https://${SSO_BROKER_HOST}/api/sso?action=authorize&return_to=gitsmith.nates-software.com`,
        { headers: { Cookie: 'nsw_session=validtoken' } }
      );
      const res = await ssoGet({ request: req, env: makeEnv() });
      expect(res.status).toBe(302);
      const loc = res.headers.get('Location') || '';
      expect(loc).toContain('https://gitsmith.nates-software.com/api/sso?action=callback&ticket=');
    });

    it('refuses to broker when there is no apex session', async () => {
      const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
      const req = new Request(
        `https://${SSO_BROKER_HOST}/api/sso?action=authorize&return_to=gitsmith.nates-software.com`,
        { headers: { Cookie: 'nsw_session=validtoken' } }
      );
      const res = await ssoGet({ request: req, env });
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('login_required');
    });

    it('refuses to run authorize anywhere but the apex broker', async () => {
      const req = new Request(
        'https://gitsmith.nates-software.com/api/sso?action=authorize&return_to=hotwire.nates-software.com',
        { headers: { Cookie: 'nsw_session=validtoken' } }
      );
      const res = await ssoGet({ request: req, env: { DB: {} } });
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('not_broker');
    });
  });

  describe('callback refuses to run on a non-first-party host', () => {
    it.each(TENANT_HOSTS)('does not set a cookie on tenant host %s', async (tenant) => {
      const req = new Request(`https://${tenant}/api/sso?action=callback&ticket=whatever`, {});
      const res = await ssoGet({ request: req, env: { DB: {} } });
      expect(res.status).toBe(302);
      expect(res.headers.get('Set-Cookie')).toBeNull();
      expect(res.headers.get('Location')).toContain('forbidden_host');
    });

    it('rejects a ticket that fails atomic redemption (replay/expired/forged)', async () => {
      const env = {
        DB: {
          prepare: () => ({
            bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }),
          }),
        },
      };
      const req = new Request('https://gitsmith.nates-software.com/api/sso?action=callback&ticket=used', {});
      const res = await ssoGet({ request: req, env });
      expect(res.status).toBe(302);
      expect(res.headers.get('Set-Cookie')).toBeNull();
      expect(res.headers.get('Location')).toContain('invalid_ticket');
    });
  });

  describe('client trigger (attemptFirstPartySSO)', () => {
    const makeWin = (host: string) => {
      const store: Record<string, string> = {};
      return {
        location: { hostname: host, href: `https://${host}/` } as any,
        sessionStorage: {
          getItem: (k: string) => store[k] ?? null,
          setItem: (k: string, v: string) => { store[k] = v; },
        } as any,
      };
    };

    it('NEVER fires on the apex broker itself', () => {
      const win = makeWin('nates-software.com');
      expect(attemptFirstPartySSO({ win, host: 'nates-software.com' })).toBe(false);
      expect(win.location.href).toBe('https://nates-software.com/');
    });

    it.each(TENANT_HOSTS)('NEVER fires on tenant host %s', (tenant) => {
      const win = makeWin(tenant);
      expect(attemptFirstPartySSO({ win, host: tenant })).toBe(false);
      expect(win.location.href).toBe(`https://${tenant}/`);
    });

    it('fires exactly ONCE on a first-party view host', () => {
      const win = makeWin('gitsmith.nates-software.com');
      const first = attemptFirstPartySSO({ win, host: 'gitsmith.nates-software.com' });
      expect(first).toBe(true);
      expect(win.location.href).toContain('https://nates-software.com/api/sso?action=authorize&return_to=');
      expect(win.location.href).toContain('gitsmith.nates-software.com');
      win.location.href = 'https://gitsmith.nates-software.com/';
      const second = attemptFirstPartySSO({ win, host: 'gitsmith.nates-software.com' });
      expect(second).toBe(false);
      expect(win.location.href).toBe('https://gitsmith.nates-software.com/');
    });
  });

  describe('client and server allowlists stay in sync', () => {
    it('every client-inherit host is a server first-party host (minus the apex)', () => {
      const serverInheritable = [...FIRST_PARTY_SSO_HOSTS].filter(h => h !== SSO_BROKER_HOST);
      for (const h of serverInheritable) {
        const store: Record<string, string> = {};
        const win = {
          location: { hostname: h, href: `https://${h}/` } as any,
          sessionStorage: {
            getItem: (k: string) => store[k] ?? null,
            setItem: (k: string, v: string) => { store[k] = v; },
          } as any,
        };
        const fired = attemptFirstPartySSO({ win, host: h });
        if (h !== 'www.nates-software.com') {
          expect(fired).toBe(true);
        }
      }
    });
  });
});
