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

// Source of the component, for assertions that need to see the full set of stage
// handlers (fabricated-success strings can appear on branches that never render in
// the initial SSR pass, e.g. inside async fetch callbacks — those still must not exist
// unconditionally / without a real backend confirmation gating them).
const componentSourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/views/SlopshopView.tsx'
);
const componentSource = readFileSync(componentSourcePath, 'utf-8');

describe('SlopshopView Approved One-Loop Dev Environment UX', () => {
  it('renders the 5-stage loop rail with correct names, subtitles, and back labels', () => {
    const html = renderSlopshop();

    // 5 Stages
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
    expect(html).toContain('you keep 70%');
  });

  it('renders the 2-column work area: terminal on the left and RIG run panel on the right', () => {
    const html = renderSlopshop();

    // Left Column: Terminal Panel
    expect(html).toContain('Terminal —');
    expect(html).toContain('(your fork)');
    expect(html).toContain('Nate&#x27;s Software Command Guide &amp; Emulator');
    expect(html).toContain('Local mode is a browser command emulator');

    // Right Column: Run Panel (RIG folded in)
    expect(html).toContain('Run — your fork, live');
    expect(html).toContain('not running — do the Run step');
    expect(html).toContain('port');
    expect(html).toContain('mem');
    expect(html).toContain('status');
  });

  it('renders the 70 / 20 / 10 automated settlement ledger note once', () => {
    const html = renderSlopshop();

    expect(html).toContain('When your fork sells, the split is settled automatically:');
    expect(html).toContain('70%');
    expect(html).toContain('you');
    expect(html).toContain('20%');
    expect(html).toContain('up the fork lineage');
    expect(html).toContain('10%');
    expect(html).toContain('protocol');
    expect(html).toContain('A root app with no ancestors is 90 / 10.');
  });

  it('renders dynamic primary actions and 3-cell status bar', () => {
    const html = renderSlopshop();

    // Initial Stage 0 (Fork) Actions
    expect(html).toContain('Fork nate/dronehunter');
    expect(html).toContain('Pick another app');

    // Status bar cells
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

    // The old boot transcript unconditionally claimed a worktree was ready. Nothing has
    // executed at mount time, so no such success claim may render.
    expect(html).not.toContain('worktree ready at');
    expect(html).not.toContain('✓ forked');
    // The seeded terminal transcript must be clearly labeled as an inert example, not a
    // record of something that already happened.
    expect(html).toContain('nothing has run yet');
  });

  it('never renders "✓ pushed" or "✓ live" success text on initial render (Push/Publish have no backend to confirm them)', () => {
    const html = renderSlopshop();

    expect(html).not.toContain('✓ pushed');
    expect(html).not.toContain('✓ live');
  });

  it('the Help claim about fabrication accurately describes which stages are real vs honest-status-only', () => {
    const html = renderSlopshop();

    // Must NOT repeat the old blanket, unverifiable claim anywhere, including inside
    // the (unrendered until clicked) Help alert text baked into the component source.
    expect(html).not.toContain('Zero fabricated commits, test proofs, or fake runs.');
    expect(componentSource).not.toContain('Zero fabricated commits, test proofs, or fake runs.');

    // The Help alert text is only materialized on click (via showAlert), so it never
    // appears in the static SSR markup. Assert its content directly from source: it
    // must describe reality — Fork and Run hit real backends; Slop/Push/Publish are
    // honest status/command panels, not executors.
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

    // The real backend call must exist.
    expect(forkBlock).toContain("fetch('/api/git'");
    expect(forkBlock).toContain("action: 'fork'");

    // Success text must be gated behind an actual confirmed response.
    expect(forkBlock).toContain('res.ok && data?.success');

    // There must be no fallback branch (catch / else / failure path) that also prints a
    // "✓ forked" / "✓ configured" success line — that was the original fabrication bug.
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

    // No unconditional setTimeout-based fake success independent of the gateway result.
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
