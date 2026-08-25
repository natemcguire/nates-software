import React, { useState } from 'react';
import { INBOX_THREADS } from '../data/mockData';
import { Check, GitPullRequest, ShieldCheck } from 'lucide-react';

export const InboxView: React.FC = () => {
  const [threads] = useState(INBOX_THREADS);
  const [selectedThread, setSelectedThread] = useState(INBOX_THREADS[0]);
  const [mergeApproved, setMergeApproved] = useState(false);

  return (
    <div className="grid grid-cols-12 gap-2 h-full overflow-hidden font-tahoma text-xs">
      {/* Left Folders */}
      <div className="col-span-2 bg-white border-2 border-gray-800 p-2 space-y-1">
        <div className="font-bold text-w95-blue border-b pb-1 mb-2">Mailbox</div>
        <div className="bg-blue-100 font-bold p-1.5 rounded cursor-pointer flex items-center justify-between">
          <span>📥 Inbox</span>
          <span className="bg-w95-blue text-white text-[10px] px-1 rounded">3</span>
        </div>
        <div className="p-1.5 hover:bg-gray-100 cursor-pointer text-gray-700">🤝 Proposals (1)</div>
        <div className="p-1.5 hover:bg-gray-100 cursor-pointer text-gray-700">🤖 Agent Logs</div>
        <div className="p-1.5 hover:bg-gray-100 cursor-pointer text-gray-700">💰 Royalties</div>
        <div className="p-1.5 hover:bg-gray-100 cursor-pointer text-gray-500">🗑️ Trash</div>
      </div>

      {/* Middle Thread List */}
      <div className="col-span-4 bg-white border-2 border-gray-800 overflow-y-auto">
        {threads.map(t => (
          <div
            key={t.id}
            onClick={() => { setSelectedThread(t); setMergeApproved(false); }}
            className={`p-2.5 border-b cursor-pointer ${
              selectedThread.id === t.id ? 'bg-blue-50 border-l-4 border-l-w95-blue' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex justify-between items-center font-bold">
              <span className="text-gray-900 truncate">{t.from}</span>
              <span className="text-[10px] text-gray-500 shrink-0">{t.time}</span>
            </div>
            <div className="font-bold text-w95-blue truncate my-0.5">{t.subject}</div>
            <p className="text-gray-600 text-[11px] truncate">{t.body}</p>
          </div>
        ))}
      </div>

      {/* Right Reading & Action Card Pane */}
      <div className="col-span-6 bg-white border-2 border-gray-800 p-3 flex flex-col overflow-y-auto">
        <div className="border-b pb-2 mb-3">
          <div className="text-base font-bold text-w95-blue">{selectedThread.subject}</div>
          <div className="text-gray-600 text-[11px] mt-0.5">
            From: <span className="font-bold text-gray-900">{selectedThread.from}</span> &middot; Time: {selectedThread.time}
          </div>
        </div>

        <div className="flex-1 text-gray-800 text-xs leading-relaxed space-y-2 mb-3">
          <p>{selectedThread.body}</p>

          {selectedThread.featureRef !== 'n/a' && (
            <div className="bg-gray-50 border border-gray-300 p-2.5 font-mono text-[11px] rounded space-y-1">
              <div><b>Target Feature:</b> {selectedThread.featureRef}</div>
              <div><b>Assertions:</b> 4 tests passing (0 failures)</div>
              <div><b>Database Migrations:</b> migrations/004_receipts.sql</div>
              <div><b>CAS OID:</b> 8f4a21b &rarr; 4e10bc9</div>
            </div>
          )}
        </div>

        {/* Action Box */}
        {selectedThread.featureRef !== 'n/a' && (
          <div className="bg-blue-50 border-2 border-w95-blue p-3 flex items-center justify-between">
            <div>
              <div className="font-bold text-w95-blue flex items-center gap-1">
                <ShieldCheck size={14} className="text-green-600" /> Action Required: Approve CAS Merge
              </div>
              <div className="text-gray-600 text-[11px]">Executes atomic git update-ref in GITSMITH.</div>
            </div>

            {mergeApproved ? (
              <span className="bg-green-600 text-white font-bold px-3 py-1.5 rounded flex items-center gap-1">
                <Check size={14} /> Merge Executed Cleanly
              </span>
            ) : (
              <button
                onClick={() => setMergeApproved(true)}
                className="btn-w95 btn-w95-primary px-3 py-1.5 flex items-center gap-1"
              >
                <GitPullRequest size={12} /> Approve & Merge &rarr;
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
