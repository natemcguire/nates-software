import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Homepage Win95/DOS Boot Loader Screen', () => {
  const indexPath = path.resolve(__dirname, '../index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf-8');

  it('contains inline CSS styles in head for instant paint without waiting for JS', () => {
    expect(indexHtml).toContain('<style>');
    expect(indexHtml).toContain('background-color: #008080');
    expect(indexHtml).toContain('.boot-container');
    expect(indexHtml).toContain('.boot-window');
  });

  it('puts the boot screen markup inside #root so React replaces it cleanly on mount', () => {
    const rootMatch = indexHtml.match(/<div id="root">([\s\S]*?)<\/div>\s*<script/);
    expect(rootMatch).toBeTruthy();
    const rootInner = rootMatch![1];
    expect(rootInner).toContain('boot-container');
    expect(rootInner).toContain("NATE'S SOFTWARE");
    expect(rootInner).toContain('⚡');
  });

  it('provides retro BIOS/DOS POST log lines and animated Win95 progress bar', () => {
    expect(indexHtml).toContain('ROM BIOS:');
    expect(indexHtml).toContain('INITIALIZING DESKTOP');
    expect(indexHtml).toContain('boot-progress-strip');
    expect(indexHtml).toContain('boot-marquee');
  });

  it('supports prefers-reduced-motion for accessibility', () => {
    expect(indexHtml).toContain('@media (prefers-reduced-motion: reduce)');
    expect(indexHtml).toContain('animation: none');
  });

  it('has accessible status labelling', () => {
    expect(indexHtml).toContain('role="status"');
    expect(indexHtml).toContain('aria-label="Loading Nate\'s Software"');
    expect(indexHtml).toContain('sr-only');
  });

  it('uses zero external asset URLs in index.html (self-contained)', () => {
    expect(indexHtml).not.toMatch(/<link[^>]+rel=["']stylesheet["']/);
    expect(indexHtml).not.toMatch(/<img[^>]+src=["']http/);
  });
});
