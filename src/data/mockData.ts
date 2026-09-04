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
  royaltyBps?: number | null;
  royalty_bps?: number | null;
  inheritedLiens?: Array<{ maker: string; bps: number }>;
  productStatus?: 'draft' | 'active' | 'suspended' | 'retired';
  binaries?: {
    web?: string;
    [key: string]: string | undefined;
  };
  voters?: { name: string; avatar: string; handle: string }[];
  makerPitch?: string;
  isDemo?: boolean;
  hasVoted?: boolean;
}

export const mockApps: AppListing[] = [
  {
    id: 'pixel-synth',
    name: 'PixelSynth FM',
    tagline: 'Retro 8-bit FM synthesizer, tracker, and waveform editor.',
    description: 'A complete WebAudio chiptune workspace with FM synthesis presets, 4-track sequencer, and export to wav/midi.',
    author: 'synthwave_sam',
    authorAvatar: '🎹',
    creator: 'synthwave_sam',
    creatorAvatar: '🎹',
    version: 'v1.2.0',
    upvotes: 42,
    forkCount: 9,
    forks: 9,
    tags: ['Audio', 'WebAudio', 'Chiptune', 'Synth'],
    price: 19,
    screenshots: [],
    comments: [],
    sqliteDatabase: 'Local WebAudio store',
    sqliteSize: '3.2 MB',
    hasCanonicalRepo: true,
    repoSlug: 'synthwave_sam/pixel-synth',
    productStatus: 'active'
  },
  {
    id: 'db-diff-pro',
    name: 'DB Diff Pro',
    tagline: 'Visual SQLite schema diffing, migration scripts, and test data generation.',
    description: 'Inspect schemas side-by-side, generate reversible migration SQL, and verify data consistency across SQLite databases.',
    author: 'sarah_dev',
    authorAvatar: '🛠️',
    creator: 'sarah_dev',
    creatorAvatar: '🛠️',
    version: 'v2.0.1',
    upvotes: 38,
    forkCount: 14,
    forks: 14,
    tags: ['Developer Tools', 'SQLite', 'Database', 'SQL'],
    price: 29,
    screenshots: [],
    comments: [],
    sqliteDatabase: 'SQLite migration catalog',
    sqliteSize: '1.8 MB',
    hasCanonicalRepo: true,
    repoSlug: 'sarah_dev/db-diff-pro',
    productStatus: 'active'
  },
  {
    id: 'neon-paint',
    name: 'NeonPaint 95',
    tagline: 'Layer-based pixel art editor with sprite animation and palette management.',
    description: 'A nostalgic raster pixel editor supporting custom palettes, animation frames, Onion Skinning, and sprite sheet export.',
    author: 'pixelpete',
    authorAvatar: '🎨',
    creator: 'pixelpete',
    creatorAvatar: '🎨',
    version: 'v1.0.4',
    upvotes: 27,
    forkCount: 6,
    forks: 6,
    tags: ['Design', 'Canvas', 'Pixel Art', 'Graphics'],
    price: 15,
    screenshots: [],
    comments: [],
    sqliteDatabase: 'Project canvas store',
    sqliteSize: '5.1 MB',
    hasCanonicalRepo: true,
    repoSlug: 'pixelpete/neon-paint',
    productStatus: 'active'
  },
  {
    id: 'packet-hound',
    name: 'PacketHound',
    tagline: 'Local network packet inspector and pcap stream decoder.',
    description: 'Real-time protocol dissection, flow analysis, and Wireshark-compatible pcap filtering in a lightweight desktop pane.',
    author: 'cypher_queen',
    authorAvatar: '🦊',
    creator: 'cypher_queen',
    creatorAvatar: '🦊',
    version: 'v0.9.2',
    upvotes: 19,
    forkCount: 4,
    forks: 4,
    tags: ['Networking', 'Security', 'Tools', 'Packets'],
    price: 35,
    screenshots: [],
    comments: [],
    sqliteDatabase: 'Capture buffer cache',
    sqliteSize: '12.4 MB',
    hasCanonicalRepo: true,
    repoSlug: 'cypher_queen/packet-hound',
    productStatus: 'active'
  },
  {
    id: 'retro-bbs',
    name: 'RetroBBS Doorway',
    tagline: 'ANSI terminal BBS client and message board aggregator.',
    description: 'Connect to classic dial-up bulletin board simulations, browse ANSI art galleries, and play vintage text door games.',
    author: 'vintage_coder',
    authorAvatar: '💾',
    creator: 'vintage_coder',
    creatorAvatar: '💾',
    version: 'v1.5.0',
    upvotes: 15,
    forkCount: 3,
    forks: 3,
    tags: ['BBS', 'Terminal', 'ANSI', 'Retro'],
    price: 20,
    screenshots: [],
    comments: [],
    sqliteDatabase: 'Message & ANSI node store',
    sqliteSize: '4.7 MB',
    hasCanonicalRepo: true,
    repoSlug: 'vintage_coder/retro-bbs',
    productStatus: 'active'
  }
];
