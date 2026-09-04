import React, { useState, useEffect, useRef } from 'react';
import {
  IrcMessage,
  IrcUser,
  DEFAULT_CHANNEL,
  formatIrcTime,
  parseUserChatInput,
  filterUnexpiredIrcMessages
} from '../lib/ircProtocol';
import {
  Users,
  Send,
  HelpCircle,
  Hash,
  Radio,
  Terminal,
  X
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { Win95Scroll } from '../components/Win95Scroll';

export const ChatView: React.FC = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<IrcMessage[]>([]);
  const [users, setUsers] = useState<IrcUser[]>([]);
  const [currentNick, setCurrentNick] = useState<string>(user?.username || 'guest');
  const [inputVal, setInputVal] = useState<string>('');
  const [topic, setTopic] = useState<string>("Welcome to Nate's Software Global Lounge · 12:01 AM UTC Daily Releases & Indie Modding");
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [serverStatus] = useState<string>('WEB LOUNGE LIVE');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    setCurrentNick(user?.username || 'guest');
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const sendHeartbeat = () => {
      fetch('/api/chat?action=heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: DEFAULT_CHANNEL })
      }).catch(() => {});
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 20000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    const fetchLatestMessages = () => {
      fetch(`/api/chat?channel=${encodeURIComponent(DEFAULT_CHANNEL)}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            if (typeof data.topic === 'string' && data.topic) {
              setTopic(data.topic);
            }

            if (Array.isArray(data.presence)) {
              const liveUsers: IrcUser[] = data.presence.map((p: any) => ({
                nick: p.nick,
                displayName: p.displayName,
                isOp: Boolean(p.isOp),
                isVoiced: true,
                avatar: p.avatar || (p.isOp ? '🎯' : '👤')
              }));
              setUsers(liveUsers);
            }

            if (Array.isArray(data.messages)) {
              const apiMsgs: IrcMessage[] = data.messages.map((m: any) => ({
                id: m.id,
                channel: m.channel,
                sender: m.sender,
                type: m.type || 'PRIVMSG',
                text: m.text,
                isOp: Boolean(m.isOp),
                timestamp: m.timestamp || new Date().toISOString(),
                timeFormatted: formatIrcTime(new Date(m.timestamp || Date.now()))
              }));

              setMessages(prev => {
                const existingIds = new Set(prev.map(p => p.id));
                const newOnes = apiMsgs.filter(m => !existingIds.has(m.id));
                if (newOnes.length > 0 && prev.length > 0) {
                  const myNick = user?.username || 'guest';
                  const fromOther = newOnes.some(n => n.sender !== myNick && n.sender !== 'System');
                  if (fromOther) playSuccessChime();
                }
                return filterUnexpiredIrcMessages(
                  prev.length === 0 ? apiMsgs : [...prev, ...newOnes]
                );
              });
            }
          }
        })
        .catch(() => {});
    };

    fetchLatestMessages();
    const interval = setInterval(fetchLatestMessages, 3000);
    return () => clearInterval(interval);
  }, [user]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = inputVal.trim();
    if (!raw) return;

    playClickSound();
    setInputVal('');

    const parsed = parseUserChatInput(raw, currentNick, DEFAULT_CHANNEL);

    if (parsed.command === 'CLEAR') {
      setMessages([]);
      return;
    }

    if (parsed.command === 'HELP') {
      setShowHelpModal(true);
      return;
    }

    if (parsed.command === 'NICK') {
      const boundNick = user ? `@${user.username}` : 'guest';
      const nickMsg: IrcMessage = {
        id: `msg-${Date.now()}`,
        channel: DEFAULT_CHANNEL,
        sender: 'System',
        type: 'SYSTEM',
        text: `*** Nicknames are bound to your authenticated account handle (${boundNick}). Nickname changes are not permitted.`,
        timestamp: new Date().toISOString(),
        timeFormatted: formatIrcTime()
      };
      setMessages(prev => [...prev, nickMsg]);
      return;
    }

    if (parsed.command === 'TOPIC') {
      const newTopic = parsed.args.slice(1).join(' ') || parsed.args[1];
      if (newTopic) {
        try {
          const response = await fetch('/api/chat?action=topic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channel: DEFAULT_CHANNEL,
              topic: newTopic
            })
          });
          const data = await response.json();
          if (!response.ok || !data?.success) {
            throw new Error(data?.error || 'Topic update failed.');
          }
          setTopic(data.topic || newTopic);
        } catch (error: any) {
          setMessages(prev => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              channel: DEFAULT_CHANNEL,
              sender: 'System',
              type: 'SYSTEM',
              text: `*** Topic update failed: ${error.message}`,
              timestamp: new Date().toISOString(),
              timeFormatted: formatIrcTime()
            }
          ]);
        }
      } else {
        const topicMsg: IrcMessage = {
          id: `msg-${Date.now()}`,
          channel: DEFAULT_CHANNEL,
          sender: 'System',
          type: 'SYSTEM',
          text: `*** Topic for ${DEFAULT_CHANNEL}: "${topic}"`,
          timestamp: new Date().toISOString(),
          timeFormatted: formatIrcTime()
        };
        setMessages(prev => [...prev, topicMsg]);
      }
      return;
    }

    if (parsed.command === 'NAMES' || parsed.command === 'WHO') {
      const namesList = users.length > 0
        ? users.map(u => (u.isOp ? `@${u.nick}` : u.isVoiced ? `+${u.nick}` : u.nick)).join(' ')
        : 'None';
      const namesMsg: IrcMessage = {
        id: `msg-${Date.now()}`,
        channel: DEFAULT_CHANNEL,
        sender: 'System',
        type: 'SYSTEM',
        text: `*** Users on ${DEFAULT_CHANNEL}: ${namesList}`,
        timestamp: new Date().toISOString(),
        timeFormatted: formatIrcTime()
      };
      setMessages(prev => [...prev, namesMsg]);
      return;
    }

    const isUserOp = Boolean(user?.isSuperAdmin || user?.role === 'super_admin');
    const newMsg: IrcMessage = {
      id: `msg-${Date.now()}`,
      channel: DEFAULT_CHANNEL,
      sender: user?.username || 'guest',
      type: parsed.isAction ? 'ACTION' : 'PRIVMSG',
      text: parsed.messageText || raw,
      timestamp: new Date().toISOString(),
      timeFormatted: formatIrcTime(),
      isOp: isUserOp
    };

    setMessages(prev => [...prev, newMsg]);
    playSuccessChime();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: DEFAULT_CHANNEL,
          type: newMsg.type,
          text: newMsg.text
        })
      });
      const data = await response.json();
      if (!response.ok || !data?.success || !data.message) {
        throw new Error(data?.error || 'Message was not stored.');
      }
      setMessages(prev => prev.map(message => message.id === newMsg.id ? {
        ...message,
        id: data.message.id,
        sender: data.message.sender,
        type: data.message.type || message.type,
        isOp: Boolean(data.message.isOp),
        timestamp: data.message.timestamp,
        timeFormatted: formatIrcTime(new Date(data.message.timestamp))
      } : message));
    } catch (error: any) {
      setMessages(prev => [
        ...prev.filter(message => message.id !== newMsg.id),
        {
          id: `error-${Date.now()}`,
          channel: DEFAULT_CHANNEL,
          sender: 'System',
          type: 'SYSTEM',
          text: `*** Message not sent: ${error.message}`,
          timestamp: new Date().toISOString(),
          timeFormatted: formatIrcTime()
        }
      ]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#c0c0c0] font-sans text-xs select-none">
      <div className="bg-[#000080] text-white px-3 py-1.5 flex items-center justify-between border-b-2 border-white shadow-inner flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Hash size={15} className="text-yellow-300 font-bold" />
          <span className="font-mono font-bold text-xs text-yellow-300">#lounge</span>
          <span className="text-gray-300 font-mono text-[11px] truncate max-w-xl">
            — {topic}
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="bg-emerald-950 text-emerald-300 border border-emerald-500 px-2 py-0.5 rounded font-bold flex items-center gap-1">
            <Radio size={11} className="text-emerald-400 animate-pulse" />
            <span>{serverStatus}</span>
            <span className="bg-blue-900 text-cyan-300 px-1.5 py-0.5 text-[10px]">24h Ephemeral Buffer</span>
          </span>

          <button
            onClick={() => { playClickSound(); setShowHelpModal(true); }}
            className="win95-btn px-2 py-0.5 text-black font-bold flex items-center gap-1 bg-[#dfdfdf] hover:bg-white"
            title="IRC Commands Reference"
          >
            <HelpCircle size={12} />
            <span>/help</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden p-2 gap-2">
        <div className="flex-1 win95-field bg-[#0f172a] text-slate-100 p-3 overflow-y-auto font-mono text-xs space-y-1.5 flex flex-col justify-between border-2 border-gray-600">
          <div className="space-y-1 overflow-y-auto flex-1 pr-1">
            {messages.length === 0 && (
              <div className="text-slate-500 text-xs italic py-4 text-center select-none">
                *** No recent messages in #lounge (24-hour buffer). Say hello!
              </div>
            )}
            {messages.map((m) => {
              if (m.type === 'SYSTEM' || m.type === 'TOPIC') {
                return (
                  <div key={m.id} className="text-sky-400 text-[11px] leading-relaxed flex items-start gap-1.5">
                    <span className="text-slate-500 shrink-0">[{m.timeFormatted}]</span>
                    <span>{m.text}</span>
                  </div>
                );
              }

              if (m.type === 'NICK') {
                return (
                  <div key={m.id} className="text-yellow-400 text-[11px] leading-relaxed flex items-start gap-1.5">
                    <span className="text-slate-500 shrink-0">[{m.timeFormatted}]</span>
                    <span>{m.text}</span>
                  </div>
                );
              }

              if (m.type === 'ACTION') {
                return (
                  <div key={m.id} className="text-fuchsia-300 italic text-xs leading-relaxed flex items-start gap-1.5">
                    <span className="text-slate-500 shrink-0 font-normal">[{m.timeFormatted}]</span>
                    <span className="font-bold">* {m.sender}</span>
                    <span>{m.text}</span>
                  </div>
                );
              }

              return (
                <div key={m.id} className="flex items-start gap-1.5 text-xs leading-relaxed hover:bg-slate-800/40 px-1 py-0.5 rounded transition-colors">
                  <span className="text-slate-500 shrink-0 select-none">[{m.timeFormatted}]</span>
                  <span className={`font-bold shrink-0 ${m.isOp ? 'text-amber-400' : 'text-sky-300'}`}>
                    &lt;{m.isOp ? '@' : ''}{m.sender}&gt;
                  </span>
                  <span className="text-slate-200 break-all">{m.text}</span>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="w-52 win95-field bg-white p-2 flex flex-col border-2 border-gray-600">
          <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between font-bold text-xs mb-2">
            <div className="flex items-center gap-1">
              <Users size={13} />
              <span>Online ({users.length})</span>
            </div>
            <span className="text-[10px] bg-blue-900 px-1 rounded font-mono">#lounge</span>
          </div>

          <Win95Scroll className="flex-1 space-y-1 font-mono text-xs divide-y divide-gray-100">
            {users.length === 0 && (
              <div className="text-gray-400 text-[11px] italic p-2 text-center">
                No active users
              </div>
            )}
            {users
              .slice()
              .sort((a, b) => (b.isOp ? 1 : 0) - (a.isOp ? 1 : 0))
              .map((u) => {
                const isCurrent = u.nick === currentNick;
                return (
                  <div
                    key={u.nick}
                    onClick={() => {
                      playClickSound();
                      setInputVal(`/msg ${u.nick} `);
                    }}
                    className={`p-1.5 rounded flex items-center justify-between cursor-pointer transition-colors ${
                      isCurrent ? 'bg-blue-100 font-bold' : 'hover:bg-gray-100'
                    }`}
                    title={`Click to send private message to ${u.nick}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{u.avatar || '👤'}</span>
                      <span className={u.isOp ? 'text-amber-700 font-bold' : u.isVoiced ? 'text-blue-700' : 'text-gray-800'}>
                        {u.isOp ? '@' : u.isVoiced ? '+' : ''}{u.nick}
                      </span>
                    </div>
                    {u.isOp && (
                      <span className="text-[9px] bg-amber-100 text-amber-800 border border-amber-300 px-1 rounded font-bold">
                        OP
                      </span>
                    )}
                  </div>
                );
              })}
          </Win95Scroll>

          <div className="border-t border-gray-300 pt-2 text-[10px] text-gray-500 font-mono text-center">
            You are: <strong className="text-blue-900">{user ? `@${user.username}` : 'guest'}</strong>
          </div>
        </div>
      </div>

      <div className="bg-[#dfdfdf] p-2 border-t-2 border-white flex items-center gap-2">
        <form onSubmit={handleSendMessage} className="flex-1 flex gap-2">
          <div className="bg-white border-2 border-gray-600 border-t-black border-l-black flex-1 flex items-center px-2 py-1">
            <span className="font-mono text-gray-500 mr-2 text-xs select-none">
              [{DEFAULT_CHANNEL}] &lt;{user ? `@${user.username}` : 'guest'}&gt;
            </span>
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder={user ? "Type message or IRC command (/me, /topic, /who, /clear, /help)..." : "Log in to post messages to #lounge..."}
              className="flex-1 text-xs font-mono outline-none bg-transparent"
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="win95-btn px-5 py-1 text-black font-bold flex items-center gap-1 text-xs bg-[#c0c0c0] hover:bg-white"
          >
            <Send size={13} />
            <span>Send</span>
          </button>
        </form>
      </div>

      {showHelpModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1e293b] border-2 border-slate-600 rounded-lg max-w-lg w-full shadow-2xl p-5 text-slate-100 font-sans text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2">
                <Terminal size={16} className="text-yellow-400" />
                <span className="font-bold text-sm text-white font-mono">IRC Protocol Command Manual (RFC 1459 / 2812)</span>
              </div>
              <button onClick={() => setShowHelpModal(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2 font-mono text-xs">
              <div className="bg-[#0f172a] p-2.5 rounded border border-slate-700 space-y-1">
                <div className="text-yellow-300 font-bold">/nick</div>
                <p className="text-[11px] text-slate-400">Displays your authenticated account handle (nicknames are bound to your user account).</p>
              </div>

              <div className="bg-[#0f172a] p-2.5 rounded border border-slate-700 space-y-1">
                <div className="text-yellow-300 font-bold">/me &lt;action&gt;</div>
                <p className="text-[11px] text-slate-400">Sends a third-person CTCP action (e.g. <em>* nate tests code</em>).</p>
              </div>

              <div className="bg-[#0f172a] p-2.5 rounded border border-slate-700 space-y-1">
                <div className="text-yellow-300 font-bold">/topic &lt;new topic&gt;</div>
                <p className="text-[11px] text-slate-400">Sets the room topic for all connected users.</p>
              </div>

              <div className="bg-[#0f172a] p-2.5 rounded border border-slate-700 space-y-1">
                <div className="text-yellow-300 font-bold">/who or /names</div>
                <p className="text-[11px] text-slate-400">Lists all active online makers in #lounge.</p>
              </div>

              <div className="bg-[#0f172a] p-2.5 rounded border border-slate-700 space-y-1">
                <div className="text-yellow-300 font-bold">/clear</div>
                <p className="text-[11px] text-slate-400">Clears your current client message log.</p>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-700">
              <button
                onClick={() => setShowHelpModal(false)}
                className="bg-sky-600 hover:bg-sky-500 text-white px-5 py-1.5 rounded font-bold font-mono text-xs"
              >
                Close Manual
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
