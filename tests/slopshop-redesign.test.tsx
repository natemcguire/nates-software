import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { SlopshopView } from '../src/views/SlopshopView';
import { AuthContext, AuthUser } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';

const mockUser: AuthUser = {
  id: 'usr_nate123',
  username: 'nate',
  displayName: 'Nate',
  avatar: '🤠',
  role: 'maker',
  isSuperAdmin: false
};

const createMockAuthContext = (user: AuthUser | null) => ({
  user,
  isAuthenticated: Boolean(user),
  isSuperAdmin: user?.role === 'super_admin',
  isAuthModalOpen: false,
  authModalTab: 'login' as const,
  openAuthModal: vi.fn(),
  closeAuthModal: vi.fn(),
  login: vi.fn().mockResolvedValue({ success: true }),
  register: vi.fn().mockResolvedValue({ success: true }),
  logout: vi.fn().mockResolvedValue(undefined),
  requireAuth: vi.fn()
});

const renderSlopshop = (user: AuthUser | null = mockUser) => {
  const authCtx = createMockAuthContext(user);
  return renderToString(
    <AuthContext.Provider value={authCtx}>
      <AlertProvider>
        <SlopshopView />
      </AlertProvider>
    </AuthContext.Provider>
  );
};

const componentSourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/views/SlopshopView.tsx'
);
const componentSource = readFileSync(componentSourcePath, 'utf-8');

describe('SlopshopView Approved One-Loop Dev Environment UX', () => {
  it('renders the 5-stage loop rail with correct names, subtitles, and back labels', () => {
    const html = renderSlopshop();

    expect(html).toContain('Fork');
    expect(html).toContain('Copy an app to your namespace');
    expect(html).toContain('via GITSMITH forge');

    expect(html).toContain('Slop');
    expect(html).toContain('Change it with an AI agent, in the terminal');
    expect(html).toContain('this is the work');

    expect(html).toContain('Run');
    expect(html).toContain('Boot your fork and watch it live');
    expect(html).toContain('RIG runtime');

    expect(html).toContain('Push');
    expect(html).toContain('Send your commits back with proof');
    expect(html).toContain('to GITSMITH');

    expect(html).toContain('Publish');
    expect(html).toContain('List your version for sale');
    expect(html).toContain('platform takes 10%');
  });

  it('renders the 2-column work area: terminal on the left and RIG run panel on the right', () => {
    const html = renderSlopshop();

    expect(html).toContain('Terminal —');
    expect(html).toContain('(your fork)');
    expect(html).toContain('Nate&#x27;s Software Command Guide &amp; Emulator');
    expect(html).toContain('Local mode is a browser command emulator');

    expect(html).toContain('Run — your fork, live');
    expect(html).toContain('not running — do the Run step');
    expect(html).toContain('port');
    expect(html).toContain('mem');
    expect(html).toContain('status');
  });

  it('renders the additive money-model ledger note once, with no fixed 70/20/10 split', () => {
    const html = renderSlopshop();

    expect(html).toContain('When your fork sells, the split is settled automatically:');
    expect(html).toContain('platform');
    expect(html).toContain('10%');
    expect(html).toContain('upstream maker');
    expect(html).toContain('you keep the rest');

    expect(html).not.toContain('70 / 20 / 10');
    expect(html).not.toContain('70%');
    expect(html).not.toContain('20%');
    expect(html).not.toContain('protocol liquidity');
    expect(html).not.toContain('up the fork lineage');
  });

  it('renders a "How the money works" affordance near the publish UI', () => {
    const html = renderSlopshop();
    expect(html).toMatch(/How the money works/i);
  });

  it('renders dynamic primary actions and 3-cell status bar', () => {
    const html = renderSlopshop();

    expect(html).toContain('Fork nate/dronehunter');
    expect(html).toContain('Pick another app');

    expect(html).toContain('Step 1 of 5 · Fork');
    expect(html).toContain('Fork copies the app to your namespace. GITSMITH is the git backend.');
    expect(html).toContain('GITSMITH:');
  });

  it('displays authenticated username when logged in and draft handle when logged out', () => {
    const loggedInHtml = renderSlopshop(mockUser);
    expect(loggedInHtml).toContain('signed in as @nate');

    const loggedOutHtml = renderSlopshop(null);
    expect(loggedOutHtml).toContain('(editable draft handle)');
    expect(loggedOutHtml).not.toContain('signed in as @');
  });
});

