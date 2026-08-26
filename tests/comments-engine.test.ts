import { describe, it, expect } from 'vitest';
import * as commentsApi from '../functions/api/comments';

describe('Interactive Hotwire & Sandbox Comments Engine', () => {
  it('should reject comment submission when text or appId is empty', async () => {
    const mockEnv = {};
    const req = new Request('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: '', text: '' })
    });

    const res = await commentsApi.onRequestPost({ request: req, env: mockEnv });
    const data = await res.json();

    expect(data.success).toBe(false);
    expect(data.error).toBe('appId and text are required');
  });

  it('should accept and format authenticated comment submission', async () => {
    const mockEnv = {};
    const req = new Request('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: 'dronehunter',
        text: 'The retro shotgun reload sound effect is incredible!',
        author: 'josh',
        avatar: '⛵'
      })
    });

    const res = await commentsApi.onRequestPost({ request: req, env: mockEnv });
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.comment.author).toBe('@josh');
    expect(data.comment.avatar).toBe('⛵');
    expect(data.comment.text).toContain('shotgun reload sound effect');
    expect(data.comment.time).toBe('Just now');
  });
});
