import type { DashboardSnapshot } from '../../api/contracts';
import type { DashboardApi } from './api';
import type { DashboardQuery } from './types';

export function createMockDashboardApi(): DashboardApi {
  return {
    async getSnapshot(query?: DashboardQuery): Promise<DashboardSnapshot> {
      const trend = [
        { label: '05/24', orderAmount: 52, autoProcessRate: 79 },
        { label: '05/25', orderAmount: 58, autoProcessRate: 82 },
        { label: '05/26', orderAmount: 64, autoProcessRate: 85 },
        { label: '05/27', orderAmount: 61, autoProcessRate: 84 },
        { label: '05/28', orderAmount: 75, autoProcessRate: 88 },
        { label: '05/29', orderAmount: 72, autoProcessRate: 90 },
        { label: '05/30', orderAmount: 84, autoProcessRate: 93 },
        { label: '05/31', orderAmount: 88, autoProcessRate: 94 },
        { label: '06/01', orderAmount: 92, autoProcessRate: 95 },
        { label: '06/02', orderAmount: 87, autoProcessRate: 94 },
        { label: '06/03', orderAmount: 96, autoProcessRate: 96 },
        { label: '06/04', orderAmount: 101, autoProcessRate: 96 },
        { label: '06/05', orderAmount: 108, autoProcessRate: 97 },
        { label: '06/06', orderAmount: 112, autoProcessRate: 97 },
        { label: '06/07', orderAmount: 118, autoProcessRate: 98 },
        { label: '06/08', orderAmount: 116, autoProcessRate: 97 },
        { label: '06/09', orderAmount: 124, autoProcessRate: 98 },
        { label: '06/10', orderAmount: 128, autoProcessRate: 98 },
        { label: '06/11', orderAmount: 132, autoProcessRate: 98 },
        { label: '06/12', orderAmount: 138, autoProcessRate: 99 },
        { label: '06/13', orderAmount: 142, autoProcessRate: 98 },
        { label: '06/14', orderAmount: 147, autoProcessRate: 99 },
        { label: '06/15', orderAmount: 150, autoProcessRate: 99 },
        { label: '06/16', orderAmount: 156, autoProcessRate: 99 },
        { label: '06/17', orderAmount: 160, autoProcessRate: 99 },
        { label: '06/18', orderAmount: 164, autoProcessRate: 99 },
        { label: '06/19', orderAmount: 168, autoProcessRate: 99 },
        { label: '06/20', orderAmount: 172, autoProcessRate: 99 },
        { label: '06/21', orderAmount: 176, autoProcessRate: 99 },
        { label: '06/22', orderAmount: 182, autoProcessRate: 99 },
      ];
      const visibleTrend = query?.range === 'today' ? trend.slice(-1) : query?.range === '3d' ? trend.slice(-3) : query?.range === '7d' ? trend.slice(-7) : trend;
      return {
        totalSales: 78420,
        todayOrderAmount: 18640,
        selectedRangeSales: 78420,
        autoProcessRate: 96.8,
        pendingManualCount: 3,
        trend: visibleTrend,
        health: [
          { label: '监听心跳', value: '正常', tone: 'ok' },
          { label: '自动回复策略', value: '180 秒', tone: 'info' },
          { label: '虚拟发货', value: '立即发货', tone: 'ok' },
          { label: '凭证边界', value: '管理员可管理', tone: 'warn' },
        ],
        productRank: [
          { title: 'Python 全栈资料包', subtitle: '虚拟资源 · 交付配置已就绪', orders: '42', deliveryConfig: '已就绪', status: '可交付', tone: 'ok' },
          { title: 'AI 绘画教程合集', subtitle: '虚拟资源 · 交付配置已就绪', orders: '31', deliveryConfig: '已就绪', status: '可交付', tone: 'ok' },
          { title: '考研英语资料', subtitle: '虚拟资源 · 待配置交付内容', orders: '18', deliveryConfig: '待配置', status: '待配置', tone: 'warn' },
          { title: '自动化办公模板', subtitle: '虚拟资源 · 交付配置已就绪', orders: '12', deliveryConfig: '已就绪', status: '可交付', tone: 'ok' },
        ],
        recentActivity: [
          { time: '14:22', text: '小橙子询问付款后发货时间，AI 已引用商品知识 v12 回复。', status: 'AI 已回复', tone: 'ok', href: '/messages' },
          { time: '14:18', text: '订单 XY20260909001 已付款，Outbox 立即发货成功。', status: '已发货', tone: 'ok', href: '/orders' },
          { time: '14:11', text: '买家索要跨商品资源，系统拦截并通知管理员。', status: '风险待确认', tone: 'warn', href: '/workspace' },
          { time: '13:58', text: '考研英语资料付款后未发货，生成待办。', status: '补发货', tone: 'warn', href: '/orders' },
        ],
        riskTodos: [
          { id: 'todo_001', title: '考研英语资料付款后未发货', detail: '订单已付款，需要补充或重试发货。', severity: 'high', href: '/orders' },
          { id: 'todo_002', title: '闲鱼账号 B 需要重新授权', detail: '登录态已过期，消息监听与自动回复已暂停。', severity: 'medium', href: '/accounts' },
          { id: 'todo_003', title: '跨商品资源请求已拦截', detail: '等待人工确认下一步处理策略。', severity: 'low', href: '/messages' },
        ],
      };
    },
  };
}

