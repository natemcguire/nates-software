import React, { useState, useEffect } from 'react';
import { useCatalog } from '../context/CatalogContext';
import { useAlert } from '../context/AlertContext';
import { MAKER_PROFILES, AppListing } from '../data/mockData';
import { ArtifactSandbox } from '../components/ArtifactSandbox';
import {
  Flame,
  GitFork,
  Search,
  Plus,
  Radio,
  Timer,
  Trophy,
  Users,
  Award,
  Calendar,
  X,
  RefreshCw
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { getCurrentBatchWindow, getTimeToNextDrop } from '../lib/hotwireBackend';

interface HotwireViewProps {
  onOpenApp?: (appId: string) => void;
  onOpenPostEditor?: (app?: AppListing) => void;
}

export const HotwireView: React.FC<HotwireViewProps> = ({ onOpenApp, onOpenPostEditor }) => {
  const { showAlert } = useAlert();
  const {
    apps: catalogApps,
    upvoteApp: catalogUpvote,
    isAuthoritativeLive,
    isLoading,
    error: catalogError,
    refreshCatalog
  } = useCatalog();

  const [apps, setApps] = useState<AppListing[]>(catalogApps);
  const [selectedApp, setSelectedApp] = useState<AppListing | null>(catalogApps[0] || null);
  const [activeFilter, setActiveFilter] = useState<'today' | 'forked' | 'alltime' | 'streaks'>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [upvotedApps, setUpvotedApps] = useState<Set<string>>(new Set());
  const [selectedBatch, setSelectedBatch] = useState<string>('today');
  const [activeVoterApp, setActiveVoterApp] = useState<AppListing | null>(null);

  // Sync internal apps and selected app with catalog updates
  useEffect(() => {
    setApps(catalogApps);
    if (catalogApps.length > 0) {
      setSelectedApp(prev => {
        if (!prev) return catalogApps[0];
        const match = catalogApps.find(a => a.id === prev.id);
        return match || catalogApps[0];
      });
    } else if (isAuthoritativeLive) {
      setSelectedApp(null);
    }
  }, [catalogApps, isAuthoritativeLive]);

  // 12:01 AM UTC Live Ticker Countdown & Batch Window Calculation
  const [timeUntilNextDrop, setTimeUntilNextDrop] = useState<string>('00h 00m 00s');
  const [batchInfo, setBatchInfo] = useState(() => getCurrentBatchWindow());

  useEffect(() => {
    const updateCountdown = () => {
      const dropCountdown = getTimeToNextDrop();
      setTimeUntilNextDrop(dropCountdown.countdown);
      setBatchInfo(getCurrentBatchWindow());
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleUpvote = async (e: React.MouseEvent, appId: string) => {
    e.stopPropagation();
    playClickSound();

    // Snapshot pre-vote state for rollback
    const wasUpvoted = upvotedApps.has(appId);
    const prevUpvotedSet = new Set(upvotedApps);
    const prevApps = [...apps];
    const prevSelectedApp = selectedApp ? { ...selectedApp } : null;

    // Optimistic UI update
    setUpvotedApps(prev => {
      const next = new Set(prev);
      if (wasUpvoted) next.delete(appId);
      else next.add(appId);
      return next;
    });

    setApps(prev => prev.map(app => {
      if (app.id === appId) {
        const newUpvotes = wasUpvoted ? Math.max(0, app.upvotes - 1) : app.upvotes + 1;
        return { ...app, upvotes: newUpvotes };
      }
      return app;
    }));

    if (selectedApp && selectedApp.id === appId) {
      setSelectedApp(prev => ({
        ...prev!,
        upvotes: wasUpvoted ? Math.max(0, prev!.upvotes - 1) : prev!.upvotes + 1
      }));
    }

    try {
      await catalogUpvote(appId);
      playSuccessChime();
    } catch (err: any) {
      // Rollback optimistic state immediately on rejection
      setUpvotedApps(prevUpvotedSet);
      setApps(prevApps);
      if (prevSelectedApp && prevSelectedApp.id === appId) {
        setSelectedApp(prevSelectedApp);
      }

      // Truthfully explain rejection and authenticated/network requirements
      const errMsg = err?.message || 'Upvote rejected';
      if (errMsg.includes('not found') || errMsg.includes('404')) {
        showAlert(
          `Cannot upvote demo/offline drop on the live network. Only registered live D1 drops can receive cryptographic upvotes.`,
          "Upvote Rejected",
          "warning"
        );
      } else if (errMsg.includes('auth') || errMsg.includes('401') || errMsg.includes('403')) {
        showAlert(
          `Authentication is required to record a verified upvote. Please sign in to vote for this drop.`,
          "Sign In Required",
          "warning"
        );
      } else {
        showAlert(
          `Upvote was rolled back because the server rejected the transaction: ${errMsg}`,
          "Upvote Not Saved",
          "error"
        );
      }
    }
  };

  const getFilteredApps = () => {
    let list = [...apps];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.tagline.toLowerCase().includes(q) ||
        a.author.toLowerCase().includes(q) ||
        a.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    switch (activeFilter) {
      case 'forked':
        return list.sort((a, b) => (b.forkCount || 0) - (a.forkCount || 0));
      case 'alltime':
        return list.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
      case 'today':
      default:
        return list;
    }
  };

  const filteredApps = getFilteredApps();

  const handleOpenNewDrop = () => {
    playClickSound();
    if (onOpenPostEditor) {
      const newDropTemplate: AppListing = {
        id: '',
        name: '',
        tagline: '',
        description: '',
        author: 'guest',
        authorAvatar: '⚡',
        creator: 'guest',
        creatorAvatar: '⚡',
        version: 'v1.0.0',
        upvotes: 0,
        forkCount: 0,
        forks: 0,
        tags: ['Shareware'],
        sqliteDatabase: '/data/app.sqlite',
        sqliteSize: '1.4 MB',
        screenshots: [],
        comments: []
      };
      onOpenPostEditor(newDropTemplate);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#c0c0c0] font-sans text-xs select-none">
      {/* 12:01 AM UTC Live Drops Header Banner */}
      <div className="bg-[#000080] text-white px-3 py-2 flex items-center justify-between flex-wrap gap-2 border-b-2 border-white shadow-inner">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold tracking-wide">
            <Radio size={14} className="text-red-400 animate-pulse" />
            <span className="font-mono text-xs">12:01 AM DAILY DROP (Batch #{batchInfo.batchNumber})</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] bg-blue-900/80 px-2 py-0.5 rounded border border-blue-400 font-mono">
            <Timer size={12} className="text-yellow-300" />
            <span>Next UTC Drop: <strong>{timeUntilNextDrop}</strong></span>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-2">
          {/* Daily Calendar Batch Selector */}
          <div className="flex items-center gap-1 bg-blue-950 px-2 py-0.5 rounded border border-blue-600 text-[11px] font-mono">
            <Calendar size={12} className="text-sky-300" />
            <select
              value={selectedBatch}
              onChange={(e) => setSelectedBatch(e.target.value)}
              className="bg-transparent text-white focus:outline-none text-[11px] cursor-pointer"
            >
              <option value="today" className="bg-slate-900 text-white">Today (Batch #{batchInfo.batchNumber})</option>
              <option value="yesterday" className="bg-slate-900 text-white">Yesterday (Batch #{Math.max(1, batchInfo.batchNumber - 1)})</option>
              <option value="archive" className="bg-slate-900 text-white">Historical Genesis Archive</option>
            </select>
          </div>

          {isLoading && apps.length === 0 ? (
            <span className="bg-blue-800 text-blue-200 border border-blue-400 px-2 py-0.5 rounded text-[10px] font-mono font-bold animate-pulse">
              ⏳ CONNECTING...
            </span>
          ) : isAuthoritativeLive ? (
            <span className="bg-emerald-800 text-emerald-200 border border-emerald-400 px-2 py-0.5 rounded text-[10px] font-mono font-bold" title="Authoritative Cloudflare D1 drop registry">
              ● D1 LIVE ({apps.length} drops)
            </span>
          ) : (
            <span className="bg-amber-900 text-amber-200 border border-amber-500 px-2 py-0.5 rounded text-[10px] font-mono font-bold" title="Displaying seed catalog demo drops">
              ● SEED / DEMO DATA
            </span>
          )}

          <button
            onClick={handleOpenNewDrop}
            className="win95-btn px-2.5 py-1 text-black font-bold flex items-center gap-1 text-[11px] bg-[#dfdfdf] hover:bg-white"
          >
            <Plus size={13} />
            <span>Submit Drop</span>
          </button>
        </div>
      </div>

      {/* Explicit Error Banner if Catalog Loading / Sync Encountered Failure */}
      {catalogError && (
        <div className="bg-amber-100 border-b-2 border-amber-400 px-3 py-1.5 flex items-center justify-between text-amber-900 font-mono text-[11px]">
          <span className="flex items-center gap-1.5">
            <span>⚠️</span>
            <span>Live Catalog Notice: {catalogError} (Viewing offline preview dataset)</span>
          </span>
          <button
            onClick={() => {
              playClickSound();
              refreshCatalog();
            }}
            className="win95-btn px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 bg-[#dfdfdf] hover:bg-white text-black"
          >
            <RefreshCw size={10} />
            <span>Retry Sync</span>
          </button>
        </div>
      )}

      {/* Main Hotwire Body: Split Layout */}
      <div className="flex-1 flex overflow-hidden p-2 gap-2">
        {/* Left Column: Product Hunt Style Drops Leaderboard */}
        <div className="w-1/2 flex flex-col min-w-[320px]">
          {/* Filter Tabs */}
          <div className="flex gap-1 mb-1">
            <button
              onClick={() => { playClickSound(); setActiveFilter('today'); }}
              className={`win95-btn px-3 py-1 flex items-center gap-1 font-bold ${
                activeFilter === 'today' ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'
              }`}
            >
              <Flame size={13} className="text-orange-600" /> Today
            </button>
            <button
              onClick={() => { playClickSound(); setActiveFilter('forked'); }}
              className={`win95-btn px-3 py-1 flex items-center gap-1 font-bold ${
                activeFilter === 'forked' ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'
              }`}
            >
              <GitFork size={13} className="text-green-700" /> Top Forked
            </button>
            <button
              onClick={() => { playClickSound(); setActiveFilter('alltime'); }}
              className={`win95-btn px-3 py-1 flex items-center gap-1 font-bold ${
                activeFilter === 'alltime' ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'
              }`}
            >
              <Trophy size={13} className="text-yellow-600" /> All-Time
            </button>
            <button
              onClick={() => { playClickSound(); setActiveFilter('streaks'); }}
              className={`win95-btn px-3 py-1 flex items-center gap-1 font-bold ${
                activeFilter === 'streaks' ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'
              }`}
            >
              <Award size={13} className="text-purple-600" /> Streaks
            </button>
          </div>

          {/* Search Filter */}
          <div className="win95-field p-1 mb-2 bg-white flex items-center gap-1.5 border border-gray-600">
            <Search size={13} className="text-gray-500 ml-1" />
            <input
              type="text"
              placeholder="Search software, creators, tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs outline-none bg-transparent"
            />
          </div>

          {/* Drops List Container */}
          <div className="flex-1 win95-field p-1 bg-white overflow-y-auto divide-y divide-gray-200">
            {activeFilter === 'streaks' ? (
              <div className="p-2 space-y-2">
                <div className="font-bold text-xs text-blue-900 mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Award size={14} className="text-purple-600" />
                    <span>Verified Maker Streak Leaderboard</span>
                  </div>
                  <span className="text-[10px] text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-300 font-mono">
                    Demo / Seed Profiles
                  </span>
                </div>
                {MAKER_PROFILES.map((maker, idx) => (
                  <div key={maker.id} className="p-2.5 rounded bg-slate-50 border border-slate-300 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold font-mono text-sm text-slate-500">#{idx + 1}</span>
                      <span className="text-xl">{maker.avatar}</span>
                      <div>
                        <div className="font-bold text-xs text-slate-800">{maker.name} <span className="text-slate-500 font-normal">{maker.handle}</span></div>
                        <div className="text-[10px] text-slate-600">{maker.bio}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="bg-orange-100 text-orange-800 border border-orange-300 px-2 py-0.5 rounded font-mono font-bold text-xs">
                        {maker.streakBadge}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : isLoading && apps.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <div className="text-2xl animate-spin">⏳</div>
                <div className="font-bold text-xs text-slate-700">Connecting to 12:01 AM UTC Drop Registry...</div>
                <p className="text-[11px] text-slate-500">Retrieving daily shareware queue from Cloudflare D1.</p>
              </div>
            ) : filteredApps.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <div className="text-2xl">📦</div>
                <div className="font-bold text-xs text-slate-700">
                  {searchQuery.trim()
                    ? 'No apps found'
                    : isAuthoritativeLive
                      ? 'No Live Drops in 12:01 AM Batch'
                      : 'No drops found'}
                </div>
                <p className="text-[11px] text-slate-500">
                  {searchQuery.trim()
                    ? `No drops matched "${searchQuery}". Try searching for another tag or creator.`
                    : isAuthoritativeLive
                      ? 'The live D1 queue is currently empty. Be the first creator to launch a drop!'
                      : 'No drops available in this category.'}
                </p>
                {isAuthoritativeLive && !searchQuery.trim() && (
                  <button
                    onClick={handleOpenNewDrop}
                    className="win95-btn px-3 py-1 text-black font-bold flex items-center gap-1 text-xs bg-[#dfdfdf] hover:bg-white mx-auto mt-2"
                  >
                    <Plus size={13} />
                    <span>Submit First Drop</span>
                  </button>
                )}
              </div>
            ) : (
              filteredApps.map((app, index) => {
                const isSelected = selectedApp?.id === app.id;
                const isUpvoted = upvotedApps.has(app.id);

                return (
                  <div
                    key={app.id}
                    onClick={() => {
                      playClickSound();
                      setSelectedApp(app);
                      if (onOpenApp) onOpenApp(app.id);
                    }}
                    className={`p-2.5 cursor-pointer flex items-start justify-between gap-2 transition-colors ${
                      isSelected ? 'bg-blue-50 border-l-4 border-blue-800' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-xs font-mono text-slate-500">#{index + 1}</span>
                        <span className="font-bold text-xs text-blue-900">{app.name}</span>
                        <span className="bg-green-100 text-green-800 font-mono text-[10px] px-1 rounded">
                          {app.version}
                        </span>
                        <span className="text-gray-500 text-[10px]">by @{app.author || app.creator}</span>

                        {/* Distinct Demo Data vs Live Drop Badge */}
                        {app.isDemo || !isAuthoritativeLive ? (
                          <span className="bg-amber-100 text-amber-900 border border-amber-400 font-bold font-mono text-[9px] px-1.5 py-0.2 rounded" title="Seed Demo Data">
                            DEMO
                          </span>
                        ) : (
                          <span className="bg-emerald-100 text-emerald-900 border border-emerald-400 font-bold font-mono text-[9px] px-1.5 py-0.2 rounded" title="Authoritative Live D1 Drop">
                            LIVE
                          </span>
                        )}

                        {/* Product Hunt Style Award Badges */}
                        {app.badge && (
                          <span className="bg-amber-100 text-amber-900 border border-amber-400 font-bold text-[9px] px-1.5 py-0.2 rounded-full flex items-center gap-1">
                            <Trophy size={10} className="text-amber-600" />
                            <span>{app.badge}</span>
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-gray-700 mt-1 line-clamp-1">
                        {app.tagline}
                      </p>

                      <div className="flex items-center gap-1.5 mt-2 flex-wrap text-[10px]">
                        {app.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-300 font-mono">
                            {tag}
                          </span>
                        ))}
                        <span className="text-gray-400 font-mono">|</span>
                        <span className="text-gray-500 font-mono flex items-center gap-0.5">
                          <GitFork size={10} /> {app.forkCount || 0} forks
                        </span>
                      </div>
                    </div>

                    {/* Upvote & Voter Badge Button */}
                    <div className="flex flex-col items-center gap-1">
                      <button
                        onClick={(e) => handleUpvote(e, app.id)}
                        className={`win95-btn px-2 py-1 flex flex-col items-center min-w-[42px] transition-all ${
                          isUpvoted ? 'bg-orange-100 border-orange-500 text-orange-900 font-bold' : 'bg-[#dfdfdf]'
                        }`}
                        title="Upvote drop"
                      >
                        <Flame size={12} className={isUpvoted ? 'text-orange-600 fill-orange-600' : 'text-gray-600'} />
                        <span className="font-mono text-xs mt-0.5">{app.upvotes}</span>
                      </button>

                      {app.voters && app.voters.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            playClickSound();
                            setActiveVoterApp(app);
                          }}
                          className="text-[10px] text-blue-700 hover:underline flex items-center gap-0.5 font-mono"
                          title="View verified voters"
                        >
                          <Users size={9} />
                          <span>{app.voters.length}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Artifact Sandbox */}
        <div className="w-1/2 flex flex-col min-w-[320px]">
          {selectedApp ? (
            <ArtifactSandbox
              app={selectedApp}
              onOpenPostEditor={onOpenPostEditor}
            />
          ) : (
            <div className="h-full bg-[#ece9d8] border-2 border-gray-400 p-8 flex flex-col items-center justify-center text-center space-y-3 font-tahoma">
              <div className="text-4xl">🚀</div>
              <div className="font-bold text-sm text-w95-blue">No Drop Selected</div>
              <p className="text-xs text-gray-600 max-w-xs">
                Select any shareware drop from the 12:01 AM leaderboard on the left to inspect its live sandbox, storage, and screenshots.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Voter Transparency Modal */}
      {activeVoterApp && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="win95-window max-w-sm w-full bg-[#c0c0c0] p-3 text-xs space-y-3">
            <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between font-bold">
              <span>Verified Voters · {activeVoterApp.name} <span className="text-yellow-300 text-[10px] font-normal font-mono">(Demo Data)</span></span>
              <button onClick={() => setActiveVoterApp(null)} className="text-white hover:text-red-300">
                <X size={14} />
              </button>
            </div>

            <div className="space-y-1.5 max-h-60 overflow-y-auto bg-white p-2 border border-gray-600">
              {activeVoterApp.voters?.map((voter, i) => (
                <div key={i} className="flex items-center justify-between p-1.5 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{voter.avatar}</span>
                    <div>
                      <div className="font-bold text-slate-800">{voter.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{voter.handle}</div>
                    </div>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 text-[9px] font-mono px-1.5 py-0.5 rounded font-bold">
                    VERIFIED
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button onClick={() => setActiveVoterApp(null)} className="win95-btn px-4 py-1 font-bold">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
