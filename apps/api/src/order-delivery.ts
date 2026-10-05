import type { DeliveryRecord, OrderDeliveryType, OrderRecord, Store } from './domain.js';
import type { AutomationExecutionPort, AutomationExternalResult } from './product-automation.js';
import type { ProductAutomationService } from './product-automation.js';
import { ServiceError, OrderService } from './services.js';

export interface DeliveryPreview {
  orderNo: string;
  accountId: string;
  deliveryType: OrderDeliveryType;
  state: 'ready' | 'blocked';
  checks: Array<{ code: string; status: 'pass' | 'blocked'; message: string }>;
  couponBatchIds: string[];
  latestRecord?: DeliveryRecord;
}

export interface DeliveryResult {
  record: DeliveryRecord;
  order?: OrderRecord;
  idempotent: boolean;
}

export interface OrderDeliveryServiceDeps {
  store: Store;
  orders: OrderService;
  productAutomation: ProductAutomationService;
  execution: AutomationExecutionPort;
  audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>;
}

export class OrderDeliveryService {
  constructor(private readonly deps: OrderDeliveryServiceDeps) {}

  async preview(input: { adminId: string; accountId: string; orderNo: string; deliveryType?: OrderDeliveryType; couponBatchIds?: string[]; trackingRef?: string }): Promise<DeliveryPreview> {
    const order = await this.deps.orders.get({ adminId: input.adminId, orderNo: input.orderNo, accountId: input.accountId });
    const deliveryType = input.deliveryType ?? order.deliveryType;
    const checks: DeliveryPreview['checks'] = [];
    checks.push(order.paymentStatus === 'paid' ? pass('PAYMENT_PAID', '订单已支付') : block('PAYMENT_NOT_PAID', '订单尚未支付'));
    checks.push(['requested', 'refunding', 'refunded'].includes(order.afterSalesStatus) ? block('AFTER_SALES_BLOCKED', '订单处于售后或退款流程') : pass('AFTER_SALES_CLEAR', '订单无进行中的售后阻断'));
    checks.push(['delivered', 'cancelled'].includes(order.deliveryStatus) ? block('DELIVERY_STATE_INVALID', `订单当前交付状态为 ${order.deliveryStatus}，不可重复交付`) : pass('DELIVERY_STATE_READY', '订单处于可交付状态'));
    const couponBatchIds = [...new Set((input.couponBatchIds ?? await this.resolveCouponBatchIds(input.adminId, order)).map((value) => String(value).trim()).filter(Boolean))];
    if (['coupon_only', 'mixed'].includes(deliveryType)) {
      if (!order.productId && couponBatchIds.length === 0) checks.push(block('PRODUCT_LINK_MISSING', '订单未关联本地商品，无法解析卡券批次'));
      if (couponBatchIds.length === 0) checks.push(block('COUPON_CONFIG_MISSING', '未配置交付卡券批次'));
      for (const batchId of couponBatchIds) {
        const batch = await this.deps.store.getCouponBatch(input.adminId, batchId);
        if (!batch || batch.accountId !== input.accountId) checks.push(block('COUPON_BATCH_SCOPE_MISMATCH', `卡券批次 ${batchId} 不属于当前账号`));
        else if (batch.status !== 'active') checks.push(block('COUPON_BATCH_NOT_ACTIVE', `卡券批次 ${batchId} 当前未启用`));
      }
    }
    if (deliveryType === 'manual' && !input.trackingRef?.trim()) checks.push(block('TRACKING_REF_REQUIRED', '人工发货需要提供物流单号或交付引用'));
    const records = await this.deps.store.listDeliveryRecords(input.adminId, { accountId: input.accountId, orderNo: order.orderNo });
    return { orderNo: order.orderNo, accountId: order.accountId, deliveryType, state: checks.every((check) => check.status === 'pass') ? 'ready' : 'blocked', checks, couponBatchIds, latestRecord: records[0] };
  }

