/**
 * PICFIT IMAGE STUDIO — Pure domain logic, validation, geometry math, and format encoding.
 *
 * Implements truthful, 100% client-side image fitting, cropping, resizing, and format conversion.
 * Strictly adheres to Runtime & Storage Freedom (zero SQLite/WAL, zero server uploads).
 */

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMimeType = typeof ALLOWED_IMAGE_MIME_TYPES[number];

/** Maximum supported file upload size: 25 MiB (26,214,400 bytes) */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Minimum and maximum safe decoded dimensions in pixels */
export const MIN_IMAGE_DIMENSION_PX = 16;
export const MAX_IMAGE_DIMENSION_PX = 16_384;

/** Maximum total canvas pixels to prevent dimension-bomb allocation crashes (32 Megapixels) */
export const MAX_CANVAS_PIXELS = 32_000_000;

/** Sane bounds for export dimensions */
export const MIN_TARGET_DIMENSION_PX = 1;
export const MAX_TARGET_DIMENSION_PX = 8_192;

/** Default encoding quality for lossy formats (JPEG/WebP) */
export const DEFAULT_QUALITY = 0.85;

export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp';

export type AspectRatioPreset =
  | '1:1'
  | '4:3'
  | '3:2'
  | '16:9'
  | '9:16'
  | '2:1'
  | 'original';

export interface AspectPresetOption {
  id: AspectRatioPreset;
  label: string;
  ratio: number | null; // width / height, null for free or original
  description: string;
}

export const ASPECT_RATIO_PRESETS: AspectPresetOption[] = [
  { id: '1:1', label: '1:1 Square', ratio: 1.0, description: 'Profile avatars, icons, Instagram feed' },
  { id: '4:3', label: '4:3 Photo', ratio: 4 / 3, description: 'Classic photo ratio & traditional displays' },
  { id: '3:2', label: '3:2 35mm', ratio: 1.5, description: 'Standard 35mm photography & postcard prints' },
  { id: '16:9', label: '16:9 Wide', ratio: 16 / 9, description: 'YouTube thumbnails, HD video, web headers' },
  { id: '9:16', label: '9:16 Story', ratio: 9 / 16, description: 'Mobile stories, reels, vertical wallpapers' },
  { id: '2:1', label: '2:1 Banner', ratio: 2.0, description: 'Header covers and wide social banners' },
  { id: 'original', label: 'Source Ratio', ratio: null, description: 'Preserve source image proportions' }
];

export interface DimensionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  category: 'Social' | 'Display' | 'Icon';
}

export const DIMENSION_PRESETS: DimensionPreset[] = [
  { id: 'og-social', label: 'OpenGraph Social (1200 × 630)', width: 1200, height: 630, category: 'Social' },
  { id: 'insta-square', label: 'Square Post (1080 × 1080)', width: 1080, height: 1080, category: 'Social' },
  { id: 'insta-story', label: 'Story / Reel (1080 × 1920)', width: 1080, height: 1920, category: 'Social' },
  { id: 'fhd-1080p', label: 'Full HD 1080p (1920 × 1080)', width: 1920, height: 1080, category: 'Display' },
  { id: 'hd-720p', label: 'HD 720p (1280 × 720)', width: 1280, height: 720, category: 'Display' },
  { id: 'web-thumb', label: 'Thumbnail (640 × 480)', width: 640, height: 480, category: 'Display' },
  { id: 'avatar-lg', label: 'Avatar Large (400 × 400)', width: 400, height: 400, category: 'Icon' },
  { id: 'avatar-sm', label: 'Avatar Small (160 × 160)', width: 160, height: 160, category: 'Icon' },
  { id: 'icon-fav', label: 'Favicon / Icon (64 × 64)', width: 64, height: 64, category: 'Icon' }
];

export interface FormatOption {
  id: OutputFormat;
  label: string;
  ext: string;
  hasQuality: boolean;
  description: string;
}

export const OUTPUT_FORMATS: FormatOption[] = [
  {
    id: 'image/jpeg',
    label: 'JPEG (.jpg)',
    ext: '.jpg',
    hasQuality: true,
    description: 'Lossy compression. Ideal for photographs and web images with adjustable quality.'
  },
  {
    id: 'image/webp',
    label: 'WebP (.webp)',
    ext: '.webp',
    hasQuality: true,
    description: 'Modern efficient format. High compression fidelity with smaller file footprints.'
  },
  {
    id: 'image/png',
    label: 'PNG (.png)',
    ext: '.png',
    hasQuality: false,
    description: 'Lossless compression. Retains crisp lines, typography, and transparency without artifacts.'
  }
];

