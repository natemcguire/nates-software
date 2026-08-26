export interface Comment {
  id: string;
  author: string;
  avatar: string;
  text: string;
  timestamp?: string;
  time?: string;
  upvotes?: number;
  isMaker?: boolean;
}

export type AppComment = Comment;

export interface AppListing {
  id: string;
  name: string;
  tagline: string;
  description: string;
  author: string;
  authorAvatar: string;
  creator?: string;
  creatorAvatar?: string;
  version: string;
  upvotes: number;
  forkCount: number;
  forks?: number;
  tags: string[];
  liveUrl?: string;
  liveAppUrl?: string;
  sqliteDatabase: string;
  sqlitePath?: string;
  storage?: string;
  sqliteSize: string;
  screenshots: string[];
  comments: Comment[];
  badge?: string;
  price?: number;
  moddabilityScore?: number;
  mergeCleanliness?: string;
  binaries?: {
    mac?: string;
    win?: string;
    linux?: string;
    ios?: string;
    macosDmg?: string;
    windowsExe?: string;
    linuxAppImage?: string;
    iosIpa?: string;
  };
  voters?: { name: string; avatar: string; handle: string }[];
  makerPitch?: string;
}

export const INITIAL_APPS: AppListing[] = [
  {
    id: 'dronehunter',
    name: 'DroneHunter 95',
    tagline: 'Retro Duck Hunt-Style Arcade Drone Shooter with SQLite High Scores',
    description: 'Fast-paced arcade browser game inspired by classic Duck Hunt. Double-barrel shotgun reloads, laughing dog animations, drone explosions, and local SQLite high score telemetry in WAL mode.',
    author: 'nate',
    authorAvatar: '🎯',
    creator: 'nate',
    creatorAvatar: '🎯',
    version: 'v1.0.0',
    upvotes: 420,
    forkCount: 88,
    forks: 88,
    tags: ['Arcade', 'Retro', 'Duck Hunt', 'SQLite WAL', 'Web Audio'],
    liveUrl: 'https://dronehunter.pages.dev',
    liveAppUrl: 'https://dronehunter.pages.dev',
    sqliteDatabase: '/data/dronehunter.sqlite',
    sqlitePath: '/data/dronehunter.sqlite',
    storage: '/data/dronehunter.sqlite (WAL mode)',
    sqliteSize: '14.8 MB',
    moddabilityScore: 98,
    mergeCleanliness: '100% Clean',
    price: 49.00,
    badge: '#1 Product of the Day',
    makerPitch: 'I wanted an authentic 1995 Duck Hunt experience in pure HTML5 Canvas with local SQLite WAL high-scores and zero telemetry bloat. Grab your mouse, shoot the drones, and don\'t let the dog laugh at you!',
    voters: [
      { name: 'Nate McGuire', handle: '@nate', avatar: '⚡' },
      { name: 'Josh McGuire', handle: '@josh', avatar: '⛵' },
      { name: 'Sam Altman', handle: '@sam', avatar: '🤖' },
      { name: 'Alex Rivera', handle: '@alex', avatar: '🎨' }
    ],
    binaries: {
      macosDmg: 'https://releases.nates-software.com/dronehunter-1.0.0.dmg',
      linuxAppImage: 'https://releases.nates-software.com/dronehunter-1.0.0.AppImage'
    },
    screenshots: [
      'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=800&q=80'
    ],
    comments: [
      {
        id: 'c-pitch',
        author: 'Nate McGuire (@nate)',
        avatar: '🎯',
        text: 'Maker Note: Built with pure HTML5 Canvas + Web Audio API shotgun audio. All scores persist directly to your local SQLite database without third-party servers.',
        timestamp: '12:01 AM UTC',
        isMaker: true
      },
      {
        id: 'c1',
        author: 'Josh McGuire (@josh)',
        avatar: '⛵',
        text: 'The shotgun reload animation is pristine. Forked and spliced into my local worktree.',
        timestamp: '1h ago'
      },
      {
        id: 'c2',
        author: 'Sam Altman (@sam)',
        avatar: '🤖',
        text: 'Clean architecture. Single-file SQLite WAL mode runs with zero latency.',
        timestamp: '2h ago'
      }
    ]
  },
  {
    id: 'certified-mailer',
    name: 'Certified Mailer',
    tagline: 'USPS Certified Mail, Electronic Return Receipt (ERR) & Dispute Tooling',
    description: 'Private legal dispute and operational correspondence engine. Renders manifests to flattened high-DPI PDFs, tracks Electronic Return Receipts (ERR), and connects to LetterStream / Lob APIs.',
    author: 'nate',
    authorAvatar: '📫',
    creator: 'nate',
    creatorAvatar: '📫',
    version: 'v1.0.0',
    upvotes: 312,
    forkCount: 46,
    forks: 46,
    tags: ['Legal', 'USPS', 'Postal', 'Dispute', 'SQLite WAL'],
    liveUrl: 'https://certified-mailer.pages.dev',
    liveAppUrl: 'https://certified-mailer.pages.dev',
    sqliteDatabase: '/data/certified-mailer.sqlite',
    sqlitePath: '/data/certified-mailer.sqlite',
    storage: '/data/certified-mailer.sqlite (WAL mode)',
    sqliteSize: '1.4 MB',
    moddabilityScore: 95,
    mergeCleanliness: '99.9% Clean',
    price: 99.00,
    badge: '#2 Product of the Day',
    makerPitch: 'Automates FCRA dispute letters and USPS certified mailings. Flattens DOCX/PDF to 300 DPI pixels to prevent print layout skew, and logs digital signature receipts into SQLite.',
    voters: [
      { name: 'Nate McGuire', handle: '@nate', avatar: '⚡' },
      { name: 'Josh McGuire', handle: '@josh', avatar: '⛵' },
      { name: 'Elena Rostova', handle: '@elena', avatar: '⚖️' }
    ],
    binaries: {
      macosDmg: 'https://releases.nates-software.com/certified-mailer-1.0.0.dmg',
      linuxAppImage: 'https://releases.nates-software.com/certified-mailer-1.0.0.tar.gz'
    },
    screenshots: [
      'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80'
    ],
    comments: [
      {
        id: 'c-pitch-2',
        author: 'Nate McGuire (@nate)',
        avatar: '📫',
        text: 'Maker Note: Never get screwed by credit bureaus or collection agencies again. Generates 60-day dispute manifests with certified postal tracking.',
        timestamp: '12:01 AM UTC',
        isMaker: true
      },
      {
        id: 'c3',
        author: 'LegalTech Weekly',
        avatar: '⚖️',
        text: 'Essential for FCRA § 623 dispute compliance. 300 DPI rasterization avoids all printer metric errors.',
        timestamp: '3h ago'
      }
    ]
  },
  {
    id: 'picfitai',
    name: 'PicFit.ai',
    tagline: 'AI Virtual Try-On Studio & Outfit Synthesis Engine with Gemini Vision',
    description: 'AI Virtual Try-On Studio & Outfit Synthesis Engine powered by Google Gemini Vision with sovereign single-file SQLite user credits ledger.',
    author: 'nate',
    authorAvatar: '✨',
    creator: 'nate',
    creatorAvatar: '✨',
    version: 'v1.0.0',
    upvotes: 284,
    forkCount: 62,
    forks: 62,
    tags: ['AI', 'Fashion', 'Gemini', 'Try-On', 'SQLite WAL'],
    liveUrl: 'https://picfit.ai',
    liveAppUrl: 'https://picfit.ai',
    sqliteDatabase: '/data/picfitai.sqlite',
    sqlitePath: '/data/picfitai.sqlite',
    storage: '/data/picfitai.sqlite (WAL mode)',
    sqliteSize: '4.2 MB',
    moddabilityScore: 97,
    mergeCleanliness: '99.5% Clean',
    price: 24.99,
    badge: '#3 Product of the Day',
    makerPitch: 'Try on red carpet dresses, suits, and curated fashion looks on your own photos using Google Gemini Vision neural diffusion.',
    voters: [
      { name: 'Nate McGuire', handle: '@nate', avatar: '⚡' },
      { name: 'Sarah Chen', handle: '@sarah', avatar: '👗' }
    ],
    binaries: {
      macosDmg: 'https://releases.nates-software.com/picfitai-1.0.0.dmg'
    },
    screenshots: [
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80'
    ],
    comments: [
      {
        id: 'c-pitch-3',
        author: 'Nate McGuire (@nate)',
        avatar: '✨',
        text: 'Maker Note: Running on PHP 8.2 & SQLite. Upload a photo, pick an outfit from our 36-dress Emmy catalog, and get realistic 4K draped renders.',
        timestamp: '12:01 AM UTC',
        isMaker: true
      }
    ]
  },
  {
    id: 'baby',
    name: 'Baby Knowledge Base',
    tagline: 'Next.js 16 Markdown Knowledge Base with SQLite FTS5 Full-Text Search',
    description: 'Next.js markdown-based knowledge base app with SQLite backend. Next.js 16, React 19, TypeScript, Tailwind, better-sqlite3. Full-text search and live graph backlinks on port 3001.',
    author: 'nate',
    authorAvatar: '👶',
    creator: 'nate',
    creatorAvatar: '👶',
    version: 'v1.2.0',
    upvotes: 198,
    forkCount: 34,
    forks: 34,
    tags: ['Knowledge Base', 'Markdown', 'Next.js 16', 'FTS5', 'SQLite'],
    liveUrl: 'http://localhost:3001',
    sqliteDatabase: '/data/baby.sqlite',
    sqlitePath: '/data/baby.sqlite',
    storage: '/data/baby.sqlite (WAL mode)',
    sqliteSize: '8.6 MB',
    moddabilityScore: 96,
    mergeCleanliness: '100% Clean',
    price: 39.00,
    screenshots: [
      'https://images.unsplash.com/photo-1456324504439-367cee3b3c32?auto=format&fit=crop&w=800&q=80'
    ],
    comments: []
  },
  {
    id: 'sailtrack',
    name: 'SailTrack (Boats)',
    tagline: 'Real-Time NMEA Marine HUD & Sail Shape Polar Curve Analysis',
    description: 'React Native/Expo mobile app + OpenCV computer vision backend for analyzing sail shapes and wind vectors in racing sailboats. Deployed on Railway.',
    author: 'josh',
    authorAvatar: '⛵',
    creator: 'josh',
    creatorAvatar: '⛵',
    version: 'v2.1.0',
    upvotes: 175,
    forkCount: 29,
    forks: 29,
    tags: ['Marine', 'NMEA', 'OpenCV', 'Expo SDK 54', 'Railway'],
    liveUrl: 'https://boats-production.up.railway.app',
    sqliteDatabase: '/data/sailtrack.sqlite',
    sqlitePath: '/data/sailtrack.sqlite',
    storage: '/data/sailtrack.sqlite (WAL mode)',
    sqliteSize: '5.2 MB',
    moddabilityScore: 92,
    mergeCleanliness: '98.5% Clean',
    price: 49.00,
    screenshots: [
      'https://images.unsplash.com/photo-1500930287596-c1ecaa373bb2?auto=format&fit=crop&w=800&q=80'
    ],
    comments: []
  },
  {
    id: 'miniwatcher',
    name: 'MiniWatcher Camera',
    tagline: 'macOS Security Camera with Motion Detection & Face Recognition',
    description: 'Python macOS security camera app. Motion detection via OpenCV frame differencing, local face recognition, and Flask web UI on port 8585.',
    author: 'nate',
    authorAvatar: '📹',
    creator: 'nate',
    creatorAvatar: '📹',
    version: 'v1.0.0',
    upvotes: 154,
    forkCount: 18,
    forks: 18,
    tags: ['Security', 'OpenCV', 'Python 3', 'Flask', 'Port 8585'],
    liveUrl: 'http://localhost:8585',
    sqliteDatabase: '/data/miniwatcher.sqlite',
    sqlitePath: '/data/miniwatcher.sqlite',
    storage: '/data/miniwatcher.sqlite (WAL mode)',
    sqliteSize: '22.4 MB',
    moddabilityScore: 94,
    mergeCleanliness: '99.0% Clean',
    price: 29.00,
    screenshots: [
      'https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=800&q=80'
    ],
    comments: []
  },
  {
    id: 'thebestbabynames',
    name: 'The Best Baby Names',
    tagline: 'Swipeable Couple Baby Name Discovery with D1 Cloudflare SQLite',
    description: 'Baby name discovery tool — swipeable card deck, couple matching sessions, shared favorites lists. Next.js 16, Cloudflare Pages static export, D1 SQLite, Behind the Name dataset.',
    author: 'nate',
    authorAvatar: '🍼',
    creator: 'nate',
    creatorAvatar: '🍼',
    version: 'v1.0.0',
    upvotes: 142,
    forkCount: 24,
    forks: 24,
    tags: ['Next.js 16', 'Cloudflare D1', 'Couple Swiper', 'SQLite'],
    liveUrl: 'https://thebestbabynames.com',
    sqliteDatabase: '/data/thebestbabynames.sqlite',
    sqlitePath: '/data/thebestbabynames.sqlite',
    storage: '/data/thebestbabynames.sqlite (WAL mode)',
    sqliteSize: '12.1 MB',
    moddabilityScore: 95,
    mergeCleanliness: '99.8% Clean',
    price: 19.00,
    screenshots: [
      'https://images.unsplash.com/photo-1519689680058-324335c77eba?auto=format&fit=crop&w=800&q=80'
    ],
    comments: []
  },
  {
    id: 'codey',
    name: 'Codey',
    tagline: 'iMessage-to-Codex Triage & Autonomous Deploy System',
    description: 'Expo mobile app + Node.js server. Routes incoming iMessages to Codex for code changes and autonomous PR deployment. BlueBubbles API, WebSockets, GitHub PRs. Port 3456.',
    author: 'nate',
    authorAvatar: '💬',
    creator: 'nate',
    creatorAvatar: '💬',
    version: 'v1.0.0',
    upvotes: 130,
    forkCount: 19,
    forks: 19,
    tags: ['iMessage', 'Codex', 'BlueBubbles', 'Node.js', 'Port 3456'],
    liveUrl: 'http://localhost:3456',
    sqliteDatabase: '/data/codey.sqlite',
    sqlitePath: '/data/codey.sqlite',
    storage: '/data/codey.sqlite (WAL mode)',
    sqliteSize: '3.1 MB',
    moddabilityScore: 93,
    mergeCleanliness: '99.2% Clean',
    price: 49.00,
    screenshots: [
      'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80'
    ],
    comments: []
  }
];

export const APPS_DATA = INITIAL_APPS;

export const MAKER_PROFILES = [
  {
    id: 'nate',
    name: 'Nate McGuire',
    handle: '@nate',
    avatar: '🎯',
    streakDays: 14,
    streakTier: 'Streak Champion',
    streakBadge: '🔥 14 Days',
    bio: 'Founder at East Bay Projects. Building shareware for sovereign users.',
    totalDrops: 8,
    totalForks: 260
  },
  {
    id: 'josh',
    name: 'Josh McGuire',
    handle: '@josh',
    avatar: '⛵',
    streakDays: 9,
    streakTier: 'Master Builder',
    streakBadge: '⚡ 9 Days',
    bio: 'Marine telemetry engineer. Rust, WASM, and high-frequency GPS vectors.',
    totalDrops: 4,
    totalForks: 94
  },
  {
    id: 'sam',
    name: 'Sam Altman',
    handle: '@sam',
    avatar: '🤖',
    streakDays: 5,
    streakTier: 'Active Contributor',
    streakBadge: '✨ 5 Days',
    bio: 'Open source enthusiast and WASM accounting hacker.',
    totalDrops: 3,
    totalForks: 48
  }
];
