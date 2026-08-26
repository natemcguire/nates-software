import React from 'react';
import { marked } from 'marked';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const html = marked.parse(content, { gfm: true, breaks: true }) as string;

  return (
    <div
      className={`prose prose-sm max-w-none font-sans text-gray-800 leading-relaxed space-y-3 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
