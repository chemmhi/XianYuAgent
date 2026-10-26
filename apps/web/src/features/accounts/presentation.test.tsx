import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { accountStatusDescription, messageConnectionLabels } from './presentation';
import { CurrentAccountCard } from './components/CurrentAccountCard';
import { createMockAccountsApi } from './api';

describe('account presentation', () => {
  it('separates a functional error from a healthy message connection and preserves the full name', async () => {
    const row = (await createMockAccountsApi().list()).items[0];
    const account = { ...row, displayName: '逐星智能', status: 'degraded' as const, degradedSource: 'im', connection: { status: 'online' as const } };
    const html = renderToStaticMarkup(createElement(CurrentAccountCard, { account }));
    expect(html).toContain('逐星智能'); expect(html).toContain('部分功能异常'); expect(html).toContain('消息已连接');
    expect(html).toContain('最近消息操作未成功。'); expect(html).not.toContain('账号上下文');
  });
  it.each(['future-sensitive-source', '__proto__', 'toString'])('does not render unknown diagnostic source %s', async source => {
    const account = (await createMockAccountsApi().list()).items[0];
    expect(accountStatusDescription({ ...account, status: 'degraded', degradedSource: source })).toBe('最近账号操作异常，具体原因未记录。');
  });
  it('makes the message connection object explicit in every label and handles an unselected account', () => {
    expect(Object.values(messageConnectionLabels).every(label => label.includes('消息'))).toBe(true);
    const html = renderToStaticMarkup(createElement(CurrentAccountCard));
    expect(html).toContain('未选择账号'); expect(html).toContain('在列表中点击');
    expect(html).not.toContain('账号正常');
  });
});
