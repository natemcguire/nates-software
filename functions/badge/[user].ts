// Cloudflare Pages Function: GET /badge/:user.svg or GET /badge/:user
// Dynamic SVG badge server querying canonical DYNO benchmark results from Cloudflare D1
// Strictly aligned with migrations/0007_dyno_real_world_benchmarks.sql

export const onRequestGet = async ({ params, env }: { params: { user: string }; env: any }) => {
  try {
    const rawUser = params.user || 'nate';
    const username = rawUser.replace(/\.svg$/, '').replace(/^@/, '');

    let score = 0;
    let verificationStatus = 'unverified';
    let hasRun = false;

    if (env && env.DB) {
      const run = await env.DB.prepare(`
        SELECT r.overall_score, r.verification_status, s.model_id, s.agent_harness
        FROM dyno_runs r
        JOIN users u ON r.submitted_by_user_id = u.id
        JOIN dyno_subjects s ON r.subject_id = s.id
        WHERE u.username = ?
          AND r.status = 'completed'
          AND r.suite_id = (
            SELECT id FROM dyno_suites WHERE status = 'active'
            ORDER BY published_at DESC, created_at DESC, id DESC LIMIT 1
          )
          AND r.verification_status IN ('reproducible', 'verified')
        ORDER BY r.overall_score DESC, r.created_at DESC
        LIMIT 1
      `).bind(username).first();

      if (run && typeof run.overall_score === 'number') {
        score = Math.round(run.overall_score);
        verificationStatus = run.verification_status || 'unverified';
        hasRun = true;
      }
    }

    // Color based on verification level and score
    let badgeColor = '#6b7280'; // gray default for unverified/no run
    if (hasRun) {
      if (verificationStatus === 'verified' || verificationStatus === 'reproducible') {
        if (score >= 800) badgeColor = '#059669'; // emerald (pro/elite)
        else if (score >= 700) badgeColor = '#0284c7'; // sky blue (senior)
        else badgeColor = '#d97706'; // amber (standard)
      } else {
        badgeColor = '#4b5563'; // neutral slate for unverified
      }
    }

    const rightText = hasRun ? `${score} / 1000` : 'UNSCORED';
    const leftText = 'DYNO DEV SCORE';

    const leftWidth = 110;
    const rightWidth = hasRun ? 80 : 80;
    const totalWidth = leftWidth + rightWidth;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${leftText}: ${rightText}">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="a">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#a)">
    <rect width="${leftWidth}" height="20" fill="#1f2937"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${badgeColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#b)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${leftWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${leftText}</text>
    <text x="${leftWidth / 2}" y="14">${leftText}</text>
    <text x="${leftWidth + rightWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${rightText}</text>
    <text x="${leftWidth + rightWidth / 2}" y="14" font-weight="bold">${rightText}</text>
  </g>
</svg>`;

    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=60, s-maxage=300'
      }
    });
  } catch {
    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="20">
      <rect width="180" height="20" fill="#4b5563" rx="3"/>
      <text x="90" y="14" fill="#fff" text-anchor="middle" font-family="sans-serif" font-size="11">DYNO DEV SCORE | ERROR</text>
    </svg>`;
    return new Response(fallbackSvg, {
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' }
    });
  }
};
