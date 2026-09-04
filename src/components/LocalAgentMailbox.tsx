import React, { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Cpu,
  Power,
  RefreshCw,
  Mail,
  MailOpen,
  Inbox,
  Send,
  AlertTriangle,
  ChevronRight,
  Users
} from 'lucide-react';
import { Win95Scroll } from './Win95Scroll';

export const LOCAL_AGENT_INBOX_URL = 'http://127.0.0.1:8791';

export interface HealthResult {
  running: boolean;
  version?: string;
}

export interface LocalInbox {
  address: string;
  project: string;
  local_part: string;
  display_name: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface LocalThreadSummary {
  thread_id: string;
  subject: string;
  participants: string[];
  last_email_at: string;
  unread_count: number;
}

export interface LocalEmail {
  email_id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body_markdown: string;
  sent_at: string;
  reply_to_email_id: string | null;
  references: string[];
  read: boolean;
}

export interface LocalThreadDetail {
  thread_id: string;
  subject: string;
  emails: LocalEmail[];
}

export async function checkLocalAgentInboxHealth(): Promise<HealthResult> {
  try {
    const res = await fetch(`${LOCAL_AGENT_INBOX_URL}/healthz`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return { running: false };
    const data = await res.json();
    if (data && data.status === 'ok') {
      return { running: true, version: data.version };
    }
    return { running: false };
  } catch {
    return { running: false };
  }
}

export async function fetchLocalInboxes(): Promise<LocalInbox[]> {
  const res = await fetch(`${LOCAL_AGENT_INBOX_URL}/v1/inboxes`, {
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`inboxes request failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data?.inboxes) ? (data.inboxes as LocalInbox[]) : [];
}

export async function fetchLocalThreads(address: string): Promise<LocalThreadSummary[]> {
  const res = await fetch(
    `${LOCAL_AGENT_INBOX_URL}/v1/inboxes/${encodeURIComponent(address)}/threads`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) throw new Error(`threads request failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data?.threads) ? (data.threads as LocalThreadSummary[]) : [];
}

export async function fetchLocalThreadDetail(
  address: string,
  threadId: string
): Promise<LocalThreadDetail> {
  const res = await fetch(
    `${LOCAL_AGENT_INBOX_URL}/v1/inboxes/${encodeURIComponent(address)}/threads/${encodeURIComponent(threadId)}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) throw new Error(`thread detail request failed (${res.status})`);
  return (await res.json()) as LocalThreadDetail;
}

export async function markLocalThreadRead(address: string, threadId: string): Promise<void> {
  await fetch(
    `${LOCAL_AGENT_INBOX_URL}/v1/inboxes/${encodeURIComponent(address)}/threads/${encodeURIComponent(threadId)}/read`,
    { method: 'POST', headers: { Accept: 'application/json' } }
  );
}

interface OfflinePaneProps {
  probing?: boolean;
  onReconnect?: () => void;
}

export const OfflinePane: React.FC<OfflinePaneProps> = ({ probing, onReconnect }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-6 font-tahoma text-xs">
    <div className="w-full max-w-md border-2 border-gray-800 bg-white shadow-md">
      <div className="bg-w95-blue text-white px-2 py-1 font-bold flex items-center gap-1.5">
        <AlertTriangle size={13} /> Local Agent Mailbox Offline
      </div>
      <div className="p-4 space-y-3 text-gray-800">
        <p className="leading-relaxed">
          Could not reach the local <span className="font-mono font-bold">agent-inbox</span> service on{' '}
          <span className="font-mono bg-gray-100 border border-gray-300 px-1 rounded">
            http://127.0.0.1:8791
          </span>
          . Either it is not running, or your browser is blocking local-network
          access from this site (grant it when prompted, then Reconnect).
        </p>
        <div className="space-y-1">
          <div className="font-bold text-gray-700">To enable inter-agent mailbox inspection:</div>
          <ol className="font-mono text-[11px] bg-gray-900 text-emerald-300 p-2.5 rounded space-y-1">
            <li>
              <span className="text-gray-500">1. Install:</span> ./scripts/install.sh
            </li>
            <li>
              <span className="text-gray-500">2. Start:</span> agent-inbox serve{' '}
              <span className="text-gray-500">(or agent-inbox setup)</span>
            </li>
          </ol>
        </div>
        <div className="pt-1 border-t border-gray-200 flex items-center justify-between">
          <span className="text-[10px] text-gray-500">
            No mock data is shown — this pane reflects the real service state.
          </span>
          {onReconnect && (
            <button
              onClick={onReconnect}
              disabled={probing}
              className="btn-w95 btn-w95-primary px-2.5 py-1 text-xs flex items-center gap-1 font-bold disabled:opacity-50"
            >
              <RefreshCw size={11} className={probing ? 'animate-spin' : ''} />
              {probing ? 'Probing…' : 'Reconnect'}
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
);

interface RunningPaneProps {
  version?: string;
  inboxes: LocalInbox[];
  inboxesLoading: boolean;
  inboxesError: string | null;
  selectedAddress: string | null;
  onSelectInbox: (address: string) => void;
  threads: LocalThreadSummary[];
  threadsLoading: boolean;
  threadsError: string | null;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  detail: LocalThreadDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  onReconnect: () => void;
  probing: boolean;
}

export const RunningPane: React.FC<RunningPaneProps> = ({
  version,
  inboxes,
  inboxesLoading,
  inboxesError,
  selectedAddress,
  onSelectInbox,
  threads,
  threadsLoading,
  threadsError,
  selectedThreadId,
  onSelectThread,
  detail,
  detailLoading,
  detailError,
  onReconnect,
  probing
}) => (
  <div className="grid grid-cols-12 gap-2 flex-1 overflow-hidden">
    <div className="col-span-3 bg-white border-2 border-gray-800 p-2 flex flex-col overflow-y-auto">
      <div className="font-bold text-w95-blue border-b pb-1 mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <Cpu size={13} /> Agent Inboxes
        </span>
        <span className="bg-emerald-100 text-emerald-800 text-[9px] px-1 py-0.2 rounded font-mono font-bold">
          {version ? `v${version}` : 'LIVE'}
        </span>
      </div>
      {inboxesLoading ? (
        <div className="flex flex-col items-center justify-center p-6 text-gray-500 gap-2">
          <RefreshCw size={16} className="animate-spin text-w95-blue" />
          <span className="text-[11px]">Loading inboxes…</span>
        </div>
      ) : inboxesError ? (
        <div className="p-2 bg-red-50 border border-red-300 text-red-800 text-[11px] rounded">
          {inboxesError}
        </div>
      ) : inboxes.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-6 text-gray-400 gap-1 text-center">
          <Users size={20} className="text-gray-300" />
          <div className="font-bold text-gray-600">No agent inboxes yet</div>
          <div className="text-[11px] text-gray-500">
            Run <span className="font-mono">agent-inbox whoami</span> in a project to register one.
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {inboxes.map(box => (
            <div
              key={box.address}
              onClick={() => onSelectInbox(box.address)}
              className={`p-1.5 rounded cursor-pointer flex items-center justify-between ${
                selectedAddress === box.address
                  ? 'bg-blue-100 text-w95-blue font-bold'
                  : 'hover:bg-gray-100 text-gray-800'
              }`}
            >
              <span className="flex items-center gap-1.5 truncate">
                <Inbox size={12} className="shrink-0" />
                <span className="truncate font-mono text-[11px]">{box.address}</span>
              </span>
              <ChevronRight size={12} className="shrink-0 text-gray-400" />
            </div>
          ))}
        </div>
      )}
      <div className="mt-auto pt-2 border-t text-[10px] text-gray-500 font-mono flex items-center justify-between">
        <span>127.0.0.1:8791</span>
        <button
          onClick={onReconnect}
          disabled={probing}
          title="Re-probe local service"
          className="hover:text-gray-800 p-0.5"
        >
          <RefreshCw size={11} className={probing ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>

    <div className="col-span-3 bg-white border-2 border-gray-800 overflow-y-auto flex flex-col">
      <div className="p-2 border-b bg-gray-100 font-bold text-gray-700 text-[11px] flex justify-between items-center">
        <span className="truncate">
          {selectedAddress ? `Threads · ${selectedAddress}` : 'Threads'}
        </span>
        {threadsLoading && <span className="text-gray-400 font-normal">Loading…</span>}
      </div>
      <Win95Scroll className="flex-1">
        {!selectedAddress ? (
          <div className="flex flex-col items-center justify-center p-8 text-gray-400 gap-2 text-center">
            <Inbox size={22} className="text-gray-300" />
            <div className="text-[11px] text-gray-500">Select an inbox to view its threads.</div>
          </div>
        ) : threadsLoading ? (
          <div className="flex flex-col items-center justify-center p-8 text-gray-500 gap-2">
            <RefreshCw size={18} className="animate-spin text-w95-blue" />
            <span className="text-[11px]">Fetching threads…</span>
          </div>
        ) : threadsError ? (
          <div className="p-3 m-2 bg-red-50 border border-red-300 text-red-800 text-[11px] rounded">
            {threadsError}
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-gray-400 gap-2 text-center">
            <Mail size={22} className="text-gray-300" />
            <div className="font-bold text-gray-600">No threads</div>
            <div className="text-[11px] text-gray-500">This inbox has no conversations yet.</div>
          </div>
        ) : (
          threads.map(t => (
            <div
              key={t.thread_id}
              onClick={() => onSelectThread(t.thread_id)}
              className={`p-2.5 border-b cursor-pointer transition-colors ${
                selectedThreadId === t.thread_id
                  ? 'bg-blue-50 border-l-4 border-l-w95-blue'
                  : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex justify-between items-center">
                <span
                  className={`truncate ${
                    t.unread_count > 0 ? 'font-bold text-w95-blue' : 'font-bold text-gray-900'
                  }`}
                >
                  {t.unread_count > 0 && (
                    <span className="inline-block w-1.5 h-1.5 bg-w95-blue rounded-full mr-1" />
                  )}
                  {t.subject}
                </span>
                {t.unread_count > 0 && (
                  <span className="bg-w95-blue text-white text-[9px] px-1 py-0.2 rounded font-mono font-bold shrink-0 ml-1">
                    {t.unread_count}
                  </span>
                )}
              </div>
              <p className="text-gray-500 text-[11px] truncate mt-0.5">
                {t.participants.join(', ')}
              </p>
              <p className="text-gray-400 text-[10px] font-mono mt-0.5">{t.last_email_at}</p>
            </div>
          ))
        )}
      </Win95Scroll>
    </div>

    <div className="col-span-6 bg-white border-2 border-gray-800 p-3 flex flex-col overflow-y-auto">
      {!selectedThreadId ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2 p-6">
          <MailOpen size={30} className="text-gray-300" />
          <div className="font-bold text-gray-600">No Thread Selected</div>
          <p className="text-[11px] text-center text-gray-500 max-w-[220px]">
            Select a thread to read its email chain. Opening a thread marks it read on the local
            service.
          </p>
        </div>
      ) : detailLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-2">
          <RefreshCw size={18} className="animate-spin text-w95-blue" />
          <span className="text-[11px]">Loading thread…</span>
        </div>
      ) : detailError ? (
        <div className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs rounded">
          {detailError}
        </div>
      ) : detail ? (
        <div className="space-y-3">
          <div className="border-b pb-2">
            <div className="text-sm font-bold text-w95-blue flex items-center gap-1.5">
              <Mail size={14} /> {detail.subject}
            </div>
            <div className="text-gray-500 text-[10px] font-mono mt-0.5">
              {detail.thread_id} · {detail.emails.length} email
              {detail.emails.length === 1 ? '' : 's'}
            </div>
          </div>
          {detail.emails.map(email => (
            <div key={email.email_id} className="border border-gray-300 rounded bg-white overflow-hidden">
              <div className="bg-gray-100 border-b border-gray-300 p-2 text-[11px] space-y-0.5">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-900 font-mono">{email.from}</span>
                  <span className="font-mono text-gray-500 text-[10px]">{email.sent_at}</span>
                </div>
                <div className="text-gray-600">
                  <span className="text-gray-400">to</span>{' '}
                  <span className="font-mono">{email.to.join(', ')}</span>
                  {email.cc.length > 0 && (
                    <>
                      {' '}
                      <span className="text-gray-400">cc</span>{' '}
                      <span className="font-mono">{email.cc.join(', ')}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="p-3 text-xs leading-relaxed whitespace-pre-wrap text-gray-800">
                {email.body_markdown}
              </div>
            </div>
          ))}
          <div className="pt-2 border-t text-[10px] text-gray-400 font-mono flex items-center gap-1">
            <Send size={11} /> Compose &amp; reply are available via the CLI (agent-inbox reply).
          </div>
        </div>
      ) : null}
    </div>
  </div>
);

export const LocalAgentMailbox: React.FC = () => {
  const [health, setHealth] = useState<HealthResult>({ running: false });
  const [probing, setProbing] = useState<boolean>(true);
  const [probed, setProbed] = useState<boolean>(false);

  const [inboxes, setInboxes] = useState<LocalInbox[]>([]);
  const [inboxesLoading, setInboxesLoading] = useState<boolean>(false);
  const [inboxesError, setInboxesError] = useState<string | null>(null);

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [threads, setThreads] = useState<LocalThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState<boolean>(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LocalThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const resetData = useCallback(() => {
    setInboxes([]);
    setInboxesError(null);
    setSelectedAddress(null);
    setThreads([]);
    setThreadsError(null);
    setSelectedThreadId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const loadInboxes = useCallback(async () => {
    setInboxesLoading(true);
    setInboxesError(null);
    try {
      setInboxes(await fetchLocalInboxes());
    } catch (err: any) {
      setInboxes([]);
      setInboxesError(err?.message || 'Failed to load inboxes from local service');
    } finally {
      setInboxesLoading(false);
    }
  }, []);

  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const result = await checkLocalAgentInboxHealth();
      setHealth(result);
      setProbed(true);
      if (result.running) {
        await loadInboxes();
      } else {
        resetData();
      }
    } finally {
      setProbing(false);
    }
  }, [loadInboxes, resetData]);

  useEffect(() => {
    probe();
  }, [probe]);

  const handleSelectInbox = useCallback((address: string) => {
    setSelectedAddress(address);
    setSelectedThreadId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  useEffect(() => {
    if (!selectedAddress) return;
    let cancelled = false;
    (async () => {
      setThreadsLoading(true);
      setThreadsError(null);
      setThreads([]);
      try {
        const list = await fetchLocalThreads(selectedAddress);
        if (!cancelled) setThreads(list);
      } catch (err: any) {
        if (!cancelled) setThreadsError(err?.message || 'Failed to load threads');
      } finally {
        if (!cancelled) setThreadsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAddress]);

  const handleSelectThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
  }, []);

  useEffect(() => {
    if (!selectedAddress || !selectedThreadId) return;
    let cancelled = false;
    const address = selectedAddress;
    const threadId = selectedThreadId;
    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      try {
        const d = await fetchLocalThreadDetail(address, threadId);
        if (cancelled) return;
        setDetail(d);
        try {
          await markLocalThreadRead(address, threadId);
          if (!cancelled) {
            setThreads(prev =>
              prev.map(t => (t.thread_id === threadId ? { ...t, unread_count: 0 } : t))
            );
          }
        } catch {
        }
      } catch (err: any) {
        if (!cancelled) setDetailError(err?.message || 'Failed to load thread detail');
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAddress, selectedThreadId]);

  const showOffline = probed && !health.running;

  return (
    <div className="flex flex-col gap-2 h-full overflow-hidden font-tahoma text-xs">
      <div className="border-2 border-gray-800 bg-white px-2 py-1 flex items-center justify-between shrink-0">
        <span className="flex items-center gap-1.5 font-bold text-gray-800">
          <Server size={13} className={health.running ? 'text-emerald-600' : 'text-gray-400'} />
          Local Agent Mailbox
          <span
            className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${
              probing
                ? 'bg-blue-100 text-blue-800'
                : health.running
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {probing ? 'PROBING' : health.running ? 'CONNECTED' : 'OFFLINE'}
          </span>
        </span>
        <button
          onClick={probe}
          disabled={probing}
          title="Reconnect to local service"
          className="btn-w95 px-2 py-0.5 text-[10px] flex items-center gap-1 font-bold disabled:opacity-50"
        >
          <Power size={11} className={probing ? 'animate-spin' : ''} /> Reconnect
        </button>
      </div>

      {probing && !probed ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-2 border-2 border-gray-800 bg-white">
          <RefreshCw size={20} className="animate-spin text-w95-blue" />
          <span className="text-[11px]">Probing http://127.0.0.1:8791/healthz…</span>
        </div>
      ) : showOffline ? (
        <div className="flex-1 flex border-2 border-gray-800 bg-w95-gray overflow-hidden">
          <OfflinePane probing={probing} onReconnect={probe} />
        </div>
      ) : (
        <RunningPane
          version={health.version}
          inboxes={inboxes}
          inboxesLoading={inboxesLoading}
          inboxesError={inboxesError}
          selectedAddress={selectedAddress}
          onSelectInbox={handleSelectInbox}
          threads={threads}
          threadsLoading={threadsLoading}
          threadsError={threadsError}
          selectedThreadId={selectedThreadId}
          onSelectThread={handleSelectThread}
          detail={detail}
          detailLoading={detailLoading}
          detailError={detailError}
          onReconnect={probe}
          probing={probing}
        />
      )}
    </div>
  );
};
