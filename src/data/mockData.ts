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
  sqliteDatabase?: string;
  sqlitePath?: string;
  storage?: string;
  sqliteSize?: string;
  screenshots: string[];
  comments: Comment[];
  badge?: string;
  price?: number;
  moddabilityScore?: number;
  mergeCleanliness?: string;
  binaries?: {
    web?: string;
    mac?: string;
    win?: string;
    linux?: string;
    ios?: string;
    macosDmg?: string;
    windowsExe?: string;
    linuxAppImage?: string;
    iosIpa?: string;
    [key: string]: string | undefined;
  };
  voters?: { name: string; avatar: string; handle: string }[];
  makerPitch?: string;
  isDemo?: boolean;
}

export const INITIAL_APPS: AppListing[] = [
  {
    id: 'dronehunter',
    name: 'DroneHunter 95',
    tagline: 'Retro Duck Hunt-Style Arcade Drone Shooter with Local High Scores',
    description: 'Fast-paced arcade browser game inspired by classic Duck Hunt. Double-barrel shotgun reloads, laughing dog animations, drone explosions, and local high score tracking with storage freedom.',
    author: 'nate',
    authorAvatar: '🎯',
    creator: 'nate',
    creatorAvatar: '🎯',
    version: 'v1.0.0',
    upvotes: 420,
    forkCount: 88,
    forks: 88,
    tags: ['Arcade', 'Retro', 'Duck Hunt', 'Canvas', 'Web Audio'],
    storage: 'Local-First (Storage Freedom)',
    moddabilityScore: 98,
    mergeCleanliness: '100% Clean',
    price: 15.00,
    badge: '#1 Product of the Day',
    makerPitch: 'I wanted an authentic 1995 Duck Hunt experience in pure HTML5 Canvas with local high-scores and zero telemetry bloat. Grab your mouse, shoot the drones, and don\'t let the dog laugh at you!',
    voters: [
      { name: 'Nate McGuire', handle: '@nate', avatar: '🎯' },
      { name: 'Josh McGuire', handle: '@josh', avatar: '⛵' },
      { name: 'Sam (AI)', handle: '@sam', avatar: '🤖' }
    ],
    screenshots: [
      '/dronehunter-ephemeral-screenshot.png',
      '/dronehunter-game/assets/og-image-1200x630.png'
    ],
    isDemo: true,
    comments: [
      {
        id: 'c-pitch',
        author: 'Nate McGuire (@nate)',
        avatar: '🎯',
        text: 'Maker Note: Built with pure HTML5 Canvas + Web Audio API shotgun audio. All scores persist directly to your local browser storage without third-party servers.',
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
        author: 'Sam (@sam)',
        avatar: '🤖',
        text: 'Clean architecture. Modular, runtime-independent local storage with zero latency.',
        timestamp: '2h ago'
      }
    ]
  },
  {
    id: 'certified-mailer',
    name: 'Certified Mailer',
    tagline: 'Private letter preparation and user-recorded mailing evidence journal',
    description: 'Prepare, review, print, and locally journal important correspondence. Postal tracking and receipt observations are entered by the user and remain explicitly unverified.',
    author: 'nate',
    authorAvatar: '📫',
    creator: 'nate',
    creatorAvatar: '📫',
    version: 'v1.0.0',
    upvotes: 312,
    forkCount: 46,
    forks: 46,
    tags: ['Legal', 'USPS', 'Postal', 'Dispute', 'Local-First'],
    liveUrl: '',
    liveAppUrl: '',
    sqliteDatabase: 'Browser localStorage',
    sqlitePath: 'Browser localStorage',
    storage: 'Unencrypted browser-local journal',
    sqliteSize: 'Varies by saved records',
    moddabilityScore: 95,
    mergeCleanliness: '99.9% Clean',
    price: 25.00,
    badge: '#2 Product of the Day',
    makerPitch: 'A local workspace for drafting, reviewing, printing, and recording evidence about important mail without claiming postal submission or verification.',
    voters: [
      { name: 'Nate McGuire', handle: '@nate', avatar: '📫' },
      { name: 'Josh McGuire', handle: '@josh', avatar: '⛵' },
      { name: 'Sam (AI)', handle: '@sam', avatar: '🤖' }
    ],
    screenshots: [
      'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80'
    ],
    isDemo: true,
    comments: [
      {
        id: 'c-pitch-2',
        author: 'Nate McGuire (@nate)',
        avatar: '📫',
        text: 'Maker Note: Prepare important correspondence and keep your own dated evidence journal. Confirm legal requirements and postal status independently.',
        timestamp: '12:01 AM UTC',
        isMaker: true
      },
      {
        id: 'c3',
        author: 'Josh McGuire (@josh)',
        avatar: '⛵',
        text: 'Useful for organizing drafts and user-recorded mailing evidence without sending private documents to an app server.',
        timestamp: '3h ago'
      }
    ]
  },
  {
    id: 'picfitai',
    name: 'PicFit',
    tagline: 'Private in-browser crop, resize, compression, and image export studio',
    description: 'Prepare JPEG, PNG, and WebP images locally with crop presets, exact output dimensions, real encoded-size reporting, and downloads that never require an upload.',
    author: 'nate',
    authorAvatar: '✨',
    creator: 'nate',
    creatorAvatar: '✨',
    version: 'v1.0.0',
    upvotes: 284,
    forkCount: 62,
    forks: 62,
    tags: ['Images', 'Crop', 'Resize', 'Compression', 'Local-First'],
    liveUrl: 'https://picfitai.nates-software.com',
    liveAppUrl: 'https://picfitai.nates-software.com',
    sqliteDatabase: '',
    sqlitePath: '',
    storage: 'Ephemeral browser memory; source images are not uploaded',
    sqliteSize: 'Not applicable',
    moddabilityScore: 97,
    mergeCleanliness: '99.5% Clean',
    price: 24.99,
    badge: '#3 Product of the Day',
    makerPitch: 'Crop, resize, compress, and convert your own images without sending the source file to a server.',
    voters: [
      { name: 'Nate McGuire', handle: '@nate', avatar: '✨' },
      { name: 'Josh McGuire', handle: '@josh', avatar: '⛵' },
      { name: 'Sam (AI)', handle: '@sam', avatar: '🤖' }
    ],
    screenshots: [
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80'
    ],
    isDemo: true,
    comments: [
      {
        id: 'c-pitch-3',
        author: 'Nate McGuire (@nate)',
        avatar: '✨',
        text: 'Maker Note: PicFit decodes and prepares images in browser memory, then reports the actual encoded file size before download.',
        timestamp: '12:01 AM UTC',
        isMaker: true
      }
    ]
  },
  {
    id: 'wallart',
    name: 'WallArt Canvas Pro',
    tagline: 'Interactive Canvas Split & Living Room Wall Art Studio',
    description: 'Browser-first wall art visualizer and source-resolution inspector. Supports single, triptych, and 4-grid canvas splits with finish previews, custom wall colors, and a 300-PPI target comparison.',
    author: 'nate',
    authorAvatar: '🖼️',
    creator: 'nate',
    creatorAvatar: '🖼️',
    version: 'v1.0.0',
    upvotes: 345,
    forkCount: 52,
    forks: 52,
    tags: ['Wall Art', 'Canvas', 'Print', 'Design', 'Browser-First'],
    liveUrl: 'https://wallart.nates-software.com',
    liveAppUrl: 'https://wallart.nates-software.com',
    sqliteDatabase: '',
    storage: 'Session-only browser memory; source photos are not uploaded',
    sqliteSize: 'Not applicable',
    moddabilityScore: 96,
    mergeCleanliness: '100% Clean',
    price: 59.00,
    badge: 'Staff Pick',
    makerPitch: 'Preview a photo across single, triptych, and 4-grid layouts, then compare its cropped pixel dimensions with a 300-PPI target before choosing a printer.',
    voters: [
      { name: 'Nate McGuire', handle: '@nate', avatar: '🖼️' },
      { name: 'Josh McGuire', handle: '@josh', avatar: '⛵' },
      { name: 'Sam (AI)', handle: '@sam', avatar: '🤖' }
    ],
    screenshots: [
      'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=800&q=80'
    ],
    isDemo: true,
    comments: [
      {
        id: 'c-wa-1',
        author: 'Nate McGuire (@nate)',
        avatar: '🖼️',
        text: 'Maker Note: The browser keeps your source photo local and compares the active crop with a 300-PPI target. Printer-specific production checks remain with your print provider.',
        timestamp: '12:01 AM UTC',
        isMaker: true
      }
    ]
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
    bio: 'Founder at East Bay Projects. Building shareware for Users.',
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
