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
    tagline: "Retro Duck Hunt-Style Arcade Drone Shooter with SQLite High Scores",
    description: "Fast-paced arcade browser game inspired by classic Duck Hunt. Double-barrel shotgun reloads, laughing dog animations, drone explosions, and local SQLite high score telemetry in WAL mode.",
    version: "1.0.0",
    price: "$19.00",
    upvotes: 420,
    forks: 88,
    forkCount: 88,
    lineageDepth: 0,
    license: "MIT Sovereign Shareware",
    sqlitePath: "/data/dronehunter.sqlite",
    storage: "Single-file SQLite WAL (/data/dronehunter.sqlite)",
    moddabilityScore: 98,
    mergeCleanliness: "100% clean",
    screenshots: [
      "/dronehunter-ephemeral-screenshot.png",
      "https://nates-software.pages.dev/dronehunter-ephemeral-screenshot.png"
    ],
    techStack: ["HTML5 Canvas", "Pixel Art Engine", "WASM SQLite 3.45", "Web Audio API"],
    tags: ["Arcade", "Retro", "Duck Hunt", "SQLite WAL"],
    binaries: {
      mac: "DroneHunter-1.0.0.dmg (16.4MB)",
      win: "DroneHunter-Setup.exe (19.8MB)",
      linux: "DroneHunter.AppImage (17.2MB)",
      ios: "TestFlight Link Active"
    },
    comments: [
      {
        id: "c-dh1",
        author: "josh",
        avatar: "⛵",
        time: "10 mins ago",
        text: "The Duck Hunt dog laughing animation when the drone escapes is pure nostalgia. Runs like a dream.",
        upvotes: 24,
        isMaker: false
      },
      {
        id: "c-dh2",
        author: "nate",
        avatar: "⚡",
        time: "Just now",
        text: "Pushed the raw HTML5 arcade engine with /data/dronehunter.sqlite WAL logging.",
        upvotes: 38,
        isMaker: true
      }
    ]
  },
  {
    id: "certified-mailer",
    name: "Certified Mailer",
    creator: "nate",
    creatorAvatar: "📫",
    tagline: "USPS Certified Mail, Electronic Return Receipt (ERR) & Dispute Tooling",
    description: "Private legal dispute and operational correspondence engine. Renders manifests to flattened high-DPI PDFs (preventing provider font substitutions), tracks Electronic Return Receipts (ERR), and connects to LetterStream and Lob APIs.",
    version: "1.0.0",
    price: "$29.00",
    upvotes: 312,
    forks: 46,
    forkCount: 46,
    lineageDepth: 0,
    license: "MIT Sovereign Legal Tool",
    sqlitePath: "/data/certified-mailer.sqlite",
    storage: "Single-file SQLite WAL (/data/certified-mailer.sqlite)",
    moddabilityScore: 95,
    mergeCleanliness: "99.9% clean",
    screenshots: [
      "/certified-mailer-screenshot.png"
    ],
    techStack: ["Python 3.12", "Docx/PDF Renderer", "SQLite WAL", "USPS CASS API"],
    tags: ["Legal", "USPS", "Postal", "Dispute", "SQLite WAL"],
    binaries: {
      mac: "certified-mailer-darwin-arm64 (14.2MB)",
      win: "certified-mailer-win-x64.exe (18.1MB)",
      linux: "certified-mailer-linux-x64 (15.0MB)",
      ios: "CLI Tooling"
    },
    comments: [
      {
        id: "c-cm1",
        author: "sam",
        avatar: "👨‍💻",
        time: "1 hour ago",
        text: "The PDF flattening step is brilliant — completely solved font distortion when uploading to postal print queues.",
        upvotes: 18
      }
    ]
  },
  {
    id: "picfitai",
    name: "PicFit.ai",
    creator: "nate",
    creatorAvatar: "✨",
    tagline: "AI Virtual Try-On Studio & Outfit Synthesis Engine with Gemini Vision",
    description: "Hyper-realistic virtual fitting room powered by Google Gemini Vision. Seamlessly drape outfits onto portrait photos with sovereign single-file SQLite user credits ledger.",
    version: "1.0.0",
    price: "$39.00",
    upvotes: 284,
    forks: 62,
    forkCount: 62,
    lineageDepth: 0,
    license: "MIT AI Studio Tool",
    sqlitePath: "/data/picfitai.sqlite",
    storage: "Single-file SQLite WAL (/data/picfitai.sqlite)",
    moddabilityScore: 97,
    mergeCleanliness: "99.5% clean",
    screenshots: [
      "/picfitai-screenshot.png"
    ],
    techStack: ["Google Gemini Vision", "Neural Mesh Warping", "PHP / TS", "SQLite WAL"],
    tags: ["AI", "Fashion", "Gemini", "Try-On", "SQLite WAL"],
    binaries: {
      mac: "PicFitAI-1.0.0.dmg (32.4MB)",
      win: "PicFitAI-Setup.exe (38.1MB)",
      linux: "PicFitAI.AppImage (34.0MB)",
      ios: "Web App Active"
    },
    comments: [
      {
        id: "c-pf1",
        author: "alex",
        avatar: "🎨",
        time: "3 hours ago",
        text: "Outfit synthesis with Gemini Vision keeps face and body contours completely intact. Instant 4K render.",
        upvotes: 15
      }
    ]
  }
];

export const MOCK_INBOX_THREADS: InboxThread[] = [
  {
    id: "th-1",
    from: "josh@eastbayprojects.com",
    subject: "🎯 DroneHunter High Score WAL Sync",
    time: "10:14 AM",
    body: "Nate, the high score table in /data/dronehunter.sqlite is syncing flawlessly under concurrent dog animations. Ready for the 12:01 AM batch.",
    unread: true,
    featureRef: "refs/features/dronehunter-highscores"
  },
  {
    id: "th-2",
    from: "sam@husbandlabs.com",
    subject: "📫 Certified Mailer Electronic Return Receipts",
    time: "Yesterday",
    body: "Tested the PDF flattening tool on the dispute letter generator. Zero font metric substitutions on LetterStream upload.",
    unread: false,
    featureRef: "refs/features/certified-mailer-err"
  },
  {
    id: "th-3",
    from: "nate@eastbayprojects.com",
    subject: "✨ PicFit.ai Gemini Vision Try-On Release",
    time: "Aug 24",
    body: "Virtual Try-On catalog is loaded. Credit debits are recorded directly to /data/picfitai.sqlite in WAL mode.",
    unread: false,
    featureRef: "refs/features/picfitai-gemini"
  }
];

export const APPS_DATA = INITIAL_APPS;
