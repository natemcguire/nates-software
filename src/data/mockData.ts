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
  hasVoted?: boolean;
}

// The fabricated INITIAL_APPS seed fixture (invented upvotes/forks, fake voters
// including "Sam (AI)", fake comments, and Unsplash stock photos passed off as app
// screenshots) used to live here and could leak into the UI as demo/fallback data.
// It was removed pre-launch — the catalog is sourced exclusively from D1 via
// /api/drops. The AppListing / AppComment / AppDeploymentState types above remain
// the shared shape used across the app.


// NOTE: A fabricated MAKER_PROFILES fixture (invented "Verified Maker"
// accounts with made-up streaks/fork counts, including an unrelated real
// person's name) used to live here and render on the live HOTWIRE surface
// as a fallback whenever the authoritative /api/drops leaderboard fetch
// failed. That was a fabricated-identity honesty violation (Codex #8) and
// has been removed. HotwireView now shows an honest "offline / unavailable"
// empty state instead of synthetic maker profiles. Real maker profiles are
// sourced exclusively from D1 via /api/drops' makerLeaderboard.
