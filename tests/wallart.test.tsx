import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  validateImageFile,
  validateDecodedDimensions,
  clampDimensions,
  computePanelSpecifications,
  computeCoverCrop,
  calculatePrintReadiness,
  computePreviewExportPlan,
  MAX_FILE_SIZE_BYTES,
  PRINT_DPI,
  MIN_DIMENSION_INCHES,
  MAX_DIMENSION_INCHES
} from '../src/lib/wallartDomain';
import { WallArtStudio } from '../src/components/WallArtStudio';
import { EphemeralLiveApp } from '../src/components/EphemeralLiveApp';
import { INITIAL_APPS, AppListing } from '../src/data/mockData';
import { resolveAppRoute } from '../src/App';

describe('WallArt Canvas Pro — Domain Validation & Print Math', () => {
  describe('File Validation (validateImageFile)', () => {
    it('accepts valid JPEG, PNG, and WebP files within 20 MiB', () => {
      expect(validateImageFile({ type: 'image/jpeg', size: 5 * 1024 * 1024, name: 'photo.jpg' })).toEqual({ valid: true });
      expect(validateImageFile({ type: 'image/png', size: 10 * 1024 * 1024, name: 'art.png' })).toEqual({ valid: true });
      expect(validateImageFile({ type: 'image/webp', size: 20 * 1024 * 1024, name: 'render.webp' })).toEqual({ valid: true });
    });

    it('rejects empty files (0 bytes, null, undefined)', () => {
      expect(validateImageFile(null).valid).toBe(false);
      expect(validateImageFile(undefined).valid).toBe(false);
      expect(validateImageFile({ type: 'image/jpeg', size: 0, name: 'empty.jpg' }).valid).toBe(false);
      expect(validateImageFile({ type: 'image/jpeg', size: 0 }).error).toContain('0 bytes');
    });

    it('rejects files larger than 20 MiB', () => {
      const oversized = validateImageFile({
        type: 'image/jpeg',
        size: MAX_FILE_SIZE_BYTES + 1,
        name: 'huge.jpg'
      });
      expect(oversized.valid).toBe(false);
      expect(oversized.error).toContain('20 MiB');
    });

    it('rejects unsupported MIME types (GIF, SVG, BMP, TIFF, executables)', () => {
      expect(validateImageFile({ type: 'image/gif', size: 1024, name: 'anim.gif' }).valid).toBe(false);
      expect(validateImageFile({ type: 'image/svg+xml', size: 1024, name: 'vector.svg' }).valid).toBe(false);
      expect(validateImageFile({ type: 'image/bmp', size: 1024, name: 'bitmap.bmp' }).valid).toBe(false);
      expect(validateImageFile({ type: 'image/tiff', size: 1024, name: 'raw.tiff' }).valid).toBe(false);
      expect(validateImageFile({ type: 'application/octet-stream', size: 1024, name: 'binary.bin' }).valid).toBe(false);
    });
  });

  describe('Decoded Dimensions Validation (validateDecodedDimensions)', () => {
    it('accepts valid natural dimensions', () => {
      const res = validateDecodedDimensions(4000, 3000);
      expect(res.valid).toBe(true);
      expect(res.width).toBe(4000);
      expect(res.height).toBe(3000);
    });

    it('rejects non-finite, zero, or negative dimensions', () => {
      expect(validateDecodedDimensions(0, 3000).valid).toBe(false);
      expect(validateDecodedDimensions(4000, -100).valid).toBe(false);
      expect(validateDecodedDimensions(NaN, 3000).valid).toBe(false);
      expect(validateDecodedDimensions(4000, Infinity).valid).toBe(false);
    });

    it('rejects too-small dimensions below 100px threshold', () => {
      const small = validateDecodedDimensions(80, 80);
      expect(small.valid).toBe(false);
      expect(small.error).toContain('too small');
    });

    it('rejects oversized decoded dimensions exceeding 50,000px', () => {
      expect(validateDecodedDimensions(60000, 4000).valid).toBe(false);
    });
  });

  describe('Dimensions Clamping (clampDimensions)', () => {
    it('clamps inches to min 8 and max 120', () => {
      expect(clampDimensions(4, 200).widthInches).toBe(MIN_DIMENSION_INCHES);
      expect(clampDimensions(4, 200).heightInches).toBe(MAX_DIMENSION_INCHES);
    });

    it('clamps gap inches between 0.5 and 4.0', () => {
      expect(clampDimensions(36, 24, 0.1).gapInches).toBe(0.5);
      expect(clampDimensions(36, 24, 10).gapInches).toBe(4.0);
    });
  });

  describe('Multi-Panel Splitting Math (computePanelSpecifications)', () => {
    it('computes single layout accurately', () => {
      const panels = computePanelSpecifications('single', 36, 24);
      expect(panels.length).toBe(1);
      expect(panels[0].widthInches).toBe(36);
      expect(panels[0].heightInches).toBe(24);
      expect(panels[0].requiredWidthPx).toBe(36 * PRINT_DPI); // 10800
      expect(panels[0].requiredHeightPx).toBe(24 * PRINT_DPI); // 7200
      expect(panels[0].normLeft).toBe(0);
      expect(panels[0].normWidth).toBe(1);
    });

    it('computes triptych (3-panel) layout with accurate gaps and continuous slices', () => {
      const panels = computePanelSpecifications('triptych', 36, 24, 1.5);
      expect(panels.length).toBe(3);

      // (36 - 2 * 1.5) / 3 = 33 / 3 = 11 inches each panel
      expect(panels[0].widthInches).toBe(11);
      expect(panels[0].heightInches).toBe(24);
      expect(panels[0].requiredWidthPx).toBe(11 * 300); // 3300 px
      expect(panels[0].requiredHeightPx).toBe(24 * 300); // 7200 px

      expect(panels[0].normLeft).toBe(0);
      expect(panels[0].normWidth).toBeCloseTo(11 / 36, 4);

      // Panel 1 starts at 11 + 1.5 = 12.5 inches
      expect(panels[1].normLeft).toBeCloseTo(12.5 / 36, 4);
      expect(panels[1].normWidth).toBeCloseTo(11 / 36, 4);

      // Panel 2 starts at 22 + 3.0 = 25.0 inches
      expect(panels[2].normLeft).toBeCloseTo(25.0 / 36, 4);
      expect(panels[2].normWidth).toBeCloseTo(11 / 36, 4);
    });

    it('computes 4-grid (2x2) layout with accurate horizontal and vertical gaps', () => {
      const panels = computePanelSpecifications('four-grid', 40, 30, 2.0);
      expect(panels.length).toBe(4);

      // Width: (40 - 2) / 2 = 19 inches
      // Height: (30 - 2) / 2 = 14 inches
      expect(panels[0].widthInches).toBe(19);
      expect(panels[0].heightInches).toBe(14);
      expect(panels[0].requiredWidthPx).toBe(19 * 300); // 5700 px
      expect(panels[0].requiredHeightPx).toBe(14 * 300); // 4200 px

      // Row 0 Col 0
      expect(panels[0].col).toBe(0);
      expect(panels[0].row).toBe(0);
      expect(panels[0].normLeft).toBe(0);
      expect(panels[0].normTop).toBe(0);

      // Row 1 Col 1 (Panel 3)
      expect(panels[3].col).toBe(1);
      expect(panels[3].row).toBe(1);
      expect(panels[3].normLeft).toBeCloseTo(21 / 40, 4);
      expect(panels[3].normTop).toBeCloseTo(16 / 30, 4);
    });
  });

  describe('Cover-Crop Geometry (computeCoverCrop)', () => {
    it('centers crop horizontally when source is wider than target', () => {
      // Source 4000x2000 (2.0 aspect), Target 36x24 (1.5 aspect)
      const crop = computeCoverCrop(4000, 2000, 36, 24);
      // Desired crop width = 2000 * 1.5 = 3000 px
      expect(crop.cropWidthPx).toBe(3000);
      expect(crop.cropHeightPx).toBe(2000);
      expect(crop.offsetX).toBe((4000 - 3000) / 2); // 500 px
      expect(crop.offsetY).toBe(0);
    });

    it('centers crop vertically when source is taller than target', () => {
      // Source 3000x4000 (0.75 aspect), Target 36x24 (1.5 aspect)
      const crop = computeCoverCrop(3000, 4000, 36, 24);
      // Desired crop height = 3000 / 1.5 = 2000 px
      expect(crop.cropWidthPx).toBe(3000);
      expect(crop.cropHeightPx).toBe(2000);
      expect(crop.offsetX).toBe(0);
      expect(crop.offsetY).toBe((4000 - 2000) / 2); // 1000 px
    });
  });

  describe('Print Readiness Analysis (calculatePrintReadiness)', () => {
    it('identifies shortage when image has insufficient resolution for 300 DPI', () => {
      // 1200 x 800 px on 36 x 24 inches
      // Required @ 300 DPI: 10800 x 7200 px
      const report = calculatePrintReadiness(1200, 800, 36, 24, 'single');

      expect(report.isReady).toBe(false);
      expect(report.status).toBe('not-ready');
      expect(report.effectiveDpi).toBe(33); // 1200 / 36 = 33.33 -> 33 DPI
      expect(report.requiredWidthPx).toBe(10800);
      expect(report.requiredHeightPx).toBe(7200);
      expect(report.widthShortagePx).toBe(10800 - 1200); // 9600
      expect(report.heightShortagePx).toBe(7200 - 800); // 6400
      expect(report.pixelShortagePercent).toBeGreaterThan(80);
      expect(report.summary).toContain('short by 9600 px width');
    });

    it('marks image ready when source meets or exceeds 300 DPI requirement', () => {
      // 12000 x 8000 px on 36 x 24 inches
      // Effective DPI = 12000 / 36 = 333 DPI >= 300 DPI
      const report = calculatePrintReadiness(12000, 8000, 36, 24, 'triptych', 1.5);

      expect(report.isReady).toBe(true);
      expect(report.status).toBe('ready');
      expect(report.effectiveDpi).toBe(333);
      expect(report.widthShortagePx).toBe(0);
      expect(report.heightShortagePx).toBe(0);
      expect(report.pixelShortagePercent).toBe(0);
      expect(report.summary).toContain('meeting the selected 300 PPI target');
      expect(report.panels.length).toBe(3);
    });
  });

  describe('Preview Export Budget Calculation (computePreviewExportPlan)', () => {
    it('produces safe 72-DPI preview plan without downscaling for standard sizes', () => {
      const plan = computePreviewExportPlan(36, 24, 72);
      expect(plan.safeForCanvas).toBe(true);
      expect(plan.isDownscaled).toBe(false);
      expect(plan.exportWidthPx).toBe(36 * 72); // 2592
      expect(plan.exportHeightPx).toBe(24 * 72); // 1728
    });

    it('safely clamps oversized canvas requests to stay within memory limits', () => {
      // Request huge 200" span at high DPI
      const plan = computePreviewExportPlan(200, 200, 300);
      expect(plan.safeForCanvas).toBe(true);
      expect(plan.exportWidthPx).toBeLessThanOrEqual(3840);
      expect(plan.exportHeightPx).toBeLessThanOrEqual(3840);
    });
  });
});

