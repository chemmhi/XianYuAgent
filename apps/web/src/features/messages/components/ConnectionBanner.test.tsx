import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionBanner } from './ConnectionBanner';

describe('ConnectionBanner', () => {
  it('uses a compact spinner for the initial realtime handshake', () => {
    const html = renderToStaticMarkup(createElement(ConnectionBanner, { phase: 'connecting', onRetry: vi.fn() }));
    expect(html).toContain('messages-connection-status connecting');
    expect(html).toContain('messages-connection-spinner');
    expect(html).toContain('aria-label="正在建立实时连接"');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('messages-connection-banner');
    expect(html).not.toContain('正在连接实时消息');
  });

  it('uses a compact spinner while reconnecting instead of a blocking banner', () => {
    const html = renderToStaticMarkup(createElement(ConnectionBanner, { phase: 'reconnecting', onRetry: vi.fn() }));
    expect(html).toContain('messages-connection-status reconnecting');
    expect(html).toContain('aria-label="正在同步最新消息"');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('messages-connection-banner');
    expect(html).not.toContain('连接已断开，正在按游标补回消息');
  });

  it('keeps an actionable compact chip for timeout', () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(createElement(ConnectionBanner, { phase: 'timeout', onRetry }));
    expect(html).toContain('messages-connection-status timeout');
    expect(html).toContain('>离线<');
    expect(html).toContain('>重试</button>');
    expect(html).not.toContain('messages-connection-banner');
  });
});
