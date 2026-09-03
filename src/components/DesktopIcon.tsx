import React, { useState, useRef, useEffect } from 'react';

export interface DesktopIconProps {
  id?: string;
  icon: string;
  label: string;
  onClick: () => void;
  badge?: string;
  position?: { x: number; y: number };
  onPositionChange?: (newPos: { x: number; y: number }) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onOpen?: () => void;
  /** Intro-sequence class (hidden / reveal) applied to the icon root. */
  introClassName?: string;
  /** Per-icon stagger delay (ms) for the reveal animation. */
  introDelayMs?: number;
}

const DRAG_THRESHOLD = 5; // Pixels of movement required to distinguish dragging from a click

export const DesktopIcon: React.FC<DesktopIconProps> = ({
  icon,
  label,
  onClick,
  badge,
  position,
  onPositionChange,
  onContextMenu,
  introClassName,
  introDelayMs
}) => {
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number }>(position || { x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    hasMoved: boolean;
  } | null>(null);

  const posRef = useRef(currentPos);
  posRef.current = currentPos;

  useEffect(() => {
    if (position) {
      setCurrentPos(position);
    }
  }, [position?.x, position?.y]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only drag on primary mouse button / touch
    e.stopPropagation();

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: posRef.current.x,
      initialY: posRef.current.y,
      hasMoved: false
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if setPointerCapture is unsupported
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    if (!dragRef.current.hasMoved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragRef.current.hasMoved = true;
      setIsDragging(true);
    }

    if (dragRef.current.hasMoved) {
      const screenW = typeof window !== 'undefined' ? window.innerWidth : 1440;
      const screenH = typeof window !== 'undefined' ? window.innerHeight : 900;
      const iconWidth = 112; // w-28 = 112px
      const iconHeight = 90;
      const taskbarHeight = 40;

      const rawX = dragRef.current.initialX + dx;
      const rawY = dragRef.current.initialY + dy;

      const constrainedX = Math.max(0, Math.min(rawX, screenW - iconWidth));
      const constrainedY = Math.max(0, Math.min(rawY, screenH - taskbarHeight - iconHeight));

      setCurrentPos({ x: constrainedX, y: constrainedY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();

    const moved = dragRef.current.hasMoved;
    const finalPos = posRef.current;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    dragRef.current = null;
    setIsDragging(false);

    if (moved) {
      onPositionChange?.(finalPos);
    } else {
      onClick();
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    dragRef.current = null;
    setIsDragging(false);
  };

  const style: React.CSSProperties = position
    ? {
        position: 'absolute',
        left: `${currentPos.x}px`,
        top: `${currentPos.y}px`,
        zIndex: isDragging ? 35 : 10,
        touchAction: 'none',
        ...(introDelayMs !== undefined ? ({ '--reveal-delay': `${introDelayMs}ms` } as React.CSSProperties) : {})
      }
    : { touchAction: 'none' };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={onContextMenu}
      style={style}
      className={`desktop-icon group flex flex-col items-center justify-center p-2.5 rounded cursor-pointer select-none text-center hover:bg-blue-900/50 border border-transparent hover:border-yellow-200/60 w-28 relative ${
        isDragging ? 'opacity-90 ring-1 ring-yellow-300/70' : ''
      } ${introClassName || ''}`}
    >
      <div className="text-5xl filter drop-shadow-md group-hover:scale-105 transition-transform mb-1">
        {icon}
      </div>
      <div
        className="text-white text-xs font-bold text-shadow px-1 py-0.5 rounded line-clamp-2 leading-snug w-full max-w-full break-words hyphens-auto"
        style={{ overflowWrap: 'anywhere' }}
      >
        {label}
      </div>
      {badge && (
        <span className="absolute top-1 right-2 bg-red-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full border border-white shadow">
          {badge}
        </span>
      )}
    </div>
  );
};
