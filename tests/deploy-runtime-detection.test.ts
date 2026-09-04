import { describe, it, expect } from 'vitest';
import { detectRigRuntime } from '../src/lib/deploymentLifecycle';

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
    expect(r.plan?.startCommand).toBe('npm start');
  });

  it('KNOWN GAP: a static-site-generator (build script + app.js, no static entry at repo time) is classified as a SERVER', () => {
    const r = detectRigRuntime(
      ['package.json', 'app.js', 'scripts/build-content.mjs'],
      pkg({ main: 'app.js', scripts: { build: 'node scripts/build-content.mjs' } })
    );
    expect(r.plan?.detectedType).toBe('node');
    expect(r.plan?.startCommand).toBe('node app.js');
  });

  it('WORKAROUND: a slop.json manifest forcing static-pages-runtime routes an SSG to the static path', () => {
    const r = detectRigRuntime(
      ['package.json', 'app.js', 'scripts/build-content.mjs', 'slop.json'],
      {
        ...pkg({ main: 'app.js', scripts: { build: 'node scripts/build-content.mjs' } }),
        'slop.json': JSON.stringify({ startCommand: 'static-pages-runtime' }),
      }
    );
    expect(r.plan?.startCommand).toBe('static-pages-runtime');
  });
});
