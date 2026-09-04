import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { PostEditorView } from '../src/views/PostEditorView';
import { AuthContext, AuthUser } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import { AppListing } from '../src/data/mockData';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Same shape as the local helper in tests/wave-ux-c-personalization.test.tsx —
// AuthContext.tsx does not export a mock-context factory.
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
  requireAuth: vi.fn((_reason: string, cb: () => void) => cb())
});

describe('NSW-57: Creator Studio Maker Guide rewrite (real flow, no stale claims)', () => {
  const sampleApp: AppListing = {
    id: 'app_guide_test',
    name: 'Guide Test App',
    tagline: 'Testing the maker guide',
    description: 'Long description',
    author: 'nate',
    authorAvatar: '🎯',
    version: 'v1.0.0',
    upvotes: 0,
    forkCount: 0,
    tags: ['Utility'],
    screenshots: [],
    comments: []
  };

  const renderGuide = () => {
    const authCtx = createMockAuthContext(null);
    return renderToString(
      <AuthContext.Provider value={authCtx}>
        <AlertProvider>
          <PostEditorView
            app={sampleApp}
            initialTab="guide"
            onSave={() => {}}
            onCancel={() => {}}
          />
        </AlertProvider>
      </AuthContext.Provider>
    );
  };

  it('renders the real 5-step flow: install, login, init, push, drop', () => {
    const html = renderGuide();

    expect(html).toContain('Install the');
    expect(html).toContain('Log in');
    expect(html).toContain('Create + connect the repo');
    expect(html).toContain('Push your code');
    expect(html).toContain('Publish the drop');
  });

  it('uses a generic &lt;app-id&gt; placeholder, never a hardcoded app name like "dronehunter"', () => {
    const html = renderGuide();

    expect(html).not.toContain('dronehunter');
    expect(html).toContain('&lt;app-id&gt;');
  });

  it('never references pages.dev (dead marketing domain)', () => {
    const html = renderGuide();
    expect(html).not.toContain('pages.dev');
  });

  it('does not claim "slop push" publishes to HOTWIRE', () => {
    const html = renderGuide();
    expect(html).not.toMatch(/slop push[\s\S]{0,60}publish/i);
    expect(html).toContain('it does not publish a drop');
  });

  it('references slop.json config semantics honestly, never the stale slop.config.json', () => {
    const html = renderGuide();
    expect(html).not.toContain('slop.config.json');
  });

  it('does not carry the old fake terminal-transcript output block or the dead migrations bullet', () => {
    const html = renderGuide();
    expect(html).not.toContain('Deployed live to subdomain in 1.18s');
    expect(html).not.toContain('migrations/001_initial_scores.sql');
    expect(html).not.toContain('Database Schema (Optional)');
  });

  it('states the app only goes live at https://<app-id>.nates-software.com after a verified deployable build', () => {
    const html = renderGuide();
    expect(html).toContain('nates-software.com');
    expect(html).toContain('only after a verified build');
  });

  describe('source: each command sits on its own line (no single-line concatenated commands)', () => {
    const source = readFileSync(path.join(repoRoot, 'src/views/PostEditorView.tsx'), 'utf-8');

    it('does not concatenate the install command and "slop --help" onto one line', () => {
      expect(source).not.toMatch(/npm install -g \S+ && slop --help/);
    });

    it('the install step\'s copy-command payload uses a newline between the two commands', () => {
      expect(source).toMatch(/npm install -g \S+\\nslop --help/);
    });

    it('uses the correct --price=15 (equals-sign) CLI flag syntax matching bin/slop.ts\'s actual parser', () => {
      expect(source).toContain('slop drop --price=15');
      // bin/slop.ts's handleDrop only recognizes args.find(a => a.startsWith("--price=")) — never a space form.
      expect(source).not.toContain('slop drop --price 15');
    });
  });
});

describe('NSW-58: Post Editor restyled to the Win95 system', () => {
  const sampleApp: AppListing = {
    id: 'app_style_test',
    name: 'Style Test App',
    tagline: 'Testing Win95 restyle',
    description: 'Long description',
    author: 'nate',
    authorAvatar: '🎯',
    version: 'v1.0.0',
    upvotes: 0,
    forkCount: 0,
    tags: ['Utility'],
    screenshots: [],
    comments: []
  };

  const renderGuide = () => {
    const authCtx = createMockAuthContext(null);
    return renderToString(
      <AuthContext.Provider value={authCtx}>
        <AlertProvider>
          <PostEditorView
            app={sampleApp}
            initialTab="guide"
            onSave={() => {}}
            onCancel={() => {}}
          />
        </AlertProvider>
      </AuthContext.Provider>
    );
  };

  it('guide tab step cards use flat Win95 chrome (border-2 border-gray-800), not rounded/shadow cards', () => {
    const html = renderGuide();
    expect(html).toContain('border-2 border-gray-800');
  });

  it('drops the bright navy-gradient banner + rounded-lg/shadow-md card treatment from the guide tab', () => {
    const source = readFileSync(path.join(repoRoot, 'src/views/PostEditorView.tsx'), 'utf-8');
    // Only the guide-tab-specific gradient banner + step-card treatment must be gone.
    expect(source).not.toContain('bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-900');
    expect(source).not.toContain('rounded-lg p-4 bg-gray-50 shadow-sm');
  });

  it('unifies guide-tab code blocks to the app\'s existing dark-terminal style (bg-[#0f172a] text-emerald-400), not bg-black text-green-400', () => {
    const source = readFileSync(path.join(repoRoot, 'src/views/PostEditorView.tsx'), 'utf-8');
    expect(source).not.toContain('bg-black text-green-400');
    expect(source).toContain('bg-[#0f172a] text-emerald-400');
  });

  it('still uses btn-w95 for the tab bar and copy buttons (unchanged Win95 button convention)', () => {
    const html = renderGuide();
    expect(html).toContain('btn-w95');
  });
});
