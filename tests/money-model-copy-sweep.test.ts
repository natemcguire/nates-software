import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// E4: repo-wide guard against leftover 70/20/10 / 90-10 / "protocol pool" /
// "up the chain" money-model copy across the files swept in this task.
// Mirrors the source-as-text technique used by tests/slopshop-redesign.test.tsx
// and tests/money-model-profile-copy.test.tsx.

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const sweptFiles = [
  'src/views/MarketingWindow.tsx',
  'src/components/CheckoutModal.tsx',
  'src/components/ForkWithAiModal.tsx',
  'src/components/AuthModal.tsx',
  'src/components/ArtifactSandbox.tsx',
  'src/views/PostEditorView.tsx',
  'src/views/SetupWizardView.tsx',
  'src/views/GitsmithView.tsx',
  'src/lib/hotwireBackend.ts',
  'src/lib/slopshopDomain.ts',
  'src/lib/commerce/transferWorker.ts',
  'src/lib/commerce/eventProcessor.ts',
  'functions/tree/[app].ts',
  'bin/slop.ts'
];

// Banned money-model phrases. These are matched as plain substrings against
// full file source, which is safe here because none of the swept files retain
// a legitimate (non-money) use of these exact strings -- unlike bare "70%" or
// "20%", which also show up as CSS widths/opacities or unrelated numbers
// elsewhere in the app and are therefore NOT included as blanket bans here.
const bannedPhrases = [
  '70 / 20 / 10',
  '70/20/10',
  '20% up',
  'protocol pool',
  'protocol liquidity',
  // NOTE: bare "up the chain" is NOT banned — it's legitimate new-model copy
  // ("forks of forks pay everyone up the chain"). The old-model tell was the
  // 20%-lineage phrasing, still guarded by the precise `/goes up the chain/`
  // and `20% up` checks below.
  'up the fork lineage'
];

describe('money-model copy sweep (E4): no leftover 70/20/10 language in swept files', () => {
  for (const relPath of sweptFiles) {
    const absPath = path.join(repoRoot, relPath);
    const source = readFileSync(absPath, 'utf-8');

    it(`${relPath}: contains none of the banned money-model phrases`, () => {
      for (const banned of bannedPhrases) {
        expect(source, `${relPath} should not contain "${banned}"`).not.toContain(banned);
      }
    });
  }

  // Bare "70%"/"20%" money-split assertions, checked precisely per-file so we
  // don't false-positive on legitimate non-money numbers (e.g. CSS opacity/
  // width utility classes, or the still-true "90% you / 10% platform" root-app
  // case, which the new model keeps unchanged).
  it('MarketingWindow.tsx: "Get paid on every sale" no longer asserts a fixed 70%/20% split', () => {
    const source = readFileSync(path.join(repoRoot, 'src/views/MarketingWindow.tsx'), 'utf-8');
    expect(source).not.toContain('You keep <strong className="text-green-800">70%</strong>');
    expect(source).not.toMatch(/goes up the chain/);
  });

  it('ForkWithAiModal.tsx: no fixed 70% "keep 70%" / "70% Maker Royalty" copy', () => {
    const source = readFileSync(path.join(repoRoot, 'src/components/ForkWithAiModal.tsx'), 'utf-8');
    expect(source).not.toContain('you keep 70%');
    expect(source).not.toContain('70% Maker Royalty');
  });

  it('AuthModal.tsx: no "earn 70% when you sell" copy', () => {
    const source = readFileSync(path.join(repoRoot, 'src/components/AuthModal.tsx'), 'utf-8');
    expect(source).not.toContain('earn 70% when you sell');
  });

  it('ArtifactSandbox.tsx: "How a sale splits" no longer hardcodes 70/20/10', () => {
    const source = readFileSync(path.join(repoRoot, 'src/components/ArtifactSandbox.tsx'), 'utf-8');
    expect(source).not.toContain('How a sale splits: 70 / 20 / 10');
    expect(source).not.toMatch(/<strong>70%<\/strong> to whoever sold it/);
  });

  it('PostEditorView.tsx: Lineage Split Guarantee no longer hardcodes 20%', () => {
    const source = readFileSync(path.join(repoRoot, 'src/views/PostEditorView.tsx'), 'utf-8');
    expect(source).not.toContain('you receive <b>20%</b> of all downstream registered sales');
  });

  it('SetupWizardView.tsx: Publishing & Royalty Economics box drops the fixed 70/20/10 rows', () => {
    const source = readFileSync(path.join(repoRoot, 'src/views/SetupWizardView.tsx'), 'utf-8');
    expect(source).not.toContain('70% of every sale');
    expect(source).not.toMatch(/Upstream creator chain:[\s\S]{0,40}20%/);
    expect(source).not.toContain('Platform liquidity pool');
    // The root-app "90% you / 10% platform" statement is still true under the
    // new model (no upstream lien => nothing to pay out) and is intentionally
    // kept, so it is NOT asserted against here.
  });

  it('GitsmithView.tsx: Lineage Settlement tab drops the fixed 70/20/10 headline and pool label', () => {
    const source = readFileSync(path.join(repoRoot, 'src/views/GitsmithView.tsx'), 'utf-8');
    expect(source).not.toContain('70% Maker / 20% Lineage Ancestor Settlement');
    expect(source).not.toContain('70/20/10 Lineage Pool');
    expect(source).not.toContain('70% / 20% / 10%');
    expect(source).not.toContain('Immediate maker / upstream ancestors / protocol pool');
    // "Root Release: 90% / 10%" is intentionally kept -- still true when there
    // is no ancestor lien.
  });

  it('hotwireBackend.ts: Rookie tier perk no longer states a fixed 70% royalty share', () => {
    const source = readFileSync(path.join(repoRoot, 'src/lib/hotwireBackend.ts'), 'utf-8');
    expect(source).not.toContain('standard 70% maker royalty share');
  });

  it('slopshopDomain.ts: manifest royaltySplit no longer hardcodes 70%/20%', () => {
    const source = readFileSync(path.join(repoRoot, 'src/lib/slopshopDomain.ts'), 'utf-8');
    expect(source).not.toMatch(/maker:\s*'70%'/);
    expect(source).not.toMatch(/ancestor:\s*'20%'/);
  });

  it('functions/tree/[app].ts: share-card OG description no longer asserts fixed 70%/20% split', () => {
    const source = readFileSync(path.join(repoRoot, 'functions/tree/[app].ts'), 'utf-8');
    expect(source).not.toContain('70% to the seller / 20% up the tree');
  });

  it('bin/slop.ts: "slop test" proof no longer names itself after the fixed 70/20/10 split', () => {
    const source = readFileSync(path.join(repoRoot, 'bin/slop.ts'), 'utf-8');
    expect(source).not.toContain('Lineage Ledger 70/20/10 exact cent conservation');
  });
});
