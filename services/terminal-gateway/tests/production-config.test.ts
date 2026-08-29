import { describe, expect, it } from 'vitest';
import { assertProductionConfig, DEFAULT_CONFIG } from '../src/server.js';

const validConfig = () => ({
  ...DEFAULT_CONFIG,
  tokenSecret: 't'.repeat(32),
  gatewayServiceSecret: 'g'.repeat(32),
  redeemUrl: 'https://nates-software.com/api/terminal-session',
  allowedOrigins: [
    'https://nates-software.com',
    'https://nates-software.pages.dev',
    'https://*.nates-software.pages.dev'
  ],
  validTokens: []
});

describe('production gateway configuration', () => {
  it('accepts only the signed-ticket topology with explicit official HTTPS origins', () => {
    expect(() => assertProductionConfig(validConfig())).not.toThrow();
  });

  it('fails closed for missing secrets, insecure callbacks, broad origins, or static tokens', () => {
    expect(() => assertProductionConfig({ ...validConfig(), tokenSecret: '' })).toThrow(/TICKET_SECRET/);
    expect(() => assertProductionConfig({ ...validConfig(), gatewayServiceSecret: 'short' })).toThrow(/SERVICE_SECRET/);
    expect(() => assertProductionConfig({ ...validConfig(), redeemUrl: 'http://localhost/redeem' })).toThrow(/HTTPS/);
    expect(() => assertProductionConfig({ ...validConfig(), allowedOrigins: ['*'] })).toThrow(/explicit HTTPS origins/);
    expect(() => assertProductionConfig({ ...validConfig(), allowedOrigins: ['https://*.pages.dev'] })).toThrow(/explicit HTTPS origins/);
    expect(() => assertProductionConfig({ ...validConfig(), validTokens: ['shared-secret'] })).toThrow(/static VALID_TOKENS/);
  });
});