export type AlignX = 'left' | 'center' | 'right';
export type AlignY = 'top' | 'center' | 'bottom';

export interface PixelCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export interface DecodedValidationResult {
  valid: boolean;
  width?: number;
  height?: number;
  error?: string;
}

export interface EncodedImageMetrics {
  originalBytes: number;
  encodedBytes: number;
  deltaBytes: number;
  percentage: number;
  isReduction: boolean;
}

/**
 * Validates declared file format and physical byte size before reading into memory.
 */
export function validateImageFile(file: unknown): FileValidationResult {
  if (!file || typeof file !== 'object') {
    return { valid: false, error: 'No file provided.' };
  }

  const f = file as { name?: string; size?: number; type?: string };

  if (typeof f.size !== 'number' || f.size <= 0) {
    return { valid: false, error: 'File is empty (0 bytes).' };
  }

  if (f.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size (${sizeMb} MiB) exceeds the maximum limit of 25 MiB.`
    };
  }

  const declaredType = (f.type || '').toLowerCase();
  const fileName = (f.name || '').toLowerCase();

  const isAllowedType = ALLOWED_IMAGE_MIME_TYPES.includes(declaredType as AllowedImageMimeType);
  const hasAllowedExt =
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    fileName.endsWith('.png') ||
    fileName.endsWith('.webp');

  if (!isAllowedType && !hasAllowedExt) {
    return {
      valid: false,
      error: `Unsupported format (${declaredType || 'unknown'}). Only JPEG, PNG, and WebP images are supported.`
    };
  }

  return { valid: true };
}

/**
 * Validates decoded image natural dimensions against sane limits and dimension-bomb attacks.
 */
export function validateDecodedDimensions(width: number, height: number): DecodedValidationResult {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      valid: false,
      error: 'Invalid decoded image dimensions.'
    };
  }

  const w = Math.round(width);
  const h = Math.round(height);

  if (w < MIN_IMAGE_DIMENSION_PX || h < MIN_IMAGE_DIMENSION_PX) {
    return {
      valid: false,
      error: `Image dimensions (${w} × ${h} px) are too small. Minimum supported dimension is ${MIN_IMAGE_DIMENSION_PX} × ${MIN_IMAGE_DIMENSION_PX} pixels.`
    };
  }

  if (w > MAX_IMAGE_DIMENSION_PX || h > MAX_IMAGE_DIMENSION_PX) {
    return {
      valid: false,
      error: `Image dimension (${w} × ${h} px) exceeds maximum safe limit of ${MAX_IMAGE_DIMENSION_PX} pixels.`
    };
  }

  const totalPixels = w * h;
  if (totalPixels > MAX_CANVAS_PIXELS) {
    const mp = (totalPixels / 1_000_000).toFixed(1);
    return {
      valid: false,
      error: `Image resolution (${w} × ${h} px, ${mp} MP) exceeds safe canvas allocation limit of 32 Megapixels.`
    };
  }

  return {
    valid: true,
    width: w,
    height: h
  };
}

/**
 * Computes an initial centered crop rectangle matching the specified aspect ratio preset.
 */
export function computeInitialCrop(
  sourceWidth: number,
  sourceHeight: number,
  aspectPreset: AspectRatioPreset
): PixelCropRect {
  const sw = Math.max(1, Math.round(sourceWidth));
  const sh = Math.max(1, Math.round(sourceHeight));

  if (aspectPreset === 'original') {
    return { x: 0, y: 0, width: sw, height: sh };
  }

  const preset = ASPECT_RATIO_PRESETS.find(p => p.id === aspectPreset);
  const targetRatio = preset?.ratio;

  if (!targetRatio || !Number.isFinite(targetRatio) || targetRatio <= 0) {
    return { x: 0, y: 0, width: sw, height: sh };
  }

  const sourceRatio = sw / sh;

  if (sourceRatio > targetRatio) {
    // Source is wider than target: fit height, compute width
    const cropHeight = sh;
    const cropWidth = Math.max(1, Math.min(sw, Math.round(sh * targetRatio)));
    const cropX = Math.max(0, Math.floor((sw - cropWidth) / 2));
    return { x: cropX, y: 0, width: cropWidth, height: cropHeight };
  } else {
    // Source is taller than target: fit width, compute height
    const cropWidth = sw;
    const cropHeight = Math.max(1, Math.min(sh, Math.round(sw / targetRatio)));
    const cropY = Math.max(0, Math.floor((sh - cropHeight) / 2));
    return { x: 0, y: cropY, width: cropWidth, height: cropHeight };
  }
}

/**
 * Strictly clamps a crop rectangle to ensure it fits completely within source bounds.
 */
export function clampCropRect(
  crop: PixelCropRect,
  sourceWidth: number,
  sourceHeight: number
): PixelCropRect {
  const sw = Math.max(1, Math.round(sourceWidth));
  const sh = Math.max(1, Math.round(sourceHeight));

  const width = Math.max(1, Math.min(sw, Math.round(crop.width)));
  const height = Math.max(1, Math.min(sh, Math.round(crop.height)));

  const maxX = sw - width;
  const maxY = sh - height;

  const x = Math.max(0, Math.min(maxX, Math.round(crop.x)));
  const y = Math.max(0, Math.min(maxY, Math.round(crop.y)));

  return { x, y, width, height };
}

/**
 * Adjusts the framing position of an existing crop rectangle within source bounds.
 */
export function adjustFraming(
  crop: PixelCropRect,
  sourceWidth: number,
  sourceHeight: number,
  alignX: AlignX,
  alignY: AlignY
): PixelCropRect {
  const clamped = clampCropRect(crop, sourceWidth, sourceHeight);
  const sw = Math.max(1, Math.round(sourceWidth));
  const sh = Math.max(1, Math.round(sourceHeight));

  let newX = clamped.x;
  let newY = clamped.y;

  if (alignX === 'left') {
    newX = 0;
  } else if (alignX === 'center') {
    newX = Math.floor((sw - clamped.width) / 2);
  } else if (alignX === 'right') {
    newX = sw - clamped.width;
  }

  if (alignY === 'top') {
    newY = 0;
  } else if (alignY === 'center') {
    newY = Math.floor((sh - clamped.height) / 2);
  } else if (alignY === 'bottom') {
    newY = sh - clamped.height;
  }

  return clampCropRect({ x: newX, y: newY, width: clamped.width, height: clamped.height }, sw, sh);
}

/**
 * Scales crop box coverage (e.g. 20% to 100%) while keeping aspect ratio and framing centered.
 */
export function scaleCropCoverage(
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: number | null,
  coveragePercent: number // 20 to 100
): PixelCropRect {
  const sw = Math.max(1, Math.round(sourceWidth));
  const sh = Math.max(1, Math.round(sourceHeight));
  const factor = Math.max(0.1, Math.min(1.0, coveragePercent / 100));

  const effectiveRatio = targetRatio && targetRatio > 0 ? targetRatio : sw / sh;

  // Compute maximum rectangle of given ratio that fits inside sw x sh
  let maxW: number;
  let maxH: number;
  if (sw / sh > effectiveRatio) {
    maxH = sh;
    maxW = Math.round(sh * effectiveRatio);
  } else {
    maxW = sw;
    maxH = Math.round(sw / effectiveRatio);
  }

  const width = Math.max(1, Math.min(sw, Math.round(maxW * factor)));
  const height = Math.max(1, Math.min(sh, Math.round(maxH * factor)));
  const x = Math.floor((sw - width) / 2);
  const y = Math.floor((sh - height) / 2);

  return clampCropRect({ x, y, width, height }, sw, sh);
}

/**
 * Calculates complementary dimension when Aspect Lock is active.
 */
export function calculateLockedDimensions(params: {
  newWidth?: number | null;
  newHeight?: number | null;
  cropWidth: number;
  cropHeight: number;
  lockAspect: boolean;
  currentWidth: number;
  currentHeight: number;
}): { width: number; height: number } {
  const { newWidth, newHeight, cropWidth, cropHeight, lockAspect, currentWidth, currentHeight } = params;
  const aspect = cropWidth > 0 && cropHeight > 0 ? cropWidth / cropHeight : 1.0;

  let w = currentWidth;
  let h = currentHeight;

  if (newWidth !== undefined && newWidth !== null && Number.isFinite(newWidth)) {
    w = Math.max(MIN_TARGET_DIMENSION_PX, Math.min(MAX_TARGET_DIMENSION_PX, Math.round(newWidth)));
    if (lockAspect && aspect > 0) {
      h = Math.max(MIN_TARGET_DIMENSION_PX, Math.min(MAX_TARGET_DIMENSION_PX, Math.round(w / aspect)));
    }
  } else if (newHeight !== undefined && newHeight !== null && Number.isFinite(newHeight)) {
    h = Math.max(MIN_TARGET_DIMENSION_PX, Math.min(MAX_TARGET_DIMENSION_PX, Math.round(newHeight)));
    if (lockAspect && aspect > 0) {
      w = Math.max(MIN_TARGET_DIMENSION_PX, Math.min(MAX_TARGET_DIMENSION_PX, Math.round(h * aspect)));
    }
  }

  return clampTargetDimensions(w, h);
}

/**
 * Clamps target resize dimensions to safe browser canvas bounds.
 */
export function clampTargetDimensions(width: number, height: number): { width: number; height: number } {
  let safeW = Number.isFinite(width)
    ? Math.max(MIN_TARGET_DIMENSION_PX, Math.min(MAX_TARGET_DIMENSION_PX, Math.round(width)))
    : 800;
  let safeH = Number.isFinite(height)
    ? Math.max(MIN_TARGET_DIMENSION_PX, Math.min(MAX_TARGET_DIMENSION_PX, Math.round(height)))
    : 600;

  const pixels = safeW * safeH;
  if (pixels > MAX_CANVAS_PIXELS) {
    const scale = Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    safeW = Math.max(1, Math.floor(safeW * scale));
    safeH = Math.max(1, Math.floor(safeH * scale));
  }

  return { width: safeW, height: safeH };
}

/**
 * Generates a clean, deterministic, safe filename for the downloaded image asset.
 */
export function generateDeterministicFilename(params: {
  originalName?: string;
  targetWidth: number;
  targetHeight: number;
  format: OutputFormat;
}): string {
  const { originalName, targetWidth, targetHeight, format } = params;

  let base = (originalName || 'picfit-export')
    .replace(/\.[^/.]+$/, '') // strip extension
    .trim();

  // Sanitize characters: replace spaces and unsafe characters with hyphens
  base = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!base) {
    base = 'picfit-export';
  }

  const formatOption = OUTPUT_FORMATS.find(f => f.id === format);
  const ext = formatOption ? formatOption.ext : '.jpg';

  const w = Math.round(targetWidth);
  const h = Math.round(targetHeight);

  return `${base}-fit-${w}x${h}${ext}`;
}

/**
 * Formats byte counts into human-readable strings (e.g. 245.8 KB).
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeIndex = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, safeIndex)).toFixed(dm))} ${sizes[safeIndex]}`;
}

/**
 * Formats dimension aspect ratio into simplified or decimal notation.
 */
export function formatAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1:1';
  }

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(Math.round(width), Math.round(height));
  const simpleW = Math.round(width) / divisor;
  const simpleH = Math.round(height) / divisor;

  // If simplified ratio has reasonable integers, return W:H
  if (simpleW <= 32 && simpleH <= 32) {
    return `${simpleW}:${simpleH}`;
  }

  // Otherwise return decimal format
  const decimal = (width / height).toFixed(2);
  return `${decimal}:1`;
}

