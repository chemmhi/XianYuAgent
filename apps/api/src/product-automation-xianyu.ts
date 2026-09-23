import type {
  AutomationExecutionPort,
  AutomationExternalResult,
  AutomationOrderSnapshot,
} from './product-automation.js';
import type { ProductAutomationExecutionAdapter } from './product-automation-trigger.js';
import type { CouponReservationRecord, Store } from './domain.js';
import { XianyuMtopClient, type XianyuExternalMutationResult, type XianyuOrderDetailSummary } from './xianyu-mtop.js';
import type { XianyuImService } from './xianyu-im-service.js';

/**
 * Live product-automation adapter.
 *
 * The adapter is deliberately thin: local reservation state and order facts
 * stay authoritative in Store, while Xianyu MTOP/IM remain the only external
 * mutation surfaces. The trigger-level live gate must pass before any method
 * in this adapter is reached.
 */
export class XianyuProductAutomationExecutionAdapter implements ProductAutomationExecutionAdapter {
  readonly readiness = 'ready' as const;
  readonly readinessCode = 'XIANYU_EXTERNAL_EXECUTION_READY';

  constructor(
    private readonly store: Store,
    private readonly getMtop: () => XianyuMtopClient,
    private readonly getIm: () => XianyuImService | undefined,
    private readonly audit?: (input: { adminId: string; action: string; accountId?: string; orderNo?: string; executionKey?: string; payload?: unknown }) => Promise<unknown> | unknown,
  ) {}

  async reserveCoupon(input: Parameters<AutomationExecutionPort['reserveCoupon']>[0]): Promise<{ reservationId: string; quantity: number }> {
    const adminId = requireAdminId(input.adminId);
    const reservation = await this.store.reserveCoupon({
      adminId,
      accountId: input.accountId,
      batchIds: input.batchIds,
      quantity: input.quantity,
      executionKey: input.executionKey,
      purpose: input.purpose,
    });
    await this.recordAudit({ adminId, action: 'product.automation.coupon.reserved', accountId: input.accountId, executionKey: input.executionKey, payload: { reservationId: reservation.reservationId, quantity: reservation.quantity, purpose: input.purpose } });
    return { reservationId: reservation.reservationId, quantity: reservation.quantity };
  }

  async sendCoupon(input: Parameters<AutomationExecutionPort['sendCoupon']>[0]): Promise<AutomationExternalResult> {
    const adminId = requireAdminId(input.adminId);
    const reservation = await this.store.getCouponReservation({ adminId, reservationId: input.reservationId, executionKey: input.executionKey });
    if (!reservation) return failedExternal('COUPON_RESERVATION_NOT_FOUND', 'coupon reservation not found');
    if (reservation.status === 'committed') return { status: 'succeeded', externalRef: `coupon-reservation:${reservation.reservationId}` };
    if (reservation.status !== 'reserved') return failedExternal('COUPON_RESERVATION_NOT_ACTIVE', 'coupon reservation is not active');

    const order = await this.loadScopedOrder(adminId, input.accountId, input.orderNo, input.productId, input.itemId);
    if (!order) return failedExternal('ORDER_NOT_FOUND', 'order or product scope not found');
    if (!order.conversationId) return failedExternal('CONVERSATION_MISSING', 'order conversation is missing');
    const im = this.getIm();
    if (!im) return unknownExternal('XIANYU_IM_NOT_READY', 'xianyu im service is not ready');

    const text = formatCouponMessage(reservation);
    if (!text) return failedExternal('COUPON_CONTENT_EMPTY', 'coupon reservation has no deliverable content');
    try {
      const sent = await im.sendText(adminId, input.accountId, order.conversationId, text, `automation:${input.executionKey}`, `automation:${input.executionKey}`) as { externalMessageRef?: string };
      await this.recordAudit({ adminId, action: 'product.automation.coupon.sent', accountId: input.accountId, orderNo: input.orderNo, executionKey: input.executionKey, payload: { reservationId: reservation.reservationId, externalMessageRef: sent.externalMessageRef } });
      return { status: 'succeeded', externalRef: sent.externalMessageRef ?? `coupon-reservation:${reservation.reservationId}` };
    } catch (error) {
      return classifyExternalError(error, 'coupon_send');
    }
  }

  async commitCoupon(input: Parameters<AutomationExecutionPort['commitCoupon']>[0]): Promise<void> {
    const adminId = requireAdminId(input.adminId);
    const committed = await this.store.commitCouponReservation({ adminId, reservationId: input.reservationId, executionKey: input.executionKey });
    await this.recordAudit({ adminId, action: 'product.automation.coupon.committed', accountId: committed.accountId, executionKey: input.executionKey, payload: { reservationId: committed.reservationId, quantity: committed.quantity } });
  }

