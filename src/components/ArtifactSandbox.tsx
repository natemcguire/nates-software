import React, { useState, useEffect } from 'react';
import { AppListing, AppComment } from '../data/mockData';
import { EphemeralLiveApp } from './EphemeralLiveApp';
import {
  Play,
  Image as ImageIcon,
  MessageSquare,
  Edit3,
  ExternalLink,
  GitBranch,
  Network,
  Bot,
  CreditCard,
  X,
  Check
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { CheckoutModal } from './CheckoutModal';
import { ForkWithAiModal } from './ForkWithAiModal';
import { useAlert } from '../context/AlertContext';

interface ArtifactSandboxProps {
  app: AppListing;
  onFork?: () => void;
  onOpenAI?: () => void;
  onEditPost?: () => void;
  onOpenLiveWindow?: () => void;
  onOpenPostEditor?: (app?: AppListing) => void;
}

export const ArtifactSandbox: React.FC<ArtifactSandboxProps> = ({
  app,
  onOpenPostEditor
}) => {
  const { showAlert } = useAlert();
  const { user, openAuthModal } = useAuth();
  const { isOwned } = useCatalog();
  const isAppOwned = isOwned(app.id);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showForkModal, setShowForkModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'screenshots' | 'comments'>('preview');
  const [activeShotIdx, setActiveShotIdx] = useState(0);

  // Modals state
  const [showLineageModal, setShowLineageModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  // Comment state
  const [comments, setComments] = useState<AppComment[]>(app.comments || []);
  const [newCommentText, setNewCommentText] = useState('');

  // Fetch comments from Cloudflare D1
  useEffect(() => {
    fetch(`/api/comments?app_id=${app.id}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.comments && data.comments.length > 0) {
          setComments(data.comments);
        } else {
          setComments(app.comments || []);
        }
      })
      .catch(() => {
        setComments(app.comments || []);
      });
  }, [app.id]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;

    if (!user) {
      showAlert("Please log in or create an account to post comments.", "Sign In Required", "warning");
      openAuthModal('login');
      return;
    }

    playClickSound();
    const cleanText = newCommentText.trim();
    setNewCommentText('');

    const tempCommentId = `c-${Date.now()}`;
    const commentObj: AppComment = {
      id: tempCommentId,
      author: `@${user.username}`,
      avatar: user.avatar || '⚡',
      time: 'Just now',
      timestamp: 'Just now',
      text: cleanText,
      upvotes: 1,
      isMaker: user.username === 'nate' || user.username === 'josh'
    };

    setComments(prev => [commentObj, ...prev]);
    playSuccessChime();

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: app.id,
          author: user.username,
          avatar: user.avatar || '⚡',
          text: cleanText
        })
      });
      const data = await res.json().catch(() => null);
      // Require positive confirmation: a 2xx alone is not proof of persistence.
      // Anything short of success:true with a canonical comment is treated as failure
      // so the optimistic comment is rolled back rather than left as if it saved.
      if (!res.ok || !data || data.success !== true || !data.comment) {
        throw new Error(data?.error || `Failed to post comment (Status ${res.status})`);
      }
      setComments(prev => prev.map(c => c.id === tempCommentId ? data.comment : c));
    } catch (err: any) {
      setComments(prev => prev.filter(c => c.id !== tempCommentId));
      showAlert(
        err?.message || 'Unable to post comment. Please try again.',
        'Comment Failed',
        'error'
      );
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] text-sm font-tahoma">
      {/* Top Visual Header Bar */}
      <div className="bg-blue-50 border-2 border-w95-blue p-3 flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-3">
          <div className="text-3xl bg-white p-1 rounded border border-gray-400 shadow-sm">{app.authorAvatar || app.creatorAvatar || '🎯'}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-w95-blue">{app.name}</span>
              <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded border border-green-400">
                {app.version}
              </span>
              {app.isDemo ? (
                <span className="bg-amber-100 text-amber-900 border border-amber-400 text-[10px] font-bold font-mono px-1.5 py-0.2 rounded">
                  DEMO DATA
                </span>
              ) : (
                <span className="bg-emerald-100 text-emerald-900 border border-emerald-400 text-[10px] font-bold font-mono px-1.5 py-0.2 rounded">
                  LIVE D1 DROP
                </span>
              )}
              {app.hasCanonicalRepo && app.repoSlug ? (
                <span className="bg-blue-100 text-blue-900 border border-blue-300 font-mono text-[10px] px-1.5 py-0.2 rounded flex items-center gap-1 font-bold" title={`Canonical GITSMITH Repo: ${app.repoSlug}`}>
                  <GitBranch size={10} className="text-blue-700 shrink-0" />
                  <span>{app.repoSlug}</span>
                  {app.repoHeadCommitOid && (
                    <span className="text-blue-600 font-normal">#{app.repoHeadCommitOid.slice(0, 7)}</span>
                  )}
                </span>
              ) : (
                <span className="bg-gray-200 text-gray-600 border border-gray-400 font-mono text-[10px] px-1.5 py-0.2 rounded" title="Source repository not yet on GITSMITH forge">
                  not yet on forge
                </span>
              )}
              <span className="text-gray-500 text-xs font-medium">by @{app.author || app.creator}</span>
            </div>
            <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">{app.tagline}</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-gray-200 p-1 border border-gray-400 rounded">
          <div className="flex items-center">
            <button
              onClick={() => {
                setActiveTab('preview');
                playClickSound();
              }}
              className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'preview' ? 'btn-w95-primary font-bold' : ''}`}
            >
              <Play size={13} /> Live App
            </button>
            <a
              href={`https://${app.id}.nates-software.com`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-w95 text-xs py-1 px-2 ml-0.5 text-blue-900 font-bold flex items-center gap-1 hover:bg-blue-100"
              title={`Open https://${app.id}.nates-software.com in new tab`}
              onClick={() => {
                playClickSound();
              }}
            >
              <ExternalLink size={12} />
              <span>{app.id}.nates-software.com</span>
            </a>
          </div>
          <button
            onClick={() => { setActiveTab('screenshots'); playClickSound(); }}
            className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'screenshots' ? 'btn-w95-primary' : ''}`}
          >
            <ImageIcon size={13} /> Shots ({app.screenshots.length})
          </button>
          <button
            onClick={() => { setActiveTab('comments'); playClickSound(); }}
            className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'comments' ? 'btn-w95-primary' : ''}`}
          >
            <MessageSquare size={13} /> Comments ({comments.length})
          </button>
        </div>
      </div>

      {/* Main View Area */}
      <div className="flex-1 bg-white border-2 border-gray-400 border-r-white border-b-white p-3 overflow-y-auto mb-2">
        {/* TAB 1: Live App Embedded Runner */}
        {activeTab === 'preview' && (
          <div className="h-full flex flex-col">
            <div className="bg-gray-100 p-2 border border-gray-300 mb-2 flex items-center justify-between text-xs font-mono flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-gray-700">Subdomain: <strong className="text-blue-800">{app.id}.nates-software.com</strong></span>
                <a
                  href={`https://${app.id}.nates-software.com`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => playClickSound()}
                  className="btn-w95 text-xs py-1 px-3 bg-blue-50 text-blue-900 font-bold flex items-center gap-1.5 hover:bg-blue-100 shadow-sm border border-blue-400"
                  title={`Open https://${app.id}.nates-software.com in a new browser window`}
                >
                  <ExternalLink size={13} /> Open in New Window
                </a>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded border border-green-300 font-bold">
                  ● Client-Side Sandbox
                </span>
                <button
                  onClick={() => setShowLineageModal(true)}
                  className="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-400 px-2 py-0.5 rounded font-bold flex items-center gap-1"
                >
                  <Network size={11} />
                  <span>Lineage DAG</span>
                </button>
              </div>
            </div>

            <div className="flex-1 border-2 border-gray-400 border-t-black border-l-black overflow-hidden relative">
              <EphemeralLiveApp app={app} />
            </div>
          </div>
        )}

        {/* TAB 2: Screenshots */}
        {activeTab === 'screenshots' && (
          <div className="h-full flex flex-col items-center justify-center p-2">
            <img
              src={app.screenshots[activeShotIdx]}
              alt={app.name}
              className="max-h-[340px] rounded border border-gray-400 shadow-md object-contain"
            />
            {app.screenshots.length > 1 && (
              <div className="flex gap-2 mt-3">
                {app.screenshots.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveShotIdx(i)}
                    className={`px-3 py-1 text-xs font-mono font-bold rounded ${
                      activeShotIdx === i ? 'bg-blue-800 text-white' : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    Slide {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Comments & Pinned Maker Story */}
        {activeTab === 'comments' && (
          <div className="h-full flex flex-col space-y-3">
            {/* Pinned Maker Pitch Story */}
            {app.makerPitch && (
              <div className="bg-amber-50 border-2 border-amber-300 rounded p-3 text-xs space-y-1 shadow-sm">
                <div className="flex items-center justify-between text-amber-900 font-bold font-mono">
                  <span className="flex items-center gap-1.5">
                    <span>{app.authorAvatar || '🎯'}</span>
                    <span>Maker Story &amp; Pitch by @{app.author}</span>
                  </span>
                  <span className="bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded text-[10px] uppercase font-bold">
                    Pinned
                  </span>
                </div>
                <p className="text-amber-950 leading-relaxed italic">
                  "{app.makerPitch}"
                </p>
              </div>
            )}

            {/* Comment List */}
            <div className="flex-1 overflow-y-auto space-y-2 border border-gray-300 p-2 bg-gray-50 rounded">
              {comments.map(c => (
                <div key={c.id} className="bg-white p-2.5 rounded border border-gray-200 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-blue-900 flex items-center gap-1">
                      <span>{c.avatar}</span>
                      <span>{c.author}</span>
                      {c.isMaker && (
                        <span className="bg-blue-100 text-blue-800 text-[9px] font-bold px-1 rounded">
                          MAKER
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{c.timestamp || c.time}</span>
                  </div>
                  <p className="text-xs text-gray-800 leading-relaxed">{c.text}</p>
                </div>
              ))}
            </div>

            {/* Comment Form */}
            <form onSubmit={handleAddComment} className="flex gap-2">
              <input
                type="text"
                placeholder="Leave feedback for maker..."
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                className="flex-1 border border-gray-400 p-2 text-xs outline-none bg-white"
              />
              <button type="submit" className="btn-w95 px-4 py-1 font-bold">
                Post Comment
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Bottom Action Footer */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-gray-400">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              playSuccessChime();
              setShowForkModal(true);
            }}
            className="btn-w95 text-xs py-1.5 px-3 flex items-center gap-1.5 bg-amber-50 font-bold border border-amber-400 text-amber-950 shadow-sm"
          >
            <Bot size={13} className="text-purple-700" />
            <span>⚡ Fork with AI</span>
          </button>
          {onOpenPostEditor && (
            <button
              onClick={() => onOpenPostEditor(app)}
              className="btn-w95 text-xs py-1.5 px-3 flex items-center gap-1.5 text-w95-blue"
            >
              <Edit3 size={13} /> Edit Post
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isAppOwned ? (
            <span className="bg-emerald-100 text-emerald-800 border border-emerald-400 text-xs py-1.5 px-3 rounded font-bold font-mono flex items-center gap-1.5 shadow-sm">
              <Check size={13} className="text-emerald-700 font-bold" />
              <span>License Active on Shelf</span>
            </span>
          ) : (
            <button
              onClick={() => {
                playClickSound();
                setShowCheckoutModal(true);
              }}
              className="btn-w95 btn-w95-primary text-xs py-1.5 px-3 flex items-center gap-1.5 font-bold shadow-sm"
            >
              <CreditCard size={12} />
              <span>Register License (${typeof app.price === 'number' ? app.price : (parseInt(String(app.price || '15').replace(/[^0-9.]/g, ''), 10) || 15)})</span>
            </button>
          )}
          <a
            href={app.liveUrl || (app.binaries as any)?.web || `https://${app.id}.nates-software.com`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-w95 text-xs py-1.5 px-3 flex items-center gap-1.5 font-bold"
          >
            <ExternalLink size={12} /> Launch Live App &rarr;
          </a>
          <a
            href={`https://gitsmith.nates-software.com?repo=${app.repoSlug || app.repoName || app.repositoryId || app.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-w95 text-xs py-1.5 px-2.5 flex items-center gap-1 font-bold"
          >
            <GitBranch size={12} /> View on GITSMITH
          </a>
        </div>
      </div>

      {/* 1. Interactive Lineage DAG Visualizer Modal */}
      {showLineageModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1e293b] border-2 border-slate-600 rounded-lg max-w-lg w-full shadow-2xl p-5 text-slate-100 font-sans text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2">
                <Network size={16} className="text-amber-400" />
                <span className="font-bold text-sm text-white font-mono">Immutable Lineage DAG · {app.name}</span>
              </div>
              <button onClick={() => setShowLineageModal(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="bg-[#0f172a] p-3.5 rounded-lg border border-slate-700 space-y-3 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Root Author:</span>
                <span className="text-sky-400 font-bold">@{app.author || app.creator}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Lineage Ancestry Depth:</span>
                <span className="text-emerald-400 font-bold">Genesis (Generation 0)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Downstream Forks:</span>
                <span className="text-amber-400 font-bold">{app.forkCount} Registered Forks</span>
              </div>
            </div>

            <div className="border border-slate-700 rounded-lg p-3 bg-slate-900/60 space-y-2">
              <div className="font-bold text-xs text-white">70 / 20 / 10 Revenue Settlement Rule</div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                When any downstream maker forks <strong>{app.name}</strong> and receives license payments, the revenue protocol automatically deposits <strong>70%</strong> to the fork author, <strong>20%</strong> to @{app.author || app.creator}, and <strong>10%</strong> to the perpetual protocol pool.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowLineageModal(false)}
                className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-1.5 rounded font-bold font-mono"
              >
                Close DAG View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Interactive Local AI Pairing Session Modal */}
      {showAiModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1e293b] border-2 border-slate-600 rounded-lg max-w-xl w-full shadow-2xl p-5 text-slate-100 font-sans text-xs space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-purple-400" />
                <span className="font-bold text-sm text-white font-mono">Local AI Agent Workflow · {app.name}</span>
              </div>
              <button onClick={() => setShowAiModal(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              We do not host AI models on our servers. You fork the code to your local machine, run your own local CLI agent to make changes, and push back up to GITSMITH.
            </p>

            {/* Step 1: Clone & Fork */}
            <div className="space-y-1.5">
              <div className="font-bold text-xs text-sky-400 font-mono flex items-center gap-1">
                <span>Step 1:</span> Clone repo into isolated worktree
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800 flex items-center justify-between font-mono text-[11px]">
                <code className="text-sky-300">git clone https://github.com/natemcguire/{app.id}.git /tmp/slop-{app.id} && cd /tmp/slop-{app.id}</code>
                <button
                  onClick={() => {
                    playClickSound();
                    navigator.clipboard.writeText(`git clone https://github.com/natemcguire/${app.id}.git /tmp/slop-${app.id} && cd /tmp/slop-${app.id}`);
                    showAlert("Clone & cd command copied!", "Command Copied", "success");
                  }}
                  className="bg-sky-900 hover:bg-sky-800 text-sky-200 px-2 py-1 rounded text-[10px] ml-2 shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>

            {/* Step 2: 1-Click Chained Agent Launchers */}
            <div className="space-y-2">
              <div className="font-bold text-xs text-purple-400 font-mono flex items-center gap-1">
                <span>Step 2:</span> Launch your local headless AI agent (1-Click Full Chained Command)
              </div>

              <div className="space-y-1.5 font-mono text-[11px]">
                {/* Claude Code */}
                <div className="bg-slate-950 p-2.5 rounded border border-slate-800 flex items-center justify-between">
                  <div className="truncate mr-2">
                    <span className="text-purple-400 font-bold block text-[10px]">🟣 Claude Code (Anthropic)</span>
                    <code className="text-purple-300">git clone https://github.com/natemcguire/{app.id}.git /tmp/slop-{app.id} && cd /tmp/slop-{app.id} && claude "Review code and add new feature"</code>
                  </div>
                  <button
                    onClick={() => {
                      playClickSound();
                      navigator.clipboard.writeText(`git clone https://github.com/natemcguire/${app.id}.git /tmp/slop-${app.id} && cd /tmp/slop-${app.id} && claude "Review code and add new feature"`);
                      showAlert("Full Claude Code 1-liner copied!", "Command Copied", "success");
                    }}
                    className="bg-purple-900 hover:bg-purple-800 text-purple-200 px-2.5 py-1.5 rounded text-[10px] shrink-0 font-bold"
                  >
                    Copy 1-Liner
                  </button>
                </div>

                {/* Antigravity CLI (AGY) */}
                <div className="bg-slate-950 p-2.5 rounded border border-slate-800 flex items-center justify-between">
                  <div className="truncate mr-2">
                    <span className="text-sky-400 font-bold block text-[10px]">⚡ Antigravity CLI (AGY)</span>
                    <code className="text-sky-300">git clone https://github.com/natemcguire/{app.id}.git /tmp/slop-{app.id} && cd /tmp/slop-{app.id} && agy "Implement features for {app.name}"</code>
                  </div>
                  <button
                    onClick={() => {
                      playClickSound();
                      navigator.clipboard.writeText(`git clone https://github.com/natemcguire/${app.id}.git /tmp/slop-${app.id} && cd /tmp/slop-${app.id} && agy "Implement features for ${app.name}"`);
                      showAlert("Full AGY 1-liner copied!", "Command Copied", "success");
                    }}
                    className="bg-sky-900 hover:bg-sky-800 text-sky-200 px-2.5 py-1.5 rounded text-[10px] shrink-0 font-bold"
                  >
                    Copy 1-Liner
                  </button>
                </div>

                {/* Codex / Aider */}
                <div className="bg-slate-950 p-2.5 rounded border border-slate-800 flex items-center justify-between">
                  <div className="truncate mr-2">
                    <span className="text-emerald-400 font-bold block text-[10px]">🤖 Codex / Aider</span>
                    <code className="text-emerald-300">git clone https://github.com/natemcguire/{app.id}.git /tmp/slop-{app.id} && cd /tmp/slop-{app.id} && aider --model sonnet</code>
                  </div>
                  <button
                    onClick={() => {
                      playClickSound();
                      navigator.clipboard.writeText(`git clone https://github.com/natemcguire/${app.id}.git /tmp/slop-{app.id} && cd /tmp/slop-${app.id} && aider --model sonnet`);
                      showAlert("Full Aider 1-liner copied!", "Command Copied", "success");
                    }}
                    className="bg-emerald-900 hover:bg-emerald-800 text-emerald-200 px-2.5 py-1.5 rounded text-[10px] shrink-0 font-bold"
                  >
                    Copy 1-Liner
                  </button>
                </div>

                {/* Cursor / VS Code */}
                <div className="bg-slate-950 p-2.5 rounded border border-slate-800 flex items-center justify-between">
                  <div className="truncate mr-2">
                    <span className="text-pink-400 font-bold block text-[10px]">🧠 Cursor / Grok / VS Code</span>
                    <code className="text-pink-300">git clone https://github.com/natemcguire/{app.id}.git /tmp/slop-{app.id} && cursor /tmp/slop-{app.id}</code>
                  </div>
                  <button
                    onClick={() => {
                      playClickSound();
                      navigator.clipboard.writeText(`git clone https://github.com/natemcguire/${app.id}.git /tmp/slop-${app.id} && cursor /tmp/slop-${app.id}`);
                      showAlert("Full Cursor 1-liner copied!", "Command Copied", "success");
                    }}
                    className="bg-pink-900 hover:bg-pink-800 text-pink-200 px-2.5 py-1.5 rounded text-[10px] shrink-0 font-bold"
                  >
                    Copy 1-Liner
                  </button>
                </div>
              </div>
            </div>

            {/* Step 3: Push Fork */}
            <div className="space-y-1.5">
              <div className="font-bold text-xs text-amber-400 font-mono flex items-center gap-1">
                <span>Step 3:</span> Push your changes back to GITSMITH
              </div>
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800 flex items-center justify-between font-mono text-[11px]">
                <code className="text-amber-300">git push origin my-feature-branch</code>
                <span className="text-slate-500 text-[10px]">20% lineage royalty automatically settled to @{app.author || app.creator}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-700">
              <button
                onClick={() => setShowAiModal(false)}
                className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-1.5 rounded font-bold font-mono text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1-Click Fork & Code with AI Modal */}
      <ForkWithAiModal
        isOpen={showForkModal}
        onClose={() => setShowForkModal(false)}
        app={app}
      />

      {/* Stripe Marketplace Checkout Modal */}
      <CheckoutModal
        isOpen={showCheckoutModal}
        onClose={() => setShowCheckoutModal(false)}
        app={app}
      />
    </div>
  );
};
