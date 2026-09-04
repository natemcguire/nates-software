import { useState, useCallback, useEffect } from 'react';
import type { AuthUser } from '../context/AuthContext';

export interface WindowState {
  id: string;
  title: string;
  icon: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  prevBounds?: { x: number; y: number; width: number; height: number };
  zIndex: number;
}

const getResponsiveWindowConfig = (offset: number, defaultW: number, defaultH: number) => {
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 900;
  
  // Scale window dimensions up on high-res displays
  const isHighRes = screenW >= 1600;
  const isUltraWide = screenW >= 2000;
  
  const w = isUltraWide 
    ? Math.min(Math.round(defaultW * 1.2), screenW - 120)
    : isHighRes 
    ? Math.min(Math.round(defaultW * 1.1), screenW - 80)
    : Math.min(defaultW, screenW - 40);

  const h = isHighRes 
    ? Math.min(Math.round(defaultH * 1.1), screenH - 120)
    : Math.min(defaultH, screenH - 80);

  const posX = Math.max(30, Math.floor((screenW - w) / 2) + offset);
  const posY = Math.max(25, Math.floor((screenH - h - 40) / 2) + offset);

  return { x: posX, y: posY, width: w, height: h };
};

export function useWindowManager(user?: AuthUser | null) {
  const setupConfig = getResponsiveWindowConfig(0, 880, 580);
  const mktgConfig = getResponsiveWindowConfig(10, 1080, 680);
  const hotwireConfig = getResponsiveWindowConfig(25, 1180, 740);
  const slopshopConfig = getResponsiveWindowConfig(45, 1120, 700);
  const inboxConfig = getResponsiveWindowConfig(35, 1120, 700);
  const papersConfig = getResponsiveWindowConfig(15, 1140, 720);
  const dynoConfig = getResponsiveWindowConfig(30, 1000, 600);
  const profileConfig = getResponsiveWindowConfig(20, 1100, 700);
  const gitsmithConfig = getResponsiveWindowConfig(35, 1180, 740);
  const chatConfig = getResponsiveWindowConfig(20, 960, 620);
  const terminalConfig = getResponsiveWindowConfig(50, 900, 560);

  const getInboxTitle = (u?: AuthUser | null) =>
    u?.username
      ? `INBOX — [@${u.username}'s inbox · 3-Pane Agent Mailbox]`
      : "INBOX — [Local Agent Mailbox · 3-Pane Observer]";

  const [windows, setWindows] = useState<Record<string, WindowState>>({
    setup: {
      id: 'setup',
      title: "SETUP.EXE — [Welcome & 1-Click Fork Quickstart Wizard]",
      icon: '🚀',
      // Closed on first paint; App opens it (once) after the session check resolves,
      // only for genuine first-run / logged-out visitors. Opening-by-default and then
      // closing for returning users caused the window to flash on every refresh.
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: setupConfig.x,
      y: setupConfig.y,
      width: setupConfig.width,
      height: setupConfig.height,
      zIndex: 100
    },
    mktg: {
      id: 'mktg',
      title: "About Nate's Software — [WHAT_IS_THIS.TXT]",
      icon: '📄',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: mktgConfig.x,
      y: mktgConfig.y,
      width: mktgConfig.width,
      height: mktgConfig.height,
      zIndex: 10
    },
  hotwire: {
      id: 'hotwire',
      title: "HOTWIRE — [Daily Drops & Claude Artifact Sandbox]",
      icon: '🔥',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: hotwireConfig.x,
      y: hotwireConfig.y,
      width: hotwireConfig.width,
      height: hotwireConfig.height,
      zIndex: 11
    },
    slopshop: {
      id: 'slopshop',
      title: "SLOPSHOP — [Headless Local AI Agent Launchpad & Worktree Forge]",
      icon: '🛠️',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: slopshopConfig.x,
      y: slopshopConfig.y,
      width: slopshopConfig.width,
      height: slopshopConfig.height,
      zIndex: 12
    },
    inbox: {
      id: 'inbox',
      title: getInboxTitle(user),
      icon: '📬',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: inboxConfig.x,
      y: inboxConfig.y,
      width: inboxConfig.width,
      height: inboxConfig.height,
      zIndex: 13
    },
    papers: {
      id: 'papers',
      title: "Architectural White Papers — [5 Standalone Open Source Engines]",
      icon: '📖',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: papersConfig.x,
      y: papersConfig.y,
      width: papersConfig.width,
      height: papersConfig.height,
      zIndex: 15
    },
    dyno: {
      id: 'dyno',
      title: "DYNO — [Nate's AI Workstation & Token Speedometer]",
      icon: '🏎️',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: dynoConfig.x,
      y: dynoConfig.y,
      width: dynoConfig.width,
      height: dynoConfig.height,
      zIndex: 16
    },
    profile: {
      id: 'profile',
      title: "ACCOUNT.CFG — [Account, Owned Apps & SSH Keys]",
      icon: '👤',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: profileConfig.x,
      y: profileConfig.y,
      width: profileConfig.width,
      height: profileConfig.height,
      zIndex: 17
    },
    gitsmith: {
      id: 'gitsmith',
      title: "GITSMITH — [GitHub-Style Bare Git Forge & Repos]",
      icon: '📁',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: gitsmithConfig.x,
      y: gitsmithConfig.y,
      width: gitsmithConfig.width,
      height: gitsmithConfig.height,
      zIndex: 19
    },
    chat: {
      id: 'chat',
      title: "CHAT — [#lounge · IRC Chatroom & Presence]",
      icon: '💬',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: chatConfig.x,
      y: chatConfig.y,
      width: chatConfig.width,
      height: chatConfig.height,
      zIndex: 18
    },
    terminal: {
      id: 'terminal',
      title: "TERMINAL.EXE — [Interactive DOS Shell]",
      icon: '💻',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: terminalConfig.x,
      y: terminalConfig.y,
      width: terminalConfig.width,
      height: terminalConfig.height,
      zIndex: 18
    }
  });

  const [activeWindowId, setActiveWindowId] = useState<string>('mktg');
  const [topZ, setTopZ] = useState<number>(20);

  useEffect(() => {
    const inboxTitle = getInboxTitle(user);
    setWindows(curr => {
      if (!curr.inbox || curr.inbox.title === inboxTitle) return curr;
      return {
        ...curr,
        inbox: {
          ...curr.inbox,
          title: inboxTitle
        }
      };
    });
  }, [user?.username]);

  const focusWindow = useCallback((id: string) => {
    setActiveWindowId(id);
    setTopZ(prev => {
      const next = prev + 1;
      setWindows(curr => ({
        ...curr,
        [id]: { ...curr[id], zIndex: next, isMinimized: false }
      }));
      return next;
    });
  }, []);

  const openWindow = useCallback((id: string) => {
    setWindows(curr => {
      const target = curr[id];
      if (!target) return curr;

      // Smart placement: aim for the centered free spot; if another open window
      // already sits there, cascade-offset until we find open space, wrapping
      // back toward the top-left when we run past the usable area.
      const screenW = typeof window !== 'undefined' ? window.innerWidth : 1440;
      const screenH = typeof window !== 'undefined' ? window.innerHeight : 900;
      const taskbarH = 40;
      const w = target.width;
      const h = target.height;
      const centerX = Math.max(20, Math.floor((screenW - w) / 2));
      const centerY = Math.max(20, Math.floor((screenH - h - taskbarH) / 2));

      // Top-left corners of other currently-open, non-minimized windows.
      const occupied = Object.entries(curr)
        .filter(([wid, ws]) => wid !== id && ws.isOpen && !ws.isMinimized)
        .map(([, ws]) => ({ x: ws.x, y: ws.y }));

      const STEP = 32;               // cascade step per collision
      const NEAR = 24;               // how close counts as "same spot"
      const maxX = Math.max(centerX, screenW - w - 20);
      const maxY = Math.max(centerY, screenH - h - taskbarH - 20);

      let x = centerX;
      let y = centerY;
      // Cascade until the slot is clear of other windows' top-lefts, capped so
      // we never loop forever (fall back to a wrapped offset from center).
      for (let i = 0; i < occupied.length + 1; i++) {
        const collides = occupied.some(o => Math.abs(o.x - x) < NEAR && Math.abs(o.y - y) < NEAR);
        if (!collides) break;
        x += STEP;
        y += STEP;
        if (x > maxX || y > maxY) {
          // Wrapped past the usable area — nudge back near center with a small
          // varying offset so it doesn't land exactly on the centered stack.
          x = Math.min(maxX, centerX + ((i % 5) + 1) * 16);
          y = Math.min(maxY, centerY + ((i % 5) + 1) * 16);
        }
      }

      return {
        ...curr,
        [id]: { ...target, isOpen: true, isMinimized: false, x, y }
      };
    });
    focusWindow(id);
  }, [focusWindow]);

  const closeWindow = useCallback((id: string) => {
    setWindows(curr => ({
      ...curr,
      [id]: { ...curr[id], isOpen: false }
    }));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows(curr => ({
      ...curr,
      [id]: { ...curr[id], isMinimized: true }
    }));
  }, []);

  const toggleMaximizeWindow = useCallback((id: string) => {
    setWindows(curr => {
      const target = curr[id];
      if (!target) return curr;

      if (target.isMaximized) {
        const prev = target.prevBounds || { x: 100, y: 50, width: 1080, height: 680 };
        return {
          ...curr,
          [id]: {
            ...target,
            isMaximized: false,
            x: prev.x,
            y: prev.y,
            width: prev.width,
            height: prev.height
          }
        };
      } else {
        return {
          ...curr,
          [id]: {
            ...target,
            isMaximized: true,
            prevBounds: {
              x: target.x,
              y: target.y,
              width: target.width,
              height: target.height
            },
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight - 44
          }
        };
      }
    });
    focusWindow(id);
  }, [focusWindow]);

  const updateWindowPosition = useCallback((id: string, x: number, y: number) => {
    setWindows(curr => {
      const target = curr[id];
      if (!target || target.isMaximized) return curr;
      return {
        ...curr,
        [id]: { ...target, x: Math.max(0, x), y: Math.max(0, y) }
      };
    });
  }, []);

  const updateWindowSize = useCallback((id: string, w: number, h: number, x?: number, y?: number) => {
    setWindows(curr => {
      const target = curr[id];
      if (!target || target.isMaximized) return curr;
      return {
        ...curr,
        [id]: {
          ...target,
          width: Math.max(540, w),
          height: Math.max(400, h),
          x: x !== undefined ? Math.max(0, x) : target.x,
          y: y !== undefined ? Math.max(0, y) : target.y
        }
      };
    });
  }, []);

  return {
    windows,
    activeWindowId,
    topZ,
    openWindow,
    closeWindow,
    minimizeWindow,
    toggleMaximizeWindow,
    focusWindow,
    updateWindowPosition,
    updateWindowSize
  };
}