  async releaseCoupon(input: Parameters<AutomationExecutionPort['releaseCoupon']>[0]): Promise<void> {
    const adminId = requireAdminId(input.adminId);
    const released = await this.store.releaseCouponReservation({ adminId, reservationId: input.reservationId, executionKey: input.executionKey, reason: input.reason });
    await this.recordAudit({ adminId, action: 'product.automation.coupon.released', accountId: released.accountId, executionKey: input.executionKey, payload: { reservationId: released.reservationId, reason: input.reason, status: released.status } });
  }

  async confirmShipment(input: Parameters<AutomationExecutionPort['confirmShipment']>[0]): Promise<AutomationExternalResult> {
    const adminId = requireAdminId(input.adminId);
    if (!await this.loadScopedOrder(adminId, input.accountId, input.orderNo, input.productId, input.itemId)) return failedExternal('ORDER_SCOPE_MISMATCH', 'order or product scope does not match');
    const detail = await this.getMtop().readOrderDetail(adminId, input.accountId, input.orderNo);
    if (!detail.success || !detail.detail) {
      return unknownExternal(detail.errorCode ?? 'ORDER_DETAIL_UNAVAILABLE', detail.message ?? 'authoritative order detail is unavailable');
    }
    const deliveryStatus = normalizeDeliveryStatus(detail.detail.deliveryStatus);
    if (!deliveryStatus) return unknownExternal('ORDER_DELIVERY_STATUS_UNKNOWN', 'order delivery status is not authoritative');
    if (isDelivered(detail.detail)) {
      return { status: 'succeeded', externalRef: input.orderNo };
    }
    const result = await this.getMtop().confirmShipment(adminId, input.accountId, input.orderNo);
    return mapMutationResult(result);
  }

  async repriceOrder(input: Parameters<AutomationExecutionPort['repriceOrder']>[0]): Promise<AutomationExternalResult> {
    const adminId = requireAdminId(input.adminId);
    if (!await this.loadScopedOrder(adminId, input.accountId, input.orderNo, input.productId, input.itemId)) return failedExternal('ORDER_SCOPE_MISMATCH', 'order or product scope does not match');
    const detail = await this.getMtop().readOrderDetail(adminId, input.accountId, input.orderNo);
    if (!detail.success || !detail.detail) {
      return unknownExternal(detail.errorCode ?? 'ORDER_DETAIL_UNAVAILABLE', detail.message ?? 'authoritative order detail is unavailable');
    }
    const paymentStatus = normalizePaymentStatus(detail.detail.paymentStatus);
    if (paymentStatus === 'paid') return failedExternal('ORDER_ALREADY_PAID', 'order is no longer unpaid');
    if (paymentStatus !== 'unpaid') return unknownExternal('ORDER_PAYMENT_STATUS_UNKNOWN', 'order payment status is not authoritative');
    const result = await this.getMtop().repriceOrder(adminId, input.accountId, input.orderNo, input.targetPriceMinor);
    return mapMutationResult(result);
  }

  async sendText(input: Parameters<AutomationExecutionPort['sendText']>[0]): Promise<AutomationExternalResult> {
    const adminId = requireAdminId(input.adminId);
    const im = this.getIm();
    if (!im) return unknownExternal('XIANYU_IM_NOT_READY', 'xianyu im service is not ready');
    try {
      const sent = await im.sendText(adminId, input.accountId, input.conversationId, input.text, `automation:${input.executionKey}`, `automation:${input.executionKey}`) as { externalMessageRef?: string };
      return { status: 'succeeded', externalRef: sent.externalMessageRef };
    } catch (error) {
      return classifyExternalError(error, 'text_send');
    }
  }

  async persistReviewFact(input: Parameters<AutomationExecutionPort['persistReviewFact']>[0]): Promise<{ created: boolean }> {
    const adminId = requireAdminId(input.adminId);
    const created = await this.store.recordReviewFact({ accountId: input.accountId, orderNo: input.orderNo, eventId: input.eventId });
    await this.recordAudit({ adminId, action: 'product.automation.review.fact_persisted', accountId: input.accountId, orderNo: input.orderNo, executionKey: input.executionKey, payload: { created: created.created } });
    return created;
  }

  async readOrder(input: Parameters<AutomationExecutionPort['readOrder']>[0]): Promise<AutomationOrderSnapshot | undefined> {
    const adminId = requireAdminId(input.adminId);
    const local = await this.store.getOrder(adminId, input.orderNo, input.accountId);
    if (!local) return undefined;
    const detail = await this.getMtop().readOrderDetail(adminId, input.accountId, input.orderNo);
    if (!detail.success || !detail.detail) return undefined;
    if (!normalizePaymentStatus(detail.detail.paymentStatus) || !normalizeDeliveryStatus(detail.detail.deliveryStatus)) return undefined;
    return mergeOrderSnapshot(local, detail.detail);
  }

  async markManualReview(input: Parameters<AutomationExecutionPort['markManualReview']>[0]): Promise<void> {
    const adminId = requireAdminId(input.adminId);
    await this.recordAudit({ adminId, action: 'product.automation.manual_review', accountId: input.accountId, orderNo: input.orderNo, executionKey: input.executionKey, payload: { reason: input.reason, productId: input.productId, itemId: input.itemId } });
  }

