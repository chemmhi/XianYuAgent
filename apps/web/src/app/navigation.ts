export type PageKey =
  | 'dashboard'
  | 'workspace'
  | 'accounts'
  | 'messages'
  | 'products'
  | 'coupons'
  | 'orders'
  | 'agent-dynamics'
  | 'settings';

export interface NavItem {
  key: PageKey;
  label: string;
  sub: string;
  icon: string;
}

/** Primary navigation for the first operational console release. */
export const navItems: NavItem[] = [
  { key: 'dashboard', label: '仪表盘', sub: '数据概览', icon: 'grid' },
  { key: 'workspace', label: 'Workspace', sub: 'Agent 工作台', icon: 'message' },
  { key: 'accounts', label: '账号管理', sub: '登录与状态', icon: 'user' },
  { key: 'messages', label: '在线聊天', sub: '会话与回复', icon: 'inbox' },
  { key: 'products', label: '商品管理', sub: '商品与发布', icon: 'box' },
  { key: 'coupons', label: '卡券管理', sub: '交付配置与生成', icon: 'ticket' },
  { key: 'orders', label: '订单管理', sub: '交易与发货', icon: 'cart' },
  { key: 'agent-dynamics', label: 'Agent 动态', sub: '运行监控', icon: 'activity' },
  { key: 'settings', label: '设置', sub: '策略与凭证', icon: 'gear' },
];

/** URL skeleton retained while the prototype still switches pages in memory. */
export function pathForPage(page: PageKey): `/${PageKey}` {
  return `/${page}`;
}
