/**
 * WALLART CANVAS PRO — Pure layout and source-resolution logic
 *
 * Implements strongly typed print resolution calculations, multi-panel splitting math,
 * file validation, and comparison with a user-visible 300 PPI target.
 *
 * Designed to adhere to Runtime and Storage Freedom (no SQLite/WAL required).
 */

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

/** Maximum supported file upload size in bytes (20 MiB) */
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20,971,520 bytes

/** Minimum and maximum sane decoded image dimensions in pixels */
export const MIN_IMAGE_DIMENSION_PX = 100;
export const MAX_IMAGE_DIMENSION_PX = 50_000;

/** User-selectable high-resolution target used by this inspector. */
export const PRINT_DPI = 300;

/** Sane bounds for physical canvas dimensions in inches */
export const MIN_DIMENSION_INCHES = 8;
export const MAX_DIMENSION_INCHES = 120;
export const DEFAULT_WIDTH_INCHES = 36;
export const DEFAULT_HEIGHT_INCHES = 24;

/** Panel gap bounds in inches */
export const MIN_PANEL_GAP_INCHES = 0.5;
export const MAX_PANEL_GAP_INCHES = 4.0;
export const DEFAULT_PANEL_GAP_INCHES = 1.5;

/** Maximum safe canvas pixel budget for browser client previews (16 Megapixels) */
export const MAX_PREVIEW_CANVAS_PIXELS = 16_000_000;
export const MAX_PREVIEW_EDGE_PX = 3840;

export type WallArtLayout = 'single' | 'triptych' | 'four-grid';
export type WallArtFinish = 'walnut' | 'oak' | 'black' | 'gallery_wrap';
export type ReadinessStatus = 'ready' | 'not-ready';

export interface FinishDefinition {
  id: WallArtFinish;
  name: string;
  description: string;
  frameWidthInches: number;
  previewBorderColor: string;
}

export const FINISH_DEFINITIONS: Record<WallArtFinish, FinishDefinition> = {
  walnut: {
    id: 'walnut',
    name: 'Solid Walnut',
    description: 'Preview style inspired by a dark walnut floating frame.',
    frameWidthInches: 0.75,
    previewBorderColor: '#3d2314'
  },
  oak: {
    id: 'oak',
    name: 'Natural Oak',
    description: 'Preview style inspired by a warm natural-oak floating frame.',
    frameWidthInches: 0.75,
    previewBorderColor: '#b58a5c'
  },
  black: {
    id: 'black',
    name: 'Matte Black',
    description: 'Preview style inspired by a matte-black floating frame.',
    frameWidthInches: 0.75,
    previewBorderColor: '#18181b'
  },
  gallery_wrap: {
    id: 'gallery_wrap',
    name: 'Gallery Wrap',
    description: 'Frameless gallery-wrap preview with continuous edge styling.',
    frameWidthInches: 0.0,
    previewBorderColor: '#e4e4e7'
  }
};

export interface WallPaintPreset {
  id: string;
  name: string;
  hex: string;
}

export const WALL_PAINT_PRESETS: WallPaintPreset[] = [
  { id: 'off-white', name: 'Classic Off-White', hex: '#f4f1ea' },
  { id: 'greige', name: 'Warm Greige', hex: '#d8d2c9' },
  { id: 'charcoal', name: 'Charcoal Slate', hex: '#2f3640' },
  { id: 'sage', name: 'Sage Green', hex: '#7a8b7b' },
  { id: 'navy', name: 'Navy Dusk', hex: '#1e293b' },
  { id: 'terracotta', name: 'Terracotta', hex: '#b35d43' }
];

export interface DimensionPreset {
  id: string;
  name: string;
  widthInches: number;
  heightInches: number;
}

export const DIMENSION_PRESETS: DimensionPreset[] = [
  { id: 'small', name: '24″ × 16″ (Small Accent)', widthInches: 24, heightInches: 16 },
  { id: 'medium', name: '36″ × 24″ (Living Room Standard)', widthInches: 36, heightInches: 24 },
  { id: 'large', name: '48″ × 32″ (Large Feature)', widthInches: 48, heightInches: 32 },
  { id: 'gallery', name: '60″ × 40″ (Grand Gallery)', widthInches: 60, heightInches: 40 }
];

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export interface DecodedImageValidationResult {
  valid: boolean;
  error?: string;
  width?: number;
  height?: number;
}

/**
 * Validates an uploaded file's metadata (MIME type and byte size).
 */
