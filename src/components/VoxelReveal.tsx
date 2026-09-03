import React, { useEffect, useRef, useState } from 'react';

interface VoxelRevealProps {
  /** The emoji glyph to render as assembling voxels. */
  glyph: string;
  /** Pixel size of the square canvas (matches the icon glyph box, ~64). */
  size?: number;
  /** How many blocks across/down (lower = chunkier voxels). */
  grid?: number;
  /** Seconds the assembly takes. */
  duration?: number;
  /** Fires once the reveal finishes so the parent can swap to the real glyph. */
  onDone?: () => void;
}

/**
 * Real canvas voxel reveal: rasterizes the emoji, then materializes it as a grid
 * of chunky blocks that pop in over `duration` — each block fades + drops into
 * place on its own randomized delay, so the icon assembles out of voxels rather
 * than fading uniformly. Uses requestAnimationFrame; honors reduced-motion.
 */
export const VoxelReveal: React.FC<VoxelRevealProps> = ({
  glyph,
  size = 64,
  grid = 12,
  duration = 3,
  onDone,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setDone(true); onDone?.(); return; }
    ctx.scale(dpr, dpr);

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // 1) Rasterize the emoji onto an offscreen buffer, then read which grid cells
    //    are "solid" (non-transparent) so empty cells never get a block.
    const buf = document.createElement('canvas');
    buf.width = size; buf.height = size;
    const bctx = buf.getContext('2d');
    let cellSolid: boolean[] = [];
    let cellColor: string[] = [];
    if (bctx) {
      bctx.textAlign = 'center';
      bctx.textBaseline = 'middle';
      bctx.font = `${Math.floor(size * 0.82)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      bctx.fillText(glyph, size / 2, size / 2 + size * 0.04);
      const cell = size / grid;
      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          const d = bctx.getImageData(gx * cell, gy * cell, Math.ceil(cell), Math.ceil(cell)).data;
          // average alpha + colour over the cell
          let a = 0, r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { a += d[i + 3]; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
          const alpha = a / n;
          cellSolid.push(alpha > 40);
          cellColor.push(`rgba(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)},1)`);
        }
      }
    }

    // 2) Per-block randomized start time within the duration.
    const starts = cellSolid.map(() => Math.random() * 0.65); // fraction of duration
    const cell = size / grid;
    const t0 = performance?.now?.() ?? 0;
    let raf = 0;

    if (reduced) { setDone(true); onDone?.(); return; }

    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / (duration * 1000));
      ctx.clearRect(0, 0, size, size);
      for (let i = 0; i < cellSolid.length; i++) {
        if (!cellSolid[i]) continue;
        const local = (t - starts[i]) / (1 - starts[i]); // 0..1 for this block
        if (local <= 0) continue;
        const p = Math.min(1, local);
        const gx = i % grid, gy = Math.floor(i / grid);
        // block drops in from slightly above + scales up + fades in, hard-edged.
        const drop = (1 - p) * cell * 1.2;
        const inset = (1 - p) * cell * 0.35;
        ctx.globalAlpha = p;
        ctx.fillStyle = cellColor[i];
        ctx.fillRect(gx * cell + inset, gy * cell - drop + inset, cell - inset * 2, cell - inset * 2);
      }
      ctx.globalAlpha = 1;
      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        setDone(true);
        onDone?.();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [glyph, size, grid, duration, onDone]);

  // Once done, render nothing (parent shows the real DOM glyph).
  if (done) return null;
  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, imageRendering: 'pixelated', display: 'block' }}
      aria-hidden
    />
  );
};
