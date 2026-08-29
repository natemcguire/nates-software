import React, { useState, useEffect, useCallback } from 'react';
import {
  User, Key, HardDrive, MessageSquare, Check, Sparkles,
  DollarSign, RefreshCw, AlertTriangle,
  LogIn, UserPlus, ShieldCheck, Search, ArrowLeft
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import {
  validateMakerProfile,
  formatCentsToUsd,
  ShelfItem,
  LineageBreakdownItem
} from '../lib/profileDomain';

interface ProfileViewProps {
  initialUsername?: string;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ initialUsername }) => {
  const { isAuthenticated, openAuthModal } = useAuth();

  // Navigation & Target User State
  const [activeTab, setActiveTab] = useState<'shelf' | 'royalties' | 'profile' | 'published' | 'activity'>('shelf');
  const [viewingUsername, setViewingUsername] = useState<string | null>(initialUsername || null);
  const [searchHandleInput, setSearchHandleInput] = useState('');

  // Live Data States
  const [isLoading, setIsLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'guest'>('syncing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  // Profile Form & Details
  const [profileData, setProfileData] = useState({
    id: '',
    username: '',
    displayName: '',
    avatar: '📦',
    bio: '',
    sshKey: '',
    stripeAccountId: null as string | null,
    stripeStatus: 'not_connected',
    payoutsEnabled: false,
    isVerified: false,
    role: 'user',
    createdAt: ''
  });

  // Shelf, Published Apps, & Royalties
  const [shelfApps, setShelfApps] = useState<ShelfItem[]>([]);
  const [publishedApps, setPublishedApps] = useState<any[]>([]);
  const [royalties, setRoyalties] = useState({
    makerBalanceCents: 0,
    makerSalesCents: 0,
    lineageEarnedCents: 0,
    lineageBreakdown: [] as LineageBreakdownItem[]
  });

  // Action Feedback States
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load Profile & Shelf Data
  const loadProfileAndShelf = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSyncStatus('syncing');

    // If not authenticated and no specific user requested, set guest state
    if (!isAuthenticated && !viewingUsername) {
      setSyncStatus('guest');
      setIsLoading(false);
      return;
    }

    try {
      const targetParam = viewingUsername ? `?username=${encodeURIComponent(viewingUsername)}` : '';
      const profileRes = await fetch(`/api/profile${targetParam}`);
      const profileJson = await profileRes.json();

      if (!profileRes.ok || !profileJson.success) {
        throw new Error(profileJson.error || `Failed to load profile (HTTP ${profileRes.status})`);
      }

      setIsOwner(Boolean(profileJson.isOwner));
      const u = profileJson.user || {};
      setProfileData({
        id: u.id || '',
        username: u.username || '',
        displayName: u.displayName || u.username || 'Anonymous Maker',
        avatar: u.avatar || '📦',
        bio: u.bio || '',
        sshKey: u.sshKey || '',
        stripeAccountId: u.stripeAccountId || null,
        stripeStatus: u.stripeStatus || 'not_connected',
        payoutsEnabled: Boolean(u.payoutsEnabled),
        isVerified: Boolean(u.isVerified),
        role: u.role || 'user',
        createdAt: u.createdAt || ''
      });

      setPublishedApps(profileJson.publishedApps || []);
      if (profileJson.royalties) {
        setRoyalties({
          makerBalanceCents: Number(profileJson.royalties.makerBalanceCents) || 0,
          makerSalesCents: Number(profileJson.royalties.makerSalesCents) || 0,
          lineageEarnedCents: Number(profileJson.royalties.lineageEarnedCents) || 0,
          lineageBreakdown: profileJson.royalties.lineageBreakdown || []
        });
      }

      // If viewing own profile and authenticated, fetch authoritative shelf
      if (profileJson.isOwner && isAuthenticated) {
        const shelfRes = await fetch('/api/shelf');
        const shelfJson = await shelfRes.json();
        if (!shelfRes.ok || !shelfJson.success) {
          throw new Error(shelfJson.error || `Failed to load shelf (HTTP ${shelfRes.status})`);
        }
        if (Array.isArray(shelfJson.shelf)) {
          setShelfApps(shelfJson.shelf);
        }
      } else {
        setShelfApps([]);
      }

      setSyncStatus('synced');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load profile data');
      setSyncStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, viewingUsername]);

  useEffect(() => {
    loadProfileAndShelf();
  }, [loadProfileAndShelf]);

  // Handle Save Profile Changes
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);

    // Client-side domain validation
    const validation = validateMakerProfile({
      displayName: profileData.displayName,
      avatar: profileData.avatar,
      bio: profileData.bio,
      sshKey: profileData.sshKey
    });

    if (!validation.valid) {
      setSaveError(validation.errors.join(' '));
      return;
    }

    try {
      setIsSaving(true);
      playClickSound();

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: profileData.displayName,
          avatar: profileData.avatar,
          bio: profileData.bio,
          sshKey: profileData.sshKey
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Profile save failed (${res.status})`);
      }

      if (data.user) {
        setProfileData((current) => ({
          ...current,
          displayName: data.user.displayName ?? current.displayName,
          avatar: data.user.avatar ?? current.avatar,
          bio: data.user.bio ?? current.bio,
          sshKey: data.user.sshKey ?? current.sshKey
        }));
      }

      playSuccessChime();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save profile changes');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Public Maker Search
  const handleSearchMaker = (e: React.FormEvent) => {
    e.preventDefault();
    const handle = searchHandleInput.trim().replace(/^@/, '');
    if (handle) {
      playClickSound();
      setViewingUsername(handle);
      setActiveTab('published');
    }
  };

  // Unauthenticated / Guest Prompt View
  if (!isAuthenticated && !viewingUsername) {
    return (
      <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-sm select-none">
        <div className="bg-gradient-to-r from-w95-blue via-blue-900 to-w95-blue text-white p-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="text-3xl bg-white p-1 rounded border border-gray-400 text-black">👤</div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base">Guest Session</span>
                <span className="bg-amber-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded font-mono">
                  ● NOT SIGNED IN
                </span>
              </div>
              <p className="text-blue-100 text-xs mt-0.5">Authenticate to manage your personal shelf, GITSMITH SSH keys, and lineage royalties.</p>
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white border-2 border-gray-800 p-6 overflow-y-auto flex flex-col items-center justify-center text-center">
          <div className="max-w-md w-full bg-gray-50 border-2 border-gray-400 p-6 rounded shadow-sm space-y-5">
            <div className="w-16 h-16 bg-blue-100 border-2 border-w95-blue rounded-full flex items-center justify-center mx-auto text-w95-blue">
              <ShieldCheck size={32} />
            </div>

            <div>
              <h2 className="text-base font-bold text-gray-900">Session Authentication Required</h2>
              <p className="text-gray-600 text-xs mt-1.5 leading-relaxed">
                Your software shelf, verified license keys, and maker economics are securely bound to your authenticated session.
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => openAuthModal('login')}
                className="btn-w95 btn-w95-primary px-5 py-2 text-xs font-bold flex items-center gap-1.5"
              >
                <LogIn size={14} />
                <span>Log In</span>
              </button>
              <button
                onClick={() => openAuthModal('register')}
                className="btn-w95 px-5 py-2 text-xs font-bold flex items-center gap-1.5"
              >
                <UserPlus size={14} />
                <span>Create Account</span>
              </button>
            </div>

            <div className="border-t border-gray-300 pt-4 mt-4">
              <span className="text-xs text-gray-500 font-bold block mb-2">Or Lookup a Public Maker Profile:</span>
              <form onSubmit={handleSearchMaker} className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. nate, sam, josh"
                  value={searchHandleInput}
                  onChange={(e) => setSearchHandleInput(e.target.value)}
                  className="flex-1 p-1.5 border border-gray-400 text-xs font-mono"
                />
                <button type="submit" className="btn-w95 px-3 py-1.5 text-xs font-bold flex items-center gap-1">
                  <Search size={12} />
                  <span>Lookup</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-sm select-none">
      {/* Header Navigation */}
      <div className="bg-gradient-to-r from-w95-blue via-blue-900 to-w95-blue text-white p-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {viewingUsername && isAuthenticated && (
            <button
              onClick={() => { playClickSound(); setViewingUsername(null); setActiveTab('shelf'); }}
              className="btn-w95 text-xs px-2 py-1 flex items-center gap-1 text-black font-bold mr-1"
              title="Return to your authenticated profile"
            >
              <ArrowLeft size={12} /> My Profile
            </button>
          )}
          <div className="text-3xl bg-white p-1 rounded border border-gray-400 text-black">{profileData.avatar}</div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base">{profileData.displayName}</span>
              <span className="bg-blue-800 text-blue-200 text-xs px-2 py-0.5 rounded font-mono">@{profileData.username}</span>
              {profileData.isVerified && (
                <span className="bg-amber-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded font-mono flex items-center gap-0.5">
                  <ShieldCheck size={10} /> VERIFIED
                </span>
              )}
              <span className={`text-white text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                syncStatus === 'synced' ? 'bg-green-600' :
                syncStatus === 'syncing' ? 'bg-blue-500' :
                syncStatus === 'guest' ? 'bg-amber-600' : 'bg-red-600'
              }`}>
                {syncStatus === 'synced' ? '● D1 SYNCED' :
                 syncStatus === 'syncing' ? '● SYNCING...' :
                 syncStatus === 'guest' ? '● PUBLIC VIEW' : '● SYNC FAILED'}
              </span>
            </div>
            <p className="text-blue-100 text-xs mt-0.5 max-w-xl line-clamp-1">{profileData.bio || 'Maker on Nate\'s Software 95.'}</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 flex-wrap">
          {isOwner && (
            <button
              onClick={() => { playClickSound(); setActiveTab('shelf'); }}
              className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'shelf' ? 'btn-w95-primary' : 'text-black'}`}
            >
              <HardDrive size={13} /> My Shelf ({shelfApps.length})
            </button>
          )}
          <button
            onClick={() => { playClickSound(); setActiveTab('published'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'published' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <Sparkles size={13} /> Published Apps ({publishedApps.length})
          </button>
          {isOwner && (
            <button
              onClick={() => { playClickSound(); setActiveTab('royalties'); }}
              className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'royalties' ? 'btn-w95-primary' : 'text-black'}`}
            >
              <DollarSign size={13} /> Royalties ({formatCentsToUsd(royalties.makerBalanceCents)})
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => { playClickSound(); setActiveTab('profile'); }}
              className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'profile' ? 'btn-w95-primary' : 'text-black'}`}
            >
              <User size={13} /> Settings &amp; SSH
            </button>
          )}
          <button
            onClick={() => { playClickSound(); setActiveTab('activity'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'activity' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <MessageSquare size={13} /> Activity
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-white border-2 border-gray-800 p-4 overflow-y-auto">
        {/* Error Banner */}
        {errorMessage && (
          <div className="mb-4 bg-red-50 border-2 border-red-500 p-3 rounded text-red-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={loadProfileAndShelf}
              className="btn-w95 text-xs px-2.5 py-1 flex items-center gap-1 font-bold shrink-0"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        {/* Loading Spinner */}
        {isLoading && (
          <div className="p-8 text-center text-gray-500 font-mono text-xs flex items-center justify-center gap-2">
            <RefreshCw size={14} className="animate-spin text-w95-blue" />
            <span>Loading authoritative profile &amp; shelf records from D1...</span>
          </div>
        )}

        {/* TAB 1: My Shelf (Private to owner) */}
        {!isLoading && activeTab === 'shelf' && isOwner && (
          <div className="space-y-3 max-w-4xl mx-auto">
            <div className="border-b pb-2 mb-2 flex justify-between items-center">
              <div>
                <span className="font-bold text-base text-w95-blue">My Software Shelf &amp; App Data</span>
                <p className="text-gray-600 text-xs">Owned shareware titles with launch endpoints, Git forge repositories, and safe license metadata.</p>
              </div>
              <span className="bg-blue-100 text-w95-blue text-xs font-bold px-2 py-1 rounded">
                {shelfApps.length} Owned {shelfApps.length === 1 ? 'Application' : 'Applications'}
              </span>
            </div>

            {shelfApps.length === 0 ? (
              <div className="bg-gray-50 border-2 border-dashed border-gray-300 p-8 rounded text-center space-y-2">
                <HardDrive size={32} className="mx-auto text-gray-400" />
                <p className="font-bold text-gray-700 text-sm">Your Software Shelf is Empty</p>
                <p className="text-gray-500 text-xs max-w-sm mx-auto">
                  Acquire apps from the 12:01 AM Daily Drops or HOTWIRE feed to register authoritative licenses on your shelf.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {shelfApps.map((app) => {
                  return (
                    <div key={app.id} className="border-2 border-gray-700 bg-gray-50 p-3 rounded flex items-center justify-between gap-3 shadow-sm hover:bg-blue-50/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl bg-white p-1 rounded border border-gray-400">{app.creatorAvatar || '📦'}</span>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-gray-900">{app.name}</span>
                            <span className="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-green-300 font-mono">
                              {app.version}
                            </span>
                            <span className="text-gray-600 text-xs font-mono bg-gray-200 px-1.5 py-0.5 rounded border border-gray-300">
                              License: {app.maskedKey}
                            </span>
                          </div>
                          <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">{app.tagline}</p>
                          <div className="text-[11px] text-gray-500 font-mono mt-1 flex items-center gap-2 flex-wrap">
                            <span>Acquired: {app.purchasedDate ? new Date(app.purchasedDate).toLocaleDateString() : 'Active'}</span>
                            <span>&middot;</span>
                            <span>Storage: {app.storage || 'Not specified by maker'}</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-[11px] text-gray-500 max-w-48 text-right">
                        Verified install and export links will appear when the maker publishes them.
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Published Apps & Live Drops */}
        {!isLoading && activeTab === 'published' && (
          <div className="space-y-3 max-w-4xl mx-auto">
            <div className="border-b pb-2 mb-2 flex justify-between items-center">
              <div>
                <span className="font-bold text-base text-w95-blue">Published Shareware &amp; Drops</span>
                <p className="text-gray-600 text-xs">Software titles created by @{profileData.username} and deployed to the daily registry.</p>
              </div>
              <span className="bg-blue-100 text-w95-blue text-xs font-bold px-2 py-1 rounded">
                {publishedApps.length} Published
              </span>
            </div>

            {publishedApps.length === 0 ? (
              <div className="bg-gray-50 border-2 border-dashed border-gray-300 p-8 rounded text-center space-y-2">
                <Sparkles size={32} className="mx-auto text-gray-400" />
                <p className="font-bold text-gray-700 text-sm">No Published Applications Yet</p>
                <p className="text-gray-500 text-xs max-w-sm mx-auto">
                  {isOwner
                    ? 'Use GITSMITH to push your code and publish your first release to the 12:01 AM Daily Drops board.'
                    : `@${profileData.username} has not published any public applications yet.`}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {publishedApps.map((app) => (
                  <div key={app.id} className="border-2 border-gray-700 bg-blue-50/60 p-3 rounded flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl bg-white p-1 rounded border border-gray-400">{profileData.avatar}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-w95-blue">{app.name}</span>
                          <span className="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-green-300 font-mono">
                            {app.version}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">{app.upvotes || 0} upvotes &middot; {app.forks || 0} downstream forks</div>
                        <div className="text-[11px] text-gray-500 font-mono mt-1">App ID: {app.id}</div>
                      </div>
                    </div>

                    <span className="text-[11px] text-gray-500">Release links are shown only after verified publication.</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Lineage Royalties (Private to owner) */}
        {!isLoading && activeTab === 'royalties' && isOwner && (
          <div className="space-y-4 max-w-4xl mx-auto font-tahoma">
            <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 text-white p-4 rounded-lg border-2 border-emerald-700 shadow-lg flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1.5 uppercase tracking-wider">
                  <Sparkles size={13} className="text-amber-400" />
                  <span>Lifetime Allocations · 70/20/10 Lineage Protocol</span>
                </div>
                <div className="text-3xl font-bold font-mono text-white mt-1">
                  {formatCentsToUsd(royalties.makerBalanceCents)} <span className="text-xs text-emerald-400 font-normal">USD</span>
                </div>
                <div className="text-xs text-slate-300 mt-0.5">
                  {formatCentsToUsd(royalties.makerSalesCents)} Maker Sales (70%) · {formatCentsToUsd(royalties.lineageEarnedCents)} Ancestor Lineage (20%)
                </div>
              </div>

              <div className="flex flex-col gap-2 items-end">
                <div className="text-[10px] font-mono text-emerald-300 text-right">
                  Stripe Express: {profileData.stripeAccountId ? `${profileData.stripeAccountId.slice(0, 16)}... (${profileData.stripeStatus})` : 'Not Connected'}
                </div>
              </div>
            </div>

            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-3">
              <div className="font-bold text-gray-900 text-xs flex items-center justify-between border-b border-gray-200 pb-2">
                <span>Active Shareware Lineage Breakdown</span>
                <span className="text-[10px] font-mono text-gray-500">Recorded from fulfilled-order allocations</span>
              </div>

              {royalties.lineageBreakdown.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-xs space-y-1">
                  <p className="font-bold">No Active Lineage Allocations</p>
                  <p>When users buy your software or downstream forks of your apps, 70% maker and 20% lineage splits appear here.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {royalties.lineageBreakdown.map((item, idx) => (
                    <div key={idx} className="bg-gray-50 p-2.5 rounded border border-gray-200 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-blue-900">{item.name}</div>
                        <div className="text-[10px] text-gray-500 font-mono">{item.slug}</div>
                      </div>
                      <div className="text-right font-mono">
                        <div className="font-bold text-green-800">{formatCentsToUsd(item.totalCents)}</div>
                        <div className="text-[10px] text-gray-500">
                          {formatCentsToUsd(item.directEarnedCents)} maker / {formatCentsToUsd(item.lineageEarnedCents)} lineage
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: Account Settings (Private to owner) */}
        {!isLoading && activeTab === 'profile' && isOwner && (
          <form onSubmit={handleSaveProfile} className="max-w-2xl mx-auto space-y-3">
            <div className="border-b pb-2 mb-3">
              <span className="font-bold text-base text-w95-blue">Maker Identity &amp; Git Credentials</span>
              <p className="text-gray-600 text-xs">Manage your display name, avatar, bio, and SSH keys used for GITSMITH forge authorization.</p>
            </div>

            {saveError && (
              <div className="bg-red-50 border border-red-500 p-2.5 rounded text-red-800 text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-gray-800 block mb-1 text-xs">Username (Handle):</label>
                <div className="flex items-center">
                  <span className="bg-gray-200 border border-r-0 border-gray-400 px-2 py-1.5 text-xs text-gray-600 font-mono">@</span>
                  <input
                    type="text"
                    disabled
                    value={profileData.username}
                    className="flex-1 p-1.5 border border-gray-400 font-bold text-xs bg-gray-100 text-gray-700 cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-gray-800 block mb-1 text-xs">Display Name:</label>
                <input
                  type="text"
                  value={profileData.displayName}
                  onChange={(e) => setProfileData({ ...profileData, displayName: e.target.value })}
                  className="w-full p-1.5 border border-gray-400 text-xs font-bold"
                  placeholder="e.g. Nate McGuire"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-gray-800 block mb-1 text-xs">Avatar (Emoji or Icon):</label>
                <input
                  type="text"
                  value={profileData.avatar}
                  onChange={(e) => setProfileData({ ...profileData, avatar: e.target.value })}
                  className="w-full p-1.5 border border-gray-400 text-sm"
                  placeholder="e.g. ⚡, 👨‍💻, ⛵"
                />
              </div>

              <div>
                <label className="font-bold text-gray-800 block mb-1 text-xs">Stripe Payouts (70% Maker / 20% Lineage):</label>
                <div className="bg-green-50 border border-green-300 p-1.5 rounded flex items-center justify-between text-xs text-green-900">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold font-mono text-[11px]">
                      {profileData.stripeAccountId ? `Connected (${profileData.stripeAccountId.slice(0, 12)}...)` : 'Not Connected'}
                    </span>
                    <span className={`text-white text-[10px] px-1.5 py-0.2 rounded font-mono ${
                      profileData.payoutsEnabled ? 'bg-green-600' : 'bg-amber-600'
                    }`}>
                      {profileData.payoutsEnabled ? 'Active' : profileData.stripeAccountId ? 'Pending' : 'Unset'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1 text-xs">Public Bio:</label>
              <textarea
                rows={2}
                value={profileData.bio}
                onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })}
                className="w-full p-2 border border-gray-400 text-xs resize-none"
                placeholder="Share what kind of shareware tools you build..."
              />
            </div>

            <div>
              <label className="font-bold text-gray-800 block mb-1 text-xs flex items-center gap-1.5">
                <Key size={13} className="text-purple-700" /> GITSMITH SSH Public Key:
              </label>
              <input
                type="text"
                value={profileData.sshKey}
                onChange={(e) => setProfileData({ ...profileData, sshKey: e.target.value })}
                className="w-full p-2 border border-gray-400 font-mono text-xs bg-gray-50"
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... user@machine"
              />
              <p className="text-gray-500 text-[11px] mt-1">Allows passwordless git push to <code className="font-mono bg-gray-200 px-1">git@gitsmith.dev:{profileData.username}/...</code></p>
            </div>

            <div className="pt-3 border-t border-gray-300 flex justify-between items-center">
              {saveSuccess ? (
                <span className="text-green-700 font-bold text-xs flex items-center gap-1">
                  <Check size={14} /> Profile settings saved to Cloudflare D1!
                </span>
              ) : <div />}

              <button
                type="submit"
                disabled={isSaving}
                className="btn-w95 btn-w95-primary px-5 py-1.5 text-xs font-bold"
              >
                {isSaving ? 'Saving Changes...' : 'Save Profile Changes'}
              </button>
            </div>
          </form>
        )}

        {/* TAB 5: Activity */}
        {!isLoading && activeTab === 'activity' && (
          <div className="space-y-3 max-w-3xl mx-auto">
            <div className="border-b pb-2 mb-2">
              <span className="font-bold text-base text-w95-blue">Maker Discussions &amp; Activity</span>
              <p className="text-gray-600 text-xs">Recent discussions, maker notes, and replies on 12:01 AM Daily Drops for @{profileData.username}.</p>
            </div>

            <div className="bg-gray-50 border-2 border-dashed border-gray-300 p-8 rounded text-center space-y-2">
              <MessageSquare size={32} className="mx-auto text-gray-400" />
              <p className="font-bold text-gray-700 text-sm">No Recent Maker Discussions</p>
              <p className="text-gray-500 text-xs max-w-sm mx-auto">
                Participate in Daily Drop threads and comments to build maker reputation across the protocol.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
