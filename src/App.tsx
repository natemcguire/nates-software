import { EphemeralLiveApp } from './components/EphemeralLiveApp';
import { INITIAL_APPS } from './data/mockData';
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
import { TerminalView } from './views/TerminalView';
import { playClickSound } from './lib/soundEngine';

export function App() {
  // Check if standalone app mode is requested via URL search or subdomain
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const requestedAppId = urlParams?.get('app') || (typeof window !== 'undefined' ? window.location.hostname.split('.')[0] : null);
  const standaloneApp = requestedAppId ? INITIAL_APPS.find(a => a.id === requestedAppId || a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === requestedAppId) : null;

  if (standaloneApp) {
    return (
      <div className="fixed inset-0 bg-[#ece9d8] flex flex-col font-tahoma text-xs overflow-hidden">
        {/* Retro Header Bar for Standalone App */}
        <div className="bg-w95-blue text-white p-2 flex items-center justify-between border-b-2 border-gray-800 select-none shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-base">{standaloneApp.creatorAvatar}</span>
            <span className="font-bold text-sm font-mono">{standaloneApp.name}</span>
            <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-[10px] font-bold font-mono">
              {standaloneApp.version}
            </span>
            <span className="text-gray-300 font-mono text-[11px]">
              https://{standaloneApp.id}.nates-software.pages.dev
            </span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/"
              className="btn-w95 text-xs py-1 px-3 font-bold text-black bg-gray-200 hover:bg-white"
            >
              ⚡ Return to Nate's Software Web OS
            </a>
          </div>
        </div>

        {/* Full Viewport App Body */}
        <div className="flex-1 overflow-auto p-2">
          <EphemeralLiveApp app={standaloneApp} />
        </div>
      </div>
    );
  }

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
  const [theme, setTheme] = useState<'teal' | 'matrix' | 'sunset' | 'navy'>('teal');

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
      title: w.title.split('—')[0]?.trim() || w.title,
      icon: w.icon,
      isActive: activeWindowId === w.id && !w.isMinimized,
      onClick: () => {
        if (activeWindowId === w.id && !w.isMinimized) {
          minimizeWindow(w.id);
        } else {
          openWindow(w.id);
        }
      }
    }));

  const bgStyles = {
    teal: 'bg-[#008080]',
    matrix: 'bg-[#0a140a]',
    sunset: 'bg-[#1a102f]',
    navy: 'bg-[#000033]'
  };

  return (
    <div
      onPointerDown={handleDesktopPointerDown}
      onPointerMove={handleDesktopPointerMove}
      onPointerUp={handleDesktopPointerUp}
      className={`fixed inset-0 select-none overflow-hidden pb-10 transition-colors duration-500 ${bgStyles[theme]}`}
      style={{
        backgroundImage: theme === 'teal' ? `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.03) 1px, transparent 1px)` : undefined,
        backgroundSize: '24px 24px'
      }}
    >
      {/* Rubberband Drag Selection Box */}
      {selectionBox && (
        <div
          style={{
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY)
          }}
          className="fixed border-2 border-dotted border-white/60 bg-blue-500/20 pointer-events-none z-30"
        />
      )}

      {/* Top Right Theme Selector */}
      <div className="absolute top-3 right-4 z-10 flex items-center gap-1 bg-black/40 backdrop-blur-sm p-1.5 rounded border border-white/20 text-white text-[11px] font-tahoma">
        <span className="text-gray-300 font-bold mr-1">Theme:</span>
        {[
          { id: 'teal', label: 'Teal 95' },
          { id: 'matrix', label: 'Matrix' },
          { id: 'sunset', label: 'Sunset' },
          { id: 'navy', label: 'DOS Navy' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { playClickSound(); setTheme(t.id as any); }}
            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              theme === t.id ? 'bg-w95-blue text-white shadow-sm border border-blue-400' : 'text-gray-300 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Desktop App Icons Grid */}
      <div className="absolute top-4 left-4 grid grid-flow-col grid-rows-7 gap-2 z-10">
        <DesktopIcon
          label="README_FIRST.TXT"
          icon="📄"
          onClick={() => { playClickSound(); openWindow('mktg'); }}
        />
        <DesktopIcon
          label="TERMINAL.EXE"
          icon="💻"
          onClick={() => { playClickSound(); openWindow('terminal'); }}
        />
        <DesktopIcon
          label="HOTWIRE (Drops)"
          icon="🔥"
          onClick={() => { playClickSound(); openWindow('hotwire'); }}
        />
        <DesktopIcon
          label="SLOPSHOP (AI Mod)"
          icon="🔧"
          onClick={() => { playClickSound(); openWindow('slopshop'); }}
        />
        <DesktopIcon
          label="RIG.EXE (Runtime)"
          icon="⚙️"
          onClick={() => { playClickSound(); openWindow('rig'); }}
        />
        <DesktopIcon
          label="INBOX (Proposals)"
          icon="📫"
          onClick={() => { playClickSound(); openWindow('inbox'); }}
        />
        <DesktopIcon
          label="DYNO (Speedometer)"
          icon="🏎️"
          onClick={() => { playClickSound(); openWindow('dyno'); }}
        />
        <DesktopIcon
          label="PROFILE.CFG (Shelf)"
          icon="👤"
          onClick={() => { playClickSound(); openWindow('profile'); }}
        />
        <DesktopIcon
          label="WHITE_PAPERS.DOC"
          icon="📖"
          onClick={() => { playClickSound(); openWindow('papers'); }}
        />
        <DesktopIcon
          label="Source on GitHub"
          icon="🌐"
          onClick={() => { playClickSound(); window.open('https://github.com/natemcguire/nates-software', '_blank'); }}
        />
      </div>

      {/* Floating Application Windows */}

      {/* 0. Marketing / About Readme */}
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
          onDismiss={() => closeWindow('mktg')}
        />
      </RetroWindow>

      {/* 1. Terminal DOS Shell */}
      <RetroWindow
        windowState={windows.terminal}
        isActive={activeWindowId === 'terminal'}
        onFocus={() => focusWindow('terminal')}
        onClose={() => closeWindow('terminal')}
        onMinimize={() => minimizeWindow('terminal')}
        onToggleMaximize={() => toggleMaximizeWindow('terminal')}
        onMove={(x, y) => updateWindowPosition('terminal', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('terminal', w, h, x, y)}
      >
        <TerminalView />
      </RetroWindow>

      {/* 2. Hotwire Drops */}
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

      {/* 3. Slopshop AI Speed Shop */}
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

      {/* 4. Rig.exe Runtime HUD */}
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

      {/* 5. Inbox Merge Discussions */}
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

      {/* 6. Dyno Workstation Speedometer */}
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

      {/* 7. Technical White Papers */}
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

      {/* 8. User Profile & My Shelf */}
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
