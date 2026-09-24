import type {
  OrderRecord,
  ProductAutomationConfig,
  ProductAutomationConfigRecord,
  ProductAutomationBatchResult,
  ProductRecord,
  Store,
} from './domain.js';
import { createId, digestJson } from './security.js';
import { ServiceError } from './services.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function defaultProductAutomationConfig(): ProductAutomationConfig {
  return {
    paidAutoDelivery: { enabled: false, couponBatchIds: [], autoConfirm: true, maxAttempts: 3, retryBackoffSeconds: 30 },
    unpaidAutoReprice: { enabled: false, mode: 'fixed', targetPriceMinor: 0, maxAttempts: 3, retryBackoffSeconds: 30 },
    reviewGift: { enabled: false, couponBatchIds: [], maxAttempts: 3, retryBackoffSeconds: 30 },
    reviewReminder: { enabled: false, firstDelayHours: 72, repeatIntervalHours: 24, maxReminders: 1, message: '如果使用满意，欢迎给个好评，谢谢支持～' },
  };
}

export class ProductAutomationService {
  constructor(
    private readonly store: Store,
    private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>,
  ) {}

  async get(adminId: string, productId: string): Promise<ProductAutomationConfigRecord & { product: Pick<ProductRecord, 'id' | 'accountId' | 'title'> }> {
    if (!UUID_PATTERN.test(productId)) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
    const product = await this.store.getProduct(adminId, productId);
    if (!product) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
    const current = await this.store.getProductAutomation(adminId, productId);
    if (current) return { ...current, config: await this.publicizeCouponIds(adminId, current.config), product: { id: product.id, accountId: product.accountId, title: product.title } };
    const now = new Date().toISOString();
    const config = defaultProductAutomationConfig();
    return { id: `virtual:${productId}`, productId, accountId: product.accountId, configVersion: 1, config, configDigest: digestJson(config), createdAt: now, updatedAt: now, product: { id: product.id, accountId: product.accountId, title: product.title } };
  }

  async update(input: { adminId: string; productId: string; expectedConfigVersion: unknown; config: unknown; requestId: string; traceId: string }): Promise<ProductAutomationConfigRecord> {
    const product = await this.requireProduct(input.adminId, input.productId);
    const expectedConfigVersion = parseVersion(input.expectedConfigVersion);
    const current = await this.store.getProductAutomation(input.adminId, product.id);
    const { config, syncCouponBindings } = await this.applyConfigPatch(input.adminId, product, current?.config ?? defaultProductAutomationConfig(), input.config);
    try {
      const saved = await this.store.updateProductAutomation({ adminId: input.adminId, productId: product.id, expectedConfigVersion, config, configDigest: digestJson(config), syncCouponBindings });
      if (!saved) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
      await this.audit({ actorId: input.adminId, action: 'product.automation.updated', targetRef: product.id, requestId: input.requestId, traceId: input.traceId, payload: { configVersion: saved.configVersion, rules: enabledRules(config) }, accountId: product.accountId });
      return { ...saved, config: await this.publicizeCouponIds(input.adminId, saved.config) };
    } catch (error) {
      throw mapAutomationStoreError(error);
    }
  }

  async updateBatch(input: { adminId: string; productIds: unknown; expectedConfigVersions: unknown; config: unknown; requestId: string; traceId: string }): Promise<ProductAutomationBatchResult> {
    const productIds = parseProductIds(input.productIds);
    const expectedConfigVersions = parseExpectedVersions(input.expectedConfigVersions, productIds);
    const products = await Promise.all(productIds.map((productId) => this.requireProduct(input.adminId, productId)));
    const accountId = products[0]!.accountId;
    if (products.some((product) => product.accountId !== accountId)) throw new ServiceError(422, 'VALIDATION_FAILED', 'batch automation products must belong to the same account');
    const configByProductId: Record<string, ProductAutomationConfig> = {};
    const configDigests: Record<string, string> = {};
    let syncCouponBindings = false;
    for (const product of products) {
      const current = await this.store.getProductAutomation(input.adminId, product.id);
      const result = await this.applyConfigPatch(input.adminId, product, current?.config ?? defaultProductAutomationConfig(), input.config);
      configByProductId[product.id] = result.config;
      configDigests[product.id] = digestJson(result.config);
      syncCouponBindings = syncCouponBindings || result.syncCouponBindings;
    }
    try {
      const result = await this.store.updateProductAutomationsBatch({ adminId: input.adminId, productIds, expectedConfigVersions, configByProductId, configDigests, syncCouponBindingsByProduct: Object.fromEntries(productIds.map((productId) => [productId, syncCouponBindings])) });
      await this.audit({ actorId: input.adminId, action: 'product.automation.batch_updated', targetRef: `batch:${productIds.length}`, requestId: input.requestId, traceId: input.traceId, payload: { productIds, configVersion: result.items.map((item) => ({ productId: item.productId, version: item.configVersion })), rules: Object.fromEntries(productIds.map((productId) => [productId, enabledRules(configByProductId[productId]!)])) }, accountId });
      return { ...result, items: await Promise.all(result.items.map(async (item) => ({ ...item, config: await this.publicizeCouponIds(input.adminId, item.config) }))) };
    } catch (error) {
      throw mapAutomationStoreError(error);
    }
  }

