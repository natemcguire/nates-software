import { describe, it, expect } from 'vitest';
import {
  validateImageFile,
  validateDecodedDimensions,
  computeInitialCrop,
  clampCropRect,
  adjustFraming,
  scaleCropCoverage,
  calculateLockedDimensions,
  clampTargetDimensions,
  generateDeterministicFilename,
  formatBytes,
  formatAspectRatio,
  calculateCompressionMetrics,
  createSampleCalibrationCardDataUri,
  MAX_FILE_SIZE_BYTES,
  MIN_IMAGE_DIMENSION_PX,
  MAX_IMAGE_DIMENSION_PX,
  MAX_CANVAS_PIXELS,
  ASPECT_RATIO_PRESETS,
  DIMENSION_PRESETS,
  OUTPUT_FORMATS
} from '../src/lib/picfitDomain';

describe('PicFit Pure Domain Logic & Geometry Math', () => {
  describe('File Validation (validateImageFile)', () => {
    it('accepts valid JPEG, PNG, and WebP files within 25 MiB', () => {
      expect(validateImageFile({ type: 'image/jpeg', size: 5 * 1024 * 1024, name: 'photo.jpg' })).toEqual({ valid: true });
      expect(validateImageFile({ type: 'image/png', size: 10 * 1024 * 1024, name: 'chart.png' })).toEqual({ valid: true });
      expect(validateImageFile({ type: 'image/webp', size: 24 * 1024 * 1024, name: 'graphic.webp' })).toEqual({ valid: true });
    });

    it('accepts files with valid image extensions even if MIME type is missing/generic', () => {
      expect(validateImageFile({ type: '', size: 1024 * 1024, name: 'capture.JPG' })).toEqual({ valid: true });
      expect(validateImageFile({ type: 'application/octet-stream', size: 1024 * 1024, name: 'banner.png' })).toEqual({ valid: true });
      expect(validateImageFile({ type: '', size: 500000, name: 'asset.webp' })).toEqual({ valid: true });
    });

    it('rejects null, undefined, or non-object arguments', () => {
      expect(validateImageFile(null).valid).toBe(false);
      expect(validateImageFile(undefined).valid).toBe(false);
      expect(validateImageFile('invalid').valid).toBe(false);
    });

    it('rejects empty files (0 bytes or negative size)', () => {
      const empty = validateImageFile({ type: 'image/jpeg', size: 0, name: 'zero.jpg' });
      expect(empty.valid).toBe(false);
      expect(empty.error).toContain('0 bytes');

      const negative = validateImageFile({ type: 'image/jpeg', size: -10, name: 'neg.jpg' });
      expect(negative.valid).toBe(false);
    });

    it('rejects files larger than 25 MiB', () => {
      const oversized = validateImageFile({
        type: 'image/jpeg',
        size: MAX_FILE_SIZE_BYTES + 1,
        name: 'huge.jpg'
      });
      expect(oversized.valid).toBe(false);
      expect(oversized.error).toContain('25 MiB');
    });

    it('rejects unsupported file formats (GIF, SVG, BMP, TIFF, PDF, Executables)', () => {
      expect(validateImageFile({ type: 'image/gif', size: 1024, name: 'anim.gif' }).valid).toBe(false);
      expect(validateImageFile({ type: 'image/svg+xml', size: 1024, name: 'vector.svg' }).valid).toBe(false);
      expect(validateImageFile({ type: 'image/bmp', size: 1024, name: 'bitmap.bmp' }).valid).toBe(false);
      expect(validateImageFile({ type: 'image/tiff', size: 1024, name: 'scan.tiff' }).valid).toBe(false);
      expect(validateImageFile({ type: 'application/pdf', size: 1024, name: 'doc.pdf' }).valid).toBe(false);
      expect(validateImageFile({ type: 'application/x-msdownload', size: 1024, name: 'app.exe' }).valid).toBe(false);
    });
  });

  describe('Decoded Dimensions Validation (validateDecodedDimensions)', () => {
    it('accepts safe standard decoded dimensions', () => {
      const standard = validateDecodedDimensions(1920, 1080);
      expect(standard.valid).toBe(true);
      expect(standard.width).toBe(1920);
      expect(standard.height).toBe(1080);

      const square = validateDecodedDimensions(800, 800);
      expect(square.valid).toBe(true);
      expect(square.width).toBe(800);
      expect(square.height).toBe(800);
    });

    it('rejects non-finite, zero, or negative dimensions', () => {
      expect(validateDecodedDimensions(0, 1000).valid).toBe(false);
      expect(validateDecodedDimensions(1000, 0).valid).toBe(false);
      expect(validateDecodedDimensions(-50, 1000).valid).toBe(false);
      expect(validateDecodedDimensions(NaN, 1000).valid).toBe(false);
      expect(validateDecodedDimensions(1000, Infinity).valid).toBe(false);
    });

    it(`rejects dimensions below minimum threshold of ${MIN_IMAGE_DIMENSION_PX}px`, () => {
      const tooSmall = validateDecodedDimensions(10, 10);
      expect(tooSmall.valid).toBe(false);
      expect(tooSmall.error).toContain('too small');
    });

    it(`rejects single dimensions exceeding maximum limit of ${MAX_IMAGE_DIMENSION_PX}px`, () => {
      const tooLarge = validateDecodedDimensions(MAX_IMAGE_DIMENSION_PX + 1, 1000);
      expect(tooLarge.valid).toBe(false);
      expect(tooLarge.error).toContain('exceeds maximum safe limit');
    });

    it('rejects dimension-bomb attacks exceeding 32 Megapixels', () => {
      expect(MAX_CANVAS_PIXELS).toBe(32_000_000);
      // 8000 x 5000 = 40 Megapixels (> 32 Megapixels ceiling)
      const dimensionBomb = validateDecodedDimensions(8000, 5000);
      expect(dimensionBomb.valid).toBe(false);
      expect(dimensionBomb.error).toContain('32 Megapixels');
    });

    it('accepts high-resolution images within safe 32 Megapixel budget', () => {
      // 6000 x 4000 = 24 Megapixels (<= 32 Megapixels)
      const highRes = validateDecodedDimensions(6000, 4000);
      expect(highRes.valid).toBe(true);
      expect(highRes.width).toBe(6000);
      expect(highRes.height).toBe(4000);
    });
  });

  describe('Aspect Ratio Math & Crop Calculation (computeInitialCrop)', () => {
    it('computes the full frame for the original preset', () => {
      const origCrop = computeInitialCrop(1200, 800, 'original');
      expect(origCrop).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    });

    it('computes centered 1:1 square crop on landscape image', () => {
      const crop = computeInitialCrop(1600, 1000, '1:1');
      expect(crop.width).toBe(1000);
      expect(crop.height).toBe(1000);
      expect(crop.x).toBe(300); // (1600 - 1000) / 2
      expect(crop.y).toBe(0);
    });

    it('computes centered 1:1 square crop on portrait image', () => {
      const crop = computeInitialCrop(1000, 1600, '1:1');
      expect(crop.width).toBe(1000);
      expect(crop.height).toBe(1000);
      expect(crop.x).toBe(0);
      expect(crop.y).toBe(300); // (1600 - 1000) / 2
    });

    it('computes centered 16:9 widescreen crop on square image', () => {
      const crop = computeInitialCrop(1800, 1800, '16:9');
      expect(crop.width).toBe(1800);
      expect(crop.height).toBe(Math.round(1800 / (16 / 9))); // 1013
      expect(crop.x).toBe(0);
      expect(crop.y).toBe(Math.floor((1800 - crop.height) / 2));
    });

    it('computes centered 9:16 vertical crop on landscape image', () => {
      const crop = computeInitialCrop(1920, 1080, '9:16');
      expect(crop.height).toBe(1080);
      expect(crop.width).toBe(Math.round(1080 * (9 / 16))); // 608
      expect(crop.x).toBe(Math.floor((1920 - crop.width) / 2));
      expect(crop.y).toBe(0);
    });

    it('computes 4:3, 3:2, and 2:1 preset crops accurately', () => {
      const crop43 = computeInitialCrop(2000, 1000, '4:3');
      expect(crop43.height).toBe(1000);
      expect(crop43.width).toBe(Math.round(1000 * (4 / 3)));

      const crop32 = computeInitialCrop(2000, 1000, '3:2');
      expect(crop32.height).toBe(1000);
      expect(crop32.width).toBe(1500);

      const crop21 = computeInitialCrop(1000, 1000, '2:1');
      expect(crop21.width).toBe(1000);
      expect(crop21.height).toBe(500);
    });
  });

  describe('Crop Clamping & Framing Adjustments (clampCropRect, adjustFraming, scaleCropCoverage)', () => {
    it('strictly clamps crop rectangles within source boundaries', () => {
      // Out-of-bounds negative position
      const clampedNeg = clampCropRect({ x: -100, y: -50, width: 500, height: 400 }, 1000, 1000);
      expect(clampedNeg.x).toBe(0);
      expect(clampedNeg.y).toBe(0);
      expect(clampedNeg.width).toBe(500);
      expect(clampedNeg.height).toBe(400);

      // Overflowing right/bottom position
      const clampedOver = clampCropRect({ x: 800, y: 700, width: 400, height: 500 }, 1000, 1000);
      expect(clampedOver.x).toBe(600); // 1000 - 400
      expect(clampedOver.y).toBe(500); // 1000 - 500
      expect(clampedOver.width).toBe(400);
      expect(clampedOver.height).toBe(500);
    });

    it('adjusts framing alignments across horizontal and vertical axes', () => {
      const initial = { x: 300, y: 0, width: 1000, height: 1000 };
      const sourceW = 1600;
      const sourceH = 1000;

      // Align Left
      const left = adjustFraming(initial, sourceW, sourceH, 'left', 'center');
      expect(left.x).toBe(0);
      expect(left.y).toBe(0);

      // Align Right
      const right = adjustFraming(initial, sourceW, sourceH, 'right', 'center');
      expect(right.x).toBe(600); // 1600 - 1000
      expect(right.y).toBe(0);

      // Align Top & Bottom on vertical offset
      const tallCrop = { x: 0, y: 300, width: 1000, height: 1000 };
      const top = adjustFraming(tallCrop, 1000, 1600, 'center', 'top');
      expect(top.y).toBe(0);

      const bottom = adjustFraming(tallCrop, 1000, 1600, 'center', 'bottom');
      expect(bottom.y).toBe(600); // 1600 - 1000
    });

    it('scales crop coverage percentages correctly while preserving centering', () => {
      const scaled50 = scaleCropCoverage(1000, 1000, 1.0, 50);
      expect(scaled50.width).toBe(500);
      expect(scaled50.height).toBe(500);
      expect(scaled50.x).toBe(250);
      expect(scaled50.y).toBe(250);

      const scaled100 = scaleCropCoverage(1600, 900, 16 / 9, 100);
      expect(scaled100.width).toBe(1600);
      expect(scaled100.height).toBe(900);
      expect(scaled100.x).toBe(0);
      expect(scaled100.y).toBe(0);
    });
  });

  describe('Resize & Aspect Lock Math (calculateLockedDimensions, clampTargetDimensions)', () => {
    it('calculates complementary height when changing width with aspect lock enabled', () => {
      const result = calculateLockedDimensions({
        newWidth: 1200,
        cropWidth: 800,
        cropHeight: 400, // 2:1 ratio
        lockAspect: true,
        currentWidth: 800,
        currentHeight: 400
      });
      expect(result.width).toBe(1200);
      expect(result.height).toBe(600);
    });

    it('calculates complementary width when changing height with aspect lock enabled', () => {
      const result = calculateLockedDimensions({
        newHeight: 500,
        cropWidth: 1000,
        cropHeight: 500, // 2:1 ratio
        lockAspect: true,
        currentWidth: 1000,
        currentHeight: 500
      });
      expect(result.width).toBe(1000);
      expect(result.height).toBe(500);
    });

    it('resizes independently when aspect lock is disabled', () => {
      const result = calculateLockedDimensions({
        newWidth: 1920,
        cropWidth: 800,
        cropHeight: 800,
        lockAspect: false,
        currentWidth: 800,
        currentHeight: 800
      });
      expect(result.width).toBe(1920);
      expect(result.height).toBe(800);
    });

    it('safely clamps target resize dimensions to browser limits [1, 8192]', () => {
      const clampedMin = clampTargetDimensions(-50, 0);
      expect(clampedMin.width).toBe(1);
      expect(clampedMin.height).toBe(1);

      const clampedMax = clampTargetDimensions(10000, 12000);
      expect(clampedMax.width * clampedMax.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
      expect(clampedMax.width / clampedMax.height).toBeCloseTo(1, 2);
    });
  });

  describe('Deterministic Safe Filename Generator (generateDeterministicFilename)', () => {
    it('generates sanitized deterministic filenames for JPEG output', () => {
      const name = generateDeterministicFilename({
        originalName: 'My Vacation Photo #1 (Summer 2026).png',
        targetWidth: 1200,
        targetHeight: 630,
        format: 'image/jpeg'
      });
      expect(name).toBe('my-vacation-photo-1-summer-2026-fit-1200x630.jpg');
    });

    it('generates sanitized deterministic filenames for WebP output', () => {
      const name = generateDeterministicFilename({
        originalName: 'Company Logo & Brand Banner.jpg',
        targetWidth: 1920,
        targetHeight: 1080,
        format: 'image/webp'
      });
      expect(name).toBe('company-logo-brand-banner-fit-1920x1080.webp');
    });

    it('generates sanitized deterministic filenames for PNG output', () => {
      const name = generateDeterministicFilename({
        originalName: 'diagram_v2.1_final.webp',
        targetWidth: 800,
        targetHeight: 600,
        format: 'image/png'
      });
      expect(name).toBe('diagram_v2-1_final-fit-800x600.png');
    });

    it('falls back to picfit-export when input name is empty or pure special characters', () => {
      expect(generateDeterministicFilename({
        originalName: '',
        targetWidth: 400,
        targetHeight: 400,
        format: 'image/jpeg'
      })).toBe('picfit-export-fit-400x400.jpg');

      expect(generateDeterministicFilename({
        originalName: '!!!###$$$',
        targetWidth: 100,
        targetHeight: 100,
        format: 'image/png'
      })).toBe('picfit-export-fit-100x100.png');
    });
  });

  describe('Formatting & Compression Metrics Helpers', () => {
    it('formats byte sizes cleanly (formatBytes)', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1024 * 150)).toBe('150 KB');
      expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB');
    });

    it('formats aspect ratios accurately (formatAspectRatio)', () => {
      expect(formatAspectRatio(1920, 1080)).toBe('16:9');
      expect(formatAspectRatio(800, 600)).toBe('4:3');
      expect(formatAspectRatio(1000, 1000)).toBe('1:1');
      expect(formatAspectRatio(1200, 800)).toBe('3:2');
    });

    it('calculates compression metrics truthfully (calculateCompressionMetrics)', () => {
      const reduced = calculateCompressionMetrics(1000000, 400000);
      expect(reduced.originalBytes).toBe(1000000);
      expect(reduced.encodedBytes).toBe(400000);
      expect(reduced.deltaBytes).toBe(-600000);
      expect(reduced.percentage).toBe(-60.0);
      expect(reduced.isReduction).toBe(true);

      const expanded = calculateCompressionMetrics(50000, 80000);
      expect(expanded.deltaBytes).toBe(30000);
      expect(expanded.percentage).toBe(60.0);
      expect(expanded.isReduction).toBe(false);
    });

    it('generates valid client-side calibration card data URI', () => {
      const dataUri = createSampleCalibrationCardDataUri();
      expect(dataUri).toContain('data:image/svg+xml');
      expect(dataUri).toContain('PICFIT');
      expect(dataUri).toContain('1600');
      expect(dataUri).toContain('1000');
    });
  });

  describe('Presets Definitions Integrity', () => {
    it('contains all required standard aspect presets', () => {
      const ids = ASPECT_RATIO_PRESETS.map(p => p.id);
      expect(ids).toContain('1:1');
      expect(ids).toContain('4:3');
      expect(ids).toContain('3:2');
      expect(ids).toContain('16:9');
      expect(ids).toContain('9:16');
      expect(ids).toContain('2:1');
      expect(ids).toContain('original');
    });

    it('contains standard dimension presets with valid positive dimensions', () => {
      expect(DIMENSION_PRESETS.length).toBeGreaterThanOrEqual(6);
      DIMENSION_PRESETS.forEach(dp => {
        expect(dp.width).toBeGreaterThan(0);
        expect(dp.height).toBeGreaterThan(0);
      });
    });

    it('defines JPEG, WebP, and PNG format options with correct quality capability flag', () => {
      expect(OUTPUT_FORMATS.find(f => f.id === 'image/jpeg')?.hasQuality).toBe(true);
      expect(OUTPUT_FORMATS.find(f => f.id === 'image/webp')?.hasQuality).toBe(true);
      expect(OUTPUT_FORMATS.find(f => f.id === 'image/png')?.hasQuality).toBe(false);
    });
  });
});
