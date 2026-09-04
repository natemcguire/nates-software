import { CatalogProvider, useCatalog } from './context/CatalogContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { ErrorBoundary } from './components/ErrorBoundary';
export interface ResolvedRoute {
  readonly type: 'standalone_app' | 'standalone_view' | 'desktop';
  readonly id?: string;
  readonly title?: string;
}

const RESERVED_VIEW_HOSTS = new Set([
  'gitsmith', 'git', 'hotwire', 'slopshop', 'rig', 'inbox', 'dyno', 'profile',
  'whitepapers', 'white-papers', 'terminal', 'chat', 'irc',
  'lounge', 'www', 'nates-software', 'api', 'router-canary', 'rig-provider',
  'explainer', 'whatis', 'what'
]);

function formatAppTitle(id: string): string {
  const titles: Record<string, string> = {
    dronehunter: 'DroneHunter 95',
    'certified-mailer': 'Certified Mailer',
    'american-gardener': 'American Gardener',
    wallart: 'WallArt Canvas Pro'
  };
  if (titles[id]) return titles[id];
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function resolveAppRoute(
  hostname: string = '',
  pathname: string = '',
  viewQuery: string = '',
  appIdQuery: string | null = null
): ResolvedRoute {
  if (hostname.startsWith('explainer.') || hostname.startsWith('what.') || pathname.startsWith('/what') || pathname.startsWith('/explainer') || viewQuery === 'explainer' || viewQuery === 'what') {
    return { type: 'standalone_view', id: 'explainer', title: "WHAT IS NATE'S SOFTWARE" };
  }

  if (hostname.startsWith('chat.') || pathname.startsWith('/chat') || pathname.startsWith('/irc') || pathname.startsWith('/lounge') || viewQuery === 'chat') {
    return { type: 'standalone_view', id: 'chat', title: 'CHAT IRC CHATROOM (#lounge)' };
  }

  if (hostname.startsWith('gitsmith.') || hostname.startsWith('git.') || pathname.startsWith('/gitsmith') || pathname.startsWith('/forge') || viewQuery === 'gitsmith') {
    return { type: 'standalone_view', id: 'gitsmith', title: 'GITSMITH FORGE' };
  }

  if (hostname.startsWith('hotwire.') || pathname.startsWith('/hotwire') || pathname.startsWith('/drops') || viewQuery === 'hotwire') {
    return { type: 'standalone_view', id: 'hotwire', title: "HOTWIRE — WHAT'S HOT" };
  }

  if (hostname.startsWith('slopshop.') || pathname.startsWith('/slopshop') || pathname.startsWith('/speedshop') || viewQuery === 'slopshop') {
    return { type: 'standalone_view', id: 'slopshop', title: 'SLOPSHOP LOCAL AI AGENT LAUNCHPAD' };
  }

  if (hostname.startsWith('rig.') || pathname.startsWith('/rig') || pathname.startsWith('/runtime') || viewQuery === 'rig') {
    return { type: 'standalone_view', id: 'rig', title: 'RIG — INFRASTRUCTURE' };
  }


  if (hostname.startsWith('inbox.') || pathname.startsWith('/inbox') || viewQuery === 'inbox') {
    return { type: 'standalone_view', id: 'inbox', title: 'AGENT INBOX' };
  }

  if (pathname.startsWith('/white-papers') || pathname.startsWith('/whitepapers') || pathname.startsWith('/docs') || viewQuery === 'white-papers' || viewQuery === 'papers') {
    return { type: 'standalone_view', id: 'white-papers', title: 'ARCHITECTURAL WHITE PAPERS' };
  }

  if (pathname.startsWith('/dyno') || pathname.startsWith('/speedometer') || viewQuery === 'dyno') {
    return { type: 'standalone_view', id: 'dyno', title: 'DYNO AI DEVELOPER BENCHMARK (Model + Harness + Tools)' };
  }

  if (pathname.startsWith('/profile') || pathname.startsWith('/shelf') || viewQuery === 'profile') {
    return { type: 'standalone_view', id: 'profile', title: 'ACCOUNT.CFG (Profile)' };
  }

  if (pathname.startsWith('/terminal') || pathname.startsWith('/shell') || pathname.startsWith('/dos') || viewQuery === 'terminal') {
    return { type: 'standalone_view', id: 'terminal', title: 'TERMINAL.EXE INTERACTIVE DOS SHELL' };
  }

  const lowerHost = hostname.toLowerCase();
  const isPagesPreviewHost = lowerHost.endsWith('.pages.dev') || lowerHost === 'localhost' || lowerHost.startsWith('localhost:') || lowerHost.startsWith('127.0.0.1');
  const hostLabel = hostname ? hostname.split('.')[0].toLowerCase() : null;
  const hostAppId = isPagesPreviewHost ? null : (hostLabel && !RESERVED_VIEW_HOSTS.has(hostLabel) ? hostLabel : null);
  const requestedAppId = appIdQuery || hostAppId;

  if (requestedAppId && !RESERVED_VIEW_HOSTS.has(requestedAppId)) {
    return {
      type: 'standalone_app',
      id: requestedAppId,
      title: formatAppTitle(requestedAppId)
    };
  }

  return { type: 'desktop' };
}

import React, { useState, useEffect, useCallback } from 'react';
import { GitsmithView } from './views/GitsmithView';
import { EphemeralLiveApp } from './components/EphemeralLiveApp';
import type { AppListing } from './data/mockData';
import { useWindowManager } from './hooks/useWindowManager';
import { DesktopIcon } from './components/DesktopIcon';
import { DesktopContextMenu } from './components/DesktopContextMenu';
import { RetroWindow } from './components/RetroWindow';
import { DesktopTaskbar } from './components/DesktopTaskbar';
import { StartMenu } from './components/StartMenu';
import { AccountWidget } from './components/AccountWidget';
import { FontSizer } from './components/FontSizer';
import { TldrButton } from './components/TldrButton';
import { RestartOverlay } from './components/RestartOverlay';

import { SetupWizardView } from './views/SetupWizardView';
import { MarketingWindow } from './views/MarketingWindow';
import { PostEditorView } from './views/PostEditorView';
import { HotwireView } from './views/HotwireView';
import { SlopshopView } from './views/SlopshopView';
import { InboxView } from './views/InboxView';
import { WhitePapersView } from './views/WhitePapersView';
import { DynoView } from './views/DynoView';
import { ProfileView } from './views/ProfileView';
import { TerminalView } from './views/TerminalView';
import { ChatView } from './views/ChatView';
import { playClickSound, playSuccessChime } from './lib/soundEngine';
import { useAlert } from './context/AlertContext';

const ICON_POSITIONS_KEY = 'nsw_icon_positions';
const ICON_LAYOUT_VERSION = '5';
const ICON_LAYOUT_VERSION_KEY = 'nsw_icon_layout_v';

function loadSavedIconPositions(): Record<string, { x: number; y: number }> {
  if (typeof window === 'undefined') return {};
  try {
    if (localStorage.getItem(ICON_LAYOUT_VERSION_KEY) !== ICON_LAYOUT_VERSION) {
      localStorage.removeItem(ICON_POSITIONS_KEY);
      localStorage.setItem(ICON_LAYOUT_VERSION_KEY, ICON_LAYOUT_VERSION);
      return {};
    }
    const raw = localStorage.getItem(ICON_POSITIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return {};
}

const ICON_GRID = { startX: 16, startY: 16, iconWidth: 128, iconHeight: 96, gapX: 24, gapY: 20, rowsPerCol: 6 } as const;

const MAIN_ROWS = 3;
function getGroupedIconPosition(group: 'main' | 'refs' | 'soon', indexInGroup: number): { x: number; y: number } {
  const { startX, startY, iconWidth, iconHeight, gapX, gapY } = ICON_GRID;
  const colPitch = iconWidth + gapX;
  const rowPitch = iconHeight + gapY;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const bottomY = vh - iconHeight - 104;

  if (group === 'main') {
    const col = Math.floor(indexInGroup / MAIN_ROWS);
    const row = indexInGroup % MAIN_ROWS;
    return { x: startX + col * colPitch, y: startY + row * rowPitch };
  }

  if (group === 'refs') {
    return { x: startX + indexInGroup * colPitch, y: bottomY };
  }

  const SOON_COLS = 2;
  const col = indexInGroup % SOON_COLS;
  const row = Math.floor(indexInGroup / SOON_COLS);
  const clusterRightX = vw - iconWidth - 24;
  return {
    x: clusterRightX - (SOON_COLS - 1 - col) * colPitch,
    y: bottomY - row * rowPitch,
  };
}

function getSoonHeaderPosition(): { x: number; y: number; width: number } {
  const { iconWidth, iconHeight, gapX, gapY } = ICON_GRID;
  const colPitch = iconWidth + gapX;
  const rowPitch = iconHeight + gapY;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const bottomY = vh - iconHeight - 104;
  const clusterRightX = vw - iconWidth - 24;
  const leftColX = clusterRightX - colPitch;
  const topRowY = bottomY - rowPitch;
  return {
    x: leftColX,
    y: topRowY - 34,
    width: colPitch + iconWidth,
  };
}


export function AppInner() {
  const { getApp, submitDrop } = useCatalog();
  const { showAlert } = useAlert();
  const { user, isAuthenticated, authLoading, openAuthModal } = useAuth();
  const [editingApp, setEditingApp] = useState<AppListing | null>(null);
  const [liveSandboxApp, setLiveSandboxApp] = useState<AppListing | null>(null);

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
      upvotes: 0,
      forkCount: 0,
      tags: ['Shareware', 'App'],
      sqliteDatabase: '',
      sqliteSize: 'Not specified',
      screenshots: [],
      comments: [],
      deploymentState: 'draft' as const,
      deploymentError: `No deployable revision exists for ${route.id}. Source has not been imported into GITSMITH and built by RIG.`
    };

    const isAppActive = resolvedApp.deploymentState === 'active' && Boolean(resolvedApp.activeDeploymentId);

    return (
      <div className="fixed inset-0 bg-[#ece9d8] flex flex-col font-tahoma text-xs overflow-hidden">
        <div className="bg-w95-blue text-white p-2 flex items-center justify-between border-b-2 border-gray-800 select-none shadow-md">
          <div className="flex items-center gap-2">
            <span className="text-base">{resolvedApp.creatorAvatar || resolvedApp.authorAvatar || '🎯'}</span>
            <span className="font-bold text-sm font-mono">{resolvedApp.name}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${isAppActive ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
              {isAppActive ? resolvedApp.version : (resolvedApp.deploymentState || 'DRAFT').toUpperCase()}
            </span>
            <span className="text-gray-300 font-mono text-[11px]">
              https://{resolvedApp.id}.nates-software.com
            </span>
          </div>
          <div className="flex items-center gap-2">
            <AccountWidget />
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

  const renderStandaloneWrapper = (title: string, component: React.ReactNode) => (
    <div className="fixed inset-0 bg-[#0f172a] flex flex-col font-sans text-xs overflow-hidden">
      <div className="bg-[#000080] text-white px-3 py-1.5 flex items-center justify-between border-b-2 border-gray-800 select-none shadow-md">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm font-mono">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <AccountWidget />
          <a
            href="https://nates-software.com"
            className="btn-w95 text-xs py-1 px-3 font-bold text-black bg-gray-200 hover:bg-white"
          >
            ⚡ Return to Nate's Software Web OS
          </a>
        </div>
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
                  const honestStatus = res.productStatus || 'draft';
                  showAlert(
                    honestStatus === 'active'
                      ? `Drop "${updatedApp.name}" (${updatedApp.version}) published and is live for purchase!`
                      : `Drop "${updatedApp.name}" (${updatedApp.version}) saved as a DRAFT — ${res.message || 'link a deployable repository before it can be sold.'}`,
                    "Drop Published",
                    honestStatus === 'active' ? "success" : "info"
                  );
                  if (honestStatus === 'active') setEditingApp(null);
                  return {
                    productStatus: res.productStatus,
                    deploymentState: res.deploymentState,
                    repositoryProvisioned: res.repositoryProvisioned,
                    message: res.message
                  };
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
      case 'explainer': {
        const goHome = () => { window.location.href = 'https://nates-software.com'; };
        return renderStandaloneWrapper(route.title || "WELCOME TO NATE'S SOFTWARE EMPORIUM", (
          <div className="h-full overflow-auto bg-[#ece9d8] p-3">
            <MarketingWindow
              onOpenSetup={goHome}
              onOpenHotwire={goHome}
              onOpenSlopshop={goHome}
              onOpenGitsmith={goHome}
              onOpenInbox={goHome}
              onOpenProfile={goHome}
              onOpenWhitepapers={goHome}
              onOpenDyno={goHome}
              onDismiss={goHome}
            />
          </div>
        ));
      }
      case 'chat': return renderStandaloneWrapper(route.title || "CHAT", <ChatView />);
      case 'gitsmith': return renderStandaloneWrapper(route.title || "GITSMITH", <GitsmithView />);
      case 'hotwire': return renderStandaloneWrapper(route.title || "HOTWIRE", <HotwireView
          onOpenPostEditor={(app) => {
            playClickSound();
            setEditingApp(app || null);
          }}
        />);
      case 'slopshop': return renderStandaloneWrapper(route.title || "SLOPSHOP", (
        <SlopshopView onOpenWhitePapers={() => { window.location.href = 'https://nates-software.com/white-papers?view=papers'; }} />
      ));
      case 'rig': return renderStandaloneWrapper(route.title || "RIG — INFRASTRUCTURE", (
        <div className="h-full overflow-auto bg-[#ece9d8] p-6 flex items-center justify-center">
          <div className="max-w-md bg-white border-2 border-t-white border-l-white border-b-gray-700 border-r-gray-700 p-5 text-black font-tahoma text-sm leading-relaxed shadow-lg">
            <div className="font-bold text-base mb-2">⚙️ RIG is infrastructure now</div>
            <p className="mb-3">
              RIG is no longer an app you open. It runs invisibly as the build &amp;
              run engine behind the scenes: it builds every forge commit into a live
              app, verifies merges, and powers SLOPSHOP's live-run step.
            </p>
            <a
              href="https://nates-software.com"
              className="inline-block btn-w95 px-3 py-1.5 font-bold text-black bg-gray-200 hover:bg-white"
            >
              ⚡ Go to Nate's Software
            </a>
          </div>
        </div>
      ));
      case 'inbox': return renderStandaloneWrapper(route.title || "INBOX", <InboxView />);
      case 'white-papers': return renderStandaloneWrapper(route.title || "WHITE PAPERS", <WhitePapersView />);
      case 'dyno': return renderStandaloneWrapper(route.title || "DYNO", <DynoView />);
      case 'profile': return renderStandaloneWrapper(route.title || "ACCOUNT.CFG (Profile)", <ProfileView />);
      case 'terminal': return renderStandaloneWrapper(route.title || "TERMINAL", <TerminalView />);
    }
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
  } = useWindowManager(user);

  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [theme, setTheme] = useState<'teal' | 'matrix' | 'sunset' | 'navy'>('teal');

  const INTRO_EVERY_RELOAD = true;
  const INTRO_SEEN_KEY = 'nsw_intro_seen';
  const [introPhase, setIntroPhase] = useState<'waiting' | 'primed' | 'revealing' | 'done'>(() => {
    if (typeof window === 'undefined') return 'done';
    if (INTRO_EVERY_RELOAD) return 'waiting';
    return localStorage.getItem(INTRO_SEEN_KEY) ? 'done' : 'waiting';
  });
  const [revealDelays, setRevealDelays] = useState<Record<string, number>>({});
  const [showSoonHeader, setShowSoonHeader] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    if (INTRO_EVERY_RELOAD) return false;
    return Boolean(localStorage.getItem(INTRO_SEEN_KEY));
  });
  const triggerIntroReveal = useCallback(() => {
    setIntroPhase((prev) => {
      if (prev !== 'waiting') return prev;
      const mainIds = ['setup', 'hotwire', 'gitsmith', 'chat', 'profile', 'papers', 'github'];
      const soonIds = ['slopshop', 'inbox', 'dyno', 'terminal'];
      const delays: Record<string, number> = {};
      mainIds.forEach((id) => { delays[id] = Math.floor(Math.random() * 800); });
      soonIds.forEach((id) => { delays[id] = 1000 + Math.floor(Math.random() * 700); });
      setRevealDelays(delays);
      setShowSoonHeader(false);
      setTimeout(() => setShowSoonHeader(true), 3200);
      setTimeout(() => setIntroPhase('revealing'), 2000);
      setTimeout(() => {
        setIntroPhase('done');
        try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch {  }
      }, 6500);
      return 'primed';
    });
  }, []);

  const [iconPositions, setIconPositions] = useState<Record<string, { x: number; y: number }>>(loadSavedIconPositions);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  const [, setViewportTick] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raf = 0;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setViewportTick(t => t + 1)); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); };
  }, []);

  const handleIconPositionChange = (id: string, pos: { x: number; y: number }) => {
    setIconPositions(prev => {
      const next = { ...prev, [id]: pos };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(ICON_POSITIONS_KEY, JSON.stringify(next));
        } catch {
        }
      }
      return next;
    });
  };

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: string } | null>(null);

  const alignIconsToGrid = () => {
    playClickSound();
    setIconPositions({});
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(ICON_POSITIONS_KEY); } catch {  }
    }
  };

  const openContextMenu = (e: React.MouseEvent, target: string) => {
    e.preventDefault();
    e.stopPropagation();
    playClickSound();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  };

  const handleDesktopPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('.nsw-window') ||
      target.closest('.RetroWindow') ||
      target.closest('.btn-w95') ||
      target.closest('.start-menu') ||
      target.closest('.desktop-icon') ||
      target.closest('.desktop-taskbar')
    ) return;
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

  const desktopIconOpeners: Record<string, () => void> = {};

  return (
    <div
      onPointerDown={handleDesktopPointerDown}
      onPointerMove={handleDesktopPointerMove}
      onPointerUp={handleDesktopPointerUp}
      onContextMenu={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest('.RetroWindow') || el.closest('input') || el.closest('textarea') || el.closest('a')) return;
        if (!el.closest('.desktop-icon')) openContextMenu(e, 'desktop');
      }}
      className={`fixed inset-0 select-none overflow-hidden pb-10 transition-colors duration-500 ${bgStyles[theme]}`}
      style={{
        backgroundImage: theme === 'teal' ? `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.03) 1px, transparent 1px)` : undefined,
        backgroundSize: '24px 24px'
      }}
    >
      <div className="md:hidden fixed inset-0 z-[60] bg-w95-teal flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#c0c0c0] border-2 shadow-[4px_4px_0_rgba(0,0,0,0.45)]"
             style={{ borderColor: '#ffffff #404040 #404040 #ffffff' }}>
          <div className="bg-gradient-to-r from-w95-blue to-[#1084d0] text-white px-1.5 py-1 text-sm font-bold flex items-center gap-1.5">
            <span>⚡</span><span>Nate's Software 95</span>
          </div>
          <div className="p-4 text-black text-sm leading-relaxed font-tahoma">
            <p className="font-bold text-w95-blue mb-2">Best on a bigger screen.</p>
            <p className="mb-3">
              Nate's Software is a Windows-95-style desktop — it needs a laptop or desktop
              to open windows, fork apps, and run the shops. Come back from a computer for
              the full thing.
            </p>
            <button
              type="button"
              onClick={() => { playClickSound(); openWindow('mktg'); }}
              className="btn-w95 btn-w95-primary px-4 py-1.5 text-xs font-bold w-full"
            >
              What is this? →
            </button>
          </div>
        </div>
      </div>

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

      <div className="absolute top-3 right-4 z-10 flex items-center gap-2">
        <TldrButton />
        <button
          data-testid="desktop-explainer-button"
          onClick={() => { playClickSound(); openWindow('mktg'); }}
          className="flex items-center gap-1.5 bg-black/40 hover:bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded border border-white/20 text-white text-[11px] font-tahoma font-bold cursor-pointer transition-colors shadow-sm"
          title="What is Nate's Software and what does each app do?"
        >
          <span className="text-amber-300 font-bold">?</span>
          <span>What is this?</span>
        </button>
        {authLoading ? (
          <div className="flex items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded border border-white/10 text-white/60 text-[11px] font-tahoma">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-white/40 border-t-transparent animate-spin" />
            <span>Loading…</span>
          </div>
        ) : isAuthenticated && user ? (
          <div
            data-testid="desktop-greeting"
            className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm px-2.5 py-1 rounded border border-white/20 text-white text-[11px] font-tahoma"
          >
            <span>{user.avatar || '👤'}</span>
            <span className="text-gray-300">
              Welcome back, <strong className="text-white">{`@${user.displayName || user.username}`}</strong>
            </span>
          </div>
        ) : (
          <button
            data-testid="get-username-cta"
            onClick={() => { playClickSound(); openAuthModal('register', 'claim your username'); }}
            className="nsw-cta-pulse btn-w95 btn-w95-primary flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold cursor-pointer"
            title="Create your free account and claim your @username"
          >
            <span className="text-yellow-300">⚡</span>
            <span>GET YOUR USERNAME</span>
          </button>
        )}
        <FontSizer />
        <div className="flex items-center gap-1 bg-black/40 backdrop-blur-sm p-1.5 rounded border border-white/20 text-white text-[11px] font-tahoma">
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
      </div>

      {(() => {
        type DeskIcon = { id: string; label: string; icon: string; onClick: () => void; group: 'main' | 'refs' | 'soon'; comingSoon?: boolean };
        const icons: DeskIcon[] = [
          { id: 'setup', label: 'SETUP.EXE', icon: '🚀', group: 'main', onClick: () => { playClickSound(); openWindow('setup'); } },
          { id: 'whatis', label: 'WHAT_IS_THIS.TXT', icon: '❓', group: 'main', onClick: () => { playClickSound(); triggerIntroReveal(); openWindow('mktg'); } },
          { id: 'hotwire', label: 'HOTWIRE', icon: '🔥', group: 'main', onClick: () => { playClickSound(); openWindow('hotwire'); } },
          { id: 'gitsmith', label: 'GITSMITH', icon: '📁', group: 'main', onClick: () => { playClickSound(); openWindow('gitsmith'); } },
          { id: 'chat', label: 'CHAT', icon: '💬', group: 'main', onClick: () => { playClickSound(); openWindow('chat'); } },
          { id: 'profile', label: 'ACCOUNT.CFG', icon: '👤', group: 'main', onClick: () => { playClickSound(); openWindow('profile'); } },
          { id: 'papers', label: 'WHITE_PAPERS.DOC', icon: '📖', group: 'refs', onClick: () => { playClickSound(); openWindow('papers'); } },
          { id: 'github', label: 'Source Code', icon: '🌐', group: 'refs', onClick: () => { playClickSound(); window.open('https://github.com/natemcguire/nates-software', '_blank'); } },
          { id: 'slopshop', label: 'SLOPSHOP', icon: '🔧', group: 'soon', comingSoon: true, onClick: () => { playClickSound(); openWindow('slopshop'); } },
          { id: 'inbox', label: 'Agent Inbox', icon: '📫', group: 'soon', comingSoon: true, onClick: () => { playClickSound(); openWindow('inbox'); } },
          { id: 'dyno', label: 'DYNO', icon: '🏎️', group: 'soon', comingSoon: true, onClick: () => { playClickSound(); openWindow('dyno'); } },
          { id: 'terminal', label: 'TERMINAL.EXE', icon: '💻', group: 'soon', comingSoon: true, onClick: () => { playClickSound(); openWindow('terminal'); } },
        ];
        const groupIndex: Record<'main' | 'refs' | 'soon', number> = { main: 0, refs: 0, soon: 0 };
        return icons.map((item) => {
          const idxInGroup = groupIndex[item.group]++;
          const isWhatis = item.id === 'whatis';
          const introCentered = isWhatis && (introPhase === 'waiting' || introPhase === 'primed');
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
          const setupAboveAbout = item.id === 'setup' && !iconPositions.setup && windows.mktg.isOpen;
          const pos = introCentered
            ? { x: Math.round(vw / 2 - 64), y: Math.round(vh / 2 - 60) }
            : setupAboveAbout
              ? { x: Math.round(windows.mktg.x + windows.mktg.width / 2 - 64), y: Math.max(8, windows.mktg.y - 92) }
              : (iconPositions[item.id] || getGroupedIconPosition(item.group, idxInGroup));
          desktopIconOpeners[item.id] = item.onClick;
          const introClass =
            (introPhase === 'waiting' || introPhase === 'primed')
              ? (isWhatis ? '' : 'desktop-intro-hidden')
              : introPhase === 'revealing'
                ? (isWhatis ? '' : 'desktop-icon-reveal-wrap')
                : '';
          const doVoxel = introPhase === 'revealing' && !isWhatis;
          const voxelDelayMs = doVoxel ? (revealDelays[item.id] ?? 0) : 0;
          return (
            <DesktopIcon
              key={item.id}
              id={item.id}
              label={item.label}
              icon={item.icon}
              position={pos}
              comingSoon={item.comingSoon}
              onPositionChange={(newPos) => handleIconPositionChange(item.id, newPos)}
              onClick={item.onClick}
              onContextMenu={(e) => openContextMenu(e, item.id)}
              onOpen={item.onClick}
              introClassName={introClass}
              voxelReveal={doVoxel}
              voxelDelayMs={voxelDelayMs}
            />
          );
        });
      })()}

      {(() => {
        const h = getSoonHeaderPosition();
        return (
          <div
            className="absolute z-10 pointer-events-none select-none text-center"
            style={{
              left: h.x,
              top: h.y,
              width: h.width,
              opacity: showSoonHeader ? 1 : 0,
              transition: 'opacity 1.4s ease-in',
            }}
          >
            <span className="text-white/70 text-xs font-bold uppercase tracking-widest text-shadow">
              Coming Soon
            </span>
          </div>
        );
      })()}

      {contextMenu && (
        <DesktopContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={
            contextMenu.target === 'desktop'
              ? [
                  { label: 'Align Icons to Grid', icon: '▦', onClick: alignIconsToGrid, separatorAfter: true },
                  { label: 'Refresh', icon: '↻', onClick: () => { playClickSound(); window.location.reload(); }, separatorAfter: true },
                  { label: 'What is this?', icon: '❔', onClick: () => { playClickSound(); openWindow('mktg'); } },
                  { label: 'Open Terminal', icon: '💻', onClick: () => { playClickSound(); openWindow('terminal'); } },
                ]
              : (() => {
                  const opener = desktopIconOpeners[contextMenu.target];
                  return [
                    { label: 'Open', icon: '📂', onClick: opener, separatorAfter: true },
                    { label: 'Align Icons to Grid', icon: '▦', onClick: alignIconsToGrid },
                  ];
                })()
          }
        />
      )}

      <ErrorBoundary
        key={`setup-${windows.setup.isOpen}`}
        fallbackTitle="SETUP.EXE"
        onDismiss={() => closeWindow('setup')}
        resetKeys={[windows.setup.isOpen]}
      >
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
          <SetupWizardView
            onOpenSandbox={(appId) => {
              playClickSound();
              const targetApp = getApp(appId) || {
                id: appId,
                name: formatAppTitle(appId),
                tagline: `${appId} — Shareware App`,
                description: `Live preview for ${appId}`,
                author: 'nate',
                authorAvatar: '⚡',
                creator: 'nate',
                creatorAvatar: '⚡',
                version: 'v1.0.0',
                upvotes: 0,
                forkCount: 0,
                tags: ['Shareware', 'App'],
                sqliteDatabase: '',
                sqliteSize: 'Not specified',
                screenshots: [],
                comments: [],
                deploymentState: 'draft' as const,
                deploymentError: `No deployable revision exists for ${appId}. Source has not been imported into GITSMITH and built by RIG.`
              };
              setLiveSandboxApp(targetApp);
            }}
            onOpenTerminal={() => {
              openWindow('terminal');
            }}
            onOpenForge={() => {
              openWindow('gitsmith');
            }}
            onBrowseDrops={() => {
              openWindow('hotwire');
            }}
          />
        </RetroWindow>
      </ErrorBoundary>

      <ErrorBoundary
        key={`mktg-${windows.mktg.isOpen}`}
        fallbackTitle="WHAT_IS_THIS.TXT"
        onDismiss={() => closeWindow('mktg')}
        resetKeys={[windows.mktg.isOpen]}
      >
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
            onOpenSetup={() => openWindow('setup')}
            onOpenHotwire={() => openWindow('hotwire')}
            onOpenSlopshop={() => openWindow('slopshop')}
            onOpenGitsmith={() => openWindow('gitsmith')}
            onOpenInbox={() => openWindow('inbox')}
            onOpenProfile={() => openWindow('profile')}
            onOpenWhitepapers={() => openWindow('papers')}
            onOpenDyno={() => openWindow('dyno')}
            onDismiss={() => closeWindow('mktg')}
          />
        </RetroWindow>
      </ErrorBoundary>

      <ErrorBoundary
        key={`chat-${windows.chat.isOpen}`}
        fallbackTitle="CHAT"
        onDismiss={() => closeWindow('chat')}
        resetKeys={[windows.chat.isOpen]}
      >
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
          <ChatView />
        </RetroWindow>
      </ErrorBoundary>

      <ErrorBoundary
        key={`terminal-${windows.terminal.isOpen}`}
        fallbackTitle="TERMINAL.EXE"
        onDismiss={() => closeWindow('terminal')}
        resetKeys={[windows.terminal.isOpen]}
      >
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
      </ErrorBoundary>

      <ErrorBoundary
        key={`hotwire-${windows.hotwire.isOpen}`}
        fallbackTitle="HOTWIRE"
        onDismiss={() => closeWindow('hotwire')}
        resetKeys={[windows.hotwire.isOpen]}
      >
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
        </RetroWindow>
      </ErrorBoundary>

      <ErrorBoundary
        key={`slopshop-${windows.slopshop.isOpen}`}
        fallbackTitle="SLOPSHOP"
        onDismiss={() => closeWindow('slopshop')}
        resetKeys={[windows.slopshop.isOpen]}
      >
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
          <SlopshopView onOpenWhitePapers={() => openWindow('papers')} />
        </RetroWindow>
      </ErrorBoundary>

      <ErrorBoundary
        key={`inbox-${windows.inbox.isOpen}`}
        fallbackTitle="INBOX"
        onDismiss={() => closeWindow('inbox')}
        resetKeys={[windows.inbox.isOpen]}
      >
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
      </ErrorBoundary>

      <ErrorBoundary
        key={`dyno-${windows.dyno.isOpen}`}
        fallbackTitle="DYNO"
        onDismiss={() => closeWindow('dyno')}
        resetKeys={[windows.dyno.isOpen]}
      >
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
      </ErrorBoundary>

      <ErrorBoundary
        key={`papers-${windows.papers.isOpen}`}
        fallbackTitle="WHITE PAPERS"
        onDismiss={() => closeWindow('papers')}
        resetKeys={[windows.papers.isOpen]}
      >
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
      </ErrorBoundary>

      <ErrorBoundary
        key={`profile-${windows.profile.isOpen}`}
        fallbackTitle="PROFILE"
        onDismiss={() => closeWindow('profile')}
        resetKeys={[windows.profile.isOpen]}
      >
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
      </ErrorBoundary>

      <ErrorBoundary
        key={`gitsmith-${windows.gitsmith.isOpen}`}
        fallbackTitle="GITSMITH"
        onDismiss={() => closeWindow('gitsmith')}
        resetKeys={[windows.gitsmith.isOpen]}
      >
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
          <GitsmithView />
        </RetroWindow>
      </ErrorBoundary>

      {restarting && <RestartOverlay />}
      <StartMenu
        isOpen={startMenuOpen}
        onClose={() => setStartMenuOpen(false)}
        onOpenWindow={openWindow}
        onRestart={() => setRestarting(true)}
      />

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
                  const honestStatus = res.productStatus || 'draft';
                  showAlert(
                    honestStatus === 'active'
                      ? `Drop "${updatedApp.name}" (${updatedApp.version}) published and is live for purchase!`
                      : `Drop "${updatedApp.name}" (${updatedApp.version}) saved as a DRAFT — ${res.message || 'link a deployable repository before it can be sold.'}`,
                    "Drop Published",
                    honestStatus === 'active' ? "success" : "info"
                  );
                  if (honestStatus === 'active') setEditingApp(null);
                  return {
                    productStatus: res.productStatus,
                    deploymentState: res.deploymentState,
                    repositoryProvisioned: res.repositoryProvisioned,
                    message: res.message
                  };
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

      {liveSandboxApp && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[85vh] bg-[#ece9d8] border-2 border-white shadow-2xl flex flex-col font-tahoma">
            <div className="bg-w95-blue text-white px-2.5 py-1.5 flex items-center justify-between border-b-2 border-gray-800 select-none">
              <div className="flex items-center gap-2">
                <span>{liveSandboxApp.creatorAvatar || liveSandboxApp.authorAvatar || '🚀'}</span>
                <span className="font-bold text-xs font-mono">{liveSandboxApp.name} — Live Cloud Sandbox</span>
              </div>
              <button
                onClick={() => {
                  playClickSound();
                  setLiveSandboxApp(null);
                }}
                className="btn-w95 px-2 py-0.5 text-xs font-bold text-black bg-gray-200 hover:bg-white"
              >
                ✕ Close
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ErrorBoundary fallbackTitle={liveSandboxApp.name} onDismiss={() => setLiveSandboxApp(null)}>
                <EphemeralLiveApp app={liveSandboxApp} />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}

      <DesktopTaskbar
        tabs={taskbarTabs}
        onStartClick={() => setStartMenuOpen(prev => !prev)}
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
