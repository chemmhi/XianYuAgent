import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthApi } from '../api';
import { AuthGate } from './AuthGate';

describe('AuthGate', () => {
  it('does not render the session-checking card while auth is resolving', () => {
    const api = {
      getSession: vi.fn(),
      login: vi.fn(),
      bootstrap: vi.fn(),
      logout: vi.fn(),
    } as unknown as AuthApi;

    const html = renderToStaticMarkup(createElement(AuthGate, {
      api,
      children: createElement('div', null, 'authenticated shell'),
    }));

    expect(html).toBe('');
    expect(html).not.toContain('正在检查管理员会话');
  });
});
