// Production Domain Logic for PROFILE.CFG & My Shelf

export interface MakerProfile {
  readonly username: string;
  readonly displayName: string;
  readonly avatar: string;
  readonly bio: string;
  readonly sshKey: string;
  readonly isVerified: boolean;
}

export interface ShelfItem {
  readonly id: string;
  readonly appId: string;
  readonly name: string;
  readonly version: string;
  readonly tagline: string;
  readonly licenseKey: string;
  readonly purchasedDate: string;
  readonly localDbSize: string;
  readonly creatorAvatar: string;
}

export function validateMakerProfile(profile: Partial<MakerProfile>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!profile.username || !profile.username.match(/^[a-z0-9-_]{2,30}$/)) {
    errors.push('Username must be 2-30 characters containing only lowercase alphanumeric, dash, or underscore.');
  }

  if (!profile.displayName || profile.displayName.trim().length < 2) {
    errors.push('Display name must be at least 2 characters.');
  }

  if (profile.sshKey && !profile.sshKey.startsWith('ssh-')) {
    errors.push('SSH key must start with valid protocol prefix (e.g. ssh-ed25519 or ssh-rsa).');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
