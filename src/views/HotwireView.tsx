import React, { useState, useEffect, useMemo } from 'react';
import { useCatalog } from '../context/CatalogContext';
import { useAlert } from '../context/AlertContext';
import { AppListing } from '../data/mockData';
import { ArtifactSandbox } from '../components/ArtifactSandbox';
import { Win95Scroll } from '../components/Win95Scroll';
import {
  Flame,
  GitFork,
  Search,
  Plus,
  Trophy,
  ShoppingCart,
  TrendingUp,
  FileCode,
  FileText,
  Play,
  Snowflake,
  ArrowLeft,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';
import { deriveListingStatus } from '../lib/listingStatus';

interface HotwireViewProps {
  onOpenApp?: (appId: string) => void;
  onOpenPostEditor?: (app?: AppListing) => void;
  onOpenLeaders?: () => void;
}

type LibraryTab = 'hot' | 'forked' | 'bought' | 'rising';
type InspectTab = 'code' | 'readme' | 'preview' | 'lineage';

const PLATFORM_RATE = 0.10;

const getRoyaltyBps = (app: AppListing): number => {
  if (typeof app.royaltyBps === 'number') return app.royaltyBps;
  if (typeof app.royalty_bps === 'number') return app.royalty_bps;
  return 0;
};

const getPrice = (app: AppListing): number => {
  if (typeof app.price === 'number' && app.price > 0) return app.price;
  return 15;
};

const money = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const librarySlug = (app: AppListing): string => {
  if (app.repoSlug) return app.repoSlug;
  const owner = app.author || app.creator || 'maker';
  const name = (app.repoName || app.name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${owner}/${name}`;
};

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
  const [selectedApp, setSelectedApp] = useState<AppListing | null>(null);
  const [activeTab, setActiveTab] = useState<LibraryTab>('hot');
  const [searchQuery, setSearchQuery] = useState('');
  const [upvotedApps, setUpvotedApps] = useState<Set<string>>(votedAppIds || new Set());
  const [inspectTab, setInspectTab] = useState<InspectTab>('code');

  useEffect(() => {
    setApps(catalogApps);
    if (selectedApp) {
      const match = catalogApps.find(a => a.id === selectedApp.id);
      if (match) setSelectedApp(match);
    }
  }, [catalogApps]);

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

  const handleTabSelect = (tab: LibraryTab) => {
    playClickSound();
    setActiveTab(tab);
    if (tab === 'hot' || tab === 'rising') {
      refreshCatalog({ sort: 'today' });
    } else if (tab === 'forked') {
      refreshCatalog({ sort: 'forks' });
    } else if (tab === 'bought') {
      refreshCatalog({ sort: 'alltime' });
    }
  };

  const handleUpvote = (e: React.MouseEvent, appId: string) => {
    e.stopPropagation();
    if (upvotedApps.has(appId) || catalogHasVoted(appId)) return;

    requireAuth('upvote this app', async () => {
      playClickSound();
      setUpvotedApps(prev => new Set(prev).add(appId));
      try {
        await catalogUpvote(appId);
        playSuccessChime();
      } catch (err: any) {
        setUpvotedApps(prev => {
          const next = new Set(prev);
          next.delete(appId);
          return next;
        });
        const errMsg = err?.message || 'Upvote rejected';
        if (errMsg.includes('not found') || errMsg.includes('404')) {
          showAlert(`You can only upvote real apps that are live in the library. This one is demo or offline data.`, 'Upvote Rejected', 'warning');
        } else if (errMsg.includes('auth') || errMsg.includes('401') || errMsg.includes('403')) {
          showAlert(`Sign in to upvote apps in the library.`, 'Sign In Required', 'warning');
        } else {
          showAlert(`Upvote was rolled back because the server rejected it: ${errMsg}`, 'Upvote Not Saved', 'error');
        }
      }
    });
  };

  const rankedApps = useMemo(() => {
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

    switch (activeTab) {
      case 'forked':
        return list.sort((a, b) => (b.forkCount || 0) - (a.forkCount || 0));
      case 'bought':
        return list.sort((a, b) => getPrice(b) * (b.forkCount || 0) - getPrice(a) * (a.forkCount || 0));
      case 'rising':
        return list.sort((a, b) => ((b.upvotes || 0) + (b.forkCount || 0) * 2) - ((a.upvotes || 0) + (a.forkCount || 0) * 2));
      case 'hot':
      default:
        return list.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    }
  }, [apps, searchQuery, activeTab]);

  const handleOpenNewApp = () => {
    playClickSound();
    requireAuth('submit an app to the library', () => {
      if (onOpenPostEditor) {
        const template: AppListing = {
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
        onOpenPostEditor(template);
      }
    });
  };

  const openInspector = (app: AppListing) => {
    playClickSound();
    setSelectedApp(app);
    setInspectTab('code');
    if (onOpenApp) onOpenApp(app.id);
  };

  const tabs: { id: LibraryTab; label: string; icon: React.ReactNode }[] = [
    { id: 'hot', label: 'Hot', icon: <Flame size={12} className="text-orange-600" /> },
    { id: 'forked', label: 'Top Forked', icon: <GitFork size={12} className="text-green-700" /> },
    { id: 'bought', label: 'Most Bought', icon: <ShoppingCart size={12} className="text-blue-700" /> },
    { id: 'rising', label: 'Rising', icon: <TrendingUp size={12} className="text-purple-600" /> }
  ];

  const addressPath = selectedApp
    ? `nsw://library/@${selectedApp.author || selectedApp.creator || 'maker'}/${(selectedApp.repoName || selectedApp.name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    : 'nsw://library/';
  const addressVersion = selectedApp ? ` · ${selectedApp.version} · main` : ' · what’s hot';

  return (
    <div className="flex flex-col h-full bg-[#c0c0c0] font-tahoma text-xs select-none">
      <div className="flex items-center gap-2 px-2 py-1.5 bg-[#c0c0c0] border-b border-gray-400">
        {selectedApp && (
          <button
            onClick={() => { playClickSound(); setSelectedApp(null); }}
            className="win95-btn px-2 py-0.5 flex items-center gap-1 font-bold bg-[#dfdfdf] hover:bg-white shrink-0"
            title="Back to HOTWIRE list"
          >
            <ArrowLeft size={12} /> Back to HOTWIRE list
          </button>
        )}
        <span className="font-bold text-gray-700">Address</span>
        <div className="flex-1 flex items-center gap-1.5 bg-white win95-field px-2 py-0.5 border border-gray-600 font-mono text-[11px] min-w-0">
          <span>📁</span>
          <span className="truncate">
            {addressPath.split('/').slice(0, 3).join('/')}/
            <span className="text-[#7a1f00] font-bold">
              {addressPath.split('/').slice(3).join('/')}
            </span>
            <span className="text-gray-500">{addressVersion}</span>
          </span>
        </div>
      </div>

      {catalogError && (
        <div className="bg-amber-100 border-b-2 border-amber-400 px-3 py-1.5 flex items-center justify-between text-amber-900 font-mono text-[11px]">
          <span className="flex items-center gap-1.5">⚠️ Live Catalog Error: {catalogError}</span>
          <button
            onClick={() => { playClickSound(); refreshCatalog(); }}
            className="win95-btn px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 bg-[#dfdfdf] hover:bg-white text-black"
          >
            <RefreshCw size={10} /> Retry Sync
          </button>
        </div>
      )}

      {selectedApp
        ? <InspectorPane
            app={selectedApp}
            inspectTab={inspectTab}
            setInspectTab={setInspectTab}
            onOpenPostEditor={onOpenPostEditor}
            isAuthoritativeLive={isAuthoritativeLive}
          />
        : <LibraryIndex
            apps={rankedApps}
            tabs={tabs}
            activeTab={activeTab}
            onTabSelect={handleTabSelect}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onSubmit={handleOpenNewApp}
            onOpen={openInspector}
            onUpvote={handleUpvote}
            upvotedApps={upvotedApps}
            isAuthenticated={isAuthenticated}
            isAuthoritativeLive={isAuthoritativeLive}
            isLoading={isLoading}
            appCount={apps.length}
            leaderboardCount={makerLeaderboard?.length || 0}
            onOpenLeaders={onOpenLeaders}
          />
      }
    </div>
  );
};

interface LibraryIndexProps {
  apps: AppListing[];
  tabs: { id: LibraryTab; label: string; icon: React.ReactNode }[];
  activeTab: LibraryTab;
  onTabSelect: (tab: LibraryTab) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSubmit: () => void;
  onOpen: (app: AppListing) => void;
  onUpvote: (e: React.MouseEvent, appId: string) => void;
  upvotedApps: Set<string>;
  isAuthenticated: boolean;
  isAuthoritativeLive: boolean;
  isLoading: boolean;
  appCount: number;
  leaderboardCount: number;
  onOpenLeaders?: () => void;
}

const LibraryIndex: React.FC<LibraryIndexProps> = ({
  apps, tabs, activeTab, onTabSelect, searchQuery, setSearchQuery,
  onSubmit, onOpen, onUpvote, upvotedApps, isAuthenticated, isAuthoritativeLive,
  isLoading, appCount, leaderboardCount, onOpenLeaders
}) => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden p-2">
      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 font-bold text-blue-900">
          <Flame size={15} className="text-orange-600" />
          <span className="text-sm tracking-wide">WHAT&rsquo;S HOT</span>
          <span className="text-[10px] font-normal text-gray-600 font-mono">· live ranking, browse the source</span>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && appCount === 0 ? (
            <span className="bg-blue-800 text-blue-200 border border-blue-400 px-2 py-0.5 rounded text-[10px] font-mono font-bold animate-pulse">⏳ CONNECTING...</span>
          ) : isAuthoritativeLive ? (
            <span className="bg-emerald-800 text-emerald-200 border border-emerald-400 px-2 py-0.5 rounded text-[10px] font-mono font-bold" title="Live library index">● LIVE ({appCount} apps)</span>
          ) : (
            <span className="bg-red-950 text-red-200 border border-red-500 px-2 py-0.5 rounded text-[10px] font-mono font-bold" title="Disconnected / offline">● OFFLINE / DISCONNECTED</span>
          )}
          <button onClick={onSubmit} className="win95-btn px-2.5 py-1 text-black font-bold flex items-center gap-1 text-[11px] bg-[#dfdfdf] hover:bg-white">
            <Plus size={13} /> Submit app
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-1 flex-wrap items-end">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabSelect(tab.id)}
            className={`win95-btn px-2.5 py-1 flex items-center gap-1 font-bold ${activeTab === tab.id ? 'bg-white text-blue-900 border-2' : 'bg-[#c0c0c0]'}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
        <div className="flex-1 min-w-[180px] win95-field p-1 bg-white flex items-center gap-1.5 border border-gray-600 ml-1">
          <Search size={13} className="text-gray-500 ml-1" />
          <input
            type="text"
            placeholder="Search apps, makers, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs outline-none bg-transparent"
          />
        </div>
      </div>

      <Win95Scroll className="flex-1 win95-field bg-white border border-gray-600">
        <div className="grid grid-cols-[28px_1fr_120px_auto] gap-2 px-3 py-1.5 bg-[#ece9d8] border-b border-gray-400 font-bold text-[10px] text-gray-600 uppercase tracking-wide sticky top-0 z-10">
          <span className="text-right">#</span>
          <span>App · repo</span>
          <span>Maker</span>
          <span className="text-right">Votes</span>
        </div>

        {isLoading && appCount === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-2xl animate-spin">⏳</div>
            <div className="font-bold text-xs text-slate-700">Connecting to the live library index...</div>
          </div>
        ) : apps.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-2xl">📚</div>
            <div className="font-bold text-xs text-slate-700">
              {searchQuery.trim() ? 'No apps found' : isAuthoritativeLive ? 'The library is empty' : 'Library unavailable'}
            </div>
            <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
              {searchQuery.trim()
                ? `Nothing matched "${searchQuery}". Try another maker or tag.`
                : isAuthoritativeLive
                  ? 'Be the first maker to publish source into the library.'
                  : 'Could not reach the live library index. This panel never shows invented apps.'}
            </p>
            {isAuthoritativeLive && !searchQuery.trim() && (
              <button onClick={onSubmit} className="win95-btn px-3 py-1 text-black font-bold flex items-center gap-1 text-xs bg-[#dfdfdf] hover:bg-white mx-auto mt-2">
                <Plus size={13} /> Submit an app
              </button>
            )}
          </div>
        ) : (
          apps.map((app, index) => {
            const isUpvoted = upvotedApps.has(app.id) || Boolean(app.hasVoted);
            const royaltyBps = getRoyaltyBps(app);
            const listingStatus = deriveListingStatus({
              isDemo: app.isDemo,
              hasCanonicalRepo: Boolean(app.hasCanonicalRepo),
              productStatus: app.productStatus,
              isAuthoritativeLive
            });
            const makerHandle = `@${app.author || app.creator || 'maker'}`;
            return (
              <div
                key={app.id}
                onClick={() => onOpen(app)}
                className="grid grid-cols-[28px_1fr_120px_auto] gap-2 px-3 py-2 cursor-pointer border-b border-gray-100 hover:bg-blue-50 items-start"
              >
                <span className="font-bold font-mono text-sm text-[#7a1f00] text-right leading-5">{index + 1}</span>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-[13px] text-blue-900">{app.name}</span>
                    <span className="bg-green-100 text-green-800 font-mono text-[10px] px-1 rounded">{app.version}</span>
                    <span className={`${listingStatus.className} border font-bold font-mono text-xs px-1.5 rounded`}>
                      {listingStatus.label}
                    </span>
                    {royaltyBps > 0 && (
                      <span className="bg-[#e4f0f7] text-[#1c4a6b] border border-[#7ea6c4] font-mono text-[11px] px-1.5 rounded flex items-center gap-0.5" title="Resale royalty — frozen onto every fork">
                        <Snowflake size={9} /> {(royaltyBps / 100).toFixed(1)}%
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-gray-700 mt-0.5 line-clamp-1">{app.tagline}</p>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-1">{listingStatus.sentence}</p>

                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap text-xs">
                    {app.hasCanonicalRepo && app.repoSlug ? (
                      <span className="text-blue-900 font-mono flex items-center gap-1" title={`Canonical repo: ${app.repoSlug}`}>
                        <GitFork size={9} className="text-blue-700 shrink-0" />
                        {app.repoSlug}
                        {app.repoHeadCommitOid && <span className="text-blue-600">· #{app.repoHeadCommitOid.slice(0, 7)}</span>}
                      </span>
                    ) : (
                      <span className="text-gray-500 font-mono">No GITSMITH source</span>
                    )}
                    <span className="text-gray-500 font-mono flex items-center gap-0.5"><GitFork size={10} /> {app.forkCount || 0} forks</span>
                    <span className="text-gray-400 font-mono">|</span>
                    <a
                      href={`/tree/${encodeURIComponent(app.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => { e.stopPropagation(); playClickSound(); }}
                      className="text-green-700 hover:text-green-900 font-mono font-bold flex items-center gap-0.5"
                      title="See the fork lineage for this app"
                    >
                      🌳 lineage →
                    </a>
                  </div>
                </div>

                <div className="flex flex-col justify-start pt-0.5 min-w-0">
                  <span className="font-mono text-xs font-bold text-[#2b5fa8] truncate" title={makerHandle}>
                    {makerHandle}
                  </span>
                  {app.authorAvatar && (
                    <span className="text-[10px] text-gray-500 font-mono">{app.authorAvatar}</span>
                  )}
                </div>

                <button
                  onClick={(e) => onUpvote(e, app.id)}
                  disabled={isUpvoted}
                  className={`win95-btn px-2 py-1 flex flex-col items-center min-w-[46px] transition-all ${isUpvoted ? 'bg-orange-100 border-orange-500 text-orange-900 font-bold opacity-90 cursor-default' : 'bg-[#dfdfdf] hover:bg-white'}`}
                  title={isUpvoted ? 'Already upvoted' : !isAuthenticated ? 'Sign in to upvote' : `Upvote (${app.upvotes})`}
                >
                  <Flame size={13} className={isUpvoted ? 'text-orange-600 fill-orange-600' : 'text-gray-600'} />
                  <span className="font-mono text-xs mt-0.5">{app.upvotes}</span>
                  {isUpvoted && <span className="text-[10px] font-mono text-orange-800 font-bold uppercase">Voted</span>}
                </button>
              </div>
            );
          })
        )}
      </Win95Scroll>

      <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-gray-600 font-mono">
        <span>Buy the source, not a subscription. The preview only proves it runs — you run the real code yourself.</span>
        {onOpenLeaders && (
          <button onClick={() => { playClickSound(); onOpenLeaders(); }} className="text-blue-800 hover:text-blue-950 font-bold flex items-center gap-0.5" title="Verified maker leaderboard">
            <Trophy size={11} className="text-yellow-600" /> Makers ({leaderboardCount}) →
          </button>
        )}
      </div>
    </div>
  );
};

