import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { ExplainerView } from '../src/views/ExplainerView';
import { resolveAppRoute } from '../src/App';
import { StartMenu } from '../src/components/StartMenu';
import { AuthProvider } from '../src/context/AuthContext';
import { CatalogProvider } from '../src/context/CatalogContext';

describe('ExplainerView Product Explainer (Spec M)', () => {
  const renderExplainer = () => {
    const raw = renderToString(<ExplainerView />);
    return raw.replace(/<!--.*?-->/g, '');
  };

  it('renders the top one-paragraph buy-once ownership summary', () => {
    const html = renderExplainer();

    expect(html).toContain('What is Nate&#x27;s Software?');
    expect(html).toContain('A marketplace for software you buy once and own — not rent.');
    expect(html).toContain('Every purchase gives you a license and the source.');
    expect(html).toContain(
      'Fork any app, change it with an AI agent, and sell your version; when a fork sells, revenue splits back down the lineage.'
    );
  });

  it('renders the exact 70/20/10 money model line', () => {
    const html = renderExplainer();

    expect(html).toContain('The Money Model');
    expect(html).toContain(
      '70% to the seller, 20% up the fork lineage, 10% to the protocol — a root app with no ancestors is 90/10.'
    );
  });

  it('renders plain, honest descriptions for core apps (HOTWIRE, SLOPSHOP, GITSMITH, INBOX, DYNO, PROFILE/SHELF, TERMINAL, CHAT)', () => {
    const html = renderExplainer();

    // HOTWIRE
    expect(html).toContain('HOTWIRE');
    expect(html).toContain('A daily board where makers drop new apps and people vote.');

    // SLOPSHOP
    expect(html).toContain('SLOPSHOP');
    expect(html).toContain('Where you fork an app and change it with an AI agent in a terminal.');
    expect(html).toContain('It uses GITSMITH as its git backend');
    expect(html).toContain('runs your forked app for you — the old &quot;RIG&quot; runtime is part of this now');

    // GITSMITH
    expect(html).toContain('GITSMITH');
    expect(html).toContain(
      'The git forge (bare repos over SSH). Most people use it from their own terminal; it&#x27;s the backend SLOPSHOP builds on. It stands on its own too.'
    );

    // INBOX
    expect(html).toContain('INBOX');
    expect(html).toContain(
      'Review and merge proposals; approvals require you to actually read the diff first.'
    );

    // DYNO
    expect(html).toContain('DYNO');
    expect(html).toContain(
      'A benchmark for how AI models and agent harnesses do on real tasks.'
    );

    // PROFILE / SHELF
    expect(html).toContain('GITSMITH / PROFILE / SHELF');
    expect(html).toContain('Your identity, keys, owned licenses, and earnings.');

    // TERMINAL & CHAT
    expect(html).toContain('TERMINAL');
    expect(html).toContain('An in-browser shell.');
    expect(html).toContain('CHAT');
    expect(html).toContain('A live room.');
  });

  it('does not treat sample listings (like WallArt) as platform features', () => {
    const html = renderExplainer();
    expect(html).not.toContain('WALLART');
    expect(html).not.toContain('WallArt');
  });

  it('avoids marketing fluff / buzzwords (seamless, powerful, robust, game-changing)', () => {
    const html = renderExplainer().toLowerCase();
    expect(html).not.toContain('seamless');
    expect(html).not.toContain('powerful');
    expect(html).not.toContain('robust');
    expect(html).not.toContain('game-changing');
    expect(html).not.toContain('revolutionary');
  });
});

describe('Explainer Routing & Entry Points', () => {
  it('resolves explainer standalone routes correctly', () => {
    expect(resolveAppRoute('', '/what')).toEqual({
      type: 'standalone_view',
      id: 'explainer',
      title: "WHAT IS NATE'S SOFTWARE"
    });

    expect(resolveAppRoute('', '/explainer')).toEqual({
      type: 'standalone_view',
      id: 'explainer',
      title: "WHAT IS NATE'S SOFTWARE"
    });

    expect(resolveAppRoute('', '', 'explainer')).toEqual({
      type: 'standalone_view',
      id: 'explainer',
      title: "WHAT IS NATE'S SOFTWARE"
    });

    expect(resolveAppRoute('explainer.nates-software.com', '')).toEqual({
      type: 'standalone_view',
      id: 'explainer',
      title: "WHAT IS NATE'S SOFTWARE"
    });
  });

  it('renders a What is this? entry point in the StartMenu', () => {
    const html = renderToString(
      <AuthProvider>
        <CatalogProvider>
          <StartMenu isOpen={true} onClose={() => {}} onOpenWindow={() => {}} />
        </CatalogProvider>
      </AuthProvider>
    );

    expect(html).toContain('What is this?');
  });
});
