import { EncryptedSecretPayload, LicenseCryptoError } from './types';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  try {
    const binary = atob(base64.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err: any) {
    throw new LicenseCryptoError(`Invalid base64 string: ${err.message}`);
  }
}

export function generateBase64EncryptionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes);
}

export function generateLicenseKey(appId?: string): string {
  const rawPrefix = (appId || 'SW').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const prefix = (rawPrefix.length >= 2 ? rawPrefix.slice(0, 2) : 'SW').padEnd(2, 'X');

  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');

  const groups = hex.match(/.{4}/g);
  if (!groups || groups.length !== 8) {
    throw new LicenseCryptoError('Failed to generate a 128-bit license key');
  }
  return `NSW-${prefix}-${groups.join('-')}`;
}

export function getLicenseKeyLast4(licenseKey: string): string {
  if (typeof licenseKey !== 'string' || licenseKey.length < 4) {
    throw new LicenseCryptoError('License key must be at least 4 characters');
  }
  return licenseKey.slice(-4);
}

export async function hashLicenseKey(licenseKey: string): Promise<string> {
  if (typeof licenseKey !== 'string' || !licenseKey.trim()) {
    throw new LicenseCryptoError('License key is required for hashing');
  }
  const encoder = new TextEncoder();
  const digestBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(licenseKey.trim()));
  return Array.from(new Uint8Array(digestBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function parseEncryptionKeys(keysJson: string | undefined): Map<number, Uint8Array> {
  if (!keysJson || typeof keysJson !== 'string' || !keysJson.trim()) {
    throw new LicenseCryptoError('LICENSE_ENCRYPTION_KEYS_JSON is required and cannot be empty');
  }

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(keysJson);
  } catch (err: any) {
    throw new LicenseCryptoError(`LICENSE_ENCRYPTION_KEYS_JSON must be valid JSON: ${err.message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LicenseCryptoError('LICENSE_ENCRYPTION_KEYS_JSON must be a JSON object mapping version numbers to base64 keys');
  }

  const keyMap = new Map<number, Uint8Array>();

  for (const [versionStr, base64Key] of Object.entries(parsed)) {
    const version = parseInt(versionStr, 10);
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new LicenseCryptoError(`Invalid key version '${versionStr}': must be a positive integer`);
    }

    if (typeof base64Key !== 'string' || !base64Key.trim()) {
      throw new LicenseCryptoError(`Key version ${version} contains empty or non-string key value`);
    }

    const keyBytes = base64ToBytes(base64Key);
    if (keyBytes.length !== 32) {
      throw new LicenseCryptoError(`Key version ${version} must be 32 bytes (256-bit AES key), got ${keyBytes.length} bytes`);
    }

    keyMap.set(version, keyBytes);
  }

  if (keyMap.size === 0) {
    throw new LicenseCryptoError('LICENSE_ENCRYPTION_KEYS_JSON contains no valid key versions');
  }

  return keyMap;
}

export async function encryptLicenseSecret(
  licenseKey: string,
  env: {
    LICENSE_ENCRYPTION_KEYS_JSON?: string;
    LICENSE_ACTIVE_KEY_VERSION?: string | number;
  }
): Promise<EncryptedSecretPayload> {
  if (typeof licenseKey !== 'string' || !licenseKey.trim()) {
    throw new LicenseCryptoError('licenseKey is required for encryption');
  }

  const keyMap = parseEncryptionKeys(env?.LICENSE_ENCRYPTION_KEYS_JSON);

  const rawActiveVersion = env?.LICENSE_ACTIVE_KEY_VERSION;
  const activeVersion = rawActiveVersion ? parseInt(String(rawActiveVersion), 10) : 1;

  if (!Number.isSafeInteger(activeVersion) || activeVersion <= 0) {
    throw new LicenseCryptoError(`LICENSE_ACTIVE_KEY_VERSION must be a positive integer, received: ${rawActiveVersion}`);
  }

  const keyBytes = keyMap.get(activeVersion);
  if (!keyBytes) {
    throw new LicenseCryptoError(`Active key version ${activeVersion} not found in LICENSE_ENCRYPTION_KEYS_JSON`);
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encoder = new TextEncoder();
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    cryptoKey,
    encoder.encode(licenseKey.trim())
  );

  return {
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    ivBase64: bytesToBase64(iv),
    algorithm: 'AES-256-GCM',
    keyVersion: activeVersion
  };
}

export async function decryptLicenseSecret(
  secret: {
    ciphertextBase64: string;
    ivBase64: string;
    keyVersion: number;
  },
  env: {
    LICENSE_ENCRYPTION_KEYS_JSON?: string;
  }
): Promise<string> {
  const keyMap = parseEncryptionKeys(env?.LICENSE_ENCRYPTION_KEYS_JSON);

  const keyBytes = keyMap.get(secret.keyVersion);
  if (!keyBytes) {
    throw new LicenseCryptoError(`Key version ${secret.keyVersion} not found in LICENSE_ENCRYPTION_KEYS_JSON for decryption`);
  }

  const iv = base64ToBytes(secret.ivBase64);
  const ciphertext = base64ToBytes(secret.ciphertextBase64);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      cryptoKey,
      ciphertext as unknown as BufferSource
    );
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (err: any) {
    throw new LicenseCryptoError(`AES-GCM decryption failed: ${err.message}`);
  }
}
