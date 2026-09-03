import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { WhitePapersView } from '../src/views/WhitePapersView';
import { MONEY_MODEL_MARKDOWN } from '../src/data/moneyModelData';

describe('"Shareware, Restored" explainer (Task E2)', () => {
  const renderView = () => {
    const raw = renderToString(<WhitePapersView />);
    return raw.replace(/<!--.*?-->/g, '');
  };

  it('renders a "Shareware, Restored" tab in WhitePapersView', () => {
    const html = renderView();
    expect(html).toContain('Shareware, Restored');
  });

  it('markdown explains the frozen rate, the platform cut, and buyer-beware refunds', () => {
    expect(MONEY_MODEL_MARKDOWN).toContain('frozen');
    expect(MONEY_MODEL_MARKDOWN).toContain('10%');
    const hasBuyerBeware = MONEY_MODEL_MARKDOWN.includes('buyer beware');
    const hasSalesFinal = MONEY_MODEL_MARKDOWN.includes('all sales final') || MONEY_MODEL_MARKDOWN.toLowerCase().includes('all sales final');
    expect(hasBuyerBeware || hasSalesFinal).toBe(true);
  });

  it('markdown contains the worked Ann -> Bob -> Carol example with the correct cent amounts', () => {
    expect(MONEY_MODEL_MARKDOWN).toContain('Ann');
    expect(MONEY_MODEL_MARKDOWN).toContain('Bob');
    expect(MONEY_MODEL_MARKDOWN).toContain('Carol');
    expect(MONEY_MODEL_MARKDOWN).toContain('$100');
    expect(MONEY_MODEL_MARKDOWN).toContain('$10');
    expect(MONEY_MODEL_MARKDOWN).toContain('$9');
    expect(MONEY_MODEL_MARKDOWN).toContain('$72');
  });

  it('does NOT contain the retired 70 / 20 / 10 split anywhere in the markdown', () => {
    expect(MONEY_MODEL_MARKDOWN).not.toContain('70 / 20 / 10');
    expect(MONEY_MODEL_MARKDOWN).not.toContain('70/20/10');
  });
});
