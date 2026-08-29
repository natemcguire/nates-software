import { beforeEach, describe, expect, it } from 'vitest';
import * as feedApi from '../functions/api/feed';
import { createTestD1Database, type TestD1Context } from './fixtures/d1Harness';

describe('Canonical HOTWIRE RSS and JSON syndication', () => {
  let ctx: TestD1Context;

  beforeEach(async () => {
    ctx = await createTestD1Database({ foreignKeys: true });
    await ctx.d1.prepare(`INSERT INTO app_listings
      (id, name, tagline, description, creator_id, version, price, created_at)
      VALUES ('feed-app', ?, ?, ?, 'usr_nate', 'v1.2.3', '$15.00', '2026-08-20 12:01:00')`)
      .bind('Feed & App', 'Real <shareware>', 'A canonical ]]> release').run();
  });

  it('returns escaped RSS grounded in canonical listing timestamps', async () => {
    const response = await feedApi.onRequestGet({
      request: new Request('http://localhost/api/feed'), env: { DB: ctx.d1 }
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/rss+xml');
    expect(body).toContain('<rss version="2.0"');
    expect(body).toContain('Feed &amp; App');
    expect(body).toContain('Real &lt;shareware&gt;');
    expect(body).toContain('Thu, 20 Aug 2026 12:01:00 GMT');
    expect(body).not.toContain('<![CDATA[');
    expect(body).not.toContain('70% maker');
  });

  it('returns JSON Feed v1.1 without fabricated subdomains or publication dates', async () => {
    const response = await feedApi.onRequestGet({
      request: new Request('http://localhost/api/feed?format=json'), env: { DB: ctx.d1 }
    });
    const body: any = await response.json();
    expect(response.status).toBe(200);
    expect(body.version).toBe('https://jsonfeed.org/version/1.1');
    const item = body.items.find((candidate: any) => candidate.url.endsWith('?app=feed-app'));
    expect(item.url).toBe('https://nates-software.com/?app=feed-app');
    expect(item.date_published).toBe('2026-08-20T12:01:00.000Z');
    expect(item.authors[0].name).toBe('@nate');
  });

  it('fails closed when canonical storage is unavailable', async () => {
    const rss = await feedApi.onRequestGet({ request: new Request('http://localhost/api/feed'), env: {} });
    const json = await feedApi.onRequestGet({ request: new Request('http://localhost/api/feed?format=json'), env: {} });
    expect(rss.status).toBe(503);
    expect(json.status).toBe(503);
    expect((await json.json() as any).success).toBe(false);
  });
});