  private async requireProduct(adminId: string, productId: string): Promise<ProductRecord> {
    if (!UUID_PATTERN.test(productId)) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
    const product = await this.store.getProduct(adminId, productId);
    if (!product) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
    return product;
  }

  /**
   * The public automation contract uses the stable coupon batch sequence id.
   * Storage may still contain legacy UUID references, so normalize only at
   * the service boundary and keep the persistence adapter free to use UUIDs.
   */
  private async publicizeCouponIds(adminId: string, config: ProductAutomationConfig): Promise<ProductAutomationConfig> {
    const next = structuredClone(config);
    for (const key of ['paidAutoDelivery', 'reviewGift'] as const) {
      next[key].couponBatchIds = await Promise.all((next[key].couponBatchIds ?? []).map(async (batchId) => {
        const batch = await this.store.getCouponBatch(adminId, batchId);
        return batch?.sequenceId ?? batchId;
      }));
    }
    return next;
  }

  private async applyConfigPatch(adminId: string, product: ProductRecord, base: ProductAutomationConfig, input: unknown): Promise<{ config: ProductAutomationConfig; syncCouponBindings: boolean }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ServiceError(422, 'VALIDATION_FAILED', 'automation config must be an object');
    const source = input as Record<string, unknown>;
    const next = structuredClone(base);
    let syncCouponBindings = false;
    if (hasRule(source, 'paidAutoDelivery')) {
      const paid = normalizePaidRule(source.paidAutoDelivery, base.paidAutoDelivery);
      if (paid.enabled && paid.couponBatchIds.length === 0) throw new ServiceError(422, 'VALIDATION_FAILED', 'paidAutoDelivery requires at least one coupon batch');
      await this.validateCouponBatches(adminId, product, [{ batchIds: paid.couponBatchIds, requireBuyerDeliverable: paid.enabled }]);
      next.paidAutoDelivery = paid;
      syncCouponBindings = true;
    }
    if (hasRule(source, 'unpaidAutoReprice')) next.unpaidAutoReprice = normalizeRepriceRule(source.unpaidAutoReprice, base.unpaidAutoReprice);
    if (hasRule(source, 'reviewGift')) {
      const gift = normalizeGiftRule(source.reviewGift, base.reviewGift);
      if (gift.enabled && gift.couponBatchIds.length === 0) throw new ServiceError(422, 'VALIDATION_FAILED', 'reviewGift requires at least one coupon batch');
      await this.validateCouponBatches(adminId, product, [{ batchIds: gift.couponBatchIds, requireBuyerDeliverable: gift.enabled }]);
      next.reviewGift = gift;
      syncCouponBindings = true;
    }
    if (hasRule(source, 'reviewReminder')) next.reviewReminder = normalizeReminderRule(source.reviewReminder, base.reviewReminder);
    return { config: next, syncCouponBindings };
  }

  private async validateCouponBatches(adminId: string, product: ProductRecord, rules: Array<{ batchIds: string[]; requireBuyerDeliverable: boolean }>): Promise<void> {
    const requirements = new Map<string, boolean>();
    for (const rule of rules) {
      for (const batchId of rule.batchIds) requirements.set(batchId, Boolean(requirements.get(batchId) || rule.requireBuyerDeliverable));
    }
    for (const [batchId, requireBuyerDeliverable] of requirements) {
      if (!batchId.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'couponBatchIds cannot contain empty values');
      const batch = await this.store.getCouponBatch(adminId, batchId);
      if (!batch) throw new ServiceError(404, 'NOT_FOUND', `coupon batch not found: ${batchId}`);
      if (batch.accountId !== product.accountId) throw new ServiceError(403, 'FORBIDDEN', 'coupon batch account scope mismatch');
      if (batch.status === 'voided' || batch.status === 'closed') throw new ServiceError(409, 'CONFLICT', `coupon batch is ${batch.status}`);
      if (requireBuyerDeliverable && batch.status !== 'active') throw new ServiceError(409, 'CONFLICT', 'coupon batch is not enabled');
      if (requireBuyerDeliverable && batch.deliveryScope !== 'buyer_deliverable') throw new ServiceError(422, 'VALIDATION_FAILED', 'automation requires buyer_deliverable coupon batches');
    }
  }
}

