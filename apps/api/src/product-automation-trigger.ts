import type { OrderRecord, Store } from './domain.js';
import type { XianyuImMessageEvent } from './xianyu-im.js';
import { parseXianyuSystemMessageKind } from './xianyu-system-message.js';
import {
  AutomationExecutionPort,
  AutomationExecutionResult,
  AutomationOrderSnapshot,
  AutomationWorkflowService,
  ProductAutomationService,
} from './product-automation.js';
import {
  DEFAULT_PRODUCT_AUTOMATION_LIVE_CONFIG,
  productAutomationLiveBlockReason,
  productAutomationReviewExternalWriteBlockReason,
  type ProductAutomationLiveConfig,
} from './product-automation-live-gate.js';

export type ProductAutomationTriggerKind = 'payment_paid' | 'unpaid_reprice' | 'review_gift' | 'review_reminder';
export type ProductAutomationTriggerStatus = AutomationExecutionResult['status'] | 'blocked';

export interface ProductAutomationTriggerResult {
  trigger: ProductAutomationTriggerKind;
  orderNo?: string;
  status: ProductAutomationTriggerStatus;
  executionKey?: string;
  reason?: string;
}

export interface ProductAutomationTriggerBatchResult {
  processed: number;
  results: ProductAutomationTriggerResult[];
}

export interface ProductAutomationReviewSignal {
  kind: 'review_created';
  orderNo: string;
  eventId: string;
  accountId?: string;
  productId?: string;
}

export interface ProductAutomationImEventResult {
  accepted: boolean;
  reason?: string;
  result?: ProductAutomationTriggerResult;
}

export interface ProductAutomationExecutionAdapter extends AutomationExecutionPort {
  readonly readiness: 'ready' | 'blocked';
  readonly readinessCode?: string;
}

export class AutomationExecutionBlockedError extends Error {
  readonly code = 'AUTOMATION_EXECUTION_NOT_CONFIGURED';

  constructor(message = 'product automation external execution adapter is not configured') {
    super(message);
    this.name = 'AutomationExecutionBlockedError';
  }
}

/**
 * Explicit production-safe default until coupon delivery, shipment-confirm,
 * repricing and message-send MTOP mutations are wired and independently tested.
 * It never invents an external success result.
 */
export class NotConfiguredAutomationExecutionAdapter implements ProductAutomationExecutionAdapter {
  readonly readiness = 'blocked' as const;
  readonly readinessCode = 'AUTOMATION_EXECUTION_NOT_CONFIGURED';

  async reserveCoupon(): Promise<never> { throw new AutomationExecutionBlockedError(); }
  async sendCoupon(): Promise<never> { throw new AutomationExecutionBlockedError(); }
  async commitCoupon(): Promise<never> { throw new AutomationExecutionBlockedError(); }
  async releaseCoupon(): Promise<never> { throw new AutomationExecutionBlockedError(); }
  async confirmShipment(): Promise<{ status: 'failed'; errorCode: string; message: string }> { return blockedExternalResult(); }
  async repriceOrder(): Promise<{ status: 'failed'; errorCode: string; message: string }> { return blockedExternalResult(); }
  async sendText(): Promise<{ status: 'failed'; errorCode: string; message: string }> { return blockedExternalResult(); }
  async persistReviewFact(): Promise<never> { throw new AutomationExecutionBlockedError(); }
  async readOrder(): Promise<never> { throw new AutomationExecutionBlockedError(); }
  async markManualReview(): Promise<never> { throw new AutomationExecutionBlockedError(); }
}

export class ProductAutomationTrigger {
  constructor(
    private readonly store: Store,
    private readonly configs: ProductAutomationService,
    private readonly workflow: AutomationWorkflowService,
    private readonly execution: ProductAutomationExecutionAdapter,
    private readonly audit?: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>,
    /** The safe default is blocked; production assembly injects env config. */
    private readonly liveConfig: ProductAutomationLiveConfig = DEFAULT_PRODUCT_AUTOMATION_LIVE_CONFIG,
  ) {}

