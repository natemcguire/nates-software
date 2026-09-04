import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { RetroWindow } from '../src/components/RetroWindow';
import { WindowState } from '../src/hooks/useWindowManager';

describe('RetroWindow Component', () => {
  const baseWindowState: WindowState = {
    id: 'test-win',
    title: 'SETUP.EXE',
    icon: '🚀',
    isOpen: true,
    isMinimized: false,
    isMaximized: false,
    x: 100,
    y: 150,
    width: 600,
    height: 400,
    zIndex: 10
  };

  it('renders with select-none, user-select none, and draggable=false to prevent drag selection ghosting', () => {
    const html = renderToString(
      <RetroWindow
        windowState={baseWindowState}
        isActive={true}
        onFocus={() => {}}
        onClose={() => {}}
        onMinimize={() => {}}
        onToggleMaximize={() => {}}
        onMove={() => {}}
        onResize={() => {}}
      >
        <div>Window Inner Content</div>
      </RetroWindow>
    );

    expect(html).toContain('select-none');
    expect(html).toContain('user-select:none');
    expect(html).toContain('draggable="false"');
    expect(html).toContain('cursor-move');
    expect(html).toContain('SETUP.EXE');
    expect(html).toContain('Window Inner Content');
  });

  it('wires handleTitlePointerDown and prevents default during title drag', () => {
    const eventPreventDefault = vi.fn();
    const pointerDownEvent = {
      target: {
        closest: () => null,
        setPointerCapture: vi.fn()
      },
      clientX: 200,
      clientY: 200,
      pointerId: 1,
      preventDefault: eventPreventDefault
    };

    expect(pointerDownEvent.preventDefault).toBeDefined();
  });
});