  private async loadScopedOrder(adminId: string, accountId: string, orderNo: string, productId?: string, itemId?: string): Promise<AutomationOrderSnapshot | undefined> {
    const order = await this.store.getOrder(adminId, orderNo, accountId);
    if (!order || order.accountId !== accountId) return undefined;
    if (productId && order.productId !== productId) return undefined;
    if (itemId && order.itemId !== itemId) return undefined;
    if (!order.productId) return undefined;
    const product = await this.store.getProduct(adminId, order.productId);
    if (!product || product.accountId !== accountId) return undefined;
    if (product.externalProductRef && product.externalProductRef !== order.itemId) return undefined;
    return order;
  }

  private async recordAudit(input: { adminId: string; action: string; accountId?: string; orderNo?: string; executionKey?: string; payload?: unknown }): Promise<void> {
    try { await this.audit?.(input); } catch { /* audit failure must not duplicate an external mutation */ }
  }
}

function mergeOrderSnapshot(local: AutomationOrderSnapshot, detail: XianyuOrderDetailSummary): AutomationOrderSnapshot {
  return {
    ...local,
    quantity: detail.quantity ?? local.quantity,
    skuSpec: detail.skuSpec ?? local.skuSpec,
    amountMinor: detail.amountMinor ?? local.amountMinor,
    itemId: detail.itemId ?? local.itemId,
    itemTitle: detail.itemTitle ?? local.itemTitle,
    conversationId: detail.conversationId ?? local.conversationId,
    buyerId: detail.buyerId ?? local.buyerId,
    paymentStatus: normalizePaymentStatus(detail.paymentStatus) ?? local.paymentStatus,
    deliveryStatus: normalizeDeliveryStatus(detail.deliveryStatus) ?? local.deliveryStatus,
    reviewedAt: detail.reviewedAt ?? local.reviewedAt,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePaymentStatus(value?: string): AutomationOrderSnapshot['paymentStatus'] | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['paid', 'success', 'pay_success', 'trade_success', '已付款', '交易成功'].includes(normalized)) return 'paid';
  if (['unpaid', 'wait_buyer_pay', 'wait_pay', 'pending', '待付款', '未付款'].includes(normalized)) return 'unpaid';
  return undefined;
}

function normalizeDeliveryStatus(value?: string): AutomationOrderSnapshot['deliveryStatus'] | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['delivered', 'consigned', 'shipped', '已发货', '交易成功'].includes(normalized)) return 'delivered';
  if (['pending', 'wait_consign', 'not_delivered', '待发货', '未发货'].includes(normalized)) return 'pending';
  return undefined;
}

function isDelivered(detail: XianyuOrderDetailSummary): boolean {
  return normalizeDeliveryStatus(detail.deliveryStatus) === 'delivered';
}

function formatCouponMessage(reservation: CouponReservationRecord): string {
  const lines: string[] = [];
  for (const [index, item] of reservation.items.entries()) {
    const content = item.content.trim();
    if (content) lines.push(reservation.items.length > 1 ? `${index + 1}. ${content}` : content);
    if (item.quarkUrl) lines.push(`链接：${item.quarkUrl}`);
    if (item.extractionCode) lines.push(`提取码：${item.extractionCode}`);
  }
  return lines.join('\n').trim();
}

function mapMutationResult(result: XianyuExternalMutationResult): AutomationExternalResult {
  return { status: result.status, externalRef: result.externalRef, errorCode: result.errorCode, message: result.message };
}

function classifyExternalError(error: unknown, prefix: string): AutomationExternalResult {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
  const knownFailure = /INVALID|MISSING|NOT_FOUND|FORBIDDEN|SCOPE|SESSION_EXPIRED|ACCOUNT|AUTH|PERMISSION|REJECTED_4\d\d|REMOTE_4\d\d|COUPON_CONTENT_EMPTY/u.test(code);
  return { status: knownFailure ? 'failed' : 'unknown', errorCode: code || `${prefix.toUpperCase()}_UNKNOWN`, message };
}

function failedExternal(errorCode: string, message: string): AutomationExternalResult {
  return { status: 'failed', errorCode, message };
}

function unknownExternal(errorCode: string, message: string): AutomationExternalResult {
  return { status: 'unknown', errorCode, message };
}

function requireAdminId(value: string | undefined): string {
  const adminId = value?.trim();
  if (!adminId) throw new Error('ADMIN_ID_REQUIRED');
  return adminId;
}

function errorCode(error: unknown): string {
  const candidate = (error as { code?: unknown } | undefined)?.code;
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().toUpperCase();
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return `REMOTE_${candidate}`;
  return error instanceof Error ? error.message.replace(/\s+/gu, '_').slice(0, 80).toUpperCase() : 'EXTERNAL_EXECUTION_FAILED';
}
