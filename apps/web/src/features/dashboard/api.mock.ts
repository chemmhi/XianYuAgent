import type { DashboardSnapshot } from '../../api/contracts';
import type { DashboardApi } from './api';

export function createMockDashboardApi(): DashboardApi {
  return {
    async getSnapshot(): Promise<DashboardSnapshot> {
      return {
        todayOrderAmount: 18640,
        autoProcessRate: 96.8,
        pendingManualCount: 3,
        availableCouponCount: 1286,
        trend: [
          { label: '周一', orderAmount: 58, autoProcessRate: 82 },
          { label: '周二', orderAmount: 64, autoProcessRate: 85 },
          { label: '周三', orderAmount: 61, autoProcessRate: 84 },
          { label: '周四', orderAmount: 75, autoProcessRate: 88 },
          { label: '周五', orderAmount: 72, autoProcessRate: 90 },
          { label: '周六', orderAmount: 84, autoProcessRate: 93 },
        ],
        health: [
          { label: '监听心跳', value: '正常', tone: 'ok' },
          { label: '自动回复策略', value: '180 秒', tone: 'info' },
          { label: '虚拟发货', value: '立即发货', tone: 'ok' },
          { label: '凭证边界', value: '管理员可管理', tone: 'warn' },
        ],
        productRank: [
          { title: 'Python 全栈资料包', subtitle: '虚拟资源 · 凭证完整', orders: '42', stock: '368', status: '可售', tone: 'ok' },
          { title: 'AI 绘画教程合集', subtitle: '虚拟资源 · 凭证完整', orders: '31', stock: '220', status: '可售', tone: 'ok' },
          { title: '考研英语资料', subtitle: '知识待补充', orders: '18', stock: '0', status: '缺凭证', tone: 'warn' },
          { title: '自动化办公模板', subtitle: '知识待补充', orders: '12', stock: '90', status: '可售', tone: 'ok' },
        ],
        recentActivity: [
          { time: '14:22', text: '小橙子询问付款后发货时间，AI 已引用商品知识 v12 回复。', status: 'AI 已回复', tone: 'ok', href: '/messages' },
          { time: '14:18', text: '订单 XY20260909001 已付款，Outbox 立即发货成功。', status: '已发货', tone: 'ok', href: '/orders' },
          { time: '14:11', text: '买家索要跨商品资源，系统拦截并通知管理员。', status: '风险待确认', tone: 'warn', href: '/workspace' },
          { time: '13:58', text: '考研英语资料缺 buyer_deliverable 凭证，生成待办。', status: '补凭证', tone: 'warn', href: '/orders' },
        ],
        riskTodos: [
          { id: 'todo_001', title: '考研英语资料缺少发货凭证', detail: '付款后未发货，需要补充 buyer_deliverable 凭证。', severity: 'high', href: '/orders' },
          { id: 'todo_002', title: '闲鱼账号 B 需要重新授权', detail: '登录态已过期，消息监听与自动回复已暂停。', severity: 'medium', href: '/accounts' },
          { id: 'todo_003', title: '跨商品资源请求已拦截', detail: '等待人工确认下一步处理策略。', severity: 'low', href: '/messages' },
        ],
      };
    },
  };
}

