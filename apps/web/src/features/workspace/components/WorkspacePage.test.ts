import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatToolEventContent, getComposerTextareaMetrics, MessageStream, scrollMessageStreamToLatest, SessionRow, WorkspaceConfirmationCard, WorkspaceDeleteSessionModal, WorkspaceSendButton } from './WorkspacePage';
import type { WorkspaceConfirmationVM, WorkspaceMessageVM, WorkspaceRunVM, WorkspaceSessionVM } from '../types';

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

  it('keeps title generation loading fixed at the right edge before delete', () => {
    const html = renderToStaticMarkup(createElement(SessionRow, {
      session: { ...session, titlePending: true },
      active: true,
      busy: false,
      onSwitch: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).toContain('class="workspace-session-title-status"');
    expect(html).toContain('class="workspace-session-title-loading"');
    expect(html.indexOf('workspace-session-title-status')).toBeLessThan(html.indexOf('workspace-session-action'));
    expect(workspaceCss).toContain('margin-left: auto; padding-right: 2px;');
  });

  it('collapses title and task loading into one spinner', () => {
    const html = renderToStaticMarkup(createElement(SessionRow, {
      session: { ...session, titlePending: true },
      active: true,
      running: true,
      busy: false,
      onSwitch: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect((html.match(/workspace-session-(?:title-loading|running-icon)/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="会话标题和任务处理中"');
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
  it('scrolls the conversation surface to the latest appended content', () => {
    const stream = { scrollTop: 0, scrollHeight: 720 };
    scrollMessageStreamToLatest(stream);
    expect(stream.scrollTop).toBe(720);
    expect(workspacePageSource).toContain('ref={messageStreamRef}');
    expect(workspacePageSource).toContain('scrollMessageStreamToLatest(messageStreamRef.current)');
  });

  it('renders summaries and tool actions as a compact chronological feed', () => {
    const messages: WorkspaceMessageVM[] = [
      { id: 'user-1', runId: 'run-1', type: 'user_message', createdAt: '2026-09-22T00:00:00.000Z', title: '用户', content: '检查店铺状态' },
      { id: 'reasoning-1', runId: 'run-1', type: 'reasoning_summary', createdAt: '2026-09-22T00:00:01.000Z', title: '推理摘要', summary: '读取店铺状态 · 已完成', content: '读取店铺状态' },
      { id: 'tool-1', runId: 'run-1', type: 'tool_event', createdAt: '2026-09-22T00:00:02.000Z', title: 'workspace_product_search', summary: '检索商品信息', eventType: 'tool.result', content: '已读取商品列表' },
      { id: 'final-1', runId: 'run-1', type: 'final_answer', createdAt: '2026-09-22T00:00:03.000Z', title: 'Agent', content: '店铺状态正常。' },
    ];

    const html = renderToStaticMarkup(createElement(MessageStream, { messages }));

    expect(html).toContain('class="workspace-activity-summary"');
    expect(html).toContain('class="workspace-activity-action"');
    expect(html).toContain('检索商品信息');
    expect(html).toContain('workspace-activity-action-toggle');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('workspace-activity-action-details');
    expect(html).not.toContain('已处理 3秒');
    expect(html).toContain('workspace-message workspace-message-final');
    expect(html).not.toContain('workspace-message-avatar');
    expect(html).not.toContain('workspace-message-tool');
    expect(html.indexOf('读取店铺状态')).toBeLessThan(html.indexOf('检索商品信息'));

    const expandedHtml = renderToStaticMarkup(createElement(MessageStream, { messages, expandedTrace: 'tool-1', onToggleTrace: vi.fn() }));
    expect(expandedHtml).toContain('workspace-activity-action-details');
    expect(expandedHtml).toContain('已读取商品列表');
    expect(expandedHtml).toContain('aria-expanded="true"');
  });

  it('removes empty generic tool rows but keeps expandable command rows', () => {
    const emptyGeneric: WorkspaceMessageVM = {
      id: 'tool-empty', runId: 'run-1', type: 'tool_event', createdAt: '2026-09-22T00:00:02.000Z', title: '工具事件', content: 'workspace skill progress',
    };
    const usefulCommand: WorkspaceMessageVM = {
      id: 'tool-command', runId: 'run-1', type: 'tool_event', createdAt: '2026-09-22T00:00:03.000Z', title: 'pi_skill_preflight', summary: '运行了命令', content: '已选择工具：pi_skill_preflight（执行 pi_skill_preflight）',
    };

    const emptyHtml = renderToStaticMarkup(createElement(MessageStream, { messages: [emptyGeneric] }));
    expect(emptyHtml).not.toContain('workspace-activity-action');

    const usefulHtml = renderToStaticMarkup(createElement(MessageStream, { messages: [usefulCommand], expandedTrace: 'tool-command', onToggleTrace: vi.fn() }));
    expect(usefulHtml).toContain('运行了命令');
    expect(usefulHtml).toContain('pi_skill_preflight');
    expect(usefulHtml).toContain('workspace-activity-action-details');
  });

  it('renders trace duration in human-friendly units', () => {
    const messages: WorkspaceMessageVM[] = [
      { id: 'reasoning-1', runId: 'run-1', type: 'reasoning_summary', createdAt: '2026-09-22T00:00:00.000Z', title: '推理摘要', summary: '读取店铺状态 · 已完成', content: '读取店铺状态' },
      { id: 'tool-1', runId: 'run-1', type: 'tool_event', createdAt: '2026-09-22T00:05:47.000Z', title: 'workspace_read', eventType: 'tool.result', content: '已读取商品列表' },
    ];
    const html = renderToStaticMarkup(createElement(MessageStream, { messages }));
    expect(html).toContain('读取店铺状态');
    expect(html).toContain('读取工作区数据');
    expect(html).not.toContain('347000ms');
  });

  it('renders Markdown in final answers like the ChatGPT conversation surface', () => {
    const messages: WorkspaceMessageVM[] = [
      { id: 'final-1', runId: 'run-1', type: 'final_answer', createdAt: '2026-09-22T00:00:03.000Z', title: 'Agent', content: '找到的商品是 **PPT Master**。\n\n- Windows 安装包\n- `一键卸载脚本`' },
    ];

    const html = renderToStaticMarkup(createElement(MessageStream, { messages }));

    expect(html).toContain('data-markdown-content');
    expect(html).toContain('<strong>PPT Master</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<code>一键卸载脚本</code>');
    expect(html).not.toContain('**PPT Master**');
  });
});

describe('Workspace Composer styling contract', () => {
  it('keeps the centered rounded field aligned to the conversation content width', () => {
    expect(workspaceCss).toContain('.workspace-composer-docked { align-self: center; width: min(100%, 760px);');
    expect(workspaceCss).toContain('border: 1px solid #D8DCE3; border-radius: 24px;');
    expect(workspaceCss).toContain('.workspace-composer-docked:focus-within { border-color: #BAC2CF;');
    expect(workspaceCss).toContain('.workspace-composer-docked textarea { min-height: 48px;');
    expect(workspaceCss).toContain('border: 0; border-radius: 0; background: transparent;');
    expect(workspaceCss).toContain('.workspace-composer-docked textarea:focus { border: 0; outline: none; box-shadow: none; }');
    expect(workspaceCss).toContain('.workspace-send-round { display: grid; place-items: center; width: 28px; height: 28px;');
    expect(workspaceCss).toContain('.workspace-send-round.is-submitting, .workspace-send-round.is-submitting:hover:not(:disabled) { background: #111827; }');
    expect(workspaceCss).toContain('max-height: 120px; height: auto; overflow-y: hidden;');
    expect(workspaceCss).toContain('font-size: var(--font-size-body);');
    expect(workspaceCss).toContain('font-size: var(--font-size-body-compact);');
    expect(workspaceCss).toContain('font-size: var(--font-size-meta);');
    expect(workspaceCss).toContain('.workspace-sidebar { display: block; min-width: 0; align-self: stretch; min-height: 0; }');
    expect(workspaceCss).toContain('.workspace-layout { min-height: 0; }');
    expect(workspaceCss).toContain('.workspace-sessions-panel { display: flex; flex: 0 0 auto; flex-direction: column; align-self: stretch; min-height: 0; max-height: none;');
    expect(workspaceCss).toContain('.workspace-session-list { display: grid; align-content: start; width: 100%; box-sizing: border-box; min-height: 0; max-height: none; overflow-y: auto; overflow-x: hidden;');
    expect(workspaceCss).toContain('.workspace-tool-event-details { margin: 7px 0 0 26px; padding: 10px 0 0; background: transparent; min-width: 0; max-width: calc(100% - 26px);');
    expect(workspaceCss).toContain('.workspace-tool-event-details pre { margin: 0; max-width: 100%; min-width: 0; color: var(--sub); font: inherit; font-size: var(--font-size-body); line-height: var(--font-line-body);');
    expect(workspaceCss).toContain('overflow-wrap: anywhere; word-break: break-word;');
    expect(workspacePageSource).not.toContain('WorkspaceContextPanel');
  });

  it('formats JSON tool results and preserves readable wrapping for long payloads', () => {
    const content = '工具结果：Skill execution complete\n{"code":0,"data":{"file_list":[{"name":"Tools-Installer.exe","size":11032088}]}}{"code":0,"msg":"成功"}';
    const formatted = formatToolEventContent(content);
    expect(formatted).toContain('工具结果：Skill execution complete');
    expect(formatted).toContain('"file_list": [');
    expect(formatted).toContain('"name": "Tools-Installer.exe"');
    expect(formatted).toContain('\n\n{\n  "code": 0,');
    expect(formatted).not.toContain('}{');
  });

  it('switches the send action to a stop icon while a run is submitting', () => {
    const ready = renderToStaticMarkup(createElement(WorkspaceSendButton, { submitting: false, disabled: false }));
    const submitting = renderToStaticMarkup(createElement(WorkspaceSendButton, { submitting: true, disabled: true }));
    expect(ready).toContain('workspace-send-round');
    expect(ready).not.toContain('is-submitting');
    expect(ready).toContain('m5 12 14-7');
    expect(submitting).toContain('workspace-send-round is-submitting');
    expect(submitting).toContain('<rect x="7" y="7" width="10" height="10"');
    expect(submitting).toContain('aria-label="提交中"');
    const cancellable = renderToStaticMarkup(createElement(WorkspaceSendButton, { submitting: true, disabled: true, cancellable: true, onCancel: vi.fn() }));
    expect(cancellable).toContain('aria-label="取消当前任务"');
    expect(cancellable).toContain('type="button"');
  });

  it('keeps Enter send and Shift+Enter newline semantics in the source contract', () => {
    expect(workspacePageSource).toContain("event.key === 'Enter' && !event.shiftKey");
    expect(workspacePageSource).toContain('event.currentTarget.form?.requestSubmit()');
    expect(workspacePageSource).toContain('onPaste=');
    expect(workspacePageSource).toContain('clipboardImageFiles(event.clipboardData)');
  });

  it('grows with content until the maximum, then scrolls internally', () => {
    expect(getComposerTextareaMetrics(92)).toEqual({ height: 92, overflowY: 'hidden' });
    expect(getComposerTextareaMetrics(240)).toEqual({ height: 120, overflowY: 'auto' });
    expect(getComposerTextareaMetrics(0)).toEqual({ height: 48, overflowY: 'hidden' });
  });
});

describe('Workspace empty state layout contract', () => {
  it('centers the new-conversation prompt in the available message stream', () => {
    expect(workspacePageSource).toContain('workspace-message-stream${hasStreamContent ? \'\' : \' is-empty\'}');
    expect(workspacePageSource).toContain('const showOutbox = !draftMode && Boolean(currentRun && state.outbox.length > 0);');
    expect(workspacePageSource).toContain('{showOutbox && <WorkspaceOutboxPanel');
    expect(workspaceCss).toContain('.workspace-message-stream.is-empty { display: grid; flex: 1 1 auto; min-height: 0; place-items: center; overflow: auto; }');
    expect(workspaceCss).toContain('.workspace-message-stream.is-empty .workspace-state { width: 100%; min-height: 0;');
  });
});

describe('Workspace session search alignment contract', () => {
  it('uses the same horizontal inset as the session rows below', () => {
    expect(workspaceCss).toContain('.workspace-search { width: calc(100% - 16px); max-width: none; margin: 12px 8px 8px; }');
    expect(workspaceCss).toContain('.workspace-session-list { display: grid; align-content: start; width: 100%; box-sizing: border-box; min-height: 0; max-height: none; overflow-y: auto; overflow-x: hidden; padding: 0 8px 10px; }');
    expect(workspaceCss).toContain('.workspace-layout { grid-template-columns: 292px minmax(0, 1fr); gap: 14px; min-height: 0; align-items: start; }');
    expect(workspaceCss).toContain('.workspace-sidebar { display: block; min-width: 0; align-self: stretch; min-height: 0; }');
    expect(workspaceCss).toContain('.workspace-sidebar { height: 100%; min-height: 0; }');
    expect(workspaceCss).toContain('.workspace-sessions-panel { height: 100%; min-height: 0; max-height: none; }');
    expect(workspaceCss).toContain('.workspace-session-list { flex: 1 1 auto; min-height: 0; max-height: none; overflow-y: auto; overflow-x: hidden; }');
  });
});

describe('Workspace confirmation feedback contract', () => {
  it('keeps the continue action readable on hover and renders controller errors as a toast', () => {
    expect(workspaceCss).toContain('.workspace-confirmation-actions .warning:hover,');
    expect(workspaceCss).toContain('.workspace-confirmation-actions .warning:disabled:hover');
    expect(workspaceCss).toContain('background: #8F5A0E; color: #fff;');
    expect(workspacePageSource).toContain("import { Toast } from '../../../shared/ui/Toast';");
    expect(workspacePageSource).toContain('{errorToast && <Toast message={errorToast} tone="error"');
    expect(workspacePageSource).not.toContain('{state.error && <div className="workspace-inline-error"');
  });
});

describe('Workspace confirmation readability', () => {
  it('shows the concrete product automation change instead of internal fields', () => {
    const run: WorkspaceRunVM = {
      runId: 'run-automation-1',
      sessionId: 'session-1',
      accountId: 'account-1',
      status: 'waiting_confirmation',
      instructionSummary: '启动商品自动发货',
      createdAt: '2026-10-06T12:00:00.000Z',
      updatedAt: '2026-10-06T12:00:01.000Z',
      steps: [],
    };
    const confirmation: WorkspaceConfirmationVM = {
      confirmationId: 'confirmation-1',
      runId: run.runId,
      stepId: 'step-1',
      accountId: run.accountId,
      action: 'product_automation_update',
      policyRef: 'workspace.product_automation_update.confirm',
      manifest: {
        action: 'product_automation_update',
        accountId: run.accountId,
        productId: 'product-1',
        productTitle: 'AI工具一键下载服务',
        expectedConfigVersion: 1,
        fields: ['paidAutoDelivery'],
        automationChanges: [{ key: 'paidAutoDelivery', label: '付费自动发货', before: '关闭，未绑定卡券', after: '开启，绑定 1 个卡券批次' }],
        displayTitle: '商品自动化规则变更确认',
        displaySummary: '准备启用商品“AI工具一键下载服务”的自动化规则',
      },
      status: 'active',
      version: 1,
      expiresAt: '2026-10-06T12:10:00.000Z',
      createdAt: '2026-10-06T12:00:01.000Z',
      updatedAt: '2026-10-06T12:00:01.000Z',
    };

    const html = renderToStaticMarkup(createElement(WorkspaceConfirmationCard, {
      run,
      accountName: '陈陈cc',
      confirmation,
      actionSubmitting: false,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(html).toContain('商品自动化规则变更 · 需要管理员确认');
    expect(html).toContain('AI工具一键下载服务');
    expect(html).toContain('付费自动发货');
    expect(html).toContain('关闭，未绑定卡券 → 开启，绑定 1 个卡券批次');
    expect(html).toContain('当前状态');
    expect(html).toContain('确认后');
    expect(html).not.toContain('accountId');
    expect(html).not.toContain('productId');
    expect(html).not.toContain('policy:');
  });

  it('blocks confirmation instead of showing ambiguous placeholders when preview data is missing', () => {
    const run: WorkspaceRunVM = {
      runId: 'run-automation-2', sessionId: 'session-1', accountId: 'account-1', status: 'waiting_confirmation',
      instructionSummary: '为AI工具一键下载服务设置夸克网盘自动发货', createdAt: '2026-10-06T12:00:00.000Z', updatedAt: '2026-10-06T12:00:01.000Z', steps: [],
    };
    const confirmation: WorkspaceConfirmationVM = {
      confirmationId: 'confirmation-2', runId: run.runId, stepId: 'step-2', accountId: run.accountId,
      action: 'product_automation_update', policyRef: 'workspace.product_automation_update.confirm',
      manifest: { action: 'product_automation_update', fields: ['paidAutoDelivery'], expectedConfigVersion: 1 },
      status: 'active', version: 1, expiresAt: '2026-10-06T12:10:00.000Z', createdAt: '2026-10-06T12:00:01.000Z', updatedAt: '2026-10-06T12:00:01.000Z',
    };
    const html = renderToStaticMarkup(createElement(WorkspaceConfirmationCard, { run, accountName: '陈陈cc', confirmation, actionSubmitting: false, onConfirm: vi.fn(), onCancel: vi.fn() }));
    expect(html).toContain('AI工具一键下载服务');
    expect(html).toContain('系统未获取到商品“AI工具一键下载服务”的完整自动化配置');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('当前商品');
    expect(html).not.toContain('未读取当前状态');
    expect(html).not.toContain('按请求更新');
  });
});
