import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MessageStream, SessionRow } from './WorkspacePage';
import type { WorkspaceMessageVM, WorkspaceSessionVM } from '../types';

const workspaceCss = readFileSync(fileURLToPath(new URL('./workspace.css', import.meta.url)), 'utf8');

const session: WorkspaceSessionVM = {
  id: 'session-1',
  accountId: 'account-1',
  title: '检查当前 Workspace 状态',
  status: 'active',
  summary: '返回摘要',
  lastActiveAt: '2026-09-21T23:18:00.000Z',
  updatedAt: '2026-09-21T23:18:00.000Z',
};

describe('Workspace SessionRow', () => {
  it('renders a semantic icon archive action with an auditable target', () => {
    const html = renderToStaticMarkup(createElement(SessionRow, {
      session,
      active: true,
      busy: false,
      onSwitch: vi.fn(),
      onArchive: vi.fn(),
    }));

    expect(html).toContain('data-testid="workspace-session-archive"');
    expect(html).toContain('aria-label="归档 检查当前 Workspace 状态"');
    expect(html).toContain('class="workspace-session-action-icon"');
    expect(html).not.toContain('>•••</button>');
    expect(workspaceCss).not.toContain('.workspace-session-action:focus-visible');
  });
});

describe('Workspace MessageStream', () => {
  it('keeps agent execution details collapsed and removes avatar chrome', () => {
    const messages: WorkspaceMessageVM[] = [
      { id: 'user-1', runId: 'run-1', type: 'user_message', createdAt: '2026-09-22T00:00:00.000Z', title: '用户', content: '检查店铺状态' },
      { id: 'reasoning-1', runId: 'run-1', type: 'reasoning_summary', createdAt: '2026-09-22T00:00:01.000Z', title: '推理摘要', summary: '读取店铺状态 · 已完成', content: '读取店铺状态' },
      { id: 'tool-1', runId: 'run-1', type: 'tool_event', createdAt: '2026-09-22T00:00:02.000Z', title: '工具事件', eventType: 'products.read', content: '已读取商品列表' },
      { id: 'final-1', runId: 'run-1', type: 'final_answer', createdAt: '2026-09-22T00:00:03.000Z', title: 'Agent', content: '店铺状态正常。' },
    ];

    const html = renderToStaticMarkup(createElement(MessageStream, { messages, expandedTrace: null, onToggleTrace: vi.fn() }));

    expect(html).toContain('class="workspace-agent-trace"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="workspace-trace-action">可展开</span>');
    expect(html).toContain('workspace-message workspace-message-final');
    expect(html).not.toContain('workspace-message-avatar');
    expect(html).not.toContain('workspace-message-tool');
  });
});
