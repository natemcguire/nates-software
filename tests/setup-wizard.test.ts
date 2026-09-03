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

  it('replaces Verify dead-end with "You\'re in — what\'s next" and preserves no-entitlement honesty', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("You're in — what's next?");
    expect(source).not.toContain('Verify the Native Install');
    expect(source).toContain('No entitlement or payout is created by this wizard.');
    expect(source).not.toContain('Your Local-First Fork is Ready!');
    expect(source).not.toContain('Your Guaranteed Lineage Royalty Contract:');
    expect(source).not.toContain("useState<string>(user?.username || 'josh')");
  });

  it('relabels step indicators to plain actions (O3)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('1. Pick an app');
    expect(source).toContain('2. Get it running');
    expect(source).toContain('3. Start building');
    expect(source).not.toContain('2. Launch Agent');
    expect(source).not.toContain('3. Verify');
  });

  it('leads with buyer benefit in Step 1 subhead and removes 70/20/10 from Step 1 (O4)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('Pick an app to try. You get the running app plus its full source — yours to fork, mod, and even resell.');
    expect(source).toContain('Full source included');
  });

  it('makes running in the browser the primary Step 2 action with feature-framed copy (O1)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('Runs in a fresh cloud sandbox — nothing to install. Closes when you leave.');
    expect(source).toContain('Run {selectedStarter?.name || \'App\'} in the browser now');
    expect(source).toContain('Prefer your own machine? Install with SLOP');
  });

  it('offers three real actions in Step 3 and interpolates real app name into preview labels (O2, C1)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('Open {selectedStarter?.name || \'App\'} live');
    expect(source).toContain('See code on GITSMITH');
    expect(source).toContain("Browse today's drops");
    expect(source).toContain("Run {selectedStarter?.name || 'App'} in browser");
  });

  it('uses logged-in username for fork command when authenticated (#14)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("const owner = user?.username || selectedStarter.repoOwner || 'nate';");
  });

  it('reframes browser sandbox as a feature without throwaway warning (O1)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/SetupWizardView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('Runs in a fresh cloud sandbox — nothing to install. Closes when you leave.');
    expect(source).not.toContain('workspace is deleted when the session ends');
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

  it('wires MarketingWindow hero to "Try an app now →", outcome CTAs, and user badge (O5)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/views/MarketingWindow.tsx', import.meta.url)), 'utf8');
    // Hero CTA (the arrow is appended as a separate {…} &rarr; span, so assert on the label).
    expect(source).toContain('Try an app now');
    // Per-shop outcome CTAs now live as `cta:` values on the app-grid data array; the
    // window renders `{s.cta} &rarr;`. Assert the CTA labels, not the old concatenated literals.
    expect(source).toContain("Browse today's drops");
    expect(source).toContain('Mod an app with AI');
    // (The "RIG.EXE — See what's running" card was removed in task #41; RIG is now
    // invisible infra, folded into SLOPSHOP's run step, so its CTA is gone.)
    expect(source).toContain('Browse the code');
    expect(source).toContain('Open your mailbox');
    expect(source).toContain('Free to browse and fork. Create a maker account when you\'re ready to publish.');
    expect(source).toContain("const userBadge = user?.username ? `@${user.username}` : '@guest';");
  });

  it('wires SETUP desktop icon with START HERE and gates first-run auto-open in App.tsx (#6, F5)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
    // The SETUP desktop icon label is now just 'SETUP.EXE' (parenthetical suffixes
    // were removed from all icon labels); it still opens the setup window.
    expect(source).toContain("id: 'setup', label: 'SETUP.EXE'");
    expect(source).toContain('nsw_setup_wizard_seen');
    // Flash fix: the setup window is closed on first paint and OPENED (once) after the
    // session check resolves, for first-run/logged-out visitors — instead of opening by
    // default and closing for returning users (which flashed the window on every refresh).
    expect(source).toContain('openWindow(\'setup\')');
    expect(source).toContain('authLoading');
    expect(source).toContain('liveSandboxApp');
  });
});
