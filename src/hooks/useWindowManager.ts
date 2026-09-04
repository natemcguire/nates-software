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

const getResponsiveWindowConfig = (
  offset: number,
  defaultW: number,
  defaultH: number,
  mode: 'portrait' | 'landscape' | 'balanced' = 'landscape'
) => {
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 900;
  const availableH = screenH - 50;

  const isHighRes = screenW >= 1600;
  const isUltraWide = screenW >= 2000;

  let baseW = defaultW;
  let baseH = defaultH;

  if (mode === 'portrait') {
    baseH = Math.min(Math.round(availableH * 0.88), Math.max(defaultH, 780));
    baseW = Math.min(defaultW, Math.round(baseH * 0.8));
  } else if (mode === 'landscape') {
    if (isUltraWide) {
      baseW = Math.min(Math.round(defaultW * 1.2), screenW - 120);
      baseH = Math.min(Math.round(defaultH * 1.15), availableH - 60);
    } else if (isHighRes) {
      baseW = Math.min(Math.round(defaultW * 1.1), screenW - 80);
      baseH = Math.min(Math.round(defaultH * 1.08), availableH - 60);
    }
  }

  const w = Math.min(baseW, screenW - 32);
  const h = Math.min(baseH, availableH - 30);

  const maxX = Math.max(30, screenW - w - 20);
  const maxY = Math.max(25, availableH - h - 10);

  const posX = Math.min(maxX, Math.max(30, Math.floor((screenW - w) / 2) + offset));
  const posY = Math.min(maxY, Math.max(25, Math.floor((availableH - h) / 2) + offset));

  return { x: posX, y: posY, width: Math.max(480, w), height: Math.max(380, h) };
};

export function useWindowManager(user?: AuthUser | null) {
  const setupConfig = getResponsiveWindowConfig(0, 840, 580, 'balanced');
  const mktgConfig = getResponsiveWindowConfig(40, 660, 820, 'portrait');
  const hotwireConfig = getResponsiveWindowConfig(80, 1200, 760, 'landscape');
  const slopshopConfig = getResponsiveWindowConfig(120, 1140, 720, 'landscape');
  const inboxConfig = getResponsiveWindowConfig(90, 1140, 720, 'landscape');
  const papersConfig = getResponsiveWindowConfig(50, 1160, 760, 'landscape');
  const dynoConfig = getResponsiveWindowConfig(100, 1040, 640, 'landscape');
  const profileConfig = getResponsiveWindowConfig(60, 1120, 720, 'landscape');
  const gitsmithConfig = getResponsiveWindowConfig(110, 1200, 760, 'landscape');
  const chatConfig = getResponsiveWindowConfig(70, 960, 640, 'balanced');
  const terminalConfig = getResponsiveWindowConfig(130, 920, 580, 'balanced');

  const getInboxTitle = (u?: AuthUser | null) =>
    u?.username
      ? `INBOX — [@${u.username}'s inbox · 3-Pane Agent Mailbox]`
      : "INBOX — [Local Agent Mailbox · 3-Pane Observer]";

  const [windows, setWindows] = useState<Record<string, WindowState>>({
    setup: {
      id: 'setup',
      title: "SETUP.EXE — [Welcome & 1-Click Fork Quickstart Wizard]",
      icon: '🚀',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: setupConfig.x,
      y: setupConfig.y,
      width: setupConfig.width,
      height: setupConfig.height,
      zIndex: 10
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
      title: "HOTWIRE — [What's Hot · Live Code Library]",
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
      title: "GITSMITH — [Bare Git Forge & Repos over SSH]",
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
    setWindows(curr => {
      const target = curr[id];
      if (!target) return curr;
      const maxZ = Math.max(10, ...Object.values(curr).map(w => w.zIndex || 0));
      const nextZ = maxZ + 1;
      setTopZ(nextZ);
      return {
        ...curr,
        [id]: { ...target, zIndex: nextZ, isMinimized: false }
      };
    });
  }, []);

  const openWindow = useCallback((id: string) => {
    setActiveWindowId(id);
    setWindows(curr => {
      const target = curr[id];
      if (!target) return curr;

      const screenW = typeof window !== 'undefined' ? window.innerWidth : 1440;
      const screenH = typeof window !== 'undefined' ? window.innerHeight : 900;
      const taskbarH = 40;
      const w = target.width;
      const h = target.height;
      const centerX = Math.max(20, Math.floor((screenW - w) / 2));
      const centerY = Math.max(20, Math.floor((screenH - h - taskbarH) / 2));

      const occupied = Object.entries(curr)
        .filter(([wid, ws]) => wid !== id && ws.isOpen && !ws.isMinimized)
        .map(([, ws]) => ({ x: ws.x, y: ws.y }));

      const STEP = 52;
      const NEAR = 36;
      const maxX = Math.max(centerX, screenW - w - 20);
      const maxY = Math.max(centerY, screenH - h - taskbarH - 20);

      let x = target.isOpen ? target.x : centerX;
      let y = target.isOpen ? target.y : centerY;
      if (!target.isOpen) {
        for (let i = 0; i < occupied.length + 1; i++) {
          const collides = occupied.some(o => Math.abs(o.x - x) < NEAR && Math.abs(o.y - y) < NEAR);
          if (!collides) break;
          x += STEP;
          y += STEP;
          if (x > maxX || y > maxY) {
            x = Math.min(maxX, 30 + ((i % 6) + 1) * 36);
            y = Math.min(maxY, 25 + ((i % 6) + 1) * 36);
          }
        }
      }

      const maxZ = Math.max(10, ...Object.values(curr).map(w => w.zIndex || 0));
      const nextZ = maxZ + 1;
      setTopZ(nextZ);

      return {
        ...curr,
        [id]: { ...target, isOpen: true, isMinimized: false, zIndex: nextZ, x, y }
      };
    });
  }, []);

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
