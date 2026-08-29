import { beforeEach, describe, expect, it } from 'vitest';
import * as commentsApi from '../functions/api/comments';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';

describe('HOTWIRE comments persistence', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
  });

  const post = (body: unknown, token?: string) => commentsApi.onRequestPost({
    request: new Request('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    }),
    env: { DB: ctx.d1 }
  });

  it('requires authentication before accepting comment identity', async () => {
    const response = await post({ appId: 'dronehunter', text: 'hello', author: 'nate' });
    expect(response.status).toBe(401);
  });

  it('stores the authenticated author and starts with zero upvotes', async () => {
    const response = await post({
      appId: 'dronehunter', text: 'The reload sound is excellent.', author: 'attacker', avatar: '❌'
    }, 'test_token_nate');
    expect(response.status).toBe(201);
    const body: any = await response.json();
    expect(body.comment.author).toBe('nate');
    expect(body.comment.upvotes).toBe(0);
    const row: any = await ctx.d1.prepare('SELECT user_id, upvotes FROM comments WHERE id = ?').bind(body.commentId).first();
    expect(row.user_id).toBe('usr_nate');
    expect(row.upvotes).toBe(0);
  });

  it('rejects missing apps and oversized text', async () => {
    expect((await post({ appId: 'missing-app', text: 'hello' }, 'test_token_nate')).status).toBe(404);
    expect((await post({ appId: 'dronehunter', text: 'x'.repeat(2001) }, 'test_token_nate')).status).toBe(400);
  });

  it('returns canonical comments and fails closed without storage', async () => {
    await post({ appId: 'dronehunter', text: 'persisted' }, 'test_token_nate');
    const response = await commentsApi.onRequestGet({
      request: new Request('http://localhost/api/comments?app_id=dronehunter'), env: { DB: ctx.d1 }
    });
    const comments = (await response.json() as any).comments;
    expect(comments.some((comment: any) => comment.text === 'persisted' && comment.author === 'nate')).toBe(true);
    const unavailable = await commentsApi.onRequestGet({
      request: new Request('http://localhost/api/comments?app_id=dronehunter'), env: {}
    });
    expect(unavailable.status).toBe(503);
  });
});
