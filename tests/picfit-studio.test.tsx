import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PicFitStudio } from '../src/components/PicFitStudio';
import { EphemeralLiveApp } from '../src/components/EphemeralLiveApp';
import { INITIAL_APPS, AppListing } from '../src/data/mockData';

describe('PicFitStudio Component & Sandbox Integration', () => {
  describe('First-Run Experience & Truthful In-Browser HUD', () => {
    it('renders initial first-run empty state with upload target and sample trigger', () => {
      const html = renderToString(<PicFitStudio />);

      // Header and title
      expect(html).toContain('PICFIT IMAGE STUDIO');
      expect(html).toContain('Client Utility');

      // Truthful Privacy & Security HUD
      expect(html).toContain('Processed locally in this browser');
      expect(html).toContain('Local browser processing');
      expect(html).toContain('This tool does not upload your image');

      // Drag & Drop Upload Zone
      expect(html).toContain('Drop your image here, or click to browse');
      expect(html).toContain('Supports JPEG, PNG, and WebP up to 25 MiB');

      // Sample image button
      expect(html).toContain('Load Calibration Sample');

      // Controls sidebars
      expect(html).toContain('SOURCE IMAGE');
      expect(html).toContain('CROP &amp; FRAMING');
      expect(html).toContain('RESIZE &amp; DIMENSIONS');
      expect(html).toContain('FORMAT &amp; QUALITY');

      // Aspect presets
      expect(html).toContain('Aspect Ratio Preset');
      expect(html).toContain('1:1');
      expect(html).toContain('16:9');

      // Format options
      expect(html).toContain('JPEG');
      expect(html).toContain('WebP');
      expect(html).toContain('PNG');

      // Download button
      expect(html).toContain('Download Optimized Asset');

      // Bottom Status Bar
      expect(html).toContain('Mode: In-Memory Client Sandbox');
      expect(html).toContain('Storage: Ephemeral browser memory');
    });

    it('contains zero fabricated AI try-on, Gemini, garments, models, SQLite, or WAL claims', () => {
      const html = renderToString(<PicFitStudio />);

      // Zero AI / Gemini claims
      expect(html).not.toContain('Gemini 2.5');
      expect(html).not.toContain('Gemini Vision');
      expect(html).not.toContain('Synthesize Fit');
      expect(html).not.toContain('WARDROBE &amp; MODEL SYNTHESIS');

      // Zero model / garment / pricing claims
      expect(html).not.toContain('Nate McGuire');
      expect(html).not.toContain('90s Vintage Distressed Leather');
      expect(html).not.toContain('EBP Raw Selvedge Denim');
      expect(html).not.toContain('Garment Rack');
      expect(html).not.toContain('$240');

      // Zero SQLite / WAL claims
      expect(html).not.toContain('/data/picfitai.sqlite');
      expect(html).not.toContain('Saved Look to /data/picfitai.sqlite');
      expect(html).not.toContain('/data/picfitai.sqlite (WAL)');

      // Zero WallArt claims
      expect(html).not.toContain('Triptych');
      expect(html).not.toContain('Solid Walnut');
      expect(html).not.toContain('300 DPI');
      expect(html).not.toContain('Print Production');
    });

    it('has fully accessible input attributes, ARIA roles, and labels', () => {
      const html = renderToString(<PicFitStudio />);

      // Hidden file input has accept and aria-label
      expect(html).toContain('type="file"');
      expect(html).toContain('accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"');
      expect(html).toContain('aria-label="Upload source image file"');

      // Dropzone has keyboard accessibility attributes
      expect(html).toContain('role="button"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('aria-label="Upload an image to start image fitting"');

      // Live status region
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');

      // Form labels
      expect(html).toContain('Width (px)');
      expect(html).toContain('Height (px)');
      expect(html).toContain('Encoding Quality');
    });

    it('renders all crop framing alignment buttons and coverage controls', () => {
      const html = renderToString(<PicFitStudio />);

      // Horizontal framing
      expect(html).toContain('left');
      expect(html).toContain('center');
      expect(html).toContain('right');

      // Vertical framing
      expect(html).toContain('top');
      expect(html).toContain('bottom');

      // Crop coverage slider
      expect(html).toContain('Crop Coverage');
      expect(html).toContain('aria-label="Crop frame coverage percentage"');
    });

    it('renders dimension scale percentages and standard presets', () => {
      const html = renderToString(<PicFitStudio />);

      // Scale percentages
      expect(html).toContain('100%');
      expect(html).toContain('75%');
      expect(html).toContain('50%');
      expect(html).toContain('25%');

      // Common resolution presets
      expect(html).toContain('1200×630');
      expect(html).toContain('1080×1080');
      expect(html).toContain('1080×1920');
      expect(html).toContain('1920×1080');
      expect(html).toContain('1280×720');
      expect(html).toContain('640×480');

      // Aspect Lock button
      expect(html).toContain('Locked');
    });

    it('shows informative quality guidance for lossy formats and notes lossless behavior for PNG', () => {
      const html = renderToString(<PicFitStudio />);

      // Default format is JPEG: shows quality slider and guidance
      expect(html).toContain('Encoding Quality');
      expect(html).toContain('Lower quality produces smaller file sizes; higher quality preserves sharp textures');
    });
  });

  describe('Integration with EphemeralLiveApp Sandbox', () => {
    it('correctly mounts PicFitStudio inside EphemeralLiveApp for picfitai app coordinate', () => {
      const picfitApp = INITIAL_APPS.find(a => a.id === 'picfitai') as AppListing;
      expect(picfitApp).toBeDefined();

      const html = renderToString(<EphemeralLiveApp app={picfitApp} />);

      // Contains EphemeralLiveApp frame
      expect(html).toContain('PicFit');
      expect(html).toContain('Live Sandbox');

      // Mounts PicFitStudio inside
      expect(html).toContain('PICFIT IMAGE STUDIO');
      expect(html).toContain('Processed locally in this browser');
      expect(html).toContain('Mode: In-Memory Client Sandbox');
    });
  });
});
