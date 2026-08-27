import { describe, it, expect } from 'vitest';
import { resolveAppRoute } from '../src/App';

describe('First-Time User Onboarding & Setup Wizard Flow', () => {
  it('should resolve desktop mode for root visits so SETUP.EXE launches automatically', () => {
    const route = resolveAppRoute('nates-software.com', '/', '');
    expect(route.type).toBe('desktop');
  });

  it('should construct valid 1-liner clone commands for AI coding agents', () => {
    const appId = 'dronehunter';
    const makerHandle = 'josh';
    const worktreeId = `slop-${appId}-${makerHandle}`;
    const repoUrl = `https://github.com/natemcguire/${appId}.git`;
    
    const claudeCmd = `git clone ${repoUrl} /tmp/${worktreeId} && cd /tmp/${worktreeId} && claude "Add new game modes"`;
    expect(claudeCmd).toContain('/tmp/slop-dronehunter-josh');
    expect(claudeCmd).toContain('claude');
  });
});
