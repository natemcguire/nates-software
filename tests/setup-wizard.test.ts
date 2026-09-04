import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveAppRoute } from '../src/App';

describe('First-Time User Onboarding & Setup Wizard Flow (WAVE-UX-A)', () => {
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



  it('wires SETUP desktop icon in App.tsx (#6, F5)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("id: 'setup', label: 'SETUP.EXE'");
    expect(source).toContain('openWindow(\'setup\')');
    expect(source).toContain('authLoading');
    expect(source).toContain('liveSandboxApp');
  });
});
