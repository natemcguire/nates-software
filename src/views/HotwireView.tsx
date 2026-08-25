import React, { useState, useEffect } from 'react';
import { APPS_DATA, AppListing } from '../data/mockData';
import { ArtifactSandbox } from '../components/ArtifactSandbox';
import { PostEditorView } from './PostEditorView';
import { Flame, ThumbsUp, Search, PlusCircle, Clock, Award, GitBranch } from 'lucide-react';

export const HotwireView: React.FC = () => {
  const [apps, setApps] = useState<AppListing[]>(APPS_DATA);
  const [selectedApp, setSelectedApp] = useState<AppListing>(APPS_DATA[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'today' | 'alltime' | 'forks' | 'streaks'>('today');
  const [isEditing, setIsEditing] = useState(false);
  const [showLineage, setShowLineage] = useState(false);
  const [countdown, setCountdown] = useState('09h 28m 14s');

  // Fetch real drops from Cloudflare D1
  useEffect(() => {
    fetch('/api/drops')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.drops && data.drops.length > 0) {
          setApps(data.drops);
          setSelectedApp(data.drops[0]);
        }
      })
      .catch(() => {
        // Graceful fallback to initial mock data if offline
      });
  }, []);

  // Simulated live countdown to 12:01 AM UTC
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const nextDrop = new Date();
      nextDrop.setHours(24, 1, 0, 0);
      const diff = Math.max(0, nextDrop.getTime() - now.getTime());

      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const mins = Math.floor((diff / 1000 / 60) % 60);
      const secs = Math.floor((diff / 1000) % 60);

      setCountdown(
        `${hours.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleUpvote = async (id: string) => {
    // Optimistic UI update
    setApps(apps.map(a => a.id === id ? { ...a, upvotes: a.upvotes + 1 } : a));
    if (selectedApp.id === id) {
      setSelectedApp(prev => ({ ...prev, upvotes: prev.upvotes + 1 }));
    }

    // Call live D1 API
    try {
      await fetch('/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: id })
      });
    } catch {
      // ignore
    }
  };

  const handleSavePost = async (updatedApp: AppListing) => {
    setApps(apps.map(a => a.id === updatedApp.id ? updatedApp : a));
    setSelectedApp(updatedApp);
    setIsEditing(false);

    // Persist to Cloudflare D1
    try {
      await fetch('/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedApp)
      });
    } catch {
      // ignore
    }
  };

  // Sort & Filter
  const sortedApps = [...apps].sort((a, b) => {
    if (activeFilter === 'forks') return b.forks - a.forks;
    if (activeFilter === 'alltime') return b.upvotes - a.upvotes;
    return b.upvotes - a.upvotes;
  });

  const filtered = sortedApps.filter(a =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase())) ||
    a.creator.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="grid grid-cols-12 gap-3 h-full overflow-hidden font-tahoma text-sm">
      {/* Left Column: Drops Board, Countdown & Filter Tabs */}
      <div className="col-span-5 flex flex-col h-full bg-white border-2 border-gray-800 p-2.5 overflow-hidden">
        {/* Top Header: 12:01 AM Live Countdown */}
        <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 rounded border border-gray-700 mb-2 shadow-sm">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-bold text-yellow-400 flex items-center gap-1.5 font-mono">
              <Flame size={14} className="text-orange-500 animate-pulse" /> 12:01 AM DAILY DROP #84
            </span>
            <span className="bg-green-900 text-green-300 font-mono text-[10px] px-1.5 py-0.5 rounded border border-green-600 font-bold">
              ● CLOUDFLARE D1 LIVE
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-gray-300">
            <span className="flex items-center gap-1 font-mono text-gray-400">
              <Clock size={12} /> Next Drop in: <b className="text-white">{countdown}</b>
            </span>
            <button
              onClick={() => setIsEditing(true)}
              className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-2 py-0.5 rounded text-[10px] flex items-center gap-1 shadow-sm"
            >
              <PlusCircle size={11} /> Submit Drop
            </button>
          </div>
        </div>

        {/* Filter Navigation Tabs */}
        <div className="flex items-center gap-1 bg-gray-100 p-1 border border-gray-400 rounded mb-2">
          <button
            onClick={() => setActiveFilter('today')}
            className={`btn-w95 text-xs py-1 px-2 flex-1 ${activeFilter === 'today' ? 'btn-w95-primary' : ''}`}
          >
            🔥 Today
          </button>
          <button
            onClick={() => setActiveFilter('forks')}
            className={`btn-w95 text-xs py-1 px-2 flex-1 ${activeFilter === 'forks' ? 'btn-w95-primary' : ''}`}
          >
            🌿 Top Forked
          </button>
          <button
            onClick={() => setActiveFilter('alltime')}
            className={`btn-w95 text-xs py-1 px-2 flex-1 ${activeFilter === 'alltime' ? 'btn-w95-primary' : ''}`}
          >
            🏆 All-Time
          </button>
          <button
            onClick={() => setActiveFilter('streaks')}
            className={`btn-w95 text-xs py-1 px-2 flex-1 ${activeFilter === 'streaks' ? 'btn-w95-primary' : ''}`}
          >
            👑 Streaks
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-2 text-gray-500" />
          <input
            type="text"
            placeholder="Search software, creators, tags, AST features..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 border-2 border-gray-600 bg-gray-50 text-xs"
          />
        </div>

        {/* Drops Scroll List */}
        {activeFilter !== 'streaks' && (
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {filtered.map((app, idx) => (
              <div
                key={app.id}
                onClick={() => { setSelectedApp(app); setIsEditing(false); }}
                className={`p-2.5 border-2 cursor-pointer transition-all ${
                  selectedApp.id === app.id
                    ? 'bg-blue-50 border-w95-blue shadow-sm'
                    : 'bg-gray-50 border-gray-300 hover:border-gray-600'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-500 font-mono text-xs">#{idx + 1}</span>
                      <span className="font-bold text-sm text-gray-900">{app.name}</span>
                      <span className="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.2 rounded border border-green-300">
                        {app.version}
                      </span>
                      <span className="text-xs text-gray-500">by @{app.creator}</span>
                    </div>

                    <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">{app.tagline}</p>

                    <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                      {app.tags.map(t => (
                        <span key={t} className="bg-gray-200 text-gray-700 text-[10px] px-1.5 py-0.5 rounded font-mono font-medium">
                          {t}
                        </span>
                      ))}
                      <span className="text-[10px] text-purple-800 font-mono font-bold flex items-center gap-0.5">
                        <GitBranch size={10} /> {app.forks} forks
                      </span>
                    </div>
                  </div>

                  {/* Upvote Button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUpvote(app.id); }}
                    className="btn-w95 flex flex-col items-center px-2.5 py-1 shrink-0"
                  >
                    <ThumbsUp size={12} className="text-orange-600" />
                    <span className="font-bold font-mono text-xs">{app.upvotes}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Maker Streaks View */}
        {activeFilter === 'streaks' && (
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            <div className="bg-yellow-50 border-2 border-yellow-500 p-2.5 rounded text-xs">
              <div className="font-bold text-yellow-900 flex items-center gap-1.5 mb-1">
                <Award size={14} className="text-yellow-700" /> Daily Drop Streak Protocol
              </div>
              <p className="text-yellow-800 text-[11px] leading-relaxed">
                Makers who ship at least 1 verified, single-file SQLite release every 24 hours earn front-page boost algorithms and fee waivers.
              </p>
            </div>

            {[
              { rank: 1, handle: 'nate', name: 'Nate McGuire', streak: '14 Days', drops: 18, avatar: '⚡', badge: 'Streak Champion' },
              { rank: 2, handle: 'josh', name: 'Josh McGuire', streak: '9 Days', drops: 11, avatar: '⛵', badge: 'Master Builder' },
              { rank: 3, handle: 'sam', name: 'Sam Altman', streak: '6 Days', drops: 8, avatar: '👨‍💻', badge: 'Active Contributor' }
            ].map((m) => (
              <div key={m.handle} className="p-2.5 border-2 border-gray-300 bg-gray-50 rounded flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono font-bold text-gray-500 text-xs">#{m.rank}</span>
                  <span className="text-2xl bg-white p-1 rounded border">{m.avatar}</span>
                  <div>
                    <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                      {m.name} <span className="text-gray-500 font-mono text-[10px]">@{m.handle}</span>
                    </div>
                    <div className="text-[11px] text-gray-500">{m.drops} releases shipped &middot; {m.badge}</div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="bg-orange-100 text-orange-800 font-bold px-2 py-0.5 rounded text-xs font-mono border border-orange-300">
                    🔥 {m.streak}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right Column: Full-Height Artifact Sandbox / Lineage Tree / Post Editor */}
      <div className="col-span-7 flex flex-col h-full bg-white border-2 border-gray-800 p-2.5 overflow-hidden">
        {isEditing ? (
          <PostEditorView
            app={selectedApp}
            onSave={handleSavePost}
            onCancel={() => setIsEditing(false)}
          />
        ) : showLineage ? (
          <div className="flex flex-col h-full bg-[#ece9d8] p-4 text-xs font-tahoma overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-2 mb-3">
              <span className="font-bold text-base text-w95-blue flex items-center gap-2">
                <GitBranch size={18} className="text-purple-700" /> Fork Lineage &amp; Royalty Splice Tree
              </span>
              <button
                onClick={() => setShowLineage(false)}
                className="btn-w95 text-xs py-1 px-3"
              >
                &larr; Back to App Sandbox
              </button>
            </div>

            <div className="space-y-4 max-w-xl mx-auto">
              <div className="bg-white border-2 border-gray-700 p-3 rounded shadow-md">
                <div className="text-[10px] text-gray-500 uppercase font-mono font-bold">1. Root Upstream Architecture</div>
                <div className="font-bold text-sm text-gray-900">WallArt Core Engine v1.0.0</div>
                <div className="text-gray-600 text-xs mt-0.5">Base canvas slice algorithm &amp; WASM SQLite catalog.</div>
              </div>

              <div className="text-center font-bold text-purple-700 text-lg">&darr; 20% Lineage Royalty Split</div>

              <div className="bg-blue-50 border-2 border-w95-blue p-3 rounded shadow-md ring-2 ring-blue-400">
                <div className="text-[10px] text-w95-blue uppercase font-mono font-bold">2. Current Drop (Selected)</div>
                <div className="font-bold text-base text-w95-blue">{selectedApp.name} ({selectedApp.version})</div>
                <div className="text-gray-700 text-xs mt-0.5">Authored by @{selectedApp.creator} &middot; {selectedApp.upvotes} upvotes &middot; 70% Maker Share</div>
              </div>

              <div className="text-center font-bold text-purple-700 text-lg">&darr; Downstream Community Forks</div>

              <div className="bg-white border-2 border-gray-400 p-3 rounded">
                <div className="text-[10px] text-gray-500 uppercase font-mono font-bold">3. Downstream Fork</div>
                <div className="font-bold text-xs text-gray-900">WallArt PrintLab Webhook (@sam)</div>
                <div className="text-gray-500 text-[11px]">Spliced direct lab fulfillment webhook. 12 sales settled.</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between pb-1.5 mb-1 border-b text-xs">
              <span className="font-bold text-gray-700 flex items-center gap-1.5">
                <span>Moddability: <b className="text-green-700 font-mono">{selectedApp.moddabilityScore}/100</b></span>
                <span>&middot;</span>
                <span>Merge: <b className="text-blue-700 font-mono">{selectedApp.mergeCleanliness}</b></span>
              </span>

              <div className="flex gap-1">
                <button
                  onClick={() => setShowLineage(true)}
                  className="btn-w95 text-xs py-0.5 px-2 flex items-center gap-1 text-purple-800 font-bold"
                >
                  <GitBranch size={11} /> Lineage Tree
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="btn-w95 text-xs py-0.5 px-2 text-w95-blue"
                >
                  Edit Listing
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              <ArtifactSandbox
                app={selectedApp}
                onFork={() => alert(`Forked ${selectedApp.name} into SLOPSHOP worktree!`)}
                onOpenAI={() => alert(`Launching Claude / Codex session for ${selectedApp.name}...`)}
                onEditPost={() => setIsEditing(true)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
