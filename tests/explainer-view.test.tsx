import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { MarketingWindow } from '../src/views/MarketingWindow';
import { resolveAppRoute } from '../src/App';
import { StartMenu } from '../src/components/StartMenu';
import { AuthProvider } from '../src/context/AuthContext';
import { CatalogProvider } from '../src/context/CatalogContext';

// The former standalone ExplainerView was consolidated into the single
// "WELCOME TO NATE'S SOFTWARE EMPORIUM" window (MarketingWindow). These tests
// assert the consolidated window still carries the honest explainer content.
const noop = () => {};

describe('Consolidated About/Explainer window (Spec M)', () => {
  const renderWindow = () => {
    const raw = renderToString(
      <AuthProvider>
        <MarketingWindow
          onOpenSetup={noop}
          onOpenHotwire={noop}
          onOpenSlopshop={noop}
          onOpenGitsmith={noop}
          onOpenInbox={noop}
          onOpenProfile={noop}
          onOpenWhitepapers={noop}
          onOpenDyno={noop}
          onDismiss={noop}
        />
      </AuthProvider>
    );
    return raw.replace(/<!--.*?-->/g, '');
  };

  it('renders the WELCOME top title and both section titles', () => {
    const html = renderWindow();
    expect(html).toContain("WELCOME TO NATE&#x27;S SOFTWARE EMPORIUM");
    expect(html).toContain('What is this?');
    expect(html).toContain('How it works');
    expect(html).toContain('ENTER ONE OF THE SHOPS');
  });

  it('renders the buy-once ownership summary', () => {
    const html = renderWindow();
    expect(html).toContain('you buy apps outright');
    expect(html).toContain('Fork any of it, change it with an AI agent, then sell your version');
  });

  it('renders the flat-10%-platform / frozen-royalty money model with the 90/10 root case', () => {
    const html = renderWindow();
    expect(html).toContain('The Money Model');
    expect(html).toContain('frozen the day they forked');
    expect(html).toContain('10%');
    expect(html).toContain('90% you / 10% us');
  });

  it('renders honest descriptions for core apps (HOTWIRE, SLOPSHOP, GITSMITH, INBOX, DYNO, PROFILE)', () => {
    const html = renderWindow();
    expect(html).toContain('HOTWIRE');
    expect(html).toContain('The daily 12:01 AM board where makers drop new apps');
    expect(html).toContain('SLOPSHOP');
    expect(html).toContain('It uses GITSMITH as its git backend');
    expect(html).toContain('the old &quot;RIG&quot; runtime is part of this now');
    expect(html).toContain('GITSMITH');
    expect(html).toContain('The git forge');
    expect(html).toContain('INBOX');
    expect(html).toContain('approvals require you to actually read the diff first');
    expect(html).toContain('DYNO');
    expect(html).toContain('A benchmark for how AI models and agent harnesses do on real');
    expect(html).toContain('My Profile');
  });

  it('avoids marketing fluff / buzzwords', () => {
    const html = renderWindow().toLowerCase();
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
          <StartMenu isOpen={true} onClose={() => {}} onOpenWindow={() => {}} onRestart={() => {}} />
        </CatalogProvider>
      </AuthProvider>
    );

    expect(html).toContain('What is this?');
  });
});
