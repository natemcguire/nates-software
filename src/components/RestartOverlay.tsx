import React, { useEffect, useState } from 'react';

const LINES = [
  'NATE-BIOS (C) 1995 East Bay Projects',
  '',
  'Detecting memory ................. 640K OK',
  'Detecting extended memory ........ 65535K OK',
  'Mounting /data (WASM SQLite) ..... OK',
  'Loading NATE\'S 95 desktop ........ OK',
  '',
  'Starting Nate\'s Software 95 ...',
];

export const RestartOverlay: React.FC = () => {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      const t = setTimeout(() => window.location.reload(), 250);
      return () => clearTimeout(t);
    }

    const perLine = 150;
    const timers: any[] = [];
    LINES.forEach((_, i) => {
      timers.push(setTimeout(() => setShown(i + 1), i * perLine));
    });
    timers.push(setTimeout(() => window.location.reload(), LINES.length * perLine + 500));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div
      role="status"
      aria-label="Restarting desktop"
      className="fixed inset-0 z-[9999] bg-black text-[#35d15b] font-mono text-sm p-6 overflow-hidden"
      style={{ fontFamily: 'ui-monospace, "Courier New", monospace' }}
    >
      <div className="max-w-2xl">
        {LINES.slice(0, shown).map((line, i) => (
          <div key={i} className="leading-relaxed whitespace-pre">
            {line || ' '}
          </div>
        ))}
        {shown >= LINES.length && (
          <span className="inline-block w-2.5 h-4 bg-[#35d15b] align-middle animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  );
};
