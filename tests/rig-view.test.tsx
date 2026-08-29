import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { RigRuntimeView } from '../src/views/RigRuntimeView';

describe('RigRuntimeView First-Run & Truthful Control-Plane HUD', () => {
  it('renders initial first-run empty state without hardcoded fleet containers', () => {
    const html = renderToString(<RigRuntimeView />);

    // Header and title
    expect(html).toContain('RIG.EXE CONTROL-PLANE PREVIEW');
    expect(html).toContain('RUNTIME &amp; STORAGE AGNOSTIC');

    // Truthful provider boundary notice
    expect(html).toContain('PROVIDER STATUS:');
    expect(html).toContain('CHECKING');
    expect(html).toContain('Deterministic State Machine Preview');
    expect(html).toContain('never represents simulated lifecycle events as provider observations');
    expect(html).toContain('Checking the production provider gateway');

    // First-run empty state
    expect(html).toContain('No Active RIG Instances');
    expect(html).toContain('The control plane is currently empty');
    expect(html).toContain('Zero hardcoded or fabricated initial fleet containers');

    // Configuration builder form
    expect(html).toContain('Runtime Manifest Builder');
    expect(html).toContain('Runtime Adapter');
    expect(html).toContain('Docker Container (docker)');
    expect(html).toContain('Direct Process (process)');
    expect(html).toContain('WebAssembly Sandbox (wasm)');
    expect(html).toContain('Start Command');
    expect(html).toContain('Storage Declaration (Generic Mount)');
    expect(html).toContain('None (Stateless)');
    expect(html).toContain('SQLite Database');
    expect(html).toContain('Memory Cap');
    expect(html).toContain('256 MB (Standard)');
    expect(html).not.toContain('512 MB');
    expect(html).toContain('TTL / Auto-Expiry');
    expect(html).toContain('Launch Demo Plan (Simulation)');
  });

  it('contains zero fabricated URLs, git pushes, test evidence scores, or HOTWIRE drop submissions', () => {
    const html = renderToString(<RigRuntimeView />);

    // No fake URLs
    expect(html).not.toContain('https://picfit.ai');
    expect(html).not.toContain('https://wallart-nate.rig.nates.software');
    expect(html).not.toContain('https://dronehunter.nates-software.com');

    // No fake git pushes
    expect(html).not.toContain('git remote add nate');
    expect(html).not.toContain('git push nate main');
    expect(html).not.toContain('[GITSMITH] Receiving objects: 100%');

    // No fake test evidence score or timing
    expect(html).not.toContain('100% Pass');
    expect(html).not.toContain('500 SQLite simulated writes verified in 0.04s');

    // No fake HOTWIRE submission
    expect(html).not.toContain('Submitted build to 12:01 AM Daily Drops Board');
    expect(html).not.toContain('Litestream replication to Cloudflare R2 active');
  });
});