  async onOrderRefresh(input: { adminId: string; accountId: string; items: OrderRecord[]; requestId: string; traceId: string }): Promise<ProductAutomationTriggerBatchResult> {
    const results: ProductAutomationTriggerResult[] = [];
    for (const order of input.items) {
      if (order.accountId !== input.accountId) {
        results.push({ trigger: 'payment_paid', orderNo: order.orderNo, status: 'blocked', reason: 'ACCOUNT_SCOPE_MISMATCH' });
        continue;
      }
      if (!order.productId) {
        results.push({ trigger: order.paymentStatus === 'unpaid' ? 'unpaid_reprice' : 'payment_paid', orderNo: order.orderNo, status: 'skipped', reason: 'PRODUCT_LINK_MISSING' });
        continue;
      }
      if (order.paymentStatus === 'paid') {
        results.push(await this.runForOrder('payment_paid', input.adminId, order, input.requestId, input.traceId));
      } else if (order.paymentStatus === 'unpaid') {
        results.push(await this.runForOrder('unpaid_reprice', input.adminId, order, input.requestId, input.traceId));
      }
    }
    return { processed: results.length, results };
  }

  async onReviewEvent(input: { adminId: string; accountId: string; orderNo: string; eventId: string; requestId?: string; traceId?: string }): Promise<ProductAutomationTriggerResult> {
    const order = await this.store.getOrder(input.adminId, input.orderNo, input.accountId);
    if (!order) return { trigger: 'review_gift', orderNo: input.orderNo, status: 'skipped', reason: 'ORDER_NOT_FOUND' };
    return this.runForOrder('review_gift', input.adminId, order, input.requestId ?? `xianyu:review:${input.eventId}`, input.traceId ?? `xianyu:review:${input.eventId}`, input.eventId);
  }

  async onReviewReminder(input: { adminId: string; order: AutomationOrderSnapshot; now: string; requestId?: string; traceId?: string }): Promise<ProductAutomationTriggerResult> {
    return this.runForOrder('review_reminder', input.adminId, input.order, input.requestId ?? `automation:reminder:${input.order.orderNo}`, input.traceId ?? `automation:reminder:${input.order.orderNo}`, undefined, input.now);
  }

  /**
   * IM remains a transport, not an order/review schema. Only an explicit
   * adapter envelope is accepted; arbitrary chat text is never interpreted as
   * a review or payment event.
   */
  async onImEvent(adminId: string, event: XianyuImMessageEvent): Promise<ProductAutomationImEventResult> {
    const explicitSignal = extractReviewSignal(event.raw);
    const signal = explicitSignal ?? await this.deriveReviewSignal(adminId, event);
    if (!signal) return { accepted: false, reason: 'AUTOMATION_SIGNAL_NOT_PRESENT' };
    if (event.direction !== 'inbound' || event.bodyType !== 'system') return { accepted: false, reason: 'AUTOMATION_SIGNAL_SOURCE_INVALID' };
    if (signal.accountId && signal.accountId !== event.accountId) return { accepted: false, reason: 'AUTOMATION_SIGNAL_ACCOUNT_MISMATCH' };
    const order = await this.store.getOrder(adminId, signal.orderNo, event.accountId);
    if (order) {
      if (order.buyerId !== event.senderRef) return { accepted: false, reason: 'AUTOMATION_SIGNAL_BUYER_MISMATCH' };
      if (order.conversationId) {
        const conversation = await this.store.getConversation(adminId, order.conversationId);
        if (!conversation || conversation.accountId !== event.accountId || conversation.externalConversationRef !== event.externalConversationRef) {
          return { accepted: false, reason: 'AUTOMATION_SIGNAL_CONVERSATION_MISMATCH' };
        }
      } else {
        const conversation = await this.store.findConversationByExternalRef(adminId, event.accountId, event.externalConversationRef);
        if (!conversation || conversation.buyerRef !== event.senderRef) return { accepted: false, reason: 'AUTOMATION_SIGNAL_CONVERSATION_MISMATCH' };
      }
      if (signal.productId && signal.productId !== order.productId && signal.productId !== order.itemId) return { accepted: false, reason: 'AUTOMATION_SIGNAL_PRODUCT_MISMATCH' };
    }
    const result = await this.onReviewEvent({ adminId, accountId: event.accountId, orderNo: signal.orderNo, eventId: signal.eventId, requestId: `xianyu:review:${signal.eventId}`, traceId: `xianyu:review:${signal.eventId}` });
    return { accepted: true, result };
  }

