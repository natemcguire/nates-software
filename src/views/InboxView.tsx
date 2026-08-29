import React, { useState, useEffect, useCallback } from 'react';
import { InboxThread, filterThreadsByCategory, calculateFolderCounts, conversationForThread, formatProposalStatus } from '../lib/inboxDomain';
import { useAuth } from '../context/AuthContext';
import {
  Check,
  GitPullRequest,
  ShieldCheck,
  Mail,
  GitBranch,
  Send,
  RefreshCw,
  AlertCircle,
  Inbox,
  Lock,
  CheckCheck,
  XCircle
} from 'lucide-react';

export const InboxView: React.FC = () => {
  const { user, isAuthenticated, openAuthModal } = useAuth();
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

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

  const selectedThread = threads.find(t => t.id === selectedThreadId) || null;
  const filtered = filterThreadsByCategory(threads, activeFolder);
  const counts = calculateFolderCounts(threads);
  const conversation = selectedThread ? conversationForThread(threads, selectedThread.id) : [];

  // Non-optimistic proposal approval
  const handleReviewProposal = async (id: string, decision: 'approve' | 'reject') => {
    setActionPending(`${decision}_${id}`);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decision, messageId: id, comment: reviewComment })
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

  // Non-optimistic reply submission
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
          toUser: selectedThread.from,
          subject: `Re: ${selectedThread.subject}`,
          text
        })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setReplyText('');
        setActionSuccess('✔ Reply dispatched successfully via INBOX bridge');
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        setActionError(data.error || 'Failed to dispatch reply');
      }
    } catch (err: any) {
      setActionError(err.message || 'Network error dispatching reply');
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

  return (
    <div className="grid grid-cols-12 gap-2 h-full overflow-hidden font-tahoma text-xs">
      {/* Pane 1: Mailboxes & Navigation */}
      <div className="col-span-3 bg-white border-2 border-gray-800 p-2 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-1">
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
            <span className="flex items-center gap-1.5">🤝 Merge Proposals</span>
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
      <div className="col-span-4 bg-white border-2 border-gray-800 overflow-y-auto flex flex-col">
        <div className="p-2 border-b bg-gray-100 font-bold text-gray-700 text-[11px] flex justify-between items-center">
          <span>Showing {filtered.length} Messages</span>
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
                    <span>{t.fromAvatar}</span>
                    <span className="truncate">{t.direction === 'sent' ? `To: ${t.from}` : t.from}</span>
                  </span>
                  <span className="text-[10px] text-gray-500 shrink-0 font-mono">{t.time}</span>
                </div>
                <div className={`truncate my-0.5 ${t.unread ? 'font-bold text-w95-blue' : 'text-gray-800'}`}>
                  {t.unread && <span className="inline-block w-1.5 h-1.5 bg-w95-blue rounded-full mr-1"></span>}
                  {t.subject}
                </div>
                <p className="text-gray-500 text-[11px] truncate">{t.body}</p>
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

      {/* Pane 3: Reading & Action Card Pane */}
      <div className="col-span-5 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between overflow-y-auto">
        {selectedThread ? (
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

                {selectedThread.direction !== 'sent' && <button
                  onClick={() => handleToggleRead(selectedThread.id, selectedThread.unread)}
                  disabled={actionPending === `toggle_read_${selectedThread.id}`}
                  className="btn-w95 px-2 py-0.5 text-[10px] flex items-center gap-1 text-gray-700"
                  title={selectedThread.unread ? 'Mark as read' : 'Mark as unread'}
                >
                  <CheckCheck size={11} />
                  {selectedThread.unread ? 'Mark Read' : 'Mark Unread'}
                </button>}
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

              {/* Action Box for Proposals */}
              {selectedThread.category === 'proposals' && (
                (() => {
                  const status = formatProposalStatus(selectedThread);
                  return (
                    <div className="bg-blue-50 border-2 border-w95-blue p-2.5 rounded flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-w95-blue flex items-center gap-1">
                          <ShieldCheck size={14} className="text-blue-700" /> Proposal Approval &amp; Verification
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${status.badgeStyle}`}>
                          {status.badgeLabel}
                        </span>
                      </div>
                      <div className="text-gray-600 text-[11px] leading-relaxed">
                        {status.description}
                      </div>

                      {selectedThread.approvalComment && (
                        <div className="bg-white border border-gray-300 rounded p-2 text-[11px]">
                          <b>Review comment:</b> {selectedThread.approvalComment}
                        </div>
                      )}

                      <div className="flex flex-col gap-1.5 pt-1">
                        {!status.canApprove && !status.canReject ? (
                          <span className={`${status.badgeStyle} font-bold px-3 py-1.5 rounded flex items-center gap-1 text-[11px]`}>
                            <Check size={13} /> {status.badgeLabel}
                          </span>
                        ) : (
                          <>
                            <textarea
                              value={reviewComment}
                              onChange={event => setReviewComment(event.target.value)}
                              maxLength={2000}
                              placeholder="Review comment (required when requesting changes)"
                              className="w-full min-h-16 p-1.5 border border-gray-400 bg-white text-xs"
                            />
                            <div className="text-[10px] text-gray-600">
                              Approval records this exact result OID for GITSMITH. Requesting changes rejects it. Neither action moves a Git ref.
                            </div>
                            <div className="flex justify-end gap-2">
                              {status.canReject && <button
                                onClick={() => handleReviewProposal(selectedThread.id, 'reject')}
                                disabled={Boolean(actionPending) || reviewComment.trim().length < 3}
                                className="btn-w95 px-3 py-1.5 flex items-center gap-1 font-bold disabled:opacity-50"
                              >
                                <XCircle size={12} /> Request Changes
                              </button>}
                              {status.canApprove && <button
                                onClick={() => handleReviewProposal(selectedThread.id, 'approve')}
                                disabled={Boolean(actionPending)}
                                className="btn-w95 btn-w95-primary px-3 py-1.5 flex items-center gap-1 font-bold shadow-md disabled:opacity-50"
                              >
                                <GitPullRequest size={12} /> Approve Exact OID
                              </button>}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()
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
                    <RefreshCw size={10} className="animate-spin" /> Dispatching...
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Type message or instruction for agent..."
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
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2 p-6">
            <Mail size={32} className="text-gray-300" />
            <div className="font-bold text-gray-600">No Message Selected</div>
            <p className="text-[11px] text-center text-gray-500 max-w-[200px]">
              Select a message from the thread list to view its full details and actions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
