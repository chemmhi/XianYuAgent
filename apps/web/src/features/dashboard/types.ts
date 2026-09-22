import type { DashboardSnapshot } from '../../api/contracts';

export type DashboardTone = 'ok' | 'warn' | 'danger' | 'info' | 'gray';

export type DashboardRange = 'today' | '3d' | '7d' | '1m' | 'custom';

export interface DashboardQuery {
  range: DashboardRange;
  from?: string;
  to?: string;
}

export interface DashboardKpiVM {
  key: 'totalSales' | 'orderAmount' | 'autoProcessRate' | 'pendingManual';
  label: string;
  value: string;
  delta: string;
  context: string;
  tone: DashboardTone;
}

export interface DashboardHealthVM {
  label: string;
  value: string;
  tone: DashboardTone;
}

export interface DashboardProductRankVM {
  title: string;
  subtitle: string;
  orders: string;
  stock: string;
  status: string;
  tone: DashboardTone;
}

export interface DashboardActivityVM {
  time: string;
  text: string;
  status: string;
  tone: DashboardTone;
  href?: string;
}

export interface DashboardRiskTodoVM {
  id: string;
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
  tone: DashboardTone;
  href: string;
}

export interface DashboardVM {
  kpis: DashboardKpiVM[];
  trend: Array<{ label: string; primary: number; secondary: number }>;
  health: DashboardHealthVM[];
  productRank: DashboardProductRankVM[];
  recentActivity: DashboardActivityVM[];
  riskTodos: DashboardRiskTodoVM[];
  updatedAt: string;
}

export type DashboardLoadPhase = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'forbidden' | 'timeout';

export interface DashboardLoadError {
  code: 'NETWORK_ERROR' | 'FORBIDDEN' | 'TIMEOUT' | 'UNKNOWN';
  message: string;
  retryable: boolean;
}

export interface DashboardState {
  phase: DashboardLoadPhase;
  data: DashboardVM | null;
  error: DashboardLoadError | null;
  refreshing: boolean;
}

export function toDashboardVM(snapshot: DashboardSnapshot): DashboardVM {
  const kpis: DashboardKpiVM[] = [
    { key: 'totalSales', label: '总销售额', value: `¥${snapshot.totalSales.toLocaleString('zh-CN')}`, delta: '累计', context: '全部已付款订单', tone: 'info' },
    { key: 'orderAmount', label: '今日订单金额', value: `¥${snapshot.todayOrderAmount.toLocaleString('zh-CN')}`, delta: '实时', context: '今日汇总', tone: 'ok' },
    { key: 'autoProcessRate', label: '自动处理成功率', value: `${snapshot.autoProcessRate}%`, delta: '实时', context: '当前账号', tone: 'ok' },
    { key: 'pendingManual', label: '待人工处理', value: String(snapshot.pendingManualCount), delta: '待处理', context: '风险待办', tone: 'warn' },
  ];

  const health = snapshot.health ?? [
    { label: '监听心跳', value: '正常', tone: 'ok' as DashboardTone },
    { label: '自动回复策略', value: '180 秒', tone: 'info' as DashboardTone },
    { label: '虚拟发货', value: '立即发货', tone: 'ok' as DashboardTone },
    { label: '凭证边界', value: '管理员可管理', tone: 'warn' as DashboardTone },
  ];

  const productRank = snapshot.productRank ?? [];
  const recentActivity = snapshot.recentActivity ?? [];
  const riskTodos = snapshot.riskTodos.map((todo) => ({
    ...todo,
    detail: todo.detail ?? '需要运营管理员继续处理。',
    tone: todo.severity === 'high' ? 'danger' as DashboardTone : todo.severity === 'medium' ? 'warn' as DashboardTone : 'info' as DashboardTone,
  }));

  return {
    kpis,
    trend: snapshot.trend.map((item) => ({ label: item.label, primary: item.orderAmount, secondary: item.autoProcessRate })),
    health,
    productRank,
    recentActivity,
    riskTodos,
    updatedAt: new Date().toISOString(),
  };
}
