import { describe, it, expect } from 'vitest';
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
});
