import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AppListing } from '../data/mockData';
import { MakerLeaderboardEntry } from '../lib/hotwireBackend';
import { AuthContext } from './AuthContext';

export interface CatalogContextType {
  apps: AppListing[];
  shelfAppIds: Set<string>;
  votedAppIds: Set<string>;
  makerLeaderboard: MakerLeaderboardEntry[];
  isLoading: boolean;
  isAuthoritativeLive: boolean;
  isDemoData: boolean;
  error: string | null;
  currentSort: string;
  currentBatch: string;
  getApp: (id: string) => AppListing | undefined;
  isOwned: (appId: string) => boolean;
  hasVoted: (appId: string) => boolean;
  refreshCatalog: (opts?: { sort?: string; batch?: string }) => Promise<void>;
  refreshShelf: () => Promise<void>;
  upvoteApp: (appId: string) => Promise<boolean>;
  incrementForkCount: (appId: string) => void;
  submitDrop: (dropData: Partial<AppListing>) => Promise<{
    success: boolean;
    id?: string;
    error?: string;
    deploymentState?: string;
    productStatus?: string;
    repositoryId?: string | null;
    repositoryProvisioned?: boolean;
    message?: string;
  }>;
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apps, setApps] = useState<AppListing[]>([]);
  const [shelfAppIds, setShelfAppIds] = useState<Set<string>>(new Set<string>());
  const [votedAppIds, setVotedAppIds] = useState<Set<string>>(new Set<string>());
  const [makerLeaderboard, setMakerLeaderboard] = useState<MakerLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthoritativeLive, setIsAuthoritativeLive] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSort, setCurrentSort] = useState<string>('today');
  const [currentBatch, setCurrentBatch] = useState<string>('all');

  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;

  const sortRef = React.useRef(currentSort);
  const batchRef = React.useRef(currentBatch);
  sortRef.current = currentSort;
  batchRef.current = currentBatch;

  const fetchShelf = useCallback(async () => {
    try {
      const shelfRes = await fetch('/api/shelf');
      if (shelfRes.ok) {
        const shelfData = await shelfRes.json();
        if (shelfData.success && Array.isArray(shelfData.shelf)) {
          const owned = new Set<string>(shelfData.shelf.map((item: any) => item.appId || item.id));
          setShelfAppIds(owned);
          return;
        }
      }
      setShelfAppIds(new Set<string>());
    } catch {
    }
  }, []);

  useEffect(() => {
    fetchShelf();
  }, [user, fetchShelf]);

  const fetchAuthoritativeCatalog = useCallback(async (opts?: { sort?: string; batch?: string }) => {
    try {
      setIsLoading(true);
      setError(null);

      const activeSort = opts?.sort ?? sortRef.current ?? 'today';
      const activeBatch = opts?.batch !== undefined ? opts.batch : (batchRef.current ?? 'all');

      if (activeSort !== sortRef.current) {
        sortRef.current = activeSort;
        setCurrentSort(activeSort);
      }
      if (activeBatch !== batchRef.current) {
        batchRef.current = activeBatch;
        setCurrentBatch(activeBatch);
      }

      const params = new URLSearchParams();
      if (activeSort) params.set('sort', activeSort);
      if (activeBatch && activeBatch !== 'all') params.set('batch', activeBatch);

      const dropsRes = await fetch(`/api/drops?${params.toString()}`);
      if (dropsRes.ok) {
        const dropsData = await dropsRes.json();
        if (dropsData.success && Array.isArray(dropsData.drops)) {
          const liveDrops: AppListing[] = dropsData.drops.map((d: any) => {
            const parsedPrice = typeof d.price === 'string'
              ? (parseInt(d.price.replace(/[^0-9.]/g, ''), 10) || undefined)
              : (typeof d.price === 'number' ? d.price : undefined);

            const authorName = d.creator || d.creatorHandle || d.author || 'not supplied';
            const avatar = d.creatorAvatar || d.authorAvatar || '⚡';

            return {
              id: d.id,
              name: d.name || d.id,
              tagline: d.tagline || '',
              description: d.description || '',
              author: authorName,
              authorAvatar: avatar,
              creator: authorName,
              creatorAvatar: avatar,
              version: d.version || 'v1.0.0',
              upvotes: Number.isFinite(d.upvotes) ? d.upvotes : 0,
              forkCount: Number.isFinite(d.forks) ? d.forks : 0,
              forks: Number.isFinite(d.forks) ? d.forks : 0,
              tags: Array.isArray(d.tags) ? d.tags : [],
              liveUrl: d.liveUrl || d.binaries?.web,
              screenshots: Array.isArray(d.screenshots) ? d.screenshots : [],
              binaries: d.binaries || {},
              sqliteDatabase: d.storage || '',
              sqliteSize: d.storage ? 'Declared by app' : 'Not specified',
              price: parsedPrice,
              moddabilityScore: typeof d.moddabilityScore === 'number' ? d.moddabilityScore : undefined,
              mergeCleanliness: d.mergeCleanliness || 'not measured',
              comments: d.comments || [],
              deploymentState: d.deploymentState || 'draft',
              deploymentError: d.deploymentError,
              deploymentEvidence: d.deploymentEvidence || d.deploymentEvidenceJson,
              detectedProjectType: d.detectedProjectType,
              deploymentPlan: d.deploymentPlan || d.deploymentPlanJson,
              activeDeploymentId: d.activeDeploymentId,
              activeCommitOid: d.activeCommitOid,
              repositoryId: d.repositoryId || null,
              hasCanonicalRepo: Boolean(d.hasCanonicalRepo || d.repositoryId),
              isRepoActive: Boolean(d.isRepoActive),
              repoSlug: d.repoSlug || null,
              repoName: d.repoName || null,
              repoOwner: d.repoOwner || null,
              repoHeadCommitOid: d.repoHeadCommitOid || null,
              repoVisibility: d.repoVisibility || null,
              repoStatus: d.repoStatus || null,
              repoDefaultRef: d.repoDefaultRef || null,
              royaltyBps: typeof d.royaltyBps === 'number' ? d.royaltyBps : null,
              resaleEnabled: d.resaleEnabled !== false,
              forkingEnabled: d.forkingEnabled !== false,
              inheritedLiens: Array.isArray(d.inheritedLiens) ? d.inheritedLiens : [],
              productStatus: d.productStatus,
              hasVoted: Boolean(d.hasVoted),
              isDemo: false
            };
          });

          setApps(liveDrops);
          if (Array.isArray(dropsData.votedAppIds)) {
            setVotedAppIds(new Set(dropsData.votedAppIds));
          } else {
            const votedFromDrops = liveDrops.filter(a => a.hasVoted).map(a => a.id);
            if (votedFromDrops.length > 0) {
              setVotedAppIds(new Set(votedFromDrops));
            }
          }
          if (Array.isArray(dropsData.makerLeaderboard)) {
            setMakerLeaderboard(dropsData.makerLeaderboard);
          }
          setIsAuthoritativeLive(true);
          setError(null);
        } else {
          setApps([]);
          setIsAuthoritativeLive(false);
          setError(dropsData?.error || 'Failed to load live drops from server');
        }
      } else {
        setApps([]);
        setIsAuthoritativeLive(false);
        setError(`Failed to fetch live catalog (HTTP ${dropsRes.status})`);
      }

      await fetchShelf();

      try {
        const upvoteRes = await fetch('/api/upvote?action=my-votes');
        if (upvoteRes.ok) {
          const upvoteData = await upvoteRes.json();
          if (upvoteData.success && Array.isArray(upvoteData.votedAppIds)) {
            setVotedAppIds(prev => {
              const next = new Set(prev);
              upvoteData.votedAppIds.forEach((id: string) => next.add(id));
              return next;
            });
          }
        }
      } catch {
      }
    } catch (err: any) {
      setApps([]);
      setIsAuthoritativeLive(false);
      setError(err.message || 'Failed to fetch authoritative catalog');
    } finally {
      setIsLoading(false);
    }
  }, [fetchShelf]);

  useEffect(() => {
    fetchAuthoritativeCatalog();
  }, [fetchAuthoritativeCatalog]);

  const getApp = useCallback((id: string): AppListing | undefined => {
    return apps.find(a => a.id === id);
  }, [apps]);

  const isOwned = useCallback((appId: string): boolean => {
    return shelfAppIds.has(appId);
  }, [shelfAppIds]);

  const hasVoted = useCallback((appId: string): boolean => {
    return votedAppIds.has(appId);
  }, [votedAppIds]);

  const upvoteApp = useCallback(async (appId: string): Promise<boolean> => {
    const originalUpvotes = apps.find(a => a.id === appId)?.upvotes ?? 0;

    setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: (a.upvotes || 0) + 1, hasVoted: true } : a));
    setVotedAppIds(prev => new Set(prev).add(appId));

    try {
      const res = await fetch('/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId })
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        if (Number.isFinite(data.upvotes)) {
          setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: data.upvotes, hasVoted: true } : a));
        }
        setVotedAppIds(prev => new Set(prev).add(appId));
        return true;
      } else {
        setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: originalUpvotes, hasVoted: false } : a));
        setVotedAppIds(prev => {
          const next = new Set(prev);
          next.delete(appId);
          return next;
        });
        const errorMsg = data?.error || `Upvote rejected (status ${res.status})`;
        const error = new Error(errorMsg);
        (error as any).status = res.status;
        (error as any).data = data;
        throw error;
      }
    } catch (err: any) {
      setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: originalUpvotes, hasVoted: false } : a));
      setVotedAppIds(prev => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
      throw err;
    }
  }, [apps]);

  const submitDrop = useCallback(async (dropData: Partial<AppListing>): Promise<{
    success: boolean;
    id?: string;
    error?: string;
    deploymentState?: string;
    productStatus?: string;
    repositoryId?: string | null;
    repositoryProvisioned?: boolean;
    message?: string;
  }> => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: dropData.id,
          name: dropData.name,
          tagline: dropData.tagline,
          description: dropData.description,
          creator: dropData.author || dropData.creator,
          version: dropData.version || 'v1.0.0',
          license: 'MIT',
          price: typeof dropData.price === 'number' ? `$${dropData.price}` : (dropData.price || '$15'),
          storage: dropData.storage || dropData.sqliteDatabase || 'App-managed storage',
          tags: dropData.tags || ['Shareware'],
          screenshots: dropData.screenshots || [],
          binaries: dropData.binaries || {},
          liveUrl: dropData.liveUrl || (dropData.binaries as any)?.web,
          repositoryId: dropData.repositoryId,
          grantableBps: dropData.grantableBps ?? dropData.grantable_bps,
          royaltyBps: dropData.royaltyBps ?? dropData.royalty_bps,
          resaleEnabled: dropData.resaleEnabled ?? dropData.resale_enabled,
          forkingEnabled: dropData.forkingEnabled ?? dropData.forking_enabled
        })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        const errorMsg = data?.error || `Drop submission rejected by server (HTTP ${res.status})`;
        return { success: false, error: errorMsg };
      }

      await fetchAuthoritativeCatalog({ sort: 'today', batch: 'today' });
      return {
        success: true,
        id: data.id,
        deploymentState: data.deploymentState,
        productStatus: data.productStatus,
        repositoryId: data.repositoryId,
        repositoryProvisioned: data.repositoryProvisioned,
        message: data.message
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error during drop persistence' };
    } finally {
      setIsLoading(false);
    }
  }, [fetchAuthoritativeCatalog]);

  const incrementForkCount = useCallback((_appId: string) => {
    fetchAuthoritativeCatalog();
  }, [fetchAuthoritativeCatalog]);

  return (
    <CatalogContext.Provider
      value={{
        apps,
        shelfAppIds,
        votedAppIds,
        makerLeaderboard,
        isLoading,
        isAuthoritativeLive,
        isDemoData: !isAuthoritativeLive,
        error,
        currentSort,
        currentBatch,
        getApp,
        isOwned,
        hasVoted,
        refreshCatalog: fetchAuthoritativeCatalog,
        refreshShelf: fetchShelf,
        upvoteApp,
        incrementForkCount,
        submitDrop
      }}
    >
      {children}
    </CatalogContext.Provider>
  );
};

export const useCatalog = (): CatalogContextType => {
  const context = useContext(CatalogContext);
  if (!context) {
    throw new Error('useCatalog must be used within a CatalogProvider');
  }
  return context;
};
