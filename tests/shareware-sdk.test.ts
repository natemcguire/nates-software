import { describe, it, expect } from 'vitest';
import { validateLicenseKey } from '../src/lib/sharewareSdk';

describe('Official Shareware SDK & License Key Verification', () => {
  it('should validate cryptographic license keys for Shareware Apps', () => {
    expect(validateLicenseKey('NSW-DH-9812-77F2', 'dronehunter')).toBe(true);
    expect(validateLicenseKey('NSW-CM-4401-90B1', 'certified-mailer')).toBe(true);
    expect(validateLicenseKey('NSW-WA-1109-34K9', 'wallart')).toBe(true);
    expect(validateLicenseKey('NSW-DR-9812-77F2', 'dronehunter')).toBe(true);
  });

  it('should reject malformed or short license keys', () => {
    expect(validateLicenseKey('INVALID-KEY', 'dronehunter')).toBe(false);
    expect(validateLicenseKey('NSW-123', 'dronehunter')).toBe(false);
    expect(validateLicenseKey('', 'dronehunter')).toBe(false);
  });
});