/**
 * Compares original uploaded byte size with actual encoded byte size.
 */
export function calculateCompressionMetrics(
  originalBytes: number,
  encodedBytes: number
): EncodedImageMetrics {
  const orig = Math.max(0, originalBytes);
  const enc = Math.max(0, encodedBytes);
  const deltaBytes = enc - orig;
  const percentage = orig > 0 ? ((enc - orig) / orig) * 100 : 0;

  return {
    originalBytes: orig,
    encodedBytes: enc,
    deltaBytes,
    percentage: parseFloat(percentage.toFixed(1)),
    isReduction: deltaBytes < 0
  };
}

/**
 * Renders source image crop box onto a target canvas with high-quality smoothing.
 */
export function renderCroppedToCanvas(
  source: CanvasImageSource,
  crop: PixelCropRect,
  targetWidth: number,
  targetHeight: number,
  canvas?: HTMLCanvasElement
): HTMLCanvasElement {
  const target = canvas || document.createElement('canvas');
  target.width = Math.max(1, Math.round(targetWidth));
  target.height = Math.max(1, Math.round(targetHeight));

  const ctx = target.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, target.width, target.height);

  ctx.drawImage(
    source,
    Math.round(crop.x),
    Math.round(crop.y),
    Math.round(crop.width),
    Math.round(crop.height),
    0,
    0,
    target.width,
    target.height
  );

  return target;
}

