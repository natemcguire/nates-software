import { describe, it, expect } from 'vitest';
import { detectRigRuntime } from '../src/lib/deploymentLifecycle';

// Locks in how detectRigRuntime classifies apps into the static-R2 path vs the
// server/container path. This gate matters because the static path is the only one that
// actually SERVES on the free tier — a static-site-generator misrouted to the server path
// builds fine but can't be served (the "American Gardener won't deploy" class of bug).
//
// The server-vs-static decision downstream (functions/api/deploy.ts:isServerApp) treats a
// node app as static IFF startCommand === 'static-pages-runtime'. So these tests assert the
// startCommand the detector produces for each shape.
describe('RIG runtime detection — static vs server routing', () => {
  const pkg = (o: any) => ({ 'package.json': JSON.stringify(o) });

  it('a bare static site (index.html, no build/server) → static-pages-runtime', () => {
    const r = detectRigRuntime(['index.html', 'styles.css'], {});
    expect(r.plan?.detectedType).toBe('static');
    expect(r.plan?.startCommand).toBe('static-pages-runtime');
  });

  it('a node app with a start script → treated as a server (npm start)', () => {
    const r = detectRigRuntime(['package.json', 'server.js'], pkg({ scripts: { start: 'node server.js' } }));
    expect(r.plan?.detectedType).toBe('node');
    expect(r.plan?.startCommand).toBe('npm start'); // → isServerApp downstream
  });

  it('KNOWN GAP: a static-site-generator (build script + app.js, no static entry at repo time) is classified as a SERVER', () => {
    // American Gardener's shape: `npm run build` runs a generator that emits index.html at
    // BUILD time, but at repo time there's only app.js. The detector can't see the built
    // artifact, so it picks `node app.js` and this is routed to the (unservable) container
    // path. This test documents the gap so a future artifact-aware fix has a baseline.
    const r = detectRigRuntime(
      ['package.json', 'app.js', 'scripts/build-content.mjs'],
      pkg({ main: 'app.js', scripts: { build: 'node scripts/build-content.mjs' } })
    );
    expect(r.plan?.detectedType).toBe('node');
    expect(r.plan?.startCommand).toBe('node app.js'); // ← the misroute: NOT static-pages-runtime
  });

  it('WORKAROUND: a slop.json manifest forcing static-pages-runtime routes an SSG to the static path', () => {
    // The supported way to fix the gap today: the app declares itself static via manifest.
    const r = detectRigRuntime(
      ['package.json', 'app.js', 'scripts/build-content.mjs', 'slop.json'],
      {
        ...pkg({ main: 'app.js', scripts: { build: 'node scripts/build-content.mjs' } }),
        'slop.json': JSON.stringify({ startCommand: 'static-pages-runtime' }),
      }
    );
    expect(r.plan?.startCommand).toBe('static-pages-runtime'); // → isServerApp === false → static R2 path
  });
});
