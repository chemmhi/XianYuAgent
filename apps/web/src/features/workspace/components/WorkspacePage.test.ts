import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getComposerTextareaMetrics, MessageStream, SessionRow, WorkspaceDeleteSessionModal } from './WorkspacePage';
import type { WorkspaceMessageVM, WorkspaceSessionVM } from '../types';

const workspaceCss = readFileSync(fileURLToPath(new URL('./workspace.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\r\n').replace(/\s+/g, ' ').trim();
const workspacePageSource = readFileSync(fileURLToPath(new URL('./WorkspacePage.tsx', import.meta.url)), 'utf8');

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
  it('renders a semantic delete action with an auditable target', () => {
    const html = renderToStaticMarkup(createElement(SessionRow, {
      session,
      active: true,
      busy: false,
      onSwitch: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).toContain('data-testid="workspace-session-delete"');
    expect(html).toContain('aria-label="删除 检查当前 Workspace 状态"');
    expect(html).not.toContain('workspace-session-archive');
    expect(html).not.toContain('归档');
    expect(html).toContain('class="workspace-session-action-icon"');
    expect(html).not.toContain('workspace-session-time');
    expect(html).not.toContain('>•••</button>');
    expect(workspaceCss).toContain('.workspace-session-action-icon { width: 16px; height: 16px; }');
  });

  it('marks an active session with a compact running indicator in the title', () => {
    const html = renderToStaticMarkup(createElement(SessionRow, {
      session,
      active: true,
      running: true,
      busy: false,
      onSwitch: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).toContain('class="workspace-session-running-icon"');
    expect(html).toContain('aria-label="任务进行中"');
    expect(html.indexOf('workspace-session-title')).toBeLessThan(html.indexOf('workspace-session-running-icon'));
    expect(workspaceCss).toContain('@keyframes workspace-session-running-spin');
    expect(workspaceCss).toContain('border: 1.5px solid #9CA3AF;');
  });

  it('does not render a meaningless active label when the session has no summary', () => {
    const html = renderToStaticMarkup(createElement(SessionRow, {
      session: { ...session, summary: undefined },
      active: true,
      busy: false,
      onSwitch: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).not.toContain('活跃');
    expect(workspaceCss).toContain('padding: 8px 10px;');
  });

  it('renders an unread completion dot after the session title', () => {
    const html = renderToStaticMarkup(createElement(SessionRow, {
      session,
      active: false,
      unread: true,
      busy: false,
      onSwitch: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).toContain('class="workspace-session-unread-dot"');
    expect(html).toContain('aria-label="有未读完成任务"');
    expect(workspaceCss).toContain('background: #2563EB;');
  });

  it('uses the existing modal surface for delete confirmation', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceDeleteSessionModal, { session, onClose: vi.fn(), onConfirm: vi.fn() }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-testid="workspace-delete-confirm-modal"');
    expect(html).toContain('class="modal-backdrop"');
    expect(html).toContain('class="modal-card workspace-delete-modal card"');
    expect(html).toContain('data-testid="workspace-delete-confirm"');
    expect(html).toContain('请确认是否删除“检查当前 Workspace 状态”');
    expect(workspacePageSource).not.toContain('window.confirm');
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
    expect(html).toContain('已完成 1 个步骤 · 1 次工具调用');
    expect(html).toContain('class="workspace-trace-action">可展开</span>');
    expect(html).toContain('workspace-message workspace-message-final');
    expect(html).not.toContain('workspace-message-avatar');
    expect(html).not.toContain('workspace-message-tool');
  });

  it('renders Markdown in final answers like the ChatGPT conversation surface', () => {
    const messages: WorkspaceMessageVM[] = [
      { id: 'final-1', runId: 'run-1', type: 'final_answer', createdAt: '2026-09-22T00:00:03.000Z', title: 'Agent', content: '找到的商品是 **PPT Master**。\n\n- Windows 安装包\n- `一键卸载脚本`' },
    ];

    const html = renderToStaticMarkup(createElement(MessageStream, { messages, expandedTrace: null, onToggleTrace: vi.fn() }));

    expect(html).toContain('data-markdown-content');
    expect(html).toContain('<strong>PPT Master</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<code>一键卸载脚本</code>');
    expect(html).not.toContain('**PPT Master**');
  });
});

describe('Workspace Composer styling contract', () => {
  it('keeps the design-grade transparent field and outline-free focus state', () => {
    expect(workspaceCss).toContain('.workspace-composer-docked textarea { min-height: 48px;');
    expect(workspaceCss).toContain('border: 0; border-radius: 0; background: transparent;');
    expect(workspaceCss).toContain('.workspace-composer-docked textarea:focus { border: 0; outline: none; box-shadow: none; }');
    expect(workspaceCss).toContain('.workspace-send-round { display: grid; place-items: center; width: 28px; height: 28px;');
    expect(workspaceCss).toContain('max-height: 120px; height: auto; overflow-y: hidden;');
    expect(workspaceCss).toContain('font-size: var(--font-size-body);');
    expect(workspaceCss).toContain('font-size: var(--font-size-body-compact);');
    expect(workspaceCss).toContain('font-size: var(--font-size-meta);');
    expect(workspaceCss).toContain('.workspace-context-head h3 { font-size: var(--font-size-card-title);');
    expect(workspaceCss).toContain('.workspace-context-list b, body .app-viewport .workspace-domain .workspace-context-list span { font-size: var(--font-size-body-compact);');
  });

  it('grows with content until the maximum, then scrolls internally', () => {
    expect(getComposerTextareaMetrics(92)).toEqual({ height: 92, overflowY: 'hidden' });
    expect(getComposerTextareaMetrics(240)).toEqual({ height: 120, overflowY: 'auto' });
    expect(getComposerTextareaMetrics(0)).toEqual({ height: 48, overflowY: 'hidden' });
  });
});

describe('Workspace empty state layout contract', () => {
  it('centers the new-conversation prompt in the available message stream', () => {
    expect(workspacePageSource).toContain('workspace-message-stream${messages.length ? \'\' : \' is-empty\'}');
    expect(workspaceCss).toContain('.workspace-message-stream.is-empty { display: grid; flex: 1 1 auto; min-height: 0; place-items: center; overflow: auto; }');
    expect(workspaceCss).toContain('.workspace-message-stream.is-empty .workspace-state { width: 100%; min-height: 0;');
  });
});

describe('Workspace session search alignment contract', () => {
  it('uses the same horizontal inset as the session rows below', () => {
    expect(workspaceCss).toContain('.workspace-search { width: calc(100% - 16px); max-width: none; margin: 12px 8px 8px; }');
    expect(workspaceCss).toContain('.workspace-session-list { display: grid; align-content: start; width: 100%; box-sizing: border-box; overflow-x: hidden; overflow-y: auto; padding: 0 8px 10px; }');
  });
});

describe('Workspace confirmation feedback contract', () => {
  it('keeps the continue action readable on hover and renders controller errors as a toast', () => {
    expect(workspaceCss).toContain('.workspace-confirmation-actions .warning:hover:not(:disabled)');
    expect(workspaceCss).toContain('background: #8F5A0E; color: #fff;');
    expect(workspacePageSource).toContain("import { Toast } from '../../../shared/ui/Toast';");
    expect(workspacePageSource).toContain('{errorToast && <Toast message={errorToast} tone="error"');
    expect(workspacePageSource).not.toContain('{state.error && <div className="workspace-inline-error"');
  });
});
