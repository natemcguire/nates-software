import React, { useEffect, useState } from 'react';
import { playClickSound } from '../lib/soundEngine';

const STORAGE_KEY = 'nsw_font_scale';

interface Step {
  id: string;
  scale: number;
  label: string;
  sizePx: number;
  title: string;
}

const STEPS: Step[] = [
  { id: 'medium', scale: 1.0, label: 'T', sizePx: 11, title: 'Text size: Medium (default)' },
  { id: 'large', scale: 1.15, label: 'T', sizePx: 14, title: 'Text size: Large' },
  { id: 'xlarge', scale: 1.3, label: 'T', sizePx: 17, title: 'Text size: Extra Large' }
];

export function readInitialFontScale(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseFloat(raw) : NaN;
    if (Number.isFinite(n) && STEPS.some((s) => Math.abs(s.scale - n) < 0.001)) return n;
  } catch {
  }
  return 1.0;
}

function applyFontScale(scale: number) {
  try {
    document.documentElement.style.setProperty('--font-scale', String(scale));
  } catch {
  }
}

export const FontSizer: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [scale, setScale] = useState<number>(() => readInitialFontScale());

  useEffect(() => {
    applyFontScale(scale);
  }, [scale]);

  const pick = (next: number) => {
    playClickSound();
    setScale(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {

    }
  };

  return (
    <div
      data-testid="font-sizer"
      className={`flex items-center gap-1 bg-[#c0c0c0] p-1 border-2 border-white border-r-gray-800 border-b-gray-800 text-black text-[11px] font-tahoma ${className}`}
      title="Text size"
    >
      <span className="text-black font-bold mr-1">Text:</span>
      {STEPS.map((s) => {
        const active = Math.abs(s.scale - scale) < 0.001;
        return (
          <button
            key={s.id}
            type="button"
            data-testid={`font-sizer-${s.id}`}
            aria-pressed={active}
            onClick={() => pick(s.scale)}
            title={s.title}
            style={{ fontSize: `${s.sizePx}px`, lineHeight: 1 }}
            className={`px-2 py-0.5 font-bold font-serif border-2 leading-none ${
              active
                ? 'bg-gray-200 text-blue-900 border-gray-800 border-r-white border-b-white'
                : 'bg-[#c0c0c0] text-black border-white border-r-gray-800 border-b-gray-800 hover:bg-gray-100'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
};
