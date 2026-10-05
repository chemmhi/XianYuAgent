import { describe, expect, it } from 'vitest';
import { toDashboardVM } from './types';

describe('dashboard view model', () => {
  it('formats the four KPI cards and maps risk severity to semantic tones', () => {
    const vm = toDashboardVM({
      totalSales: 78420,
      todayOrderAmount: 18640,
      selectedRangeSales: 52,
      autoProcessRate: 96.8,
      pendingManualCount: 3,
      trend: [{ label: '周一', orderAmount: 58, salesAmount: 52, autoProcessRate: 82 }],
      riskTodos: [
        { id: 'todo-high', title: '高风险', severity: 'high', href: '/orders' },
        { id: 'todo-medium', title: '中风险', severity: 'medium', href: '/accounts' },
        { id: 'todo-low', title: '低风险', severity: 'low', href: '/messages' },
      ],
    });

    expect(vm.kpis.map((item) => item.value)).toEqual(['¥78,420', '¥18,640', '96.8%', '3']);
    expect(vm.riskTodos.map((item) => item.tone)).toEqual(['danger', 'warn', 'info']);
    expect(vm.selectedRangeSales).toBe(52);
    expect(vm.trend[0]).toEqual({ label: '周一', sales: 52, secondary: 82 });
  });
});

