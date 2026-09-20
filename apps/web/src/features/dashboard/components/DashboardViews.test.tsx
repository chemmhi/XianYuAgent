import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DashboardDesktopContent, DashboardMobileContent } from './DashboardViews';
import type { DashboardState } from '../types';

const state: DashboardState = {
  phase: 'success',
  refreshing: false,
  error: null,
  data: {
    kpis: [
      { key: 'orderAmount', label: '今日订单金额', value: '¥18,640', delta: '实时', context: '今日汇总', tone: 'ok' },
      { key: 'autoProcessRate', label: '自动处理成功率', value: '96.8%', delta: '实时', context: '当前账号', tone: 'ok' },
      { key: 'pendingManual', label: '待人工处理', value: '3', delta: '待处理', context: '风险待办', tone: 'warn' },
      { key: 'couponStock', label: '可售卡密库存', value: '1,286', delta: '健康', context: '虚拟资源', tone: 'info' },
    ],
    trend: [{ label: '周一', primary: 58, secondary: 82 }],
    health: [{ label: '监听心跳', value: '正常', tone: 'ok' }],
    productRank: [{ title: 'Python 全栈资料包', subtitle: '虚拟资源 · 凭证完整', orders: '42', stock: '368', status: '可售', tone: 'ok' }],
    recentActivity: [{ time: '14:22', text: 'AI 已回复', status: 'AI 已回复', tone: 'ok', href: '/messages' }],
    riskTodos: [{ id: 'todo_001', title: '考研英语资料缺少发货凭证', detail: '补充凭证', severity: 'high', tone: 'danger', href: '/orders' }],
    updatedAt: new Date(0).toISOString(),
  },
};

describe('dashboard views', () => {
  it('renders the high-fidelity desktop hierarchy', () => {
    const html = renderToStaticMarkup(createElement(DashboardDesktopContent, { state, apiMode: 'mock', onOpenSettings: vi.fn(), onOpenTodo: vi.fn(), onRefresh: vi.fn() }));
    expect(html).toContain('仪表盘');
    expect(html).toContain('订单与 AI 闭环趋势');
    expect(html).toContain('当前账号健康度');
    expect(html).toContain('商品排行');
    expect(html).toContain('最近处理记录');
    expect(html).toContain('data-dashboard-surface="desktop"');
  });

  it('renders the independent mobile composition', () => {
    const html = renderToStaticMarkup(createElement(DashboardMobileContent, { state, onOpenTodo: vi.fn() }));
    expect(html).toContain('Agent 在线 · 闲鱼账号 A');
    expect(html).toContain('补交付凭证');
    expect(html).toContain('今天优先处理');
    expect(html).toContain('经营快照');
    expect(html).toContain('data-dashboard-surface="mobile"');
  });

  it('keeps loading and forbidden states inside the dashboard surface', () => {
    const loadingHtml = renderToStaticMarkup(createElement(DashboardDesktopContent, {
      state: { phase: 'loading', data: null, error: null, refreshing: false },
      apiMode: 'mock',
      onOpenSettings: vi.fn(),
      onOpenTodo: vi.fn(),
      onRefresh: vi.fn(),
    }));
    const forbiddenHtml = renderToStaticMarkup(createElement(DashboardDesktopContent, {
      state: { phase: 'forbidden', data: null, error: { code: 'FORBIDDEN', message: '无权限', retryable: false }, refreshing: false },
      apiMode: 'live',
      onOpenSettings: vi.fn(),
      onOpenTodo: vi.fn(),
      onRefresh: vi.fn(),
    }));
    expect(loadingHtml).toContain('dashboard-skeleton-grid');
    expect(forbiddenHtml).toContain('暂无仪表盘权限');
    expect(forbiddenHtml).toContain('无权限');
  });
});
