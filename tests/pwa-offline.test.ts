import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('PWA & Offline Local-First Manifest Configuration', () => {
  it('should have valid manifest.webmanifest with retro Windows 95 theme color', () => {
    const manifestPath = path.resolve(__dirname, '../public/manifest.webmanifest');
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    expect(manifest.name).toBe("Nate's Software Web OS 95");
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#000080');
    expect(manifest.background_color).toBe('#008080');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  it('should have service worker file caching core assets', () => {
    const swPath = path.resolve(__dirname, '../public/sw.js');
    const content = fs.readFileSync(swPath, 'utf8');

    expect(content).toContain('CACHE_NAME');
    expect(content).toContain('CORE_ASSETS');
    expect(content).toContain('addEventListener');
  });
});
