import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';

interface Win95ScrollProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const BAR = 17;
const ARROW = 17;

export const Win95Scroll: React.FC<Win95ScrollProps> = ({ children, className, style }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(null);

  const recompute = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    setMetrics({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
  }, []);

  useLayoutEffect(() => {
    recompute();
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [recompute, children]);

  const overflows = metrics.scrollHeight > metrics.clientHeight + 1;
  const trackHeight = Math.max(0, metrics.clientHeight - ARROW * 2);
  const ratio = metrics.scrollHeight > 0 ? metrics.clientHeight / metrics.scrollHeight : 1;
  const thumbHeight = Math.max(20, Math.round(trackHeight * ratio));
  const maxScroll = metrics.scrollHeight - metrics.clientHeight;
  const maxThumbTravel = trackHeight - thumbHeight;
  const thumbTop = maxScroll > 0 ? Math.round((metrics.scrollTop / maxScroll) * maxThumbTravel) : 0;

  const scrollByPx = (delta: number) => {
    const el = viewportRef.current;
    if (el) el.scrollTop += delta;
  };

  const onThumbDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startScrollTop: metrics.scrollTop };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      const el = viewportRef.current;
      if (!d || !el || maxThumbTravel <= 0) return;
      const deltaPx = e.clientY - d.startY;
      const deltaScroll = (deltaPx / maxThumbTravel) * maxScroll;
      el.scrollTop = d.startScrollTop + deltaScroll;
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [maxThumbTravel, maxScroll]);

  const onTrackClick = (e: React.MouseEvent, isAbove: boolean) => {
    e.preventDefault();
    scrollByPx((isAbove ? -1 : 1) * metrics.clientHeight * 0.9);
  };

  const arrowBtn = 'w-full flex items-center justify-center bg-w95-gray active:bg-gray-300 select-none';
  const arrowStyle: React.CSSProperties = {
    height: ARROW,
    border: '1px solid #000',
    boxShadow: 'inset 1px 1px #fff, inset -1px -1px #808080',
  };

  return (
    <div className={`relative ${className || ''}`} style={style}>
      <div
        ref={viewportRef}
        onScroll={recompute}
        className="absolute inset-0 nsw-no-scrollbar overflow-y-auto overflow-x-hidden"
        style={{ right: overflows ? BAR : 0 }}
      >
        {children}
      </div>

      {overflows && (
        <div
          className="absolute top-0 bottom-0 right-0 flex flex-col"
          style={{ width: BAR, background: '#fff' }}
        >
          <button type="button" aria-label="Scroll up" className={arrowBtn} style={arrowStyle} onClick={() => scrollByPx(-48)}>
            <svg width="8" height="8" viewBox="0 0 8 8"><path d="M4 1 L7 6 L1 6 Z" fill="#000" /></svg>
          </button>

          <div
            className="relative flex-1"
            style={{
              backgroundColor: '#fff',
              backgroundImage: 'repeating-linear-gradient(45deg, #000 0, #000 0.5px, transparent 0.5px, transparent 3px)',
              borderLeft: '1px solid #000',
              borderRight: '1px solid #000',
            }}
          >
            <div className="absolute inset-0" onMouseDown={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              onTrackClick(e, e.clientY - rect.top < thumbTop);
            }} />
            <div
              onMouseDown={onThumbDown}
              className="absolute left-0 right-0 cursor-default"
              style={{
                top: thumbTop,
                height: thumbHeight,
                background: '#fff',
                border: '1px solid #000',
                boxShadow: 'inset 1px 1px #fff, inset -1px -1px #808080',
              }}
            />
          </div>

          <button type="button" aria-label="Scroll down" className={arrowBtn} style={arrowStyle} onClick={() => scrollByPx(48)}>
            <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 2 L7 2 L4 7 Z" fill="#000" /></svg>
          </button>
        </div>
      )}
    </div>
  );
};
