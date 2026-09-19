import { describe, expect, it } from 'vitest';
import { createMockApi } from './mockApi';

describe('mock API contract', () => {
  it('returns dashboard data with the expected public shape', async () => {
    const api = createMockApi();
    const snapshot = await api.dashboard.getSnapshot();

    expect(snapshot.pendingManualCount).toBe(3);
    expect(snapshot.availableCouponCount).toBe(1286);
    expect(snapshot.trend).toHaveLength(6);
    expect(snapshot.riskTodos[0]).toMatchObject({ severity: 'high', href: '/orders' });
  });

  it('keeps account and product queries scoped by their filters', async () => {
    const api = createMockApi();
    const accountPage = await api.accounts.list({ search: '账号 B' });
    const products = await api.products.list({ accountId: 'B' });

    expect(accountPage.items).toHaveLength(1);
    expect(accountPage.items[0]?.id).toBe('B');
    expect(products.items).toHaveLength(1);
    expect(products.items[0]?.accountId).toBe('B');
  });

  it('recovers a failed order through the retry contract', async () => {
    const api = createMockApi();
    const failedOrders = await api.orders.list({ status: 'failed' });
    const orderNo = failedOrders.items[0]?.orderNo;

    expect(orderNo).toBe('XY202609170061');
    await api.orders.retryDelivery(orderNo!);

    const recoveredOrders = await api.orders.list({ search: orderNo });
    expect(recoveredOrders.items[0]?.deliveryStatus).toBe('delivered');
  });

  it('requires confirmation before completing a workspace run', async () => {
    const api = createMockApi();
    const run = await api.workspace.startRun({
      sessionId: 'session_product_publish',
      instruction: '生成商品发布确认卡',
      idempotencyKey: 'vitest-publish-001',
    });
    const confirmation = await api.workspace.getConfirmation(run.id);
    const completedRun = await api.workspace.confirm(run.id, confirmation?.id ?? '');

    expect(run.status).toBe('waiting_confirmation');
    expect(confirmation).toMatchObject({ policyRef: 'product.publish.confirm', runId: run.id });
    expect(completedRun.status).toBe('succeeded');
  });

  it('updates settings without dropping unrelated fields', async () => {
    const api = createMockApi();
    const before = await api.settings.get();

    await api.settings.update({ replyDelaySeconds: 120 });
    const after = await api.settings.get();

    expect(after.replyDelaySeconds).toBe(120);
    expect(after.autoReplyEnabled).toBe(before.autoReplyEnabled);
    expect(after.aiProvider).toBe(before.aiProvider);
  });
});
