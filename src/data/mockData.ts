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
  tagline: string;
  description: string;
  creator: string;
  creatorAvatar: string;
  upvotes: number;
  forks: number;
  version: string;
  license: string;
  price: string;
  moddabilityScore: number;
  mergeCleanliness: string;
  storage: string;
  screenshots: string[];
  binaries: {
    mac: string;
    win: string;
    linux: string;
    ios: string;
  };
  tags: string[];
  comments: AppComment[];
}

export const APPS_DATA: AppListing[] = [
  {
    id: "retro-calc",
    name: "RetroCalc Pro",
    tagline: "Local-first accounting calculator with SQLite persistence, compound interest tables, and receipt scanning.",
    description: "RetroCalc Pro is an unbundled, local-first financial calculator built with retro aesthetics and modern precision. It embeds SQLite 3.45 in WAL mode directly on your local disk, eliminating multi-tenant cloud latency. Includes modular receipt scanning OCR, amortization schedules, and zero-collision AST feature modding via SLOPSHOP.",
    creator: "sam",
    creatorAvatar: "👨‍💻",
    upvotes: 248,
    forks: 84,
    version: "v1.2.0",
    license: "MIT",
    price: "Free ($0) or $15 Registered",
    moddabilityScore: 94,
    mergeCleanliness: "99.4% clean",
    storage: "Single-file SQLite WAL (/data/app.sqlite)",
    screenshots: [
      "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80"
    ],
    binaries: {
      mac: "RetroCalc-1.2.0.dmg (14.2MB)",
      win: "RetroCalc-Setup-1.2.0.exe (18.4MB)",
      linux: "RetroCalc-1.2.0.AppImage (16.1MB)",
      ios: "Apple TestFlight Public Beta Link"
    },
    tags: ["Finance", "SQLite", "Local-First", "React 19"],
    comments: [
      {
        id: "c1",
        author: "nate",
        avatar: "⚡",
        time: "2 hours ago",
        text: "Just forked this into SLOPSHOP and spliced the dark mode OLED theme. The SQLite WAL mode integration is super clean — cold-boots instantly in RIG.EXE!",
        upvotes: 18,
        isMaker: false
      },
      {
        id: "c2",
        author: "sam",
        avatar: "👨‍💻",
        time: "1 hour ago",
        text: "Thanks Nate! Next drop will include full multi-currency conversion with offline cached rate tables.",
        upvotes: 12,
        isMaker: true
      },
      {
        id: "c3",
        author: "alice",
        avatar: "👩‍💻",
        time: "30 mins ago",
        text: "The receipt OCR button works great on mobile. Downloaded the macOS .dmg and verified the binary checksum.",
        upvotes: 7,
        isMaker: false
      }
    ]
  },
  {
    id: "sailtrack",
    name: "SailTrack GPS",
    tagline: "Offline marine navigation, polar chart calculator, and race telemetry logger.",
    description: "Built for competitive keelboat racing and coastal cruising. Computes target VMG (Velocity Made Good), laylines, and polar speed predictions using local sensor streams over NMEA 0183 / Signal K with zero cloud dependency.",
    creator: "nate",
    creatorAvatar: "⚡",
    upvotes: 192,
    forks: 46,
    version: "v2.1.0",
    license: "Apache-2.0",
    price: "$20 Registered Copy",
    moddabilityScore: 91,
    mergeCleanliness: "98.8% clean",
    storage: "Single-file SQLite WAL (/data/telemetry.sqlite)",
    screenshots: [
      "https://images.unsplash.com/photo-1500930287596-c1ecaa373bb2?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=800&q=80"
    ],
    binaries: {
      mac: "SailTrack-2.1.0.dmg (18.0MB)",
      win: "SailTrack-Setup.exe (22.1MB)",
      linux: "SailTrack.AppImage (19.4MB)",
      ios: "TestFlight Link Active"
    },
    tags: ["Marine", "GPS", "Mapping", "Offline"],
    comments: [
      {
        id: "c4",
        author: "bob_skipper",
        avatar: "⛵",
        time: "Yesterday",
        text: "Used this in the regatta on Lake Travis. Super responsive polar calculations even with zero cellular signal.",
        upvotes: 14,
        isMaker: false
      }
    ]
  }
];

export const INBOX_THREADS = [
  {
    id: "msg-1",
    from: "alice@natesoftware",
    subject: "[MERGE PROPOSAL] Receipt OCR Feature",
    time: "10:42 AM",
    unread: true,
    featureRef: "refs/features/receipt-ocr@v2",
    body: "Hey Nate, I extracted and packaged the offline SQLite receipt scanning engine from our fork. The test suite ran cleanly in GITSMITH against your main branch with 0 AST collisions. SQLite migrations are ready for CAS merge."
  },
  {
    id: "msg-2",
    from: "claude-agent@local",
    subject: "Task Completed: CSV Export Generator",
    time: "09:15 AM",
    unread: false,
    featureRef: "refs/features/csv-export@v1",
    body: "Completed AST injection of CSV Export button into report header. 4 unit tests passing, bundle footprint +12KB."
  },
  {
    id: "msg-3",
    from: "payouts@natesoftware",
    subject: "Lineage Royalty Received: +$12.00",
    time: "Yesterday",
    unread: false,
    featureRef: "n/a",
    body: "A user registered a descendant fork of SailTrack GPS (@bob/sailtrack-regatta). Royalty of $12.00 (20% split) has settled to your balance."
  }
];
