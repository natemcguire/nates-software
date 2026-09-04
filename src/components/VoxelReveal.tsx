import React, { useEffect, useRef, useState } from 'react';

interface VoxelRevealProps {
  glyph: string;
  size?: number;
  grid?: number;
  duration?: number;
  startDelayMs?: number;
  onDone?: () => void;
}

export const VoxelReveal: React.FC<VoxelRevealProps> = ({
  glyph,
  size = 64,
  grid = 12,
  duration = 3,
  startDelayMs = 0,
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
          let a = 0, r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { a += d[i + 3]; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
          const alpha = a / n;
          cellSolid.push(alpha > 40);
          cellColor.push(`rgba(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)},1)`);
        }
      }
    }

    const starts = cellSolid.map(() => Math.random() * 0.65);
    const cell = size / grid;
    const t0 = performance?.now?.() ?? 0;
    let raf = 0;

    if (reduced) { setDone(true); onDone?.(); return; }

    const frame = (now: number) => {
      const elapsed = now - t0 - startDelayMs;
      if (elapsed < 0) { raf = requestAnimationFrame(frame); return; }
      const t = Math.min(1, elapsed / (duration * 1000));
      ctx.clearRect(0, 0, size, size);
      for (let i = 0; i < cellSolid.length; i++) {
        if (!cellSolid[i]) continue;
        const local = (t - starts[i]) / (1 - starts[i]);
        if (local <= 0) continue;
        const p = Math.min(1, local);
        const gx = i % grid, gy = Math.floor(i / grid);
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
  }, [glyph, size, grid, duration, startDelayMs, onDone]);

  if (done) return null;
  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, imageRendering: 'pixelated', display: 'block' }}
      aria-hidden
    />
  );
};
