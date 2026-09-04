import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { MarkdownRenderer } from '../src/components/MarkdownRenderer';

const render = (content: string, trusted = false) =>
  renderToStaticMarkup(React.createElement(MarkdownRenderer, { content, trusted }));

describe('MarkdownRenderer XSS hardening (NSW-134)', () => {
  it('drops raw HTML script and event-handler attributes from untrusted content', () => {
    const html = render('# Hi\n\n<script>fetch("/steal")</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
  });

  it('neutralizes javascript: URLs in links from untrusted content', () => {
    const html = render('[click](javascript:alert(document.cookie))');
    expect(html).not.toMatch(/javascript:/i);
  });

  it('keeps safe markdown rendering intact', () => {
    const html = render('# Title\n\nNormal **bold**.\n\n[safe](https://example.com)\n\n- one\n- two');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('example.com');
    expect(html).toContain('<li>one</li>');
    expect(html).toMatch(/rel="nofollow noopener noreferrer"/);
  });

  it('allows raw HTML only for explicitly trusted first-party content', () => {
    const trusted = render('<div class="ok">first-party</div>', true);
    const untrusted = render('<div class="ok">tenant</div>', false);
    expect(trusted).toContain('first-party');
    expect(untrusted).not.toContain('<div class="ok">');
  });
});
