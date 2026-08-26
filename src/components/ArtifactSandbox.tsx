import React, { useState, useEffect } from 'react';
import { AppListing, AppComment } from '../data/mockData';
import { EphemeralLiveApp } from './EphemeralLiveApp';
import { Play, Code, Terminal, Download, Sparkles, GitFork, Image as ImageIcon, MessageSquare, ThumbsUp, Send, Edit3, ExternalLink, Database } from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';

interface ArtifactSandboxProps {
  app: AppListing;
  onFork: () => void;
  onOpenAI: () => void;
  onEditPost?: () => void;
  onOpenLiveWindow?: () => void;
}

export const ArtifactSandbox: React.FC<ArtifactSandboxProps> = ({ app, onFork, onOpenAI, onEditPost, onOpenLiveWindow }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'screenshots' | 'comments' | 'sqlite' | 'code' | 'console'>('preview');
  const [activeShotIdx, setActiveShotIdx] = useState(0);

  // Comment state
  const [comments, setComments] = useState<AppComment[]>(app.comments || []);
  const [newCommentText, setNewCommentText] = useState('');

  // Live SQL query state for SQLite tab
  const [customSqlQuery, setCustomSqlQuery] = useState('SELECT id, preset, status, size FROM render_queue;');
  const [sqlResults, setSqlResults] = useState<{ columns: string[]; rows: any[][] }>({
    columns: ['id', 'preset', 'status', 'size'],
    rows: [
      ['job-981', '24x36 Floating Walnut', 'Completed', '48.2 MB TIFF'],
      ['job-982', '3-Piece Triptych Split', 'Completed', '112.4 MB TIFF'],
      ['job-983', '4-Grid Oak Matting', 'Pending', '64.1 MB TIFF']
    ]
  });

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

    playClickSound();
    const commentObj: AppComment = {
      id: `c-${Date.now()}`,
      author: 'nate',
      avatar: '⚡',
      time: 'Just now',
      text: newCommentText.trim(),
      upvotes: 1,
      isMaker: true
    };

    setComments([commentObj, ...comments]);
    setNewCommentText('');
    playSuccessChime();

    try {
      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: app.id,
          author: 'nate',
          text: commentObj.text
        })
      });
    } catch {}
  };

  const handleUpvoteComment = (cId: string) => {
    playClickSound();
    setComments(comments.map(c => c.id === cId ? { ...c, upvotes: c.upvotes + 1 } : c));
  };

  const handleRunSqlQuery = (e: React.FormEvent) => {
    e.preventDefault();
    playClickSound();
    if (customSqlQuery.toLowerCase().includes('select')) {
      setSqlResults({
        columns: ['id', 'preset', 'status', 'size'],
        rows: [
          ['job-981', '24x36 Floating Walnut', 'Completed', '48.2 MB TIFF'],
          ['job-982', '3-Piece Triptych Split', 'Completed', '112.4 MB TIFF'],
          ['job-983', '4-Grid Oak Matting', 'Pending', '64.1 MB TIFF'],
          [`job-${Math.floor(100 + Math.random() * 900)}`, 'Custom 300 DPI Canvas', 'Executed', '38.4 MB TIFF']
        ]
      });
    }
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
          <div className="flex items-center">
            <button
              onClick={() => { setActiveTab('preview'); playClickSound(); }}
              className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'preview' ? 'btn-w95-primary' : ''}`}
            >
              <Play size={13} /> Live App
            </button>
            <a
              href={`https://${app.id}.nates-software.pages.dev`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-w95 text-xs py-1 px-1.5 ml-0.5 text-blue-800"
              title={`Open https://${app.id}.nates-software.pages.dev in new window`}
            >
              <ExternalLink size={12} />
            </a>
          </div>
          <button
            onClick={() => { setActiveTab('sqlite'); playClickSound(); }}
            className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'sqlite' ? 'btn-w95-primary' : ''}`}
          >
            <Database size={13} /> SQLite DB
          </button>
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
          <button
            onClick={() => { setActiveTab('code'); playClickSound(); }}
            className={`btn-w95 text-xs py-1 px-2.5 ${activeTab === 'code' ? 'btn-w95-primary' : ''}`}
          >
            <Code size={13} /> AST
          </button>
          <button
            onClick={() => { setActiveTab('console'); playClickSound(); }}
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

        {/* 2. SQLite Database Inspector Tab */}
        {activeTab === 'sqlite' && (
          <div className="h-full flex flex-col justify-between p-4 bg-gray-50 overflow-hidden font-tahoma">
            <div className="space-y-3 flex-1 overflow-y-auto">
              <div className="flex justify-between items-center border-b pb-1.5">
                <span className="font-bold text-sm text-w95-blue flex items-center gap-1.5">
                  <Database size={14} /> Sovereign SQLite 3.45 WASM Database Inspector
                </span>
                <span className="font-mono text-green-800 font-bold text-xs bg-green-100 px-2 py-0.5 rounded">
                  WAL ACTIVE (/data/{app.id}.sqlite)
                </span>
              </div>

              {/* SQL Query Console */}
              <form onSubmit={handleRunSqlQuery} className="space-y-1.5">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span>Execute SQL Query:</span>
                  <span className="text-gray-500 font-mono text-[10px]">Read-Write WAL Safe</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customSqlQuery}
                    onChange={(e) => setCustomSqlQuery(e.target.value)}
                    className="flex-1 p-2 font-mono text-xs border border-gray-400 bg-white"
                  />
                  <button type="submit" className="btn-w95 btn-w95-primary px-3 py-1 font-bold text-xs">
                    Run SQL &rarr;
                  </button>
                </div>
              </form>

              {/* Tabular Result Grid */}
              <div className="border-2 border-gray-600 rounded bg-white overflow-hidden shadow-inner">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-w95-blue text-white text-left font-mono">
                      {sqlResults.columns.map((col) => (
                        <th key={col} className="p-1.5 border-r border-blue-400 last:border-r-0">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {sqlResults.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="border-b hover:bg-blue-50">
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="p-1.5 border-r border-gray-200 last:border-r-0">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-2 border-t flex justify-between items-center text-xs">
              <span className="text-gray-500 font-mono">Status: 0 locks &middot; 4.2ms query latency</span>
              <a
                href="data:text/plain;charset=utf-8,SQLite%203.45%20Binary"
                download={`${app.id}.sqlite`}
                className="btn-w95 btn-w95-primary px-3 py-1 font-bold flex items-center gap-1"
              >
                <Download size={12} /> Download Raw .sqlite Volume
              </a>
            </div>
          </div>
        )}

        {/* 3. Visual Screenshots Gallery */}
        {activeTab === 'screenshots' && (
          <div className="h-full flex flex-col justify-between p-4 bg-gray-900 text-white overflow-y-auto">
            <div className="flex-1 flex items-center justify-center min-h-[220px]">
              <img
                src={app.screenshots[activeShotIdx]}
                alt={`Screenshot ${activeShotIdx + 1}`}
                className="max-h-[240px] max-w-full object-contain rounded border-2 border-gray-700 shadow-2xl"
              />
            </div>
            <div className="flex justify-center gap-2 pt-3 border-t border-gray-800">
              {app.screenshots.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => { setActiveShotIdx(idx); playClickSound(); }}
                  className={`w-14 h-10 rounded overflow-hidden border-2 transition-all ${
                    activeShotIdx === idx ? 'border-yellow-400 scale-105' : 'border-gray-600 opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={s} alt="thumb" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 4. Community Comments Stream */}
        {activeTab === 'comments' && (
          <div className="h-full flex flex-col justify-between p-4 bg-gray-50 overflow-hidden font-tahoma">
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              <div className="flex items-center justify-between border-b pb-1.5 mb-2 text-xs">
                <span className="font-bold text-w95-blue">Maker Discussion &amp; Feedback Stream</span>
                <span className="text-gray-500 font-mono">{comments.length} comments &middot; D1 Live</span>
              </div>

              {comments.map((c) => (
                <div key={c.id} className="p-2.5 bg-white border border-gray-300 rounded shadow-sm text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg">{c.avatar}</span>
                      <span className="font-bold text-gray-900">@{c.author}</span>
                      {c.isMaker && (
                        <span className="bg-blue-100 text-w95-blue text-[10px] font-bold px-1.5 py-0.2 rounded border border-blue-300">
                          Maker
                        </span>
                      )}
                      <span className="text-gray-400 text-[10px]">&middot; {c.time}</span>
                    </div>
                    <button
                      onClick={() => handleUpvoteComment(c.id)}
                      className="btn-w95 text-[10px] py-0.5 px-1.5 flex items-center gap-1"
                    >
                      <ThumbsUp size={10} className="text-orange-600" />
                      <span>{c.upvotes}</span>
                    </button>
                  </div>
                  <p className="text-gray-700 leading-relaxed text-xs pl-6">{c.text}</p>
                </div>
              ))}
            </div>

            {/* Add Comment Form */}
            <form onSubmit={handleAddComment} className="pt-3 border-t border-gray-300 flex gap-2">
              <input
                type="text"
                placeholder="Ask a question or leave feedback for the maker..."
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                className="flex-1 p-2 border border-gray-400 text-xs bg-white"
              />
              <button
                type="submit"
                className="btn-w95 btn-w95-primary px-4 text-xs flex items-center gap-1 font-bold"
              >
                <Send size={12} /> Post Comment
              </button>
            </form>
          </div>
        )}

        {/* 5. Code & AST Manifest */}
        {activeTab === 'code' && (
          <div className="h-full bg-gray-900 text-green-400 p-4 font-mono text-xs overflow-y-auto">
            <div className="text-gray-500 mb-2">// AST Feature Manifest (refs/features/wallart@v2.4)</div>
            <pre className="text-green-300">{`{
  "name": "wallart-canvas-studio",
  "version": "2.4.0",
  "author": "@nate",
  "storage": "/data/wallart.sqlite",
  "schema": {
    "tables": ["presets", "photos", "render_queue", "icc_profiles"],
    "wal_mode": true
  },
  "exports": [
    "components/CanvasStage3D.tsx",
    "components/FrameMattingControls.tsx",
    "lib/sqliteRenderQueue.ts"
  ]
}`}</pre>
          </div>
        )}

        {/* 6. Logs */}
        {activeTab === 'console' && (
          <div className="h-full bg-black text-gray-300 p-4 font-mono text-xs overflow-y-auto space-y-1">
            <div className="text-green-400">[RIG.EXE] Sandboxed WASM SQLite instance booted.</div>
            <div className="text-gray-500">[STORAGE] PRAGMA journal_mode = WAL; (OK)</div>
            <div className="text-gray-500">[HTTP] GET /api/drops (200 OK - 4.8ms)</div>
            <div className="text-green-400">[PORTAL] Live interactive frame customizer ready.</div>
          </div>
        )}
      </div>

      {/* Bottom Action Footer Bar */}
      <div className="pt-2 mt-2 border-t border-gray-400 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onFork}
            className="btn-w95 btn-w95-primary text-xs py-1.5 px-3 flex items-center gap-1.5 font-bold shadow-md"
          >
            <GitFork size={13} /> Fork &amp; Mod in SLOPSHOP
          </button>
          <button
            onClick={onOpenAI}
            className="btn-w95 text-xs py-1.5 px-3 flex items-center gap-1.5"
          >
            <Sparkles size={13} className="text-purple-700" /> Open AI Session
          </button>
          {onEditPost && (
            <button
              onClick={onEditPost}
              className="btn-w95 text-xs py-1.5 px-3 flex items-center gap-1.5 text-w95-blue"
            >
              <Edit3 size={13} /> Edit Post
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <a
            href="data:text/plain;charset=utf-8,WallArt%20Binary%20Package"
            download={`${app.id}-${app.version}.dmg`}
            className="btn-w95 text-xs py-1.5 px-2.5 flex items-center gap-1 font-bold"
          >
            <Download size={12} /> Download Offline DMG
          </a>
        </div>
      </div>
    </div>
  );
};
