import { describe, it, expect } from 'vitest';
import { WALLART_PRESETS, calculateRenderResolution } from '../src/lib/wallartDomain';

describe('WallArt Canvas Pro 300 DPI Render Engine', () => {
  it('should accurately calculate 24x36 300 DPI print canvas resolution', () => {
    const res = calculateRenderResolution(24, 36, 300);
    expect(res.pixelWidth).toBe(7200);
    expect(res.pixelHeight).toBe(10800);
    expect(res.totalMegapixels).toBe(78);
    expect(res.estimatedTiffMb).toBeGreaterThan(200);
  });

  it('should validate all built-in wallart presets have 300 DPI', () => {
    WALLART_PRESETS.forEach(p => {
      expect(p.dpi).toBe(300);
      expect(['walnut', 'oak', 'black', 'canvas-wrap']).toContain(p.frameStyle);
    });
  });
});
