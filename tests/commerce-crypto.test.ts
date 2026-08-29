import { describe, it, expect } from 'vitest';
import {
  generateLicenseKey,
  getLicenseKeyLast4,
  hashLicenseKey,
  generateBase64EncryptionKey,
  parseEncryptionKeys,
  encryptLicenseSecret,
  decryptLicenseSecret,
  bytesToBase64,
  base64ToBytes
} from '../src/lib/commerce/licenseCrypto';
import { LicenseCryptoError } from '../src/lib/commerce/types';

describe('Durable Commerce P2: Cryptographic License & Secret Engine', () => {
  const keyV1 = generateBase64EncryptionKey();
  const keyV2 = generateBase64EncryptionKey();
  const validKeysJson = JSON.stringify({
    '1': keyV1,
    '2': keyV2
  });

  // ==========================================================================
  // 1. LICENSE KEY GENERATION & HASHING
  // ==========================================================================
  describe('1. License Key Generation, Hashing & Formatting', () => {
    it('generates a formatted license key with application prefix', () => {
      const key = generateLicenseKey('dronehunter');
      expect(key).toMatch(/^NSW-DR-[0-9A-F]{4}-[0-9A-F]{4}$/);
    });

    it('generates unique cryptographic keys across iterations', () => {
      const set = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const key = generateLicenseKey('wallart');
        expect(set.has(key)).toBe(false);
        set.add(key);
      }
      expect(set.size).toBe(100);
    });

    it('extracts exactly the last 4 characters of a license key', () => {
      const key = 'NSW-DH-ABCD-1234';
      expect(getLicenseKeyLast4(key)).toBe('1234');
    });

    it('computes 64-char lowercase SHA-256 hex hash', async () => {
      const key = 'NSW-DH-8F12-9A4B';
      const hash = await hashLicenseKey(key);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);

      // Deterministic hash check
      const hash2 = await hashLicenseKey(key);
      expect(hash).toBe(hash2);

      // Different key produces different hash
      const hash3 = await hashLicenseKey('NSW-DH-8F12-9A4C');
      expect(hash).not.toBe(hash3);
    });

    it('rejects empty or whitespace keys for hashing and last4 extraction', async () => {
      await expect(hashLicenseKey('')).rejects.toThrow(LicenseCryptoError);
      await expect(hashLicenseKey('   ')).rejects.toThrow(LicenseCryptoError);
      expect(() => getLicenseKeyLast4('abc')).toThrow(LicenseCryptoError);
    });
  });

  // ==========================================================================
  // 2. ENCRYPTION KEY PARSING & VALIDATION
  // ==========================================================================
  describe('2. Versioned Encryption Key Map Parsing', () => {
    it('successfully parses single and multi-version key maps', () => {
      const map = parseEncryptionKeys(validKeysJson);
      expect(map.size).toBe(2);
      expect(map.get(1)).toHaveLength(32);
      expect(map.get(2)).toHaveLength(32);
    });

    it('rejects missing or empty LICENSE_ENCRYPTION_KEYS_JSON', () => {
      expect(() => parseEncryptionKeys(undefined)).toThrow(LicenseCryptoError);
      expect(() => parseEncryptionKeys('')).toThrow(LicenseCryptoError);
      expect(() => parseEncryptionKeys('  ')).toThrow(LicenseCryptoError);
    });

    it('rejects invalid JSON syntax', () => {
      expect(() => parseEncryptionKeys('{ invalid json ')).toThrow(LicenseCryptoError);
      expect(() => parseEncryptionKeys('["array", "not", "object"]')).toThrow(LicenseCryptoError);
    });

    it('rejects non-positive integer key version numbers', () => {
      expect(() => parseEncryptionKeys(JSON.stringify({ '-1': keyV1 }))).toThrow(LicenseCryptoError);
      expect(() => parseEncryptionKeys(JSON.stringify({ '0': keyV1 }))).toThrow(LicenseCryptoError);
      expect(() => parseEncryptionKeys(JSON.stringify({ 'v1': keyV1 }))).toThrow(LicenseCryptoError);
    });

    it('rejects keys that are not exactly 32 bytes (256-bit)', () => {
      const shortKey = bytesToBase64(new Uint8Array(16)); // 128-bit
      const longKey = bytesToBase64(new Uint8Array(64)); // 512-bit

      expect(() => parseEncryptionKeys(JSON.stringify({ '1': shortKey }))).toThrow(/must be 32 bytes/);
      expect(() => parseEncryptionKeys(JSON.stringify({ '1': longKey }))).toThrow(/must be 32 bytes/);
    });
  });

  // ==========================================================================
  // 3. AES-256-GCM ENCRYPTION & DECRYPTION ROUNDTRIP
  // ==========================================================================
  describe('3. AES-256-GCM Encryption, Decryption & Key Rotation', () => {
    it('successfully encrypts and decrypts a license key with active version 1', async () => {
      const licenseKey = 'NSW-DH-A1B2-C3D4';
      const env = {
        LICENSE_ENCRYPTION_KEYS_JSON: validKeysJson,
        LICENSE_ACTIVE_KEY_VERSION: '1'
      };

      const encrypted = await encryptLicenseSecret(licenseKey, env);

      expect(encrypted.algorithm).toBe('AES-256-GCM');
      expect(encrypted.keyVersion).toBe(1);
      expect(encrypted.ciphertextBase64).toBeTruthy();
      expect(encrypted.ivBase64).toBeTruthy();

      const decrypted = await decryptLicenseSecret(encrypted, env);
      expect(decrypted).toBe(licenseKey);
    });

    it('generates unique IVs and ciphertexts for identical plaintext inputs', async () => {
      const licenseKey = 'NSW-DH-A1B2-C3D4';
      const env = {
        LICENSE_ENCRYPTION_KEYS_JSON: validKeysJson,
        LICENSE_ACTIVE_KEY_VERSION: 1
      };

      const enc1 = await encryptLicenseSecret(licenseKey, env);
      const enc2 = await encryptLicenseSecret(licenseKey, env);

      // IVs must be random and unique
      expect(enc1.ivBase64).not.toBe(enc2.ivBase64);
      // Ciphertexts must differ due to unique IVs
      expect(enc1.ciphertextBase64).not.toBe(enc2.ciphertextBase64);

      // Both decrypt back to identical plaintext
      expect(await decryptLicenseSecret(enc1, env)).toBe(licenseKey);
      expect(await decryptLicenseSecret(enc2, env)).toBe(licenseKey);
    });

    it('supports key rotation: decrypts secrets created with version 1 while encrypting with version 2', async () => {
      const licenseKey1 = 'NSW-WA-1111-2222';
      const licenseKey2 = 'NSW-WA-3333-4444';

      // Secret 1 encrypted with key version 1
      const encV1 = await encryptLicenseSecret(licenseKey1, {
        LICENSE_ENCRYPTION_KEYS_JSON: validKeysJson,
        LICENSE_ACTIVE_KEY_VERSION: '1'
      });
      expect(encV1.keyVersion).toBe(1);

      // Secret 2 encrypted with active key version 2
      const encV2 = await encryptLicenseSecret(licenseKey2, {
        LICENSE_ENCRYPTION_KEYS_JSON: validKeysJson,
        LICENSE_ACTIVE_KEY_VERSION: '2'
      });
      expect(encV2.keyVersion).toBe(2);

      // Both decrypt correctly from the multi-key map
      const multiKeyEnv = { LICENSE_ENCRYPTION_KEYS_JSON: validKeysJson };
      expect(await decryptLicenseSecret(encV1, multiKeyEnv)).toBe(licenseKey1);
      expect(await decryptLicenseSecret(encV2, multiKeyEnv)).toBe(licenseKey2);
    });

    it('fails honestly when active key version does not exist in key map', async () => {
      await expect(
        encryptLicenseSecret('NSW-DH-1234-5678', {
          LICENSE_ENCRYPTION_KEYS_JSON: validKeysJson,
          LICENSE_ACTIVE_KEY_VERSION: 99 // version 99 does not exist
        })
      ).rejects.toThrow(/Active key version 99 not found/);
    });

    it('detects tampering in ciphertext and rejects with authentication failure', async () => {
      const licenseKey = 'NSW-DH-TAMPER-TEST';
      const env = {
        LICENSE_ENCRYPTION_KEYS_JSON: validKeysJson,
        LICENSE_ACTIVE_KEY_VERSION: 1
      };

      const encrypted = await encryptLicenseSecret(licenseKey, env);

      // Flip a bit in the ciphertext
      const rawCipher = base64ToBytes(encrypted.ciphertextBase64);
      rawCipher[0] ^= 0x01;
      const tamperedCiphertextBase64 = bytesToBase64(rawCipher);

      await expect(
        decryptLicenseSecret(
          {
            ...encrypted,
            ciphertextBase64: tamperedCiphertextBase64
          },
          env
        )
      ).rejects.toThrow(/AES-GCM decryption failed/);
    });

    it('detects tampering in IV and rejects with authentication failure', async () => {
      const licenseKey = 'NSW-DH-TAMPER-IV-TEST';
      const env = {
        LICENSE_ENCRYPTION_KEYS_JSON: validKeysJson,
        LICENSE_ACTIVE_KEY_VERSION: 1
      };

      const encrypted = await encryptLicenseSecret(licenseKey, env);

      // Flip a bit in the IV
      const rawIv = base64ToBytes(encrypted.ivBase64);
      rawIv[0] ^= 0xff;
      const tamperedIvBase64 = bytesToBase64(rawIv);

      await expect(
        decryptLicenseSecret(
          {
            ...encrypted,
            ivBase64: tamperedIvBase64
          },
          env
        )
      ).rejects.toThrow(/AES-GCM decryption failed/);
    });
  });
});
