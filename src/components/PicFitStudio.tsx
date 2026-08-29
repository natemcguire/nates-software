import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import {
  Upload,
  Image as ImageIcon,
  Crop,
  Maximize2,
  Sliders,
  Download,
  Shield,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  Sparkles,
  Info
} from 'lucide-react';
import { playClickSound, playSuccessChime, playErrorBeep } from '../lib/soundEngine';
import {
  OutputFormat,
  AspectRatioPreset,
  AlignX,
  AlignY,
  PixelCropRect,
  ASPECT_RATIO_PRESETS,
  DIMENSION_PRESETS,
  OUTPUT_FORMATS,
  DEFAULT_QUALITY,
  validateImageFile,
  validateDecodedDimensions,
  computeInitialCrop,
  adjustFraming,
  scaleCropCoverage,
  calculateLockedDimensions,
  clampTargetDimensions,
  generateDeterministicFilename,
  formatBytes,
  formatAspectRatio,
  calculateCompressionMetrics,
  renderCroppedToCanvas,
  encodeCanvasToBlob,
  EncodedImageMetrics
} from '../lib/picfitDomain';

interface SourceImageState {
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  url: string;
  imgElement: HTMLImageElement;
}

export const PicFitStudio: React.FC = () => {
  // Input IDs for accessibility
  const widthInputId = useId();
  const heightInputId = useId();
  const qualityInputId = useId();
  const coverageInputId = useId();

  // Source Image State
  const [sourceImage, setSourceImage] = useState<SourceImageState | null>(null);
  const [status, setStatus] = useState<'empty' | 'loading' | 'ready' | 'encoding' | 'error'>('empty');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<string>('Ready');
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Crop State
  const [aspectPreset, setAspectPreset] = useState<AspectRatioPreset>('1:1');
  const [cropRect, setCropRect] = useState<PixelCropRect>({ x: 0, y: 0, width: 800, height: 800 });
  const [alignX, setAlignX] = useState<AlignX>('center');
  const [alignY, setAlignY] = useState<AlignY>('center');
  const [coveragePercent, setCoveragePercent] = useState<number>(100);

  // Resize / Output Dimensions State
  const [targetWidth, setTargetWidth] = useState<number>(800);
  const [targetHeight, setTargetHeight] = useState<number>(800);
  const [lockAspect, setLockAspect] = useState<boolean>(true);

  // Output Format & Quality State
  const [format, setFormat] = useState<OutputFormat>('image/jpeg');
  const [quality, setQuality] = useState<number>(DEFAULT_QUALITY);

  // Encoded Result & Metrics State
  const [encodedBlob, setEncodedBlob] = useState<Blob | null>(null);
  const [encodedBlobUrl, setEncodedBlobUrl] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<EncodedImageMetrics | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [previewMode, setPreviewMode] = useState<'fit' | 'actual'>('fit');

  // Refs for resource lifecycle and async race condition safety
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeSourceUrlRef = useRef<string | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);
  const activeImageRef = useRef<HTMLImageElement | null>(null);
  const decodeAttemptRef = useRef<number>(0);
  const encodeAttemptRef = useRef<number>(0);
  const encodeDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up all object URLs when component unmounts
  useEffect(() => {
    return () => {
      decodeAttemptRef.current += 1;
      encodeAttemptRef.current += 1;
      if (activeImageRef.current) {
        activeImageRef.current.src = '';
        activeImageRef.current = null;
      }
      if (activeSourceUrlRef.current) {
        URL.revokeObjectURL(activeSourceUrlRef.current);
        activeSourceUrlRef.current = null;
      }
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
      if (encodeDebounceTimerRef.current) {
        clearTimeout(encodeDebounceTimerRef.current);
      }
    };
  }, []);

  /**
   * Cleans active resources and resets to initial empty state.
   */
  const handleReset = useCallback(() => {
    playClickSound();
    if (activeSourceUrlRef.current) {
      if (activeImageRef.current) {
        activeImageRef.current.src = '';
        activeImageRef.current = null;
      }
      URL.revokeObjectURL(activeSourceUrlRef.current);
      activeSourceUrlRef.current = null;
    }
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    decodeAttemptRef.current += 1;
    encodeAttemptRef.current += 1;
    setSourceImage(null);
    setEncodedBlob(null);
    setEncodedBlobUrl(null);
    setMetrics(null);
    setStatus('empty');
    setErrorMessage(null);
    setStatusFeedback('Sandbox cleared.');
  }, []);

  /**
   * Safely decodes an image file or blob into an HTMLImageElement with dimension validation.
   */
  const processImageBlob = useCallback((blob: Blob, name: string, declaredType: string, fileSize: number) => {
    const attempt = ++decodeAttemptRef.current;

    // 1. Initial file metadata validation
    const fileValidation = validateImageFile({ name, size: fileSize, type: declaredType });
    if (!fileValidation.valid) {
      playErrorBeep();
      setStatus('error');
      setErrorMessage(fileValidation.error || 'Invalid image file.');
      setStatusFeedback(`Validation rejected: ${fileValidation.error}`);
      return;
    }

    setStatus('loading');
    setErrorMessage(null);
    setStatusFeedback(`Decoding ${name}...`);

    // 2. Clean previous source URL
    if (activeSourceUrlRef.current) {
      if (activeImageRef.current) {
        activeImageRef.current.src = '';
        activeImageRef.current = null;
      }
      URL.revokeObjectURL(activeSourceUrlRef.current);
      activeSourceUrlRef.current = null;
    }

    const objectUrl = URL.createObjectURL(blob);
    activeSourceUrlRef.current = objectUrl;

    const img = new Image();
    img.decoding = 'async';

    const cleanImgListeners = () => {
      img.onload = null;
      img.onerror = null;
    };

    img.onload = () => {
      cleanImgListeners();
      // Guard against stale async resolution
      if (attempt !== decodeAttemptRef.current) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      const nw = img.naturalWidth;
      const nh = img.naturalHeight;

      // 3. Decoded image dimension & dimension-bomb validation
      const dimValidation = validateDecodedDimensions(nw, nh);
      if (!dimValidation.valid) {
        playErrorBeep();
        URL.revokeObjectURL(objectUrl);
        activeSourceUrlRef.current = null;
        setStatus('error');
        setErrorMessage(dimValidation.error || 'Invalid image dimensions.');
        setStatusFeedback(`Decode rejected: ${dimValidation.error}`);
        return;
      }

      const validWidth = dimValidation.width!;
      const validHeight = dimValidation.height!;

      const newSource: SourceImageState = {
        name,
        type: declaredType || 'image/jpeg',
        size: fileSize,
        width: validWidth,
        height: validHeight,
        url: objectUrl,
        imgElement: img
      };

      activeImageRef.current = img;
      setSourceImage(newSource);

      // Compute initial crop (defaults to square 1:1 or source ratio)
      const initialCrop = computeInitialCrop(validWidth, validHeight, '1:1');
      setCropRect(initialCrop);
      setAspectPreset('1:1');
      setAlignX('center');
      setAlignY('center');
      setCoveragePercent(100);

      // Set initial target output dimensions
      setTargetWidth(initialCrop.width);
      setTargetHeight(initialCrop.height);
      setLockAspect(true);

      setStatus('ready');
      setStatusFeedback(`Loaded ${name} (${validWidth} × ${validHeight} px)`);
      playSuccessChime();
    };

    img.onerror = () => {
      cleanImgListeners();
      if (attempt !== decodeAttemptRef.current) {
        img.src = '';
        URL.revokeObjectURL(objectUrl);
        return;
      }
      playErrorBeep();
      URL.revokeObjectURL(objectUrl);
      activeSourceUrlRef.current = null;
      setStatus('error');
      setErrorMessage('Failed to decode image. The file may be corrupt, damaged, or an unsupported format.');
      setStatusFeedback('Decode error: Corrupt or unrecognized image.');
    };

    img.src = objectUrl;
  }, []);

  /**
   * Handles native file selection via `<input type="file">`.
   */
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageBlob(file, file.name, file.type, file.size);
    }
  };

  /**
   * Loads the built-in 100% client-side Calibration Card for instant first-run testing.
   */
  const handleLoadSample = useCallback(async () => {
    playClickSound();
    setStatus('loading');
    setErrorMessage(null);
    setStatusFeedback('Generating client-side calibration test card...');

    try {
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 1600;
      sampleCanvas.height = 1000;
      const context = sampleCanvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable.');
      const gradient = context.createLinearGradient(0, 0, 1600, 1000);
      gradient.addColorStop(0, '#0a192f');
      gradient.addColorStop(1, '#1d4ed8');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 1600, 1000);
      context.strokeStyle = '#64ffda';
      context.lineWidth = 8;
      context.strokeRect(48, 48, 1504, 904);
      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      context.font = 'bold 64px sans-serif';
      context.fillText('PICFIT CALIBRATION', 800, 470);
      context.fillStyle = '#64ffda';
      context.font = '32px monospace';
      context.fillText('1600 x 1000 PX', 800, 535);
      const blob = await encodeCanvasToBlob(sampleCanvas, 'image/png', 1);
      processImageBlob(blob, 'picfit-calibration-1600x1000.png', blob.type, blob.size);
    } catch {
      playErrorBeep();
      setStatus('error');
      setErrorMessage('Failed to generate client-side test card.');
    }
  }, [processImageBlob]);

  /**
   * Drag & Drop event handlers.
   */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
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

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processImageBlob(file, file.name, file.type, file.size);
    }
  };

  /**
   * Updates crop when aspect ratio preset changes.
   */
  const handleAspectPresetChange = (preset: AspectRatioPreset) => {
    playClickSound();
    setAspectPreset(preset);
    if (!sourceImage) return;

    const newCrop = computeInitialCrop(sourceImage.width, sourceImage.height, preset);
    setCropRect(newCrop);
    setCoveragePercent(100);

    if (lockAspect) {
      setTargetWidth(newCrop.width);
      setTargetHeight(newCrop.height);
    }
  };

  /**
   * Updates framing alignment (Left/Center/Right, Top/Center/Bottom).
   */
  const handleFramingAlignChange = (newAlignX: AlignX, newAlignY: AlignY) => {
    playClickSound();
    setAlignX(newAlignX);
    setAlignY(newAlignY);
    if (!sourceImage) return;

    const framedCrop = adjustFraming(cropRect, sourceImage.width, sourceImage.height, newAlignX, newAlignY);
    setCropRect(framedCrop);
  };

  /**
   * Updates crop coverage / zoom slider.
   */
  const handleCoverageChange = (percent: number) => {
    setCoveragePercent(percent);
    if (!sourceImage) return;

    const preset = ASPECT_RATIO_PRESETS.find(p => p.id === aspectPreset);
    const ratio = preset?.ratio ?? (aspectPreset === 'original' ? sourceImage.width / sourceImage.height : null);
    const scaled = scaleCropCoverage(sourceImage.width, sourceImage.height, ratio, percent);
    const framed = adjustFraming(scaled, sourceImage.width, sourceImage.height, alignX, alignY);
    setCropRect(framed);

    if (lockAspect) {
      setTargetWidth(framed.width);
      setTargetHeight(framed.height);
    }
  };

  /**
   * Handles target width input changes.
   */
  const handleWidthChange = (val: number) => {
    if (!sourceImage) return;
    const clamped = calculateLockedDimensions({
      newWidth: val,
      cropWidth: cropRect.width,
      cropHeight: cropRect.height,
      lockAspect,
      currentWidth: targetWidth,
      currentHeight: targetHeight
    });
    setTargetWidth(clamped.width);
    setTargetHeight(clamped.height);
  };

  /**
   * Handles target height input changes.
   */
  const handleHeightChange = (val: number) => {
    if (!sourceImage) return;
    const clamped = calculateLockedDimensions({
      newHeight: val,
      cropWidth: cropRect.width,
      cropHeight: cropRect.height,
      lockAspect,
      currentWidth: targetWidth,
      currentHeight: targetHeight
    });
    setTargetWidth(clamped.width);
    setTargetHeight(clamped.height);
  };

  /**
   * Applies a standard dimension preset.
   */
  const handleApplyDimensionPreset = (preset: (typeof DIMENSION_PRESETS)[number]) => {
    playClickSound();
    const safe = clampTargetDimensions(preset.width, preset.height);
    setTargetWidth(safe.width);
    setTargetHeight(safe.height);
  };

  /**
   * Applies quick scale percentage (100%, 75%, 50%, 25% of current crop).
   */
  const handleApplyScalePercentage = (factor: number) => {
    playClickSound();
    const w = Math.max(1, Math.round(cropRect.width * factor));
    const h = Math.max(1, Math.round(cropRect.height * factor));
    const safe = clampTargetDimensions(w, h);
    setTargetWidth(safe.width);
    setTargetHeight(safe.height);
  };

  /**
   * Performs canvas drawing and encodes actual output blob with debounce and race protection.
   */
  useEffect(() => {
    if (!sourceImage) {
      return;
    }

    if (encodeDebounceTimerRef.current) {
      clearTimeout(encodeDebounceTimerRef.current);
    }

    const attempt = ++encodeAttemptRef.current;
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
    setEncodedBlob(null);
    setEncodedBlobUrl(null);
    setMetrics(null);
    setStatus('encoding');
    setStatusFeedback('Rendering and encoding image in memory...');

    encodeDebounceTimerRef.current = setTimeout(async () => {
      try {
        const clampedTarget = clampTargetDimensions(targetWidth, targetHeight);
        const canvas = canvasRef.current || document.createElement('canvas');

        // Draw cropped and scaled image onto canvas
        renderCroppedToCanvas(
          sourceImage.imgElement,
          cropRect,
          clampedTarget.width,
          clampedTarget.height,
          canvas
        );

        // Encode canvas to actual format Blob
        const blob = await encodeCanvasToBlob(canvas, format, quality);

        // Ensure this result matches the latest attempt
        if (attempt !== encodeAttemptRef.current) {
          return;
        }

        // Clean previous blob URL
        if (activeBlobUrlRef.current) {
          URL.revokeObjectURL(activeBlobUrlRef.current);
          activeBlobUrlRef.current = null;
        }

        const newBlobUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = newBlobUrl;

        const calculatedMetrics = calculateCompressionMetrics(sourceImage.size, blob.size);

        setEncodedBlob(blob);
        setEncodedBlobUrl(newBlobUrl);
        setMetrics(calculatedMetrics);
        setStatus('ready');
        setStatusFeedback(`Encoded ${format.split('/')[1].toUpperCase()} (${formatBytes(blob.size)})`);
      } catch (err: any) {
        if (attempt !== encodeAttemptRef.current) return;
        setStatus('error');
        setErrorMessage(err?.message || 'The browser could not encode this image.');
        setStatusFeedback(`Encoding failed: ${err?.message || 'Check parameters'}`);
      }
    }, 60);

    return () => {
      if (encodeDebounceTimerRef.current) {
        clearTimeout(encodeDebounceTimerRef.current);
      }
    };
  }, [sourceImage, cropRect, targetWidth, targetHeight, format, quality]);

  /**
   * Deterministic safe filename calculation.
   */
  const computedFilename = generateDeterministicFilename({
    originalName: sourceImage?.name,
    targetWidth,
    targetHeight,
    format
  });

  /**
   * Triggers native download of the truthful encoded blob.
   */
  const handleDownload = () => {
    if (!encodedBlobUrl || !encodedBlob) return;
    playSuccessChime();
    setIsDownloading(true);

    const a = document.createElement('a');
    a.href = encodedBlobUrl;
    a.download = computedFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => setIsDownloading(false), 1200);
  };

  const selectedFormatOption = OUTPUT_FORMATS.find(f => f.id === format);

  return (
    <div
      className="h-full flex flex-col bg-[#ece9d8] font-tahoma text-xs overflow-hidden select-none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden Native File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        aria-label="Upload source image file"
        className="hidden"
      />

      {/* Top Banner / Truthful In-Browser Header */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white px-3 py-2 flex items-center justify-between border-b-2 border-gray-700 flex-wrap gap-2 shadow-sm shrink-0">
        <div className="flex items-center gap-2">
          <Crop size={15} className="text-cyan-400" />
          <span className="font-bold text-xs tracking-wide">PICFIT IMAGE STUDIO</span>
          <span className="text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-700 px-1.5 py-0.5 rounded">
            Client Utility
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-600 flex items-center gap-1 font-bold">
            <Shield size={11} /> Processed locally in this browser
          </span>
          {sourceImage && (
            <button
              onClick={handleReset}
              className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-2 py-0.5 rounded border border-gray-600 flex items-center gap-1 transition-colors"
              title="Clear source image"
            >
              <RotateCcw size={11} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Main Studio Body */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Sidebar: Controls & Inspector */}
        <div className="w-full md:w-80 bg-w95-gray border-r-2 border-gray-400 p-3 flex flex-col gap-3 overflow-y-auto shrink-0 shadow-inner">
          {/* Section 1: Source Image Info & Actions */}
          <div className="space-y-2">
            <div className="bg-[#000080] text-white px-2 py-1 font-bold text-xs flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ImageIcon size={13} className="text-cyan-300" />
                <span>SOURCE IMAGE</span>
              </div>
              <span className="text-[10px] font-mono bg-blue-900 px-1 rounded">
                {sourceImage ? formatBytes(sourceImage.size) : 'Empty'}
              </span>
            </div>

            {sourceImage ? (
              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-2 font-mono text-[11px] space-y-1">
                <div className="truncate font-bold text-gray-900" title={sourceImage.name}>
                  {sourceImage.name}
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Source Dims:</span>
                  <span className="font-bold text-blue-900">{sourceImage.width} × {sourceImage.height} px</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Aspect Ratio:</span>
                  <span>{formatAspectRatio(sourceImage.width, sourceImage.height)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Source Type:</span>
                  <span>{sourceImage.type}</span>
                </div>
                <div className="pt-1.5 flex gap-1.5">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-w95 flex-1 text-[11px] py-1"
                  >
                    Change File...
                  </button>
                  <button
                    onClick={handleReset}
                    className="btn-w95 text-[11px] py-1 text-red-700"
                    title="Remove image"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-w95 btn-w95-primary w-full py-2 flex items-center justify-center gap-1.5 text-white"
                >
                  <Upload size={13} />
                  <span>Choose Image File...</span>
                </button>
                <button
                  onClick={handleLoadSample}
                  className="btn-w95 w-full py-1.5 text-xs flex items-center justify-center gap-1.5"
                >
                  <Sparkles size={13} className="text-blue-700" />
                  <span>Load Calibration Sample</span>
                </button>
              </div>
            )}
          </div>

          {/* Section 2: Crop & Framing Controls */}
          <div className="space-y-2">
            <div className="bg-[#000080] text-white px-2 py-1 font-bold text-xs flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Crop size={13} className="text-cyan-300" />
                <span>CROP &amp; FRAMING</span>
              </div>
              <span className="text-[10px] font-mono bg-blue-900 px-1 rounded">
                {cropRect.width} × {cropRect.height}
              </span>
            </div>

            {/* Aspect Ratio Presets */}
            <div>
              <label className="block text-gray-700 font-bold mb-1">Aspect Ratio Preset</label>
              <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                {ASPECT_RATIO_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => handleAspectPresetChange(preset.id)}
                    disabled={!sourceImage}
                    title={preset.description}
                      aria-pressed={aspectPreset === preset.id}
                      className={`p-1 text-center border truncate ${
                      aspectPreset === preset.id
                        ? 'bg-blue-100 border-2 border-t-black border-l-black border-b-white border-r-white font-bold text-blue-950'
                        : 'bg-w95-gray border-t-white border-l-white border-b-black border-r-black hover:bg-gray-200'
                    } ${!sourceImage ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Framing Alignment */}
            <div>
              <label className="block text-gray-700 font-bold mb-1">Framing Alignment</label>
              <div className="grid grid-cols-2 gap-1 font-mono text-[10px]">
                <div className="flex border border-gray-400">
                  {(['left', 'center', 'right'] as AlignX[]).map(x => (
                    <button
                      key={x}
                      onClick={() => handleFramingAlignChange(x, alignY)}
                      disabled={!sourceImage}
                      aria-pressed={alignX === x}
                      className={`flex-1 py-0.5 text-center capitalize ${
                        alignX === x ? 'bg-blue-900 text-white font-bold' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                      }`}
                    >
                      {x}
                    </button>
                  ))}
                </div>
                <div className="flex border border-gray-400">
                  {(['top', 'center', 'bottom'] as AlignY[]).map(y => (
                    <button
                      key={y}
                      onClick={() => handleFramingAlignChange(alignX, y)}
                      disabled={!sourceImage}
                      aria-pressed={alignY === y}
                      className={`flex-1 py-0.5 text-center capitalize ${
                        alignY === y ? 'bg-blue-900 text-white font-bold' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                      }`}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Crop Coverage / Scale */}
            <div>
              <div className="flex justify-between text-gray-700 font-bold mb-0.5">
                <label htmlFor={coverageInputId}>Crop Coverage</label>
                <span className="font-mono text-blue-900">{`${coveragePercent}%`}</span>
              </div>
              <input
                id={coverageInputId}
                type="range"
                min="20"
                max="100"
                value={coveragePercent}
                onChange={e => handleCoverageChange(Number(e.target.value))}
                disabled={!sourceImage}
                aria-label="Crop frame coverage percentage"
                className="w-full accent-blue-900 cursor-pointer h-1.5 bg-gray-300 rounded"
              />
            </div>
          </div>

          {/* Section 3: Resize & Target Dimensions */}
          <div className="space-y-2">
            <div className="bg-[#000080] text-white px-2 py-1 font-bold text-xs flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Maximize2 size={13} className="text-cyan-300" />
                <span>RESIZE &amp; DIMENSIONS</span>
              </div>
              <button
                onClick={() => {
                  playClickSound();
                  setLockAspect(prev => !prev);
                }}
                aria-pressed={lockAspect}
                className="flex items-center gap-1 text-[10px] font-mono text-cyan-200 hover:text-white"
                title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
              >
                {lockAspect ? <Lock size={10} /> : <Unlock size={10} />}
                <span>{lockAspect ? 'Locked' : 'Unlocked'}</span>
              </button>
            </div>

            {/* Width & Height Inputs */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={widthInputId} className="block text-gray-700 font-bold mb-0.5">
                  Width (px)
                </label>
                <input
                  id={widthInputId}
                  type="number"
                  min="1"
                  max="8192"
                  value={targetWidth}
                  onChange={e => handleWidthChange(parseInt(e.target.value, 10) || 1)}
                  disabled={!sourceImage}
                  className="w-full px-2 py-1 border-2 border-t-black border-l-black border-b-white border-r-white bg-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-800"
                />
              </div>
              <div>
                <label htmlFor={heightInputId} className="block text-gray-700 font-bold mb-0.5">
                  Height (px)
                </label>
                <input
                  id={heightInputId}
                  type="number"
                  min="1"
                  max="8192"
                  value={targetHeight}
                  onChange={e => handleHeightChange(parseInt(e.target.value, 10) || 1)}
                  disabled={!sourceImage}
                  className="w-full px-2 py-1 border-2 border-t-black border-l-black border-b-white border-r-white bg-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-800"
                />
              </div>
            </div>

            {/* Quick Scale Percentages */}
            <div className="flex gap-1 font-mono text-[10px]">
              {[1.0, 0.75, 0.5, 0.25].map(factor => (
                <button
                  key={factor}
                  onClick={() => handleApplyScalePercentage(factor)}
                  disabled={!sourceImage}
                  className="flex-1 py-0.5 text-center bg-gray-200 border border-gray-400 hover:bg-gray-300 disabled:opacity-50"
                >
                  {`${Math.round(factor * 100)}%`}
                </button>
              ))}
            </div>

            {/* Common Resolution Presets */}
            <div>
              <label className="block text-gray-700 font-bold mb-1">Standard Presets</label>
              <div className="grid grid-cols-3 gap-1 font-mono text-[9px]">
                {DIMENSION_PRESETS.slice(0, 6).map(dp => (
                  <button
                    key={dp.id}
                    onClick={() => handleApplyDimensionPreset(dp)}
                    disabled={!sourceImage}
                    className="p-1 text-center bg-gray-100 border border-gray-400 hover:bg-gray-200 truncate disabled:opacity-50"
                    title={`${dp.label} (${dp.width}×${dp.height})`}
                  >
                    {dp.width}×{dp.height}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 4: Output Format & Quality */}
          <div className="space-y-2">
            <div className="bg-[#000080] text-white px-2 py-1 font-bold text-xs flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sliders size={13} className="text-cyan-300" />
                <span>FORMAT &amp; QUALITY</span>
              </div>
              <span className="text-[10px] font-mono bg-blue-900 px-1 rounded">
                {selectedFormatOption?.ext}
              </span>
            </div>

            {/* Format Selection Buttons */}
            <div className="grid grid-cols-3 gap-1 font-mono text-xs">
              {OUTPUT_FORMATS.map(f => (
                <button
                  key={f.id}
                  onClick={() => {
                    playClickSound();
                    setFormat(f.id);
                  }}
                  aria-pressed={format === f.id}
                  className={`p-1.5 text-center border font-bold ${
                    format === f.id
                      ? 'bg-blue-900 text-white border-2 border-t-black border-l-black border-b-white border-r-white'
                      : 'bg-w95-gray border-t-white border-l-white border-b-black border-r-black hover:bg-gray-200 text-gray-800'
                  }`}
                >
                  {f.label.split(' ')[0]}
                </button>
              ))}
            </div>

            {/* Quality Slider (Meaningful only for JPEG & WebP) */}
            {selectedFormatOption?.hasQuality ? (
              <div>
                <div className="flex justify-between text-gray-700 font-bold mb-0.5">
                  <label htmlFor={qualityInputId}>Encoding Quality</label>
                  <span className="font-mono text-blue-900">{`${Math.round(quality * 100)}%`}</span>
                </div>
                <input
                  id={qualityInputId}
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={Math.round(quality * 100)}
                  onChange={e => setQuality(Number(e.target.value) / 100)}
                  aria-label="Image compression quality percentage"
                  className="w-full accent-blue-900 cursor-pointer h-1.5 bg-gray-300 rounded"
                />
                <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                  Lower quality produces smaller file sizes; higher quality preserves sharp textures.
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-300 p-1.5 font-mono text-[10px] text-gray-600 flex items-center gap-1.5">
                <Info size={13} className="text-blue-700 shrink-0" />
                <span>PNG is a lossless format. Quality compression slider is intentionally disabled.</span>
              </div>
            )}
          </div>

          {/* Section 5: Truthful Metrics & Export Button */}
          <div className="mt-auto pt-2 border-t border-gray-400 space-y-2">
            {sourceImage && metrics && (
              <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-2 font-mono text-[11px] space-y-1">
                <div className="flex justify-between text-gray-600">
                  <span>Source Size:</span>
                  <span>{formatBytes(metrics.originalBytes)}</span>
                </div>
                <div className="flex justify-between text-gray-900 font-bold">
                  <span>Encoded Size:</span>
                  <span className="text-emerald-700">{formatBytes(metrics.encodedBytes)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Size Change:</span>
                  <span className={metrics.isReduction ? 'text-emerald-700 font-bold' : 'text-amber-700'}>
                    {metrics.percentage > 0 ? `+${metrics.percentage}%` : `${metrics.percentage}%`}
                  </span>
                </div>
                <div className="pt-1 text-[10px] text-gray-500 truncate" title={computedFilename}>
                  Save as: <span className="text-gray-800 font-bold">{computedFilename}</span>
                </div>
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={!sourceImage || !encodedBlobUrl || status !== 'ready'}
              className="btn-w95 btn-w95-primary w-full py-2 font-bold text-xs flex items-center justify-center gap-1.5 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <>
                  <CheckCircle2 size={14} className="text-green-300" />
                  <span>Downloaded!</span>
                </>
              ) : (
                <>
                  <Download size={14} />
                  <span>Download Optimized Asset</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Viewport: Canvas Preview & Empty/Error HUD */}
        <div className="flex-1 bg-slate-950 p-4 flex flex-col items-center justify-center relative overflow-hidden">
          {/* Error HUD */}
          {status === 'error' && errorMessage && (
            <div role="alert" className="max-w-md bg-red-950 border-2 border-red-500 text-red-100 p-4 rounded-lg shadow-2xl space-y-3 font-tahoma">
              <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
                <AlertTriangle size={18} />
                <span>Image Validation Failed</span>
              </div>
              <p className="text-xs text-red-200 leading-relaxed">{errorMessage}</p>
              <div className="pt-2 flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-w95 bg-white text-gray-900 font-bold text-xs px-3 py-1"
                >
                  Choose Another Image
                </button>
                <button
                  onClick={handleReset}
                  className="btn-w95 text-xs px-3 py-1 text-gray-700"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Loading HUD */}
          {status === 'loading' && (
            <div className="text-center space-y-3 p-8">
              <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="font-mono text-cyan-300 text-xs font-bold tracking-wider">
                {statusFeedback}
              </div>
              <div className="text-slate-400 text-[11px]">
                Decoding and checking image dimensions in browser memory...
              </div>
            </div>
          )}

          {/* First-Run Empty State */}
          {status === 'empty' && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  fileInputRef.current?.click();
                }
              }}
              tabIndex={0}
              role="button"
              aria-label="Upload an image to start image fitting"
              className={`w-full max-w-xl aspect-[16/10] border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-cyan-400 bg-cyan-950/40 text-cyan-200 scale-[1.02]'
                  : 'border-slate-700 bg-slate-900/60 hover:border-slate-500 text-slate-300'
              }`}
            >
              <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mb-4 text-cyan-400 border border-slate-700 shadow-md">
                <Upload size={24} />
              </div>
              <h3 className="font-bold text-sm text-white mb-1">
                Drop your image here, or click to browse
              </h3>
              <p className="text-xs text-slate-400 mb-4 max-w-md">
                Crop, frame, resize, and convert images client-side. Supports JPEG, PNG, and WebP up to 25 MiB.
              </p>

              <div className="flex flex-wrap gap-2 justify-center mb-4" onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="btn-w95 text-xs py-1 px-3 flex items-center gap-1.5 bg-slate-200 text-slate-900"
                >
                  <Sparkles size={12} className="text-blue-700" />
                  <span>Load Calibration Sample</span>
                </button>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded font-mono text-[10px] text-slate-400 max-w-md space-y-1">
                <div className="flex items-center justify-center gap-1 text-emerald-400 font-bold">
                  <Shield size={11} /> Local browser processing
                </div>
                <div>This tool does not upload your image. Closing or clearing the studio discards it.</div>
              </div>
            </div>
          )}

          {/* Active Canvas Preview Viewport */}
          {sourceImage && status !== 'loading' && status !== 'error' && (
            <div className="w-full h-full flex flex-col items-center justify-center relative">
              {/* Preview Canvas Container */}
              <div className="relative max-w-full max-h-[calc(100%-48px)] flex items-center justify-center overflow-hidden p-2">
                <canvas
                  ref={canvasRef}
                  className={`max-w-full max-h-[70vh] object-contain shadow-2xl border-2 border-slate-700 rounded transition-transform ${
                    previewMode === 'actual' ? 'scale-100 overflow-auto' : ''
                  }`}
                  style={{
                    backgroundColor: '#0f172a',
                    backgroundImage: 'radial-gradient(#1e293b 1px, transparent 0)',
                    backgroundSize: '16px 16px'
                  }}
                  aria-label="Image preview canvas"
                />
              </div>

              {/* Viewport Floating Info Bar */}
              <div className="mt-2 bg-slate-900/90 backdrop-blur-md border border-slate-700 px-3 py-1.5 rounded-full font-mono text-[11px] text-slate-300 flex items-center gap-4 shadow-lg">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Output:</span>
                  <span className="text-cyan-300 font-bold">{targetWidth} × {targetHeight} px</span>
                </div>
                <div className="w-px h-3 bg-slate-700" />
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Format:</span>
                  <span className="text-emerald-400 font-bold uppercase">{format.split('/')[1]}</span>
                </div>
                <div className="w-px h-3 bg-slate-700" />
                <button
                  onClick={() => {
                    playClickSound();
                    setPreviewMode(prev => (prev === 'fit' ? 'actual' : 'fit'));
                  }}
                  className="text-[10px] text-cyan-300 hover:text-white px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 transition-colors"
                  title="Toggle preview zoom scale"
                >
                  {previewMode === 'fit' ? 'Fit View' : '100% Pixels'}
                </button>
                <div className="w-px h-3 bg-slate-700" />
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Status:</span>
                  <span className="text-slate-200">{statusFeedback}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Truthful Status Bar */}
      <div className="bg-[#ece9d8] border-t-2 border-white px-2 py-1 flex items-center justify-between text-[11px] font-mono text-gray-700 shrink-0">
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <span className={`w-2 h-2 rounded-full ${sourceImage ? 'bg-green-600' : 'bg-gray-400'}`} />
          <span>{statusFeedback}</span>
        </div>
        <div className="flex items-center gap-4 text-gray-600">
          <span>Mode: In-Memory Client Sandbox</span>
          <span>Storage: Ephemeral browser memory</span>
        </div>
      </div>
    </div>
  );
};
