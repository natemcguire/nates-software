import { describe, it, expect } from 'vitest';
import { INITIAL_APPS } from '../src/data/mockData';
import { GITSMITH_REPOS } from '../src/views/GitsmithView';

describe('Real Sovereign Shareware Apps Suite (Zero Mock Apps)', () => {
  it('should strictly contain only the 3 sovereign shareware apps (dronehunter, certified-mailer, picfitai)', () => {
    const appIds = INITIAL_APPS.map(a => a.id);
    expect(appIds).toEqual(['dronehunter', 'certified-mailer', 'picfitai']);
    expect(appIds).not.toContain('wallart');
    expect(appIds).not.toContain('retro-calc');
    expect(appIds).not.toContain('baby');
    expect(appIds).not.toContain('sailtrack');
  });

  it('should configure single-file SQLite databases in WAL mode for all sovereign apps', () => {
    INITIAL_APPS.forEach(app => {
      expect(app.sqliteDatabase).toMatch(/^\/data\/[a-z-]+\.sqlite$/);
      expect(app.storage).toContain('WAL');
      expect(app.author).toBeDefined();
    });
  });

  it('should point all Gitsmith repository live links directly to their sovereign subdomains', () => {
    expect(GITSMITH_REPOS.length).toBe(3);
    expect(GITSMITH_REPOS[0].liveAppUrl).toBe('https://dronehunter.pages.dev');
    expect(GITSMITH_REPOS[1].liveAppUrl).toBe('https://certified-mailer.pages.dev');
    expect(GITSMITH_REPOS[2].liveAppUrl).toBe('https://picfitai.pages.dev');
  });
});
