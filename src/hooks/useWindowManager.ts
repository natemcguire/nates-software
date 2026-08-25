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

const getInitialPos = (offset: number) => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const isWide = w > 1400;
  const initX = isWide ? Math.max(40, Math.floor((w - 1040) / 2) + offset) : 40 + offset;
  return { x: initX, y: 30 + offset };
};

export function useWindowManager() {
  const pos1 = getInitialPos(0);
  const pos2 = getInitialPos(25);
  const pos3 = getInitialPos(50);
  const pos4 = getInitialPos(35);
  const pos5 = getInitialPos(45);
  const pos6 = getInitialPos(15);

  const [windows, setWindows] = useState<Record<string, WindowState>>({
    mktg: {
      id: 'mktg',
      title: "About Nate's Software — [README_FIRST.TXT]",
      icon: '📄',
      isOpen: true,
      isMinimized: false,
      isMaximized: false,
      x: pos1.x,
      y: pos1.y,
      width: 1020,
      height: 660,
      zIndex: 10
    },
    hotwire: {
      id: 'hotwire',
      title: "HOTWIRE — [Daily Drops & Claude Artifact Sandbox]",
      icon: '🔥',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: pos2.x,
      y: pos2.y,
      width: 1140,
      height: 700,
      zIndex: 11
    },
    slopshop: {
      id: 'slopshop',
      title: "SLOPSHOP — [AI Speed Shop & AST Feature Splicer]",
      icon: '🛠️',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: pos3.x,
      y: pos3.y,
      width: 1040,
      height: 660,
      zIndex: 12
    },
    inbox: {
      id: 'inbox',
      title: "INBOX — [nate@natesoftware · 3-Pane Agent Mailbox]",
      icon: '📬',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: pos4.x,
      y: pos4.y,
      width: 1080,
      height: 680,
      zIndex: 13
    },
    rig: {
      id: 'rig',
      title: "RIG.EXE — [Micro-Container & SQLite Volume HUD]",
      icon: '⚙️',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: pos5.x,
      y: pos5.y,
      width: 980,
      height: 600,
      zIndex: 14
    },
    papers: {
      id: 'papers',
      title: "Architectural White Papers — [5 Standalone Open Source Engines]",
      icon: '📖',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: pos6.x,
      y: pos6.y,
      width: 1060,
      height: 680,
      zIndex: 15
    },
    dyno: {
      id: 'dyno',
      title: "DYNO — [Nate's AI Workstation & Token Speedometer]",
      icon: '🏎️',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: pos1.x + 30,
      y: pos1.y + 30,
      width: 960,
      height: 560,
      zIndex: 16
    },
    profile: {
      id: 'profile',
      title: "PROFILE.CFG — [Maker Account, Saved Shelf & SSH Keys]",
      icon: '👤',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: pos1.x + 20,
      y: pos1.y + 20,
      width: 1040,
      height: 660,
      zIndex: 17
    },
    terminal: {
      id: 'terminal',
      title: "TERMINAL.EXE — [Sovereign Interactive DOS Shell]",
      icon: '💻',
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      x: pos3.x,
      y: pos3.y,
      width: 840,
      height: 520,
      zIndex: 18
    }
  });

  const [activeWindowId, setActiveWindowId] = useState<string>('mktg');
  const [topZ, setTopZ] = useState<number>(20);

  const focusWindow = useCallback((id: string) => {
    setActiveWindowId(id);
    setTopZ(prev => {
      const nextZ = prev + 1;
      setWindows(wins => ({
        ...wins,
        [id]: { ...wins[id], zIndex: nextZ, isMinimized: false }
      }));
      return nextZ;
    });
  }, []);

  const openWindow = useCallback((id: string) => {
    setWindows(wins => {
      const win = wins[id];
      if (!win) return wins;
      return {
        ...wins,
        [id]: { ...win, isOpen: true, isMinimized: false }
      };
    });
    focusWindow(id);
  }, [focusWindow]);

  const closeWindow = useCallback((id: string) => {
    setWindows(wins => ({
      ...wins,
      [id]: { ...wins[id], isOpen: false }
    }));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows(wins => ({
      ...wins,
      [id]: { ...wins[id], isMinimized: true }
    }));
  }, []);

  const toggleMaximizeWindow = useCallback((id: string) => {
    setWindows(wins => {
      const win = wins[id];
      if (!win) return wins;

      if (win.isMaximized) {
        const prev = win.prevBounds || { x: 100, y: 50, width: 1020, height: 660 };
        return {
          ...wins,
          [id]: {
            ...win,
            isMaximized: false,
            x: prev.x,
            y: prev.y,
            width: prev.width,
            height: prev.height
          }
        };
      } else {
        return {
          ...wins,
          [id]: {
            ...win,
            isMaximized: true,
            prevBounds: { x: win.x, y: win.y, width: win.width, height: win.height },
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
    setWindows(wins => {
      const win = wins[id];
      if (!win || win.isMaximized) return wins;
      return {
        ...wins,
        [id]: { ...win, x: Math.max(0, x), y: Math.max(0, y) }
      };
    });
  }, []);

  const updateWindowSize = useCallback((id: string, width: number, height: number, x?: number, y?: number) => {
    setWindows(wins => {
      const win = wins[id];
      if (!win || win.isMaximized) return wins;
      return {
        ...wins,
        [id]: {
          ...win,
          width: Math.max(500, width),
          height: Math.max(380, height),
          x: x !== undefined ? Math.max(0, x) : win.x,
          y: y !== undefined ? Math.max(0, y) : win.y
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
