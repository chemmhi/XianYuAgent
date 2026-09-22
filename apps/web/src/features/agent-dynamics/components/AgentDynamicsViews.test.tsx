import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExceptionPanel, RunDrawer, RuntimePanel, RunsTable } from './AgentDynamicsViews';
import type { AgentDynamicsFilters, AgentDynamicsLoadError, AgentDynamicsRunDetailVM, AgentDynamicsRunRowVM, AgentDynamicsSummaryVM } from '../types';

const filters: AgentDynamicsFilters = { range: '24h', status: 'all', stage: 'all', keyword: '', page: 1, pageSize: 10 };
const error: AgentDynamicsLoadError = { code: 'NETWORK_ERROR', message: '服务不可用', retryable: true };
const detail: AgentDynamicsRunDetailVM = {
  runId: 'run_success', createdAt: '2026-09-21T06:32:06.000Z', timeLabel: '14:32:06', buyer: { name: '一只橘喵喵亮晶晶', avatar: '橘' }, inboundPreview: '请问这个数字资料包具体包含什么？', product: { name: '数字资料包' }, intent: '商品咨询', stage: { key: 'persistence', label: '已完成', tone: 'info' }, decision: { key: 'replied', label: '自动回复', tone: 'success' }, senderOutcome: { label: '模拟 / 已落库', tone: 'success' }, durationMs: 3200, persisted: true, message: '请问这个数字资料包具体包含什么？', reply: '这个数字资料包包含完整资料说明。', outcomeLabel: '模拟 / 已落库', timeline: [{ id: 'received', title: '已接收买家消息', description: '网关接入：读取买家消息并创建本次自动回复运行', meta: '14:32:06 · 闲鱼网关 push', tone: 'success', details: { input: [{ label: '步骤类型', value: 'inbound_message' }], output: [{ label: '状态变化', value: 'received' }], technical: [{ label: '消息 ID', value: 'message-1' }] } }],
};
const runRow: AgentDynamicsRunRowVM = { runId: 'run_1', createdAt: '2026-09-21T06:32:06.000Z', timeLabel: '14:32:06', buyer: { name: '买家A' }, inboundPreview: '你好', product: { name: '数字资料包' }, intent: '商品咨询', stage: { key: 'persistence', label: '已完成', tone: 'info' }, decision: { key: 'replied', label: '自动回复', tone: 'success' }, senderOutcome: { label: '已发送 / 已落库', tone: 'success' }, durationMs: 1200, persisted: true };
const summary: AgentDynamicsSummaryVM = {
  gateway: { status: 'online', heartbeatLabel: '最近心跳 2 秒前', queueLabel: '消息队列 0 条处理中' },
  kpis: [],
  pipeline: [],
  events: [{ id: 'event_1', time: '14:32:09', title: '一只橘喵喵亮晶晶的消息已完成自动回复', meta: 'general · 已发送 / 已落库', label: '完成', tone: 'success' }],
  health: [],
  healthSummary: [],
  statusDistribution: [],
  exceptions: [],
  asOf: '2026-09-21T06:32:06.000Z',
  refreshIntervalMs: 5000,
};

describe('AgentDynamicsViews', () => {
  it('renders the empty state without synthetic rows', () => {
    const html = renderToStaticMarkup(<RunsTable filters={filters} data={{ items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 }} onFilterChange={() => undefined} onOpenRun={() => undefined} onRetry={() => undefined} loading={false} error={null} />);
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

  it('keeps live event copy on one row and exposes order-style pagination controls', () => {
    const runtimeHtml = renderToStaticMarkup(<RuntimePanel summary={summary} onOpenRun={() => undefined} />);
    expect(runtimeHtml).toContain('agent-dynamics-event-title');
    expect(runtimeHtml).toContain('agent-dynamics-event-meta');
    expect(runtimeHtml).not.toContain('<br');

    const tableHtml = renderToStaticMarkup(<RunsTable filters={filters} data={{ items: [runRow], total: 60, page: 2, pageSize: 10, totalPages: 6 }} onFilterChange={() => undefined} onOpenRun={() => undefined} onRetry={() => undefined} loading={false} error={null} />);
    expect(tableHtml).toContain('data-testid="agent-dynamics-pagination"');
    expect(tableHtml).toContain('上一页');
    expect(tableHtml).toContain('下一页');
    expect(tableHtml).toContain('共 60 条');
    expect(tableHtml).toContain('第 2 / 6 页');
    expect(tableHtml).toContain('…');
  });

  it('constrains long exception copy inside the card content column', () => {
    const html = renderToStaticMarkup(<ExceptionPanel exceptions={[{ key: 'long', title: 'TEST_BUYER_NOT_ALLOWLISTED_WITH_A_LONG_REASON', meta: '14 条 · skipped · 需要管理员确认后继续处理', count: 14, tone: 'info' }]} onOpenFirst={() => undefined} />);
    expect(html).toContain('agent-dynamics-exception-main');
    expect(html).toContain('TEST_BUYER_NOT_ALLOWLISTED_WITH_A_LONG_REASON');
    expect(html).toContain('>14</div>');
  });

  it('renders a drawer detail timeline and actions', () => {
    const html = renderToStaticMarkup(<RunDrawer detail={{ phase: 'success', data: detail, error: null }} onClose={() => undefined} onRetry={() => undefined} onOpenChat={() => undefined} />);
    expect(html).toContain('运行详情');
    expect(html).toContain('已接收买家消息');
    expect(html).toContain('节点日志');
    expect(html).toContain('工作状态');
    expect(html).not.toContain('查看本步输入 / 输出');
    expect(html).not.toContain('一只橘喵喵亮晶晶 的消息已接收');
    expect(html).toContain('技术追踪');
    expect(html).toContain('打开在线聊天');
  });
});
