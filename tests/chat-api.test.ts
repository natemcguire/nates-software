import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';
import { onRequestGet, onRequestPost } from '../functions/api/chat';

async function seedUserSession(d1: any, userId: string, rawToken: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  await d1.prepare(`
    INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(tokenHash, userId, Date.now() + 86400000).run();
}

describe('CHAT web lounge persistence & identity', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  const post = (body: unknown, token: string | null = 'test_token_nate', search = '') => onRequestPost({
    request: new Request(`http://localhost/api/chat${search}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    }),
    env: { DB: ctx.d1 }
  });

  const get = (search = '?channel=%23lounge') => onRequestGet({
    request: new Request(`http://localhost/api/chat${search}`),
    env: { DB: ctx.d1 }
  });

  describe('Security & Sender Identity', () => {
    it('stores the authenticated user instead of trusting sender or operator fields', async () => {
      const response = await post({ channel: '#lounge', sender: 'attacker', isOp: 1, text: 'hello' });
      expect(response.status).toBe(201);
      const body: any = await response.json();
      expect(body.message.sender).toBe('nate');
      expect(body.message.isOp).toBe(1);

      const row: any = await ctx.d1.prepare('SELECT user_id, text FROM chat_messages WHERE id = ?').bind(body.message.id).first();
      expect(row.user_id).toBe('usr_nate');
      expect(row.text).toBe('hello');
    });

    it('derives regular maker role without operator status even if client claims isOp=1', async () => {
      const samToken = 'sam_session_token_123';
      await seedUserSession(ctx.d1, 'usr_sam', samToken);

      const response = await post({ channel: '#lounge', sender: 'super_admin_spoof', isOp: 1, text: 'regular user message' }, samToken);
      expect(response.status).toBe(201);
      const body: any = await response.json();
      expect(body.message.sender).toBe('sam');
      expect(body.message.isOp).toBe(0);

      const row: any = await ctx.d1.prepare('SELECT user_id, text FROM chat_messages WHERE id = ?').bind(body.message.id).first();
      expect(row.user_id).toBe('usr_sam');
    });

    it('rejects logged-out requests with 401 Unauthorized', async () => {
      const response = await post({ channel: '#lounge', text: 'anonymous post attempt' }, null);
      expect(response.status).toBe(401);
      const body: any = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unauthorized');
    });

    it('rejects invalid or revoked session tokens with 401 Unauthorized', async () => {
      const response = await post({ channel: '#lounge', text: 'invalid token' }, 'bogus_token_invalid');
      expect(response.status).toBe(401);
    });
  });

  describe('Message History & Storage', () => {
    it('returns persisted messages through the canonical user join', async () => {
      await post({ channel: '#lounge', text: 'persisted' });
      const response = await get('?channel=%23lounge');
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.transport).toBe('web');
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].sender).toBe('nate');
      expect(body.messages[0].type).toBe('PRIVMSG');
    });

    it('preserves ACTION message types across POST and GET', async () => {
      const resPost = await post({ channel: '#lounge', type: 'ACTION', text: 'is writing integration tests' });
      expect(resPost.status).toBe(201);
      const bodyPost: any = await resPost.json();
      expect(bodyPost.message.type).toBe('ACTION');

      const resGet = await get('?channel=%23lounge');
      const bodyGet: any = await resGet.json();
      expect(bodyGet.messages).toHaveLength(1);
      expect(bodyGet.messages[0].type).toBe('ACTION');
      expect(bodyGet.messages[0].text).toBe('is writing integration tests');
    });

    it('purges messages outside the declared 24-hour window', async () => {
      await ctx.d1.prepare(`INSERT INTO chat_messages (id, channel, user_id, message_type, text, created_at)
        VALUES ('msg_old', '#lounge', 'usr_nate', 'PRIVMSG', 'old', datetime('now', '-25 hours'))`).run();
      await get('?channel=%23lounge');
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

  describe('Presence & Heartbeat (Minimal-Real Presence)', () => {
    it('records heartbeat and upserts last_seen timestamp', async () => {
      const res = await post({ channel: '#lounge' }, 'test_token_nate', '?action=heartbeat');
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.heartbeat).toBe(true);
      expect(body.user).toBe('nate');

      const presenceRow: any = await ctx.d1.prepare(`
        SELECT user_id, channel, last_seen FROM chat_presence WHERE user_id = 'usr_nate' AND channel = '#lounge'
      `).first();
      expect(presenceRow).not.toBeNull();
      expect(presenceRow.user_id).toBe('usr_nate');
      expect(presenceRow.channel).toBe('#lounge');
    });

    it('automatically records presence when an authenticated user sends a message', async () => {
      await post({ channel: '#lounge', text: 'message heartbeat trigger' });
      const presenceRow: any = await ctx.d1.prepare(`
        SELECT user_id, channel FROM chat_presence WHERE user_id = 'usr_nate' AND channel = '#lounge'
      `).first();
      expect(presenceRow).not.toBeNull();
    });

    it('returns active users in WHO/NAMES/presence queries and drops stale users', async () => {

      await post({ channel: '#lounge' }, 'test_token_nate', '?action=heartbeat');

      await ctx.d1.prepare(`
        INSERT INTO chat_presence (user_id, channel, last_seen)
        VALUES ('usr_sam', '#lounge', datetime('now', '-20 seconds'))
      `).run();

      await ctx.d1.prepare(`
        INSERT INTO chat_presence (user_id, channel, last_seen)
        VALUES ('usr_josh', '#lounge', datetime('now', '-90 seconds'))
      `).run();

      const resWho = await get('?channel=%23lounge&action=who');
      const bodyWho: any = await resWho.json();
      expect(bodyWho.success).toBe(true);
      expect(bodyWho.presence).toHaveLength(2);
      const nicks = bodyWho.presence.map((p: any) => p.nick);
      expect(nicks).toContain('nate');
      expect(nicks).toContain('sam');
      expect(nicks).not.toContain('josh');

      const natePresence = bodyWho.presence.find((p: any) => p.nick === 'nate');
      expect(natePresence.isOp).toBe(true);

      const samPresence = bodyWho.presence.find((p: any) => p.nick === 'sam');
      expect(samPresence.isOp).toBe(false);
    });
  });

  describe('Topic Persistence', () => {
    it('returns default topic when no custom topic was set', async () => {
      const res = await get('?channel=%23lounge');
      const body: any = await res.json();
      expect(body.topic).toContain("Welcome to Nate's Software Global Lounge");
    });

    it('persists and updates channel topic across requests', async () => {
      const topicRes = await post({ channel: '#lounge', topic: '12:01 AM UTC Daily Drops Active · v2.0 Released' }, 'test_token_nate', '?action=topic');
      expect(topicRes.status).toBe(200);
      const topicBody: any = await topicRes.json();
      expect(topicBody.success).toBe(true);
      expect(topicBody.topic).toBe('12:01 AM UTC Daily Drops Active · v2.0 Released');

      const getRes = await get('?channel=%23lounge');
      const getBody: any = await getRes.json();
      expect(getBody.topic).toBe('12:01 AM UTC Daily Drops Active · v2.0 Released');

      const topicMsg = getBody.messages.find((m: any) => m.type === 'TOPIC');
      expect(topicMsg).toBeDefined();
      expect(topicMsg.text).toContain('nate changed topic to: "12:01 AM UTC Daily Drops Active · v2.0 Released"');
    });
  });
});
