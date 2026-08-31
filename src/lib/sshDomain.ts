// Shared SSH Public Key Domain, Validation, and Normalization
// Authoritative rules for SSH key registration and gateway authentication.

export const ALLOWED_SSH_KEY_TYPES = [
  'ssh-ed25519',
  'ssh-rsa',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
] as const;

export type AllowedSshKeyType = typeof ALLOWED_SSH_KEY_TYPES[number];

export const SSH_BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;
export const SSH_KEY_MAX_BASE64_LEN = 16384;

export interface ParsedSshKey {
  keyType: string;
  keyBase64: string;
  keyPrefix: string;
  label?: string | null;
}

export type SshKeyValidationResult =
  | { valid: true; key: ParsedSshKey }
  | { valid: false; error: string; status: number };

/**
 * Validates discrete keyType and keyBase64 components.
 */
export function validateSshKeyComponents(
  rawKeyType: unknown,
  rawKeyBase64: unknown,
  rawLabel?: unknown
): SshKeyValidationResult {
  const keyType = typeof rawKeyType === 'string' ? rawKeyType.trim() : '';
  const keyBase64 = typeof rawKeyBase64 === 'string' ? rawKeyBase64.trim() : '';
  const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : null;

  if (!keyType || !keyBase64) {
    return { valid: false, error: 'keyType and keyBase64 are required.', status: 400 };
  }

  if (!ALLOWED_SSH_KEY_TYPES.includes(keyType as any)) {
    return { valid: false, error: 'Unsupported SSH public key type.', status: 400 };
  }

  if (!SSH_BASE64_REGEX.test(keyBase64) || keyBase64.length > SSH_KEY_MAX_BASE64_LEN) {
    return { valid: false, error: 'Malformed SSH public key.', status: 400 };
  }

  const keyPrefix = `${keyType} ${keyBase64}`;
  return {
    valid: true,
    key: {
      keyType,
      keyBase64,
      keyPrefix,
      label
    }
  };
}

/**
 * Parses and validates a full SSH public key string (e.g. "ssh-ed25519 AAAA... comment").
 * Handles arbitrary whitespace between tokens.
 */
export function parseAndValidateSshKeyString(
  rawKey: unknown,
  fallbackLabel?: unknown
): SshKeyValidationResult {
  if (typeof rawKey !== 'string' || !rawKey.trim()) {
    return { valid: false, error: 'SSH public key string is required.', status: 400 };
  }

  const parts = rawKey.trim().split(/\s+/);
  if (parts.length < 2) {
    return { valid: false, error: 'Malformed SSH public key string.', status: 400 };
  }

  const keyType = parts[0];
  const keyBase64 = parts[1];
  let label = typeof fallbackLabel === 'string' && fallbackLabel.trim() ? fallbackLabel.trim() : null;
  if (!label && parts.length >= 3) {
    label = parts.slice(2).join(' ');
  }

  return validateSshKeyComponents(keyType, keyBase64, label);
}

/**
 * Parses and validates an SSH key payload from request bodies or parameters.
 * Supports both split fields ({ keyType, keyBase64 }) and raw strings ({ publicKey / sshKey / key }).
 */
export function parseAndValidateSshKeyInput(input: {
  keyType?: unknown;
  keyBase64?: unknown;
  publicKey?: unknown;
  sshKey?: unknown;
  key?: unknown;
  label?: unknown;
}): SshKeyValidationResult {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Request body must be a valid object.', status: 400 };
  }

  const rawPublicKey = typeof (input.publicKey || input.sshKey || input.key) === 'string'
    ? String(input.publicKey || input.sshKey || input.key).trim()
    : '';

  const keyType = typeof input.keyType === 'string' ? input.keyType.trim() : '';
  const keyBase64 = typeof input.keyBase64 === 'string' ? input.keyBase64.trim() : '';
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : null;

  if (rawPublicKey && (!keyType || !keyBase64)) {
    return parseAndValidateSshKeyString(rawPublicKey, label);
  }

  if (!keyType || !keyBase64) {
    return { valid: false, error: 'keyType and keyBase64 or publicKey are required.', status: 400 };
  }

  return validateSshKeyComponents(keyType, keyBase64, label);
}