export type AutomationExecutionStatus = 'succeeded' | 'failed' | 'unknown' | 'manual_review' | 'skipped';

export interface AutomationExecutionResult {
  status: AutomationExecutionStatus;
  executionKey: string;
  reason?: string;
  externalRef?: string;
  sentQuantity?: number;
  reminderCount?: number;
}

export interface AutomationExternalResult {
  status: 'succeeded' | 'failed' | 'unknown';
  externalRef?: string;
  errorCode?: string;
  message?: string;
}

export interface AutomationOrderSnapshot extends OrderRecord {
  quantity?: number;
  skuSpec?: string;
  reviewedAt?: string;
  reminderCount?: number;
  lastReminderAt?: string;
}

export interface AutomationExecutionPort {
  reserveCoupon(input: { adminId?: string; accountId: string; productId?: string; itemId?: string; itemTitle?: string; skuSpec?: string; batchIds: string[]; quantity: number; executionKey: string; purpose: 'delivery' | 'gift' }): Promise<{ reservationId: string; quantity: number; noLogisticsForm?: boolean; tradeText?: string }>;
  sendCoupon(input: { adminId?: string; accountId: string; productId?: string; itemId?: string; itemTitle?: string; orderNo: string; reservationId: string; executionKey: string; purpose: 'delivery' | 'gift' }): Promise<AutomationExternalResult>;
  commitCoupon(input: { adminId?: string; reservationId: string; executionKey: string }): Promise<void>;
  releaseCoupon(input: { adminId?: string; reservationId: string; executionKey: string; reason: string }): Promise<void>;
  confirmShipment(input: { adminId?: string; accountId: string; productId?: string; itemId?: string; itemTitle?: string; orderNo: string; executionKey: string; noLogisticsForm?: boolean; tradeText?: string }): Promise<AutomationExternalResult>;
  repriceOrder(input: { adminId?: string; accountId: string; productId?: string; itemId?: string; itemTitle?: string; orderNo: string; targetPriceMinor: number; executionKey: string }): Promise<AutomationExternalResult>;
  sendText(input: { adminId?: string; accountId: string; productId?: string; itemId?: string; itemTitle?: string; conversationId: string; text: string; executionKey: string }): Promise<AutomationExternalResult>;
  persistReviewFact(input: { adminId?: string; accountId: string; productId?: string; itemId?: string; itemTitle?: string; orderNo: string; eventId: string; executionKey: string }): Promise<{ created: boolean }>;
  readOrder(input: { adminId?: string; accountId: string; productId?: string; itemId?: string; itemTitle?: string; orderNo: string }): Promise<AutomationOrderSnapshot | undefined>;
  markManualReview(input: { adminId?: string; accountId: string; productId?: string; itemId?: string; itemTitle?: string; orderNo: string; executionKey: string; reason: string }): Promise<void>;
}

export interface ExecutionLedgerEntry { fingerprint: string; result: AutomationExecutionResult; retryable: boolean; attemptCount: number; updatedAt: string; }

export interface AutomationExecutionLedger {
  get(key: string): ExecutionLedgerEntry | undefined | Promise<ExecutionLedgerEntry | undefined>;
  claim(input: { key: string; fingerprint: string; ownerToken: string; leaseUntil: string }): { claimed: boolean; entry?: ExecutionLedgerEntry; running?: boolean } | Promise<{ claimed: boolean; entry?: ExecutionLedgerEntry; running?: boolean }>;
  complete(input: { key: string; ownerToken: string; result: AutomationExecutionResult; retryable: boolean }): void | Promise<void>;
}

