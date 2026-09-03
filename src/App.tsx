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
    return { type: 'standalone_view', id: 'hotwire', title: 'HOTWIRE DAILY DROPS' };
  }

  if (hostname.startsWith('slopshop.') || pathname.startsWith('/slopshop') || pathname.startsWith('/speedshop') || viewQuery === 'slopshop') {
    return { type: 'standalone_view', id: 'slopshop', title: 'SLOPSHOP LOCAL AI AGENT LAUNCHPAD' };
  }

  if (hostname.startsWith('rig.') || pathname.startsWith('/rig') || pathname.startsWith('/runtime') || viewQuery === 'rig') {
    // RIG is no longer a user-facing app (task #41) — it's the invisible deploy
    // engine. Keep 'rig' resolving to a reserved standalone_view (never a tenant
    // app) so rig.nates-software.com can't be claimed; it renders an infra notice.
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

  const hostLabel = hostname ? hostname.split('.')[0].toLowerCase() : null;
  const requestedAppId = appIdQuery || (hostLabel && !RESERVED_VIEW_HOSTS.has(hostLabel) ? hostLabel : null);

  if (requestedAppId && !RESERVED_VIEW_HOSTS.has(requestedAppId)) {
    return {
      type: 'standalone_app',
      id: requestedAppId,
      title: formatAppTitle(requestedAppId)
    };
  }

  return { type: 'desktop' };
}

import React, { useState, useEffect } from 'react';
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
// Bump when the default icon set/order changes so everyone gets the fresh clean
// layout once (old drag positions are dropped), instead of keeping a stale/scattered
// arrangement. Users can re-drag afterwards; those saves are kept until the next bump.
const ICON_LAYOUT_VERSION = '2';
const ICON_LAYOUT_VERSION_KEY = 'nsw_icon_layout_v';

function loadSavedIconPositions(): Record<string, { x: number; y: number }> {
  if (typeof window === 'undefined') return {};
  try {
    // One-time reset to the clean default grid when the layout version changes.
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
    // Ignore invalid JSON / storage errors
  }
  return {};
}

// Grid spacing must exceed the icon cell (w-28 = 112px) by enough that a
// two-line wrapped label (e.g. WHAT_IS_THIS.TXT) never touches its neighbor,
// on laptops and at any font zoom. Column pitch = iconWidth + gapX = 140px;
// row pitch = iconHeight + gapY = 116px (labels can be 2 lines tall + emoji).
const ICON_GRID = { startX: 16, startY: 16, iconWidth: 112, iconHeight: 96, gapX: 28, gapY: 20, rowsPerCol: 7 } as const;
function getDefaultIconPosition(index: number): { x: number; y: number } {
  const { startX, startY, iconWidth, iconHeight, gapX, gapY, rowsPerCol } = ICON_GRID;
  const col = Math.floor(index / rowsPerCol);
  const row = index % rowsPerCol;
  return {
    x: startX + col * (iconWidth + gapX),
    y: startY + row * (iconHeight + gapY)
  };
}

