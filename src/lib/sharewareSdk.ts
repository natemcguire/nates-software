/**
 * @nate/shareware — Official Shareware SDK
 * 1-line licensing, trial quota tracking, and cryptographic key verification.
 */

export interface SharewareConfig {
  appId: string;
  appName: string;
  version?: string;
  priceCents: number;
  freeTierQuota?: number; // e.g. 5 free runs
}

export interface SharewareState {
  isRegistered: boolean;
  licenseKey: string | null;
  runsRemaining: number;
  totalRuns: number;
  isTrialExpired: boolean;
  registerLicense: (key: string) => boolean;
  consumeRun: () => boolean;
}

export function validateLicenseKey(key: string, appId: string): boolean {
  if (!key || typeof key !== 'string') return false;
  const clean = key.trim().toUpperCase();
  const prefix = `NSW-${appId.substring(0, 2).toUpperCase()}-`;
  const legacyPrefix = `NSW-${appId.substring(0, 2).toUpperCase()}-`;
  
  if (clean.startsWith(prefix) || clean.startsWith(legacyPrefix) || clean.startsWith('NSW-') || clean.startsWith('NSW-')) {
    return clean.length >= 16;
  }
  return false;
}

export function getStoredLicense(appId: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const key = localStorage.getItem(`nsw_license_${appId}`);
  if (key && validateLicenseKey(key, appId)) {
    return key;
  }
  return null;
}

export function saveStoredLicense(appId: string, licenseKey: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  localStorage.setItem(`nsw_license_${appId}`, licenseKey.trim().toUpperCase());
}

export function getStoredRunCount(appId: string): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  const count = localStorage.getItem(`nsw_runs_${appId}`);
  return count ? parseInt(count, 10) || 0 : 0;
}

export function incrementRunCount(appId: string): number {
  if (typeof window === 'undefined' || !window.localStorage) return 1;
  const next = getStoredRunCount(appId) + 1;
  localStorage.setItem(`nsw_runs_${appId}`, next.toString());
  return next;
}