export class InMemoryAutomationExecutionLedger implements AutomationExecutionLedger {
  private readonly entries = new Map<string, { entry: ExecutionLedgerEntry; ownerToken?: string; status: 'running' | 'completed'; leaseUntil?: string }>();
  get(key: string): ExecutionLedgerEntry | undefined { return this.entries.get(key)?.status === 'completed' ? structuredClone(this.entries.get(key)!.entry) : undefined; }
  claim(input: { key: string; fingerprint: string; ownerToken: string; leaseUntil: string }): { claimed: boolean; entry?: ExecutionLedgerEntry; running?: boolean } {
    const current = this.entries.get(input.key);
    if (!current) {
      this.entries.set(input.key, { status: 'running', ownerToken: input.ownerToken, leaseUntil: input.leaseUntil, entry: { fingerprint: input.fingerprint, result: skipped(input.key, 'running'), retryable: false, attemptCount: 1, updatedAt: new Date().toISOString() } });
      return { claimed: true };
    }
    if (current.entry.fingerprint !== input.fingerprint) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'automation execution key reused with different input');
    const expired = current.status === 'running' && (!current.leaseUntil || Date.parse(current.leaseUntil) <= Date.now());
    if ((current.status === 'completed' && current.entry.retryable) || expired) {
      current.status = 'running';
      current.ownerToken = input.ownerToken;
      current.leaseUntil = input.leaseUntil;
      current.entry.attemptCount += 1;
      current.entry.updatedAt = new Date().toISOString();
      return { claimed: true };
    }
    if (current.status === 'completed') return { claimed: false, entry: structuredClone(current.entry) };
    return { claimed: false, running: true };
  }
  complete(input: { key: string; ownerToken: string; result: AutomationExecutionResult; retryable: boolean }): void {
    const current = this.entries.get(input.key);
    if (!current || current.ownerToken !== input.ownerToken) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'automation execution owner changed');
    current.status = 'completed';
    current.entry = { fingerprint: current.entry.fingerprint, result: structuredClone(input.result), retryable: input.retryable, attemptCount: current.entry.attemptCount, updatedAt: new Date().toISOString() };
    current.ownerToken = undefined;
    current.leaseUntil = undefined;
  }
}

export class PersistentAutomationExecutionLedger implements AutomationExecutionLedger {
  constructor(private readonly store: Store, private readonly leaseMs = 120_000) {}
  async get(key: string): Promise<ExecutionLedgerEntry | undefined> {
    const record = await this.store.getAutomationExecution(key);
    if (!record || record.status !== 'completed' || !record.result) return undefined;
    return { fingerprint: record.fingerprint, result: record.result as AutomationExecutionResult, retryable: record.retryable, attemptCount: record.attemptCount, updatedAt: record.updatedAt };
  }
  async claim(input: { key: string; fingerprint: string; ownerToken: string; leaseUntil: string }): Promise<{ claimed: boolean; entry?: ExecutionLedgerEntry; running?: boolean }> {
    const result = await this.store.claimAutomationExecution({ executionKey: input.key, fingerprint: input.fingerprint, ownerToken: input.ownerToken, leaseUntil: input.leaseUntil });
    if (result.claimed) return { claimed: true };
    const record = result.record;
    if (record.status === 'completed' && record.result) return { claimed: false, entry: { fingerprint: record.fingerprint, result: record.result as AutomationExecutionResult, retryable: record.retryable, attemptCount: record.attemptCount, updatedAt: record.updatedAt } };
    return { claimed: false, running: true };
  }
  async complete(input: { key: string; ownerToken: string; result: AutomationExecutionResult; retryable: boolean }): Promise<void> {
    await this.store.completeAutomationExecution({ executionKey: input.key, ownerToken: input.ownerToken, result: input.result, retryable: input.retryable });
  }
  leaseUntil(): string { return new Date(Date.now() + this.leaseMs).toISOString(); }
}

export class AutomationWorkflowService {
  private readonly inFlight = new Map<string, { fingerprint: string; promise: Promise<AutomationExecutionResult> }>();
  constructor(private readonly port: AutomationExecutionPort, private readonly ledger: AutomationExecutionLedger = new InMemoryAutomationExecutionLedger()) {}

