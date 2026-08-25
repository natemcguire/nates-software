import React, { useState } from 'react';
import { AppListing } from '../data/mockData';
import { EphemeralLiveApp } from './EphemeralLiveApp';
import { Play, Code, Terminal, Download, Sparkles, GitFork, Image as ImageIcon, MessageSquare, ThumbsUp, Send, Edit3, ExternalLink } from 'lucide-react';

interface ArtifactSandboxProps {
  app: AppListing;
  onFork: () => void;
  onOpenAI: () => void;
  onEditPost?: () => void;
  onOpenLiveWindow?: () => void;
}

export const ArtifactSandbox: React.FC<ArtifactSandboxProps> = ({ app, onFork, onOpenAI, onEditPost, onOpenLiveWindow }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'screenshots' | 'comments' | 'code' | 'console'>('preview');
  const [activeShotIdx, setActiveShotIdx] = useState(0);

  // Comment state
  const [comments, setComments] = useState(app.comments || []);
  const [newCommentText, setNewCommentText] = useState('');

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;

    const commentObj = {
      id: `c-${Date.now()}`,
      author: 'nate',
      avatar: '⚡',
      time: 'Just now',
      text: newCommentText.trim(),
      upvotes: 1,
      isMaker: false
    };

    setComments([commentObj, ...comments]);
    setNewCommentText('');
  };

  const handleUpvoteComment = (cId: string) => {
    setComments(comments.map(c => c.id === cId ? { ...c, upvotes: c.upvotes + 1 } : c));
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] text-sm font-tahoma">
      {/* Top Visual Header Bar */}
      <div className="bg-blue-50 border-2 border-w95-blue p-3 flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-3">
          <div className="text-3xl bg-white p-1 rounded border border-gray-400 shadow-sm">{app.creatorAvatar}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-w95-blue">{app.name}</span>
              <span className="bg-green-100 text-green-800 text-xs font-bold px-2 py-0.5 rounded border border-green-400">
                {app.version}
              </span>
              <span className="text-gray-500 text-xs font-medium">by @{app.creator}</span>
            </div>
            <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">{app.tagline}</p>
          </div>
        </div>

        {/* Tab Switcher & Pop Out Button */}
        <div className="flex items-center gap-1 bg-gray-200 p-1 border border-gray-400 rounded">
          <button
            onClick={() => setActiveTab('preview')}
            className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'preview' ? 'btn-w95-primary' : ''}`}
          >
            <Play size={13} /> Live App
          </button>
          <button
            onClick={() => setActiveTab('screenshots')}
            className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'screenshots' ? 'btn-w95-primary' : ''}`}
          >
            <ImageIcon size={13} /> Screenshots ({app.screenshots.length})
          </button>
          <button
            onClick={() => setActiveTab('comments')}
            className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'comments' ? 'btn-w95-primary' : ''}`}
          >
            <MessageSquare size={13} /> Comments ({comments.length})
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'code' ? 'btn-w95-primary' : ''}`}
          >
            <Code size={13} /> Code
          </button>
          <button
            onClick={() => setActiveTab('console')}
            className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'console' ? 'btn-w95-primary' : ''}`}
          >
            <Terminal size={13} /> Logs
          </button>
          {onOpenLiveWindow && (
            <button
              onClick={onOpenLiveWindow}
              className="btn-w95 text-xs py-1 px-2.5 text-w95-blue ml-1"
              title="Pop out into floating desktop window"
            >
              <ExternalLink size={13} /> Pop Out
            </button>
          )}
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 bg-white border-2 border-gray-800 overflow-hidden relative min-h-[360px]">
        {/* 1. Live Ephemeral Main Build App */}
        {activeTab === 'preview' && (
          <EphemeralLiveApp app={app} />
        )}

        {/* 2. Visual Screenshots Gallery */}
        {activeTab === 'screenshots' && (
          <div className="h-full flex flex-col p-4 bg-gray-900 text-white overflow-hidden">
            {/* Big Main Image */}
            <div className="flex-1 flex items-center justify-center bg-black border-2 border-gray-700 rounded overflow-hidden relative">
              <img
                src={app.screenshots[activeShotIdx]}
                alt={`Screenshot ${activeShotIdx + 1}`}
                className="max-h-full max-w-full object-contain"
              />
              <div className="absolute bottom-2 left-3 bg-black/70 px-3 py-1 rounded text-xs font-mono text-gray-200">
                Screenshot {activeShotIdx + 1} of {app.screenshots.length}
              </div>
            </div>

            {/* Thumbnail Carousel */}
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {app.screenshots.map((shot, idx) => (
                <div
                  key={idx}
                  onClick={() => setActiveShotIdx(idx)}
                  className={`w-24 h-16 shrink-0 rounded overflow-hidden border-2 cursor-pointer transition-all ${
                    activeShotIdx === idx ? 'border-yellow-400 scale-105 shadow-md' : 'border-gray-600 opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={shot} alt={`Thumb ${idx + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Community Comments & Reviews Stream */}
        {activeTab === 'comments' && (
          <div className="h-full flex flex-col p-4 bg-gray-50 overflow-hidden">
            {/* Comments List */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 mb-3">
              {comments.map((comment) => (
                <div key={comment.id} className="bg-white border-2 border-gray-300 p-3 rounded shadow-sm">
                  <div className="flex items-center justify-between border-b pb-1.5 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{comment.avatar}</span>
                      <span className="font-bold text-gray-900">@{comment.author}</span>
                      {comment.isMaker && (
                        <span className="bg-blue-100 text-w95-blue text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-300">
                          MAKER
                        </span>
                      )}
                      <span className="text-gray-400 text-xs font-mono">{comment.time}</span>
                    </div>

                    <button
                      onClick={() => handleUpvoteComment(comment.id)}
                      className="btn-w95 text-xs py-0.5 px-2 flex items-center gap-1"
                    >
                      <ThumbsUp size={11} className="text-orange-600" />
                      <span className="font-bold">{comment.upvotes}</span>
                    </button>
                  </div>
                  <p className="text-gray-800 text-xs leading-relaxed">{comment.text}</p>
                </div>
              ))}
            </div>

            {/* New Comment Input Box */}
            <form onSubmit={handleAddComment} className="bg-white border-2 border-gray-800 p-2.5 flex gap-2">
              <input
                type="text"
                placeholder="Ask the creator a question or leave feedback..."
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                className="flex-1 p-2 border border-gray-400 text-xs font-tahoma bg-gray-50 focus:bg-white outline-none"
              />
              <button type="submit" className="btn-w95 btn-w95-primary px-4 py-1.5 flex items-center gap-1.5">
                <Send size={13} /> Post Comment
              </button>
            </form>
          </div>
        )}

        {/* 4. Code Inspector */}
        {activeTab === 'code' && (
          <div className="h-full bg-black text-green-400 p-4 font-mono text-xs overflow-y-auto leading-relaxed">
            <div className="text-gray-500 mb-2">// src/components/{app.id}.tsx (Clean, unbundled TypeScript)</div>
            <div><span className="text-pink-400">import</span> React, &#123; useState &#125; <span className="text-pink-400">from</span> <span className="text-yellow-300">'react'</span>;</div>
            <div><span className="text-pink-400">import</span> &#123; useSQLite &#125; <span className="text-pink-400">from</span> <span className="text-yellow-300">'@natesoftware/sqlite'</span>;</div>
            <br />
            <div><span className="text-blue-400">export function</span> <span className="text-yellow-400">{app.name.replace(/\s+/g, '')}</span>() &#123;</div>
            <div>&nbsp;&nbsp;<span className="text-pink-400">const</span> [balance, setBalance] = useState(<span className="text-yellow-300">"1420.00"</span>);</div>
            <div>&nbsp;&nbsp;<span className="text-pink-400">const</span> db = useSQLite(<span className="text-yellow-300">"/data/app.sqlite"</span>);</div>
            <br />
            <div>&nbsp;&nbsp;<span className="text-pink-400">return</span> (</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;&lt;<span className="text-blue-400">div</span> className=<span className="text-yellow-300">"w95-calc-panel"</span>&gt;</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;<span className="text-blue-400">input</span> value=&#123;balance&#125; /&gt;</div>
            <div>&nbsp;&nbsp;&nbsp;&nbsp;&lt;/<span className="text-blue-400">div</span>&gt;</div>
            <div>&nbsp;&nbsp;);</div>
            <div>&#125;</div>
          </div>
        )}

        {/* 5. Logs Console */}
        {activeTab === 'console' && (
          <div className="h-full bg-black text-gray-200 p-4 font-mono text-xs overflow-y-auto leading-relaxed">
            <div className="text-green-400">[RIG.EXE] Sandboxed WASM SQLite instance booted.</div>
            <div className="text-green-400">[SQLITE] PRAGMA journal_mode = WAL (latency: 0.12ms)</div>
            <div className="text-gray-400">[CLIENT] Component mounted in 14ms. Ready for interaction.</div>
            <div className="text-gray-400">[MEDIA] 3 high-res screenshot assets cached in memory.</div>
          </div>
        )}
      </div>

      {/* Action Bar Footer */}
      <div className="mt-2.5 pt-2 border-t border-gray-300 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href="data:text/plain;charset=utf-8,SQLite%203.45%20Format"
            download={`${app.id}.sqlite`}
            className="btn-w95"
          >
            <Download size={13} /> Export .sqlite
          </a>
          <span className="btn-w95 text-gray-800 text-xs">
            🍎 {app.binaries.mac.split(' ')[0]}
          </span>
          <span className="btn-w95 text-gray-800 text-xs">
            🪟 {app.binaries.win.split(' ')[0]}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onEditPost && (
            <button onClick={onEditPost} className="btn-w95 text-xs text-blue-900">
              <Edit3 size={13} /> Edit Post
            </button>
          )}
          <button onClick={onOpenAI} className="btn-w95 text-xs">
            <Sparkles size={13} className="text-purple-700" /> Prompt AI in Claude/Codex
          </button>
          <button onClick={onFork} className="btn-w95 btn-w95-primary text-xs">
            <GitFork size={13} /> Fork in SLOPSHOP &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