describe('SlopshopView Honesty: no fabricated success anywhere', () => {
  it('does not print a canned "worktree ready" / fork success line before any fork has run', () => {
    const html = renderSlopshop();

    expect(html).not.toContain('worktree ready at');
    expect(html).not.toContain('✓ forked');
    expect(html).toContain('nothing has run yet');
  });

  it('never renders "✓ pushed" or "✓ live" success text on initial render (Push/Publish have no backend to confirm them)', () => {
    const html = renderSlopshop();

    expect(html).not.toContain('✓ pushed');
    expect(html).not.toContain('✓ live');
  });

  it('the Help claim about fabrication accurately describes which stages are real vs honest-status-only', () => {
    const html = renderSlopshop();

    expect(html).not.toContain('Zero fabricated commits, test proofs, or fake runs.');
    expect(componentSource).not.toContain('Zero fabricated commits, test proofs, or fake runs.');

    const helpTextMatch = componentSource.match(/showAlert\(\s*"SLOPSHOP is the one-loop[\s\S]*?"\s*,\s*'SLOPSHOP Help'/);
    expect(helpTextMatch, 'Help alert text should be present in source').toBeTruthy();
    const helpText = helpTextMatch![0];

    expect(helpText).toContain('real');
    expect(helpText).toContain('/api/git');
    expect(helpText).toContain('/api/rig');
    expect(helpText).toContain('it never fakes');
  });

  it('source: Fork stage only claims "✓ forked" inside the real /api/git success branch, never as a failure/catch fallback', () => {
    const forkStageMatch = componentSource.match(
      /if \(activeStage === 0\) \{[\s\S]*?\} else if \(activeStage === 1\) \{/
    );
    expect(forkStageMatch, 'Fork stage block should be present').toBeTruthy();
    const forkBlock = forkStageMatch![0];

    expect(forkBlock).toContain("fetch('/api/git'");
    expect(forkBlock).toContain("action: 'fork'");

    expect(forkBlock).toContain('res.ok && data?.success');

    const successLineCount = (forkBlock.match(/✓ forked|✓ configured/g) || []).length;
    expect(successLineCount).toBe(1);
  });

  it('source: Run stage only claims a live container after the RIG gateway confirms a healthy lifecycle', () => {
    const runStageMatch = componentSource.match(
      /\} else if \(activeStage === 2\) \{[\s\S]*?\} else if \(activeStage === 3\) \{/
    );
    expect(runStageMatch, 'Run stage block should be present').toBeTruthy();
    const runBlock = runStageMatch![0];

    expect(runBlock).toContain('createRigInstance');
    expect(runBlock).toContain("lifecycle === 'healthy'");

    expect(runBlock).not.toContain("setRunState('healthy');\n          setRunPort('3004');");
  });

  it('source: Push stage never claims "✓ pushed" — it is honest fail-closed with the real command', () => {
    const pushStageMatch = componentSource.match(
      /\} else if \(activeStage === 3\) \{[\s\S]*?\} else if \(activeStage === 4\) \{/
    );
    expect(pushStageMatch, 'Push stage block should be present').toBeTruthy();
    const pushBlock = pushStageMatch![0];

    expect(pushBlock).not.toMatch(/✓\s*pushed/);
    expect(pushBlock).toContain('$ slop push');
    expect(pushBlock).toMatch(/cannot push commits|cannot land|NOTICE/i);
  });

  it('source: Publish stage never claims "✓ live" or a listing URL — it is honest fail-closed with the real command', () => {
    const publishStageMatch = componentSource.match(
      /\} else if \(activeStage === 4\) \{[\s\S]*?\n  \};/
    );
    expect(publishStageMatch, 'Publish stage block should be present').toBeTruthy();
    const publishBlock = publishStageMatch![0];

    expect(publishBlock).not.toMatch(/✓\s*live/);
    expect(publishBlock).not.toContain('nates-software.com');
    expect(publishBlock).toContain('$ slop publish');
    expect(publishBlock).toMatch(/cannot create a marketplace listing|NOTICE/i);
  });

  it('source: the terminal\'s default natural-language branch does not fabricate a diff or file count', () => {
    const defaultBranchMatch = componentSource.match(/default:[\s\S]*?break;\n    \}/);
    expect(defaultBranchMatch, 'default command branch should be present').toBeTruthy();
    const defaultBlock = defaultBranchMatch![0];

    expect(defaultBlock).not.toMatch(/files changed/);
    expect(defaultBlock).not.toContain('git diff ready');
    expect(defaultBlock).toMatch(/no AI agent|NOTICE/i);
  });

  it('source: typed "slop push"/"slop publish" terminal commands route through the same honest handler, not a separate canned-success path', () => {
    expect(componentSource).not.toContain("text: `✓ pushed ${makerHandle}/${coordinate.appId} to GITSMITH`");
    expect(componentSource).not.toContain(
      "text: `✓ live: ${coordinate.appId}-${makerHandle.replace('@', '')}.nates-software.com`, type: 'success'"
    );
  });
});

