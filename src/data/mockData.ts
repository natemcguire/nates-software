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