describe('WallArtStudio Component — First-Run & Capability Honesty', () => {
  it('renders first-run empty state with upload controls and honest instructions', () => {
    const html = renderToString(<WallArtStudio />);

    // Studio title & branding
    expect(html).toContain('WALLART CANVAS PRO');
    expect(html).toContain('Client-First');

    // First-run empty state guidance
    expect(html).toContain('Living Room Wall Art Visualizer');
    expect(html).toContain('Upload your high-resolution photography to test multi-panel splits');
    expect(html).toContain('Supported Specifications:');
    expect(html).toContain('JPEG, PNG, WebP (up to 20 MiB)');
    expect(html).toContain('Choose Photo to Visualize');

    // Layout controls
    expect(html).toContain('Single Piece');
    expect(html).toContain('3-Piece');
    expect(html).toContain('4-Grid');

    // Finishes
    expect(html).toContain('Solid Walnut');
    expect(html).toContain('Natural Oak');
    expect(html).toContain('Matte Black');
    expect(html).toContain('Gallery Wrap');

    // Wall paint color swatches
    expect(html).toContain('Wall Paint Color');
    expect(html).toContain('Wall paint: Classic Off-White');

    // Accessible telemetry & export regions
    expect(html).toContain('300 PPI SOURCE CHECK');
    expect(html).toContain('Upload a photo to compare its active crop with the 300 PPI target.');
    expect(html).toContain('Export PNG Preview');

    // Honest disabled production boundary
    expect(html).toContain('Production TIFF &amp; Print Dispatch');
    expect(html).toContain('Adapter Required');
    expect(html).toContain('require a configured renderer and print-service adapter');
    expect(html).toContain('Production Export Unavailable');
  });

  it('contains zero fake timers, fake queue IDs, fake server persistence, or TIFF download claims', () => {
    const html = renderToString(<WallArtStudio />);

    // No fake queue IDs
    expect(html).not.toContain('QUEUE-');
    expect(html).not.toContain('#Q-');
    expect(html).not.toContain('Order #');

    // No fake production promises
    expect(html).not.toContain('TIFF Downloaded');
    expect(html).not.toContain('Order Placed Successfully');
    expect(html).not.toContain('Sent to Print Factory');
  });
});

