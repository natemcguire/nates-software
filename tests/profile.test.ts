import { describe, it, expect } from 'vitest';
import { validateMakerProfile } from '../src/lib/profileDomain';

describe('PROFILE.CFG Maker Identity & Shelf Invariants', () => {
  it('should accept valid maker profile', () => {
    const valid = {
      username: 'nate',
      displayName: 'Nate McGuire',
      avatar: '⚡',
      bio: 'Founder at East Bay Projects.',
      sshKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxY8... nate@macmini',
      isVerified: true
    };
    expect(validateMakerProfile(valid).valid).toBe(true);
  });

  it('should reject invalid usernames with special characters', () => {
    const invalid = {
      username: 'nate@admin.dev',
      displayName: 'Nate'
    };
    const result = validateMakerProfile(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Username must be 2-30 characters');
  });

  it('should reject malformed SSH keys', () => {
    const invalid = {
      username: 'nate',
      displayName: 'Nate',
      sshKey: 'invalid-random-key'
    };
    const result = validateMakerProfile(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('SSH key must start with valid protocol');
  });
});
