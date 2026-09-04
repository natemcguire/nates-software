import { describe, it, expect } from 'vitest';
import {
  ALLOWED_SSH_KEY_TYPES,
  validateSshKeyComponents,
  parseAndValidateSshKeyString,
  parseAndValidateSshKeyInput,
  SSH_KEY_MAX_BASE64_LEN
} from '../src/lib/sshDomain';

describe('Shared SSH Public Key Domain & Validator (sshDomain.ts)', () => {
  const ED25519_B64 = 'AAAAC3NzaC1lZDI1NTE5AAAAIGxY84pQ4eM19287KlmQ4892187';
  const RSA_B64 = 'AAAAB3NzaC1yc2EAAAADAQABAAABAQCalice';
  const ECDSA_256_B64 = 'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbob';
  const ECDSA_384_B64 = 'AAAAE2VjZHNhLXNoYTItbmlzdHAzODQAAAAIbob';
  const ECDSA_521_B64 = 'AAAAE2VjZHNhLXNoYTItbmlzdHA1MjEAAAAIbob';

  describe('ALLOWED_SSH_KEY_TYPES', () => {
    it('contains all required modern key algorithms and excludes obsolete algorithms', () => {
      expect(ALLOWED_SSH_KEY_TYPES).toEqual([
        'ssh-ed25519',
        'ssh-rsa',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521'
      ]);
      expect((ALLOWED_SSH_KEY_TYPES as readonly string[]).includes('ssh-dss')).toBe(false);
    });
  });

  describe('validateSshKeyComponents', () => {
    it('accepts valid components across all allowed types', () => {
      for (const [type, b64] of [
        ['ssh-ed25519', ED25519_B64],
        ['ssh-rsa', RSA_B64],
        ['ecdsa-sha2-nistp256', ECDSA_256_B64],
        ['ecdsa-sha2-nistp384', ECDSA_384_B64],
        ['ecdsa-sha2-nistp521', ECDSA_521_B64]
      ]) {
        const res = validateSshKeyComponents(type, b64, 'test-label');
        expect(res.valid).toBe(true);
        if (res.valid) {
          expect(res.key.keyType).toBe(type);
          expect(res.key.keyBase64).toBe(b64);
          expect(res.key.keyPrefix).toBe(`${type} ${b64}`);
          expect(res.key.label).toBe('test-label');
        }
      }
    });

    it('rejects missing or empty keyType or keyBase64', () => {
      expect(validateSshKeyComponents('', ED25519_B64)).toMatchObject({
        valid: false,
        error: 'keyType and keyBase64 are required.',
        status: 400
      });
      expect(validateSshKeyComponents('ssh-ed25519', '')).toMatchObject({
        valid: false,
        error: 'keyType and keyBase64 are required.',
        status: 400
      });
    });

    it('rejects unsupported key types', () => {
      const res = validateSshKeyComponents('ssh-dss', ED25519_B64);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toBe('Unsupported SSH public key type.');
        expect(res.status).toBe(400);
      }
    });

    it('rejects malformed base64 strings', () => {
      const invalidBlobs = [
        'INVALID!BASE64',
        'AAA AC3Nza',
        'AAAA===',
        'AAAA#@$%',
      ];
      for (const blob of invalidBlobs) {
        const res = validateSshKeyComponents('ssh-ed25519', blob);
        expect(res.valid).toBe(false);
        if (!res.valid) {
          expect(res.error).toBe('Malformed SSH public key.');
          expect(res.status).toBe(400);
        }
      }
    });

    it('rejects base64 strings exceeding length cap (16384)', () => {
      const oversized = 'A'.repeat(SSH_KEY_MAX_BASE64_LEN + 1);
      const res = validateSshKeyComponents('ssh-ed25519', oversized);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toBe('Malformed SSH public key.');
        expect(res.status).toBe(400);
      }
    });
  });

  describe('parseAndValidateSshKeyString', () => {
    it('parses comment-bearing SSH public key strings', () => {
      const raw = `ssh-ed25519 ${ED25519_B64} nate@macmini`;
      const res = parseAndValidateSshKeyString(raw);
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.key.keyType).toBe('ssh-ed25519');
        expect(res.key.keyBase64).toBe(ED25519_B64);
        expect(res.key.keyPrefix).toBe(`ssh-ed25519 ${ED25519_B64}`);
        expect(res.key.label).toBe('nate@macmini');
      }
    });

    it('parses tab-separated and multi-space strings', () => {
      const raw = `   ssh-rsa\t\t${RSA_B64}\t\tworkstation comment with spaces   `;
      const res = parseAndValidateSshKeyString(raw);
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.key.keyType).toBe('ssh-rsa');
        expect(res.key.keyBase64).toBe(RSA_B64);
        expect(res.key.keyPrefix).toBe(`ssh-rsa ${RSA_B64}`);
        expect(res.key.label).toBe('workstation comment with spaces');
      }
    });

    it('rejects single-token or empty strings', () => {
      expect(parseAndValidateSshKeyString('')).toMatchObject({
        valid: false,
        error: 'SSH public key string is required.',
        status: 400
      });
      expect(parseAndValidateSshKeyString('ssh-ed25519')).toMatchObject({
        valid: false,
        error: 'Malformed SSH public key string.',
        status: 400
      });
    });
  });

  describe('parseAndValidateSshKeyInput', () => {
    it('parses discrete object inputs { keyType, keyBase64, label }', () => {
      const res = parseAndValidateSshKeyInput({
        keyType: 'ssh-ed25519',
        keyBase64: ED25519_B64,
        label: 'my-laptop'
      });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.key.keyPrefix).toBe(`ssh-ed25519 ${ED25519_B64}`);
        expect(res.key.label).toBe('my-laptop');
      }
    });

    it('parses raw string in publicKey / sshKey / key property', () => {
      const res = parseAndValidateSshKeyInput({
        publicKey: `ssh-ed25519 ${ED25519_B64} agent-key`
      });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.key.keyPrefix).toBe(`ssh-ed25519 ${ED25519_B64}`);
        expect(res.key.label).toBe('agent-key');
      }
    });

    it('rejects non-object or empty payload', () => {
      expect(parseAndValidateSshKeyInput(null as any)).toMatchObject({
        valid: false,
        status: 400
      });
      expect(parseAndValidateSshKeyInput({})).toMatchObject({
        valid: false,
        status: 400
      });
    });
  });
});
