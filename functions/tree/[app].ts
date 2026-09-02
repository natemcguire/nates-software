// Cloudflare Pages Function: GET /tree/:app  (and /tree/:app.svg-style embed)
//
// The REAL embeddable lineage tree — the viral object. Returns a self-contained HTML
// page (safe to <iframe> into a README, a landing page, or share as a link) that renders
// the live fork family for :app straight from D1 via the same read model the JSON API
// uses. No client JS fetch, no external assets — the HTML ships the data inline, so an
// embed can't be blocked by a CSP or a slow API. Modern/premium look on purpose: this is
// an outward-facing artifact, deliberately unlike the retro desktop.

import { fetchLineageTree, resolveRepositoryIdForApp, LineageTree, LineageTreeNode } from '../../src/lib/lineageDomain';

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

// Escape untrusted text (handles/app ids are user-controlled) before it enters HTML.
function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dollars(cents: number): string {
  const n = Math.max(0, Math.round(cents)) / 100;
  // Whole-dollar amounts read cleaner without cents ($4,820); sub-$100 amounts keep
  // the exact cents so a first payout shows as $48.20, not $48.2.
  const fractionDigits = Number.isInteger(n) ? 0 : 2;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

function initial(handle: string | null): string {
  const h = (handle || '?').replace(/^@/, '');
  return (h[0] || '?').toUpperCase();
}

function renderNode(n: LineageTreeNode, focusRepoId: string | null): string {
  const isRoot = n.depth === 0;
  const isFocus = focusRepoId != null && n.repositoryId === focusRepoId;
  const cls = ['node', isRoot ? 'root' : '', isFocus ? 'current' : ''].filter(Boolean).join(' ');
  const app = n.appId ? esc(n.appId) : esc(n.repositoryId);
  const handle = n.handle ? '@' + esc(n.handle) : '@unknown';
  return `
    <div class="${cls}">
      <div class="n-top"><span class="avatar">${esc(initial(n.handle))}</span><span class="handle">${handle}</span></div>
      <div class="app">${app}</div>
      <div class="n-stats">
        <div class="stat"><span class="v">${n.forkCount}</span><span class="k">forks</span></div>
        <div class="stat earn"><span class="v">${esc(dollars(n.earnedCents))}</span><span class="k">earned</span></div>
      </div>
    </div>`;
}

function renderTreePage(tree: LineageTree): string {
  // Group nodes by depth (generation rows), preserving array order within a generation.
  const byDepth = new Map<number, LineageTreeNode[]>();
  for (const n of tree.nodes) {
    if (!byDepth.has(n.depth)) byDepth.set(n.depth, []);
    byDepth.get(n.depth)!.push(n);
  }
  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  const rows = depths
    .map((d) => `<div class="gen">${byDepth.get(d)!.map((n) => renderNode(n, tree.focusRepositoryId)).join('')}</div>`)
    .join('<div class="rule"></div>');

  const rootApp = tree.rootAppId ? esc(tree.rootAppId) : esc(tree.rootRepositoryId);
  const gens = depths.length;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${rootApp} — fork lineage · Nate's Software</title>
<style>
  :root{--bg:oklch(16% .02 265);--bg2:oklch(19% .024 265);--panel:oklch(22% .026 265);
    --line:oklch(34% .03 265);--line2:oklch(44% .035 265);--ink:oklch(97% .01 255);
    --ink2:oklch(80% .018 258);--ink3:oklch(64% .02 260);--mint:oklch(78% .15 158);
    --amber:oklch(83% .135 84);--root:oklch(80% .13 268);
    --mono:ui-monospace,"SF Mono",Menlo,monospace;--sans:Inter,ui-sans-serif,system-ui,sans-serif}
  *{box-sizing:border-box}html,body{overflow-x:clip;margin:0}
  body{font-family:var(--sans);color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased;
    background:radial-gradient(900px 480px at 78% -8%,oklch(30% .05 158/.28),transparent 60%),var(--bg)}
  .frame{max-width:760px;margin:0 auto;padding:18px}
  .chrome{display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:10px 4px 14px;border-bottom:1px solid var(--line)}
  .chrome .h{font-weight:600;font-size:15px;letter-spacing:-.01em}
  .chrome .sub{font-family:var(--mono);font-size:11px;color:var(--ink3)}
  .chrome .brand{font-family:var(--mono);font-size:11px;color:var(--mint);text-decoration:none}
  .canvas{padding:22px 4px;overflow-x:auto}
  .scroll{min-width:520px;display:flex;flex-direction:column;gap:0}
  .gen{display:flex;justify-content:center;gap:clamp(10px,3vw,34px);flex-wrap:wrap}
  .rule{height:26px;width:1px;background:var(--line2);margin:0 auto}
  .node{width:clamp(150px,42%,190px);background:var(--panel);border:1px solid var(--line);
    border-radius:12px;padding:12px;box-shadow:0 8px 24px -10px oklch(0% 0 0/.6);position:relative}
  .node.root{border-color:oklch(60% .1 268/.6)}
  .node.root::after{content:"ROOT";position:absolute;top:-9px;left:12px;font-family:var(--mono);
    font-size:9px;letter-spacing:.12em;color:var(--root);background:var(--bg2);padding:1px 7px;
    border:1px solid oklch(60% .1 268/.5);border-radius:999px}
  .node.current{border-color:var(--mint);box-shadow:0 0 0 1px var(--mint),0 14px 34px -12px oklch(60% .12 158/.5);
    background:linear-gradient(180deg,oklch(26% .04 158/.5),var(--panel))}
  .node.current::after{content:"YOU ARE HERE";position:absolute;top:-9px;right:10px;font-family:var(--mono);
    font-size:9px;letter-spacing:.08em;color:var(--bg);background:var(--mint);padding:2px 7px;border-radius:999px;font-weight:700}
  .n-top{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  .avatar{width:26px;height:26px;border-radius:50%;flex:none;display:grid;place-items:center;
    font-weight:700;font-size:12px;color:var(--bg);background:linear-gradient(135deg,var(--mint),var(--amber))}
  .node.root .avatar{background:linear-gradient(135deg,var(--root),var(--mint))}
  .handle{font-family:var(--mono);font-size:12px;color:var(--ink);font-weight:600}
  .app{font-weight:600;font-size:14px;letter-spacing:-.01em;margin-bottom:4px;overflow-wrap:anywhere}
  .n-stats{display:flex;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}
  .stat{display:flex;flex-direction:column;gap:1px}
  .stat .v{font-family:var(--mono);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
  .stat.earn .v{color:var(--mint)}
  .stat .k{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
  .foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
    padding:12px 4px;border-top:1px solid var(--line);font-family:var(--mono);font-size:12px;color:var(--ink3)}
  .foot .mark{color:var(--mint);font-weight:700}
  .foot b{color:var(--mint);font-variant-numeric:tabular-nums}
  a{color:inherit}
</style></head>
<body>
  <div class="frame">
    <div class="chrome">
      <div>
        <div class="h">🌳 ${rootApp} · fork lineage</div>
        <div class="sub">${tree.totalNodes} maker${tree.totalNodes === 1 ? '' : 's'} · ${gens} generation${gens === 1 ? '' : 's'} · live</div>
      </div>
      <a class="brand" href="https://nates-software.com/@${esc(tree.nodes[0]?.handle || 'nate')}/${rootApp}" target="_blank" rel="noopener">nates-software.com ↗</a>
    </div>
    <div class="canvas"><div class="scroll">${rows}</div></div>
    <div class="foot">
      <span><span class="mark">Nate's Software</span> · buy once, own forever</span>
      <span>lineage earned <b>${esc(dollars(tree.lineageEarnedCents))}</b> · <b>${tree.totalForks}</b> fork${tree.totalForks === 1 ? '' : 's'}</span>
    </div>
  </div>
</body></html>`;
}

export const onRequestGet = async ({ params, env }: { params: { app: string }; env: any }) => {
  const raw = (params.app || '').replace(/\.(html|svg)$/i, '').replace(/^@/, '');
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60, s-maxage=120',
    'X-Content-Type-Options': 'nosniff',
  };

  const errorPage = (msg: string, status: number) =>
    new Response(
      `<!doctype html><meta charset="utf-8"><title>Lineage unavailable</title>` +
        `<body style="font-family:ui-monospace,monospace;background:#0d1117;color:#8b949e;padding:32px">` +
        `<p>🌳 ${esc(msg)}</p><p><a style="color:#3fb950" href="https://nates-software.com/">nates-software.com</a></p></body>`,
      { status, headers }
    );

  try {
    if (!raw || !SAFE_ID.test(raw)) return errorPage('Invalid app id.', 400);
    if (!env?.DB) return errorPage('Lineage service is temporarily unavailable.', 503);

    const repoId = await resolveRepositoryIdForApp(env.DB, raw);
    if (!repoId) return errorPage(`No forge repo found for "${raw}" yet.`, 404);

    const tree = await fetchLineageTree(env.DB, repoId);
    if (!tree) return errorPage('Lineage tree not found.', 404);

    return new Response(renderTreePage(tree), { headers });
  } catch (err: any) {
    console.error('[TREE] render error:', err?.message || err);
    return errorPage('Could not build this lineage tree.', 500);
  }
};
