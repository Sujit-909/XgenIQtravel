'use client';
import React from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { assistantLink } from '@/lib/assistant-safety';

const components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  a: ({ href, children }) => {
    const url = assistantLink(href);
    if (!url) return <span>{children}</span>;
    return url.startsWith('/') ? <Link href={url}>{children}</Link> : <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>;
  },
  img: () => null,
  table: ({ children }) => <div className="employee-md-table"><table>{children}</table></div>,
};
export default function AssistantMarkdown({ text }) {
  return <div className="employee-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => assistantLink(url) || ''} components={components}>{text}</ReactMarkdown></div>;
}
