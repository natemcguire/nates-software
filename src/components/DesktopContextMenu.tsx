import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  separatorAfter?: boolean;
  icon?: string;
}

interface DesktopContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * A Win95-style right-click context menu. Rendered as a fixed overlay at the
 * cursor, clamped to the viewport. Closes on outside click, Escape, scroll, or
 * resize. The desktop passes the item list (desktop actions vs. icon actions),
 * so this component stays presentational.
 */
export const DesktopContextMenu: React.FC<DesktopContextMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Ignore the pointer events belonging to the SAME right-click that opened
    // this menu (they arrive after mount and would otherwise self-close it).
    // A short arming delay + skipping the right mouse button handles both the
    // native contextmenu sequence and re-opening the menu on another spot.
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; }, 0);
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (!armed) return;
      // A right-click elsewhere should re-open (handled by the desktop), not just
      // close; a left-click / any click outside the menu closes it.
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      clearTimeout(armTimer);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Clamp so the menu never runs off-screen (approx sizes; good enough for w95).
  const MENU_W = 232;
  const itemH = 26;
  const menuH = items.length * itemH + 8;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const left = Math.min(x, vw - MENU_W - 4);
  const top = Math.min(y, vh - menuH - 44); // leave room above the taskbar

  return (
    <div
      ref={ref}
      className="fixed z-[70] bg-[#c0c0c0] border-2 shadow-[3px_3px_0_rgba(0,0,0,0.45)] py-1 font-tahoma text-xs select-none"
      style={{ left, top, width: MENU_W, borderColor: '#ffffff #404040 #404040 #ffffff' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <button
            type="button"
            disabled={it.disabled}
            onClick={() => { if (!it.disabled) { it.onClick?.(); onClose(); } }}
            className={`w-full text-left pl-4 pr-4 py-1 flex items-center gap-2.5 ${
              it.disabled
                ? 'text-gray-500 cursor-default'
                : 'text-black hover:bg-w95-blue hover:text-white cursor-pointer'
            }`}
          >
            {it.icon && <span className="w-4 text-center shrink-0">{it.icon}</span>}
            <span className="whitespace-nowrap">{it.label}</span>
          </button>
          {it.separatorAfter && <div className="border-t border-gray-500 border-b border-b-white my-1 mx-1.5" />}
        </React.Fragment>
      ))}
    </div>
  );
};
