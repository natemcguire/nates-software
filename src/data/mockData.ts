export interface AppComment {
  id: string;
  author: string;
  avatar: string;
  time: string;
  text: string;
  upvotes: number;
  isMaker?: boolean;
}

export interface AppListing {
  id: string;
  name: string;
  creator: string;
  creatorAvatar: string;
  tagline: string;
  description: string;
  version: string;
  price: string;
  upvotes: number;
  forkCount: number;
  forks: number;
  parentApp?: string;
  lineageDepth: number;
  license: string;
  sqlitePath: string;
  storage: string;
  moddabilityScore: number;
  mergeCleanliness: string;
  tags: string[];
  binaries: {
    mac: string;
    win: string;
    linux: string;
    ios: string;
  };
  screenshots: string[];
  techStack: string[];
  comments?: AppComment[];
}

export interface InboxThread {
  id: string;
  from: string;
  subject: string;
  time: string;
  body: string;
  unread: boolean;
  featureRef: string;
}

export const INITIAL_APPS: AppListing[] = [
  {
    id: "dronehunter",
    name: "DroneHunter 95",
    creator: "nate",
    creatorAvatar: "🎯",
    tagline: "Tactical Radar Interceptor & Anti-Drone Battery with SQLite Telemetry",
    description: "Real-time 360° radar sweep HUD and tactical counter-drone missile interceptor. Records telemetry, target locks, and kill confirmations directly to /data/dronehunter.sqlite in WAL mode.",
    version: "1.0.0",
    price: "$19.00",
    upvotes: 42,
    forks: 0,
    forkCount: 0,
    lineageDepth: 0,
    license: "Sovereign Shareware Title",
    sqlitePath: "/data/dronehunter.sqlite",
    storage: "Single-file SQLite WAL (/data/dronehunter.sqlite)",
    moddabilityScore: 96,
    mergeCleanliness: "99.8% clean",
    screenshots: [
      "https://images.unsplash.com/photo-1508614589041-895b88991e3e?auto=format&fit=crop&w=1000&q=80",
      "https://images.unsplash.com/photo-1527977966376-1c8408f9f108?auto=format&fit=crop&w=1000&q=80"
    ],
    techStack: ["HTML5 Canvas", "WASM SQLite 3.45", "Web Audio API", "Metal Shaders"],
    tags: ["Defense", "Radar", "SQLite", "Simulation"],
    binaries: {
      mac: "DroneHunter-1.0.0.dmg (16.4MB)",
      win: "DroneHunter-Setup.exe (19.8MB)",
      linux: "DroneHunter.AppImage (17.2MB)",
      ios: "TestFlight Public Beta"
    },
    comments: [
      {
        id: "c-dh1",
        author: "josh",
        avatar: "⛵",
        time: "5 mins ago",
        text: "Radar sweep is smooth as butter. Just tested the EMP counter-measure against 3 targets and zero WAL locks.",
        upvotes: 6
      }
    ]
  },
  {
    id: "wallart",
    name: "WallArt Canvas Pro",
    creator: "nate",
    creatorAvatar: "⚡",
    tagline: "Custom Frame Matting & Multi-Panel Triptych Splits (300 DPI Export)",
    description: "Transform photos into museum-quality gallery wall canvases. Supports Solid Walnut, Natural Oak, Matte Black, and Gallery Wrap frames across Single, 3-Piece Triptych, and 4-Grid displays.",
    version: "2.4.0",
    price: "$25.00",
    upvotes: 384,
    forks: 112,
    forkCount: 112,
    lineageDepth: 0,
    license: "Sovereign Shareware Title",
    sqlitePath: "/data/wallart.sqlite",
    storage: "Single-file SQLite WAL (/data/wallart.sqlite)",
    moddabilityScore: 98,
    mergeCleanliness: "99.8% clean",
    screenshots: [
      "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=1000&q=80",
      "https://images.unsplash.com/photo-1582561424760-0321d75e81fa?auto=format&fit=crop&w=1000&q=80"
    ],
    techStack: ["React 19", "3D Canvas Matrix", "WASM SQLite 3.45", "300 DPI TIFF Engine"],
    tags: ["Design", "Art", "SQLite", "Local-First"],
    binaries: {
      mac: "WallArt-2.4.0.dmg (24.1MB)",
      win: "WallArt-Setup.exe (28.4MB)",
      linux: "WallArt.AppImage (25.0MB)",
      ios: "TestFlight Link Active"
    },
    comments: [
      {
        id: "c-1",
        author: "josh",
        avatar: "⛵",
        time: "2 hours ago",
        text: "The 3-panel triptych split on solid walnut with custom photo upload is incredible.",
        upvotes: 14
      }
    ]
  },
  {
    id: "retro-calc",
    name: "RetroCalc Pro",
    creator: "sam",
    creatorAvatar: "👨‍💻",
    tagline: "Terminal-Style Compound Accounting Ledger with SQLite Journaling",
    description: "Classic green-phosphor financial engine with double-entry bookkeeping and zero cloud lock-in.",
    version: "1.2.0",
    price: "$15.00",
    upvotes: 248,
    forks: 84,
    forkCount: 84,
    parentApp: "calc-core",
    lineageDepth: 1,
    license: "Sovereign Shareware Title",
    sqlitePath: "/data/app.sqlite",
    storage: "Single-file SQLite WAL (/data/app.sqlite)",
    moddabilityScore: 94,
    mergeCleanliness: "99.4% clean",
    screenshots: [
      "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1000&q=80"
    ],
    techStack: ["React 19", "SQLite WAL", "WASM 3.45"],
    tags: ["Finance", "SQLite", "Local-First", "React 19"],
    binaries: {
      mac: "RetroCalc-1.2.0.dmg (14.2MB)",
      win: "RetroCalc-Setup-1.2.0.exe (18.4MB)",
      linux: "RetroCalc-1.2.0.AppImage (16.1MB)",
      ios: "Apple TestFlight Public Beta Link"
    },
    comments: []
  },
  {
    id: "sailtrack",
    name: "SailTrack GPS",
    creator: "nate",
    creatorAvatar: "⛵",
    tagline: "Tactical Regatta Telemetry HUD & Polar Speed Optimization",
    description: "High-precision NMEA polar velocity solver and tactical racing marks recorder.",
    version: "2.1.0",
    price: "$35.00",
    upvotes: 192,
    forks: 46,
    forkCount: 46,
    lineageDepth: 0,
    license: "Sovereign Shareware Title",
    sqlitePath: "/data/telemetry.sqlite",
    storage: "Single-file SQLite WAL (/data/telemetry.sqlite)",
    moddabilityScore: 91,
    mergeCleanliness: "98.8% clean",
    screenshots: [
      "https://images.unsplash.com/photo-1500917293891-ef795e70e1f6?auto=format&fit=crop&w=1000&q=80"
    ],
    techStack: ["React 19", "NMEA 0183 Engine", "SQLite Telemetry"],
    tags: ["Marine", "GPS", "Mapping", "Offline"],
    binaries: {
      mac: "SailTrack-2.1.0.dmg (18.0MB)",
      win: "SailTrack-Setup.exe (22.1MB)",
      linux: "SailTrack.AppImage (19.4MB)",
      ios: "TestFlight Link Active"
    },
    comments: []
  }
];

export const APPS_DATA: AppListing[] = INITIAL_APPS;

export const INBOX_THREADS: InboxThread[] = [
  {
    id: "1",
    from: "Sam Altman (@sam)",
    subject: "PR #14: Spliced OCR Receipt Scanner into RetroCalc",
    time: "12 mins ago",
    body: "Hey Nate, I completed the optical character recognition feature on refs/features/receipt-ocr/v1.2.0. Parsed 22 AST nodes and applied 004_receipts.sql. All 4 automated test assertions passed in 0.04s.",
    unread: true,
    featureRef: "refs/features/receipt-ocr/v1.2.0"
  }
];
