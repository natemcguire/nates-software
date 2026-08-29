import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AppListing, INITIAL_APPS } from '../data/mockData';

export interface CatalogContextType {
  apps: AppListing[];
  shelfAppIds: Set<string>;
  isLoading: boolean;
  isAuthoritativeLive: boolean;
  error: string | null;
  getApp: (id: string) => AppListing | undefined;
  isOwned: (appId: string) => boolean;
  refreshCatalog: () => Promise<void>;
  upvoteApp: (appId: string) => Promise<boolean>;
  recordPurchase: (appId: string, licenseKey: string) => void;
}

const CatalogContext = createContext<CatalogContextType | undefined>(undefined);

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apps, setApps] = useState<AppListing[]>(INITIAL_APPS);
  const [shelfAppIds, setShelfAppIds] = useState<Set<string>>(new Set(['dronehunter', 'certified-mailer', 'picfitai']));
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAuthoritativeLive, setIsAuthoritativeLive] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAuthoritativeCatalog = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 1. Fetch live drops from D1
      const dropsRes = await fetch('/api/drops?sort=newest');
      if (dropsRes.ok) {
        const dropsData = await dropsRes.json();
        if (dropsData.success && Array.isArray(dropsData.drops) && dropsData.drops.length > 0) {
          // Merge authoritative D1 drops with mock seed fallbacks
          const liveAppMap = new Map<string, AppListing>();

          // Seed defaults
          INITIAL_APPS.forEach(app => liveAppMap.set(app.id, app));

          // Overlay live authoritative D1 drops
          dropsData.drops.forEach((d: any) => {
            const existing = liveAppMap.get(d.id);
            const parsedPrice = typeof d.price === 'string' 
              ? parseInt(d.price.replace(/[^0-9]/g, ''), 10) || 15 
              : (d.price || 15);

            liveAppMap.set(d.id, {
              id: d.id,
              name: d.name || existing?.name || d.id,
              tagline: d.tagline || existing?.tagline || 'Built to share and multiply.',
              description: d.description || existing?.description || '',
              author: d.creator || d.creatorHandle || existing?.author || 'nate',
              authorAvatar: d.creatorAvatar || existing?.authorAvatar || '⚡',
              creator: d.creator || d.creatorHandle || existing?.creator || 'nate',
              creatorAvatar: d.creatorAvatar || existing?.creatorAvatar || '⚡',
              version: d.version || existing?.version || 'v1.0.0',
              upvotes: Number.isFinite(d.upvotes) ? d.upvotes : (existing?.upvotes || 0),
              forkCount: Number.isFinite(d.forks) ? d.forks : (existing?.forkCount || 0),
              forks: Number.isFinite(d.forks) ? d.forks : (existing?.forks || 0),
              tags: Array.isArray(d.tags) && d.tags.length > 0 ? d.tags : (existing?.tags || ['Shareware']),
              screenshots: Array.isArray(d.screenshots) && d.screenshots.length > 0 ? d.screenshots : (existing?.screenshots || []),
              binaries: d.binaries || existing?.binaries || {},
              sqliteDatabase: d.storage || existing?.sqliteDatabase || '/data/app.sqlite',
              sqliteSize: '1.4 MB',
              price: parsedPrice,
              moddabilityScore: d.moddabilityScore || existing?.moddabilityScore || 95,
              mergeCleanliness: d.mergeCleanliness || existing?.mergeCleanliness || '99.8% clean',
              comments: d.comments || existing?.comments || []
            });
          });

          setApps(Array.from(liveAppMap.values()));
          setIsAuthoritativeLive(true);
        } else {
          setIsAuthoritativeLive(false);
        }
      } else {
        setIsAuthoritativeLive(false);
      }

      // 2. Fetch authoritative shelf ownership
      const shelfRes = await fetch('/api/shelf');
      if (shelfRes.ok) {
        const shelfData = await shelfRes.json();
        if (shelfData.success && Array.isArray(shelfData.shelf)) {
          const owned = new Set<string>(shelfData.shelf.map((item: any) => item.appId || item.id));
          // Always ensure default seed titles are visible on shelf for preview
          owned.add('dronehunter');
          owned.add('certified-mailer');
          owned.add('picfitai');
          setShelfAppIds(owned);
        }
      }
    } catch (err: any) {
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
    return apps.find(a => a.id === id) || INITIAL_APPS.find(a => a.id === id);
  }, [apps]);

  const isOwned = useCallback((appId: string): boolean => {
    return shelfAppIds.has(appId);
  }, [shelfAppIds]);

  const upvoteApp = useCallback(async (appId: string): Promise<boolean> => {
    // Optimistic UI update
    setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: (a.upvotes || 0) + 1 } : a));

    try {
      const res = await fetch('/api/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Number.isFinite(data.upvotes)) {
          setApps(prev => prev.map(a => a.id === appId ? { ...a, upvotes: data.upvotes } : a));
        }
        return true;
      }
    } catch {}
    return false;
  }, []);

  const recordPurchase = useCallback((appId: string, _licenseKey: string) => {
    setShelfAppIds(prev => new Set(prev).add(appId));
  }, []);

  return (
    <CatalogContext.Provider
      value={{
        apps,
        shelfAppIds,
        isLoading,
        isAuthoritativeLive,
        error,
        getApp,
        isOwned,
        refreshCatalog: fetchAuthoritativeCatalog,
        upvoteApp,
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
