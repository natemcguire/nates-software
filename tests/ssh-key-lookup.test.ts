import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1Database } from './fixtures/d1Harness';
import { onRequestPost as gitPost } from '../functions/api/git';

// Regression test for the D1 "LIKE or GLOB pattern too complex" bug:
// gateway-identify-ssh-key / gateway-authorize-ssh previously used
//   WHERE ssh_public_key = ? OR ssh_public_key LIKE ?
// with an ~82+ char pattern, which Cloudflare D1 rejects, 500ing the lookup
// so every SSH key was refused. The fix uses a LIKE-free substr prefix match.
// These tests exercise the REAL handler + REAL D1 (harness), unlike the
// transport test which mocks the identify action.

const KEY_TYPE = 'ssh-ed25519';
// A realistic ed25519 public key base64 (68 chars) — long enough that the old
// LIKE pattern would have exceeded D1's limit.
const KEY_B64 = 'AAAAC3NzaC1lZDI1NTE5AAAAIExampleExampleExampleExampleExampleExampleAb';

const GATEWAY_SECRET = 'test-gateway-secret';

function gwRequest(body: any) {
  return new Request('https://nates-software.com/api/git', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_SECRET}`,
    },
    body: JSON.stringify(body),
  });
}

describe('SSH key lookup (D1 LIKE-free prefix match)', () => {
  let ctx: any;
  let env: any;

  beforeEach(async () => {
    ctx = await createTestD1Database();
    env = { DB: ctx.d1, GITSMITH_GATEWAY_TOKEN: GATEWAY_SECRET };
  });

  async function registerKeyWithComment(userId: string, username: string, storedKey: string) {
    await ctx.d1.prepare(
      `INSERT INTO users (id, username, display_name, role, ssh_public_key, created_at)
       VALUES (?, ?, ?, 'maker', ?, CURRENT_TIMESTAMP)`
    ).bind(userId, username, username, storedKey).run();
  }

  it('identifies a key STORED WITH A TRAILING COMMENT via a base64 that would break the old LIKE query', async () => {
    // Stored exactly as `ssh-keygen`/profile registration stores it: type base64 comment
    const stored = `${KEY_TYPE} ${KEY_B64} nate.mcguire@gmail.com`;
    await registerKeyWithComment('usr_test', 'testmaker', stored);

    const res = await gitPost({
      request: gwRequest({ action: 'gateway-identify-ssh-key', keyType: KEY_TYPE, keyBase64: KEY_B64 }),
      env,
    } as any);
    const data: any = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.actorUserId).toBe('usr_test');
  });

  it('identifies a key stored with NO comment (exact match branch)', async () => {
    await registerKeyWithComment('usr_test2', 'nocomment', `${KEY_TYPE} ${KEY_B64}`);
    const res = await gitPost({
      request: gwRequest({ action: 'gateway-identify-ssh-key', keyType: KEY_TYPE, keyBase64: KEY_B64 }),
      env,
    } as any);
    const data: any = await res.json();
    expect(res.status).toBe(200);
    expect(data.actorUserId).toBe('usr_test2');
  });

  it('does NOT match a different key that merely shares a prefix substring', async () => {
    // A stored key whose base64 starts with our base64 but is a DIFFERENT key
    // (longer base64) must not be a false-positive prefix match.
    await registerKeyWithComment('usr_other', 'other', `${KEY_TYPE} ${KEY_B64}EXTRA extra@host`);
    const res = await gitPost({
      request: gwRequest({ action: 'gateway-identify-ssh-key', keyType: KEY_TYPE, keyBase64: KEY_B64 }),
      env,
    } as any);
    const data: any = await res.json();
    // The prefix guard requires a following space, so `${KEY_B64}EXTRA ...` must NOT match `${KEY_B64}`.
    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
  });

  it('rejects an unregistered key honestly (401, no 500)', async () => {
    const res = await gitPost({
      request: gwRequest({ action: 'gateway-identify-ssh-key', keyType: KEY_TYPE, keyBase64: KEY_B64 }),
      env,
    } as any);
    const data: any = await res.json();
    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
    expect(String(data.error || '')).not.toMatch(/lookup failed|too complex/i);
  });
});