  async handlePaymentPaid(input: { adminId?: string; config: ProductAutomationConfig; order: AutomationOrderSnapshot; eventId: string }): Promise<AutomationExecutionResult> {
    const rule = input.config.paidAutoDelivery;
    const key = `paid_auto_delivery:${input.order.accountId}:${input.order.orderNo}`;
    return this.once(key, { eventId: input.eventId, orderNo: input.order.orderNo, rule }, async () => {
      if (!rule.enabled) return skipped(key, 'rule_disabled');
      if (input.order.paymentStatus !== 'paid') return skipped(key, 'order_not_paid');
      if (input.order.deliveryStatus === 'delivered') return skipped(key, 'already_delivered');
      const quantity = Math.max(1, Math.trunc(input.order.quantity ?? 1));
      let reservation: Awaited<ReturnType<AutomationExecutionPort['reserveCoupon']>>;
      try {
        reservation = await this.port.reserveCoupon({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, skuSpec: input.order.skuSpec, batchIds: rule.couponBatchIds, quantity, executionKey: key, purpose: 'delivery' });
      } catch (error) {
        return failed(key, failureReason(error, 'coupon_reservation_failed'));
      }
      if (reservation.quantity < quantity) {
        await this.port.releaseCoupon({ adminId: input.adminId, reservationId: reservation.reservationId, executionKey: key, reason: 'coupon_delivery_item_unavailable' });
        return failed(key, 'coupon_delivery_item_unavailable');
      }
      if (reservation.noLogisticsForm && !rule.autoConfirm) {
        await this.port.releaseCoupon({ adminId: input.adminId, reservationId: reservation.reservationId, executionKey: key, reason: 'no_logistics_requires_auto_confirm' });
        return failed(key, 'no_logistics_requires_auto_confirm');
      }
      const sent = await this.port.sendCoupon({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, reservationId: reservation.reservationId, executionKey: key, purpose: 'delivery' });
      if (sent.status === 'unknown') {
        await this.port.markManualReview({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, executionKey: key, reason: sent.errorCode ?? 'coupon_send_result_unknown' });
        return { status: 'manual_review', executionKey: key, reason: sent.errorCode ?? 'coupon_send_result_unknown', sentQuantity: reservation.quantity };
      }
      if (sent.status === 'failed') {
        await this.port.releaseCoupon({ adminId: input.adminId, reservationId: reservation.reservationId, executionKey: key, reason: sent.errorCode ?? sent.status });
        return failed(key, sent.errorCode ?? 'coupon_send_failed');
      }
      try {
        await this.port.commitCoupon({ adminId: input.adminId, reservationId: reservation.reservationId, executionKey: key });
      } catch (error) {
        await this.port.markManualReview({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, executionKey: key, reason: 'coupon_commit_unknown' });
        return { status: 'manual_review', executionKey: key, reason: failureReason(error, 'coupon_commit_unknown'), externalRef: sent.externalRef, sentQuantity: reservation.quantity };
      }
      if (!rule.autoConfirm) return { status: 'succeeded', executionKey: key, externalRef: sent.externalRef, sentQuantity: reservation.quantity };
      const confirmed = await this.port.confirmShipment({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, executionKey: key, noLogisticsForm: reservation.noLogisticsForm, tradeText: reservation.tradeText });
      if (confirmed.status === 'unknown') {
        await this.port.markManualReview({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, executionKey: key, reason: 'shipment_confirmation_unknown' });
        return { status: 'manual_review', executionKey: key, reason: confirmed.errorCode ?? 'shipment_confirmation_unknown', externalRef: sent.externalRef, sentQuantity: reservation.quantity };
      }
      if (confirmed.status === 'failed') {
        await this.port.markManualReview({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, executionKey: key, reason: confirmed.errorCode ?? 'shipment_confirmation_failed' });
        return { status: 'manual_review', executionKey: key, reason: confirmed.errorCode ?? 'shipment_confirmation_failed', externalRef: sent.externalRef, sentQuantity: reservation.quantity };
      }
      return { status: 'succeeded', executionKey: key, externalRef: confirmed.externalRef ?? sent.externalRef, sentQuantity: reservation.quantity };
    }, { maxAttempts: rule.maxAttempts, retryBackoffSeconds: rule.retryBackoffSeconds });
  }

  async handleUnpaidReprice(input: { adminId?: string; config: ProductAutomationConfig; order: AutomationOrderSnapshot; eventId: string }): Promise<AutomationExecutionResult> {
    const rule = input.config.unpaidAutoReprice;
    const key = `unpaid_auto_reprice:${input.order.accountId}:${input.order.orderNo}`;
    return this.once(key, { eventId: input.eventId, orderNo: input.order.orderNo, rule }, async () => {
      if (!rule.enabled) return skipped(key, 'rule_disabled');
      if (input.order.paymentStatus !== 'unpaid') return skipped(key, 'order_not_unpaid');
      const before = await this.port.readOrder({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo });
      if (!before) return { status: 'manual_review', executionKey: key, reason: 'reprice_state_unavailable' };
      if (before.paymentStatus !== 'unpaid') return skipped(key, 'order_paid_before_reprice');
      const changed = await this.port.repriceOrder({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, targetPriceMinor: rule.targetPriceMinor, executionKey: key });
      if (changed.status === 'unknown') return unknown(key, changed.errorCode ?? 'reprice_result_unknown');
      if (changed.status === 'failed') return failed(key, changed.errorCode ?? 'reprice_failed');
      if (rule.message && input.order.conversationId) {
        const sent = await this.port.sendText({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, conversationId: input.order.conversationId, text: rule.message, executionKey: `${key}:message` });
        if (sent.status === 'unknown') return { status: 'manual_review', executionKey: key, reason: 'reprice_succeeded_message_unknown', externalRef: changed.externalRef };
        if (sent.status === 'failed') return { status: 'succeeded', executionKey: key, reason: 'reprice_succeeded_message_failed', externalRef: changed.externalRef };
      }
      return { status: 'succeeded', executionKey: key, externalRef: changed.externalRef };
    }, { maxAttempts: rule.maxAttempts, retryBackoffSeconds: rule.retryBackoffSeconds });
  }

