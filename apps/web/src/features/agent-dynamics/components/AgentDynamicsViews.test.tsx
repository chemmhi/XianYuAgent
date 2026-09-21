import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunDrawer, RunsTable } from './AgentDynamicsViews';
import type { AgentDynamicsFilters, AgentDynamicsLoadError, AgentDynamicsRunDetailVM } from '../types';

const filters: AgentDynamicsFilters = { range: '24h', status: 'all', stage: 'all', keyword: '', page: 1, pageSize: 20 };
const error: AgentDynamicsLoadError = { code: 'NETWORK_ERROR', message: '服务不可用', retryable: true };
const detail: AgentDynamicsRunDetailVM = {
  runId: 'run_success', createdAt: '2026-09-21T06:32:06.000Z', timeLabel: '14:32:06', buyer: { name: '一只橘喵喵亮晶晶', avatar: '橘' }, inboundPreview: '请问这个数字资料包具体包含什么？', product: { name: '数字资料包' }, intent: '商品咨询', stage: { key: 'persistence', label: '已完成', tone: 'info' }, decision: { key: 'replied', label: '自动回复', tone: 'success' }, senderOutcome: { label: '模拟 / 已落库', tone: 'success' }, durationMs: 3200, persisted: true, message: '请问这个数字资料包具体包含什么？', reply: '这个数字资料包包含完整资料说明。', outcomeLabel: '模拟 / 已落库', timeline: [{ id: 'received', title: '已接收买家消息', meta: '14:32:06 · 闲鱼网关 push', tone: 'success', details: { input: [{ label: '类型', value: 'inbound_message' }], output: [{ label: '状态', value: 'received' }] } }],
};

describe('AgentDynamicsViews', () => {
  it('renders the empty state without synthetic rows', () => {
    const html = renderToStaticMarkup(<RunsTable filters={filters} data={{ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }} onFilterChange={() => undefined} onOpenRun={() => undefined} onRetry={() => undefined} loading={false} error={null} />);
    expect(html).toContain('暂无运行记录');
    expect(html).not.toContain('一只橘喵喵亮晶晶');
    expect(html.match(/<select /g)).toHaveLength(2);
    expect(html).toContain('aria-label="运行状态"');
    expect(html).toContain('aria-label="运行阶段"');
    expect(html).toContain('data-agent-dynamics-dropdown="运行状态"');
    expect(html).toContain('data-agent-dynamics-dropdown="运行阶段"');
    expect(html).toContain('class="ui-select-control agent-dynamics-filter"');
  });

  it('renders the inline error and retry affordance', () => {
    const html = renderToStaticMarkup(<RunsTable filters={filters} data={null} onFilterChange={() => undefined} onOpenRun={() => undefined} onRetry={() => undefined} loading={false} error={error} />);
    expect(html).toContain('服务不可用');
    expect(html).toContain('重试');
  });

  it('renders a drawer detail timeline and actions', () => {
    const html = renderToStaticMarkup(<RunDrawer detail={{ phase: 'success', data: detail, error: null }} onClose={() => undefined} onRetry={() => undefined} onOpenChat={() => undefined} />);
    expect(html).toContain('运行详情');
    expect(html).toContain('已接收买家消息');
    expect(html).toContain('输入');
    expect(html).toContain('inbound_message');
    expect(html).toContain('输出');
    expect(html).toContain('打开在线聊天');
  });
});
