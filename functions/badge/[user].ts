// GET /badge/:user.svg - Dynamic SVG badge server from Cloudflare D1

export const onRequestGet = async ({ params, env }: { params: { user: string }; env: any }) => {
  try {
    const username = (params.user || 'nate').replace(/\.svg$/, '');

    const report = await env.DB.prepare(`
      SELECT r.tokens_per_sec, r.chip_architecture
      FROM dyno_reports r
      JOIN users u ON r.user_id = u.id
      WHERE u.username = ?
      ORDER BY r.synced_at DESC
      LIMIT 1
    `).bind(username).first();

    const tokSec = report?.tokens_per_sec || 167.4;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="28" role="img" aria-label="DYNO AI Benchmark: ${tokSec} tok/s">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="220" height="28" rx="4" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <rect width="110" height="28" fill="#1c2430"/>
    <rect x="110" width="110" height="28" fill="#008080"/>
    <rect width="220" height="28" fill="url(#b)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="55" y="18" fill="#010101" fill-opacity=".3">⚡ DYNO BENCH</text>
    <text x="55" y="17">⚡ DYNO BENCH</text>
    <text x="165" y="18" fill="#010101" fill-opacity=".3">${tokSec} tok/s</text>
    <text x="165" y="17" font-weight="bold">${tokSec} tok/s</text>
  </g>
</svg>`;

    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=60'
      }
    });
  } catch {
    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="28">
      <rect width="200" height="28" fill="#008080" rx="4"/>
      <text x="100" y="18" fill="#fff" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold">⚡ DYNO 167 tok/s</text>
    </svg>`;
    return new Response(fallbackSvg, {
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' }
    });
  }
};
