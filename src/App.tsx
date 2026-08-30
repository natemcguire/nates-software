import { CatalogProvider, useCatalog } from './context/CatalogContext';
import { AuthProvider } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { ErrorBoundary } from './components/ErrorBoundary';
export interface ResolvedRoute {
  readonly type: 'standalone_app' | 'standalone_view' | 'desktop';
  readonly id?: string;
  readonly title?: string;
}

export function resolveAppRoute(
  hostname: string = '',
  pathname: string = '',
  viewQuery: string = '',
  appIdQuery: string | null = null
): ResolvedRoute {
  const requestedAppId = appIdQuery || (hostname ? hostname.split('.')[0] : null);
  const standaloneApp = requestedAppId ? INITIAL_APPS.find(a => a.id === requestedAppId || a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === requestedAppId) : null;

  if (standaloneApp && !['gitsmith', 'git', 'hotwire', 'slopshop', 'rig', 'inbox', 'dyno', 'profile', 'whitepapers', 'terminal', 'editorial', 'lab', 'www', 'nates-software'].includes(requestedAppId || '')) {
    return { type: 'standalone_app', id: standaloneApp.id, title: standaloneApp.name };
  }

  if (hostname.startsWith('chat.') || pathname.startsWith('/chat') || pathname.startsWith('/irc') || pathname.startsWith('/lounge') || viewQuery === 'chat') {
    return { type: 'standalone_view', id: 'chat', title: 'CHAT IRC CHATROOM (#lounge)' };
  }

  if (hostname.startsWith('gitsmith.') || hostname.startsWith('git.') || pathname.startsWith('/gitsmith') || pathname.startsWith('/forge') || viewQuery === 'gitsmith') {
    return { type: 'standalone_view', id: 'gitsmith', title: 'GITSMITH FORGE' };
  }

  if (hostname.startsWith('hotwire.') || pathname.startsWith('/hotwire') || pathname.startsWith('/drops') || viewQuery === 'hotwire') {
    return { type: 'standalone_view', id: 'hotwire', title: 'HOTWIRE DAILY DROPS' };
  }

  if (hostname.startsWith('editorial.') || hostname.startsWith('lab.') || pathname.startsWith('/editorial') || pathname.startsWith('/lab') || pathname.startsWith('/reviews') || viewQuery === 'editorial' || viewQuery === 'lab') {
    return { type: 'standalone_view', id: 'editorial', title: "EDITORIAL LAB — NATE'S SOFTWARE & BENCHMARK REVIEWS" };
  }

  if (hostname.startsWith('slopshop.') || pathname.startsWith('/slopshop') || pathname.startsWith('/speedshop') || viewQuery === 'slopshop') {
    return { type: 'standalone_view', id: 'slopshop', title: 'SLOPSHOP LOCAL AI AGENT LAUNCHPAD' };
  }

  if (hostname.startsWith('rig.') || pathname.startsWith('/rig') || pathname.startsWith('/runtime') || viewQuery === 'rig') {
    return { type: 'standalone_view', id: 'rig', title: 'RIG.EXE MICRO-CONTAINER & STORAGE HUD' };
  }

  if (hostname.startsWith('inbox.') || pathname.startsWith('/inbox') || viewQuery === 'inbox') {
    return { type: 'standalone_view', id: 'inbox', title: 'INBOX PROPOSALS' };
  }

  if (pathname.startsWith('/white-papers') || pathname.startsWith('/whitepapers') || pathname.startsWith('/docs') || viewQuery === 'white-papers' || viewQuery === 'papers') {
    return { type: 'standalone_view', id: 'white-papers', title: 'ARCHITECTURAL WHITE PAPERS' };
  }

  if (pathname.startsWith('/dyno') || pathname.startsWith('/speedometer') || viewQuery === 'dyno') {
    return { type: 'standalone_view', id: 'dyno', title: 'DYNO AI DEVELOPER BENCHMARK (Model + Harness + Tools)' };
  }

  if (pathname.startsWith('/profile') || pathname.startsWith('/shelf') || viewQuery === 'profile') {
    return { type: 'standalone_view', id: 'profile', title: 'MAKER PROFILE & DISK SHELF' };
  }

  if (pathname.startsWith('/terminal') || pathname.startsWith('/shell') || pathname.startsWith('/dos') || viewQuery === 'terminal') {
    return { type: 'standalone_view', id: 'terminal', title: 'TERMINAL.EXE INTERACTIVE DOS SHELL' };
  }

  return { type: 'desktop' };
}