interface InspectorPaneProps {
  app: AppListing;
  inspectTab: InspectTab;
  setInspectTab: (t: InspectTab) => void;
  onOpenPostEditor?: (app?: AppListing) => void;
  isAuthoritativeLive: boolean;
}

const InspectorPane: React.FC<InspectorPaneProps> = ({ app, inspectTab, setInspectTab, onOpenPostEditor, isAuthoritativeLive }) => {
  const price = getPrice(app);
  const platformFee = Math.floor(price * PLATFORM_RATE * 100) / 100;
  const makerKeeps = price - platformFee;
  const royaltyBps = getRoyaltyBps(app);
  const royaltyPct = royaltyBps / 100;
  const canFork = Boolean(app.hasCanonicalRepo && app.repoSlug) && !app.isDemo && isAuthoritativeLive;
  const frozenDate = new Date().toISOString().slice(0, 10);
  const lienId = `${(app.name || 'APP').slice(0, 2).toUpperCase()}-${(app.id || '0000').slice(-4).toUpperCase()}`;

  const inspectTabs: { id: InspectTab; label: string; icon: React.ReactNode; meta?: string }[] = [
    { id: 'code', label: 'Code', icon: <FileCode size={12} /> },
    { id: 'readme', label: 'README', icon: <FileText size={12} /> },
    { id: 'preview', label: 'See it run', icon: <Play size={12} />, meta: '(preview)' },
    { id: 'lineage', label: 'Lineage', icon: <span>🌳</span> }
  ];

  return (
    <div className="flex-1 flex overflow-hidden p-2 gap-2">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-start gap-2.5 mb-2 px-1">
          <div className="w-11 h-11 shrink-0 grid place-items-center text-2xl bg-white win95-field border border-gray-500">
            {app.authorAvatar || '📦'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-base text-blue-900 leading-tight">{app.name}</h2>
              <span className="bg-green-100 text-green-800 font-mono text-[10px] px-1 rounded">{app.version}</span>
            </div>
            <div className="text-[11px] text-[#2b5fa8]">by @{app.author || app.creator || 'maker'} · you&rsquo;re buying the source, not a subscription</div>
            <p className="text-[11px] text-gray-700 mt-0.5 line-clamp-2">{app.tagline}</p>
          </div>
        </div>

        <div className="flex gap-0.5 px-1">
          {inspectTabs.map(t => (
            <button
              key={t.id}
              onClick={() => { playClickSound(); setInspectTab(t.id); }}
              className={`px-3 py-1 flex items-center gap-1 text-[11px] border-2 border-b-0 rounded-t ${inspectTab === t.id ? 'bg-[#fbfbf8] font-bold text-black border-gray-500' : 'bg-[#dfe1e5] text-gray-600 border-gray-400'}`}
            >
              {t.icon} {t.label}
              {t.meta && <span className="text-gray-500 font-normal text-[10px]">{t.meta}</span>}
            </button>
          ))}
        </div>

        <div className="flex-1 win95-field bg-[#fbfbf8] border border-gray-600 overflow-hidden flex flex-col min-h-0">
          {inspectTab === 'preview' ? (
            <ArtifactSandbox app={app} onOpenPostEditor={onOpenPostEditor} />
          ) : inspectTab === 'code' ? (
            <CodeInspector app={app} />
          ) : inspectTab === 'readme' ? (
            <Win95Scroll className="flex-1 p-4 text-[12px] leading-relaxed text-gray-800 bg-white">
              <h3 className="font-bold text-sm mb-1 font-mono"># {librarySlug(app)}</h3>
              <p className="text-gray-500 font-mono text-[11px] mb-3">{app.version} · main</p>
              <p className="mb-3">{app.description || app.tagline}</p>
              {app.makerPitch && <p className="mb-3 italic text-gray-600">{app.makerPitch}</p>}
              <p className="font-bold mt-3 mb-1">Tags</p>
              <div className="flex flex-wrap gap-1">
                {(app.tags || []).map(t => (
                  <span key={t} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-300 font-mono text-[10px]">{t}</span>
                ))}
              </div>
              <p className="text-[10px] text-[#7a4a00] bg-[#fbf3df] border border-gray-400 p-2 mt-4">
                This README ships with the source. The <b>See it run</b> tab is a preview to confirm the code works on real
                data — the product is the source itself, which you run yourself.
              </p>
            </Win95Scroll>
          ) : (
            <Win95Scroll className="flex-1 p-4 bg-white text-[12px] text-gray-800">
              <div className="font-bold mb-2 flex items-center gap-1"><span>🌳</span> Fork lineage</div>
              <p className="text-gray-600 mb-3">
                {app.forkCount || 0} fork{app.forkCount === 1 ? '' : 's'} descend from this app. Every fork carries the frozen
                royalty liens of its ancestors — a maker up the chain can never be zeroed out downstream.
              </p>
              <a
                href={`/tree/${encodeURIComponent(app.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => playClickSound()}
                className="win95-btn inline-flex items-center gap-1 px-3 py-1 font-bold bg-[#dfdfdf] hover:bg-white text-black"
              >
                <ExternalLink size={12} /> Open full lineage tree
              </a>
            </Win95Scroll>
          )}

          <div className="text-[10px] text-[#7a4a00] bg-[#fbf3df] border-t border-gray-400 px-2 py-1.5">
            ▶ <b>See it run</b> is a preview to confirm it works on real data — the product is the source, which you run yourself. It might not run in your setup.
          </div>
        </div>
      </div>

      <div className="w-[260px] shrink-0 flex flex-col gap-2 min-h-0">
        <div className="win95-field bg-white border border-gray-600">
          <div className="bg-[#c0c0c0] font-bold text-[11px] px-2 py-1 border-b border-gray-500">Own it</div>
          <div className="p-3">
            <div className="font-bold text-[26px] text-[#0a5a0a] leading-none">{money(price)}</div>
            <div className="text-[11px] text-gray-600 mt-0.5">Buy once · own the source forever</div>
            <button
              disabled={!canFork}
              onClick={() => playClickSound()}
              className={`win95-btn w-full mt-2.5 py-1.5 font-bold flex flex-col items-center ${canFork ? 'bg-[#0a7d2a] text-white hover:brightness-110' : 'bg-[#dfdfdf] text-gray-400 cursor-not-allowed'}`}
              title={canFork ? 'Buy the source and license key' : 'Source not published to the forge yet'}
            >
              <span>Buy source</span>
              <span className="text-[11px] font-normal">get the repo + license key</span>
            </button>
            <button
              disabled={!canFork}
              onClick={() => playClickSound()}
              className={`win95-btn w-full mt-1.5 py-1.5 font-bold flex flex-col items-center ${canFork ? 'bg-[#dfdfdf] text-black hover:bg-white' : 'bg-[#dfdfdf] text-gray-400 cursor-not-allowed'}`}
              title={canFork ? 'Fork it, remix, and sell your version' : 'Source not published to the forge yet'}
            >
              <span className="flex items-center gap-1"><GitFork size={12} /> Fork &amp; resell</span>
              <span className="text-[11px] font-normal">remix it, sell your version</span>
            </button>
            {!canFork && (
              <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-300 p-1.5 mt-2">
                {app.isDemo ? 'Demo listing — no source published yet.' : !isAuthoritativeLive ? 'Offline — reconnect to buy or fork.' : 'This app hasn’t published source to the forge yet, so it can’t be bought or forked.'}
              </p>
            )}
          </div>
        </div>

        <div className="win95-field bg-white border border-gray-600">
          <div className="bg-[#c0c0c0] font-bold text-[11px] px-2 py-1 border-b border-gray-500">Where your {money(price)} goes</div>
          <div className="p-3 text-[11px]">
            <div className="flex justify-between py-0.5 border-b border-dotted border-gray-300">
              <span>Maker @{app.author || app.creator || 'maker'}</span>
              <span className="font-bold text-[#0a5a0a]">{money(makerKeeps)}</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-dotted border-gray-300">
              <span>Platform fee (flat 10%)</span>
              <span className="font-bold">{money(platformFee)}</span>
            </div>
            <div className="flex justify-between pt-1 mt-1 border-t border-gray-500 font-bold">
              <span>You pay</span>
              <span>{money(price)}</span>
            </div>

            <div className="bg-[#e4f0f7] border border-[#7ea6c4] text-[#1c4a6b] mt-2.5 p-2">
              <div className="font-bold flex items-center gap-1 text-[11px]">
                <Snowflake size={12} /> Frozen royalty (if you fork &amp; resell)
              </div>
              {royaltyBps > 0 ? (
                <>
                  <div className="text-[10px] mt-1 leading-snug">
                    Fork today and @{app.author || app.creator || 'maker'}&rsquo;s royalty locks at the rate below — <b>never raised, never revoked</b>, for the life of your fork.
                  </div>
                  <div className="font-mono text-[10px] mt-1.5 bg-white border border-[#7ea6c4] px-1.5 py-1">
                    RATE {royaltyPct.toFixed(1)}% · FROZEN {frozenDate} · lien #{lienId}
                  </div>
                  <div className="text-[10px] mt-1.5 leading-snug">
                    <b>When your fork sells:</b> platform 10% · @{app.author || app.creator || 'maker'} {royaltyPct.toFixed(1)}% (frozen) · <b>you keep the rest</b>. Forks of your fork pay everyone up the chain.
                  </div>
                </>
              ) : (
                <div className="text-[10px] mt-1 leading-snug">
                  This app is <b>free to fork and resell</b> (0% royalty). Platform still takes a flat 10% on any sale; you keep the rest.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CodeInspector: React.FC<{ app: AppListing }> = ({ app }) => {
  const files = useMemo(() => {
    const base = ['README.md', 'package.json', 'LICENSE'];
    const src = ['src/index.ts', 'src/app.ts'];
    return { src, base };
  }, [app.id]);
  const [selectedFile, setSelectedFile] = useState<string>('src/index.ts');

  return (
    <div className="flex-1 flex min-h-0">
      <Win95Scroll className="w-[150px] shrink-0 bg-white border-r border-gray-500 py-1">
        <div className="px-2 py-0.5 font-bold text-[11px] flex items-center gap-1">📂 src</div>
        {files.src.map(f => (
          <div
            key={f}
            onClick={() => { playClickSound(); setSelectedFile(f); }}
            className={`pl-5 pr-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1 ${selectedFile === f ? 'bg-[#000080] text-white' : 'hover:bg-blue-50'}`}
          >
            📄 {f.split('/').pop()}
          </div>
        ))}
        {files.base.map(f => (
          <div
            key={f}
            onClick={() => { playClickSound(); setSelectedFile(f); }}
            className={`px-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1 ${selectedFile === f ? 'bg-[#000080] text-white' : 'hover:bg-blue-50'}`}
          >
            📄 {f}
          </div>
        ))}
      </Win95Scroll>

      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <div className="font-mono text-[10px] text-gray-600 px-2 py-1 bg-[#eef0f2] border-b border-gray-500 flex justify-between">
          <span>{selectedFile}</span>
          <span>{app.hasCanonicalRepo ? 'from canonical repo' : 'not on forge'}</span>
        </div>
        <Win95Scroll className="flex-1 p-3 font-mono text-[11px] leading-relaxed text-gray-800">
          {app.hasCanonicalRepo && app.repoSlug ? (
            <pre className="whitespace-pre-wrap">{`${selectedFile}
${librarySlug(app)} · ${app.version}

The real file tree and source stream from the canonical
repo (${app.repoSlug}${app.repoHeadCommitOid ? ` @ ${app.repoHeadCommitOid.slice(0, 7)}` : ''}).

Buying gives you this repository plus a license key. You run
it yourself — this library page is where you read the code
before you decide to buy or fork.`}</pre>
          ) : (
            <div className="text-gray-500">
              <p className="font-bold mb-2">Source not on the forge yet.</p>
              <p>{app.name} hasn&rsquo;t published its repository to GITSMITH, so there&rsquo;s no code to browse and it can&rsquo;t be bought or forked until it does.</p>
            </div>
          )}
        </Win95Scroll>
      </div>
    </div>
  );
};
