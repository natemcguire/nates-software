import { useState, useCallback } from 'react';

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

export function useWindowManager() {
  const mktgConfig = getResponsiveWindowConfig(0, 1080, 680);
  const hotwireConfig = getResponsiveWindowConfig(25, 1180, 740);
  const slopshopConfig = getResponsiveWindowConfig(45, 1120, 700);
  const inboxConfig = getResponsiveWindowConfig(35, 1120, 700);
  const rigConfig = getResponsiveWindowConfig(40, 1060, 640);
  const papersConfig = getResponsiveWindowConfig(15, 1140, 720);
  const dynoConfig = getResponsiveWindowConfig(30, 1000, 600);
  const profileConfig = getResponsiveWindowConfig(20, 1100, 700);
  const gitsmithConfig = getResponsiveWindowConfig(35, 1180, 740);
  const terminalConfig = getResponsiveWindowConfig(50, 900, 560);

  const [windows, setWindows] = useState<Record<string, WindowState>>({
    mktg: {
      id: 'mktg',
      title: "About Nate's Software — [README_FIRST.TXT]",
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
      title: "INBOX — [nate@natesoftware · 3-Pane Agent Mailbox]",
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
    rig: {
      id: 'rig',
      title: "RIG.EXE — [Micro-Container & SQLite Volume HUD]",
      icon: '⚙️',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: rigConfig.x,
      y: rigConfig.y,
      width: rigConfig.width,
      height: rigConfig.height,
      zIndex: 14
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
      title: "PROFILE.CFG — [Maker Account, Saved Shelf & SSH Keys]",
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
      isMaximized: true,
      x: gitsmithConfig.x,
      y: gitsmithConfig.y,
      width: gitsmithConfig.width,
      height: gitsmithConfig.height,
      zIndex: 19
    },
    terminal: {
      id: 'terminal',
      title: "TERMINAL.EXE — [Sovereign Interactive DOS Shell]",
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
      return {
        ...curr,
        [id]: { ...target, isOpen: true, isMinimized: false }
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