  private async deriveReviewSignal(adminId: string, event: XianyuImMessageEvent): Promise<ProductAutomationReviewSignal | undefined> {
    if (event.direction !== 'inbound' || event.bodyType !== 'system' || event.platformSystemMessage !== true) return undefined;
    if (parseXianyuSystemMessageKind(event.bodyText) !== 'reviewed') return undefined;
    const conversation = await this.store.findConversationByExternalRef(adminId, event.accountId, event.externalConversationRef);
    const candidates = await this.store.listAutoReplyOrders(adminId, {
      accountId: event.accountId,
      buyerId: event.senderRef,
      conversationId: conversation?.id,
      limit: 50,
    });
    const matches = candidates.items.filter((candidate) => {
      if (event.itemRef && candidate.itemId !== event.itemRef) return false;
      return candidate.orderStatus === 'completed' || candidate.deliveryStatus === 'delivered';
    });
    if (matches.length !== 1) return undefined;
    return {
      kind: 'review_created',
      orderNo: matches[0]!.orderNo,
      eventId: event.sourceEventId ?? event.externalMessageRef,
      accountId: event.accountId,
      productId: matches[0]!.itemId,
    };
  }

  private async runForOrder(trigger: ProductAutomationTriggerKind, adminId: string, order: AutomationOrderSnapshot, requestId: string, traceId: string, eventId?: string, now?: string): Promise<ProductAutomationTriggerResult> {
    if (!order.productId) return { trigger, orderNo: order.orderNo, status: 'skipped', reason: 'PRODUCT_LINK_MISSING' };
    try {
      const automation = await this.configs.get(adminId, order.productId);
      const config = automation.config;
      if (this.execution.readiness !== 'ready' && ruleEnabled(config, trigger)) {
        return this.finish(trigger, order.orderNo, { trigger, orderNo: order.orderNo, status: 'blocked', reason: this.execution.readinessCode ?? 'AUTOMATION_EXECUTION_NOT_CONFIGURED' }, adminId, order.accountId, requestId, traceId);
      }
      if (ruleEnabled(config, trigger)) {
        // Xianyu's buyer_name may be the real-name field from the order detail
        // (for example, "陈晨"). The buyer nickname is the stable identity
        // shown in IM and the value used by AUTOMATION_BUYER_ALLOWLIST.
        const liveBuyerIdentity = order.buyerNickname?.trim() || order.buyerName;
        const liveBlockReason = productAutomationLiveBlockReason(this.liveConfig, liveBuyerIdentity);
        if (liveBlockReason) {
          return this.finish(trigger, order.orderNo, { trigger, orderNo: order.orderNo, status: 'blocked', reason: liveBlockReason }, adminId, order.accountId, requestId, traceId);
        }
        if (isReviewTrigger(trigger)) {
          const reviewBlockReason = productAutomationReviewExternalWriteBlockReason(this.liveConfig);
          if (reviewBlockReason) {
            return this.finish(trigger, order.orderNo, { trigger, orderNo: order.orderNo, status: 'blocked', reason: reviewBlockReason }, adminId, order.accountId, requestId, traceId);
          }
        }
      }
      let effectiveOrder = order;
      if ((trigger === 'payment_paid' || trigger === 'review_gift') && order.source === 'xianyu' && ruleEnabled(config, trigger)) {
        try {
          const authoritative = await this.execution.readOrder({
            adminId,
            accountId: order.accountId,
            productId: order.productId,
            itemId: order.itemId,
            itemTitle: order.itemTitle,
            orderNo: order.orderNo,
          });
          if (authoritative) effectiveOrder = { ...order, ...authoritative };
        } catch {
          // Keep the synced snapshot when the live detail is temporarily unavailable.
        }
      }
      const result = trigger === 'payment_paid'
        ? await this.workflow.handlePaymentPaid({ adminId, config, order: effectiveOrder, eventId: eventId ?? `order-refresh:${order.orderNo}:${order.updatedAt}` })
        : trigger === 'unpaid_reprice'
          ? await this.workflow.handleUnpaidReprice({ adminId, config, order, eventId: eventId ?? `order-refresh:${order.orderNo}:${order.updatedAt}` })
          : trigger === 'review_gift'
            ? await this.workflow.handleReviewGift({ adminId, config, order: effectiveOrder, eventId: eventId ?? `review:${order.orderNo}:${order.updatedAt}` })
            : await this.workflow.handleReviewReminder({ adminId, config, order, now });
      if (trigger === 'review_reminder' && result.status === 'succeeded') {
        await this.store.recordReviewReminderSent({ accountId: order.accountId, orderNo: order.orderNo, sentAt: now ?? new Date().toISOString() });
      }
      return this.finish(trigger, order.orderNo, { trigger, orderNo: order.orderNo, status: result.status, executionKey: result.executionKey, reason: result.reason }, adminId, order.accountId, requestId, traceId);
    } catch (error) {
      const reason = errorCode(error);
      return this.finish(trigger, order.orderNo, { trigger, orderNo: order.orderNo, status: 'failed', reason }, adminId, order.accountId, requestId, traceId);
    }
  }

