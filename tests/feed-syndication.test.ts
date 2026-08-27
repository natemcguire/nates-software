import { describe, it, expect } from 'vitest';
import * as feedApi from '../functions/api/feed';

describe('RSS 2.0 & JSON Feed v1.1 Syndication Engine (/api/feed)', () => {
  it('should return valid RSS 2.0 XML with channel and items', async () => {
    const req = new Request('http://localhost/api/feed?format=xml');
    const res = await feedApi.onRequestGet({ request: req, env: {} });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/rss+xml');
    const xml = await res.text();
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<title>Nate's Software — Daily Sovereign Shareware Drops</title>");
    expect(xml).toContain('<item>');
    expect(xml).toContain('DroneHunter 95');
  });

  it('should return valid JSON Feed v1.1 format', async () => {
    const req = new Request('http://localhost/api/feed?format=json');
    const res = await feedApi.onRequestGet({ request: req, env: {} });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/feed+json');
    const json = await res.json();
    expect(json.version).toBe('https://jsonfeed.org/version/1.1');
    expect(json.items.length).toBeGreaterThan(0);
    expect(json.items[0].title).toBeDefined();
    expect(json.items[0].url).toContain('nates-software.com');
  });
});
