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

export function formatProposalStatus(thread: InboxThread): {
  badgeLabel: string;
  badgeStyle: string;
  description: string;
  canApprove: boolean;
} {
  if (thread.isMerged && thread.mergeStatus === 'landed') {
    return {
      badgeLabel: 'Landed by GITSMITH',
      badgeStyle: 'bg-green-700 text-white',
      description: 'GITSMITH reports that this exact result commit is now the target ref.',
      canApprove: false
    };
  }

  if (thread.approvalStatus === 'approved') return {
    badgeLabel: 'Approved · Awaiting landing',
    badgeStyle: 'bg-blue-700 text-white',
    description: 'The immutable attempt is approved. GITSMITH has not reported the ref landed.',
    canApprove: false
  };

  if (!thread.mergeAttemptId || thread.mergeStatus !== 'preview_ready') return {
    badgeLabel: 'Not ready for approval',
    badgeStyle: 'bg-gray-200 text-gray-700 border border-gray-400',
    description: 'This message is not attached to a preview-ready immutable merge attempt.',
    canApprove: false
  };

  return {
    badgeLabel: 'Pending Approval',
    badgeStyle: 'bg-amber-100 text-amber-800 border border-amber-300',
    description: 'Approve this exact result commit. Landing remains a separate GITSMITH operation.',
    canApprove: true
  };
}
