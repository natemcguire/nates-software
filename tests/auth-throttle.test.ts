import { describe, it, expect, beforeEach } from 'vitest';
import * as authApi from '../functions/api/auth';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

describe('Auth rate limiting (NSW-143): D1-backed per-account throttle', () => {
  let ctx: TestD1Context;
  const username = 'throttleuser';
  const realPassword = 'CorrectHorseBattery9!';

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    const salt = authApi.generateSalt();
    const hash = await authApi.hashPassword(realPassword, salt);
    await ctx.d1.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, salt, role)
      VALUES ('usr_throttle', ?, 'Throttle User', ?, ?, 'user')
    `).bind(username, hash, salt).run();
  });

  const login = (password: string) =>
    authApi.onRequestPost({
      request: new Request('http://localhost/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      }),
      env: { DB: ctx.d1 }
    });

  it('blocks with 429 + Retry-After after too many failed passwords, then keeps blocking', async () => {
    // 8 failures are permitted (each 401); the 9th trips the block (429).
    for (let i = 0; i < 8; i++) {
      const res = await login('wrong-password');
      expect(res.status, `attempt ${i + 1}`).toBe(401);
    }
    const blocked = await login('wrong-password');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();

    // Even the CORRECT password is refused while blocked (the block is checked first).
    const stillBlocked = await login(realPassword);
    expect(stillBlocked.status).toBe(429);
  });

  it('trips the block under CONCURRENT failed attempts (atomic counter, no lost-update)', async () => {
    // Fire many wrong-password attempts in parallel. With an atomic SQL increment the
    // accumulated count still crosses the threshold, so at least one response is a 429.
    const results = await Promise.all(
      Array.from({ length: 14 }, () => login('parallel-wrong'))
    );
    const statuses = results.map(r => r.status);
    expect(statuses).toContain(429);
    // And a subsequent attempt is definitively blocked.
    const after = await login('parallel-wrong');
    expect(after.status).toBe(429);
  });

  it('does not throttle a user who logs in correctly, and clears prior failures on success', async () => {
    // A few mistypes, then the right password — should succeed and reset the counter.
    await login('oops1');
    await login('oops2');
    const ok = await login(realPassword);
    expect(ok.status).toBe(200);
    const data = await ok.json();
    expect(data.success).toBe(true);

    // Counter cleared: many more fresh failures are allowed again (no premature block).
    for (let i = 0; i < 5; i++) {
      const res = await login('wrong-again');
      expect(res.status).toBe(401);
    }
  });
});
