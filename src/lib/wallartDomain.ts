// Production Domain Logic for WallArt Canvas Pro (Flagship App)

export interface WallArtPreset {
  readonly id: string;
  readonly name: string;
  readonly frameStyle: 'walnut' | 'oak' | 'black' | 'canvas-wrap';
  readonly layoutMode: 'single' | 'triptych' | 'grid';
  readonly printDimension: string;
  readonly dpi: number;
}

export const WALLART_PRESETS: readonly WallArtPreset[] = [
  {
    id: 'preset_hero',
    name: '24x36 Living Room Master Hero',
    frameStyle: 'walnut',
    layoutMode: 'single',
    printDimension: '24" x 36" (60x90cm)',
    dpi: 300
  },
  {
    id: 'preset_triptych',
    name: '3-Piece Gallery Triptych Split',
    frameStyle: 'walnut',
    layoutMode: 'triptych',
    printDimension: '30" x 40" (75x100cm)',
    dpi: 300
  },
  {
    id: 'preset_grid',
    name: '4-Grid Family Memory Wall',
    frameStyle: 'oak',
    layoutMode: 'grid',
    printDimension: '16" x 20" (40x50cm)',
    dpi: 300
  }
];

export function calculateRenderResolution(widthInches: number, heightInches: number, dpi: number = 300): {
  pixelWidth: number;
  pixelHeight: number;
  totalMegapixels: number;
  estimatedTiffMb: number;
} {
  const pixelWidth = Math.round(widthInches * dpi);
  const pixelHeight = Math.round(heightInches * dpi);
  const totalMegapixels = Math.round((pixelWidth * pixelHeight) / 1000000);
  const estimatedTiffMb = Math.round(((pixelWidth * pixelHeight * 4) / (1024 * 1024)) * 10) / 10;

  return {
    pixelWidth,
    pixelHeight,
    totalMegapixels,
    estimatedTiffMb
  };
}
