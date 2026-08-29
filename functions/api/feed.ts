// GET /api/feed - RSS 2.0 XML & JSON Feed v1.1 Syndication Engine
// Live syndication for AI agents, newsletters, and Hacker News scrapers

import { INITIAL_APPS } from '../../src/data/mockData';

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'xml';
    const baseUrl = 'https://nates-software.com';

    let apps = INITIAL_APPS;
    if (env && env.DB) {
      const { results } = await env.DB.prepare(`
        SELECT id, name, tagline, description, price, version, creator_id, created_at
        FROM app_listings
        ORDER BY created_at DESC
        LIMIT 20
      `).all();
      if (results && results.length > 0) {
        apps = results as any;
      }
    }

    if (format === 'json') {
      const jsonFeed = {
        version: 'https://jsonfeed.org/version/1.1',
        title: "Nate's Software — Daily Shareware Drops",
        home_page_url: baseUrl,
        feed_url: `${baseUrl}/api/feed?format=json`,
        description: 'Curated 12:01 AM UTC shareware releases, forkable projects, and lineage-aware mods.',
        icon: `${baseUrl}/icon-512.svg`,
        favicon: `${baseUrl}/favicon.ico`,
        items: apps.map(app => ({
          id: `${baseUrl}/#app-${app.id}`,
          url: `https://${app.id}.nates-software.com`,
          title: `${app.name} (${app.version || 'v1.0.0'})`,
          content_text: `${app.tagline || app.description}. Shareware license: ${app.price || '$15.00'} (70% maker, 20% lineage royalty).`,
          date_published: new Date().toISOString(),
          authors: [{ name: app.author || app.creator || 'Nate McGuire', url: `${baseUrl}/profile` }]
        }))
      };

      return new Response(JSON.stringify(jsonFeed, null, 2), {
        headers: {
          'Content-Type': 'application/feed+json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Default: RSS 2.0 XML
    const itemsXml = apps.map(app => `
    <item>
      <title><![CDATA[${app.name} (${app.version || 'v1.0.0'}) - ${app.tagline || 'Shareware'}]]></title>
      <link>https://${app.id}.nates-software.com</link>
      <guid isPermaLink="false">nates-software-${app.id}-${app.version || '1.0.0'}</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[${app.description || app.tagline} · Shareware License ${app.price || '$15.00'}]]></description>
      <author>nate@nates-software.com (@${app.author || app.creator || 'nate'})</author>
      <category>Shareware</category>
    </item>`).join('');

    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Nate's Software — Daily Shareware Drops</title>
    <link>${baseUrl}</link>
    <description>Curated 12:01 AM UTC shareware releases, forkable projects, and lineage-aware mods.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${baseUrl}/api/feed" rel="self" type="application/rss+xml" />
    ${itemsXml}
  </channel>
</rss>`;

    return new Response(rssXml.trim(), {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err: any) {
    return new Response(`Error generating syndication feed: ${err.message}`, { status: 500 });
  }
};
