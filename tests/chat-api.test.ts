import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import { onRequestGet, onRequestPost } from '../functions/api/chat';

describe('CHAT web lounge persistence', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  const post = (body: unknown, token = 'test_token_nate') => onRequestPost({
    request: new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    }),
    env: { DB: ctx.d1 }
  });

  it('stores the authenticated user instead of trusting sender or operator fields', async () => {
    const response = await post({ channel: '#lounge', sender: 'attacker', isOp: 1, text: 'hello' });
    expect(response.status).toBe(201);
    const body: any = await response.json();
    expect(body.message.sender).toBe('nate');
    const row: any = await ctx.d1.prepare('SELECT user_id, text FROM chat_messages WHERE id = ?').bind(body.message.id).first();
    expect(row.user_id).toBe('usr_nate');
    expect(row.text).toBe('hello');
  });

  it('returns persisted messages through the canonical user join', async () => {
    await post({ channel: '#lounge', text: 'persisted' });
    const response = await onRequestGet({
      request: new Request('http://localhost/api/chat?channel=%23lounge'), env: { DB: ctx.d1 }
    });
    const body: any = await response.json();
    expect(response.status).toBe(200);
    expect(body.transport).toBe('web');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].sender).toBe('nate');
  });

  it('purges messages outside the declared 24-hour window', async () => {
    await ctx.d1.prepare(`INSERT INTO chat_messages (id, channel, user_id, text, created_at)
      VALUES ('msg_old', '#lounge', 'usr_nate', 'old', datetime('now', '-25 hours'))`).run();
    await onRequestGet({ request: new Request('http://localhost/api/chat?channel=%23lounge'), env: { DB: ctx.d1 } });
    expect(await ctx.d1.prepare("SELECT id FROM chat_messages WHERE id = 'msg_old'").first()).toBeNull();
  });

  it('rejects invalid channels, unsupported types, and oversized messages', async () => {
    expect((await post({ channel: 'not-a-channel', text: 'x' })).status).toBe(400);
    expect((await post({ channel: '#lounge', type: 'OPER', text: 'x' })).status).toBe(400);
    expect((await post({ channel: '#lounge', text: 'x'.repeat(2001) })).status).toBe(400);
  });

  it('fails closed instead of reporting an unstored message', async () => {
    const response = await onRequestPost({
      request: new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_token_nate' },
        body: JSON.stringify({ channel: '#lounge', text: 'not stored' })
      }),
      env: {}
    });
    expect(response.status).toBe(503);
    expect((await response.json() as any).success).toBe(false);
  });
});

