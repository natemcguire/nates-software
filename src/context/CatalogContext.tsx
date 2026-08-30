import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AppListing, INITIAL_APPS } from '../data/mockData';
import { MakerLeaderboardEntry } from '../lib/hotwireBackend';

export interface CatalogContextType {
  apps: AppListing[];
  demoApps: AppListing[];
  shelfAppIds: Set<string>;
  makerLeaderboard: MakerLeaderboardEntry[];
  isLoading: boolean;
  isAuthoritativeLive: boolean;
  isDemoData: boolean;
  error: string | null;
  currentSort: string;
  currentBatch: string;
  getApp: (id: string) => AppListing | undefined;
  isOwned: (appId: string) => boolean;
  refreshCatalog: (opts?: { sort?: string; batch?: string }) => Promise<void>;
  upvoteApp: (appId: string) => Promise<boolean>;
  submitDrop: (dropData: Partial<AppListing>) => Promise<{ success: boolean; id?: string; error?: string }>;
  recordPurchase: (appId: string, licenseKey: string) => void;
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

const SEED_DEMO_APPS: AppListing[] = INITIAL_APPS.map(app => ({
  ...app,
  isDemo: true
}));

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Guest first-run initial state: Seed apps marked as demo, shelf completely empty
  const [apps, setApps] = useState<AppListing[]>(SEED_DEMO_APPS);
  const [shelfAppIds, setShelfAppIds] = useState<Set<string>>(new Set<string>());
  const [makerLeaderboard, setMakerLeaderboard] = useState<MakerLeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthoritativeLive, setIsAuthoritativeLive] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSort, setCurrentSort] = useState<string>('today');
  const [currentBatch, setCurrentBatch] = useState<string>('today');

  const sortRef = React.useRef(currentSort);
  const batchRef = React.useRef(currentBatch);
  sortRef.current = currentSort;
  batchRef.current = currentBatch;

  const fetchAuthoritativeCatalog = useCallback(async (opts?: { sort?: string; batch?: string }) => {
    try {
      setIsLoading(true);
      setError(null);

      const activeSort = opts?.sort ?? sortRef.current ?? 'today';
      const activeBatch = opts?.batch !== undefined ? opts.batch : (batchRef.current ?? 'today');

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

      // 1. Fetch live drops from Cloudflare D1
      const dropsRes = await fetch(`/api/drops?${params.toString()}`);
      if (dropsRes.ok) {
        const dropsData = await dropsRes.json();
        if (dropsData.success && Array.isArray(dropsData.drops)) {
          // Authoritative live response: map live drops directly WITHOUT merging seed mock data
          const liveDrops: AppListing[] = dropsData.drops.map((d: any) => {
            const parsedPrice = typeof d.price === 'string'
              ? parseInt(d.price.replace(/[^0-9.]/g, ''), 10) || 15
              : (d.price || 15);

            return {
              id: d.id,
              name: d.name || d.id,
              tagline: d.tagline || 'Built to share and multiply.',
              description: d.description || '',
              author: d.creator || d.creatorHandle || 'nate',
              authorAvatar: d.creatorAvatar || '⚡',
              creator: d.creator || d.creatorHandle || 'nate',
              creatorAvatar: d.creatorAvatar || '⚡',
              version: d.version || 'v1.0.0',
              upvotes: Number.isFinite(d.upvotes) ? d.upvotes : 0,
              forkCount: Number.isFinite(d.forks) ? d.forks : 0,
              forks: Number.isFinite(d.forks) ? d.forks : 0,
              tags: Array.isArray(d.tags) && d.tags.length > 0 ? d.tags : ['Shareware'],
              liveUrl: d.liveUrl || d.binaries?.web,
              screenshots: Array.isArray(d.screenshots) && d.screenshots.length > 0
                ? d.screenshots
                : ['https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=1000&q=80'],
              binaries: d.binaries || {},
              sqliteDatabase: d.storage || '',
              sqliteSize: d.storage ? 'Declared by app' : 'Not specified',
              price: parsedPrice,
              moddabilityScore: d.moddabilityScore || 95,
              mergeCleanliness: d.mergeCleanliness || '99.8% clean',
              comments: d.comments || [],
              deploymentState: d.deploymentState || 'draft',
              deploymentError: d.deploymentError,
              deploymentEvidence: d.deploymentEvidence || d.deploymentEvidenceJson,
              detectedProjectType: d.detectedProjectType,
              deploymentPlan: d.deploymentPlan || d.deploymentPlanJson,
              activeDeploymentId: d.activeDeploymentId,
              activeCommitOid: d.activeCommitOid,
              isDemo: false
            };
          });

          setApps(liveDrops);
          if (Array.isArray(dropsData.makerLeaderboard)) {
            setMakerLeaderboard(dropsData.makerLeaderboard);
          }
          setIsAuthoritativeLive(true);
          setError(null);
        } else {
          // Response not successful: fall back to distinct demo data
          setApps(SEED_DEMO_APPS);
          setIsAuthoritativeLive(false);
          if (dropsData?.error) {
            setError(dropsData.error);
          }
        }
      } else {
        // HTTP error: fall back to distinct demo data
        setApps(SEED_DEMO_APPS);
        setIsAuthoritativeLive(false);
        setError(`Failed to fetch live catalog (HTTP ${dropsRes.status})`);
      }

      // 2. Fetch authoritative shelf ownership (Never grant seed ownership to guests)
      try {
        const shelfRes = await fetch('/api/shelf');
        if (shelfRes.ok) {
          const shelfData = await shelfRes.json();
          if (shelfData.success && Array.isArray(shelfData.shelf)) {
            const owned = new Set<string>(shelfData.shelf.map((item: any) => item.appId || item.id));
            setShelfAppIds(owned);
          }
        }
      } catch {
        // Shelf fetch failures do not overwrite existing state
      }
    } catch (err: any) {
      setApps(SEED_DEMO_APPS);
      setIsAuthoritativeLive(false);
      setError(err.message || 'Failed to fetch authoritative catalog');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuthoritativeCatalog();
  }, [fetchAuthoritativeCatalog]);

  const getApp = useCallback((id: string): AppListing | undefined => {
    return apps.find(a => a.id === id) || SEED_DEMO_APPS.find(a => a.id === id);
  }, [apps]);

  const isOwned = useCallback((appId: string): boolean => {
    return shelfAppIds.has(appId);
  }, [shelfAppIds]);

  const upvoteApp = useCallback(async (appId: string): Promise<boolean> => {
    const originalUpvotes = apps.find(a => a.id === appId)?.upvotes ?? 0;

    // 1. Optimistic UI update
    setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: (a.upvotes || 0) + 1 } : a));

    try {
      const res = await fetch('/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId })
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        if (Number.isFinite(data.upvotes)) {
          setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: data.upvotes } : a));
        }
        return true;
      } else {
        // 2. Rollback on non-OK response or failed success flag
        setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: originalUpvotes } : a));
        const errorMsg = data?.error || `Upvote rejected (status ${res.status})`;
        const error = new Error(errorMsg);
        (error as any).status = res.status;
        (error as any).data = data;
        throw error;
      }
    } catch (err: any) {
      // 3. Rollback on network failure or thrown error
      setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: originalUpvotes } : a));
      throw err;
    }
  }, [apps]);

  const submitDrop = useCallback(async (dropData: Partial<AppListing>): Promise<{ success: boolean; id?: string; error?: string }> => {
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
          liveUrl: dropData.liveUrl || (dropData.binaries as any)?.web
        })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        const errorMsg = data?.error || `Drop submission rejected by server (HTTP ${res.status})`;
        return { success: false, error: errorMsg };
      }

      // Refresh catalog from authoritative live backend after successful persistence
      await fetchAuthoritativeCatalog({ sort: 'today', batch: 'today' });
      return { success: true, id: data.id };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error during drop persistence' };
    } finally {
      setIsLoading(false);
    }
  }, [fetchAuthoritativeCatalog]);

  const recordPurchase = useCallback((appId: string, _licenseKey: string) => {
    setShelfAppIds(prev => new Set(prev).add(appId));
  }, []);

  return (
    <CatalogContext.Provider
      value={{
        apps,
        demoApps: SEED_DEMO_APPS,
        shelfAppIds,
        makerLeaderboard,
        isLoading,
        isAuthoritativeLive,
        isDemoData: !isAuthoritativeLive,
        error,
        currentSort,
        currentBatch,
        getApp,
        isOwned,
        refreshCatalog: fetchAuthoritativeCatalog,
        upvoteApp,
        submitDrop,
        recordPurchase
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
