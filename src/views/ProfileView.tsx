import React, { useState, useEffect, useCallback } from 'react';
import {
  User, Key, HardDrive, Check, Sparkles,
  DollarSign, RefreshCw, AlertTriangle, ExternalLink, Download,
  LogIn, UserPlus, ShieldCheck, Search, ArrowLeft, Terminal, Copy, GitBranch, Edit3
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import { Win95Scroll } from '../components/Win95Scroll';
import { DollarBillReceipt } from '../components/DollarBillReceipt';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import {
  validateMakerProfile,
  formatCentsToUsd,
  ShelfItem,
  LineageBreakdownItem,
  publishedArtifactLinks
} from '../lib/profileDomain';

interface ProfileViewProps {
  initialUsername?: string;
  onOpenHotwire?: () => void;
  onOpenGitsmith?: (repoSlug?: string) => void;
  onOpenPostEditor?: (app?: any) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  initialUsername,
  onOpenHotwire,
  onOpenGitsmith,
  onOpenPostEditor
}) => {
  const { isAuthenticated, openAuthModal } = useAuth();
  const { showToast } = useAlert();

  const [activeTab, setActiveTab] = useState<'shelf' | 'royalties' | 'profile' | 'published'>('shelf');
  const [viewingUsername, setViewingUsername] = useState<string | null>(initialUsername || null);
  const [searchHandleInput, setSearchHandleInput] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'guest'>('syncing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

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

  const [shelfApps, setShelfApps] = useState<ShelfItem[]>([]);

  const groupedShelfApps = React.useMemo(() => {
    const map = new Map<string, { app: ShelfItem; count: number }>();
    for (const item of shelfApps) {
      const key = item.appId || item.id;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { app: item, count: 1 });
      } else {
        existing.count += 1;
        if (item.purchasedDate && (!existing.app.purchasedDate || new Date(item.purchasedDate) > new Date(existing.app.purchasedDate))) {
          existing.app = item;
        }
      }
    }
    return Array.from(map.values());
  }, [shelfApps]);

  const [publishedApps, setPublishedApps] = useState<any[]>([]);
  const [royalties, setRoyalties] = useState({
    makerBalanceCents: 0,
    makerSalesCents: 0,
    lineageEarnedCents: 0,
    lineageBreakdown: [] as LineageBreakdownItem[],
    grossSalesCents: 0,
    platformFeesCents: 0,
    upstreamRoyaltiesPaidCents: 0,
    netEarningsCents: 0,
    availableForPayoutCents: 0,
    pendingPayoutCents: 0,
    paidOutCents: 0
  });
  const [sellerOrders, setSellerOrders] = useState<any[]>([]);
  const [isLedgerLoading, setIsLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  interface ContributorGrant {
    id: string;
    repositoryId: string;
    appId: string;
    basisPoints: number;
    status: 'pending' | 'active' | 'revoked';
    createdAt: string;
    activatedAt: string | null;
  }
  interface EarningsByRole {
    role: string;
    count: number;
    totalCents: number;
  }
  interface PayoutByStatus {
    status: string;
    count: number;
    totalCents: number;
  }
  const [grants, setGrants] = useState<ContributorGrant[]>([]);
  const [earningsByRole, setEarningsByRole] = useState<EarningsByRole[]>([]);
  const [payoutsByStatus, setPayoutsByStatus] = useState<PayoutByStatus[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);

  const loadGrants = useCallback(async () => {
    setGrantsLoading(true);
    setGrantsError(null);
    try {
      const res = await fetch('/api/payments/grants');
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Failed to load grants (HTTP ${res.status})`);
      }
      setGrants(Array.isArray(json.grants) ? json.grants : []);
      setEarningsByRole(Array.isArray(json.earningsByRole) ? json.earningsByRole : []);
      setPayoutsByStatus(Array.isArray(json.payouts?.byStatus) ? json.payouts.byStatus : []);
    } catch (err: any) {
      setGrantsError(err.message || 'Failed to load revenue grants');
    } finally {
      setGrantsLoading(false);
    }
  }, []);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [cliToken, setCliToken] = useState<string | null>(null);
  const [isGeneratingCliToken, setIsGeneratingCliToken] = useState(false);
  const [cliTokenError, setCliTokenError] = useState<string | null>(null);
  const [cliTokenCopied, setCliTokenCopied] = useState(false);
  const handleGenerateCliToken = async () => {
    setCliTokenError(null);
    setIsGeneratingCliToken(true);
    playClickSound();
    try {
      const res = await fetch('/api/auth?action=create-cli-token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to generate CLI token (${res.status})`);
      }
      setCliToken(data.token);
      playSuccessChime();
    } catch (err: any) {
      setCliTokenError(err.message || 'Failed to generate CLI token');
    } finally {
      setIsGeneratingCliToken(false);
    }
  };

  const [isConnectingStripe, setIsConnectingStripe] = useState(false);

  const handleConnectStripe = async () => {
    playClickSound();
    setIsConnectingStripe(true);
    try {
      const res = await fetch('/api/payments/connect', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else if (res.ok && data?.success) {
        showToast('Stripe Connect onboarding initiated.');
        await loadProfileAndShelf();
      } else {
        showToast('Stripe Connect payout onboarding is not configured on this server instance.');
      }
    } catch {
      showToast('Stripe Connect payout onboarding is not configured on this server instance.');
    } finally {
      setIsConnectingStripe(false);
    }
  };

  const handleCopyCliToken = () => {
    if (!cliToken) return;
    playSuccessChime();
    navigator.clipboard.writeText(`slop login ${cliToken}`);
    setCliTokenCopied(true);
    setTimeout(() => setCliTokenCopied(false), 2500);
    showToast('Copied: slop login <token>');
  };

  const loadProfileAndShelf = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSyncStatus('syncing');

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
          lineageBreakdown: profileJson.royalties.lineageBreakdown || [],
          grossSalesCents: Number(profileJson.royalties.grossSalesCents) || 0,
          platformFeesCents: Number(profileJson.royalties.platformFeesCents) || 0,
          upstreamRoyaltiesPaidCents: Number(profileJson.royalties.upstreamRoyaltiesPaidCents) || 0,
          netEarningsCents: Number(profileJson.royalties.netEarningsCents) || 0,
          availableForPayoutCents: Number(profileJson.royalties.availableForPayoutCents) || 0,
          pendingPayoutCents: Number(profileJson.royalties.pendingPayoutCents) || 0,
          paidOutCents: Number(profileJson.royalties.paidOutCents) || 0
        });
      }

      if (profileJson.isOwner && isAuthenticated) {
        const shelfRes = await fetch('/api/shelf');
        const shelfJson = await shelfRes.json();
        if (!shelfRes.ok || !shelfJson.success) {
          throw new Error(shelfJson.error || `Failed to load shelf (HTTP ${shelfRes.status})`);
        }
        if (Array.isArray(shelfJson.shelf)) {
          setShelfApps(shelfJson.shelf);
        }
        loadGrants();

        try {
          setIsLedgerLoading(true);
          const ledgerRes = await fetch('/api/payments/ledger');
          const ledgerJson = await ledgerRes.json();
          if (ledgerRes.ok && ledgerJson.success && Array.isArray(ledgerJson.orders)) {
            setSellerOrders(ledgerJson.orders);
          } else {
            setSellerOrders([]);
          }
        } catch (ledgerErr: any) {
          setLedgerError(ledgerErr.message || 'Failed to load seller ledger');
          setSellerOrders([]);
        } finally {
          setIsLedgerLoading(false);
        }
      } else {
        setShelfApps([]);
        setGrants([]);
        setEarningsByRole([]);
        setPayoutsByStatus([]);
        setSellerOrders([]);
      }

      setSyncStatus('synced');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load profile data');
      setSyncStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, viewingUsername, loadGrants]);

  useEffect(() => {
    loadProfileAndShelf();
  }, [loadProfileAndShelf]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);

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

  const handleSearchMaker = (e: React.FormEvent) => {
    e.preventDefault();
    const handle = searchHandleInput.trim().replace(/^@/, '');
    if (handle) {
      playClickSound();
      setViewingUsername(handle);
      setActiveTab('published');
    }
  };

  if (!isAuthenticated && !viewingUsername) {
    return (
      <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-sm select-none">
        <div className="bg-gradient-to-r from-w95-blue via-blue-900 to-w95-blue text-white p-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="text-3xl bg-white p-1 border border-gray-400 text-black">👤</div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base">Guest Session</span>
              <span className="bg-amber-600 text-white text-[10px] font-bold px-1.5 py-0.5 font-mono border border-amber-800">
                ● NOT SIGNED IN
              </span>
            </div>
          </div>
        </div>

        <Win95Scroll className="flex-1 bg-white border-2 border-gray-800">
          <div className="min-h-full w-full p-6 flex flex-col items-center justify-center text-center">
            <div className="max-w-md w-full bg-[#ece9d8] border-2 border-white border-r-gray-800 border-b-gray-800 p-6 space-y-5">
              <div className="w-16 h-16 bg-blue-100 border-2 border-w95-blue flex items-center justify-center mx-auto text-w95-blue">
                <ShieldCheck size={32} />
              </div>

              <div>
                <h2 className="text-base font-bold text-gray-900">Session Authentication Required</h2>
                <p className="text-gray-600 text-xs mt-1.5 leading-relaxed">
                  Sign in to view your owned apps, license keys, and maker earnings.
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
                    className="flex-1 win95-field bg-white text-black px-2 py-1 text-xs font-mono placeholder-gray-600 placeholder:text-gray-600 focus:outline-none"
                  />
                  <button type="submit" className="btn-w95 px-3 py-1.5 text-xs font-bold flex items-center gap-1">
                    <Search size={12} />
                    <span>Lookup</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </Win95Scroll>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-sm select-none">
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
                {syncStatus === 'synced' ? '● Saved' :
                 syncStatus === 'syncing' ? '● SYNCING...' :
                 syncStatus === 'guest' ? '● PUBLIC VIEW' : '● SYNC FAILED'}
              </span>
            </div>
            <p className="text-blue-100 text-xs mt-0.5 max-w-xl line-clamp-1">{profileData.bio || 'Maker on Nate\'s Software 95.'}</p>
          </div>
        </div>

        <div className="flex gap-1 flex-wrap">
          {isOwner && (
            <button
              onClick={() => { playClickSound(); setActiveTab('shelf'); }}
              className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'shelf' ? 'btn-w95-primary' : 'text-black'}`}
            >
              <HardDrive size={13} /> OWNED APPS ({groupedShelfApps.length})
            </button>
          )}
          <button
            onClick={() => { playClickSound(); setActiveTab('published'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'published' ? 'btn-w95-primary' : 'text-black'}`}
          >
            <Sparkles size={13} /> PUBLISHED APPS ({publishedApps.length})
          </button>
          {isOwner && (
            <button
              onClick={() => { playClickSound(); setActiveTab('royalties'); }}
              className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'royalties' ? 'btn-w95-primary' : 'text-black'}`}
            >
              <DollarSign size={13} /> SALES &amp; ROYALTIES ({formatCentsToUsd(royalties.makerBalanceCents)})
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
        </div>
      </div>

      <Win95Scroll className="flex-1 bg-white border-2 border-gray-800 p-4">
        {!isLoading && isOwner && !profileData.payoutsEnabled && (
          <div className="bg-amber-50 border-2 border-amber-500 p-3 mb-4 text-amber-950 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 text-amber-700 mt-0.5" />
              <div>
                <div className="font-bold text-sm">Connect Stripe Payouts</div>
                <div className="text-xs text-amber-900">Enable Stripe payouts before publishing paid software. Until then, paid listings remain drafts and cannot be purchased.</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleConnectStripe}
              disabled={isConnectingStripe}
              className="btn-w95 btn-w95-primary px-3 py-1 text-xs font-bold flex items-center gap-1 shrink-0"
            >
              <DollarSign size={13} />
              <span>{isConnectingStripe ? 'Connecting...' : 'Connect Stripe'}</span>
            </button>
          </div>
        )}
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

        {isLoading && (
          <div className="p-8 text-center text-gray-500 font-mono text-xs flex items-center justify-center gap-2">
            <RefreshCw size={14} className="animate-spin text-w95-blue" />
            <span>Loading profile &amp; owned apps...</span>
          </div>
        )}

        {!isLoading && activeTab === 'shelf' && isOwner && (
          <div className="space-y-3 max-w-4xl mx-auto">
            <div className="border-b pb-2 mb-2 flex justify-between items-center">
              <div>
                <span className="font-bold text-base text-w95-blue">OWNED APPS</span>
                <p className="text-gray-600 text-xs">Apps you own, along with their source repositories and license keys.</p>
              </div>
              <span className="bg-blue-100 text-w95-blue text-xs font-bold px-2 py-1 rounded">
                {groupedShelfApps.length} Owned {groupedShelfApps.length === 1 ? 'Application' : 'Applications'}
              </span>
            </div>

            {groupedShelfApps.length === 0 ? (
              <div className="bg-gray-50 border-2 border-dashed border-gray-300 p-8 rounded text-center space-y-3">
                <HardDrive size={32} className="mx-auto text-gray-400" />
                <p className="font-bold text-gray-700 text-sm">Your Software Shelf is Empty</p>
                <p className="text-gray-500 text-xs max-w-sm mx-auto">
                  Buy or claim an app and it shows up here.
                </p>
                <button
                  onClick={() => { playClickSound(); onOpenHotwire?.(); }}
                  className="btn-w95 btn-w95-primary px-4 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 mx-auto"
                >
                  <span>Browse today's drops &rarr;</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {groupedShelfApps.map(({ app, count }) => {
                  const artifactLinks = publishedArtifactLinks(app.binaries);
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
                              License: {app.maskedKey}{count > 1 ? ` (${count} licenses)` : ''}
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

                      {artifactLinks.length > 0 ? (
                        <div className="flex flex-col gap-1 items-end">
                          {artifactLinks.map(link => (
                            <a key={link.kind} href={link.url} target="_blank" rel="noopener noreferrer"
                              className="btn-w95 px-2.5 py-1 text-[11px] font-bold flex items-center gap-1">
                              {link.kind === 'web' || link.kind === 'ios' ? <ExternalLink size={11} /> : <Download size={11} />}
                              {link.label}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-gray-500 max-w-48 text-right">
                          No install or export link has been published for this title.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!isLoading && activeTab === 'published' && (
          <div className="space-y-3 max-w-4xl mx-auto">
            <div className="border-b pb-2 mb-2 flex justify-between items-center">
              <div>
                <span className="font-bold text-base text-w95-blue">PUBLISHED APPS</span>
                <p className="text-gray-600 text-xs">Software titles created and published by @{profileData.username}.</p>
              </div>
              <span className="bg-blue-100 text-w95-blue text-xs font-bold px-2 py-1 rounded">
                {publishedApps.length} Published
              </span>
            </div>

            {publishedApps.length === 0 ? (
              <div className="bg-gray-50 border-2 border-dashed border-gray-300 p-8 rounded text-center space-y-3">
                <Sparkles size={32} className="mx-auto text-gray-400" />
                <p className="font-bold text-gray-700 text-sm">No Published Applications Yet</p>
                <p className="text-gray-500 text-xs max-w-sm mx-auto">
                  {isOwner
                    ? 'Use GITSMITH to push your code and publish your first release to the 12:01 AM Daily Drops board.'
                    : `@${profileData.username} has not published any public applications yet.`}
                </p>
                {isOwner && (
                  <button
                    onClick={() => { playClickSound(); onOpenGitsmith?.(); }}
                    className="btn-w95 btn-w95-primary px-4 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 mx-auto"
                  >
                    <span>Publish your first app &rarr;</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {publishedApps.map((app) => {
                  const repoSlug = app.repoSlug || app.repoSlugName || (app.repoName ? `${app.creator || app.author || profileData.username}/${app.repoName}` : null);
                  const hasRepo = Boolean(app.hasCanonicalRepo || app.repositoryId || repoSlug);
                  const liveUrl = app.liveUrl || app.liveAppUrl || app.binaries?.web || null;

                  return (
                    <div key={app.id} className="border-2 border-gray-700 bg-blue-50/60 p-3 rounded flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl bg-white p-1 rounded border border-gray-400 shrink-0">{profileData.avatar}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-w95-blue">{app.name}</span>
                            <span className="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-green-300 font-mono">
                              {app.version}
                            </span>
                          </div>
                          <div className="text-xs text-gray-600 mt-0.5">{app.upvotes || 0} upvotes &middot; {app.forks || 0} downstream forks</div>
                          <div className="text-[11px] text-gray-500 font-mono mt-1">App ID: {app.id}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {onOpenPostEditor && (
                          <button
                            type="button"
                            onClick={() => {
                              playClickSound();
                              onOpenPostEditor(app);
                            }}
                            className="btn-w95 px-2.5 py-1 text-xs font-bold flex items-center gap-1 text-purple-900 hover:bg-white"
                            title="Open Post Editor for this app"
                          >
                            <Edit3 size={12} />
                            <span>View &amp; Edit</span>
                          </button>
                        )}

                        {hasRepo ? (
                          <button
                            type="button"
                            onClick={() => {
                              playClickSound();
                              onOpenGitsmith?.(repoSlug || app.repositoryId || app.id);
                            }}
                            className="btn-w95 px-2.5 py-1 text-xs font-bold flex items-center gap-1 text-blue-900 hover:bg-white"
                            title="Open canonical repository in GITSMITH"
                          >
                            <Terminal size={12} />
                            <span>GITFORGE source</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-400 font-mono">No forge repo</span>
                        )}

                        {liveUrl ? (
                          <a
                            href={liveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => playClickSound()}
                            className="btn-w95 px-2.5 py-1 text-xs font-bold flex items-center gap-1 text-green-800 hover:bg-white inline-flex"
                            title="View built live application"
                          >
                            <ExternalLink size={12} />
                            <span>View live</span>
                          </a>
                        ) : (
                          <span className="text-[11px] text-gray-400 font-mono">No live URL</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!isLoading && activeTab === 'royalties' && isOwner && (
          <div className="space-y-4 max-w-4xl mx-auto font-tahoma">
            <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 text-white p-4 rounded-lg border-2 border-emerald-700 shadow-lg space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-emerald-300 font-mono flex items-center gap-1.5 uppercase tracking-wider">
                  <Sparkles size={13} className="text-amber-400" />
                  <span>Earnings and payout summary</span>
                </div>
                <div className="text-xs font-mono text-emerald-300">
                  Stripe Express: {profileData.stripeAccountId ? `${profileData.stripeAccountId.slice(0, 16)}... (${profileData.stripeStatus})` : 'Not Connected'}
                </div>
              </div>
              {royalties.grossSalesCents > 0 && (
                <div className="mb-3">
                  <DollarBillReceipt
                    grossCents={royalties.grossSalesCents}
                    result={{
                      isRoot: royalties.upstreamRoyaltiesPaidCents <= 0,
                      grossCents: royalties.grossSalesCents,
                      currency: 'usd',
                      platformCents: royalties.platformFeesCents,
                      sellerCents: royalties.netEarningsCents,
                      ancestorTotalCents: royalties.upstreamRoyaltiesPaidCents,
                      allocations: royalties.upstreamRoyaltiesPaidCents > 0
                        ? [{
                            sequence: 1,
                            role: 'ancestor',
                            recipientUserId: null,
                            sourceRepositoryId: null,
                            lineageDepth: 1,
                            basisPoints: null,
                            amountCents: royalties.upstreamRoyaltiesPaidCents
                          }]
                        : [],
                      snapshot: {} as any,
                      snapshotJson: '',
                      conservationVerified: true
                    }}
                    makerLabel="You"
                    resolveUpstreamLabel={() => 'Upstream makers'}
                    title="Your lifetime earnings"
                    note="Totals across every completed sale. Net earnings is what you keep after the platform fee and any upstream royalties."
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
                {[
                  ['Gross sales', royalties.grossSalesCents],
                  ['Platform fees', royalties.platformFeesCents],
                  ['Upstream royalties paid', royalties.upstreamRoyaltiesPaidCents],
                  ['Net earnings', royalties.netEarningsCents],
                  ['Available for payout', royalties.availableForPayoutCents],
                  ['Pending', royalties.pendingPayoutCents],
                  ['Paid out', royalties.paidOutCents]
                ].map(([label, cents]) => (
                  <div key={String(label)} className="flex justify-between gap-4 border-b border-emerald-800 py-1">
                    <span className="text-slate-200">{label}</span>
                    <span className="font-bold text-white">{formatCentsToUsd(Number(cents))}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-3">
              <div className="font-bold text-gray-900 text-xs flex items-center justify-between border-b border-gray-200 pb-2">
                <span>Earnings by app</span>
                <span className="text-[10px] font-mono text-gray-500">From completed orders</span>
              </div>

              {royalties.lineageBreakdown.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-xs space-y-1">
                  <p className="font-bold">Nothing here yet</p>
                  <p>Sell an app and keep the sale minus the platform's 10%. When someone sells a fork of your app, you earn your frozen royalty rate too. It all shows up here.</p>
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

            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-3">
              <div className="font-bold text-gray-900 text-xs flex items-center justify-between border-b border-gray-200 pb-2">
                <span className="flex items-center gap-1.5">
                  <DollarSign size={14} className="text-emerald-700" />
                  <span>Seller Sales &amp; Transfer Ledger</span>
                </span>
                <span className="text-[10px] font-mono text-gray-500">
                  {sellerOrders.length} {sellerOrders.length === 1 ? 'Order' : 'Orders'}
                </span>
              </div>

              {isLedgerLoading ? (
                <div className="p-4 text-center text-gray-500 font-mono text-xs flex items-center justify-center gap-2">
                  <RefreshCw size={13} className="animate-spin text-w95-blue" />
                  <span>Loading seller order ledger...</span>
                </div>
              ) : ledgerError ? (
                <div className="bg-red-50 border border-red-400 p-2.5 rounded text-red-800 text-xs flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{ledgerError}</span>
                </div>
              ) : sellerOrders.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-xs space-y-1">
                  <p className="font-bold">No sales or royalty distributions recorded yet</p>
                  <p>When buyers purchase your apps or downstream forks, your allocations and transfer records will appear here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-300 text-gray-600 text-[11px]">
                        <th className="p-1.5">Date / Order</th>
                        <th className="p-1.5">App</th>
                        <th className="p-1.5 text-right">Gross</th>
                        <th className="p-1.5 text-right">Your Allocation</th>
                        <th className="p-1.5 text-center">Payout Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {sellerOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-blue-50/50 transition-colors">
                          <td className="p-1.5">
                            <div className="font-bold text-gray-800 text-[11px]">
                              {order.fulfilledAt ? new Date(order.fulfilledAt).toLocaleDateString() : new Date(order.createdAt).toLocaleDateString()}
                            </div>
                            <div className="text-[10px] text-gray-400">
                              #{order.id.slice(0, 12)}
                            </div>
                          </td>
                          <td className="p-1.5">
                            <span className="font-bold text-blue-950 font-tahoma">{order.appName}</span>
                            <span className="ml-1 text-[10px] text-gray-500">v{order.appVersion}</span>
                          </td>
                          <td className="p-1.5 text-right font-bold text-gray-800">
                            {formatCentsToUsd(order.grossCents)}
                          </td>
                          <td className="p-1.5 text-right">
                            <span className="font-bold text-green-800">
                              {formatCentsToUsd(order.callerEarnedCents)}
                            </span>
                            <span className="block text-[10px] text-gray-500 uppercase">
                              {order.callerRole || 'maker'}
                            </span>
                          </td>
                          <td className="p-1.5 text-center">
                            {order.isSettled ? (
                              <span className="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-green-300">
                                Settled
                              </span>
                            ) : (
                              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-300">
                                {order.transferStatus === 'pending' ? 'Pending' : order.transferStatus}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-3 space-y-3">
              <div className="border-b pb-2 flex justify-between items-center">
                <div>
                  <span className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                    <GitBranch size={14} className="text-purple-700" />
                    <span>Contributor Revenue Grants &amp; Earnings</span>
                  </span>
                  <p className="text-gray-600 text-[11px] mt-0.5">Basis-point shares granted to you when a repository maintainer merges your feature, plus realized payouts.</p>
                </div>
                <button
                  onClick={() => { playClickSound(); loadGrants(); }}
                  disabled={grantsLoading}
                  className="btn-w95 text-xs px-2.5 py-1 flex items-center gap-1 font-bold shrink-0"
                >
                  <RefreshCw size={12} className={grantsLoading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>

              {grantsError && (
                <div className="bg-red-50 border-2 border-red-500 p-3 rounded text-red-800 text-xs flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{grantsError}</span>
                </div>
              )}

              {grantsLoading && !grantsError && grants.length === 0 && earningsByRole.length === 0 && (
                <div className="p-8 text-center text-gray-500 font-mono text-xs flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin text-w95-blue" />
                  <span>Loading grants and earnings...</span>
                </div>
              )}

              {!grantsLoading && grants.length === 0 && !grantsError && (
                <div className="bg-gray-50 border-2 border-dashed border-gray-300 p-6 rounded text-center space-y-2">
                  <GitBranch size={28} className="mx-auto text-gray-400" />
                  <p className="font-bold text-gray-700 text-xs">You have no revenue grants yet.</p>
                  <p className="text-gray-500 text-[11px] max-w-sm mx-auto">Contribute a merged feature to earn a share.</p>
                </div>
              )}

              {grants.length > 0 && (
                <div className="space-y-3">
                  <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 text-white p-3 rounded border border-emerald-700 shadow">
                    <div className="text-[10px] text-emerald-400 font-mono uppercase tracking-wider">Realized earnings from fulfilled orders</div>
                    {earningsByRole.length === 0 ? (
                      <div className="text-xs text-slate-300 mt-1">No fulfilled orders have paid out to you yet.</div>
                    ) : (
                      <div className="flex flex-wrap gap-4 mt-1">
                        {earningsByRole.map((row) => (
                          <div key={row.role}>
                            <div className="text-xl font-bold font-mono text-white">{formatCentsToUsd(row.totalCents)}</div>
                            <div className="text-[10px] text-slate-300">{row.count} {row.role} {row.count === 1 ? 'allocation' : 'allocations'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="font-bold text-gray-800 text-[11px]">Payout status</div>
                    {payoutsByStatus.length === 0 ? (
                      <p className="text-gray-500 text-xs p-1">No payout records yet. Payouts appear here once an order carrying your share is fulfilled.</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {payoutsByStatus.map((row) => (
                          <div key={row.status} className="bg-gray-50 p-2 rounded border border-gray-200 text-xs">
                            <div className="font-bold text-gray-800 font-mono uppercase">{row.status}</div>
                            <div className="font-bold text-green-800">{formatCentsToUsd(row.totalCents)}</div>
                            <div className="text-[10px] text-gray-500">{row.count} {row.count === 1 ? 'transfer' : 'transfers'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="font-bold text-gray-800 text-[11px]">Your grants</div>
                    <div className="space-y-1.5">
                      {grants.map((grant) => (
                        <div key={grant.id} className="bg-gray-50 p-2 rounded border border-gray-200 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-bold text-blue-900">{grant.appId}</div>
                            <div className="text-[10px] text-gray-500 font-mono">
                              Granted {grant.createdAt ? new Date(grant.createdAt).toLocaleDateString() : ''}
                              {grant.activatedAt ? ` · Active since ${new Date(grant.activatedAt).toLocaleDateString()}` : ''}
                            </div>
                          </div>
                          <div className="text-right font-mono flex items-center gap-2">
                            <span className="font-bold text-gray-800">{(grant.basisPoints / 100).toFixed(2)}%</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono uppercase ${
                              grant.status === 'active' ? 'bg-green-100 text-green-800 border border-green-300' :
                              grant.status === 'pending' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                              'bg-gray-200 text-gray-600 border border-gray-300'
                            }`}>
                              {grant.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
                <label className="font-bold text-gray-800 block mb-1 text-xs">Get paid via Stripe:</label>
                {profileData.payoutsEnabled ? (
                  <div className="bg-green-50 border border-green-300 p-1.5 rounded flex items-center justify-between text-xs text-green-900">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold font-mono text-[11px]">
                        {profileData.stripeAccountId ? `Connected (${profileData.stripeAccountId.slice(0, 12)}...)` : 'Connected'}
                      </span>
                      <span className="bg-green-600 text-white text-[10px] px-1.5 py-0.5 font-mono">
                        Active
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleConnectStripe}
                      disabled={isConnectingStripe}
                      className="btn-w95 btn-w95-primary px-3 py-1 text-xs font-bold flex items-center gap-1"
                    >
                      <DollarSign size={13} />
                      <span>{isConnectingStripe ? 'Connecting...' : 'Connect Stripe'}</span>
                    </button>
                    <span className="text-[11px] text-gray-600 font-mono">
                      {profileData.stripeAccountId ? 'Pending verification' : 'Not Connected'}
                    </span>
                  </div>
                )}
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
              <p className="text-gray-500 text-[11px] mt-1">Registers your SSH public key for GITSMITH git repository access.</p>
            </div>

            <div className="bg-gray-50 border-2 border-gray-400 p-3 rounded space-y-2 mt-3">
              <div className="flex items-center justify-between">
                <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                  <Terminal size={14} className="text-blue-700" />
                  <span>CLI Access (<code className="font-mono">slop</code> CLI)</span>
                </div>
                {!cliToken && (
                  <button
                    type="button"
                    onClick={handleGenerateCliToken}
                    disabled={isGeneratingCliToken}
                    className="btn-w95 px-3 py-1 text-xs font-bold flex items-center gap-1"
                  >
                    {isGeneratingCliToken ? <RefreshCw size={12} className="animate-spin" /> : <Key size={12} />}
                    <span>{isGeneratingCliToken ? 'Generating...' : 'Generate CLI token'}</span>
                  </button>
                )}
              </div>

              <p className="text-gray-600 text-[11px]">
                Generate a durable personal access token to authenticate the <code className="bg-gray-200 px-1 py-0.5 rounded font-mono text-gray-800">slop</code> CLI on your machine.
              </p>

              {cliTokenError && (
                <div className="bg-red-50 border border-red-500 p-2 rounded text-red-800 text-xs flex items-center gap-1.5">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>{cliTokenError}</span>
                </div>
              )}

              {cliToken && (
                <div className="space-y-2 pt-1 border-t border-gray-300">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={cliToken}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 p-1.5 border border-gray-400 font-mono text-xs bg-white text-gray-900 select-all"
                    />
                    <button
                      type="button"
                      onClick={handleCopyCliToken}
                      className="btn-w95 btn-w95-primary px-3 py-1.5 text-xs font-bold flex items-center gap-1 shrink-0"
                    >
                      {cliTokenCopied ? <Check size={12} /> : <Copy size={12} />}
                      <span>{cliTokenCopied ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerateCliToken}
                      disabled={isGeneratingCliToken}
                      className="btn-w95 px-2.5 py-1.5 text-xs font-bold shrink-0"
                      title="Generate a new token"
                    >
                      {isGeneratingCliToken ? <RefreshCw size={12} className="animate-spin" /> : 'New Token'}
                    </button>
                  </div>
                  <div className="bg-amber-50 border border-amber-300 p-2 rounded text-amber-900 text-xs flex items-center gap-1.5 font-medium">
                    <Sparkles size={13} className="text-amber-600 shrink-0" />
                    <span>Run <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-black font-bold">slop login</code> and paste this token. It won't be shown again.</span>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-gray-300 flex justify-between items-center">
              {saveSuccess ? (
                <span className="text-green-700 font-bold text-xs flex items-center gap-1">
                  <Check size={14} /> Profile settings saved!
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
      </Win95Scroll>
    </div>
  );
};