/**
 * Encodes a canvas into a downloadable Blob with format and quality settings.
 */
export function encodeCanvasToBlob(
  canvas: HTMLCanvasElement,
  format: OutputFormat,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const q = format === 'image/png' ? undefined : Math.max(0.01, Math.min(1.0, quality));
      canvas.toBlob(
        blob => {
          if (blob && blob.type === format) {
            resolve(blob);
          } else if (blob) {
            reject(new Error(`This browser cannot encode ${format.split('/')[1].toUpperCase()} output.`));
          } else {
            reject(new Error(`Failed to encode image to format ${format}`));
          }
        },
        format,
        q
      );
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generates an embedded, high-contrast calibration card SVG Data URI for instant first-run testing.
 * Contains geometric shapes, color grids, and resolution tags. Zero network requests required.
 */
export function createSampleCalibrationCardDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="1600" height="1000">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0a192f"/>
        <stop offset="50%" stop-color="#172a45"/>
        <stop offset="100%" stop-color="#020c1b"/>
      </linearGradient>
      <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#64ffda"/>
        <stop offset="50%" stop-color="#00bcd4"/>
        <stop offset="100%" stop-color="#3b82f6"/>
      </linearGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#233554" stroke-width="1" stroke-opacity="0.4"/>
      </pattern>
    </defs>

    <!-- Background and Grid -->
    <rect width="1600" height="1000" fill="url(#bg)"/>
    <rect width="1600" height="1000" fill="url(#grid)"/>

    <!-- Outer Border -->
    <rect x="40" y="40" width="1520" height="920" fill="none" stroke="#64ffda" stroke-width="3" stroke-dasharray="16,8" opacity="0.8"/>

    <!-- Center Composition Area -->
    <circle cx="800" cy="500" r="320" fill="#112240" stroke="#3b82f6" stroke-width="4"/>
    <circle cx="800" cy="500" r="220" fill="none" stroke="#64ffda" stroke-width="2"/>
    <circle cx="800" cy="500" r="120" fill="#1d3557" stroke="#f43f5e" stroke-width="3"/>

    <!-- Crosshairs -->
    <line x1="800" y1="120" x2="800" y2="880" stroke="#64ffda" stroke-width="1.5" stroke-opacity="0.6"/>
    <line x1="420" y1="500" x2="1180" y2="500" stroke="#64ffda" stroke-width="1.5" stroke-opacity="0.6"/>

    <!-- Color Swatches Bar -->
    <g transform="translate(450, 780)">
      <rect x="0" y="0" width="100" height="36" fill="#ef4444" rx="4"/>
      <rect x="120" y="0" width="100" height="36" fill="#f59e0b" rx="4"/>
      <rect x="240" y="0" width="100" height="36" fill="#10b981" rx="4"/>
      <rect x="360" y="0" width="100" height="36" fill="#3b82f6" rx="4"/>
      <rect x="480" y="0" width="100" height="36" fill="#8b5cf6" rx="4"/>
      <rect x="600" y="0" width="100" height="36" fill="#ec4899" rx="4"/>
    </g>

    <!-- Calibration Text & Badges -->
    <text x="800" y="475" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="900" letter-spacing="4">PICFIT STUDIO</text>
    <text x="800" y="525" text-anchor="middle" fill="#64ffda" font-family="monospace" font-size="20" font-weight="700">1600 × 1000 PX · CALIBRATION CARD</text>
    <text x="800" y="555" text-anchor="middle" fill="#94a3b8" font-family="monospace" font-size="14">100% Client-Side In-Memory Image Sandbox</text>

    <!-- Corner Alignment Markers -->
    <path d="M 80 120 L 80 80 L 120 80" fill="none" stroke="#64ffda" stroke-width="4"/>
    <path d="M 1520 120 L 1520 80 L 1480 80" fill="none" stroke="#64ffda" stroke-width="4"/>
    <path d="M 80 880 L 80 920 L 120 920" fill="none" stroke="#64ffda" stroke-width="4"/>
    <path d="M 1520 880 L 1520 920 L 1480 920" fill="none" stroke="#64ffda" stroke-width="4"/>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
