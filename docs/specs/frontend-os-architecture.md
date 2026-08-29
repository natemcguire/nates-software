# Nate's Software — Front-End Web OS Architecture & Window Manager Spec

## 1. Overview
Nate's Software is implemented as a full web-based operating system adhering to the classic Windows 95 / retro computing paradigm. Every product in the suite runs as an unbundled, floating, draggable, and resizable window on the desktop canvas.

---

## 2. Window Management Engine (`useWindowManager`)

```
                          ┌───────────────────────────┐
                          │   useWindowManager Hook   │
                          └─────────────┬─────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
┌───────────────────────┐    ┌───────────────────────┐    ┌───────────────────────┐
│   Draggable Titlebar  │    │ 8-Direction Resizing  │    │ Maximize / Restore    │
│  Pointer Capture API  │    │  n, s, e, w, ne, nw.. │    │ Toggle on '□' or 2xClk│
└───────────────────────┘    └───────────────────────┘    └───────────────────────┘
           │                            │                            │
           └────────────────────────────┼────────────────────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │ Active Z-Index & Focus    │
                          │ Gradient: Blue vs Gray    │
                          └───────────────────────────┘
```

### Key Window Manager Features:
1. **Fluid Pointer Dragging:**
   * Click and drag on any window title bar to move it across the desktop.
   * Clamped to desktop boundaries so windows cannot get lost off-screen.
2. **8-Way Directional Resizing + Diagonal Grip:**
   * Dedicated resize handles on top (`n`), bottom (`s`), left (`w`), right (`e`), and all four corners (`ne`, `nw`, `se`, `sw`).
   * Authentic bottom-right diagonal grip dots with minimum width/height enforcement (400x300px).
3. **Maximize / Restore Behavior:**
   * Clicking `[□]` (or double-clicking the title bar) snaps the window to fill 100vw and 100vh above the taskbar.
   * Clicking it again restores the window to its exact previous position and size.
4. **Active vs Inactive Window Focus:**
   * Active window receives high-contrast navy gradient title bar (`#000080` to `#1084d0`) and top z-index.
   * Inactive windows dim to classic Windows 95 gray gradient (`#808080` to `#a0a0a0`).
5. **Taskbar & Minimize Mechanics:**
   * Clicking `[_]` minimizes the window into the bottom taskbar.
   * Clicking the taskbar tab restores and raises the window with active focus.
6. **Pop-Up Start Menu:**
   * Cascading Start Menu with vertical "NATE'S 95" brand banner, quick application launch shortcuts, white paper viewer, and session log off.
7. **Desktop Rubberband Selection Box:**
   * Dragging anywhere on the teal wallpaper draws an authentic dotted selection rectangle.

---

## 3. Registered Desktop Applications

1. **`README_FIRST.TXT` (`mktg`):** The marketing hub and suite explainer.
2. **`HOTWIRE.EXE` (`hotwire`):** 12:01 AM daily drops leaderboard with interactive Claude-style artifact sandbox (`RetroCalc Pro`).
3. **`SLOPSHOP.EXE` (`slopshop`):** The AI speed shop with live AST splicing pipeline and terminal logging.
4. **`INBOX.EXE` (`inbox`):** 3-pane email client with 1-click CAS merge proposal approvals.
5. **`RIG_RUNTIME.EXE` (`rig`):** Ephemeral container runtime HUD with resource evidence and optional declared-volume controls.
6. **`WHITE_PAPERS.DOC` (`papers`):** Dedicated in-depth reader for the 5 architectural white papers written by Codex Sol Max.

---

## 4. Cloudflare Edge Deployment

* **Production URL:** `https://nates-software.pages.dev`
* **Technology:** React 19 + TypeScript + Vite + Tailwind CSS on Cloudflare Pages.
* **Storage & Edge Database:** Cloudflare D1 (SQLite) + Cloudflare R2 (zero-egress binaries).