  async handleReviewGift(input: { adminId?: string; config: ProductAutomationConfig; order: AutomationOrderSnapshot; eventId: string }): Promise<AutomationExecutionResult> {
    const rule = input.config.reviewGift;
    const key = `review_gift:${input.order.accountId}:${input.order.orderNo}`;
    return this.once(key, { orderNo: input.order.orderNo, rule }, async (isRetry) => {
      if (!rule.enabled) return skipped(key, 'rule_disabled');
      const fact = await this.port.persistReviewFact({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, eventId: input.eventId, executionKey: key });
      if (!fact.created && !isRetry) return skipped(key, 'review_already_recorded');
      const quantity = Math.max(1, Math.trunc(input.order.quantity ?? 1));
      let reservation: Awaited<ReturnType<AutomationExecutionPort['reserveCoupon']>>;
      try {
        reservation = await this.port.reserveCoupon({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, skuSpec: input.order.skuSpec, batchIds: rule.couponBatchIds, quantity, executionKey: key, purpose: 'gift' });
      } catch (error) {
        return failed(key, failureReason(error, 'coupon_reservation_failed'));
      }
      if (reservation.quantity < quantity) {
        await this.port.releaseCoupon({ adminId: input.adminId, reservationId: reservation.reservationId, executionKey: key, reason: 'coupon_delivery_item_unavailable' });
        return failed(key, 'coupon_delivery_item_unavailable');
      }
      const sent = await this.port.sendCoupon({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, reservationId: reservation.reservationId, executionKey: key, purpose: 'gift' });
      if (sent.status === 'unknown') {
        await this.port.markManualReview({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, executionKey: key, reason: sent.errorCode ?? 'gift_send_result_unknown' });
        return { status: 'manual_review', executionKey: key, reason: sent.errorCode ?? 'gift_send_result_unknown', sentQuantity: reservation.quantity };
      }
      if (sent.status === 'failed') {
        await this.port.releaseCoupon({ adminId: input.adminId, reservationId: reservation.reservationId, executionKey: key, reason: sent.errorCode ?? sent.status });
        return failed(key, sent.errorCode ?? 'gift_send_failed');
      }
      try {
        await this.port.commitCoupon({ adminId: input.adminId, reservationId: reservation.reservationId, executionKey: key });
      } catch (error) {
        await this.port.markManualReview({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo, executionKey: key, reason: 'coupon_commit_unknown' });
        return { status: 'manual_review', executionKey: key, reason: failureReason(error, 'coupon_commit_unknown'), externalRef: sent.externalRef, sentQuantity: reservation.quantity };
      }
      return { status: 'succeeded', executionKey: key, externalRef: sent.externalRef, sentQuantity: reservation.quantity };
    }, { maxAttempts: rule.maxAttempts, retryBackoffSeconds: rule.retryBackoffSeconds });
  }

  async handleReviewReminder(input: { adminId?: string; config: ProductAutomationConfig; order: AutomationOrderSnapshot; now?: string }): Promise<AutomationExecutionResult> {
    const rule = input.config.reviewReminder;
    const key = `review_reminder:${input.order.accountId}:${input.order.orderNo}:${input.order.reminderCount ?? 0}`;
    return this.once(key, { orderNo: input.order.orderNo, rule, now: input.now }, async () => {
      if (!rule.enabled) return skipped(key, 'rule_disabled');
      const now = Date.parse(input.now ?? new Date().toISOString());
      const created = Date.parse(input.order.createdAt);
      const firstDue = created + rule.firstDelayHours * 3_600_000;
      const previous = input.order.lastReminderAt ? Date.parse(input.order.lastReminderAt) : undefined;
      const repeatDue = previous === undefined ? firstDue : previous + rule.repeatIntervalHours * 3_600_000;
      const count = input.order.reminderCount ?? 0;
      if (!Number.isFinite(now) || now < repeatDue || count >= rule.maxReminders) return skipped(key, 'not_due_or_capped');
      const before = await this.port.readOrder({ adminId: input.adminId, accountId: input.order.accountId, productId: input.order.productId, itemId: input.order.itemId, itemTitle: input.order.itemTitle, orderNo: input.order.orderNo });
      if (!before || before.deliveryStatus !== 'delivered' || before.reviewedAt || !before.conversationId) return skipped(key, 'order_no_longer_eligible');
      const sent = await this.port.sendText({ adminId: input.adminId, accountId: before.accountId, productId: before.productId, itemId: before.itemId, itemTitle: before.itemTitle, conversationId: before.conversationId, text: rule.message, executionKey: key });
      if (sent.status === 'unknown') return unknown(key, sent.errorCode ?? 'reminder_result_unknown');
      if (sent.status === 'failed') return failed(key, sent.errorCode ?? 'reminder_send_failed');
      return { status: 'succeeded', executionKey: key, externalRef: sent.externalRef, reminderCount: count + 1 };
    });
  }

