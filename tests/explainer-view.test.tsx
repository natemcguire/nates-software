import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { resolveAppRoute } from '../src/App';
import { StartMenu } from '../src/components/StartMenu';
import { AuthProvider } from '../src/context/AuthContext';
import { CatalogProvider } from '../src/context/CatalogContext';

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
