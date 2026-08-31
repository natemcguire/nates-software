import React, { useState, useEffect, useCallback } from 'react';
import {
  InboxThread,
  filterThreadsByCategory,
  calculateFolderCounts,
  conversationForThread,
  formatProposalStatus,
  PRDiffData
} from '../lib/inboxDomain';
import { useAuth } from '../context/AuthContext';
import { LocalAgentMailbox } from '../components/LocalAgentMailbox';
import {
  Check,
  GitPullRequest,
  ShieldCheck,
  Mail,
  GitBranch,
  GitCommit,
  FileCode,
  MessageSquare,
  Send,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Inbox,
  Lock,
  CheckCheck,
  XCircle,
  ChevronDown,
  ChevronRight,
  FileText
} from 'lucide-react';

export const InboxView: React.FC = () => {
  const { user, isAuthenticated, openAuthModal } = useAuth();
  // Top-level mailbox mode: cloud merge-proposals (default) vs local agent mailbox.
  // Local mode swaps the entire 3-pane body for LocalAgentMailbox; cloud logic below is untouched.
  const [mailboxMode, setMailboxMode] = useState<'cloud' | 'local'>('cloud');
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [rewardPercent, setRewardPercent] = useState<string>('0');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // PR tab and diff state
  const [prActiveTab, setPrActiveTab] = useState<'conversation' | 'commits' | 'files'>('conversation');
  const [diffData, setDiffData] = useState<PRDiffData | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState<boolean>(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  const fetchInbox = useCallback(async (cursor?: string) => {
    if (cursor) setIsLoadingMore(true); else setIsLoading(true);
    setFetchError(null);
    setActionError(null);

    try {
      const res = await fetch(cursor ? `/api/inbox?cursor=${encodeURIComponent(cursor)}` : '/api/inbox');
      if (res.status === 401) {
        setFetchError('Authentication required: Log in to view your private developer inbox.');
        setThreads([]);
        setSelectedThreadId(null);
        return;
      }

      const data = await res.json();
      if (data.success && Array.isArray(data.threads)) {
        setThreads(previous => cursor ? [...previous, ...data.threads] : data.threads);
        setNextCursor(data.page?.nextCursor || null);
        setFetchError(null);
        if (data.threads.length > 0) {
          if (!cursor) setSelectedThreadId(prev => {
            if (prev && data.threads.some((t: InboxThread) => t.id === prev)) {
              return prev;
            }
            return data.threads[0].id;
          });
        } else {
          setSelectedThreadId(null);
        }
      } else {
        setFetchError(data.error || 'Failed to load inbox messages');
        if (!cursor) { setThreads([]); setSelectedThreadId(null); }
      }
    } catch (err: any) {
      setFetchError(err.message || 'Network error retrieving inbox');
      if (!cursor) { setThreads([]); setSelectedThreadId(null); }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox, user]);

  useEffect(() => {
    const awaitingLanding = threads.some(thread => thread.approvalStatus === 'approved' && !thread.isMerged);
    if (!awaitingLanding) return;
    const timer = window.setInterval(() => fetchInbox(), 3_000);
    return () => window.clearInterval(timer);
  }, [fetchInbox, threads]);

  const selectedThread = threads.find(t => t.id === selectedThreadId) || null;
  const filtered = filterThreadsByCategory(threads, activeFolder);
  const counts = calculateFolderCounts(threads);
  const conversation = selectedThread ? conversationForThread(threads, selectedThread.id) : [];

  // Fetch real diff from server for merge proposals
  const fetchProposalDiff = useCallback(async (threadId: string) => {
    setIsLoadingDiff(true);
    setDiffError(null);
    try {
      const res = await fetch(`/api/inbox?action=diff&proposalId=${encodeURIComponent(threadId)}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setDiffData(data);
      } else {
        setDiffError(data.error || 'Diff could not be computed from repository.');
        setDiffData(null);
      }
    } catch (err: any) {
      setDiffError(err.message || 'Network error fetching diff');
      setDiffData(null);
    } finally {
      setIsLoadingDiff(false);
    }
  }, []);

  useEffect(() => {
    if (selectedThread && selectedThread.category === 'proposals') {
      fetchProposalDiff(selectedThread.id);
    } else {
      setDiffData(null);
      setDiffError(null);
    }
    setPrActiveTab('conversation');
    setCollapsedFiles(new Set());
    setRewardPercent('0');
  }, [selectedThreadId, fetchProposalDiff]);

  const toggleFileCollapse = (filePath: string) => {
    setCollapsedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  // Non-optimistic proposal approval
  const handleReviewProposal = async (id: string, decision: 'approve' | 'reject') => {
    setActionPending(`${decision}_${id}`);
    setActionError(null);
    setActionSuccess(null);

    try {
      const numericPct = parseFloat(rewardPercent) || 0;
      const grantBps = decision === 'approve' && numericPct > 0 ? Math.round(numericPct * 100) : 0;
      const res = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: decision,
          messageId: id,
          comment: reviewComment,
          grantBps: grantBps > 0 ? grantBps : undefined
        })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setThreads(prev => prev.map(t => (t.id === id ? {
          ...t,
          approvalStatus: data.approvalStatus,
          approvalComment: data.approvalComment,
          mergeStatus: data.mergeStatus,
          unread: false
        } : t)));
        setActionSuccess(data.message || 'Proposal approval recorded.');
        setReviewComment('');
        setRewardPercent('0');
        if (decision === 'approve') window.setTimeout(() => fetchInbox(), 750);
        setTimeout(() => setActionSuccess(null), 4000);
      } else {
        setActionError(data.error || `Failed to record proposal ${decision}`);
      }
    } catch (err: any) {
      setActionError(err.message || `Network error recording proposal ${decision}`);
    } finally {
      setActionPending(null);
    }
  };

  // Non-optimistic mark read / unread toggle
  const handleToggleRead = async (id: string, currentUnread: boolean) => {
    setActionPending(`toggle_read_${id}`);
    setActionError(null);

    try {
      const action = currentUnread ? 'mark_read' : 'mark_unread';
      const res = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, messageId: id })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setThreads(prev => prev.map(t => (t.id === id ? { ...t, unread: !currentUnread } : t)));
      } else {
        setActionError(data.error || 'Failed to update message read status');
      }
    } catch (err: any) {
      setActionError(err.message || 'Network error updating message');
    } finally {
      setActionPending(null);
    }
  };

  // Non-optimistic reply/comment submission
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedThread) return;

    const text = replyText.trim();
    setActionPending('reply');
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reply',
          messageId: selectedThread.id,
          text
        })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        if (data.thread) {
          setThreads(previous => previous.some(thread => thread.id === data.thread.id)
            ? previous
            : [data.thread as InboxThread, ...previous]);
        }
        setReplyText('');
        setActionSuccess('✔ Comment stored and delivered in PR thread');
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        setActionError(data.error || 'Failed to send comment');
      }
    } catch (err: any) {
      setActionError(err.message || 'Network error sending comment');
    } finally {
      setActionPending(null);
    }
  };

  const getStatusBadge = () => {
    if (isLoading) {
      return <span className="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-blue-100 text-blue-800">SYNCING</span>;
    }
    if (fetchError) {
      if (fetchError.includes('Authentication')) {
        return <span className="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300">AUTH REQUIRED</span>;
      }
      return <span className="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-red-100 text-red-800">ERROR</span>;
    }
    return <span className="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-emerald-100 text-emerald-800">LIVE</span>;
  };

  // Defined once so it renders identically in both modes and can switch back.
  const modeToggle = (
    <div className="flex border-2 border-gray-800 bg-w95-gray p-0.5 gap-0.5 shrink-0" role="tablist" aria-label="Mailbox mode">
      <button
        role="tab"
        aria-selected={mailboxMode === 'cloud'}
        onClick={() => setMailboxMode('cloud')}
        className={`flex-1 px-2 py-1 text-[11px] font-bold border-2 flex items-center justify-center gap-1 ${
          mailboxMode === 'cloud'
            ? 'bg-white border-gray-800 text-w95-blue'
            : 'bg-w95-gray border-gray-400 text-gray-700 hover:bg-gray-100'
        }`}
      >
        ☁ Cloud Proposals
      </button>
      <button
        role="tab"
        aria-selected={mailboxMode === 'local'}
        onClick={() => setMailboxMode('local')}
        className={`flex-1 px-2 py-1 text-[11px] font-bold border-2 flex items-center justify-center gap-1 ${
          mailboxMode === 'local'
            ? 'bg-white border-gray-800 text-w95-blue'
            : 'bg-w95-gray border-gray-400 text-gray-700 hover:bg-gray-100'
        }`}
      >
        🖥 Local Agent Mailbox
      </button>
    </div>
  );

  // Local mode: swap the whole 3-pane body for the local agent mailbox.
  // The toggle is passed in so it renders at the top of the local left rail and can switch back.
  if (mailboxMode === 'local') {
    return (
      <div className="h-full overflow-hidden font-tahoma text-xs">
        <LocalAgentMailbox modeToggle={modeToggle} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-2 h-full overflow-hidden font-tahoma text-xs">
      {/* Pane 1: Mailboxes & Navigation */}
      <div className="col-span-3 bg-white border-2 border-gray-800 p-2 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-1">
          {modeToggle}
          <div className="font-bold text-w95-blue border-b pb-1 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Mail size={13} /> INBOX.EXE
            </span>
            <div className="flex items-center gap-1">
              {getStatusBadge()}
              <span className="bg-w95-blue text-white text-[10px] px-1.5 py-0.2 rounded font-mono font-bold">
                {counts.unread}
              </span>
            </div>
          </div>

          <div
            onClick={() => setActiveFolder('all')}
            className={`p-1.5 rounded cursor-pointer flex items-center justify-between font-bold ${
              activeFolder === 'all' ? 'bg-blue-100 text-w95-blue' : 'hover:bg-gray-100 text-gray-800'
            }`}
          >
            <span className="flex items-center gap-1.5">📥 All Inbound</span>
            <span className="text-[10px] font-mono">{counts.all}</span>
          </div>

          <div
            onClick={() => setActiveFolder('proposals')}
            className={`p-1.5 rounded cursor-pointer flex items-center justify-between ${
              activeFolder === 'proposals' ? 'bg-blue-100 text-w95-blue font-bold' : 'hover:bg-gray-100 text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">🤝 Pull Requests</span>
            <span className="text-[10px] font-mono">{counts.proposals}</span>
          </div>

          <div
            onClick={() => setActiveFolder('agent_logs')}
            className={`p-1.5 rounded cursor-pointer flex items-center justify-between ${
              activeFolder === 'agent_logs' ? 'bg-blue-100 text-w95-blue font-bold' : 'hover:bg-gray-100 text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">🤖 Agent Reports</span>
            <span className="text-[10px] font-mono">{counts.agent_logs}</span>
          </div>

          <div
            onClick={() => setActiveFolder('royalties')}
            className={`p-1.5 rounded cursor-pointer flex items-center justify-between ${
              activeFolder === 'royalties' ? 'bg-blue-100 text-w95-blue font-bold' : 'hover:bg-gray-100 text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">💰 Royalties Settled</span>
            <span className="text-[10px] font-mono">{counts.royalties}</span>
          </div>

          <div
            onClick={() => setActiveFolder('feedback')}
            className={`p-1.5 rounded cursor-pointer flex items-center justify-between ${
              activeFolder === 'feedback' ? 'bg-blue-100 text-w95-blue font-bold' : 'hover:bg-gray-100 text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">💬 Maker Feedback</span>
            <span className="text-[10px] font-mono">{counts.feedback}</span>
          </div>
        </div>

        <div className="pt-2 border-t text-[11px] text-gray-500 font-mono flex items-center justify-between">
          <span>GITSMITH CAS v2.4</span>
          <button
            onClick={() => fetchInbox()}
            disabled={isLoading}
            title="Refresh Inbox"
            className="hover:text-gray-800 p-0.5"
          >
            <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Pane 2: Message Threads List */}
      <div className="col-span-3 bg-white border-2 border-gray-800 overflow-y-auto flex flex-col">
        <div className="p-2 border-b bg-gray-100 font-bold text-gray-700 text-[11px] flex justify-between items-center">
          <span>Showing {filtered.length} Threads</span>
          {isLoading && <span className="text-gray-400 font-normal">Loading...</span>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-8 text-gray-500 gap-2">
              <RefreshCw size={18} className="animate-spin text-w95-blue" />
              <span>Fetching inbound queue...</span>
            </div>
          ) : fetchError ? (
            <div className="p-4 m-2 bg-amber-50 border border-amber-300 rounded text-amber-900 space-y-2">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertCircle size={14} className="text-amber-700" />
                <span>Inbox Notice</span>
              </div>
              <p className="text-[11px] leading-relaxed">{fetchError}</p>
              {!isAuthenticated && (
                <button
                  onClick={() => openAuthModal('login')}
                  className="btn-w95 btn-w95-primary px-2.5 py-1 text-xs flex items-center gap-1 font-bold"
                >
                  <Lock size={11} /> Log In to Authenticate
                </button>
              )}
              {isAuthenticated && (
                <button
                  onClick={() => fetchInbox()}
                  className="btn-w95 px-2.5 py-1 text-xs flex items-center gap-1 font-bold"
                >
                  <RefreshCw size={11} /> Retry Fetch
                </button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-gray-400 gap-2">
              <Inbox size={24} className="text-gray-300" />
              <div className="font-bold text-gray-600">Folder is empty</div>
              <div className="text-[11px] text-center text-gray-500">
                No messages found in '{activeFolder}'.
              </div>
            </div>
          ) : (
            filtered.map(t => (
              <div
                key={t.id}
                onClick={() => setSelectedThreadId(t.id)}
                className={`p-2.5 border-b cursor-pointer transition-colors ${
                  selectedThread?.id === t.id ? 'bg-blue-50 border-l-4 border-l-w95-blue' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex justify-between items-center font-bold">
                  <span className="text-gray-900 flex items-center gap-1 truncate">
                    <span>{t.category === 'proposals' ? <GitPullRequest size={12} className="text-purple-700" /> : t.fromAvatar}</span>
                    <span className="truncate">{t.direction === 'sent' ? `To: ${t.from}` : t.from}</span>
                  </span>
                  <span className="text-[10px] text-gray-500 shrink-0 font-mono">{t.time}</span>
                </div>
                <div className={`truncate my-0.5 ${t.unread ? 'font-bold text-w95-blue' : 'text-gray-800'}`}>
                  {t.unread && <span className="inline-block w-1.5 h-1.5 bg-w95-blue rounded-full mr-1"></span>}
                  {t.subject}
                </div>
                <p className="text-gray-500 text-[11px] truncate">{t.body}</p>
                {t.category === 'proposals' && (
                  <div className="mt-1 flex items-center gap-1 text-[10px]">
                    {t.isMerged ? (
                      <span className="bg-purple-100 text-purple-800 px-1 py-0.2 rounded font-bold">Merged</span>
                    ) : t.approvalStatus === 'approved' ? (
                      <span className="bg-blue-100 text-blue-800 px-1 py-0.2 rounded font-bold">Merging…</span>
                    ) : t.approvalStatus === 'rejected' ? (
                      <span className="bg-red-100 text-red-800 px-1 py-0.2 rounded font-bold">Changes requested</span>
                    ) : (
                      <span className="bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-bold">Open PR</span>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          {!isLoading && !fetchError && nextCursor && (
            <button
              onClick={() => fetchInbox(nextCursor)}
              disabled={isLoadingMore}
              className="btn-w95 m-2 px-2 py-1 text-[11px] font-bold disabled:opacity-50"
            >
              {isLoadingMore ? 'Loading…' : 'Load older messages'}
            </button>
          )}
        </div>
      </div>

      {/* Pane 3: GitHub-Style Pull Request & Reading Pane */}
      <div className="col-span-6 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between overflow-y-auto">
        {selectedThread ? (
          selectedThread.category === 'proposals' ? (
            /* =========================================================================
             * REAL GITHUB-STYLE PULL REQUEST INTERFACE
             * ========================================================================= */
            <div className="flex flex-col h-full justify-between overflow-y-auto space-y-3">
              {/* Notification Banners */}
              {actionError && (
                <div className="p-2 bg-red-50 border border-red-300 text-red-800 text-[11px] rounded flex items-center justify-between">
                  <span>⚠ {actionError}</span>
                  <button onClick={() => setActionError(null)} className="font-bold text-red-600 ml-2">×</button>
                </div>
              )}
              {actionSuccess && (
                <div className="p-2 bg-emerald-50 border border-emerald-300 text-emerald-800 text-[11px] rounded flex items-center justify-between">
                  <span>{actionSuccess}</span>
                  <button onClick={() => setActionSuccess(null)} className="font-bold text-emerald-600 ml-2">×</button>
                </div>
              )}

              {/* 1. PR Header & Metadata */}
              <div className="border-b pb-2 space-y-1.5">
                <div className="flex justify-between items-start">
                  <div className="space-y-0.5">
                    <div className="text-base font-bold text-gray-900 flex items-center gap-2">
                      <GitPullRequest size={16} className="text-purple-700 shrink-0" />
                      <span>{selectedThread.subject}</span>
                      <span className="text-gray-400 font-mono text-xs font-normal">
                        #{selectedThread.mergeAttemptId ? selectedThread.mergeAttemptId.slice(0, 8) : selectedThread.id.slice(0, 8)}
                      </span>
                    </div>

                    {/* Sub-header: branch mapping & status */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                      {(() => {
                        const status = formatProposalStatus(selectedThread, diffData);
                        return (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 ${status.badgeStyle}`}>
                            {selectedThread.isMerged ? <Check size={11} /> : <GitPullRequest size={11} />}
                            {status.badgeLabel}
                          </span>
                        );
                      })()}
                      <span>
                        <span className="font-bold text-gray-900">{selectedThread.from}</span> wants to merge changes into{' '}
                        <span className="font-mono bg-gray-100 px-1 py-0.5 rounded border border-gray-300 font-bold text-purple-900">
                          {diffData?.targetRef || selectedThread.featureRef || 'main'}
                        </span>{' '}
                        from{' '}
                        <span className="font-mono bg-gray-100 px-1 py-0.5 rounded border border-gray-300 font-bold text-purple-900">
                          {diffData?.featureRef || selectedThread.featureRef || 'feature'}
                        </span>
                      </span>
                    </div>
                  </div>

                  {selectedThread.direction !== 'sent' && (
                    <button
                      onClick={() => handleToggleRead(selectedThread.id, selectedThread.unread)}
                      disabled={actionPending === `toggle_read_${selectedThread.id}`}
                      className="btn-w95 px-2 py-0.5 text-[10px] flex items-center gap-1 text-gray-700"
                      title={selectedThread.unread ? 'Mark as read' : 'Mark as unread'}
                    >
                      <CheckCheck size={11} />
                      {selectedThread.unread ? 'Mark Read' : 'Mark Unread'}
                    </button>
                  )}
                </div>

                {/* CAS Range Information */}
                <div className="bg-gray-50 border border-gray-300 p-1.5 rounded font-mono text-[11px] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">CAS:</span>
                    <span className="bg-white border px-1 rounded text-gray-700">
                      {selectedThread.casOldSha ? selectedThread.casOldSha.slice(0, 7) : (diffData?.baseOid ? diffData.baseOid.slice(0, 7) : '0000000')}
                    </span>
                    <span>&rarr;</span>
                    <span className="bg-white border px-1 rounded text-purple-800 font-bold">
                      {selectedThread.casNewSha ? selectedThread.casNewSha.slice(0, 7) : (diffData?.headOid ? diffData.headOid.slice(0, 7) : 'unknown')}
                    </span>
                  </div>
                  {diffData && (
                    <div className="text-[10px] text-gray-500">
                      {diffData.isFastForward ? (
                        <span className="text-emerald-700 font-bold">✔ Fast-Forwardable</span>
                      ) : diffData.diverged ? (
                        <span className="text-amber-800 font-bold">⚠ Diverged (+{diffData.aheadCount} / -{diffData.behindCount})</span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. GitHub-Style PR Tabs */}
              <div className="flex border-b border-gray-400 bg-gray-100 text-xs font-bold gap-1 px-1 pt-1">
                <button
                  onClick={() => setPrActiveTab('conversation')}
                  className={`px-3 py-1.5 border-t-2 border-l-2 border-r-2 flex items-center gap-1.5 ${
                    prActiveTab === 'conversation'
                      ? 'bg-white border-gray-800 border-b-white z-10 -mb-[2px] font-bold text-w95-blue'
                      : 'bg-gray-100 border-gray-300 hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <MessageSquare size={13} />
                  <span>Conversation</span>
                  <span className="bg-gray-200 text-gray-700 text-[10px] px-1.5 py-0.2 rounded font-mono">
                    {conversation.length || 1}
                  </span>
                </button>

                <button
                  onClick={() => setPrActiveTab('commits')}
                  className={`px-3 py-1.5 border-t-2 border-l-2 border-r-2 flex items-center gap-1.5 ${
                    prActiveTab === 'commits'
                      ? 'bg-white border-gray-800 border-b-white z-10 -mb-[2px] font-bold text-w95-blue'
                      : 'bg-gray-100 border-gray-300 hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <GitCommit size={13} />
                  <span>Commits</span>
                  <span className="bg-gray-200 text-gray-700 text-[10px] px-1.5 py-0.2 rounded font-mono">
                    {diffData?.commits?.length ?? 0}
                  </span>
                </button>

                <button
                  onClick={() => setPrActiveTab('files')}
                  className={`px-3 py-1.5 border-t-2 border-l-2 border-r-2 flex items-center gap-1.5 ${
                    prActiveTab === 'files'
                      ? 'bg-white border-gray-800 border-b-white z-10 -mb-[2px] font-bold text-w95-blue'
                      : 'bg-gray-100 border-gray-300 hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <FileCode size={13} />
                  <span>Files Changed</span>
                  <span className="bg-gray-200 text-gray-700 text-[10px] px-1.5 py-0.2 rounded font-mono">
                    {diffData?.files?.length ?? 0}
                  </span>
                  {diffData && (diffData.totalAdditions > 0 || diffData.totalDeletions > 0) && (
                    <span className="text-[10px] font-mono">
                      <span className="text-emerald-700 font-bold">+{diffData.totalAdditions}</span>{' '}
                      <span className="text-red-700 font-bold">-{diffData.totalDeletions}</span>
                    </span>
                  )}
                </button>
              </div>

              {/* 3. Tab Contents */}
              <div className="flex-1 overflow-y-auto space-y-3">
                {/* -------------------------------------------------------------
                 * TAB 1: CONVERSATION & REVIEW TIMELINE
                 * ------------------------------------------------------------- */}
                {prActiveTab === 'conversation' && (
                  <div className="space-y-3">
                    {/* PR Initial Description Card */}
                    <div className="border border-gray-300 rounded bg-white overflow-hidden">
                      <div className="bg-gray-100 border-b border-gray-300 p-2 flex justify-between items-center text-[11px]">
                        <span className="font-bold text-gray-900 flex items-center gap-1.5">
                          <span>{selectedThread.fromAvatar}</span>
                          <span>{selectedThread.from}</span>
                          <span className="font-normal text-gray-500">opened this pull request</span>
                        </span>
                        <span className="font-mono text-gray-500 text-[10px]">{selectedThread.time}</span>
                      </div>
                      <div className="p-3 text-xs leading-relaxed whitespace-pre-wrap text-gray-800">
                        {selectedThread.body}
                      </div>
                    </div>

                    {/* Timeline of Comments and Review Events */}
                    {conversation.length > 1 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold text-gray-600 flex items-center gap-1">
                          <MessageSquare size={12} /> Discussion &amp; Review Timeline ({conversation.length - 1} replies)
                        </div>
                        {conversation.slice(1).map(message => (
                          <div key={message.id} className="border border-gray-300 rounded bg-white overflow-hidden">
                            <div className="bg-gray-50 border-b border-gray-200 p-1.5 px-2 flex justify-between items-center text-[10px]">
                              <span className="font-bold text-gray-800 flex items-center gap-1">
                                <span>{message.fromAvatar}</span>
                                <span>{message.direction === 'sent' ? 'You' : message.from}</span>
                              </span>
                              <span className="font-mono text-gray-500">{message.time}</span>
                            </div>
                            <div className="p-2.5 text-xs whitespace-pre-wrap text-gray-800">
                              {message.body}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Formal Review Summary Card if reviewed */}
                    {selectedThread.approvalComment && (
                      <div className={`p-2.5 border rounded text-xs space-y-1 ${
                        selectedThread.approvalStatus === 'approved'
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                          : 'bg-red-50 border-red-300 text-red-950'
                      }`}>
                        <div className="font-bold flex items-center gap-1">
                          {selectedThread.approvalStatus === 'approved' ? <Check size={13} className="text-emerald-700" /> : <XCircle size={13} className="text-red-700" />}
                          <span>Review Decision: {selectedThread.approvalStatus === 'approved' ? 'Approved' : 'Changes Requested'}</span>
                        </div>
                        <div className="text-[11px] whitespace-pre-wrap bg-white p-2 rounded border border-gray-200">
                          {selectedThread.approvalComment}
                        </div>
                      </div>
                    )}

                    {/* GitHub Merge Control Box */}
                    {(() => {
                      const status = formatProposalStatus(selectedThread, diffData);
                      return (
                        <div className="bg-gray-50 border-2 border-gray-600 rounded p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="font-bold text-gray-900 flex items-center gap-1.5">
                              <ShieldCheck size={15} className="text-w95-blue" />
                              <span>Merge Control &amp; Verification</span>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${status.badgeStyle}`}>
                              {status.badgeLabel}
                            </span>
                          </div>

                          {/* Divergence Warning / Mergeability Truth */}
                          {diffData?.diverged ? (
                            <div className="p-2.5 bg-amber-50 border border-amber-400 rounded text-amber-950 text-xs space-y-1">
                              <div className="font-bold flex items-center gap-1.5 text-amber-900">
                                <AlertTriangle size={14} className="text-amber-700" />
                                <span>This branch has conflicts / needs a merge commit</span>
                              </div>
                              <p className="text-[11px] leading-relaxed">
                                The target branch has moved forward by <b>{diffData.behindCount || 1}</b> commit(s) since this fork was branched.
                                A fast-forward CAS cannot land cleanly without a rebase or merge commit.
                              </p>
                            </div>
                          ) : diffData?.isFastForward ? (
                            <div className="p-2 bg-emerald-50 border border-emerald-300 rounded text-emerald-950 text-[11px] flex items-center gap-1.5">
                              <Check size={13} className="text-emerald-700 shrink-0" />
                              <span>This branch has no conflicts with the base branch (fast-forward mergeable).</span>
                            </div>
                          ) : null}

                          <p className="text-gray-600 text-[11px] leading-relaxed">
                            {status.description}
                          </p>

                          {/* Review Actions */}
                          {(status.canApprove || status.canReject) && (() => {
                            const grantableBps = diffData?.grantableBps ?? diffData?.grantable_bps ?? 0;
                            const grantedBps = diffData?.grantedBps ?? diffData?.granted_bps ?? 0;
                            const remainingBps = diffData?.remainingGrantableBps ?? diffData?.remaining_grantable_bps ?? Math.max(0, grantableBps - grantedBps);
                            const remainingPercentFormatted = (remainingBps / 100).toFixed(remainingBps % 100 === 0 ? 0 : 2);
                            const numericRewardPercent = parseFloat(rewardPercent) || 0;

                            return (
                              <div className="space-y-2 pt-1 border-t border-gray-300">
                                <textarea
                                  value={reviewComment}
                                  onChange={e => setReviewComment(e.target.value)}
                                  maxLength={2000}
                                  placeholder="Leave a review comment (required when requesting changes)..."
                                  className="w-full min-h-16 p-2 border border-gray-400 bg-white text-xs rounded"
                                />

                                {/* Contributor Reward Grant Control */}
                                {status.canApprove && (
                                  <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="font-bold text-gray-800 flex items-center gap-1.5">
                                        <span>Reward contributor</span>
                                        <span className="text-[10px] font-normal text-gray-600">
                                          (Pool headroom: <b>{remainingPercentFormatted}%</b> · {remainingBps} bps remaining)
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="number"
                                          min="0"
                                          max={remainingBps / 100}
                                          step="1"
                                          value={rewardPercent}
                                          onChange={e => setRewardPercent(e.target.value)}
                                          placeholder="0"
                                          className="w-16 px-1.5 py-0.5 border border-gray-400 text-right text-xs bg-white rounded font-mono"
                                        />
                                        <span className="font-bold text-gray-700 text-xs">%</span>
                                      </div>
                                    </div>
                                    {numericRewardPercent > 0 && (
                                      <div className="text-[11px] text-blue-950 bg-blue-100/70 p-2 rounded border border-blue-300 space-y-1">
                                        <p className="leading-relaxed">
                                          Permanent — this contributor earns {numericRewardPercent}% of every future sale of this app, forever. It's carved from your share; ancestors and the protocol pool are untouched. Once the contribution lands, this can't be undone.
                                        </p>
                                        <p className="text-[10px] text-gray-600">
                                          The % set at first approval is final for this attempt (replays cannot change it).
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div className="flex justify-between items-center">
                                  <div className="text-[10px] text-gray-500 max-w-[280px]">
                                    Approving records an immutable review and enqueues exact CAS landing.
                                  </div>
                                  <div className="flex gap-2">
                                    {status.canReject && (
                                      <button
                                        onClick={() => handleReviewProposal(selectedThread.id, 'reject')}
                                        disabled={Boolean(actionPending) || reviewComment.trim().length < 3}
                                        className="btn-w95 px-3 py-1.5 flex items-center gap-1 font-bold text-red-800 disabled:opacity-50"
                                      >
                                        <XCircle size={12} /> Request Changes
                                      </button>
                                    )}
                                    {status.canApprove && (
                                      <button
                                        onClick={() => handleReviewProposal(selectedThread.id, 'approve')}
                                        disabled={Boolean(actionPending)}
                                        className="btn-w95 btn-w95-primary px-3 py-1.5 flex items-center gap-1 font-bold shadow-md disabled:opacity-50"
                                      >
                                        <GitPullRequest size={12} /> Approve Exact OID
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}

                    {/* Quick Discussion Comment Box */}
                    <form onSubmit={handleSendReply} className="pt-2 border-t flex flex-col gap-1.5">
                      <div className="flex justify-between items-center text-[11px] font-bold text-gray-700">
                        <span>Add to conversation:</span>
                        {actionPending === 'reply' && (
                          <span className="text-blue-700 font-bold flex items-center gap-1">
                            <RefreshCw size={10} className="animate-spin" /> Submitting...
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="Write a reply or review note..."
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          disabled={actionPending === 'reply'}
                          className="flex-1 p-1.5 border border-gray-400 text-xs bg-gray-50 disabled:bg-gray-100"
                        />
                        <button
                          type="submit"
                          disabled={actionPending === 'reply' || !replyText.trim()}
                          className="btn-w95 btn-w95-primary px-3 py-1 text-xs flex items-center gap-1 font-bold disabled:opacity-50"
                        >
                          <Send size={11} /> Comment
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* -------------------------------------------------------------
                 * TAB 2: COMMITS LIST
                 * ------------------------------------------------------------- */}
                {prActiveTab === 'commits' && (
                  <div className="space-y-2">
                    {isLoadingDiff ? (
                      <div className="flex flex-col items-center justify-center p-8 text-gray-500 gap-2">
                        <RefreshCw size={18} className="animate-spin text-w95-blue" />
                        <span>Loading commit log from bare Git repository...</span>
                      </div>
                    ) : diffError ? (
                      <div className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs rounded space-y-1">
                        <b>Diff Error:</b> {diffError}
                        <button onClick={() => fetchProposalDiff(selectedThread.id)} className="btn-w95 block mt-2 text-[10px]">
                          Retry
                        </button>
                      </div>
                    ) : !diffData || diffData.commits.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-8 text-gray-400 gap-1">
                        <GitCommit size={24} className="text-gray-300" />
                        <div className="font-bold text-gray-600">No commits found</div>
                        <div className="text-[11px] text-gray-500">Base and head refs point to identical commit history.</div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold text-gray-600">
                          Showing {diffData.commits.length} commit(s) in this pull request:
                        </div>
                        {diffData.commits.map((commit, idx) => (
                          <div key={commit.sha || idx} className="border border-gray-300 rounded bg-white p-2 flex justify-between items-start">
                            <div className="space-y-0.5">
                              <div className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                                <GitCommit size={13} className="text-purple-700 shrink-0" />
                                <span>{commit.summary || 'Commit'}</span>
                              </div>
                              <div className="text-[10px] text-gray-500 flex items-center gap-2">
                                <span>{commit.authorName}</span>
                                <span>&middot;</span>
                                <span className="font-mono">{commit.authorDate || selectedThread.time}</span>
                              </div>
                              {commit.message && commit.message !== commit.summary && (
                                <p className="text-[11px] text-gray-600 whitespace-pre-wrap mt-1">
                                  {commit.message}
                                </p>
                              )}
                            </div>
                            <span className="font-mono text-[10px] bg-gray-100 border border-gray-300 px-1.5 py-0.5 rounded text-gray-700 shrink-0" title={commit.sha}>
                              {commit.shortSha}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* -------------------------------------------------------------
                 * TAB 3: FILES CHANGED & UNIFIED DIFF
                 * ------------------------------------------------------------- */}
                {prActiveTab === 'files' && (
                  <div className="space-y-3">
                    {isLoadingDiff ? (
                      <div className="flex flex-col items-center justify-center p-8 text-gray-500 gap-2">
                        <RefreshCw size={18} className="animate-spin text-w95-blue" />
                        <span>Computing unified diff via git diff...</span>
                      </div>
                    ) : diffError ? (
                      <div className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs rounded space-y-1">
                        <b>Diff Error:</b> {diffError}
                        <button onClick={() => fetchProposalDiff(selectedThread.id)} className="btn-w95 block mt-2 text-[10px]">
                          Retry
                        </button>
                      </div>
                    ) : !diffData || diffData.files.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-8 text-gray-400 gap-1">
                        <FileCode size={24} className="text-gray-300" />
                        <div className="font-bold text-gray-600">No file changes</div>
                        <div className="text-[11px] text-gray-500">There are no file differences between the target and head refs.</div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Files Changed Summary Bar */}
                        <div className="bg-gray-100 border border-gray-300 p-2 rounded flex justify-between items-center text-xs">
                          <span className="font-bold text-gray-800">
                            Showing {diffData.files.length} changed file{diffData.files.length === 1 ? '' : 's'} with {diffData.totalAdditions} addition{diffData.totalAdditions === 1 ? '' : 's'} and {diffData.totalDeletions} deletion{diffData.totalDeletions === 1 ? '' : 's'}.
                          </span>
                          <div className="flex gap-1">
                            <span className="font-mono text-emerald-800 font-bold bg-emerald-100 px-1.5 py-0.2 rounded text-[10px]">+{diffData.totalAdditions}</span>
                            <span className="font-mono text-red-800 font-bold bg-red-100 px-1.5 py-0.2 rounded text-[10px]">-{diffData.totalDeletions}</span>
                          </div>
                        </div>

                        {/* Per-File Diff Containers */}
                        {diffData.files.map(file => {
                          const isCollapsed = collapsedFiles.has(file.newPath || file.oldPath);
                          return (
                            <div key={file.newPath || file.oldPath} className="border-2 border-gray-700 rounded bg-white overflow-hidden shadow-sm">
                              {/* File Diff Header */}
                              <div
                                onClick={() => toggleFileCollapse(file.newPath || file.oldPath)}
                                className="bg-gray-100 border-b border-gray-400 p-2 flex justify-between items-center cursor-pointer select-none hover:bg-gray-200"
                              >
                                <div className="flex items-center gap-1.5 font-bold font-mono text-xs text-gray-900 truncate">
                                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                  <FileText size={13} className="text-gray-600 shrink-0" />
                                  <span className="truncate">{file.oldPath !== file.newPath ? `${file.oldPath} → ${file.newPath}` : file.newPath}</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                                  <span className={`px-1.5 py-0.2 rounded font-bold uppercase ${
                                    file.status === 'added' ? 'bg-emerald-100 text-emerald-800' :
                                    file.status === 'deleted' ? 'bg-red-100 text-red-800' :
                                    file.status === 'renamed' ? 'bg-purple-100 text-purple-800' :
                                    'bg-blue-100 text-blue-800'
                                  }`}>
                                    {file.status}
                                  </span>
                                  <span className="font-mono text-emerald-700 font-bold">+{file.additions}</span>
                                  <span className="font-mono text-red-700 font-bold">-{file.deletions}</span>
                                </div>
                              </div>

                              {/* File Diff Content / Hunks */}
                              {!isCollapsed && (
                                file.isBinary ? (
                                  <div className="p-4 text-center text-gray-500 font-mono text-xs">
                                    Binary file differences not rendered.
                                  </div>
                                ) : file.hunks && file.hunks.length > 0 ? (
                                  <div className="overflow-x-auto text-[11px] font-mono leading-tight">
                                    <table className="w-full border-collapse">
                                      <tbody>
                                        {file.hunks.map((hunk, hIdx) => (
                                          <React.Fragment key={hIdx}>
                                            {hunk.lines.map((line, lIdx) => (
                                              <tr
                                                key={lIdx}
                                                className={
                                                  line.type === 'header' ? 'bg-blue-50 text-blue-800 font-bold select-none' :
                                                  line.type === 'add' ? 'bg-emerald-50 text-emerald-950 border-l-2 border-emerald-500' :
                                                  line.type === 'delete' ? 'bg-red-50 text-red-950 border-l-2 border-red-500' :
                                                  'bg-white text-gray-800'
                                                }
                                              >
                                                {/* Old Line Number */}
                                                <td className="w-10 px-1 py-0.5 text-right text-gray-400 select-none border-r border-gray-200 text-[10px]">
                                                  {line.oldLineNumber ?? ''}
                                                </td>
                                                {/* New Line Number */}
                                                <td className="w-10 px-1 py-0.5 text-right text-gray-400 select-none border-r border-gray-200 text-[10px]">
                                                  {line.newLineNumber ?? ''}
                                                </td>
                                                {/* Line Content */}
                                                <td className="px-2 py-0.5 whitespace-pre font-mono">
                                                  {line.type === 'add' ? '+ ' : line.type === 'delete' ? '- ' : '  '}
                                                  {line.content}
                                                </td>
                                              </tr>
                                            ))}
                                          </React.Fragment>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <pre className="p-2 text-[11px] font-mono overflow-x-auto bg-gray-50 text-gray-800 whitespace-pre">
                                    {file.patch}
                                  </pre>
                                )
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* =========================================================================
             * STANDARD MAIL / AGENT LOG / FEEDBACK VIEW
             * ========================================================================= */
            <>
              <div className="space-y-3">
                {/* Notification Banners */}
                {actionError && (
                  <div className="p-2 bg-red-50 border border-red-300 text-red-800 text-[11px] rounded flex items-center justify-between">
                    <span>⚠ {actionError}</span>
                    <button onClick={() => setActionError(null)} className="font-bold text-red-600 ml-2">×</button>
                  </div>
                )}
                {actionSuccess && (
                  <div className="p-2 bg-emerald-50 border border-emerald-300 text-emerald-800 text-[11px] rounded flex items-center justify-between">
                    <span>{actionSuccess}</span>
                    <button onClick={() => setActionSuccess(null)} className="font-bold text-emerald-600 ml-2">×</button>
                  </div>
                )}

                {/* Message Header */}
                <div className="border-b pb-2 flex justify-between items-start">
                  <div>
                    <div className="text-sm font-bold text-w95-blue flex items-center gap-1.5">
                      <span>{selectedThread.fromAvatar}</span>
                      <span>{selectedThread.subject}</span>
                    </div>
                    <div className="text-gray-600 text-[11px] mt-0.5">
                      {selectedThread.direction === 'sent' ? 'To' : 'From'}: <span className="font-bold text-gray-900">{selectedThread.from}</span> &middot;{' '}
                      <span className="font-mono">{selectedThread.time}</span>
                    </div>
                  </div>

                  {selectedThread.direction !== 'sent' && (
                    <button
                      onClick={() => handleToggleRead(selectedThread.id, selectedThread.unread)}
                      disabled={actionPending === `toggle_read_${selectedThread.id}`}
                      className="btn-w95 px-2 py-0.5 text-[10px] flex items-center gap-1 text-gray-700"
                      title={selectedThread.unread ? 'Mark as read' : 'Mark as unread'}
                    >
                      <CheckCheck size={11} />
                      {selectedThread.unread ? 'Mark Read' : 'Mark Unread'}
                    </button>
                  )}
                </div>

                {/* Message Body */}
                <div className="text-gray-800 text-xs leading-relaxed space-y-2">
                  <p className="whitespace-pre-wrap">{selectedThread.body}</p>

                  {selectedThread.featureRef && selectedThread.featureRef !== 'n/a' && (
                    <div className="bg-gray-50 border border-gray-300 p-2.5 font-mono text-[11px] rounded space-y-1">
                      <div className="text-purple-800 font-bold flex items-center gap-1">
                        <GitBranch size={12} /> Target Ref: {selectedThread.featureRef}
                      </div>
                      {typeof selectedThread.testsPassed === 'number' && (
                        <div><b>Assertions:</b> {selectedThread.testsPassed} recorded as passing</div>
                      )}
                      {selectedThread.casOldSha && selectedThread.casNewSha && (
                        <div><b>CAS OID:</b> {selectedThread.casOldSha} &rarr; {selectedThread.casNewSha}</div>
                      )}
                      {selectedThread.casNewSha && !selectedThread.casOldSha && (
                        <div><b>CAS Commit OID:</b> {selectedThread.casNewSha}</div>
                      )}
                    </div>
                  )}
                </div>

                {conversation.length > 1 && (
                  <div className="border border-gray-300 rounded bg-gray-50 p-2 space-y-2">
                    <div className="font-bold text-[11px] text-gray-700">Conversation · {conversation.length} messages</div>
                    {conversation.map(message => (
                      <div key={message.id} className="bg-white border border-gray-200 p-2 rounded">
                        <div className="text-[10px] text-gray-500 font-mono">
                          {message.direction === 'sent' ? `You → ${message.from}` : `${message.from} → You`} · {message.time}
                        </div>
                        <div className="whitespace-pre-wrap mt-1">{message.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Reply Box */}
              <form onSubmit={handleSendReply} className="pt-3 border-t flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-700 text-[11px]">
                    Reply to {selectedThread.from}:
                  </span>
                  {actionPending === 'reply' && (
                    <span className="text-blue-700 font-bold text-[11px] flex items-center gap-1">
                      <RefreshCw size={10} className="animate-spin" /> Sending...
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Write a reply..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    disabled={actionPending === 'reply'}
                    className="flex-1 p-1.5 border border-gray-400 text-xs bg-gray-50 disabled:bg-gray-100"
                  />
                  <button
                    type="submit"
                    disabled={actionPending === 'reply' || !replyText.trim()}
                    className="btn-w95 btn-w95-primary px-3 py-1 text-xs flex items-center gap-1 font-bold disabled:opacity-50"
                  >
                    <Send size={11} /> Send
                  </button>
                </div>
              </form>
            </>
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2 p-6">
            <Mail size={32} className="text-gray-300" />
            <div className="font-bold text-gray-600">No Message Selected</div>
            <p className="text-[11px] text-center text-gray-500 max-w-[200px]">
              Select a message or pull request from the thread list to view its details.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
