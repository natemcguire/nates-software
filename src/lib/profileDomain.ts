// Production Domain Logic for PROFILE.CFG & My Shelf
// Truthful First-Run Architecture & Cryptographic Entitlements

export interface PublicMakerProfile {
  readonly username: string;
  readonly displayName: string;
  readonly avatar: string;
  readonly bio: string;
  readonly isVerified: boolean;
  readonly createdAt?: string;
  readonly publishedCount?: number;
}

export interface AuthenticatedUserProfile {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatar: string;
  readonly bio: string;
  readonly sshKey: string;
  readonly stripeAccountId: string | null;
  readonly stripeStatus: 'not_connected' | 'pending' | 'active' | 'connected';
  readonly payoutsEnabled: boolean;
  readonly isVerified: boolean;
  readonly role: string;
  readonly createdAt?: string;
}

export interface ShelfItem {
  readonly id: string;
  readonly appId: string;
  readonly name: string;
  readonly version: string;
  readonly tagline: string;
  readonly storage: string;
  readonly licenseKeyLast4: string;
  readonly maskedKey: string;
  readonly purchasedDate: string;
  readonly creatorAvatar?: string;
  readonly creatorUsername?: string;
  readonly liveUrl?: string;
  readonly status: 'active' | 'revoked' | 'refunded';
  readonly source: 'commerce' | 'legacy';
  readonly screenshots?: string[];
  readonly binaries?: Record<string, any>;
}

export interface LineageBreakdownItem {
  readonly appId: string;
  readonly name: string;
  readonly slug: string;
  readonly forks: number;
  readonly directEarnedCents: number;
  readonly lineageEarnedCents: number;
  readonly totalCents: number;
}

export interface MakerRoyaltiesSummary {
  readonly makerBalanceCents: number;
  readonly makerSalesCents: number;
  readonly lineageEarnedCents: number;
  readonly lineageBreakdown: LineageBreakdownItem[];
}

export interface ProfileValidationInput {
  username?: string;
  displayName?: string;
  avatar?: string;
  bio?: string;
  sshKey?: string | null;
}

/**
 * Validates maker profile fields against security and format rules.
 */
export function validateMakerProfile(profile: ProfileValidationInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (profile.username !== undefined) {
    if (!profile.username || !/^[a-z0-9-_]{2,30}$/.test(profile.username)) {
      errors.push('Username must be 2-30 characters containing only lowercase alphanumeric, dash, or underscore.');
    }
  }

  if (profile.displayName !== undefined) {
    if (!profile.displayName || profile.displayName.trim().length < 2) {
      errors.push('Display name must be at least 2 characters.');
    } else if (profile.displayName.length > 50) {
      errors.push('Display name must not exceed 50 characters.');
    }
  }

  if (profile.bio !== undefined && profile.bio && profile.bio.length > 500) {
    errors.push('Bio must not exceed 500 characters.');
  }

  if (profile.avatar !== undefined && profile.avatar && profile.avatar.length > 300) {
    errors.push('Avatar must not exceed 300 characters.');
  }

  if (profile.sshKey !== undefined && profile.sshKey) {
    const trimmed = profile.sshKey.trim();
    const validPrefixes = ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-dss'];
    const startsWithValidPrefix = validPrefixes.some(prefix => trimmed.startsWith(prefix));
    if (!startsWithValidPrefix) {
      errors.push('SSH key must start with valid protocol prefix (e.g. ssh-ed25519, ssh-rsa, or ecdsa-sha2-nistp256).');
    } else if (trimmed.split(/\s+/).length < 2) {
      errors.push('SSH key must contain at least the key type and the base64-encoded key.');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Safely masks a license key for display in UI and public-safe API responses.
 * Never leaks the high-entropy body or plaintext secret.
 * Output example: "NSW-DH-••••-77F2"
 */
export function maskLicenseKey(rawKey: string | undefined, appId?: string): string {
  if (!rawKey || typeof rawKey !== 'string') {
    const prefix = ((appId || 'SW').slice(0, 2)).toUpperCase();
    return `NSW-${prefix}-••••-0000`;
  }

  const trimmed = rawKey.trim();
  const last4 = trimmed.length >= 4 ? trimmed.slice(-4) : trimmed.padStart(4, '0');

  const prefixMatch = trimmed.match(/^NSW-([A-Z0-9]+)-/i);
  let prefix = prefixMatch ? prefixMatch[1].toUpperCase() : ((appId || 'SW').slice(0, 2)).toUpperCase();
  if (prefix.length > 12) prefix = prefix.slice(0, 12);

  return `NSW-${prefix}-••••-${last4}`;
}

/**
 * Extracts the last 4 characters of a license key.
 */
export function extractLicenseKeyLast4(rawKey: string): string {
  if (!rawKey || typeof rawKey !== 'string') return '0000';
  const trimmed = rawKey.trim();
  return trimmed.length >= 4 ? trimmed.slice(-4) : trimmed.padStart(4, '0');
}

/**
 * Sanitizes a raw database user record into a strictly public maker profile.
 * Guarantees zero leakage of private credentials, Stripe accounts, or full licenses.
 */
export function sanitizePublicProfile(rawUser: any): PublicMakerProfile {
  if (!rawUser) {
    throw new Error('rawUser is required for sanitization');
  }

  return {
    username: String(rawUser.username || ''),
    displayName: String(rawUser.display_name || rawUser.displayName || rawUser.username || 'Anonymous Maker'),
    avatar: String(rawUser.avatar_url || rawUser.avatar || '📦'),
    bio: String(rawUser.bio || ''),
    isVerified: Boolean(rawUser.is_verified_maker || rawUser.isVerified),
    createdAt: rawUser.created_at || rawUser.createdAt || undefined
  };
}

/**
 * Formats integer cents to USD currency string.
 * Example: 242000 -> "$2,420.00"
 */
export function formatCentsToUsd(cents: number): string {
  const safeCents = Number.isFinite(cents) && cents >= 0 ? cents : 0;
  const dollars = safeCents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(dollars);
}

/**
 * Calculates maker royalties summary from authoritative allocation records.
 */
export function calculateMakerEconomics(
  allocations: Array<{ role: string; amount_cents: number; app_id?: string; name?: string }> = []
): MakerRoyaltiesSummary {
  let makerSalesCents = 0;
  let lineageEarnedCents = 0;
  const breakdownMap = new Map<string, { direct: number; lineage: number; name: string }>();

  for (const alloc of allocations) {
    const cents = Number(alloc.amount_cents) || 0;
    const appId = alloc.app_id || 'unknown';
    const appName = alloc.name || appId;

    if (!breakdownMap.has(appId)) {
      breakdownMap.set(appId, { direct: 0, lineage: 0, name: appName });
    }
    const entry = breakdownMap.get(appId)!;

    if (alloc.role === 'maker') {
      makerSalesCents += cents;
      entry.direct += cents;
    } else if (alloc.role === 'ancestor') {
      lineageEarnedCents += cents;
      entry.lineage += cents;
    }
  }

  const lineageBreakdown: LineageBreakdownItem[] = Array.from(breakdownMap.entries()).map(([appId, item]) => ({
    appId,
    name: item.name,
    slug: `maker/${appId}`,
    forks: 0,
    directEarnedCents: item.direct,
    lineageEarnedCents: item.lineage,
    totalCents: item.direct + item.lineage
  }));

  return {
    makerBalanceCents: makerSalesCents + lineageEarnedCents,
    makerSalesCents,
    lineageEarnedCents,
    lineageBreakdown
  };
}
