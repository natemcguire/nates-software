import { describe, it, expect } from 'vitest';
import { LocalProcessProvider } from '../src/providers/LocalProcessProvider.js';
import { ContainerProvider } from '../src/providers/ContainerProvider.js';
import { VpsMicroVmProvider } from '../src/providers/VpsMicroVmProvider.js';

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

  it('ContainerProvider truthfully reports container isolation and non-VPS status', () => {
    const provider = new ContainerProvider();
    expect(provider.id).toBe('docker-container');
    expect(provider.isolationType).toBe('container');
    expect(provider.isProductionVps).toBe(false);
    expect(provider.description).toContain('Docker/OCI containers');
    expect(provider.getTruthStatement()).toContain('CONTAINER ISOLATION');
  });

  it('VpsMicroVmProvider truthfully reports VPS hardware virtualization isolation', () => {
    const provider = new VpsMicroVmProvider();
    expect(provider.id).toBe('vps-microvm');
    expect(provider.isolationType).toBe('vps');
    expect(provider.isProductionVps).toBe(true);
    expect(provider.description).toContain('MicroVM');
    expect(provider.getTruthStatement()).toContain('PRODUCTION HARDWARE ISOLATION');
  });
});
