import React, { useState } from 'react';
import { INITIAL_THREADS, InboxThread, filterThreadsByCategory } from '../lib/inboxDomain';
import { Check, GitPullRequest, ShieldCheck, Mail, GitBranch, Send } from 'lucide-react';

export const InboxView: React.FC = () => {
  const [threads, setThreads] = useState<InboxThread[]>([...INITIAL_THREADS]);
  const [selectedThread, setSelectedThread] = useState<InboxThread>(INITIAL_THREADS[0]);
  const [activeFolder, setActiveFolder] = useState<string>('all');
  const [replyText, setReplyText] = useState('');
  const [replySent, setReplySent] = useState(false);

  const handleApproveMerge = (id: string) => {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, isMerged: true, unread: false } : t));
    if (selectedThread.id === id) {
      setSelectedThread(prev => ({ ...prev, isMerged: true, unread: false }));
    }
  };

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setReplySent(true);
    setReplyText('');
    setTimeout(() => setReplySent(false), 2500);
  };

  const filtered = filterThreadsByCategory(threads, activeFolder);
  const unreadCount = threads.filter(t => t.unread).length;

  return (
    <div className="grid grid-cols-12 gap-2 h-full overflow-hidden font-tahoma text-xs">
      {/* Pane 1: Mailboxes & Navigation */}
      <div className="col-span-3 bg-white border-2 border-gray-800 p-2 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-1">
          <div className="font-bold text-w95-blue border-b pb-1 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1"><Mail size={13} /> INBOX.EXE</span>
            <span className="bg-w95-blue text-white text-[10px] px-1.5 py-0.2 rounded font-mono font-bold">
              {unreadCount} UNREAD
            </span>
          </div>

          <div
            onClick={() => setActiveFolder('all')}
            className={`p-1.5 rounded cursor-pointer flex items-center justify-between font-bold ${
              activeFolder === 'all' ? 'bg-blue-100 text-w95-blue' : 'hover:bg-gray-100 text-gray-800'
            }`}
          >
            <span className="flex items-center gap-1.5">📥 All Inbound</span>
            <span className="text-[10px] font-mono">{threads.length}</span>
          </div>

          <div
            onClick={() => setActiveFolder('proposals')}
            className={`p-1.5 rounded cursor-pointer flex items-center justify-between ${
              activeFolder === 'proposals' ? 'bg-blue-100 text-w95-blue font-bold' : 'hover:bg-gray-100 text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">🤝 Merge Proposals</span>
            <span className="text-[10px] font-mono">2</span>
          </div>

          <div
            onClick={() => setActiveFolder('agent_logs')}
            className={`p-1.5 rounded cursor-pointer flex items-center justify-between ${
              activeFolder === 'agent_logs' ? 'bg-blue-100 text-w95-blue font-bold' : 'hover:bg-gray-100 text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">🤖 Agent Reports</span>
            <span className="text-[10px] font-mono">1</span>
          </div>

          <div
            onClick={() => setActiveFolder('royalties')}
            className={`p-1.5 rounded cursor-pointer flex items-center justify-between ${
              activeFolder === 'royalties' ? 'bg-blue-100 text-w95-blue font-bold' : 'hover:bg-gray-100 text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">💰 Royalties Settled</span>
            <span className="text-[10px] font-mono">1</span>
          </div>
        </div>

        <div className="pt-2 border-t text-[11px] text-gray-500 font-mono">
          GITSMITH CAS Protocol v2.4
        </div>
      </div>

      {/* Pane 2: Message Threads List */}
      <div className="col-span-4 bg-white border-2 border-gray-800 overflow-y-auto">
        <div className="p-2 border-b bg-gray-100 font-bold text-gray-700 text-[11px]">
          Showing {filtered.length} Messages
        </div>
        {filtered.map(t => (
          <div
            key={t.id}
            onClick={() => { setSelectedThread(t); }}
            className={`p-2.5 border-b cursor-pointer transition-colors ${
              selectedThread.id === t.id ? 'bg-blue-50 border-l-4 border-l-w95-blue' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex justify-between items-center font-bold">
              <span className="text-gray-900 flex items-center gap-1 truncate">
                <span>{t.fromAvatar}</span>
                <span className="truncate">{t.from}</span>
              </span>
              <span className="text-[10px] text-gray-500 shrink-0 font-mono">{t.time}</span>
            </div>
            <div className={`truncate my-0.5 ${t.unread ? 'font-bold text-w95-blue' : 'text-gray-800'}`}>
              {t.subject}
            </div>
            <p className="text-gray-500 text-[11px] truncate">{t.body}</p>
          </div>
        ))}
      </div>

      {/* Pane 3: Reading & Action Card Pane */}
      <div className="col-span-5 bg-white border-2 border-gray-800 p-3 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-3">
          <div className="border-b pb-2">
            <div className="text-sm font-bold text-w95-blue flex items-center gap-1.5">
              <span>{selectedThread.fromAvatar}</span>
              <span>{selectedThread.subject}</span>
            </div>
            <div className="text-gray-600 text-[11px] mt-0.5">
              From: <span className="font-bold text-gray-900">{selectedThread.from}</span> &middot; <span className="font-mono">{selectedThread.time}</span>
            </div>
          </div>

          <div className="text-gray-800 text-xs leading-relaxed space-y-2">
            <p>{selectedThread.body}</p>

            {selectedThread.featureRef !== 'n/a' && (
              <div className="bg-gray-50 border border-gray-300 p-2.5 font-mono text-[11px] rounded space-y-1">
                <div className="text-purple-800 font-bold flex items-center gap-1">
                  <GitBranch size={12} /> Target Ref: {selectedThread.featureRef}
                </div>
                <div><b>Assertions:</b> {selectedThread.testsPassed || 4} tests passing (100% green)</div>
                <div><b>CAS OID:</b> {selectedThread.casOldSha} &rarr; {selectedThread.casNewSha}</div>
              </div>
            )}
          </div>

          {/* Action Box for Proposals */}
          {selectedThread.featureRef !== 'n/a' && (
            <div className="bg-blue-50 border-2 border-w95-blue p-2.5 rounded flex items-center justify-between">
              <div>
                <div className="font-bold text-w95-blue flex items-center gap-1">
                  <ShieldCheck size={14} className="text-green-700" /> CAS Merge Verification
                </div>
                <div className="text-gray-600 text-[11px]">Executes atomic git update-ref in GITSMITH.</div>
              </div>

              {selectedThread.isMerged ? (
                <span className="bg-green-600 text-white font-bold px-3 py-1.5 rounded flex items-center gap-1">
                  <Check size={13} /> Merged to Main
                </span>
              ) : (
                <button
                  onClick={() => handleApproveMerge(selectedThread.id)}
                  className="btn-w95 btn-w95-primary px-3 py-1.5 flex items-center gap-1 font-bold shadow-md"
                >
                  <GitPullRequest size={12} /> Approve &amp; Merge &rarr;
                </button>
              )}
            </div>
          )}
        </div>

        {/* Bottom Reply Box */}
        <form onSubmit={handleSendReply} className="pt-3 border-t flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <span className="font-bold text-gray-700 text-[11px]">Reply to {selectedThread.from}:</span>
            {replySent && <span className="text-green-700 font-bold text-[11px]">✔ Dispatched via INBOX bridge</span>}
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="Type message or instruction for agent..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              className="flex-1 p-1.5 border border-gray-400 text-xs bg-gray-50"
            />
            <button type="submit" className="btn-w95 btn-w95-primary px-3 py-1 text-xs flex items-center gap-1 font-bold">
              <Send size={11} /> Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
