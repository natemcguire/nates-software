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

export type AppDeploymentState =
  | 'draft'
  | 'source_ready'
  | 'building'
  | 'deployable'
  | 'active'
  | 'failed'
  | 'retired'
  | 'client_demo';

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
  forkDepth?: number;
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
  deploymentState?: AppDeploymentState;
  deploymentError?: string;
  lastDeployError?: string | null;
  deploymentEvidence?: any;
  detectedProjectType?: string;
  deploymentPlan?: any;
  activeDeploymentId?: string;
  activeCommitOid?: string;
  repositoryId?: string | null;
  hasCanonicalRepo?: boolean;
  isRepoActive?: boolean;
  repoSlug?: string | null;
  repoName?: string | null;
  repoOwner?: string | null;
  repoHeadCommitOid?: string | null;
  repoVisibility?: 'public' | 'unlisted' | 'private' | null;
  repoStatus?: string | null;
  repoDefaultRef?: string | null;
  grantable_bps?: number | null;
  grantableBps?: number | null;
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
    deploymentState: 'draft',
    deploymentError: 'No deployable revision exists for DroneHunter 95. Source has not been imported into GITSMITH and built by RIG.',
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
    deploymentState: 'draft',
    deploymentError: 'No deployable revision exists for Certified Mailer. Source has not been imported into GITSMITH and built by RIG.',
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
    id: 'american-gardener',
    name: 'American Gardener',
    deploymentState: 'draft',
    deploymentError: 'No deployable revision exists for American Gardener. Source has not been imported into GITSMITH and built by RIG.',
    tagline: 'Local garden operations, crop timing, light, and inventory intelligence',
    description: 'A private local dashboard that combines garden inventory, crop and growing-degree-day targets, garden-spot light readings, and optional Home Assistant observations without publishing household data.',
    author: 'nate',
    authorAvatar: '🌱',
    creator: 'nate',
    creatorAvatar: '🌱',
    version: 'v1.0.0',
    upvotes: 0,
    forkCount: 0,
    forks: 0,
    tags: ['Gardening', 'Home Assistant', 'GDD', 'DLI', 'SQLite', 'Local-First'],
    sqliteDatabase: 'Application-owned local SQLite',
    sqlitePath: 'amazon.sqlite (private, ignored)',
    storage: 'Private local SQLite plus optional read-only Home Assistant snapshots',
    sqliteSize: 'User-owned and variable',
    moddabilityScore: 94,
    mergeCleanliness: 'Not yet benchmarked',
    price: 25.00,
    badge: 'New Project',
    makerPitch: 'Plan and operate a real garden from your own weather, light, crop, and inventory observations—not a generic zone map.',
    voters: [
      { name: 'Nate McGuire', handle: '@nate', avatar: '🌱' }
    ],
    screenshots: [
      'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=80'
    ],
    isDemo: true,
    comments: [
      {
        id: 'c-garden-1',
        author: 'Nate McGuire (@nate)',
        avatar: '🌱',
        text: 'Maker Note: The published project describes the software; household inventory, orders, sensors, and garden observations remain private and local.',
        timestamp: '12:01 AM UTC',
        isMaker: true
      }
    ]
  },
  {
    id: 'wallart',
    name: 'WallArt Canvas Pro',
    deploymentState: 'draft',
    deploymentError: 'No deployable revision exists for WallArt Canvas Pro. Source has not been imported into GITSMITH and built by RIG.',
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
    liveUrl: '',
    liveAppUrl: '',
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