export function AppInner() {
  const { getApp, submitDrop } = useCatalog();
  const { showAlert } = useAlert();
  const { user, isAuthenticated, authLoading, openAuthModal } = useAuth();
  const [editingApp, setEditingApp] = useState<AppListing | null>(null);
  const [liveSandboxApp, setLiveSandboxApp] = useState<AppListing | null>(null);

  // (The INBOX desktop badge that polled the cloud /api/inbox unread count was
  // removed in task #42: the INBOX window now shows LOCAL agent mail from the
  // loopback agent-inboxes service, so a cloud-inbox count would be misleading.
  // The window's own status strip shows CONNECTED/OFFLINE.)
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

  // Standalone Subdomain / Route Wrappers
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
                  // Only auto-close when the product is genuinely active; otherwise
                  // keep the editor open so the maker sees the honest state banner.
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
        // Standalone "what is this" route: reuse the consolidated About/README window.
        // App links navigate to the main Web OS (that's where the windows live).
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
      case 'slopshop': return renderStandaloneWrapper(route.title || "SLOPSHOP", <SlopshopView />);
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
  } = useWindowManager(user);

  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [theme, setTheme] = useState<'teal' | 'matrix' | 'sunset' | 'navy'>('teal');

  // Auto-open SETUP for genuine first-run / logged-out visitors — but only AFTER the
  // session check resolves. The setup window is closed on first paint (see
  // useWindowManager); we open it here once we actually know the auth state, so a
  // returning logged-in user never sees it flash open then closed on refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (authLoading) return; // wait until we know whether there's a session
    const SETUP_SEEN_KEY = 'nsw_setup_wizard_seen';
    const hasSeenSetup = localStorage.getItem(SETUP_SEEN_KEY);
    // Show the welcome wizard to first-time visitors and to anyone not logged in
    // (they still need to create an account). Returning logged-in users skip it.
    if (!isAuthenticated || !hasSeenSetup) {
      openWindow('setup');
      localStorage.setItem(SETUP_SEEN_KEY, 'true');
    }
  }, [authLoading, isAuthenticated, openWindow]);

  const [iconPositions, setIconPositions] = useState<Record<string, { x: number; y: number }>>(loadSavedIconPositions);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  const handleIconPositionChange = (id: string, pos: { x: number; y: number }) => {
    setIconPositions(prev => {
      const next = { ...prev, [id]: pos };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(ICON_POSITIONS_KEY, JSON.stringify(next));
        } catch {
          // Ignore storage failures
        }
      }
      return next;
    });
  };

  // Right-click context menu (Win95-style). `target` is 'desktop' or an icon id.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: string } | null>(null);

  // "Align to grid" — drop every saved position so all icons fall back to the
  // default grid (getDefaultIconPosition), snapping them into clean columns.
  const alignIconsToGrid = () => {
    playClickSound();
    setIconPositions({});
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(ICON_POSITIONS_KEY); } catch { /* ignore */ }
    }
  };

  const openContextMenu = (e: React.MouseEvent, target: string) => {
    // Take over the browser's native right-click menu with our own.
    e.preventDefault();
    e.stopPropagation();
    playClickSound();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  };

  const handleDesktopPointerDown = (e: React.PointerEvent) => {
    if (
      (e.target as HTMLElement).closest('.RetroWindow') ||
      (e.target as HTMLElement).closest('.btn-w95') ||
      (e.target as HTMLElement).closest('.start-menu') ||
      (e.target as HTMLElement).closest('.desktop-icon')
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

  // Populated as the desktop icons render (below); read by the right-click menu's
  // "Open" action. Fresh each render so it always reflects the current icon set.
  const desktopIconOpeners: Record<string, () => void> = {};

  return (
    <div
      onPointerDown={handleDesktopPointerDown}
      onPointerMove={handleDesktopPointerMove}
      onPointerUp={handleDesktopPointerUp}
      onContextMenu={(e) => {
        // Only take over the right-click on the bare desktop — let windows,
        // inputs, and links keep their native menu (so text fields still work).
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
      {/* Mobile gate — the fixed Win95 desktop isn't usable below ~768px. Rather than
          fake a responsive rework, show an honest full-screen notice on small screens
          (Tailwind md: = 768px, so this is visible only below that) with a way into the
          explainer. No modern animation; stays in the retro aesthetic. */}
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

      {/* Top Right Controls & Greeting */}
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
        {isAuthenticated && user ? (
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

      {/* Desktop App Icons. Order = the clean default grid layout (fills column 1
          top-to-bottom, then column 2): entry point first, then core apps, then
          utilities, then docs/links. README_FIRST was removed (redundant with
          WHAT_IS_THIS). Users can still drag + "Align Icons to Grid" to reset. */}
      {[
        {
          id: 'setup',
          label: 'SETUP.EXE (START HERE)',
          icon: '🚀',
          onClick: () => { playClickSound(); openWindow('setup'); }
        },
        {
          id: 'whatis',
          label: 'WHAT_IS_THIS.TXT',
          icon: '❓',
          onClick: () => { playClickSound(); openWindow('mktg'); }
        },
        {
          id: 'hotwire',
          label: 'HOTWIRE (Drops)',
          icon: '🔥',
          onClick: () => { playClickSound(); openWindow('hotwire'); }
        },
        {
          id: 'gitsmith',
          label: 'GITSMITH (Forge)',
          icon: '📁',
          onClick: () => { playClickSound(); openWindow('gitsmith'); }
        },
        {
          id: 'slopshop',
          label: 'SLOPSHOP (AI Mod)',
          icon: '🔧',
          onClick: () => { playClickSound(); openWindow('slopshop'); }
        },
        {
          id: 'inbox',
          label: 'Agent Inbox',
          icon: '📫',
          onClick: () => { playClickSound(); openWindow('inbox'); }
        },
        {
          id: 'dyno',
          label: 'DYNO (Speedometer)',
          icon: '🏎️',
          onClick: () => { playClickSound(); openWindow('dyno'); }
        },
        {
          id: 'chat',
          label: 'CHAT (IRC)',
          icon: '💬',
          onClick: () => { playClickSound(); openWindow('chat'); }
        },
        {
          id: 'terminal',
          label: 'TERMINAL.EXE',
          icon: '💻',
          onClick: () => { playClickSound(); openWindow('terminal'); }
        },
        {
          id: 'profile',
          label: 'ACCOUNT.CFG (Profile)',
          icon: '👤',
          onClick: () => { playClickSound(); openWindow('profile'); }
        },
        {
          id: 'papers',
          label: 'WHITE_PAPERS.DOC',
          icon: '📖',
          onClick: () => { playClickSound(); openWindow('papers'); }
        },
        {
          id: 'github',
          label: 'Source on GitHub',
          icon: '🌐',
          onClick: () => { playClickSound(); window.open('https://github.com/natemcguire/nates-software', '_blank'); }
        }
      ].map((item, index) => {
        const pos = iconPositions[item.id] || getDefaultIconPosition(index);
        // Record each icon's opener so the right-click "Open" action can invoke it.
        desktopIconOpeners[item.id] = item.onClick;
        return (
          <DesktopIcon
            key={item.id}
            id={item.id}
            label={item.label}
            icon={item.icon}
            position={pos}
            onPositionChange={(newPos) => handleIconPositionChange(item.id, newPos)}
            onClick={item.onClick}
            onContextMenu={(e) => openContextMenu(e, item.id)}
            onOpen={item.onClick}
          />
        );
      })}

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

      {/* Floating Application Windows */}

      {/* 0. SETUP.EXE — 1-Click Fork Quickstart Wizard */}
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

      {/* 0. Marketing / About Readme */}
      <ErrorBoundary
        key={`mktg-${windows.mktg.isOpen}`}
        fallbackTitle="README_FIRST.TXT"
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

      {/* 0.1 Product Explainer — now consolidated into the README/About window above. */}

      {/* 0.5 CHAT IRC Chatroom Window */}
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

      {/* 1. Terminal DOS Shell */}
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

      {/* 2. Hotwire Drops */}
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

      {/* 3. Slopshop AI Speed Shop */}
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
          <SlopshopView />
        </RetroWindow>
      </ErrorBoundary>

      {/* RIG.EXE was removed as a user-facing app (task #41). RIG is now an
          invisible engine — the deploy build pipeline (executeRigDeployBuild),
          merge verification, and SLOPSHOP's live-run gateway. No window here. */}

      {/* 5. Inbox Merge Discussions */}
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

      {/* 6. Dyno Workstation Speedometer */}
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

      {/* 7. Technical White Papers */}
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

      {/* 8. User Profile & My Shelf */}
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

      {/* 9. Gitsmith GitHub-Style Forge */}
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

      {/* Pop-Up Start Menu */}
      {restarting && <RestartOverlay />}
      <StartMenu
        isOpen={startMenuOpen}
        onClose={() => setStartMenuOpen(false)}
        onOpenWindow={openWindow}
        onRestart={() => setRestarting(true)}
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
                  const honestStatus = res.productStatus || 'draft';
                  showAlert(
                    honestStatus === 'active'
                      ? `Drop "${updatedApp.name}" (${updatedApp.version}) published and is live for purchase!`
                      : `Drop "${updatedApp.name}" (${updatedApp.version}) saved as a DRAFT — ${res.message || 'link a deployable repository before it can be sold.'}`,
                    "Drop Published",
                    honestStatus === 'active' ? "success" : "info"
                  );
                  // Only auto-close when the product is genuinely active; otherwise
                  // keep the editor open so the maker sees the honest state banner.
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

      {/* Live Sandbox Modal Overlay */}
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

      {/* Authentic Win95 Desktop Taskbar */}
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