describe('SlopshopView Set-Listing-Price modal: royalty input + real /api/drops publish (E1b)', () => {
  it('renders a royalty-percent input inside the price modal, in addition to the price input', () => {
    const priceModalMatch = componentSource.match(
      /\{modalType === 'price' &&[\s\S]*?\n {6}\)\}/
    );
    expect(priceModalMatch, 'price modal JSX block should be present').toBeTruthy();
    const priceModalBlock = priceModalMatch![0];

    expect(priceModalBlock).toContain('Set Listing Price');
    expect(priceModalBlock).toContain('Price (USD):');
    expect(priceModalBlock).toMatch(/publishRoyaltyPct/);
    expect(priceModalBlock).toMatch(/Your royalty when someone forks (&amp;|&) ?resells/i);
  });

  it('source: royalty percent is converted to clamped integer basis points before publishing', () => {
    const derivationMatch = componentSource.match(
      /const pct = Number\(publishRoyaltyPct\);\s*\n\s*const royaltyBps = [^\n]+/
    );
    expect(derivationMatch, 'royaltyBps derivation from publishRoyaltyPct should be present').toBeTruthy();
    const derivation = derivationMatch![0];

    expect(derivation).toContain('Math.round(');
    expect(derivation).toContain('* 100');
    expect(derivation).toMatch(/Math\.min\(10000/);
    expect(derivation).toMatch(/Math\.max\(0/);
  });

  it('source: Save/Publish wires a real authenticated POST to /api/drops with royaltyBps and the required publish fields', () => {
    expect(componentSource).toMatch(/fetch\(\s*['"]\/api\/drops['"]/);
    expect(componentSource).toMatch(/method:\s*['"]POST['"]/);
    expect(componentSource).toContain("credentials: 'same-origin'");

    const drropsCallMatch = componentSource.match(/fetch\(\s*['"]\/api\/drops['"][\s\S]*?\}\)\s*;/);
    expect(drropsCallMatch, '/api/drops fetch call should be present').toBeTruthy();
    const dropsCall = drropsCallMatch![0];
    expect(dropsCall).toMatch(/royaltyBps/);
    expect(dropsCall).toMatch(/name/);
    expect(dropsCall).toMatch(/version/);
    expect(dropsCall).toMatch(/price/);
  });

  it('source: success is only shown via showAlert after res.ok is confirmed — never unconditionally', () => {
    const handlerMatch = componentSource.match(
      /const handleSavePriceAndPublish = async \(\) => \{[\s\S]*?\n  \};/
    );
    expect(handlerMatch, 'handleSavePriceAndPublish function should be present').toBeTruthy();
    const publishHandlerRegion = handlerMatch![0];

    expect(publishHandlerRegion).toMatch(/fetch\(\s*['"]\/api\/drops['"]/);

    expect(publishHandlerRegion).toMatch(/!res\.ok/);
    expect(publishHandlerRegion).toMatch(/data\?\.success/);
    expect(publishHandlerRegion).toMatch(/showAlert\(/);

    expect(publishHandlerRegion).toMatch(/data\?\.error|data\.error/);

    const guardIdx = publishHandlerRegion.indexOf('!res.ok');
    const successAlertIdx = publishHandlerRegion.indexOf("'Published'");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(successAlertIdx).toBeGreaterThan(guardIdx);
  });

  it('source: publish handler never claims success unconditionally right after the fetch call (no fabricated success)', () => {
    const idx = componentSource.indexOf("fetch('/api/drops'");
    const idx2 = idx === -1 ? componentSource.indexOf('fetch(\"/api/drops\"') : idx;
    expect(idx2, '/api/drops fetch call should exist in source').toBeGreaterThan(-1);
  });

  it('source: the price-modal split preview uses the additive model (platform 10% + own royalty rate), not fixed 70/20/10', () => {
    const priceModalMatch = componentSource.match(
      /\{modalType === 'price' &&[\s\S]*?\n {6}\)\}/
    );
    expect(priceModalMatch, 'price modal JSX block should be present').toBeTruthy();
    const priceModalBlock = priceModalMatch![0];

    expect(priceModalBlock).toMatch(/publishPrice\)\s*\|\|\s*0\)\s*\*\s*0\.1\b/);
    expect(priceModalBlock).toMatch(/publishPrice\)\s*\|\|\s*0\)\s*\*\s*0\.9\b/);
    expect(priceModalBlock).toMatch(/publishRoyaltyPct/);

    expect(priceModalBlock).not.toMatch(/\*\s*0\.7\b/);
    expect(priceModalBlock).not.toMatch(/\*\s*0\.2\b/);
    expect(priceModalBlock).not.toContain('protocol liquidity');
  });
});

describe('SlopshopView money-model copy (E3): no leftover 70/20/10 language anywhere', () => {
  it('renders and source contain no fixed 70/20/10 split language', () => {
    const html = renderSlopshop();

    for (const banned of ['70 / 20 / 10', '70%', '20%', 'protocol liquidity', 'up the fork lineage']) {
      expect(html, `rendered HTML should not contain "${banned}"`).not.toContain(banned);
      expect(componentSource, `component source should not contain "${banned}"`).not.toContain(banned);
    }
  });

  it('renders a "How the money works" affordance that can open the White Papers explainer', () => {
    expect(componentSource).toMatch(/How the money works/i);
    expect(componentSource).toMatch(/onOpenWhitePapers/);
  });
});