describe('EphemeralLiveApp Routing & Honest Fallback State', () => {
  it('routes wallart app id to WallArtStudio with Client-Side Sandbox indicator', () => {
    const wallartApp: AppListing = {
      id: 'wallart',
      name: 'WallArt Canvas Pro',
      tagline: 'Interactive Canvas Split & Living Room Wall Art Studio',
      description: 'Professional browser-first wall art visualizer',
      author: 'nate',
      authorAvatar: '🖼️',
      version: 'v1.0.0',
      upvotes: 345,
      forkCount: 52,
      tags: ['Wall Art'],
      sqliteDatabase: '/data/wallart.sqlite',
      sqliteSize: '0 KB',
      screenshots: [],
      comments: []
    };

    const html = renderToString(<EphemeralLiveApp app={wallartApp} />);

    // Renders WallArtStudio inside sandbox
    expect(html).toContain('WallArt Canvas Pro');
    expect(html).toContain('Live Sandbox');
    expect(html).toContain('Client-Side Sandbox');
    expect(html).toContain('WALLART CANVAS PRO');
    expect(html).toContain('Living Room Wall Art Visualizer');

    // Does NOT render fabricated concurrency session count for wallart
    expect(html).not.toContain('2 / 10 Max Sessions');
  });

  it('shows an honest unavailable state for unregistered / unknown app IDs', () => {
    const unknownApp: AppListing = {
      id: 'unknown-mystery-app',
      name: 'Mystery App',
      tagline: 'Some non-existent tool',
      description: 'Not implemented',
      author: 'nate',
      authorAvatar: '❓',
      version: 'v0.1.0',
      upvotes: 1,
      forkCount: 0,
      tags: ['Unknown'],
      sqliteDatabase: '/data/mystery.sqlite',
      sqliteSize: '0 KB',
      screenshots: [],
      comments: []
    };

    const html = renderToString(<EphemeralLiveApp app={unknownApp} />);

    // Renders honest fallback card
    expect(html).toContain('Application Sandbox Unavailable');
    expect(html).toContain('No interactive sandbox runner is registered');
    expect(html).toContain('unknown-mystery-app');
    expect(html).toContain('UNREGISTERED_SANDBOX_RUNTIME');

    // Does NOT silently render PicFit
    expect(html).not.toContain('WARDROBE &amp; MODEL SYNTHESIS');
    expect(html).not.toContain('Gemini Vision');
  });
});

describe('Catalog Integrity & Standalone Route Resolution', () => {
  it('contains wallart in INITIAL_APPS with accurate browser-first metadata', () => {
    const wallart = INITIAL_APPS.find(a => a.id === 'wallart');
    expect(wallart).toBeDefined();
    expect(wallart?.name).toBe('WallArt Canvas Pro');
    expect(wallart?.tags).toContain('Wall Art');
    expect(wallart?.tags).toContain('Browser-First');
    expect(wallart?.storage).toContain('Session-only browser memory');
  });

  it('resolves standalone app route for wallart', () => {
    const route = resolveAppRoute('', '', '', 'wallart');
    expect(route.type).toBe('standalone_app');
    expect(route.id).toBe('wallart');
    expect(route.title).toBe('WallArt Canvas Pro');
  });
});
