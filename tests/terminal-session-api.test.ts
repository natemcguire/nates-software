import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import * as terminalApi from '../functions/api/terminal-session';

const envFor = (ctx: TestD1Context) => ({
  DB: ctx.d1,
  TERMINAL_TICKET_SECRET: 'ticket-secret-for-tests',
  TERMINAL_GATEWAY_URL: 'https://terminal.example.test',
  TERMINAL_GATEWAY_SERVICE_SECRET: 'gateway-secret-for-tests'
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
});