  async deliver(input: { adminId: string; accountId: string; orderNo: string; deliveryType?: OrderDeliveryType; couponBatchIds?: string[]; trackingRef?: string; tradeText?: string; idempotencyKey: string; requestId: string; traceId: string }): Promise<DeliveryResult> {
    const existing = await this.deps.store.getDeliveryRecordByIdempotency(input.adminId, { accountId: input.accountId, idempotencyKey: input.idempotencyKey });
    if (existing) {
      if (existing.orderNo !== input.orderNo || (input.deliveryType && existing.deliveryType !== input.deliveryType)) {
        throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'delivery idempotency key was already used for a different request');
      }
      return { record: existing, order: await this.deps.orders.get({ adminId: input.adminId, orderNo: existing.orderNo, accountId: input.accountId }), idempotent: true };
    }
    const preview = await this.preview(input);
    if (preview.state !== 'ready') throw new ServiceError(422, 'DELIVERY_NOT_READY', 'order delivery preview is blocked', { preview });
    const order = await this.deps.orders.get({ adminId: input.adminId, orderNo: input.orderNo, accountId: input.accountId });
    const records = await this.deps.store.listDeliveryRecords(input.adminId, { accountId: input.accountId, orderNo: input.orderNo });
    const attempt = Math.max(0, ...records.map((record) => record.attempt)) + 1;
    const scope = `order-delivery:${input.adminId}:${input.accountId}`;
    const record = await this.deps.store.createDeliveryRecord({ adminId: input.adminId, orderId: order.id, orderNo: order.orderNo, accountId: order.accountId, deliveryType: preview.deliveryType, idempotencyScope: scope, idempotencyKey: input.idempotencyKey, attempt, trackingRef: input.trackingRef });
    await this.deps.store.updateDeliveryRecord({ adminId: input.adminId, id: record.id, status: 'running' });
    await this.deps.store.updateOrderDelivery({ adminId: input.adminId, accountId: order.accountId, orderNo: order.orderNo, deliveryStatus: 'reserving', deliveryType: preview.deliveryType });
    const outbox = await this.deps.store.enqueueAutoReplyOutbox({ scope, aggregateType: 'order', aggregateId: order.id, operation: 'order_delivery', idempotencyKey: input.idempotencyKey, payload: { orderNo: order.orderNo, deliveryType: preview.deliveryType, couponBatchIds: preview.couponBatchIds, trackingRef: input.trackingRef ? '[REDACTED]' : undefined }, traceId: input.traceId });
    const workerId = `order-delivery:${record.id}`;
    const claimed = await this.deps.store.claimAutoReplyOutbox({ scope, workerId, limit: 1, leaseMs: 120_000, id: outbox.record.id });
    if (!claimed[0]) throw new ServiceError(409, 'DELIVERY_OUTBOX_CONFLICT', 'delivery outbox is already claimed');
    try {
      const external = await this.executeExternal({ ...input, order, deliveryType: preview.deliveryType, couponBatchIds: preview.couponBatchIds });
      if (external.status === 'succeeded') {
      const updatedRecord = await this.deps.store.updateDeliveryRecord({ adminId: input.adminId, id: record.id, status: 'succeeded', externalOutcome: 'known_success', externalRef: external.externalRef, couponItemId: external.couponItemId, trackingRef: input.trackingRef, deliveredAt: new Date().toISOString() });
        const updatedOrder = await this.deps.store.markOrderDelivered({ adminId: input.adminId, accountId: order.accountId, orderNo: order.orderNo });
        await this.deps.store.completeAutoReplyOutbox({ id: outbox.record.id, workerId, externalOutcome: 'known_success', externalMessageRef: external.externalRef });
        await this.audit(input, 'order.delivery.succeeded', { orderNo: order.orderNo, deliveryType: preview.deliveryType, recordId: record.id, externalRef: external.externalRef });
        if (!updatedRecord) throw new ServiceError(500, 'DELIVERY_RECORD_READBACK_FAILED', 'delivery record readback failed');
        return { record: updatedRecord, order: updatedOrder, idempotent: false };
      }
      const status = external.status === 'unknown' ? 'unknown' : 'failed';
      const updatedRecord = await this.deps.store.updateDeliveryRecord({ adminId: input.adminId, id: record.id, status, externalOutcome: external.status === 'unknown' ? 'unknown' : 'known_failure', externalRef: external.externalRef, couponItemId: external.couponItemId, failureCode: external.errorCode, failureMessage: external.message });
      await this.deps.store.updateOrderDelivery({ adminId: input.adminId, accountId: order.accountId, orderNo: order.orderNo, deliveryStatus: 'failed', deliveryFailReason: external.errorCode ?? external.message ?? 'DELIVERY_FAILED' });
      await this.deps.store.completeAutoReplyOutbox({ id: outbox.record.id, workerId, externalOutcome: external.status === 'unknown' ? 'unknown' : 'known_failure', externalMessageRef: external.externalRef });
      await this.audit(input, external.status === 'unknown' ? 'order.delivery.unknown' : 'order.delivery.failed', { orderNo: order.orderNo, deliveryType: preview.deliveryType, recordId: record.id, errorCode: external.errorCode });
      if (!updatedRecord) throw new ServiceError(500, 'DELIVERY_RECORD_READBACK_FAILED', 'delivery record readback failed');
      return { record: updatedRecord, order: await this.deps.orders.get({ adminId: input.adminId, orderNo: order.orderNo, accountId: order.accountId }), idempotent: false };
    } catch (error) {
      const code = error instanceof ServiceError ? error.code : 'DELIVERY_EXECUTION_FAILED';
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.store.updateDeliveryRecord({ adminId: input.adminId, id: record.id, status: 'failed', externalOutcome: 'known_failure', failureCode: code, failureMessage: message });
      await this.deps.store.updateOrderDelivery({ adminId: input.adminId, accountId: order.accountId, orderNo: order.orderNo, deliveryStatus: 'failed', deliveryFailReason: code });
      await this.deps.store.retryAutoReplyOutbox({ id: outbox.record.id, workerId, errorCode: code, errorDigest: message.slice(0, 240), availableAt: new Date().toISOString() });
      throw error;
    }
  }

  async retry(input: { adminId: string; accountId: string; orderNo: string; requestId: string; traceId: string; idempotencyKey: string }): Promise<DeliveryResult> {
    const records = await this.deps.store.listDeliveryRecords(input.adminId, { accountId: input.accountId, orderNo: input.orderNo });
    const latest = records[0];
    if (!latest || !['failed', 'unknown'].includes(latest.status)) throw new ServiceError(409, 'DELIVERY_RETRY_NOT_ALLOWED', '当前订单没有可重试的交付记录');
    if (latest.status === 'unknown') {
      const order = await this.deps.orders.get({ adminId: input.adminId, orderNo: input.orderNo, accountId: input.accountId });
      const snapshot = await this.deps.execution.readOrder({ adminId: input.adminId, accountId: input.accountId, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo });
      if (snapshot?.deliveryStatus === 'delivered') {
        const reconciled = await this.deps.store.updateDeliveryRecord({ adminId: input.adminId, id: latest.id, status: 'succeeded', externalOutcome: 'known_success', deliveredAt: new Date().toISOString() });
        const updatedOrder = await this.deps.store.markOrderDelivered({ adminId: input.adminId, accountId: input.accountId, orderNo: input.orderNo });
        if (!reconciled) throw new ServiceError(500, 'DELIVERY_RECORD_READBACK_FAILED', 'delivery record readback failed');
        return { record: reconciled, order: updatedOrder, idempotent: false };
      }
      if (!snapshot || snapshot.deliveryStatus !== 'pending') throw new ServiceError(409, 'DELIVERY_EXTERNAL_STATE_UNKNOWN', '外部发货结果仍未知，需要人工恢复');
    }
    return this.deliver({ ...input, deliveryType: latest.deliveryType, trackingRef: latest.trackingRef, idempotencyKey: input.idempotencyKey });
  }

  async cancel(input: { adminId: string; accountId: string; orderNo: string; requestId: string; traceId: string }): Promise<DeliveryRecord> {
    const records = await this.deps.store.listDeliveryRecords(input.adminId, { accountId: input.accountId, orderNo: input.orderNo });
    const latest = records[0];
    if (!latest || !['pending', 'running', 'failed'].includes(latest.status)) throw new ServiceError(409, 'DELIVERY_CANCEL_NOT_ALLOWED', '当前交付状态不可取消');
    const cancelled = await this.deps.store.updateDeliveryRecord({ adminId: input.adminId, id: latest.id, status: 'cancelled', externalOutcome: 'known_failure', failureCode: 'CANCELLED_BY_ADMIN', failureMessage: '管理员取消交付' });
    await this.deps.store.updateOrderDelivery({ adminId: input.adminId, accountId: input.accountId, orderNo: input.orderNo, deliveryStatus: 'cancelled' });
    if (!cancelled) throw new ServiceError(404, 'NOT_FOUND', 'delivery record not found');
    await this.audit(input, 'order.delivery.cancelled', { orderNo: input.orderNo, recordId: latest.id });
    return cancelled;
  }

  private async resolveCouponBatchIds(adminId: string, order: OrderRecord): Promise<string[]> {
    if (!order.productId) return [];
    const automation = await this.deps.productAutomation.get(adminId, order.productId);
    return automation.config.paidAutoDelivery.couponBatchIds ?? [];
  }

  private async executeExternal(input: { adminId: string; accountId: string; orderNo: string; trackingRef?: string; tradeText?: string; order: OrderRecord; deliveryType: OrderDeliveryType; couponBatchIds: string[] }): Promise<AutomationExternalResult> {
    let externalRef: string | undefined;
    let reservationId: string | undefined;
    let couponItemId: string | undefined;
    if (['coupon_only', 'mixed'].includes(input.deliveryType)) {
      const reservation = await this.deps.execution.reserveCoupon({ adminId: input.adminId, accountId: input.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, skuSpec: input.order.skuSpec, batchIds: input.couponBatchIds, quantity: 1, executionKey: `manual-delivery:${input.accountId}:${input.orderNo}`, purpose: 'delivery' });
      reservationId = reservation.reservationId;
      const reservationRecord = await this.deps.store.getCouponReservation({ adminId: input.adminId, reservationId, executionKey: `manual-delivery:${input.accountId}:${input.orderNo}` });
      couponItemId = reservationRecord?.items[0]?.itemId;
      if (reservation.quantity < 1) return { status: 'failed', errorCode: 'COUPON_UNAVAILABLE', message: '没有可用卡券' };
      const sent = await this.deps.execution.sendCoupon({ adminId: input.adminId, accountId: input.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.orderNo, reservationId, executionKey: `manual-delivery:${input.accountId}:${input.orderNo}`, purpose: 'delivery' });
      if (sent.status !== 'succeeded') return { ...sent, couponItemId };
      externalRef = sent.externalRef;
      await this.deps.execution.commitCoupon({ adminId: input.adminId, reservationId, executionKey: `manual-delivery:${input.accountId}:${input.orderNo}` });
      if (input.deliveryType === 'coupon_only') return { status: 'succeeded', externalRef, couponItemId };
    }
    const shipped = await this.deps.execution.confirmShipment({ adminId: input.adminId, accountId: input.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.orderNo, executionKey: `manual-delivery:${input.accountId}:${input.orderNo}`, noLogisticsForm: input.deliveryType === 'no_logistics', tradeText: input.tradeText ?? input.trackingRef });
    return { ...shipped, externalRef: shipped.externalRef ?? externalRef, couponItemId };
  }

  private async audit(input: { adminId: string; requestId: string; traceId: string; accountId: string; orderNo: string }, action: string, payload: Record<string, unknown>): Promise<void> {
    await this.deps.audit({ actorId: input.adminId, action, targetRef: input.orderNo, requestId: input.requestId, traceId: input.traceId, accountId: input.accountId, payload });
  }
}

function pass(code: string, message: string): { code: string; status: 'pass'; message: string } { return { code, status: 'pass', message }; }
function block(code: string, message: string): { code: string; status: 'blocked'; message: string } { return { code, status: 'blocked', message }; }