  private async once(key: string, value: unknown, handler: (isRetry: boolean) => Promise<AutomationExecutionResult>, policy: { maxAttempts?: number; retryBackoffSeconds?: number } = {}): Promise<AutomationExecutionResult> {
    const fingerprint = digestJson(value);
    const running = this.inFlight.get(key);
    if (running) {
      if (running.fingerprint !== fingerprint) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'automation execution key reused with different input');
      return running.promise;
    }
    const existing = await this.ledger.get(key);
    const isRetry = Boolean(existing?.retryable);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'automation execution key reused with different input');
      if (!existing.retryable) return existing.result;
      if ((policy.maxAttempts ?? 5) <= existing.attemptCount) return { status: 'manual_review', executionKey: key, reason: 'retry_exhausted' };
      const backoffMs = Math.max(0, policy.retryBackoffSeconds ?? 0) * 1000;
      if (backoffMs > 0 && Date.parse(existing.updatedAt) + backoffMs > Date.now()) return existing.result;
    }
    const ownerToken = createId();
    const promise = (async () => {
      let claim = await this.ledger.claim({ key, fingerprint, ownerToken, leaseUntil: new Date(Date.now() + 120_000).toISOString() });
      if (!claim.claimed) {
        if (claim.entry) return claim.entry.result;
        const deadline = Date.now() + 125_000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          claim = await this.ledger.claim({ key, fingerprint, ownerToken, leaseUntil: new Date(Date.now() + 120_000).toISOString() });
          if (claim.claimed) break;
          if (claim.entry) return claim.entry.result;
        }
        if (!claim.claimed) return unknown(key, 'execution_lease_timeout');
      }
      try {
        const result = await handler(isRetry);
        await this.ledger.complete({ key, ownerToken, result, retryable: result.status === 'failed' || result.status === 'unknown' });
        return result;
      } catch (error) {
        const result = failed(key, error instanceof Error ? error.message.slice(0, 160) : 'automation_execution_failed');
        try { await this.ledger.complete({ key, ownerToken, result, retryable: true }); } catch { /* preserve original failure */ }
        throw error;
      }
    })();
    this.inFlight.set(key, { fingerprint, promise });
    try { return await promise; }
    finally {
      const current = this.inFlight.get(key);
      if (current?.promise === promise) this.inFlight.delete(key);
    }
  }
}

function parseVersion(value: unknown): number {
  const version = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) throw new ServiceError(422, 'VALIDATION_FAILED', 'expectedConfigVersion must be a positive integer');
  return version;
}

function parseProductIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new ServiceError(422, 'VALIDATION_FAILED', 'productIds must contain 1 to 100 items');
  const ids = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  if (ids.length !== value.length || ids.some((id) => !UUID_PATTERN.test(id))) throw new ServiceError(422, 'VALIDATION_FAILED', 'productIds must be UUIDs');
  return ids;
}

function parseExpectedVersions(value: unknown, productIds: string[]): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError(422, 'VALIDATION_FAILED', 'expectedConfigVersions must be an object');
  const source = value as Record<string, unknown>;
  return Object.fromEntries(productIds.map((productId) => [productId, parseVersion(source[productId])]));
}

