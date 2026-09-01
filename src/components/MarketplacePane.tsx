import React, { useState, useEffect, useCallback } from 'react';
import { Users, Gift, RefreshCw, AlertTriangle, XCircle, Store, History } from 'lucide-react';

/**
 * MarketplacePane
 * ------------------------------------------------------------------
 * Fix 2 (INBOX marketplace) — minimal Win95-style discovery UI for the
 * contribution marketplace:
 *   - "Opportunities" tab: public read of GET /api/marketplace/opportunities
 *     (repos with grantable_bps room — no PII, no auth required).
 *   - "My Grant History" tab: authenticated owner view of
 *     GET /api/marketplace/grants (grants on repos the signed-in user
 *     owns) with a control to revoke a PENDING grant via
 *     POST /api/marketplace/grants { action: 'revoke', grantId }.
 *
 * Honest empty states throughout — no mock/simulated data, ever.
 */

interface Opportunity {
  repositoryId: string;
  appId: string | null;
  appName: string | null;
  ownerUsername: string | null;
  repoSlug: string;
  grantableBps: number;
  grantedBps: number;
  remainingBps: number;
}

interface OwnerGrant {
  id: string;
  repositoryId: string;
  repoSlug: string;
  appId: string | null;
  appName: string | null;
  contributorUserId: string;
  contributorUsername: string;
  basisPoints: number;
  status: 'pending' | 'active' | 'revoked';
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  revocable: boolean;
}

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

interface MarketplacePaneProps {
  modeToggle?: React.ReactNode;
  isAuthenticated: boolean;
}

