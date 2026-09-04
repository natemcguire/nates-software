import React, { useState, useEffect } from 'react';
import { useCatalog } from '../context/CatalogContext';
import { useAlert } from '../context/AlertContext';
import { AppListing } from '../data/mockData';
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
import { useAuth } from '../context/AuthContext';

interface HotwireViewProps {
  onOpenApp?: (appId: string) => void;
  onOpenPostEditor?: (app?: AppListing) => void;
  onOpenLeaders?: () => void;
}

export const HotwireView: React.FC<HotwireViewProps> = ({ onOpenApp, onOpenPostEditor, onOpenLeaders }) => {
  const { showAlert } = useAlert();
  const { user, requireAuth, isAuthenticated } = useAuth();
  const {
    apps: catalogApps,
    upvoteApp: catalogUpvote,
    makerLeaderboard,
    isAuthoritativeLive,
    votedAppIds,
    hasVoted: catalogHasVoted,
    isLoading,
    error: catalogError,
    refreshCatalog
  } = useCatalog();

  const [apps, setApps] = useState<AppListing[]>(catalogApps);
  const [selectedApp, setSelectedApp] = useState<AppListing | null>(catalogApps[0] || null);
  const [activeFilter, setActiveFilter] = useState<'today' | 'forked' | 'alltime' | 'streaks' | 'mine'>('alltime');
  const [searchQuery, setSearchQuery] = useState('');
  const [upvotedApps, setUpvotedApps] = useState<Set<string>>(votedAppIds || new Set());
  const [selectedBatch, setSelectedBatch] = useState<string>('all');
  const [activeVoterApp, setActiveVoterApp] = useState<AppListing | null>(null);
  const [voteReward, setVoteReward] = useState<string | null>(null);

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

  useEffect(() => {
    if (votedAppIds && votedAppIds.size > 0) {
      setUpvotedApps(prev => {
        const next = new Set(prev);
        votedAppIds.forEach(id => next.add(id));
        return next;
      });
    } else if (catalogApps.some(a => a.hasVoted)) {
      setUpvotedApps(prev => {
        const next = new Set(prev);
        catalogApps.filter(a => a.hasVoted).forEach(a => next.add(a.id));
        return next;
      });
    }
  }, [votedAppIds, catalogApps]);

  const handleBatchSelect = (batch: string) => {
    playClickSound();
    setSelectedBatch(batch);
    const sort = activeFilter === 'forked' ? 'forks' : activeFilter === 'alltime' ? 'alltime' : 'today';
    refreshCatalog({ sort, batch });
  };

  const handleFilterSelect = (filter: 'today' | 'forked' | 'alltime' | 'streaks' | 'mine') => {
    playClickSound();
    setActiveFilter(filter);
    if (filter !== 'streaks' && filter !== 'mine') {
      const sort = filter === 'forked' ? 'forks' : filter === 'alltime' ? 'alltime' : 'today';
      const batch = filter === 'alltime' ? 'all' : filter === 'today' ? 'today' : selectedBatch;
      setSelectedBatch(batch);
      refreshCatalog({ sort, batch });
    }
  };

  const [timeUntilNextDrop, setTimeUntilNextDrop] = useState<string>('00h 00m 00s');
  const [batchInfo, setBatchInfo] = useState(() => getCurrentBatchWindow());

  const getNextDropLocalTime = () => {
    const now = new Date();
    const nextUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 1, 0, 0));
    if (now.getTime() >= nextUtc.getTime()) {
      nextUtc.setUTCDate(nextUtc.getUTCDate() + 1);
    }
    return nextUtc.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

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

  const handleUpvote = (e: React.MouseEvent, appId: string) => {
    e.stopPropagation();
    if (upvotedApps.has(appId) || catalogHasVoted(appId)) {
      return;
    }

    requireAuth('vote for this drop', async () => {
      playClickSound();
      setUpvotedApps(prev => new Set(prev).add(appId));

      try {
        await catalogUpvote(appId);
        playSuccessChime();
        setVoteReward(appId);
      } catch (err: any) {
        setUpvotedApps(prev => {
          const next = new Set(prev);
          next.delete(appId);
          return next;
        });

        const errMsg = err?.message || 'Upvote rejected';
        if (errMsg.includes('not found') || errMsg.includes('404')) {
          showAlert(
            `You can only upvote real drops that are live on the board. This one is demo or offline data.`,
            "Upvote Rejected",
            "warning"
          );
        } else if (errMsg.includes('auth') || errMsg.includes('401') || errMsg.includes('403')) {
          showAlert(
            `Authentication is required to vote. Please sign in to vote for this drop.`,
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
    });
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

    if (activeFilter === 'mine' && user?.username) {
      list = list.filter(a => a.author === user.username || a.creator === user.username);
    }

    switch (activeFilter) {
      case 'forked':
        return list.sort((a, b) => (b.forkCount || 0) - (a.forkCount || 0));
      case 'alltime':
        return list.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
      case 'today':
      case 'mine':
      default:
        return list;
    }
  };

  const filteredApps = getFilteredApps();

  const handleOpenNewDrop = () => {
    playClickSound();
    requireAuth('submit a new drop to HOTWIRE', () => {
      if (onOpenPostEditor) {
        const newDropTemplate: AppListing = {
          id: '',
          name: '',
          tagline: '',
          description: '',
          author: user?.username || 'guest',
          authorAvatar: user?.avatar || '⚡',
          creator: user?.username || 'guest',
          creatorAvatar: user?.avatar || '⚡',
          version: 'v1.0.0',
          upvotes: 0,
          forkCount: 0,
          forks: 0,
          tags: ['Shareware'],
          sqliteDatabase: '',
          sqliteSize: 'Not specified',
          screenshots: [],
          comments: []
        };
        onOpenPostEditor(newDropTemplate);
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#c0c0c0] font-sans text-xs select-none">
      <div className="bg-[#000050] text-blue-200 px-3 py-1 text-[11px] font-mono border-b border-blue-900 flex items-center justify-between flex-wrap gap-2">
        <span>Every day at 12:01 AM UTC, makers drop new apps. Vote for your favorites.</span>
        <span className="text-blue-300 text-[10px]">12:01 AM UTC = {getNextDropLocalTime()} local</span>
      </div>

      {voteReward && (
        <div className="bg-emerald-100 border-b border-emerald-400 px-3 py-1.5 flex items-center justify-between text-emerald-950 text-xs">
          <span className="font-bold">Vote counted.</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                playClickSound();
                handleFilterSelect('today');
                setVoteReward(null);
                if (onOpenLeaders) onOpenLeaders();
              }}
              className="text-emerald-900 hover:text-black font-bold underline text-xs cursor-pointer"
            >
              See today's leaders &rarr;
            </button>
            <button
              onClick={() => setVoteReward(null)}
              className="text-emerald-700 hover:text-emerald-950 text-xs ml-2 cursor-pointer font-bold"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="bg-[#000080] text-white px-3 py-2 flex items-center justify-between flex-wrap gap-2 border-b-2 border-white shadow-inner">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold tracking-wide">
            <Radio size={14} className="text-red-400 animate-pulse" />
            <span className="font-mono text-xs">12:01 AM DAILY DROP (Batch #{batchInfo.batchNumber})</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] bg-blue-900/80 px-2 py-0.5 rounded border border-blue-400 font-mono">
            <Timer size={12} className="text-yellow-300" />
            <span>Next Drop: <strong>{timeUntilNextDrop}</strong> ({getNextDropLocalTime()} local · 12:01 AM UTC)</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-blue-950 px-2 py-0.5 rounded border border-blue-600 text-[11px] font-mono">
            <Calendar size={12} className="text-sky-300" />
            <select
              value={selectedBatch}
              onChange={(e) => handleBatchSelect(e.target.value)}
              className="bg-transparent text-white focus:outline-none text-[11px] cursor-pointer"
            >
              <option value="all" className="bg-slate-900 text-white">All Drops (Cumulative)</option>
              <option value="today" className="bg-slate-900 text-white">Today (Batch #{batchInfo.batchNumber})</option>
              <option value="archive" className="bg-slate-900 text-white">Historical Genesis Archive</option>
            </select>
          </div>

          {isLoading && apps.length === 0 ? (
            <span className="bg-blue-800 text-blue-200 border border-blue-400 px-2 py-0.5 rounded text-[10px] font-mono font-bold animate-pulse">
              ⏳ CONNECTING...
            </span>
          ) : isAuthoritativeLive ? (
            <span className="bg-emerald-800 text-emerald-200 border border-emerald-400 px-2 py-0.5 rounded text-[10px] font-mono font-bold" title="Live drop registry">
              ● LIVE ({apps.length} drops)
            </span>
          ) : (
            <span className="bg-red-950 text-red-200 border border-red-500 px-2 py-0.5 rounded text-[10px] font-mono font-bold" title="Disconnected / offline">
              ● OFFLINE / DISCONNECTED
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

      {catalogError && (
        <div className="bg-amber-100 border-b-2 border-amber-400 px-3 py-1.5 flex items-center justify-between text-amber-900 font-mono text-[11px]">
          <span className="flex items-center gap-1.5">
            <span>⚠️</span>
            <span>Live Catalog Error: {catalogError}</span>
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

      <div className="flex-1 flex overflow-hidden p-2 gap-2">
        <div className="w-1/2 flex flex-col min-w-[320px]">
          <div className="flex gap-1 mb-1 flex-wrap">
            <button
              onClick={() => handleFilterSelect('today')}
              className={`win95-btn px-2.5 py-1 flex items-center gap-1 font-bold ${
                activeFilter === 'today' ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'
              }`}
            >
              <Flame size={13} className="text-orange-600" /> Today
            </button>
            <button
              onClick={() => handleFilterSelect('forked')}
              className={`win95-btn px-2.5 py-1 flex items-center gap-1 font-bold ${
                activeFilter === 'forked' ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'
              }`}
            >
              <GitFork size={13} className="text-green-700" /> Top Forked
            </button>
            <button
              onClick={() => handleFilterSelect('alltime')}
              className={`win95-btn px-2.5 py-1 flex items-center gap-1 font-bold ${
                activeFilter === 'alltime' ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'
              }`}
            >
              <Trophy size={13} className="text-yellow-600" /> All-Time
            </button>
            <button
              onClick={() => handleFilterSelect('streaks')}
              className={`win95-btn px-2.5 py-1 flex items-center gap-1 font-bold ${
                activeFilter === 'streaks' ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'
              }`}
            >
              <Award size={13} className="text-purple-600" /> Streaks
            </button>
            {user?.username && (
              <button
                onClick={() => handleFilterSelect('mine')}
                className={`win95-btn px-2.5 py-1 flex items-center gap-1 font-bold ${
                  activeFilter === 'mine' ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'
                }`}
              >
                <span className="text-emerald-700 font-bold">●</span> Mine
              </button>
            )}
          </div>

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

          <div className="flex-1 win95-field p-1 bg-white overflow-y-auto divide-y divide-gray-200">
            {activeFilter === 'streaks' ? (
              <div className="p-2 space-y-2">
                <div className="font-bold text-xs text-blue-900 mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Award size={14} className="text-purple-600" />
                    <span>Verified Maker Streak Leaderboard</span>
                  </div>
                  {isAuthoritativeLive ? (
                    <span className="text-[10px] text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-300 font-mono">
                      ● Verified Makers ({makerLeaderboard?.length || 0})
                    </span>
                  ) : (
                    <span className="text-[10px] text-red-200 bg-red-950 px-1.5 py-0.5 rounded border border-red-500 font-mono">
                      ● OFFLINE / DISCONNECTED
                    </span>
                  )}
                </div>
                {isAuthoritativeLive ? (
                  makerLeaderboard && makerLeaderboard.length > 0 ? (
                    makerLeaderboard.map((maker: any, idx: number) => {
                      const avatar = maker.avatar || '⚡';
                      const name = maker.displayName || maker.username || 'Maker';
                      const handle = maker.username ? `@${maker.username}` : '@anonymous';
                      const badgeText = maker.badgeInfo
                        ? `${maker.badgeInfo.icon} ${maker.currentStreak} Day${maker.currentStreak === 1 ? '' : 's'}`
                        : `${maker.currentStreak || 1} Day streak`;
                      const tierTitle = maker.badgeInfo?.title || 'Rookie Maker';
                      const dropCount = maker.totalDrops || 0;

                      return (
                        <div key={maker.id || idx} className="p-2.5 rounded bg-slate-50 border border-slate-300 flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className="font-bold font-mono text-sm text-slate-500">#{idx + 1}</span>
                            <span className="text-xl">{avatar}</span>
                            <div>
                              <div className="font-bold text-xs text-slate-800">
                                {name} <span className="text-slate-500 font-normal">{handle}</span>
                                <span className="ml-1.5 text-[10px] text-blue-700 font-mono font-medium">({tierTitle})</span>
                              </div>
                              <div className="text-[10px] text-slate-600">
                                {maker.bio || 'Ships software people can own.'} · {dropCount} drop{dropCount === 1 ? '' : 's'}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="bg-orange-100 text-orange-800 border border-orange-300 px-2 py-0.5 rounded font-mono font-bold text-xs">
                              {badgeText}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center space-y-2">
                      <div className="text-2xl">🌱</div>
                      <div className="font-bold text-xs text-slate-700">No Maker Streaks Recorded</div>
                      <p className="text-[11px] text-slate-500">
                        Publish daily shareware drops to build an active streak and earn maker rank.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="p-8 text-center space-y-2">
                    <div className="text-2xl">📡</div>
                    <div className="font-bold text-xs text-slate-700">Maker Leaderboard Unavailable</div>
                    <p className="text-[11px] text-slate-500">
                      Could not reach the live drop registry, so no maker data is shown. Retry sync to reconnect — this panel never shows invented profiles.
                    </p>
                  </div>
                )}
              </div>
            ) : isLoading && apps.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <div className="text-2xl animate-spin">⏳</div>
                <div className="font-bold text-xs text-slate-700">Connecting to 12:01 AM UTC Drop Registry...</div>
                <p className="text-[11px] text-slate-500">Retrieving daily shareware queue.</p>
              </div>
            ) : filteredApps.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <div className="text-2xl">📦</div>
                <div className="font-bold text-xs text-slate-700">
                  {searchQuery.trim()
                    ? 'No apps found'
                    : selectedBatch === 'yesterday'
                      ? `No Drops in Yesterday's Batch (#${Math.max(1, batchInfo.batchNumber - 1)})`
                      : selectedBatch === 'archive'
                        ? 'No Historical Archived Drops'
                        : isAuthoritativeLive
                          ? `No Live Drops in Today's 12:01 AM Batch (#${batchInfo.batchNumber})`
                          : catalogError
                            ? 'Unable to load live drops'
                            : 'No drops found'}
                </div>
                <p className="text-[11px] text-slate-500">
                  {searchQuery.trim()
                    ? `No drops matched "${searchQuery}". Try searching for another tag or creator.`
                    : selectedBatch === 'yesterday'
                      ? `No drops were registered during yesterday's 12:01 AM UTC batch window.`
                      : selectedBatch === 'archive'
                        ? `No older archived drops found before current batch window.`
                        : isAuthoritativeLive
                          ? `The live 12:01 AM batch (#${batchInfo.batchNumber}) is currently empty. Be the first creator to launch a drop today!`
                          : catalogError
                            ? `Failed to retrieve drops from the live registry: ${catalogError}`
                            : 'No drops available in this category.'}
                </p>
                {catalogError ? (
                  <button
                    onClick={() => {
                      playClickSound();
                      refreshCatalog();
                    }}
                    className="win95-btn px-3 py-1 text-black font-bold flex items-center gap-1 text-xs bg-[#dfdfdf] hover:bg-white mx-auto mt-2"
                  >
                    <RefreshCw size={12} />
                    <span>Retry Connection</span>
                  </button>
                ) : isAuthoritativeLive && !searchQuery.trim() ? (
                  <button
                    onClick={handleOpenNewDrop}
                    className="win95-btn px-3 py-1 text-black font-bold flex items-center gap-1 text-xs bg-[#dfdfdf] hover:bg-white mx-auto mt-2"
                  >
                    <Plus size={13} />
                    <span>Submit First Drop</span>
                  </button>
                ) : null}
              </div>
            ) : (
              filteredApps.map((app, index) => {
                const isSelected = selectedApp?.id === app.id;
                const isUpvoted = upvotedApps.has(app.id) || Boolean(app.hasVoted);

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
                        <span className="text-gray-500 text-[10px]">by @{app.author || app.creator || 'not supplied'}</span>

                        {user?.username && (app.author === user.username || app.creator === user.username) && (
                          <span className="bg-emerald-100 text-emerald-900 border border-emerald-400 font-bold font-mono text-[9px] px-1.5 py-0.2 rounded" title="Submitted by you">
                            MINE
                          </span>
                        )}

                        {app.isDemo || !isAuthoritativeLive ? (
                          <span className="bg-amber-100 text-amber-900 border border-amber-400 font-bold font-mono text-[9px] px-1.5 py-0.2 rounded" title="Seed Demo Data">
                            DEMO
                          </span>
                        ) : (
                          <span className="bg-emerald-100 text-emerald-900 border border-emerald-400 font-bold font-mono text-[9px] px-1.5 py-0.2 rounded" title="Live Drop">
                            LIVE
                          </span>
                        )}

                        {app.hasCanonicalRepo && app.repoSlug ? (
                          <span className="bg-blue-50 text-blue-900 border border-blue-300 font-mono text-[9px] px-1.5 py-0.2 rounded flex items-center gap-1" title={`Canonical GITSMITH Repo: ${app.repoSlug}`}>
                            <GitFork size={9} className="text-blue-700 shrink-0" />
                            <span>{app.repoSlug}</span>
                            {app.repoHeadCommitOid && (
                              <span className="text-blue-600">· #{app.repoHeadCommitOid.slice(0, 7)}</span>
                            )}
                          </span>
                        ) : (
                          <span className="bg-gray-100 text-gray-500 border border-gray-300 font-mono text-[9px] px-1.5 py-0.2 rounded" title="Source repository not yet on GITSMITH forge">
                            not yet on forge
                          </span>
                        )}

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
                        {app.tags && app.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-300 font-mono">
                            {tag}
                          </span>
                        ))}
                        {app.tags && app.tags.length > 0 && (
                          <span className="text-gray-400 font-mono">|</span>
                        )}
                        <span className="text-gray-500 font-mono flex items-center gap-0.5">
                          <GitFork size={10} /> {app.forkCount || 0} forks
                        </span>
                        <span className="text-gray-400 font-mono">|</span>
                        <a
                          href={`/tree/${encodeURIComponent(app.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => { e.stopPropagation(); playClickSound(); }}
                          className="text-green-700 hover:text-green-900 font-mono font-bold flex items-center gap-0.5"
                          title="See the fork lineage tree for this app — shareable"
                        >
                          🌳 lineage tree →
                        </a>
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-1">
                      {isSelected ? (
                        <button
                          onClick={(e) => handleUpvote(e, app.id)}
                          disabled={isUpvoted}
                          className={`win95-btn px-2.5 py-1 flex items-center gap-1 transition-all whitespace-nowrap ${
                            isUpvoted ? 'bg-orange-100 border-orange-500 text-orange-900 font-bold opacity-90 cursor-default' : 'bg-[#dfdfdf] hover:bg-white font-bold text-black'
                          }`}
                          title={isUpvoted ? "Already voted for this drop" : !isAuthenticated ? "Sign in to vote" : "Upvote drop"}
                        >
                          <Flame size={12} className={isUpvoted ? 'text-orange-600 fill-orange-600' : 'text-orange-600'} />
                          <span className="font-mono text-xs">
                            {!isAuthenticated
                              ? 'Sign in to vote'
                              : isUpvoted
                                ? `Voted (${app.upvotes})`
                                : `Upvote (${app.upvotes})`}
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={(e) => handleUpvote(e, app.id)}
                          disabled={isUpvoted}
                          className={`win95-btn px-2 py-1 flex flex-col items-center min-w-[42px] transition-all ${
                            isUpvoted ? 'bg-orange-100 border-orange-500 text-orange-900 font-bold opacity-90 cursor-default' : 'bg-[#dfdfdf] hover:bg-white'
                          }`}
                          title={isUpvoted ? "Already voted for this drop" : !isAuthenticated ? "Sign in to vote" : `Upvote (${app.upvotes})`}
                        >
                          <Flame size={12} className={isUpvoted ? 'text-orange-600 fill-orange-600' : 'text-gray-600'} />
                          <span className="font-mono text-xs mt-0.5">{app.upvotes}</span>
                          {isUpvoted && (
                            <span className="text-[8px] font-mono text-orange-800 font-bold uppercase">Voted</span>
                          )}
                        </button>
                      )}

                      {app.isDemo && app.voters && app.voters.length > 0 && (
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