function normalizePaidRule(value: unknown, fallback: ProductAutomationConfig['paidAutoDelivery']): ProductAutomationConfig['paidAutoDelivery'] {
  const source = asRecord(value);
  return { enabled: booleanValue(source.enabled, fallback.enabled), couponBatchIds: stringArray(source.couponBatchIds, fallback.couponBatchIds), autoConfirm: booleanValue(source.autoConfirm, fallback.autoConfirm), maxAttempts: boundedInt(source.maxAttempts, fallback.maxAttempts, 1, 5), retryBackoffSeconds: boundedInt(source.retryBackoffSeconds, fallback.retryBackoffSeconds, 0, 86_400) };
}
function normalizeRepriceRule(value: unknown, fallback: ProductAutomationConfig['unpaidAutoReprice']): ProductAutomationConfig['unpaidAutoReprice'] {
  const source = asRecord(value);
  const targetPriceMinor = integer(source.targetPriceMinor, fallback.targetPriceMinor);
  if (targetPriceMinor < 0) throw new ServiceError(422, 'VALIDATION_FAILED', 'targetPriceMinor must be non-negative');
  const message = source.message === undefined || source.message === null ? undefined : stringValue(source.message, 'message', 500);
  return { enabled: booleanValue(source.enabled, fallback.enabled), mode: 'fixed', targetPriceMinor, message: source.message === undefined ? fallback.message : message, maxAttempts: boundedInt(source.maxAttempts, fallback.maxAttempts, 1, 5), retryBackoffSeconds: boundedInt(source.retryBackoffSeconds, fallback.retryBackoffSeconds, 0, 86_400) };
}
function normalizeGiftRule(value: unknown, fallback: ProductAutomationConfig['reviewGift']): ProductAutomationConfig['reviewGift'] {
  const source = asRecord(value);
  return { enabled: booleanValue(source.enabled, fallback.enabled), couponBatchIds: stringArray(source.couponBatchIds, fallback.couponBatchIds), maxAttempts: boundedInt(source.maxAttempts, fallback.maxAttempts, 1, 5), retryBackoffSeconds: boundedInt(source.retryBackoffSeconds, fallback.retryBackoffSeconds, 0, 86_400) };
}
function normalizeReminderRule(value: unknown, fallback: ProductAutomationConfig['reviewReminder']): ProductAutomationConfig['reviewReminder'] {
  const source = asRecord(value);
  const message = source.message === undefined ? fallback.message : stringValue(source.message, 'message', 500);
  if (!message.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'reviewReminder.message is required');
  return { enabled: booleanValue(source.enabled, fallback.enabled), firstDelayHours: boundedInt(source.firstDelayHours, fallback.firstDelayHours, 1, 720), repeatIntervalHours: boundedInt(source.repeatIntervalHours, fallback.repeatIntervalHours, 1, 720), maxReminders: boundedInt(source.maxReminders, fallback.maxReminders, 1, 10), message: message.trim() };
}
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function booleanValue(value: unknown, fallback: boolean): boolean { return value === undefined ? fallback : value === true; }
function hasRule(source: Record<string, unknown>, key: keyof ProductAutomationConfig): boolean { return Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined; }
function stringArray(value: unknown, fallback: string[] = []): string[] { if (value === undefined) return [...fallback]; if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new ServiceError(422, 'VALIDATION_FAILED', 'couponBatchIds must be an array of strings'); return [...new Set(value.map((item) => item.trim()).filter(Boolean))]; }
function integer(value: unknown, fallback: number): number { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : fallback; if (!Number.isSafeInteger(parsed)) throw new ServiceError(422, 'VALIDATION_FAILED', 'value must be an integer'); return parsed; }
function boundedInt(value: unknown, fallback: number, min: number, max: number): number { const parsed = integer(value, fallback); if (parsed < min || parsed > max) throw new ServiceError(422, 'VALIDATION_FAILED', `value must be between ${min} and ${max}`); return parsed; }
function stringValue(value: unknown, field: string, max: number): string { if (typeof value !== 'string' || value.trim().length > max) throw new ServiceError(422, 'VALIDATION_FAILED', `${field} must be a string of at most ${max} characters`); return value.trim(); }
function enabledRules(config: ProductAutomationConfig): string[] { return (Object.entries(config) as Array<[keyof ProductAutomationConfig, ProductAutomationConfig[keyof ProductAutomationConfig]]>).filter(([, rule]) => rule.enabled).map(([name]) => name); }
function mapAutomationStoreError(error: unknown): ServiceError {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'ACCOUNT_SCOPE_FORBIDDEN') return new ServiceError(403, 'FORBIDDEN', 'account scope required');
  if (code === 'AUTOMATION_VERSION_CONFLICT') return new ServiceError(409, 'AUTOMATION_VERSION_CONFLICT', 'automation config version conflict');
  if (code === 'PRODUCT_NOT_FOUND') return new ServiceError(404, 'NOT_FOUND', 'product not found');
  if (code === 'COUPON_NOT_FOUND') return new ServiceError(404, 'NOT_FOUND', 'coupon batch not found');
  if (code === 'COUPON_BATCH_VOIDED') return new ServiceError(409, 'CONFLICT', 'coupon batch is voided or closed');
  if (code === 'AUTOMATION_BATCH_ACCOUNT_MISMATCH') return new ServiceError(422, 'VALIDATION_FAILED', 'batch automation products must belong to the same account');
  if (error instanceof ServiceError) return error;
  throw error;
}

function skipped(executionKey: string, reason: string): AutomationExecutionResult { return { status: 'skipped', executionKey, reason }; }
function failed(executionKey: string, reason: string): AutomationExecutionResult { return { status: 'failed', executionKey, reason }; }
function unknown(executionKey: string, reason: string): AutomationExecutionResult { return { status: 'unknown', executionKey, reason }; }
function failureReason(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 160);
  return fallback;
}
