import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CORE_TERMINAL_TOOLS, terminalToolchainProbe } from '../src/toolchain.js';

describe('production terminal toolchain contract', () => {
  const manifestPath = fileURLToPath(new URL('../../terminal-image/snapshot-manifest.json', import.meta.url));

  it('keeps the image manifest and live snapshot probe identical', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.requiredTools).toEqual([...CORE_TERMINAL_TOOLS]);
    for (const tool of CORE_TERMINAL_TOOLS) {
      expect(terminalToolchainProbe()).toContain(`command -v ${tool}`);
    }
  });

  it('declares a disposable workspace with no persistence', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.persistence).toBe('none');
    expect(manifest.workspace).toBe('/workspace');
  });
});