export function validateImageFile(file: { type: string; size: number; name?: string } | null | undefined): FileValidationResult {
  if (!file || typeof file.size !== 'number' || file.size <= 0) {
    return { valid: false, error: 'File is empty (0 bytes). Please upload a valid image file.' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMiB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size (${sizeMiB} MiB) exceeds the maximum limit of 20 MiB.`
    };
  }

  const mime = (file.type || '').toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.includes(mime as AllowedMimeType)) {
    return {
      valid: false,
      error: `Unsupported file format "${file.type || 'unknown'}". Only JPEG, PNG, and WebP images are supported.`
    };
  }

  return { valid: true };
}

/**
 * Validates decoded image natural dimensions.
 */
export function validateDecodedDimensions(width: number, height: number): DecodedImageValidationResult {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      valid: false,
      error: 'Invalid decoded image dimensions. Width and height must be positive numbers.'
    };
  }

  if (width < MIN_IMAGE_DIMENSION_PX || height < MIN_IMAGE_DIMENSION_PX) {
    return {
      valid: false,
      error: `Image dimensions (${width}×${height} px) are too small. Minimum required dimensions are ${MIN_IMAGE_DIMENSION_PX}×${MIN_IMAGE_DIMENSION_PX} px.`
    };
  }

  if (width > MAX_IMAGE_DIMENSION_PX || height > MAX_IMAGE_DIMENSION_PX) {
    return {
      valid: false,
      error: `Image dimensions (${width}×${height} px) exceed maximum supported limit of ${MAX_IMAGE_DIMENSION_PX}×${MAX_IMAGE_DIMENSION_PX} px.`
    };
  }

  return { valid: true, width, height };
}

/**
 * Clamps physical dimensions and gaps to sane bounds.
 */
export function clampDimensions(
  widthInches: number,
  heightInches: number,
  gapInches: number = DEFAULT_PANEL_GAP_INCHES
): { widthInches: number; heightInches: number; gapInches: number } {
  const w = Number.isFinite(widthInches) ? widthInches : DEFAULT_WIDTH_INCHES;
  const h = Number.isFinite(heightInches) ? heightInches : DEFAULT_HEIGHT_INCHES;
  const g = Number.isFinite(gapInches) ? gapInches : DEFAULT_PANEL_GAP_INCHES;

  const clampedW = Math.min(Math.max(w, MIN_DIMENSION_INCHES), MAX_DIMENSION_INCHES);
  const clampedH = Math.min(Math.max(h, MIN_DIMENSION_INCHES), MAX_DIMENSION_INCHES);
  const clampedG = Math.min(Math.max(g, MIN_PANEL_GAP_INCHES), MAX_PANEL_GAP_INCHES);

  return { widthInches: clampedW, heightInches: clampedH, gapInches: clampedG };
}

export interface PanelSpecification {
  index: number;
  col: number;
  row: number;
  widthInches: number;
  heightInches: number;
  requiredWidthPx: number;
  requiredHeightPx: number;
  /** Normalized left offset [0..1] within total span */
  normLeft: number;
  /** Normalized top offset [0..1] within total span */
  normTop: number;
  /** Normalized width fraction [0..1] of total span */
  normWidth: number;
  /** Normalized height fraction [0..1] of total span */
  normHeight: number;
}

/**
 * Computes panel geometry, normalized continuous slice coordinates, and the
 * pixels required to meet the selected 300 PPI target.
 */
export function computePanelSpecifications(
  layout: WallArtLayout,
  totalWidthInches: number,
  totalHeightInches: number,
  gapInches: number = DEFAULT_PANEL_GAP_INCHES
): PanelSpecification[] {
  const { widthInches: W, heightInches: H, gapInches: G } = clampDimensions(
    totalWidthInches,
    totalHeightInches,
    gapInches
  );

  switch (layout) {
    case 'single': {
      return [
        {
          index: 0,
          col: 0,
          row: 0,
          widthInches: W,
          heightInches: H,
          requiredWidthPx: Math.round(W * PRINT_DPI),
          requiredHeightPx: Math.round(H * PRINT_DPI),
          normLeft: 0,
          normTop: 0,
          normWidth: 1,
          normHeight: 1
        }
      ];
    }

    case 'triptych': {
      const cols = 3;
      const totalGapWidth = (cols - 1) * G;
      // Guarantee panel width is positive
      const safeGap = totalGapWidth >= W ? (W * 0.1) / (cols - 1) : G;
      const panelWidth = (W - (cols - 1) * safeGap) / cols;
      const panelHeight = H;

      const panels: PanelSpecification[] = [];
      for (let c = 0; c < cols; c++) {
        const leftInches = c * (panelWidth + safeGap);
        panels.push({
          index: c,
          col: c,
          row: 0,
          widthInches: Math.round(panelWidth * 100) / 100,
          heightInches: Math.round(panelHeight * 100) / 100,
          requiredWidthPx: Math.round(panelWidth * PRINT_DPI),
          requiredHeightPx: Math.round(panelHeight * PRINT_DPI),
          normLeft: leftInches / W,
          normTop: 0,
          normWidth: panelWidth / W,
          normHeight: 1
        });
      }
      return panels;
    }

    case 'four-grid': {
      const cols = 2;
      const rows = 2;
      const totalGapX = (cols - 1) * G;
      const totalGapY = (rows - 1) * G;
      const safeGapX = totalGapX >= W ? (W * 0.1) / (cols - 1) : G;
      const safeGapY = totalGapY >= H ? (H * 0.1) / (rows - 1) : G;
      const panelWidth = (W - safeGapX) / cols;
      const panelHeight = (H - safeGapY) / rows;

      const panels: PanelSpecification[] = [];
      let idx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const leftInches = c * (panelWidth + safeGapX);
          const topInches = r * (panelHeight + safeGapY);
          panels.push({
            index: idx++,
            col: c,
            row: r,
            widthInches: Math.round(panelWidth * 100) / 100,
            heightInches: Math.round(panelHeight * 100) / 100,
            requiredWidthPx: Math.round(panelWidth * PRINT_DPI),
            requiredHeightPx: Math.round(panelHeight * PRINT_DPI),
            normLeft: leftInches / W,
            normTop: topInches / H,
            normWidth: panelWidth / W,
            normHeight: panelHeight / H
          });
        }
      }
      return panels;
    }
  }
}

export interface CoverCropResult {
  cropWidthPx: number;
  cropHeightPx: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Calculates the center-crop bounding box in source image coordinates to cover the target artwork aspect ratio.
 */
export function computeCoverCrop(
  sourceWidthPx: number,
  sourceHeightPx: number,
  targetWidthInches: number,
  targetHeightInches: number
): CoverCropResult {
  const sourceAspect = sourceWidthPx / sourceHeightPx;
  const targetAspect = targetWidthInches / targetHeightInches;

  if (sourceAspect > targetAspect) {
    // Source is wider than target: crop horizontally (keep full source height)
    const cropWidthPx = Math.round(sourceHeightPx * targetAspect);
    const cropHeightPx = sourceHeightPx;
    const offsetX = Math.round((sourceWidthPx - cropWidthPx) / 2);
    const offsetY = 0;
    return { cropWidthPx, cropHeightPx, offsetX, offsetY };
  } else {
    // Source is taller than target: crop vertically (keep full source width)
    const cropWidthPx = sourceWidthPx;
    const cropHeightPx = Math.round(sourceWidthPx / targetAspect);
    const offsetX = 0;
    const offsetY = Math.round((sourceHeightPx - cropHeightPx) / 2);
    return { cropWidthPx, cropHeightPx, offsetX, offsetY };
  }
}

export interface PrintReadinessReport {
  status: ReadinessStatus;
  isReady: boolean;
  sourceWidthPx: number;
  sourceHeightPx: number;
  totalWidthInches: number;
  totalHeightInches: number;
  requiredWidthPx: number;
  requiredHeightPx: number;
  effectiveDpi: number;
  targetDpi: number;
  widthShortagePx: number;
  heightShortagePx: number;
  pixelShortagePercent: number;
  panels: PanelSpecification[];
  coverCrop: CoverCropResult;
  summary: string;
  recommendation: string;
}

/**
 * Compares an active center crop with the selected 300 PPI target.
 */
export function calculatePrintReadiness(
  sourceWidthPx: number,
  sourceHeightPx: number,
  totalWidthInches: number,
  totalHeightInches: number,
  layout: WallArtLayout = 'single',
  gapInches: number = DEFAULT_PANEL_GAP_INCHES
): PrintReadinessReport {
  const { widthInches: W, heightInches: H, gapInches: G } = clampDimensions(
    totalWidthInches,
    totalHeightInches,
    gapInches
  );

  const requiredWidthPx = Math.round(W * PRINT_DPI);
  const requiredHeightPx = Math.round(H * PRINT_DPI);

  const coverCrop = computeCoverCrop(sourceWidthPx, sourceHeightPx, W, H);
  // Use the limiting axis. Rounding the cover crop can otherwise make the
  // width look sufficient while the height remains a pixel or more short.
  const effectiveDpi = Math.floor(Math.min(
    coverCrop.cropWidthPx / W,
    coverCrop.cropHeightPx / H
  ));
  const isReady = effectiveDpi >= PRINT_DPI;
  const status: ReadinessStatus = isReady ? 'ready' : 'not-ready';

  const widthShortagePx = Math.max(0, requiredWidthPx - coverCrop.cropWidthPx);
  const heightShortagePx = Math.max(0, requiredHeightPx - coverCrop.cropHeightPx);
  const pixelShortagePercent = isReady ? 0 : Math.min(100, Math.round((1 - effectiveDpi / PRINT_DPI) * 100));

  const panels = computePanelSpecifications(layout, W, H, G);

  let summary: string;
  let recommendation: string;

  if (isReady) {
    summary = `Source provides ~${effectiveDpi} PPI (${coverCrop.cropWidthPx}×${coverCrop.cropHeightPx} px active crop), meeting the selected 300 PPI target for a ${W}″×${H}″ layout.`;
    recommendation = 'The source meets this pixel-density target. Confirm bleed, color profile, substrate, and output requirements with the selected printer.';
  } else {
    summary = `Source provides ~${effectiveDpi} PPI (${coverCrop.cropWidthPx}×${coverCrop.cropHeightPx} px active crop). It needs ${requiredWidthPx}×${requiredHeightPx} px to meet the selected 300 PPI target (short by ${widthShortagePx} px width, ${heightShortagePx} px height).`;
    if (effectiveDpi >= 150) {
      recommendation = 'Below the selected 300 PPI target. Whether it is usable depends on the printer, substrate, and viewing distance.';
    } else {
      recommendation = `Low source density for this layout (~${effectiveDpi} PPI). A higher-resolution source or smaller output size is recommended.`;
    }
  }

  return {
    status,
    isReady,
    sourceWidthPx,
    sourceHeightPx,
    totalWidthInches: W,
    totalHeightInches: H,
    requiredWidthPx,
    requiredHeightPx,
    effectiveDpi,
    targetDpi: PRINT_DPI,
    widthShortagePx,
    heightShortagePx,
    pixelShortagePercent,
    panels,
    coverCrop,
    summary,
    recommendation
  };
}

export interface PreviewExportPlan {
  exportWidthPx: number;
  exportHeightPx: number;
  scale: number;
  isDownscaled: boolean;
  estimatedMemoryKb: number;
  safeForCanvas: boolean;
  error?: string;
}

/**
 * Computes a safe browser canvas rendering budget for client PNG preview exports.
 */
export function computePreviewExportPlan(
  totalWidthInches: number,
  totalHeightInches: number,
  displayDpi: number = 72
): PreviewExportPlan {
  const rawW = Math.round(totalWidthInches * displayDpi);
  const rawH = Math.round(totalHeightInches * displayDpi);
  const rawPixels = rawW * rawH;

  if (rawPixels <= 0 || !Number.isFinite(rawPixels)) {
    return {
      exportWidthPx: 0,
      exportHeightPx: 0,
      scale: 0,
      isDownscaled: false,
      estimatedMemoryKb: 0,
      safeForCanvas: false,
      error: 'Invalid preview dimensions'
    };
  }

  if (rawPixels > MAX_PREVIEW_CANVAS_PIXELS || rawW > MAX_PREVIEW_EDGE_PX || rawH > MAX_PREVIEW_EDGE_PX) {
    const scale = Math.min(
      MAX_PREVIEW_EDGE_PX / rawW,
      MAX_PREVIEW_EDGE_PX / rawH,
      Math.sqrt(MAX_PREVIEW_CANVAS_PIXELS / rawPixels)
    );
    const exportWidthPx = Math.floor(rawW * scale);
    const exportHeightPx = Math.floor(rawH * scale);
    return {
      exportWidthPx,
      exportHeightPx,
      scale,
      isDownscaled: true,
      estimatedMemoryKb: Math.round((exportWidthPx * exportHeightPx * 4) / 1024),
      safeForCanvas: true
    };
  }

  return {
    exportWidthPx: rawW,
    exportHeightPx: rawH,
    scale: 1.0,
    isDownscaled: false,
    estimatedMemoryKb: Math.round((rawPixels * 4) / 1024),
    safeForCanvas: true
  };
}
