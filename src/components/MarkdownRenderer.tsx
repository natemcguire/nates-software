import React from 'react';
import { marked, Renderer, Tokens } from 'marked';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  trusted?: boolean;
}

const SAFE_URL = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeUrl = (href: string) => {
  const trimmed = (href || '').trim();
  return SAFE_URL.test(trimmed) ? trimmed : '#';
};

const buildUntrustedRenderer = (): Renderer => {
  const renderer = new Renderer();
  renderer.html = () => '';
  renderer.link = ({ href, title, tokens }: Tokens.Link) => {
    const text = renderer.parser.parseInline(tokens);
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(safeUrl(href))}"${t} rel="nofollow noopener noreferrer" target="_blank">${text}</a>`;
  };
  renderer.image = ({ href, title, text }: Tokens.Image) => {
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(safeUrl(href))}" alt="${escapeHtml(text || '')}"${t} />`;
  };
  return renderer;
};

const untrustedRenderer = buildUntrustedRenderer();

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '', trusted = false }) => {
  const html = marked.parse(content, {
    gfm: true,
    breaks: true,
    ...(trusted ? {} : { renderer: untrustedRenderer })
  }) as string;

  return (
    <div
      className={`prose prose-sm max-w-none font-sans text-gray-800 leading-relaxed space-y-3 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
