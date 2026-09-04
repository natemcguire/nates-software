const BASE_URL = 'https://nates-software.com';

function xml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function itemUrl(id: string): string {
  return `${BASE_URL}/?app=${encodeURIComponent(id)}`;
}

function publishedDate(value: unknown): string {
  const raw = String(value || '');
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const format = new URL(request.url).searchParams.get('format') === 'json' ? 'json' : 'xml';
  if (!env?.DB) {
    return format === 'json'
      ? Response.json({ success: false, error: 'HOTWIRE feed storage is unavailable.' }, { status: 503 })
      : new Response('HOTWIRE feed storage is unavailable.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  try {
    const { results } = await env.DB.prepare(`
      SELECT a.id, a.name, a.tagline, a.description, a.price, a.version,
             a.created_at, u.username AS creator
        FROM app_listings a
        JOIN users u ON u.id = a.creator_id
       ORDER BY a.created_at DESC, a.id ASC
       LIMIT 20
    `).all();
    const apps = results || [];

    if (format === 'json') {
      return new Response(JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: "Nate's Software — Daily Shareware Drops",
        home_page_url: BASE_URL,
        feed_url: `${BASE_URL}/api/feed?format=json`,
        description: 'Canonical HOTWIRE shareware releases from Nate’s Software.',
        icon: `${BASE_URL}/icon-512.svg`,
        favicon: `${BASE_URL}/favicon.ico`,
        items: apps.map((app: any) => ({
          id: `${BASE_URL}/drops/${encodeURIComponent(app.id)}/${encodeURIComponent(app.version)}`,
          url: itemUrl(app.id),
          title: `${app.name} (${app.version})`,
          content_text: `${app.tagline || app.description} · Shareware price ${app.price}`,
          date_published: publishedDate(app.created_at),
          authors: [{ name: `@${app.creator}`, url: `${BASE_URL}/?view=profile&user=${encodeURIComponent(app.creator)}` }]
        }))
      }, null, 2), {
        headers: { 'Content-Type': 'application/feed+json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const items = apps.map((app: any) => `
    <item>
      <title>${xml(`${app.name} (${app.version}) — ${app.tagline}`)}</title>
      <link>${xml(itemUrl(app.id))}</link>
      <guid isPermaLink="false">${xml(`nates-software-${app.id}-${app.version}`)}</guid>
      <pubDate>${xml(new Date(publishedDate(app.created_at)).toUTCString())}</pubDate>
      <description>${xml(`${app.description || app.tagline} · Shareware price ${app.price}`)}</description>
      <author>${xml(`@${app.creator}`)}</author>
      <category>Shareware</category>
    </item>`).join('');

    const latest = apps.length > 0 ? publishedDate((apps[0] as any).created_at) : new Date(0).toISOString();
    const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Nate&apos;s Software — Daily Shareware Drops</title>
    <link>${BASE_URL}</link>
    <description>Canonical HOTWIRE shareware releases from Nate&apos;s Software.</description>
    <language>en-us</language>
    <lastBuildDate>${xml(new Date(latest).toUTCString())}</lastBuildDate>
    <atom:link href="${BASE_URL}/api/feed" rel="self" type="application/rss+xml" />${items}
  </channel>
</rss>`;
    return new Response(feed, {
      headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error: any) {
    return format === 'json'
      ? Response.json({ success: false, error: `HOTWIRE feed query failed: ${error.message}` }, { status: 503 })
      : new Response(`HOTWIRE feed query failed: ${error.message}`, { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
};