export const MarketplacePane: React.FC<MarketplacePaneProps> = ({ modeToggle, isAuthenticated }) => {
  const [tab, setTab] = useState<'opportunities' | 'history'>('opportunities');

  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [oppLoading, setOppLoading] = useState(true);
  const [oppError, setOppError] = useState<string | null>(null);

  const [grants, setGrants] = useState<OwnerGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [revokePending, setRevokePending] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const fetchOpportunities = useCallback(async () => {
    setOppLoading(true);
    setOppError(null);
    try {
      const res = await fetch('/api/marketplace/opportunities');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setOppError(data?.error || `Failed to load opportunities (HTTP ${res.status})`);
        setOpportunities([]);
        return;
      }
      setOpportunities(Array.isArray(data.opportunities) ? data.opportunities : []);
    } catch (err: any) {
      setOppError(err?.message || 'Network error loading opportunities');
      setOpportunities([]);
    } finally {
      setOppLoading(false);
    }
  }, []);

  const fetchGrantHistory = useCallback(async () => {
    if (!isAuthenticated) return;
    setGrantsLoading(true);
    setGrantsError(null);
    try {
      const res = await fetch('/api/marketplace/grants');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setGrantsError(data?.error || `Failed to load grant history (HTTP ${res.status})`);
        setGrants([]);
        return;
      }
      setGrants(Array.isArray(data.grants) ? data.grants : []);
    } catch (err: any) {
      setGrantsError(err?.message || 'Network error loading grant history');
      setGrants([]);
    } finally {
      setGrantsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  useEffect(() => {
    if (tab === 'history') fetchGrantHistory();
  }, [tab, fetchGrantHistory]);

  const handleRevoke = async (grantId: string) => {
    setRevokePending(grantId);
    setRevokeError(null);
    try {
      const res = await fetch('/api/marketplace/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', grantId })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setRevokeError(data?.error || `Failed to revoke grant (HTTP ${res.status})`);
        return;
      }
      setGrants(prev => prev.map(g => (g.id === grantId ? { ...g, status: 'revoked', revocable: false } : g)));
    } catch (err: any) {
      setRevokeError(err?.message || 'Network error revoking grant');
    } finally {
      setRevokePending(null);
    }
  };

  const statusBadge = (status: OwnerGrant['status']) => {
    if (status === 'active') {
      return <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">ACTIVE · IMMUTABLE</span>;
    }
    if (status === 'pending') {
      return <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300">PENDING</span>;
    }
    return <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-gray-200 text-gray-600 border border-gray-400">REVOKED</span>;
  };

  return (
    <div className="h-full overflow-hidden font-tahoma text-xs flex flex-col bg-w95-gray">
      {modeToggle}

      {/* Sub-tabs */}
      <div className="flex border-b-2 border-gray-800 bg-w95-gray p-1 gap-1 shrink-0">
        <button
          role="tab"
          aria-selected={tab === 'opportunities'}
          onClick={() => setTab('opportunities')}
          className={`px-2 py-1 text-[11px] font-bold border-2 flex items-center gap-1 ${
            tab === 'opportunities'
              ? 'bg-white border-gray-800 text-w95-blue'
              : 'bg-w95-gray border-gray-400 text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Store size={12} /> Opportunities
        </button>
        <button
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
          className={`px-2 py-1 text-[11px] font-bold border-2 flex items-center gap-1 ${
            tab === 'history'
              ? 'bg-white border-gray-800 text-w95-blue'
              : 'bg-w95-gray border-gray-400 text-gray-700 hover:bg-gray-100'
          }`}
        >
          <History size={12} /> My Grant History
        </button>
        <button
          onClick={() => (tab === 'opportunities' ? fetchOpportunities() : fetchGrantHistory())}
          className="ml-auto btn-w95 text-[10px] py-1 px-2 flex items-center gap-1 font-bold"
          title="Refresh"
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'opportunities' && (
          <div className="space-y-3">
            <div className="bg-purple-50 border-2 border-purple-400 p-2.5 rounded text-[11px] text-purple-950">
              <div className="font-bold flex items-center gap-1.5 mb-1"><Gift size={13} /> Contribution Marketplace</div>
              Apps below still have room in their contributor-share pool. Submit a pull request through GITSMITH;
              if the maker approves it they can grant you a slice of the remaining basis points, paid perpetually
              on every future sale once your grant activates.
            </div>

            {oppLoading && (
              <div className="text-gray-600 font-mono text-[11px] p-2">Loading opportunities…</div>
            )}

            {!oppLoading && oppError && (
              <div className="bg-red-50 border-2 border-red-400 p-2.5 rounded text-red-800 text-[11px] flex items-center gap-2">
                <XCircle size={14} /> {oppError}
              </div>
            )}

            {!oppLoading && !oppError && opportunities.length === 0 && (
              <div className="border-2 border-dashed border-gray-400 rounded p-4 text-center text-gray-500 text-[11px] font-mono">
                No open contributor-share opportunities right now. Check back after a maker sets a grantable pool
                on their app's Pricing &amp; Splits tab.
              </div>
            )}

            {!oppLoading && !oppError && opportunities.length > 0 && (
              <div className="space-y-2">
                {opportunities.map((opp) => (
                  <div key={opp.repositoryId} className="border-2 border-gray-700 bg-white rounded p-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-gray-900 truncate">{opp.appName || opp.repoSlug}</div>
                      <div className="text-[10px] text-gray-500 font-mono truncate">
                        {opp.ownerUsername ? `@${opp.ownerUsername}` : 'unknown owner'} / {opp.repoSlug}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-gray-500">Pool {pct(opp.grantableBps)} · Granted {pct(opp.grantedBps)}</div>
                      <div className="font-mono font-bold text-purple-800">{pct(opp.remainingBps)} available</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-3">
            {!isAuthenticated && (
              <div className="border-2 border-dashed border-gray-400 rounded p-4 text-center text-gray-500 text-[11px] font-mono flex flex-col items-center gap-1.5">
                <Users size={18} className="text-gray-400" />
                Sign in to view grants you've made on repositories you own.
              </div>
            )}

            {isAuthenticated && (
              <>
                <div className="bg-blue-50 border-2 border-w95-blue p-2.5 rounded text-[11px] text-gray-800">
                  Grants you've issued on apps you own. Only <b>pending</b> grants can be revoked — once a grant
                  activates (its merge lands) it is perpetual and immutable, per the marketplace payout guarantee.
                </div>

                {revokeError && (
                  <div className="bg-red-50 border-2 border-red-400 p-2 rounded text-red-800 text-[11px] flex items-center gap-2">
                    <XCircle size={13} /> {revokeError}
                  </div>
                )}

                {grantsLoading && (
                  <div className="text-gray-600 font-mono text-[11px] p-2">Loading grant history…</div>
                )}

                {!grantsLoading && grantsError && (
                  <div className="bg-red-50 border-2 border-red-400 p-2.5 rounded text-red-800 text-[11px] flex items-center gap-2">
                    <AlertTriangle size={14} /> {grantsError}
                  </div>
                )}

                {!grantsLoading && !grantsError && grants.length === 0 && (
                  <div className="border-2 border-dashed border-gray-400 rounded p-4 text-center text-gray-500 text-[11px] font-mono">
                    You haven't granted any contributor shares yet. Approve a pull request in INBOX with a reward
                    percentage to create your first grant.
                  </div>
                )}

                {!grantsLoading && !grantsError && grants.length > 0 && (
                  <div className="space-y-2">
                    {grants.map((g) => (
                      <div key={g.id} className="border-2 border-gray-700 bg-white rounded p-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-gray-900 truncate">
                            {g.appName || g.repoSlug} <span className="font-normal text-gray-500">→ @{g.contributorUsername}</span>
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono flex items-center gap-1.5">
                            {statusBadge(g.status)}
                            <span>{pct(g.basisPoints)}</span>
                            <span>· granted {new Date(g.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="shrink-0">
                          {g.revocable ? (
                            <button
                              onClick={() => handleRevoke(g.id)}
                              disabled={revokePending === g.id}
                              className={`btn-w95 text-[10px] py-1 px-2 font-bold text-red-800 ${revokePending === g.id ? 'opacity-60 cursor-wait' : ''}`}
                            >
                              {revokePending === g.id ? 'Revoking…' : 'Revoke'}
                            </button>
                          ) : (
                            <span className="text-[10px] text-gray-400 font-mono">
                              {g.status === 'active' ? 'irrevocable' : '—'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
