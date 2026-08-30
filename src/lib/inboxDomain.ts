// Production Domain Logic for INBOX 3-Pane Client

export type InboxCategory = 'proposals' | 'agent_logs' | 'royalties' | 'feedback';

export interface InboxThread {
  readonly id: string;
  readonly category: InboxCategory;
  readonly from: string;
  readonly fromAvatar: string;
  readonly subject: string;
  readonly time: string;
  readonly body: string;
  readonly unread: boolean;
  readonly featureRef: string;
  readonly casOldSha?: string;
  readonly casNewSha?: string;
  readonly testsPassed?: number;
  readonly isMerged?: boolean;
  readonly mergeAttemptId?: string;
  readonly mergeStatus?: string;
  readonly approvalStatus?: 'unreviewed' | 'approved' | 'rejected';
  readonly approvalComment?: string;
  readonly inReplyToId?: string;
  readonly direction?: 'received' | 'sent';
}

export function filterThreadsByCategory(threads: readonly InboxThread[], category: string): readonly InboxThread[] {
  if (category === 'all') return threads;
  return threads.filter(t => t.category === category);
}

export interface FolderCounts {
  readonly all: number;
  readonly proposals: number;
  readonly agent_logs: number;
  readonly royalties: number;
  readonly feedback: number;
  readonly unread: number;
}

export function calculateFolderCounts(threads: readonly InboxThread[]): FolderCounts {
  return {
    all: threads.length,
    proposals: threads.filter(t => t.category === 'proposals').length,
    agent_logs: threads.filter(t => t.category === 'agent_logs').length,
    royalties: threads.filter(t => t.category === 'royalties').length,
    feedback: threads.filter(t => t.category === 'feedback').length,
    unread: threads.filter(t => t.unread).length
  };
}

export function conversationForThread(threads: readonly InboxThread[], selectedId: string): readonly InboxThread[] {
  const connected = new Set<string>([selectedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const thread of threads) {
      if (connected.has(thread.id) || (thread.inReplyToId && connected.has(thread.inReplyToId))) {
        if (!connected.has(thread.id)) { connected.add(thread.id); changed = true; }
        if (thread.inReplyToId && !connected.has(thread.inReplyToId)) { connected.add(thread.inReplyToId); changed = true; }
      }
    }
  }
  return threads
    .filter(thread => connected.has(thread.id))
    .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

export function formatProposalStatus(thread: InboxThread, diffData?: PRDiffData | null): {
  badgeLabel: string;
  badgeStyle: string;
  description: string;
  canApprove: boolean;
  canReject: boolean;
  isDiverged: boolean;
  isFastForward: boolean;
} {
  if (thread.isMerged && thread.mergeStatus === 'landed') {
    return {
      badgeLabel: 'Merged · Landed by GITSMITH',
      badgeStyle: 'bg-green-700 text-white',
      description: 'GITSMITH reports that this exact result commit is now the target ref.',
      canApprove: false,
      canReject: false,
      isDiverged: false,
      isFastForward: true
    };
  }

  if (thread.approvalStatus === 'approved') return {
    badgeLabel: 'Approved · GITSMITH landing',
    badgeStyle: 'bg-blue-700 text-white',
    description: 'The immutable attempt is approved and queued. GITSMITH is performing the authoritative compare-and-swap.',
    canApprove: false,
    canReject: false,
    isDiverged: false,
    isFastForward: true
  };

  if (thread.approvalStatus === 'rejected') return {
    badgeLabel: 'Changes requested',
    badgeStyle: 'bg-red-100 text-red-800 border border-red-300',
    description: 'This exact result commit was rejected. No Git ref was changed.',
    canApprove: false,
    canReject: false,
    isDiverged: Boolean(diffData?.diverged),
    isFastForward: Boolean(diffData?.isFastForward)
  };

  if (!thread.mergeAttemptId || thread.mergeStatus !== 'preview_ready') return {
    badgeLabel: 'Not ready for approval',
    badgeStyle: 'bg-gray-200 text-gray-700 border border-gray-400',
    description: 'This message is not attached to a preview-ready immutable merge attempt.',
    canApprove: false,
    canReject: false,
    isDiverged: false,
    isFastForward: false
  };

  if (diffData && (diffData.diverged || !diffData.isFastForward)) {
    return {
      badgeLabel: 'Open · Diverged (Needs Merge Commit)',
      badgeStyle: 'bg-amber-100 text-amber-900 border border-amber-400 font-bold',
      description: `This branch cannot be fast-forwarded: histories have diverged. Target is ahead by ${diffData.behindCount || 1} commit(s).`,
      canApprove: true,
      canReject: true,
      isDiverged: true,
      isFastForward: false
    };
  }

  return {
    badgeLabel: 'Open · Fast-forwardable',
    badgeStyle: 'bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold',
    description: 'Approve this exact result commit to queue an authoritative GITSMITH compare-and-swap.',
    canApprove: true,
    canReject: true,
    isDiverged: false,
    isFastForward: true
  };
}

export interface PRCommit {
  readonly sha: string;
  readonly shortSha: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  readonly summary: string;
  readonly message: string;
}

export interface PRDiffLine {
  readonly type: 'add' | 'delete' | 'context' | 'header';
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
  readonly content: string;
}

export interface PRDiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly header: string;
  readonly lines: PRDiffLine[];
}

export interface PRFileDiff {
  readonly oldPath: string;
  readonly newPath: string;
  readonly status: 'modified' | 'added' | 'deleted' | 'renamed';
  readonly additions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
  readonly patch: string;
  readonly hunks?: PRDiffHunk[];
}

export interface PRDiffData {
  readonly success: boolean;
  readonly proposalId?: string;
  readonly repositorySlug?: string;
  readonly targetRef?: string;
  readonly featureRef?: string;
  readonly baseOid: string;
  readonly headOid: string;
  readonly mergeBaseOid: string | null;
  readonly isFastForward: boolean;
  readonly diverged: boolean;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly commits: PRCommit[];
  readonly files: PRFileDiff[];
  readonly totalAdditions: number;
  readonly totalDeletions: number;
  readonly filesChanged: number;
  readonly unifiedDiff: string;
  readonly error?: string;
}

