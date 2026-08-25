import React, { useState } from 'react';
import { useWindowManager } from './hooks/useWindowManager';
import { DesktopIcon } from './components/DesktopIcon';
import { RetroWindow } from './components/RetroWindow';
import { DesktopTaskbar } from './components/DesktopTaskbar';
import { StartMenu } from './components/StartMenu';

import { MarketingWindow } from './views/MarketingWindow';
import { HotwireView } from './views/HotwireView';
import { SlopshopView } from './views/SlopshopView';
import { InboxView } from './views/InboxView';
import { RigRuntimeView } from './views/RigRuntimeView';
import { WhitePapersView } from './views/WhitePapersView';
import { DynoView } from './views/DynoView';
import { ProfileView } from './views/ProfileView';

export function App() {
  const {
    windows,
    activeWindowId,
    openWindow,
    closeWindow,
    minimizeWindow,
    toggleMaximizeWindow,
    focusWindow,
    updateWindowPosition,
    updateWindowSize
  } = useWindowManager();

  const [startMenuOpen, setStartMenuOpen] = useState(false);

  // Desktop selection rubberband box
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  const handleDesktopPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.RetroWindow') || (e.target as HTMLElement).closest('.btn-w95')) return;
    setStartMenuOpen(false);
    setSelectionBox({
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY
    });
  };

  const handleDesktopPointerMove = (e: React.PointerEvent) => {
    if (!selectionBox) return;
    setSelectionBox(prev => prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null);
  };

  const handleDesktopPointerUp = () => {
    setSelectionBox(null);
  };

  const taskbarTabs = Object.values(windows)
    .filter(w => w.isOpen)
    .map(w => ({
      id: w.id,
      title: w.title.split('—')[0].trim(),
      icon: w.icon,
      isActive: activeWindowId === w.id && !w.isMinimized,
      onClick: () => {
        if (w.isMinimized || activeWindowId !== w.id) {
          focusWindow(w.id);
        } else {
          minimizeWindow(w.id);
        }
      }
    }));

  return (
    <div
      onPointerDown={handleDesktopPointerDown}
      onPointerMove={handleDesktopPointerMove}
      onPointerUp={handleDesktopPointerUp}
      className="h-screen w-screen bg-w95-teal flex flex-col justify-between overflow-hidden relative font-tahoma select-none"
    >
      {/* Desktop Selection Rubberband Box */}
      {selectionBox && (
        <div
          style={{
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY)
          }}
          className="absolute border border-dotted border-white bg-blue-500/20 z-0 pointer-events-none"
        />
      )}

      {/* Desktop Icons Grid */}
      <div className="p-4 grid grid-cols-6 gap-4 z-10 w-fit">
        <DesktopIcon
          icon="📄"
          label="README_FIRST.TXT (About Us)"
          onClick={() => openWindow('mktg')}
        />
        <DesktopIcon
          icon="🔥"
          label="HOTWIRE (Drops)"
          onClick={() => openWindow('hotwire')}
          badge="NEW"
        />
        <DesktopIcon
          icon="🛠️"
          label="SLOPSHOP (AI Mod)"
          onClick={() => openWindow('slopshop')}
        />
        <DesktopIcon
          icon="⚙️"
          label="RIG.EXE"
          onClick={() => openWindow('rig')}
        />
        <DesktopIcon
          icon="📬"
          label="INBOX (Mailbox)"
          onClick={() => openWindow('inbox')}
          badge="3"
        />
        <DesktopIcon
          icon="📖"
          label="WHITE_PAPERS.DOC"
          onClick={() => openWindow('papers')}
        />
        <DesktopIcon
          icon="🏎️"
          label="DYNO (Tuning)"
          onClick={() => openWindow('dyno')}
          badge="DYNO"
        />
        <DesktopIcon
          icon="👤"
          label="MY_PROFILE.CFG"
          onClick={() => openWindow('profile')}
        />
        <DesktopIcon
          icon="🗑️"
          label="Recycle Bin"
          onClick={() => alert("Recycle Bin is empty.")}
        />
      </div>

      {/* Floating, Draggable, Resizable Windows */}
      
      {/* 1. Marketing Window */}
      <RetroWindow
        windowState={windows.mktg}
        isActive={activeWindowId === 'mktg'}
        onFocus={() => focusWindow('mktg')}
        onClose={() => closeWindow('mktg')}
        onMinimize={() => minimizeWindow('mktg')}
        onToggleMaximize={() => toggleMaximizeWindow('mktg')}
        onMove={(x, y) => updateWindowPosition('mktg', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('mktg', w, h, x, y)}
      >
        <MarketingWindow
          onOpenHotwire={() => openWindow('hotwire')}
          onOpenSlopshop={() => openWindow('slopshop')}
          onOpenInbox={() => openWindow('inbox')}
          onOpenWhitepapers={() => openWindow('papers')}
          onDismiss={() => minimizeWindow('mktg')}
        />
      </RetroWindow>

      {/* 2. Hotwire Drops Window */}
      <RetroWindow
        windowState={windows.hotwire}
        isActive={activeWindowId === 'hotwire'}
        onFocus={() => focusWindow('hotwire')}
        onClose={() => closeWindow('hotwire')}
        onMinimize={() => minimizeWindow('hotwire')}
        onToggleMaximize={() => toggleMaximizeWindow('hotwire')}
        onMove={(x, y) => updateWindowPosition('hotwire', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('hotwire', w, h, x, y)}
      >
        <HotwireView />
      </RetroWindow>

      {/* 3. Slopshop AI Speed Shop Window */}
      <RetroWindow
        windowState={windows.slopshop}
        isActive={activeWindowId === 'slopshop'}
        onFocus={() => focusWindow('slopshop')}
        onClose={() => closeWindow('slopshop')}
        onMinimize={() => minimizeWindow('slopshop')}
        onToggleMaximize={() => toggleMaximizeWindow('slopshop')}
        onMove={(x, y) => updateWindowPosition('slopshop', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('slopshop', w, h, x, y)}
      >
        <SlopshopView />
      </RetroWindow>

      {/* 4. Inbox.EXE Window */}
      <RetroWindow
        windowState={windows.inbox}
        isActive={activeWindowId === 'inbox'}
        onFocus={() => focusWindow('inbox')}
        onClose={() => closeWindow('inbox')}
        onMinimize={() => minimizeWindow('inbox')}
        onToggleMaximize={() => toggleMaximizeWindow('inbox')}
        onMove={(x, y) => updateWindowPosition('inbox', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('inbox', w, h, x, y)}
      >
        <InboxView />
      </RetroWindow>

      {/* 5. RIG Runtime HUD Window */}
      <RetroWindow
        windowState={windows.rig}
        isActive={activeWindowId === 'rig'}
        onFocus={() => focusWindow('rig')}
        onClose={() => closeWindow('rig')}
        onMinimize={() => minimizeWindow('rig')}
        onToggleMaximize={() => toggleMaximizeWindow('rig')}
        onMove={(x, y) => updateWindowPosition('rig', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('rig', w, h, x, y)}
      >
        <RigRuntimeView />
      </RetroWindow>

      {/* 6. White Papers Reader Window */}
      <RetroWindow
        windowState={windows.papers}
        isActive={activeWindowId === 'papers'}
        onFocus={() => focusWindow('papers')}
        onClose={() => closeWindow('papers')}
        onMinimize={() => minimizeWindow('papers')}
        onToggleMaximize={() => toggleMaximizeWindow('papers')}
        onMove={(x, y) => updateWindowPosition('papers', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('papers', w, h, x, y)}
      >
        <WhitePapersView />
      </RetroWindow>

      {/* 7. Dyno Workstation Tuning Window */}
      <RetroWindow
        windowState={windows.dyno}
        isActive={activeWindowId === 'dyno'}
        onFocus={() => focusWindow('dyno')}
        onClose={() => closeWindow('dyno')}
        onMinimize={() => minimizeWindow('dyno')}
        onToggleMaximize={() => toggleMaximizeWindow('dyno')}
        onMove={(x, y) => updateWindowPosition('dyno', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('dyno', w, h, x, y)}
      >
        <DynoView />
      </RetroWindow>

      {/* 8. User Profile & Saved Shelf Window */}
      <RetroWindow
        windowState={windows.profile}
        isActive={activeWindowId === 'profile'}
        onFocus={() => focusWindow('profile')}
        onClose={() => closeWindow('profile')}
        onMinimize={() => minimizeWindow('profile')}
        onToggleMaximize={() => toggleMaximizeWindow('profile')}
        onMove={(x, y) => updateWindowPosition('profile', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('profile', w, h, x, y)}
      >
        <ProfileView />
      </RetroWindow>

      {/* Pop-Up Start Menu */}
      <StartMenu
        isOpen={startMenuOpen}
        onClose={() => setStartMenuOpen(false)}
        onOpenWindow={openWindow}
      />

      {/* Authentic Win95 Desktop Taskbar */}
      <DesktopTaskbar
        tabs={taskbarTabs}
        onStartClick={() => setStartMenuOpen(prev => !prev)}
      />
    </div>
  );
}

export default App;
