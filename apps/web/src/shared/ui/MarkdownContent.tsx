import { Fragment, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import './markdown-content.css';

export interface MarkdownContentProps {
  content: string;
  className?: string;
  renderText?: (text: string) => ReactNode;
}

function isSafeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value, 'https://markdown.local');
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function splitTrailingPunctuation(value: string): { body: string; trailing: string } {
  const match = value.match(/^([\s\S]*?)([),.!?，。！？、]+)$/);
  return match ? { body: match[1], trailing: match[2] } : { body: value, trailing: '' };
}

function decodeUrl(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function renderChildren(children: ReactNode, renderText: (text: string) => ReactNode): ReactNode {
  if (typeof children === 'string') return renderText(children);
  if (Array.isArray(children)) {
    return children.map((child, index) => <Fragment key={index}>{renderChildren(child, renderText)}</Fragment>);
  }
  return children;
}

export function MarkdownContent({ content, className, renderText = (text) => text }: MarkdownContentProps) {
  const components: Components = {
    a: ({ href, children, node: _node, ...props }) => {
      const childText = typeof children === 'string' ? children : undefined;
      const normalizedChild = childText ? splitTrailingPunctuation(childText) : undefined;
      const normalizedHref = typeof href === 'string' ? splitTrailingPunctuation(decodeUrl(href)).body : href;
      if (!isSafeUrl(normalizedHref)) return <span>{renderChildren(children, renderText)}</span>;
      if (normalizedChild) return <><a {...props} className="messages-link" href={normalizedHref} target="_blank" rel="noreferrer noopener">{renderChildren(normalizedChild.body, renderText)}</a>{normalizedChild.trailing}</>;
      return <a {...props} className="messages-link" href={normalizedHref} target="_blank" rel="noreferrer noopener">{renderChildren(children, renderText)}</a>;
    },
    img: ({ src, alt, node: _node, ...props }) => {
      if (!isSafeUrl(src)) return null;
      return <img {...props} src={src} alt={alt ?? ''} loading="lazy" />;
    },
    p: ({ children }) => <p>{renderChildren(children, renderText)}</p>,
    blockquote: ({ children }) => <blockquote>{renderChildren(children, renderText)}</blockquote>,
    li: ({ children, ...props }) => <li {...props}>{renderChildren(children, renderText)}</li>,
    h1: ({ children }) => <h1>{renderChildren(children, renderText)}</h1>,
    h2: ({ children }) => <h2>{renderChildren(children, renderText)}</h2>,
    h3: ({ children }) => <h3>{renderChildren(children, renderText)}</h3>,
    h4: ({ children }) => <h4>{renderChildren(children, renderText)}</h4>,
    h5: ({ children }) => <h5>{renderChildren(children, renderText)}</h5>,
    h6: ({ children }) => <h6>{renderChildren(children, renderText)}</h6>,
    strong: ({ children }) => <strong>{renderChildren(children, renderText)}</strong>,
    em: ({ children }) => <em>{renderChildren(children, renderText)}</em>,
    del: ({ children }) => <del>{renderChildren(children, renderText)}</del>,
  };

  return <div className={['markdown-content', className].filter(Boolean).join(' ')} data-markdown-content>
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
      {content}
    </ReactMarkdown>
  </div>;
}