  private async finish(trigger: ProductAutomationTriggerKind, orderNo: string, result: ProductAutomationTriggerResult, adminId: string, accountId: string, requestId: string, traceId: string): Promise<ProductAutomationTriggerResult> {
    if (this.audit) {
      try {
        await this.audit({ actorId: adminId, action: `product.automation.trigger.${trigger}`, targetRef: orderNo, requestId, traceId, accountId, payload: { trigger, status: result.status, reason: result.reason } });
      } catch {
        // Audit persistence must not turn an already-determined automation
        // outcome into an unacknowledged retry or duplicate external action.
      }
    }
    return result;
  }
}

export class ProductAutomationWorker {
  constructor(private readonly store: Store, private readonly trigger: ProductAutomationTrigger) {}

  async processOrderRefresh(input: { adminId: string; accountId: string; items: OrderRecord[]; requestId: string; traceId: string }): Promise<ProductAutomationTriggerBatchResult> {
    return this.trigger.onOrderRefresh(input);
  }

  async pollReviewReminders(input: { adminId: string; accountId: string; now: string }): Promise<ProductAutomationTriggerBatchResult> {
    const results: ProductAutomationTriggerResult[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const listed = await this.store.listOrders(input.adminId, { accountId: input.accountId, deliveryStatus: 'delivered', page, pageSize: 100 });
      totalPages = listed.totalPages;
      for (const order of listed.items) results.push(await this.trigger.onReviewReminder({ adminId: input.adminId, order, now: input.now }));
      page += 1;
    }
    return { processed: results.length, results };
  }
}

function ruleEnabled(config: import('./domain.js').ProductAutomationConfig, trigger: ProductAutomationTriggerKind): boolean {
  if (trigger === 'payment_paid') return config.paidAutoDelivery.enabled;
  if (trigger === 'unpaid_reprice') return config.unpaidAutoReprice.enabled;
  if (trigger === 'review_gift') return config.reviewGift.enabled;
  return config.reviewReminder.enabled;
}

function isReviewTrigger(trigger: ProductAutomationTriggerKind): boolean {
  return trigger === 'review_gift' || trigger === 'review_reminder';
}

function blockedExternalResult(): { status: 'failed'; errorCode: string; message: string } {
  return { status: 'failed', errorCode: 'AUTOMATION_EXECUTION_NOT_CONFIGURED', message: 'external automation adapter is not configured' };
}

function extractReviewSignal(raw: Record<string, unknown> | undefined): ProductAutomationReviewSignal | undefined {
  const candidate = raw?.productAutomation;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const value = candidate as Record<string, unknown>;
  if (value.kind !== 'review_created' || typeof value.orderNo !== 'string' || !value.orderNo.trim()) return undefined;
  const eventId = typeof value.eventId === 'string' && value.eventId.trim() ? value.eventId.trim() : undefined;
  if (!eventId) return undefined;
  const accountId = typeof value.accountId === 'string' && value.accountId.trim() ? value.accountId.trim() : undefined;
  const productId = typeof value.productId === 'string' && value.productId.trim() ? value.productId.trim() : undefined;
  return { kind: 'review_created', orderNo: value.orderNo.trim(), eventId, accountId, productId };
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(code)) return code;
  return error instanceof Error ? error.message.slice(0, 80) || 'AUTOMATION_TRIGGER_FAILED' : 'AUTOMATION_TRIGGER_FAILED';
}
