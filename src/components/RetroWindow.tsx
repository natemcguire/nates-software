import React, { useRef, useCallback, useEffect } from 'react';
import { X, Minus, Square, Copy } from 'lucide-react';
import { WindowState } from '../hooks/useWindowManager';

interface RetroWindowProps {
  windowState: WindowState;
  isActive: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number, x?: number, y?: number) => void;
  children: React.ReactNode;
}

export const RetroWindow: React.FC<RetroWindowProps> = ({
  windowState,
  isActive,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onMove,
  onResize,
  children
}) => {
  const windowRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const isResizing = useRef<string | null>(null);
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0, windowX: 0, windowY: 0 });

  const handleTitlePointerDown = useCallback((e: React.PointerEvent) => {
    if (windowState.isMaximized) return;
    if ((e.target as HTMLElement).closest('button')) return;

    e.preventDefault();
    if (typeof window !== 'undefined' && window.getSelection) {
      window.getSelection()?.removeAllRanges();
    }
    onFocus();
    isDragging.current = true;
    dragOffset.current = {
      x: e.clientX - windowState.x,
      y: e.clientY - windowState.y
    };
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  }, [windowState.isMaximized, windowState.x, windowState.y, onFocus]);

  const handleTitlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    e.preventDefault();
    const nextX = e.clientX - dragOffset.current.x;
    const nextY = e.clientY - dragOffset.current.y;
    onMove(nextX, nextY);
  }, [onMove]);

  const handleTitlePointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  }, []);

  const startResize = (handle: string, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (windowState.isMaximized) return;
    onFocus();
    isResizing.current = handle;
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: windowState.width,
      height: windowState.height,
      windowX: windowState.x,
      windowY: windowState.y
    };
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleResizePointerMove = useCallback((e: PointerEvent) => {
    if (!isResizing.current) return;
    const handle = isResizing.current;
    const dx = e.clientX - resizeStart.current.x;
    const dy = e.clientY - resizeStart.current.y;

    let newWidth = resizeStart.current.width;
    let newHeight = resizeStart.current.height;
    let newX = resizeStart.current.windowX;
    let newY = resizeStart.current.windowY;

    if (handle.includes('e')) newWidth += dx;
    if (handle.includes('s')) newHeight += dy;
    if (handle.includes('w')) {
      newWidth -= dx;
      newX += dx;
    }
    if (handle.includes('n')) {
      newHeight -= dy;
      newY += dy;
    }

    onResize(newWidth, newHeight, newX, newY);
  }, [onResize]);

  const handleResizePointerUp = useCallback(() => {
    isResizing.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', handleResizePointerMove);
    window.addEventListener('pointerup', handleResizePointerUp);
    return () => {
      window.removeEventListener('pointermove', handleResizePointerMove);
      window.removeEventListener('pointerup', handleResizePointerUp);
    };
  }, [handleResizePointerMove, handleResizePointerUp]);

  if (!windowState.isOpen || windowState.isMinimized) return null;

  return (
    <div
      ref={windowRef}
      onPointerDown={onFocus}
      draggable={false}
      style={{
        zIndex: windowState.zIndex,
        left: windowState.isMaximized ? 0 : windowState.x,
        top: windowState.isMaximized ? 0 : windowState.y,
        width: windowState.isMaximized ? '100vw' : windowState.width,
        height: windowState.isMaximized ? 'calc(100vh - 44px)' : windowState.height,
        position: 'absolute',
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }}
      className="bg-w95-panel w95-border w95-shadow flex flex-col select-none"
    >
      {/* Title Bar */}
      <div
        draggable={false}
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handleTitlePointerMove}
        onPointerUp={handleTitlePointerUp}
        onDoubleClick={onToggleMaximize}
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none'
        }}
        className={`px-3 py-1.5 flex items-center justify-between font-tahoma text-sm font-bold cursor-move select-none ${
          isActive
            ? 'bg-gradient-to-r from-[#000080] via-[#1084d0] to-[#000080] text-white'
            : 'bg-gradient-to-r from-[#808080] to-[#a0a0a0] text-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 truncate text-[14px] select-none pointer-events-none">
          <span>{windowState.icon}</span>
          <span className="truncate">{windowState.title}</span>
        </div>

        {/* Window Control Buttons */}
        <div className="flex items-center gap-1.5 shrink-0 ml-2 select-none">
          <button
            type="button"
            draggable={false}
            onClick={(e) => { e.stopPropagation(); onMinimize(); }}
            className="w-5 h-5 bg-w95-gray w95-border flex items-center justify-center text-black hover:bg-white active:translate-x-0.5 text-xs font-bold select-none outline-none focus:outline-none"
            title="Minimize"
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            draggable={false}
            onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }}
            className="w-5 h-5 bg-w95-gray w95-border flex items-center justify-center text-black hover:bg-white active:translate-x-0.5 text-xs font-bold select-none outline-none focus:outline-none"
            title={windowState.isMaximized ? "Restore" : "Maximize"}
          >
            {windowState.isMaximized ? <Copy size={10} /> : <Square size={10} />}
          </button>
          <button
            type="button"
            draggable={false}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="w-5 h-5 bg-w95-gray w95-border flex items-center justify-center text-black hover:bg-red-700 hover:text-white active:translate-x-0.5 text-xs font-bold select-none outline-none focus:outline-none"
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Body Content */}
      <div
        className="flex-1 overflow-hidden p-3 flex flex-col bg-[#ece9d8]"
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none'
        }}
      >
        {children}
      </div>

      {/* Resize Handles */}
      {!windowState.isMaximized && (
        <>
          <div onPointerDown={(e) => startResize('n', e)} className="absolute top-0 left-2 right-2 h-2 cursor-n-resize select-none" />
          <div onPointerDown={(e) => startResize('s', e)} className="absolute bottom-0 left-2 right-2 h-2 cursor-s-resize select-none" />
          <div onPointerDown={(e) => startResize('e', e)} className="absolute top-2 bottom-2 right-0 w-2 cursor-e-resize select-none" />
          <div onPointerDown={(e) => startResize('w', e)} className="absolute top-2 bottom-2 left-0 w-2 cursor-w-resize select-none" />
          
          <div onPointerDown={(e) => startResize('nw', e)} className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize select-none" />
          <div onPointerDown={(e) => startResize('ne', e)} className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize select-none" />
          <div onPointerDown={(e) => startResize('sw', e)} className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize select-none" />
          <div onPointerDown={(e) => startResize('se', e)} className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 select-none">
            <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-gray-600 opacity-75" />
          </div>
        </>
      )}
    </div>
  );
};
