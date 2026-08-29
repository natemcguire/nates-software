import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  Image as ImageIcon,
  Sliders,
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Layers,
  Palette,
  Maximize2,
  Trash2,
  Lock
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import {
  WallArtLayout,
  WallArtFinish,
  FINISH_DEFINITIONS,
  WALL_PAINT_PRESETS,
  DIMENSION_PRESETS,
  validateImageFile,
  validateDecodedDimensions,
  calculatePrintReadiness,
  computePreviewExportPlan,
  clampDimensions,
  DEFAULT_WIDTH_INCHES,
  DEFAULT_HEIGHT_INCHES,
  DEFAULT_PANEL_GAP_INCHES,
  PrintReadinessReport,
  buildWallArtProductionManifest
} from '../lib/wallartDomain';

export const WallArtStudio: React.FC = () => {
  // Image State
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{
    width: number;
    height: number;
    name: string;
    size: number;
    type: string;
    sha256: string;
  } | null>(null);

  // Studio Configuration State
  const [layout, setLayout] = useState<WallArtLayout>('triptych');
  const [finish, setFinish] = useState<WallArtFinish>('walnut');
  const [wallColor, setWallColor] = useState<string>('#f4f1ea');
  const [widthInches, setWidthInches] = useState<number>(DEFAULT_WIDTH_INCHES);
  const [heightInches, setHeightInches] = useState<number>(DEFAULT_HEIGHT_INCHES);
  const [gapInches, setGapInches] = useState<number>(DEFAULT_PANEL_GAP_INCHES);

  // Status & Feedback State
  const [status, setStatus] = useState<'empty' | 'loading' | 'ready' | 'error' | 'exporting'>('empty');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Reference for object URL cleanup
  const activeUrlRef = useRef<string | null>(null);
  const decodeAttemptRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
        activeUrlRef.current = null;
      }
    };
  }, []);

  // Process and decode uploaded image
  const processImageFile = useCallback((file: File) => {
    const attempt = ++decodeAttemptRef.current;
    // 1. Validate file format and size
    const fileValidation = validateImageFile(file);
    if (!fileValidation.valid) {
      setStatus('error');
      setErrorMessage(fileValidation.error || 'Invalid image file.');
      setStatusMessage(`Error: ${fileValidation.error}`);
      return;
    }

    setStatus('loading');
    setErrorMessage(null);
    setStatusMessage(`Decoding ${file.name}...`);
    setImageUrl(null);
    setImageMeta(null);

    // 2. Revoke previous object URL
    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current);
      activeUrlRef.current = null;
    }

    // 3. Create new object URL and decode dimensions
    const newUrl = URL.createObjectURL(file);
    activeUrlRef.current = newUrl;

    const img = new Image();
    img.onload = async () => {
      if (attempt !== decodeAttemptRef.current) {
        URL.revokeObjectURL(newUrl);
        return;
      }
      const dimValidation = validateDecodedDimensions(img.naturalWidth, img.naturalHeight);
      if (!dimValidation.valid) {
        URL.revokeObjectURL(newUrl);
        activeUrlRef.current = null;
        setStatus('error');
        setErrorMessage(dimValidation.error || 'Invalid image dimensions.');
        setStatusMessage(`Error: ${dimValidation.error}`);
        return;
      }

      let sha256: string;
      try {
        const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
        if (attempt !== decodeAttemptRef.current) {
          URL.revokeObjectURL(newUrl);
          return;
        }
        sha256 = Array.from(digestBytes, byte => byte.toString(16).padStart(2, '0')).join('');
      } catch {
        if (attempt !== decodeAttemptRef.current) {
          URL.revokeObjectURL(newUrl);
          return;
        }
        URL.revokeObjectURL(newUrl);
        activeUrlRef.current = null;
        setStatus('error');
        setErrorMessage('Failed to fingerprint the source image. Please try the upload again.');
        setStatusMessage('Error: Failed to fingerprint source image.');
        return;
      }
      setImageUrl(newUrl);
      setImageMeta({
        width: img.naturalWidth,
        height: img.naturalHeight,
        name: file.name,
        size: file.size,
        type: file.type,
        sha256
      });
      setStatus('ready');
      setStatusMessage(`Loaded "${file.name}" (${img.naturalWidth}×${img.naturalHeight} px). Ready for print inspection.`);
      playSuccessChime();
    };

    img.onerror = () => {
      if (attempt !== decodeAttemptRef.current) return;
      URL.revokeObjectURL(newUrl);
      activeUrlRef.current = null;
      setStatus('error');
      setErrorMessage('Failed to decode image. The file may be corrupted or unreadable.');
      setStatusMessage('Error: Failed to decode image.');
    };

    img.src = newUrl;
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processImageFile(files[0]);
    }
  };

  const handleClearImage = () => {
    playClickSound();
    decodeAttemptRef.current += 1;
    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current);
      activeUrlRef.current = null;
    }
    setImageUrl(null);
    setImageMeta(null);
    setStatus('empty');
    setErrorMessage(null);
    setStatusMessage('Image cleared.');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processImageFile(e.dataTransfer.files[0]);
    }
  };

  // Dimensions clamping
  const handleWidthChange = (val: number) => {
    const clamped = clampDimensions(val, heightInches, gapInches);
    setWidthInches(clamped.widthInches);
  };

  const handleHeightChange = (val: number) => {
    const clamped = clampDimensions(widthInches, val, gapInches);
    setHeightInches(clamped.heightInches);
  };

  const handleGapChange = (val: number) => {
    const clamped = clampDimensions(widthInches, heightInches, val);
    setGapInches(clamped.gapInches);
  };

  // Compute print readiness report
  const readinessReport: PrintReadinessReport | null = imageMeta
    ? calculatePrintReadiness(imageMeta.width, imageMeta.height, widthInches, heightInches, layout, gapInches)
    : null;

  // Client-side PNG preview using a 72 px/in layout scale. Browsers do not
  // guarantee that exported PNGs carry matching physical-resolution metadata.
  const handleExportClientPreview = async () => {
    if (!imageUrl || !imageMeta || !readinessReport) return;

    playClickSound();
    setStatus('exporting');
    setStatusMessage('Rendering client PNG preview...');

    try {
      const plan = computePreviewExportPlan(widthInches, heightInches, 72);
      if (!plan.safeForCanvas || plan.exportWidthPx <= 0 || plan.exportHeightPx <= 0) {
        throw new Error(plan.error || 'Preview resolution exceeds safe browser canvas budget.');
      }

      // Create off-screen canvas for preview rendering
      const canvas = document.createElement('canvas');
      const paddingPx = 80;
      canvas.width = plan.exportWidthPx + paddingPx * 2;
      canvas.height = plan.exportHeightPx + paddingPx * 2 + 100; // Extra space for floor reference & label
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('HTML5 Canvas 2D context unavailable.');
      }

      // 1. Draw wall background
      ctx.fillStyle = wallColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Subtle wall vignette gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, 'rgba(0,0,0,0.05)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Floor line
      const floorY = canvas.height - 40;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, floorY, canvas.width, 40);
      ctx.fillStyle = '#475569';
      ctx.fillRect(0, floorY, canvas.width, 4);

      // 2. Load source image to draw sliced panels
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image for preview export.'));
        img.src = imageUrl;
      });

      const artStartX = paddingPx;
      const artStartY = paddingPx;
      const artW = plan.exportWidthPx;
      const artH = plan.exportHeightPx;

      const finishDef = FINISH_DEFINITIONS[finish];

      // 3. Draw each panel
      for (const panel of readinessReport.panels) {
        const pLeft = artStartX + panel.normLeft * artW;
        const pTop = artStartY + panel.normTop * artH;
        const pWidth = panel.normWidth * artW;
        const pHeight = panel.normHeight * artH;

        // Shadow
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 10;
        ctx.fillStyle = finishDef.previewBorderColor;
        ctx.fillRect(pLeft, pTop, pWidth, pHeight);
        ctx.restore();

        // Frame Border
        const frameBorderWidth = finish === 'gallery_wrap' ? 2 : 6;
        ctx.fillStyle = finishDef.previewBorderColor;
        ctx.fillRect(pLeft, pTop, pWidth, pHeight);

        // Inner image crop
        const innerLeft = pLeft + frameBorderWidth;
        const innerTop = pTop + frameBorderWidth;
        const innerWidth = pWidth - frameBorderWidth * 2;
        const innerHeight = pHeight - frameBorderWidth * 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(innerLeft, innerTop, innerWidth, innerHeight);
        ctx.clip();

        // Calculate source image slice coordinates from cover crop
        const crop = readinessReport.coverCrop;
        const srcSliceX = crop.offsetX + panel.normLeft * crop.cropWidthPx;
        const srcSliceY = crop.offsetY + panel.normTop * crop.cropHeightPx;
        const srcSliceW = panel.normWidth * crop.cropWidthPx;
        const srcSliceH = panel.normHeight * crop.cropHeightPx;

        ctx.drawImage(img, srcSliceX, srcSliceY, srcSliceW, srcSliceH, innerLeft, innerTop, innerWidth, innerHeight);
        ctx.restore();
      }

      // 4. Draw honest watermark & metadata header
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(artStartX, artStartY + artH + 16, artW, 24);
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `PREVIEW ONLY • ${plan.exportWidthPx}×${plan.exportHeightPx} px • ${widthInches}″×${heightInches}″ ${layout.toUpperCase()} • ${finishDef.name}`,
        artStartX + 8,
        artStartY + artH + 32
      );

      // 5. Trigger download
      const filename = `wallart-preview-${widthInches}x${heightInches}-${layout}.png`;
      const previewBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('Browser failed to encode the PNG preview.')),
          'image/png'
        );
      });
      const previewDataUrl = URL.createObjectURL(previewBlob);
      const downloadLink = document.createElement('a');
      downloadLink.href = previewDataUrl;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(previewDataUrl);

      setStatus('ready');
      setStatusMessage(`Downloaded preview: ${filename} (${plan.exportWidthPx}×${plan.exportHeightPx} px browser preview, not production output).`);
      playSuccessChime();
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message || 'Failed to export client preview.');
      setStatusMessage(`Export error: ${err.message}`);
    }
  };

  const handleExportProductionSpec = () => {
    if (!imageMeta || !readinessReport) return;
    const manifest = buildWallArtProductionManifest({
      source: {
        name: imageMeta.name, mimeType: imageMeta.type, sizeBytes: imageMeta.size,
        widthPx: imageMeta.width, heightPx: imageMeta.height, sha256: imageMeta.sha256
      },
      layout,
      finish,
      widthInches,
      heightInches,
      gapInches,
      wallColor,
      readiness: readinessReport
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `wallart-render-job-${imageMeta.sha256.slice(0, 12)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusMessage(`Exported source-bound renderer job specification for ${imageMeta.name}.`);
    playSuccessChime();
  };

  const finishDef = FINISH_DEFINITIONS[finish];

  return (
    <div className="h-full flex flex-col md:flex-row bg-[#ece9d8] font-tahoma text-xs overflow-y-auto md:overflow-hidden select-none">
      {/* Hidden Accessible Live Announcement Region */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </div>

      {/* LEFT SIDEBAR: Controls & Resolution Telemetry */}
      <div className="w-full md:w-[22rem] bg-w95-gray border-r-2 border-gray-400 p-3 flex flex-col gap-3 overflow-y-auto shrink-0 shadow-md">
        {/* Studio Header */}
        <div className="bg-[#000080] text-white px-2 py-1.5 font-bold text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-1.5">
            <Sliders size={13} className="text-yellow-300" />
            <span className="tracking-wide">WALLART CANVAS PRO</span>
          </div>
          <span className="text-[10px] font-mono bg-blue-900 px-1.5 py-0.5 rounded border border-blue-400">
            Client-First
          </span>
        </div>

        {/* 1. Image Upload / Source Section */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-gray-700 font-bold">
            <span className="flex items-center gap-1">
              <Upload size={12} />
              <span>Source Artwork Photo</span>
            </span>
            {imageMeta && (
              <button
                onClick={handleClearImage}
                className="text-[10px] text-red-700 hover:text-red-900 flex items-center gap-0.5"
                title="Remove photo"
                aria-label="Remove uploaded photo"
              >
                <Trash2 size={10} /> Clear
              </button>
            )}
          </div>

          <input
            id="wallart-file-input"
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={handleFileInputChange}
          />

          {!imageMeta ? (
            <label
              htmlFor="wallart-file-input"
              className="btn-w95 w-full py-3 flex flex-col items-center justify-center gap-1 cursor-pointer bg-white hover:bg-yellow-50 text-gray-800 border-2 border-dashed border-gray-400 text-center"
            >
              <Upload size={16} className="text-blue-800 animate-bounce" />
              <span className="font-bold text-xs">Select Photo (JPEG, PNG, WebP)</span>
              <span className="text-[10px] text-gray-500 font-mono">Max 20 MiB • Pure Local Decode</span>
            </label>
          ) : (
            <div className="bg-white border border-gray-400 p-2 rounded text-[11px] font-mono space-y-1">
              <div className="flex justify-between items-center text-blue-900 font-bold truncate">
                <span className="truncate" title={imageMeta.name}>{imageMeta.name}</span>
                <span className="bg-blue-100 text-blue-800 text-[9px] px-1 rounded ml-1 shrink-0">
                  {(imageMeta.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
              <div className="flex justify-between text-gray-600 text-[10px]">
                <span>Source Dimensions:</span>
                <strong className="text-gray-900">{imageMeta.width} × {imageMeta.height} px</strong>
              </div>
              <label
                htmlFor="wallart-file-input"
                className="btn-w95 w-full text-center py-1 mt-1 block cursor-pointer font-sans text-xs"
              >
                Replace Photo
              </label>
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="bg-red-50 border border-red-400 text-red-800 p-2 rounded text-[11px] flex items-start gap-1.5">
              <AlertTriangle size={13} className="text-red-600 shrink-0 mt-0.5" />
              <span className="leading-tight">{errorMessage}</span>
            </div>
          )}
        </div>

        {/* 2. Layout Multi-Panel Selector */}
        <div>
          <label className="block text-gray-700 font-bold mb-1 flex items-center gap-1">
            <Layers size={12} />
            <span>Panel Layout</span>
          </label>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label="Panel layout">
            {[
              { id: 'single', label: 'Single Piece', sub: '1 Panel' },
              { id: 'triptych', label: '3-Piece', sub: 'Triptych' },
              { id: 'four-grid', label: '4-Grid', sub: '2×2' }
            ].map(l => (
              <button
                key={l.id}
                onClick={() => { playClickSound(); setLayout(l.id as WallArtLayout); }}
                aria-pressed={layout === l.id}
                className={`p-1.5 text-center border transition-all ${
                  layout === l.id
                    ? 'bg-white border-2 border-t-black border-l-black border-b-white border-r-white font-bold text-blue-900 shadow-inner'
                    : 'bg-w95-gray border-t-white border-l-white border-b-black border-r-black hover:bg-gray-200'
                }`}
              >
                <div className="text-[11px] font-bold">{l.label}</div>
                <div className="text-[9px] text-gray-500 font-mono">{l.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Canvas Finish Selector */}
        <div>
          <label className="block text-gray-700 font-bold mb-1">Canvas Finish &amp; Frame</label>
          <div className="space-y-1" role="group" aria-label="Finish preview style">
            {(Object.keys(FINISH_DEFINITIONS) as WallArtFinish[]).map(fKey => {
              const def = FINISH_DEFINITIONS[fKey];
              return (
                <button
                  key={fKey}
                  onClick={() => { playClickSound(); setFinish(fKey); }}
                  aria-pressed={finish === fKey}
                  className={`w-full text-left p-1.5 border flex items-center justify-between ${
                    finish === fKey
                      ? 'bg-white border-2 border-t-black border-l-black border-b-white border-r-white font-bold text-blue-900 shadow-inner'
                      : 'bg-w95-gray border-t-white border-l-white border-b-black border-r-black hover:bg-gray-200 text-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3.5 h-3.5 rounded border border-gray-500 shrink-0 shadow-sm"
                      style={{ backgroundColor: def.previewBorderColor }}
                    />
                    <div>
                      <div className="text-xs">{def.name}</div>
                      <div className="text-[9px] text-gray-500 font-mono truncate max-w-[170px]">{def.description}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Physical Dimensions (Inches) */}
        <div className="space-y-1.5">
          <label className="block text-gray-700 font-bold flex items-center gap-1">
            <Maximize2 size={12} />
            <span>Overall Canvas Dimensions</span>
          </label>

          {/* Dimension Presets */}
          <div className="grid grid-cols-2 gap-1 font-mono text-[10px]">
            {DIMENSION_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => {
                  playClickSound();
                  setWidthInches(p.widthInches);
                  setHeightInches(p.heightInches);
                }}
                className={`p-1 text-center border truncate ${
                  widthInches === p.widthInches && heightInches === p.heightInches
                    ? 'bg-blue-100 border-2 border-t-black border-l-black border-b-white border-r-white font-bold text-blue-900'
                    : 'bg-w95-gray border-t-white border-l-white border-b-black border-r-black hover:bg-gray-200'
                }`}
              >
                {p.widthInches}″ × {p.heightInches}″
              </button>
            ))}
          </div>

          {/* Custom Numeric Controls */}
          <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
            <div>
              <label htmlFor="wallart-width-input" className="block text-gray-600 text-[10px] mb-0.5">
                Width (inches)
              </label>
              <input
                id="wallart-width-input"
                type="number"
                min={8}
                max={120}
                value={widthInches}
                onChange={(e) => handleWidthChange(parseFloat(e.target.value) || DEFAULT_WIDTH_INCHES)}
                className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
              />
            </div>

            <div>
              <label htmlFor="wallart-height-input" className="block text-gray-600 text-[10px] mb-0.5">
                Height (inches)
              </label>
              <input
                id="wallart-height-input"
                type="number"
                min={8}
                max={120}
                value={heightInches}
                onChange={(e) => handleHeightChange(parseFloat(e.target.value) || DEFAULT_HEIGHT_INCHES)}
                className="w-full bg-white border border-gray-400 p-1 text-xs outline-none"
              />
            </div>
          </div>

          {layout !== 'single' && (
            <div className="pt-1 font-mono text-[11px]">
              <div className="flex justify-between items-center">
                <label htmlFor="wallart-gap-input" className="text-gray-600 text-[10px]">
                  Panel Gap: {gapInches}″
                </label>
              </div>
              <input
                id="wallart-gap-input"
                type="range"
                min={0.5}
                max={4.0}
                step={0.5}
                value={gapInches}
                onChange={(e) => handleGapChange(parseFloat(e.target.value))}
                className="w-full accent-blue-700 cursor-pointer h-1.5 bg-gray-300 rounded"
              />
            </div>
          )}
        </div>

        {/* 5. Wall Paint Color Picker */}
        <div>
          <label htmlFor="wallart-paint-picker" className="block text-gray-700 font-bold mb-1 flex items-center gap-1">
            <Palette size={12} />
            <span>Wall Paint Color</span>
          </label>
          <div className="grid grid-cols-6 gap-1 mb-1.5">
            {WALL_PAINT_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => { playClickSound(); setWallColor(p.hex); }}
                title={`${p.name} (${p.hex})`}
                aria-label={`Wall paint: ${p.name}`}
                className={`h-6 rounded border transition-transform ${
                  wallColor.toLowerCase() === p.hex.toLowerCase()
                    ? 'scale-110 border-2 border-black shadow-md ring-1 ring-blue-500'
                    : 'border-gray-400 hover:scale-105'
                }`}
                style={{ backgroundColor: p.hex }}
              />
            ))}
          </div>

          <p className="text-[9px] text-gray-600 leading-tight">
            Paint and finish colors are approximate sRGB browser previews, not material or color proofs.
          </p>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            <input
              id="wallart-paint-picker"
              type="color"
              value={wallColor}
              onChange={(e) => setWallColor(e.target.value)}
              className="w-7 h-6 border border-gray-400 cursor-pointer p-0 rounded"
              title="Custom hex color"
            />
            <span className="text-gray-600 uppercase">{wallColor}</span>
          </div>
        </div>

        {/* 6. 300 PPI target comparison */}
        <div className="border-t border-gray-300 pt-2 space-y-1.5 font-mono text-[11px]">
          <div className="flex items-center justify-between font-bold text-gray-800">
            <span>300 PPI SOURCE CHECK</span>
            <span className="text-[9px] bg-gray-200 text-gray-700 px-1 py-0.2 rounded border border-gray-400">
              Selected Target
            </span>
          </div>

          {readinessReport ? (
            <div className="space-y-1.5">
              {/* Readiness Badge */}
              <div
                className={`p-2 rounded border flex items-center gap-2 ${
                  readinessReport.isReady
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                    : 'bg-amber-50 border-amber-500 text-amber-950'
                }`}
              >
                {readinessReport.isReady ? (
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                )}
                <div>
                  <div className="font-bold text-xs">
                    {readinessReport.isReady ? 'MEETS 300 PPI TARGET' : 'RESOLUTION SHORTAGE'}
                  </div>
                  <div className="text-[10px]">
                    Effective: ~<strong>{readinessReport.effectiveDpi} PPI</strong> (Target: 300)
                  </div>
                </div>
              </div>

              {/* Resolution Numbers Breakdown */}
              <div className="bg-white border border-gray-300 p-2 rounded space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-gray-500">Target Output:</span>
                  <span className="font-bold text-gray-800">
                    {readinessReport.requiredWidthPx} × {readinessReport.requiredHeightPx} px (300 PPI target)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Active Crop:</span>
                  <span className="font-bold text-blue-900">
                    {readinessReport.coverCrop.cropWidthPx} × {readinessReport.coverCrop.cropHeightPx} px
                  </span>
                </div>
                {!readinessReport.isReady && (
                  <div className="flex justify-between text-red-700 font-bold border-t border-gray-200 pt-0.5">
                    <span>Pixel Shortage:</span>
                    <span>
                      -{readinessReport.widthShortagePx}W / -{readinessReport.heightShortagePx}H px ({readinessReport.pixelShortagePercent}%)
                    </span>
                  </div>
                )}
              </div>

              {/* Panel Breakdown */}
              <div className="text-[10px] text-gray-600 bg-gray-100 p-1.5 rounded border border-gray-300 space-y-0.5">
                <div className="font-bold text-gray-700 mb-0.5">Panel Dimensions:</div>
                {readinessReport.panels.map(p => (
                  <div key={p.index} className="flex justify-between font-mono text-[9px]">
                    <span>Panel {p.index + 1}: {p.widthInches}″ × {p.heightInches}″</span>
                    <span>{p.requiredWidthPx} × {p.requiredHeightPx} px</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-gray-100 border border-gray-300 p-2.5 rounded text-center text-gray-500 text-[10px]">
              Upload a photo to compare its active crop with the 300 PPI target.
            </div>
          )}
        </div>

        {/* 7. Client preview export and explicit production boundary */}
        <div className="border-t border-gray-300 pt-2 space-y-2 mt-auto">
          {/* Client Preview Button */}
          <button
            onClick={handleExportClientPreview}
            disabled={!imageMeta || status === 'exporting'}
            className="btn-w95 btn-w95-primary w-full py-2 font-bold text-xs flex items-center justify-center gap-1.5 text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <Download size={13} className="text-cyan-300" />
            <span>{status === 'exporting' ? 'Generating Preview...' : 'Export PNG Preview'}</span>
          </button>

          {/* Honest production export boundary (disabled / unavailable) */}
          <div className="bg-gray-100 border border-gray-300 p-2 rounded text-[10px] space-y-1">
            <div className="flex items-center justify-between text-gray-700 font-bold">
              <span className="flex items-center gap-1">
                <Lock size={11} className="text-gray-500" />
                <span>Production TIFF &amp; Print Dispatch</span>
              </span>
              <span className="text-[9px] bg-gray-200 text-gray-600 px-1 rounded border border-gray-400 font-mono">
                Adapter Required
              </span>
            </div>
            <p className="text-gray-600 leading-tight">
              This browser preview does not generate print-ready TIFF files or submit print orders. Those actions require a configured renderer and print-service adapter, including printer-specific bleed and color-profile rules.
            </p>
            <button
              onClick={handleExportProductionSpec}
              disabled={!imageMeta || !readinessReport}
              className="btn-w95 w-full py-1 text-[10px] font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
            >
              <Download size={11} /> Export Source-Bound Renderer Job
            </button>
            <button
              disabled
              aria-disabled="true"
              className="btn-w95 w-full py-1 text-[10px] text-gray-400 bg-gray-200 border-gray-300 cursor-not-allowed flex items-center justify-center gap-1"
            >
              <span>Production Export Unavailable</span>
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT VIEWPORT: Interactive Living Room Wall Visualizer */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="region"
        aria-label="Living Room Wall Visualizer"
        aria-describedby="wallart-preview-description"
        className={`flex-1 min-h-[32rem] md:min-h-0 p-6 flex flex-col items-center justify-center relative overflow-hidden transition-colors duration-500 ${
          isDragging ? 'ring-4 ring-blue-500 ring-inset' : ''
        }`}
        style={{
          backgroundColor: wallColor,
          backgroundImage: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.12) 100%)'
        }}
      >
        <p id="wallart-preview-description" className="sr-only">
          {imageMeta && readinessReport
            ? `${layout} wall-art preview using the ${finishDef.name} style on wall color ${wallColor}. The browser-decoded center crop measures approximately ${readinessReport.effectiveDpi} pixels per inch at ${widthInches} by ${heightInches} inches.`
            : 'No image is loaded. Choose a JPEG, PNG, or WebP photo to begin a local wall-art preview.'}
        </p>
        {/* Living Room Floor Horizon Line */}
        <div className="absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-slate-900 to-slate-800 border-t-4 border-slate-700 shadow-2xl flex items-center justify-center select-none pointer-events-none">
          <div className="text-[10px] font-mono text-slate-400 opacity-60">
            🛋️ Living Room Perspective Scale Reference
          </div>
        </div>

        {/* Minimalist Floor Silhouette */}
        <div className="absolute bottom-14 w-64 h-8 bg-slate-800/60 rounded-t-lg border-t border-slate-600/40 pointer-events-none" />

        {/* Artwork Canvas Container */}
        {imageMeta && imageUrl && readinessReport ? (
          <div className="relative z-10 flex flex-col items-center max-w-full max-h-[75vh]">
            {/* Multi-Panel Canvas Layout */}
            <div
              className="relative flex items-center justify-center shadow-2xl transition-all duration-300"
              style={{
                // Compute visual aspect ratio of the overall wall art span
                width: `min(90vw, ${Math.min(680, widthInches * 14)}px)`,
                aspectRatio: `${widthInches} / ${heightInches}`
              }}
            >
              {readinessReport.panels.map((p) => {
                const isFrameless = finish === 'gallery_wrap';
                const borderWidthPx = isFrameless ? 2 : 6;

                return (
                  <div
                    key={p.index}
                    className="absolute transition-all duration-300 rounded-sm"
                    style={{
                      left: `${p.normLeft * 100}%`,
                      top: `${p.normTop * 100}%`,
                      width: `${p.normWidth * 100}%`,
                      height: `${p.normHeight * 100}%`,
                      backgroundColor: finishDef.previewBorderColor,
                      padding: `${borderWidthPx}px`,
                      boxShadow: isFrameless
                        ? '6px 8px 20px rgba(0, 0, 0, 0.45), inset 0 0 4px rgba(255,255,255,0.3)'
                        : '8px 12px 28px rgba(0, 0, 0, 0.5), inset 0 0 2px rgba(0,0,0,0.6)'
                    }}
                  >
                    {/* Inner Clipped Continuous Artwork Slice */}
                    <div className="w-full h-full overflow-hidden relative bg-black rounded-[1px]">
                      <div
                        className="absolute"
                        style={{
                          width: `${(1 / p.normWidth) * 100}%`,
                          height: `${(1 / p.normHeight) * 100}%`,
                          left: `-${(p.normLeft / p.normWidth) * 100}%`,
                          top: `-${(p.normTop / p.normHeight) * 100}%`
                        }}
                      >
                        <img
                          src={imageUrl}
                          alt={`Panel ${p.index + 1} of ${readinessReport.panels.length} (${imageMeta.name})`}
                          className="w-full h-full object-cover select-none pointer-events-none"
                          draggable={false}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom HUD Spec Label */}
            <div className="mt-6 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 text-white font-mono text-[10px] flex items-center gap-3 shadow-lg select-none">
              <span>{widthInches}″ × {heightInches}″ {layout.toUpperCase()}</span>
              <span className="text-gray-400">•</span>
              <span className="text-amber-300">{finishDef.name}</span>
              <span className="text-gray-400">•</span>
              <span className={readinessReport.isReady ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                ~{readinessReport.effectiveDpi} PPI
              </span>
            </div>
          </div>
        ) : (
          /* First-Run Empty State */
          <div className="relative z-10 bg-white/90 backdrop-blur-sm border-2 border-dashed border-gray-400 p-8 rounded-lg max-w-md w-full shadow-2xl text-center space-y-4 font-sans select-none">
            <div className="w-16 h-16 mx-auto bg-blue-50 border-2 border-blue-200 rounded-full flex items-center justify-center shadow-inner">
              <ImageIcon size={32} className="text-blue-800" />
            </div>

            <div className="space-y-1">
              <h2 className="text-base font-bold text-gray-900 font-tahoma">
                Living Room Wall Art Visualizer
              </h2>
              <p className="text-xs text-gray-600 leading-relaxed">
                Upload your high-resolution photography to test multi-panel splits and finishes, and compare its pixels with a 300 PPI output target.
              </p>
            </div>

            <div className="bg-gray-50 border border-gray-300 p-3 rounded text-[11px] font-mono text-gray-700 text-left space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-gray-900">
                <Info size={12} className="text-blue-700" />
                <span>Supported Specifications:</span>
              </div>
              <div>• Formats: JPEG, PNG, WebP (up to 20 MiB)</div>
              <div>• Layouts: Single Frame, 3-Piece Triptych, 4-Grid</div>
              <div>• Finishes: Solid Walnut, Oak, Matte Black, Gallery Wrap</div>
              <div>• Calculations: 300 PPI target and pixel-shortage analysis</div>
            </div>

            <label
              htmlFor="wallart-file-input"
              className="btn-w95 btn-w95-primary w-full py-2.5 font-bold text-xs text-white flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <Upload size={14} />
              <span>Choose Photo to Visualize</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
