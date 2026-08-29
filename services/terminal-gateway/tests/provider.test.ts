import { describe, it, expect } from 'vitest';
import { LocalProcessProvider } from '../src/providers/LocalProcessProvider.js';
import { DaytonaSandboxProvider } from '../src/providers/DaytonaSandboxProvider.js';

describe('Terminal Gateway Provider Abstractions & Truthful Isolation', () => {
  it('LocalProcessProvider truthfully reports process isolation and non-production status', () => {
    const provider = new LocalProcessProvider();
    expect(provider.id).toBe('local-process');
    expect(provider.isolationType).toBe('process');
    expect(provider.isProductionVps).toBe(false);
    expect(provider.description).toContain('Non-Production');
    expect(provider.description).toContain('disposable /tmp directories');
    expect(provider.getTruthStatement()).toContain('NON-PRODUCTION DEVELOPMENT PROVIDER');
  });

  it('DaytonaSandboxProvider requires verified VM snapshot and credentials', () => {
    expect(() => new DaytonaSandboxProvider({
      apiKey: '',
      snapshot: '',
      ttlMinutes: 15,
      vmIsolationVerified: false
    })).toThrow(/Daytona VM provider requires/);

    expect(() => new DaytonaSandboxProvider({
      apiKey: 'test-key',
      snapshot: 'snap-1',
      ttlMinutes: 15,
      vmIsolationVerified: false
    })).toThrow(/DAYTONA_VM_ISOLATION_VERIFIED=true/);
  });

  it('DaytonaSandboxProvider truthfully reports VPS hardware virtualization isolation when verified', () => {
    const mockDaytonaClient = {} as any;
    const provider = new DaytonaSandboxProvider({
      apiKey: 'test-key',
      snapshot: 'verified-vm-snap-v1',
      ttlMinutes: 15,
      vmIsolationVerified: true
    }, mockDaytonaClient);

    expect(provider.id).toBe('daytona-ephemeral-vm');
    expect(provider.isolationType).toBe('vps');
    expect(provider.isProductionVps).toBe(true);
    expect(provider.description).toContain('Daytona VM sandbox');
    expect(provider.getTruthStatement()).toContain('PRODUCTION VM ISOLATION');
  });

  it('BaseTerminalProvider tracks statistics accurately', () => {
    const provider = new LocalProcessProvider();
    const stats = provider.getStats();
    expect(stats.activeSessions).toBe(0);
    expect(stats.totalSessionsCreated).toBe(0);
  });
});
