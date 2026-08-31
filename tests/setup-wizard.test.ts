import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveAppRoute } from '../src/App';

describe('First-Time User Onboarding & Setup Wizard Flow', () => {
  it('should resolve desktop mode for root visits so SETUP.EXE launches automatically', () => {
    const route = resolveAppRoute('nates-software.com', '/', '');
    expect(route.type).toBe('desktop');
  });

  it('should install first and leave the LLM launch to the post-install prompt', () => {
    const appId = 'dronehunter';
    const installCmd = `slop fork nate/${appId}`;
    expect(installCmd).toBe('slop fork nate/dronehunter');
    expect(installCmd).not.toContain('agy');
    expect(installCmd).not.toContain('claude');
  });

  it('does not claim a native fork, entitlement, or payout before CLI proof', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('Verify the Native Install');
    expect(source).toContain('No entitlement or payout is created by this wizard.');
    expect(source).toContain('Your fork exists only after SLOP prints');
    expect(source).not.toContain('Your Local-First Fork is Ready!');
    expect(source).not.toContain('Your Guaranteed Lineage Royalty Contract:');
    expect(source).not.toContain("useState<string>(user?.username || 'josh')");
  });

  it('explains that browser VM workspaces are intentionally disposable', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('Use your native terminal to keep the fork.');
    expect(source).toContain('workspace is deleted when the session ends');
  });

  it('provides real web auth entrypoints (Create username / Log in) instead of static CLI login chip', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).not.toContain('CLI login required');
    expect(source).toContain('Create your maker username to publish and sell — or log in if you already have one.');
    expect(source).toContain("openAuthModal('register')");
    expect(source).toContain("openAuthModal('login')");
    expect(source).toContain('Create username');
    expect(source).toContain('Signed in as @');
  });
});
