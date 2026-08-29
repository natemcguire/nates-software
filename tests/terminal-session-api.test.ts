import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import * as terminalApi from '../functions/api/terminal-session';

const envFor = (ctx: TestD1Context) => ({
  DB: ctx.d1,
  TERMINAL_TICKET_SECRET: 'ticket-secret-for-tests',
  TERMINAL_GATEWAY_URL: 'https://terminal.example.test',
  TERMINAL_GATEWAY_SERVICE_SECRET: 'gateway-secret-for-tests',
  __TERMINAL_GATEWAY_FETCH: async () => Response.json({
    isProductionVps: true,
    isolationType: 'vps',
    features: { ephemeralWorkspaces: true, autoCleanup: true }
  })
});

describe('ephemeral terminal ticket lifecycle', () => {
  let ctx: TestD1Context;
  beforeEach(async () => { ctx = await createTestD1Database({ foreignKeys: true }); });

  it('requires an authenticated user to mint a ticket', async () => {
    const response = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session', { method: 'POST' }),
      env: envFor(ctx)
    });
    expect(response.status).toBe(401);
  });

  it('fails closed without the session ledger and rejects unknown actions', async () => {
    const missingLedger = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session', { method: 'POST' }),
      env: {}
    });
    expect(missingLedger.status).toBe(503);

    const unsupported = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session?action=destroy-all', { method: 'POST' }),
      env: envFor(ctx)
    });
    expect(unsupported.status).toBe(400);
  });

  it('mints a 60-second ticket and atomically rejects redemption replay', async () => {
    const minted = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session', {
        method: 'POST', headers: { Authorization: 'Bearer test_token_nate' }
      }),
      env: envFor(ctx)
    });
    expect(minted.status).toBe(200);
    const body = await minted.json() as any;
    const claims = JSON.parse(Buffer.from(body.ticket.split('.')[0], 'base64url').toString('utf8'));
    expect(claims.aud).toBe('terminal-gateway');
    expect(claims.exp - claims.iat).toBe(60);

    const redeem = () => terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session?action=redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer gateway-secret-for-tests', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jti: claims.jti, userId: claims.sub, gatewaySessionId: 'gateway-session-1' })
      }),
      env: envFor(ctx)
    });
    expect((await redeem()).status).toBe(200);
    expect((await redeem()).status).toBe(409);

    const close = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session?action=close', {
        method: 'POST',
        headers: { Authorization: 'Bearer gateway-secret-for-tests', 'Content-Type': 'application/json' },
        body: JSON.stringify({ gatewaySessionId: 'gateway-session-1' })
      }),
      env: envFor(ctx)
    });
    expect(close.status).toBe(200);
    const row = await ctx.d1.prepare('SELECT redeemed_at, closed_at FROM terminal_session_tickets WHERE jti = ?').bind(claims.jti).first<any>();
    expect(row?.redeemed_at).toBeTruthy();
    expect(row?.closed_at).toBeTruthy();
  });

  it('rejects gateway lifecycle mutations without its service credential', async () => {
    const response = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session?action=redeem', { method: 'POST' }),
      env: envFor(ctx)
    });
    expect(response.status).toBe(401);
  });

  it('returns 503 if terminal secrets or gateway URL are unconfigured', async () => {
    const response = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session', {
        method: 'POST',
        headers: { Authorization: 'Bearer test_token_nate' }
      }),
      env: { DB: ctx.d1 } // missing secrets and gateway URL
    });
    expect(response.status).toBe(503);
    const body = await response.json() as any;
    expect(body.error).toContain('not configured');
  });

  it('does not mint or consume quota unless a production VPS gateway verifies cleanup', async () => {
    const env = {
      ...envFor(ctx),
      __TERMINAL_GATEWAY_FETCH: async () => Response.json({
        isProductionVps: false,
        isolationType: 'process',
        features: { ephemeralWorkspaces: true, autoCleanup: true }
      })
    };
    const response = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session', {
        method: 'POST', headers: { Authorization: 'Bearer test_token_nate' }
      }),
      env
    });
    expect(response.status).toBe(503);
    expect((await response.json() as any).error).toContain('VPS gateway is unavailable');
    expect(await ctx.d1.prepare('SELECT count(*) AS count FROM terminal_session_tickets').first('count')).toBe(0);
  });

  it('enforces 10-ticket daily rate limit per user', async () => {
    const env = envFor(ctx);
    const now = Date.now();

    // Insert 10 tickets for usr_nate in the last 24h
    for (let i = 0; i < 10; i++) {
      const issued = now - 60000 - 1000 * i;
      await ctx.d1.prepare(`
        INSERT INTO terminal_session_tickets (jti, user_id, issued_at, expires_at, redeemed_at, closed_at)
        VALUES (?, 'usr_nate', ?, ?, ?, ?)
      `).bind(`jti-seed-${i}`, issued, issued + 60000, issued + 100, issued + 500).run();
    }

    const response = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session', {
        method: 'POST',
        headers: { Authorization: 'Bearer test_token_nate' }
      }),
      env
    });
    expect(response.status).toBe(429);
    const body = await response.json() as any;
    expect(body.error).toContain('Daily ephemeral terminal limit reached');
  });

  it('rejects minting if user already has an active, unclosed session', async () => {
    const env = envFor(ctx);
    const now = Date.now();

    // Insert active redeemed session for usr_nate
    await ctx.d1.prepare(`
      INSERT INTO terminal_session_tickets (jti, user_id, issued_at, expires_at, redeemed_at, session_expires_at, gateway_session_id)
      VALUES ('jti-active-1', 'usr_nate', ?, ?, ?, ?, 'gw-sess-active')
    `).bind(now - 5000, now + 55000, now - 4000, now + 15 * 60000).run();

    const response = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session', {
        method: 'POST',
        headers: { Authorization: 'Bearer test_token_nate' }
      }),
      env
    });
    expect(response.status).toBe(409);
    const body = await response.json() as any;
    expect(body.error).toContain('already have an active terminal session');
  });

  it('atomically rejects a second ticket redemption while another session is active', async () => {
    const env = envFor(ctx);
    const now = Date.now();
    await ctx.d1.prepare(`
      INSERT INTO terminal_session_tickets (jti, user_id, issued_at, expires_at)
      VALUES ('jti-race-a', 'usr_nate', ?, ?), ('jti-race-b', 'usr_nate', ?, ?)
    `).bind(now - 100, now + 60_000, now - 100, now + 60_000).run();

    const redeem = (jti: string, gatewaySessionId: string) => terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session?action=redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer gateway-secret-for-tests', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jti, userId: 'usr_nate', gatewaySessionId })
      }),
      env
    });

    expect((await redeem('jti-race-a', 'gateway-race-a')).status).toBe(200);
    expect((await redeem('jti-race-b', 'gateway-race-b')).status).toBe(409);
    const second = await ctx.d1.prepare('SELECT redeemed_at, gateway_session_id FROM terminal_session_tickets WHERE jti = ?')
      .bind('jti-race-b').first<any>();
    expect(second?.redeemed_at).toBeNull();
    expect(second?.gateway_session_id).toBeNull();
  });

  it('validates required payload fields on redeem and close actions', async () => {
    const env = envFor(ctx);

    // Missing fields on redeem -> 400
    const res1 = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session?action=redeem', {
        method: 'POST',
        headers: { Authorization: 'Bearer gateway-secret-for-tests', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jti: 'jti-only' })
      }),
      env
    });
    expect(res1.status).toBe(400);

    // Missing gatewaySessionId on close -> 400
    const res2 = await terminalApi.onRequestPost({
      request: new Request('https://nates-software.com/api/terminal-session?action=close', {
        method: 'POST',
        headers: { Authorization: 'Bearer gateway-secret-for-tests', 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }),
      env
    });
    expect(res2.status).toBe(400);
  });
});