import React, { useState } from 'react';
import { GitsmithView } from './views/GitsmithView';
import { EphemeralLiveApp } from './components/EphemeralLiveApp';
import { INITIAL_APPS, AppListing } from './data/mockData';
import { useWindowManager } from './hooks/useWindowManager';
import { DesktopIcon } from './components/DesktopIcon';
import { RetroWindow } from './components/RetroWindow';
import { DesktopTaskbar } from './components/DesktopTaskbar';
import { StartMenu } from './components/StartMenu';

import { SetupWizardView } from './views/SetupWizardView';
import { MarketingWindow } from './views/MarketingWindow';
import { EditorialView } from './views/EditorialView';
import { PostEditorView } from './views/PostEditorView';
import { HotwireView } from './views/HotwireView';
import { SlopshopView } from './views/SlopshopView';
import { InboxView } from './views/InboxView';
import { RigRuntimeView } from './views/RigRuntimeView';
import { WhitePapersView } from './views/WhitePapersView';
import { DynoView } from './views/DynoView';
import { ProfileView } from './views/ProfileView';
import { TerminalView } from './views/TerminalView';
import { ChatView } from './views/ChatView';
import { playClickSound, playSuccessChime } from './lib/soundEngine';
import { useAlert } from './context/AlertContext';

function AppInner() {
  const { getApp, submitDrop } = useCatalog();
  const { showAlert } = useAlert();
  const [editingApp, setEditingApp] = useState<AppListing | null>(null);
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const viewQuery = urlParams?.get('view') || '';

  const route = resolveAppRoute(hostname, pathname, viewQuery, urlParams?.get('app') || null);

  if (route.type === 'standalone_app' && route.id) {
    const resolvedApp = getApp(route.id) || {
      id: route.id,
      name: route.id.replace(/[-_]/g, ' ').replace(/ \w/g, c => c.toUpperCase()),
      tagline: `${route.id} — Go Fork, and Multiply!`,
      description: "Shareware application provisioned on Nate's Software.",
      author: 'nate',
      authorAvatar: '⚡',
      creator: 'nate',
      creatorAvatar: '⚡',
      version: 'v1.0.0',
      upvotes: 42,
      forkCount: 12,
      tags: ['Shareware', 'App'],
      sqliteDatabase: '',
      sqliteSize: 'Not specified',
      screenshots: ['https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=1000&q=80'],
      comments: []
    };

    return (
      <div className="fixed inset-0 bg-[#ece9d8] flex flex-col font-tahoma text-xs overflow-hidden">
        <div className="bg-w95-blue text-white p-2 flex items-center justify-between border-b-2 border-gray-800 select-none shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-base">{resolvedApp.creatorAvatar || resolvedApp.authorAvatar || '🎯'}</span>
            <span className="font-bold text-sm font-mono">{resolvedApp.name}</span>
            <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-[10px] font-bold font-mono">
              {resolvedApp.version}
            </span>
            <span className="text-gray-300 font-mono text-[11px]">
              https://{resolvedApp.id}.nates-software.com
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://nates-software.com"
              className="btn-w95 text-xs py-1 px-3 font-bold text-black bg-gray-200 hover:bg-white"
            >
              ⚡ Return to Nate's Software Web OS
            </a>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2">
          <ErrorBoundary fallbackTitle={resolvedApp.name}>
            <EphemeralLiveApp app={resolvedApp} />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // Standalone Subdomain / Route Wrappers
  const renderStandaloneWrapper = (title: string, component: React.ReactNode) => (
    <div className="fixed inset-0 bg-[#0f172a] flex flex-col font-sans text-xs overflow-hidden">
      <div className="bg-[#000080] text-white px-3 py-1.5 flex items-center justify-between border-b-2 border-gray-800 select-none shadow-md">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm font-mono">{title}</span>
          <span className="bg-blue-900 text-blue-200 px-2 py-0.5 rounded text-[10px] font-mono border border-blue-400">
            STANDALONE ROUTE
          </span>
        </div>
        <a
          href="https://nates-software.com"
          className="btn-w95 text-xs py-1 px-3 font-bold text-black bg-gray-200 hover:bg-white"
        >
          ⚡ Return to Nate's Software Web OS
        </a>
      </div>
      <div className="flex-1 overflow-hidden">
        <ErrorBoundary fallbackTitle={title}>
          {component}
        </ErrorBoundary>
      </div>

      {editingApp && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[90vh] bg-[#c0c0c0] border-2 border-white shadow-2xl flex flex-col">
            <ErrorBoundary fallbackTitle="Post Editor" onDismiss={() => setEditingApp(null)}>
              <PostEditorView
                app={editingApp}
                onSave={async (updatedApp) => {
                  const res = await submitDrop(updatedApp);
                  if (!res.success) {
                    throw new Error(res.error || 'Server failed to persist drop');
                  }
                  playSuccessChime();
                  showAlert(`Drop "${updatedApp.name}" (${updatedApp.version}) published and persisted to Cloudflare D1!`, "Drop Published", "success");
                  setEditingApp(null);
                }}
                onCancel={() => {
                  playClickSound();
                  setEditingApp(null);
                }}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );

  if (route.type === 'standalone_view') {
    switch (route.id) {
      case 'editorial': return renderStandaloneWrapper(route.title || "EDITORIAL LAB", <EditorialView />);
      case 'chat': return renderStandaloneWrapper(route.title || "CHAT", <ChatView />);
      case 'gitsmith': return renderStandaloneWrapper(route.title || "GITSMITH", <GitsmithView />);
      case 'hotwire': return renderStandaloneWrapper(route.title || "HOTWIRE", <HotwireView
          onOpenPostEditor={(app) => {
            playClickSound();
            setEditingApp(app || null);
          }}
        />);
      case 'slopshop': return renderStandaloneWrapper(route.title || "SLOPSHOP", <SlopshopView />);
      case 'rig': return renderStandaloneWrapper(route.title || "RIG.EXE", <RigRuntimeView />);
      case 'inbox': return renderStandaloneWrapper(route.title || "INBOX", <InboxView />);
      case 'white-papers': return renderStandaloneWrapper(route.title || "WHITE PAPERS", <WhitePapersView />);
      case 'dyno': return renderStandaloneWrapper(route.title || "DYNO", <DynoView />);
      case 'profile': return renderStandaloneWrapper(route.title || "PROFILE", <ProfileView />);
      case 'terminal': return renderStandaloneWrapper(route.title || "TERMINAL", <TerminalView />);
    }
  }

  // Main Desktop Environment
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

  const getInitialScale = () => {
    if (typeof window === 'undefined') return 1.0;
    const w = window.innerWidth;
    if (w >= 2200) return 1.30;
    if (w >= 1600) return 1.15;
    return 1.0;
  };

  const [displayScale, setDisplayScale] = useState<number>(getInitialScale);

  const cycleScale = () => {
    setDisplayScale(prev => {
      if (prev <= 1.0) return 1.15;
      if (prev <= 1.15) return 1.30;
      return 1.0;
    });
  };

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
          label="SETUP.EXE (Quickstart)"
          icon="🚀"
          onClick={() => { playClickSound(); openWindow('setup'); }}
        />
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
          label="CHAT (IRC)"
          icon="💬"
          onClick={() => { playClickSound(); openWindow('chat'); }}
        />
        <DesktopIcon
          label="HOTWIRE (Drops)"
          icon="🔥"
          onClick={() => { playClickSound(); openWindow('hotwire'); }}
        />
        <DesktopIcon
          label="EDITORIAL (Nate's Lab)"
          icon="🏆"
          onClick={() => { playClickSound(); openWindow('editorial'); }}
        />
        <DesktopIcon
          label="SLOPSHOP (AI Mod)"
          icon="🔧"
          onClick={() => { playClickSound(); openWindow('slopshop'); }}
        />
        <DesktopIcon
          label="GITSMITH (Forge)"
          icon="📁"
          onClick={() => { playClickSound(); openWindow('gitsmith'); }}
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

      {/* 0. SETUP.EXE — 1-Click Fork Quickstart Wizard */}
      <RetroWindow
        windowState={windows.setup}
        isActive={activeWindowId === 'setup'}
        onFocus={() => focusWindow('setup')}
        onClose={() => closeWindow('setup')}
        onMinimize={() => minimizeWindow('setup')}
        onToggleMaximize={() => toggleMaximizeWindow('setup')}
        onMove={(x, y) => updateWindowPosition('setup', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('setup', w, h, x, y)}
      >
        <ErrorBoundary fallbackTitle="SETUP.EXE" onDismiss={() => closeWindow('setup')}>
          <SetupWizardView
            onOpenSandbox={() => {
              openWindow('hotwire');
            }}
            onOpenTerminal={() => {
              openWindow('terminal');
            }}
            onOpenForge={() => {
              openWindow('gitsmith');
            }}
          />
        </ErrorBoundary>
      </RetroWindow>

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
        <ErrorBoundary fallbackTitle="README_FIRST.TXT" onDismiss={() => closeWindow('mktg')}>
          <MarketingWindow
            onOpenHotwire={() => openWindow('hotwire')}
            onOpenSlopshop={() => openWindow('slopshop')}
            onOpenRig={() => openWindow('rig')}
            onOpenGitsmith={() => openWindow('gitsmith')}
            onOpenInbox={() => openWindow('inbox')}
            onOpenProfile={() => openWindow('profile')}
            onOpenWhitepapers={() => openWindow('papers')}
            onDismiss={() => closeWindow('mktg')}
          />
        </ErrorBoundary>
      </RetroWindow>

      {/* 0.5 CHAT IRC Chatroom Window */}
      <RetroWindow
        windowState={windows.chat}
        isActive={activeWindowId === 'chat'}
        onFocus={() => focusWindow('chat')}
        onClose={() => closeWindow('chat')}
        onMinimize={() => minimizeWindow('chat')}
        onToggleMaximize={() => toggleMaximizeWindow('chat')}
        onMove={(x, y) => updateWindowPosition('chat', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('chat', w, h, x, y)}
      >
        <ErrorBoundary fallbackTitle="CHAT" onDismiss={() => closeWindow('chat')}>
          <ChatView />
        </ErrorBoundary>
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
        <ErrorBoundary fallbackTitle="TERMINAL.EXE" onDismiss={() => closeWindow('terminal')}>
          <TerminalView />
        </ErrorBoundary>
      </RetroWindow>

      {/* 2.5 Editorial Lab — Nate's Software & Benchmark Reviews */}
      <RetroWindow
        windowState={windows.editorial}
        isActive={activeWindowId === 'editorial'}
        onFocus={() => focusWindow('editorial')}
        onClose={() => closeWindow('editorial')}
        onMinimize={() => minimizeWindow('editorial')}
        onToggleMaximize={() => toggleMaximizeWindow('editorial')}
        onMove={(x, y) => updateWindowPosition('editorial', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('editorial', w, h, x, y)}
      >
        <ErrorBoundary fallbackTitle="EDITORIAL LAB" onDismiss={() => closeWindow('editorial')}>
          <EditorialView
            onOpenApp={(appId) => {
              const targetApp = getApp(appId);
              if (targetApp) openWindow(targetApp.id as any);
            }}
          />
        </ErrorBoundary>
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
        <ErrorBoundary fallbackTitle="HOTWIRE" onDismiss={() => closeWindow('hotwire')}>
          <HotwireView
            onOpenApp={(appId) => {
              playClickSound();
              const targetApp = getApp(appId);
              if (targetApp) openWindow(targetApp.id as any);
            }}
            onOpenPostEditor={(app) => {
              playClickSound();
              setEditingApp(app || null);
            }}
          />
        </ErrorBoundary>
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
        <ErrorBoundary fallbackTitle="SLOPSHOP" onDismiss={() => closeWindow('slopshop')}>
          <SlopshopView />
        </ErrorBoundary>
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
        <ErrorBoundary fallbackTitle="RIG.EXE" onDismiss={() => closeWindow('rig')}>
          <RigRuntimeView />
        </ErrorBoundary>
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
        <ErrorBoundary fallbackTitle="INBOX" onDismiss={() => closeWindow('inbox')}>
          <InboxView />
        </ErrorBoundary>
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
        <ErrorBoundary fallbackTitle="DYNO" onDismiss={() => closeWindow('dyno')}>
          <DynoView />
        </ErrorBoundary>
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
        <ErrorBoundary fallbackTitle="WHITE PAPERS" onDismiss={() => closeWindow('papers')}>
          <WhitePapersView />
        </ErrorBoundary>
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
        <ErrorBoundary fallbackTitle="PROFILE" onDismiss={() => closeWindow('profile')}>
          <ProfileView />
        </ErrorBoundary>
      </RetroWindow>

      {/* 9. Gitsmith GitHub-Style Forge */}
      <RetroWindow
        windowState={windows.gitsmith}
        isActive={activeWindowId === 'gitsmith'}
        onFocus={() => focusWindow('gitsmith')}
        onClose={() => closeWindow('gitsmith')}
        onMinimize={() => minimizeWindow('gitsmith')}
        onToggleMaximize={() => toggleMaximizeWindow('gitsmith')}
        onMove={(x, y) => updateWindowPosition('gitsmith', x, y)}
        onResize={(w, h, x, y) => updateWindowSize('gitsmith', w, h, x, y)}
      >
        <ErrorBoundary fallbackTitle="GITSMITH" onDismiss={() => closeWindow('gitsmith')}>
          <GitsmithView />
        </ErrorBoundary>
      </RetroWindow>

      {/* Pop-Up Start Menu */}
      <StartMenu
        isOpen={startMenuOpen}
        onClose={() => setStartMenuOpen(false)}
        onOpenWindow={openWindow}
      />

      {/* PostEditor Modal Overlay */}
      {editingApp && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[90vh] bg-[#c0c0c0] border-2 border-white shadow-2xl flex flex-col">
            <ErrorBoundary fallbackTitle="Post Editor" onDismiss={() => setEditingApp(null)}>
              <PostEditorView
                app={editingApp}
                onSave={async (updatedApp) => {
                  const res = await submitDrop(updatedApp);
                  if (!res.success) {
                    throw new Error(res.error || 'Server failed to persist drop');
                  }
                  playSuccessChime();
                  showAlert(`Drop "${updatedApp.name}" (${updatedApp.version}) published and persisted to Cloudflare D1!`, "Drop Published", "success");
                  setEditingApp(null);
                }}
                onCancel={() => {
                  playClickSound();
                  setEditingApp(null);
                }}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {/* Authentic Win95 Desktop Taskbar */}
      <DesktopTaskbar
        tabs={taskbarTabs}
        onStartClick={() => setStartMenuOpen(prev => !prev)}
        displayScale={displayScale}
        onCycleScale={cycleScale}
      />
    </div>
  );
}

export default App;


export function App() {
  return (
    <ErrorBoundary isRoot fallbackTitle="Nate's Software Web OS">
      <AuthProvider>
        <CatalogProvider>
          <AppInner />
          <AuthModal />
        </CatalogProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
