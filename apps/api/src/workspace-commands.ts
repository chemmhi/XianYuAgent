import type { AccountService } from './services.js';
import { CouponService, OrderService, ProductService, ProductSyncService, ServiceError } from './services.js';
import type { ProductRecord, OrderRecord, OrderDeliveryType } from './domain.js';
import type { DashboardService, DashboardSnapshot } from './dashboard.js';
import type { AutoReplyActivityService } from './auto-reply-activity.js';
import type { AutoReplyAgentSettingsService } from './auto-reply-agent-settings.js';
import type { OpenAISettingsService } from './openai-settings.js';
import type { ProductAutomationService } from './product-automation.js';
import type { ProductKnowledgeBaseService } from './product-knowledge-base.js';
import type { ProductPublishService, ProductPublishImageInput, ProductPostageMode } from './product-publish.js';
import type { ObjectStorage } from './object-storage.js';
import type { Store, RunRecord, StepRecord } from './domain.js';
import type { OrderDeliveryService } from './order-delivery.js';
import { detectNativeWorkspaceRead, executeNativeWorkspaceRead, type NativeWorkspaceReadResult } from './workspace-native-read.js';
import { prepareNativeWorkspaceWrite, type NativeWorkspaceWritePlan } from './workspace-native-write.js';
import type { ModelToolDefinition } from './pi-runtime.js';

export type WorkspaceCommandResult = NativeWorkspaceReadResult & { mutation?: boolean; operation?: string };

export interface WorkspaceCommandDependencies {
  store: Store;
  accounts: AccountService;
  products: ProductService;
  productSync: ProductSyncService;
  productKnowledgeBase: ProductKnowledgeBaseService;
  productAutomation: ProductAutomationService;
  productPublisher: ProductPublishService;
  objectStorage?: ObjectStorage;
  coupons: CouponService;
  orders: OrderService;
  orderDelivery?: OrderDeliveryService;
  dashboard: DashboardService;
  autoReplyActivity: AutoReplyActivityService;
  autoReplyAgentSettings: AutoReplyAgentSettingsService;
  openaiSettings: OpenAISettingsService;
  verifyAccount?: (input: { adminId: string; accountId: string; requestId: string; traceId: string }) => Promise<{ success: boolean; accountInvalid?: boolean; errorCode?: string; message?: string }>;
  startLoginRecovery?: (input: { adminId: string; accountId: string; requestId: string; traceId: string }) => Promise<{ loginSessionId: string; accountId: string; status: string; expiresAt: string; pollAfterMs?: number; verificationUrl?: string; qrImageDataUrl?: string; errorCode?: string }>;
}

export interface WorkspaceCommandInput {
  adminId: string;
  accountId: string;
  instruction: string;
  requestId: string;
  traceId: string;
}

export interface WorkspaceModelToolResult {
  kind: 'read' | 'write_plan';
  title: string;
  summary: string;
  content: string;
  data?: Record<string, unknown>;
  plan?: NativeWorkspaceWritePlan;
}

type CommandKind = 'accounts' | 'dashboard' | 'products' | 'coupons' | 'orders' | 'agent_activity' | 'agent_settings' | 'model_settings';

/**
 * Single orchestration boundary for Workspace. It deliberately delegates all
 * business facts and writes to existing domain services; Workspace only turns
 * natural language into a safe command and a redacted presentation.
 */
export class WorkspaceCommandOrchestrator {
  constructor(private readonly deps: WorkspaceCommandDependencies) {}

  getModelTools(): ModelToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'workspace_read',
          description: 'Read current Workspace data for the selected account. Use only for read/diagnostic requests such as account, order, dashboard, or broad product reads. Do not use for cancellation, disable, update, publish, delivery, or other mutations; do not use for a product-name lookup when workspace_product_search applies.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: { instruction: { type: 'string', description: 'The complete read request to execute.' } },
            required: ['instruction'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'workspace_prepare_write',
          description: 'Prepare a controlled Workspace mutation. Use for cancellation, disable, update, publish, delivery, configuration, and other write requests. This creates a confirmation plan and never executes the mutation before the user confirms it. Resolve a product by its name or external number when the user did not provide an internal ID.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              instruction: { type: 'string', description: 'The complete mutation request to prepare.' },
              productId: { type: 'string', description: 'Resolved internal product ID from workspace_product_search, when available.' },
            },
            required: ['instruction'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'workspace_product_search',
          description: 'Search one account-scoped product by exact name or external product number. Use this for product-specific lookups and return the matching product identity; do not call a broad product-list read for a named product.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: { query: { type: 'string', description: 'Exact or near-exact product title or external product number.' } },
            required: ['query'],
          },
        },
      },
    ];
  }

  async executeModelTool(name: string, args: Record<string, unknown>, input: WorkspaceCommandInput): Promise<WorkspaceModelToolResult> {
    const instruction = typeof args.instruction === 'string' ? args.instruction.trim() : '';
    if (name === 'workspace_product_search') {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) throw new ServiceError(422, 'VALIDATION_FAILED', 'workspace product search query is required');
      const result = await this.searchProducts(input, query);
      return { kind: 'read', title: '商品搜索', summary: `已按名称/外部编号筛选 ${result.total} 个商品`, content: productSearchContent(result.items, result.total), data: { total: result.total, items: result.items.map(safeProduct) } };
    }
    if (!instruction) throw new ServiceError(422, 'VALIDATION_FAILED', 'workspace tool instruction is required');
    if (name === 'workspace_read') {
      if (requiresWorkspaceWrite(instruction)) throw new ServiceError(422, 'WORKSPACE_WRITE_REQUIRED', '该请求包含商品变更动作，请使用 workspace_prepare_write');
      if (requiresWorkspaceProductSearch(instruction)) throw new ServiceError(422, 'WORKSPACE_PRODUCT_SEARCH_REQUIRED', '该商品按名称或外部编号查找应使用 workspace_product_search');
      const result = await this.execute({ ...input, instruction });
      if (!result || result.mutation) throw new ServiceError(422, 'VALIDATION_FAILED', 'workspace_read only accepts read operations');
      return { kind: 'read', title: result.title, summary: result.summary, content: result.content, data: result.data };
    }
    if (name === 'workspace_prepare_write') {
      const productId = typeof args.productId === 'string' ? args.productId.trim() : '';
      const preparedInstruction = productId && !/(?:商品(?:ID|id)|productId)\s*[:：=]/i.test(instruction) ? `${instruction}; 商品ID:${productId}` : instruction;
      const plan = await this.prepareWrite({ ...input, instruction: preparedInstruction });
      if (!plan) throw new ServiceError(422, 'VALIDATION_FAILED', 'workspace mutation is not supported by the configured tools');
      return { kind: 'write_plan', title: plan.title, summary: plan.summary, content: plan.content, data: plan.manifest, plan };
    }
    throw new ServiceError(422, 'VALIDATION_FAILED', `unknown workspace tool: ${name}`);
  }

  async prepareWrite(input: WorkspaceCommandInput): Promise<NativeWorkspaceWritePlan | undefined> {
    const existing = await prepareNativeWorkspaceWrite({ store: this.deps.store, adminId: input.adminId, accountId: input.accountId, instruction: input.instruction });
    if (existing) return existing;
    if (shouldDelegateNativeRead(input.instruction)) return undefined;
    const kind = detectCommand(input.instruction);
    if (!kind) return undefined;
    const fields = parseFields(input.instruction);
    const accountId = input.accountId;
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

    if (kind === 'products' && /(同步|刷新|拉取)/i.test(input.instruction)) return undefined;
    if (kind === 'orders' && /(同步|刷新|拉取)/i.test(input.instruction)) return undefined;

    if (kind === 'orders' && !/(预览)/i.test(input.instruction) && !/(未发货|待发货)/i.test(input.instruction) && /(发货|交付|取消发货|取消交付|重试发货|重试交付)/i.test(input.instruction)) {
      const orderNo = fields.orderNo ?? extractOrderNo(input.instruction);
      if (!orderNo) throw new ServiceError(422, 'VALIDATION_FAILED', '订单号不能为空');
      const action = /(取消发货|取消交付)/i.test(input.instruction) ? 'order_cancel' : /(重试发货|重试交付|重试)/i.test(input.instruction) ? 'order_retry' : 'order_deliver';
      const deliveryType = normalizeDeliveryType(fields.deliveryType ?? input.instruction.match(/(?:deliveryType|交付方式|发货方式)\s*[:：=]?\s*(manual|no_logistics|coupon_only|mixed|人工|免物流|只发卡券|混合)/i)?.[1] ?? (/(免物流|no_logistics)/i.test(input.instruction) ? 'no_logistics' : /只发卡券|coupon_only/i.test(input.instruction) ? 'coupon_only' : /混合|mixed/i.test(input.instruction) ? 'mixed' : /人工|manual/i.test(input.instruction) ? 'manual' : undefined));
      if (action === 'order_deliver' && this.deps.orderDelivery) {
        const preview = await this.deps.orderDelivery.preview({ adminId: input.adminId, accountId, orderNo, deliveryType, trackingRef: fields.trackingRef });
        if (preview.state !== 'ready') throw new ServiceError(422, 'DELIVERY_NOT_READY', 'order delivery preview is blocked', { preview });
      }
      return this.plan(action, action === 'order_cancel' ? '取消订单交付确认' : action === 'order_retry' ? '重试订单交付确认' : '订单发货确认', `准备${action === 'order_cancel' ? '取消' : action === 'order_retry' ? '重试' : '执行'}订单 ${orderNo} 的交付动作`, expiresAt, { action, accountId, orderNo, deliveryType, trackingRef: fields.trackingRef, tradeText: fields.tradeText, idempotencyKey: fields.idempotencyKey ?? `workspace-order:${accountId}:${orderNo}:${action}`, redacted: true });
    }

    if (kind === 'products' && /(知识库|自动化|规则|编辑商品|修改商品)/i.test(input.instruction)) {
      const productId = await this.resolveProductId(input, fields.productId);
      const action = /(自动化|规则|发货|改价|赠品|评价)/i.test(input.instruction) ? 'product_automation_update' : /知识库|问答|客服知识/i.test(input.instruction) ? 'product_knowledge_update' : 'product_update';
      const disablingAutomation = action === 'product_automation_update' && /(取消|关闭|停用|禁用)/i.test(input.instruction);
      const summary = action === 'product_automation_update'
        ? `${disablingAutomation ? '准备停用' : '准备更新'}商品自动化规则（商品 ${productId}）`
        : action === 'product_knowledge_update' ? `准备更新商品知识库（商品 ${productId}）` : `准备更新商品信息（商品 ${productId}）`;
      const expectedConfigVersion = action === 'product_automation_update'
        ? await this.currentProductAutomationVersion(input.adminId, productId)
        : await this.currentProductVersion(input.adminId, productId);
      const manifest: Record<string, unknown> = { action, accountId, productId, expectedConfigVersion, fields: safeFieldNames(fields) };
      if (disablingAutomation) {
        manifest.config = {
          paidAutoDelivery: { enabled: false, couponBatchIds: [] },
          unpaidAutoReprice: { enabled: false },
          reviewGift: { enabled: false, couponBatchIds: [] },
          reviewReminder: { enabled: false },
        };
      }
      return this.plan(action, action === 'product_automation_update' ? `${disablingAutomation ? '停用' : ''}商品自动化规则确认` : action === 'product_knowledge_update' ? '商品知识库确认' : '商品信息变更确认', summary, expiresAt, manifest);
    }

    if (kind === 'coupons') {
      const batchId = fields.batchId ?? extractId(input.instruction) ?? input.instruction.match(/(?:卡券(?:批次)?|启用|禁用|停用|暂停|删除|作废|复制|克隆)\s+([A-Za-z0-9_-]{4,})/i)?.[1];
      if (!batchId) throw new ServiceError(422, 'VALIDATION_FAILED', '卡券批次 ID 不能为空');
      const action = /(绑定|关联)/i.test(input.instruction) ? 'coupon_bind'
        : /(解绑|解除关联)/i.test(input.instruction) ? 'coupon_unbind'
          : /(复制|克隆)/i.test(input.instruction) ? 'coupon_copy'
            : /(删除|作废)/i.test(input.instruction) ? 'coupon_void'
              : /(启用|开启)/i.test(input.instruction) ? 'coupon_enable'
                : /(禁用|停用|暂停)/i.test(input.instruction) ? 'coupon_disable' : 'coupon_update';
      const productId = fields.productId ?? extractProductId(input.instruction);
      const label = action === 'coupon_copy' ? '复制卡券批次确认' : action === 'coupon_bind' || action === 'coupon_unbind' ? '卡券商品关联确认' : '卡券批次变更确认';
      const summary = action === 'coupon_bind' ? `准备将卡券批次 ${batchId} 关联商品 ${productId ?? '未指定'}` : action === 'coupon_unbind' ? `准备解除卡券批次 ${batchId} 与商品 ${productId ?? '未指定'} 的关联` : `准备${action === 'coupon_copy' ? '复制' : action === 'coupon_void' ? '作废' : action === 'coupon_enable' ? '启用' : action === 'coupon_disable' ? '禁用' : '更新'}卡券批次 ${batchId}`;
      return this.plan(action, label, summary, expiresAt, { action, accountId, batchId, productId, patch: { label: fields.label, purpose: fields.purpose, status: fields.status, metadata: fields.metadata }, redacted: true });
    }

    if (kind === 'model_settings' && /(新增|修改|更新|配置|设置)/i.test(input.instruction)) {
      const summary = `准备更新当前账号的 OpenAI-compatible 模型配置（${fields.provider ?? 'Provider 未指定'} / ${fields.model ?? '模型未指定'}）`;
      return this.plan('model_settings_update', '模型配置确认', summary, expiresAt, { action: 'model_settings_update', accountId, configId: fields.configId, expectedVersion: Number(fields.expectedVersion ?? 0) || undefined, provider: fields.provider, model: fields.model, baseUrl: fields.baseUrl, role: fields.role ?? 'primary', wireApi: fields.wireApi, timeoutMs: Number(fields.timeoutMs ?? 60_000), apiKeyConfigured: Boolean(fields.apiKey), redacted: true });
    }
    return undefined;
  }

  async execute(input: WorkspaceCommandInput): Promise<WorkspaceCommandResult | undefined> {
    const normalized = input.instruction.replace(/\s+/g, ' ').trim();
    if (shouldDelegateNativeRead(normalized)) return executeNativeWorkspaceRead({ store: this.deps.store, adminId: input.adminId, accountId: input.accountId, instruction: normalized });
    const kind = detectCommand(normalized);
    if (!kind) return executeNativeWorkspaceRead({ store: this.deps.store, adminId: input.adminId, accountId: input.accountId, instruction: normalized });
    if (!(await this.deps.store.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
    const fields = parseFields(normalized);

    if (kind === 'accounts') {
      if (/(检查|刷新|验证|连接|健康)/i.test(normalized)) {
        if (!this.deps.verifyAccount) throw new ServiceError(501, 'ACCOUNT_VERIFY_UNAVAILABLE', '账号连接验证能力未接入');
        const verification = await this.deps.verifyAccount({ adminId: input.adminId, accountId: input.accountId, requestId: input.requestId, traceId: input.traceId });
        const status = verification.success ? '连接正常' : verification.accountInvalid ? '账号已失效，需要重新授权' : '连接检查失败';
        return { kind: 'agent_activity', title: '账号连接检查', summary: status, content: `${status}${verification.errorCode ? `（${verification.errorCode}）` : ''}`, data: { accountId: input.accountId, success: verification.success, accountInvalid: verification.accountInvalid ?? false, errorCode: verification.errorCode, message: verification.message } };
      }
      if (/(失效|重新授权|重新登录|二维码|登录恢复)/i.test(normalized)) {
        if (!this.deps.startLoginRecovery) throw new ServiceError(501, 'ACCOUNT_RECOVERY_UNAVAILABLE', '账号登录恢复能力未接入');
        const recovery = await this.deps.startLoginRecovery({ adminId: input.adminId, accountId: input.accountId, requestId: input.requestId, traceId: input.traceId });
        return { kind: 'agent_activity', title: '账号登录恢复', summary: `已创建登录恢复会话 ${recovery.loginSessionId}`, content: `账号登录恢复入口已创建，状态：${recovery.status}。请在登录会话中完成扫码或验证。`, data: { ...recovery, qrImageDataUrl: recovery.qrImageDataUrl ? '[QR_IMAGE_AVAILABLE]' : undefined, redacted: true } };
      }
      return this.accountsResult(input);
    }
    if (kind === 'dashboard') return this.dashboardResult(input);
    if (kind === 'agent_activity') {
      const runId = fields.runId ?? (normalized.match(/(?:运行|run)\s*(?:ID|id)?\s*[:：]?\s*([A-Za-z0-9_-]{4,})/i)?.[1]);
      if (runId && /(详情|流程|步骤|工作流)/i.test(normalized)) {
        const detail = await this.deps.autoReplyActivity.detail({ adminId: input.adminId, runId });
        return { kind: 'agent_activity', title: 'Agent 运行详情', summary: `已读取 Agent Run ${runId}`, content: formatAgentDetail(detail), data: { run: { id: detail.run.id, status: detail.run.status, stage: detail.run.stage, decision: detail.run.decision, failureCode: detail.run.failureCode }, events: (detail.events ?? []).map((event) => ({ eventType: event.eventType, occurredAt: event.occurredAt })) } };
      }
      if (/(列表|运行中|失败|转人工|步骤|工作流)/i.test(normalized)) {
        const result = await this.deps.autoReplyActivity.list({ adminId: input.adminId, query: { accountId: input.accountId, page: 1, pageSize: 20 } });
        return { kind: 'agent_activity', title: 'Agent 运行列表', summary: `已读取 ${result.items.length} 条 Agent Run`, content: result.items.length ? result.items.map((item) => `${item.id} · ${item.status} · ${item.stage ?? '阶段未知'} · ${item.decision ?? '决策未知'}`).join('\n') : '当前时间范围暂无 Agent Run。', data: result };
      }
      const summary = await this.deps.autoReplyActivity.summary({ adminId: input.adminId, accountId: input.accountId });
      return { kind: 'agent_activity', title: 'Agent 运营数据', summary: `已读取 Agent 运营摘要（${summary.inboundCount} 条入站）`, content: `过去 24 小时收到 ${summary.inboundCount} 条消息，完成率 ${(summary.completionRate <= 1 ? summary.completionRate * 100 : summary.completionRate).toFixed(1)}%，转人工 ${summary.handoffCount} 条，失败 ${summary.failedCount} 条，P95 ${Math.round(summary.p95DurationMs)}ms。`, data: { ...summary } };
    }
    if (kind === 'products' && /(自动化|规则|发货|改价|赠品|评价)/i.test(normalized) && !/(修改|更新|配置|设置|启用|禁用|取消|关闭|停用)/i.test(normalized)) {
      const productId = await this.resolveProductId(input, fields.productId);
      const config = await this.deps.productAutomation.get(input.adminId, productId);
      return { kind: 'products', title: '商品自动化规则', summary: `已读取商品自动化规则（v${config.configVersion}）`, content: `商品 ${config.product.title}：自动发货 ${config.config.paidAutoDelivery.enabled ? '开启' : '关闭'}，未付款改价 ${config.config.unpaidAutoReprice.enabled ? '开启' : '关闭'}，赠品 ${config.config.reviewGift.enabled ? '开启' : '关闭'}，求评价 ${config.config.reviewReminder.enabled ? '开启' : '关闭'}。`, data: { ...config } };
    }
    if (kind === 'products' && /知识库/i.test(normalized) && !/(修改|更新|编辑|生成|优化)/i.test(normalized)) {
      const productId = await this.resolveProductId(input, fields.productId);
      const product = await this.deps.products.get(input.adminId, productId);
      return { kind: 'products', title: '商品知识库', summary: `已读取商品知识库（${product.title}）`, content: product.knowledgeBase?.trim() || '该商品尚未配置知识库。', data: { productId, title: product.title, knowledgeBase: product.knowledgeBase ?? '' } };
    }
    if (kind === 'products' && /(查询|查看|列出|列表|搜索|查找|匹配|详情|状态|标题)/i.test(normalized) && !/(知识库|自动化规则|发货规则|改价|赠品|评价|同步|刷新|拉取)/i.test(normalized)) {
      const productId = fields.productId ?? extractProductId(normalized);
      if (productId && /(详情|detail|ID|编号)/i.test(normalized)) {
        const product = await this.deps.products.get(input.adminId, productId);
        if (product.accountId !== input.accountId) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
        return { kind: 'products', title: '商品详情', summary: `已读取商品 ${product.id}`, content: `商品 ${product.title} · 状态 ${product.status} · 价格 ${formatMoney(product.priceMinor)} · 配置版本 v${product.configVersion}`, data: { product: safeProduct(product) } };
      }
      const accountScopedBrowse = /(?:当前账号|本账号|这个账号).*(?:商品|产品)|(?:商品|产品).*(?:当前账号|本账号|这个账号)/i.test(normalized);
      const query = { accountId: input.accountId, keyword: accountScopedBrowse ? undefined : fields.keyword ?? extractKeyword(normalized, ['查询商品', '查看商品', '列出商品', '商品列表']), status: normalizeProductStatus(fields.status ?? extractStatus(normalized)), page: toOptionalInt(fields.page) ?? 1, pageSize: Math.min(100, toOptionalInt(fields.pageSize) ?? 20), sortBy: 'updatedAt' as const, sortOrder: 'desc' as const };
      if (typeof (this.deps.products as unknown as { list?: unknown }).list !== 'function') return executeNativeWorkspaceRead({ store: this.deps.store, adminId: input.adminId, accountId: input.accountId, instruction: normalized });
      const result = await this.deps.products.list(input.adminId, query);
      return productListResult(result.items, result.total);
    }
    if (kind === 'products' && /(同步|刷新|拉取)/i.test(normalized)) {
      const result = await this.deps.productSync.sync({ adminId: input.adminId, accountId: input.accountId, pageSize: fields.pageSize, maxPages: fields.maxPages, requestId: input.requestId, traceId: input.traceId });
      return { kind: 'products', title: '商品同步', summary: `商品同步完成：拉取 ${result.fetchedCount}，新增 ${result.createdCount}，更新 ${result.updatedCount}`, content: `商品同步完成。同步批次 ${result.syncRunId}；拉取 ${result.fetchedCount} 个，新增 ${result.createdCount} 个，更新 ${result.updatedCount} 个，跳过本地草稿 ${result.skippedLocalDraftCount} 个。`, data: { operation: 'product_sync', syncRunId: result.syncRunId, accountId: result.accountId, pagesFetched: result.pagesFetched, fetchedCount: result.fetchedCount, createdCount: result.createdCount, updatedCount: result.updatedCount, skippedLocalDraftCount: result.skippedLocalDraftCount, hasMore: result.hasMore }, mutation: true, operation: 'product_sync' };
    }
    if (kind === 'orders' && /(同步|刷新|拉取)/i.test(normalized)) {
      const result = await this.deps.orders.refresh({ adminId: input.adminId, accountId: input.accountId, pageSize: fields.pageSize, maxPages: fields.maxPages, requestId: input.requestId, traceId: input.traceId });
      return { kind: 'orders', title: '订单同步', summary: `订单同步完成：拉取 ${result.fetchedCount}，新增 ${result.createdCount}，更新 ${result.updatedCount}`, content: `订单同步完成。同步批次 ${result.syncRunId}；拉取 ${result.fetchedCount} 个，新增 ${result.createdCount} 个，更新 ${result.updatedCount} 个，删除 ${result.deletedCount} 个。`, data: { operation: 'order_refresh', syncRunId: result.syncRunId, accountId: result.accountId, pagesFetched: result.pagesFetched, fetchedCount: result.fetchedCount, createdCount: result.createdCount, updatedCount: result.updatedCount, deletedCount: result.deletedCount, hasMore: result.hasMore }, mutation: true, operation: 'order_refresh' };
    }
    if (kind === 'orders' && /(交付预览|发货预览|预览发货)/i.test(normalized)) {
      const orderNo = fields.orderNo ?? extractOrderNo(normalized);
      if (!orderNo) throw new ServiceError(422, 'VALIDATION_FAILED', '订单号不能为空');
      return this.orderDeliveryPreview(input, orderNo);
    }
    if (kind === 'orders' && /(查询|查看|列出|列表|待付款|待发货|待收货|待评价|退款|售后|筛选)/i.test(normalized) && !/(详情|订单号|order\s*no)/i.test(normalized)) {
      const query = { accountId: input.accountId, paymentStatus: normalizePaymentStatus(fields.paymentStatus ?? extractStatusToken(normalized, ['待付款', '已付款', '已支付'])), orderStatus: normalizeOrderStatus(fields.orderStatus), deliveryStatus: normalizeDeliveryStatus(fields.deliveryStatus ?? extractStatusToken(normalized, ['待发货', '待收货'])), afterSalesStatus: normalizeAfterSalesStatus(fields.afterSalesStatus ?? extractStatusToken(normalized, ['退款', '售后'])), sortBy: 'createdAt' as const, sortOrder: 'desc' as const, page: toOptionalInt(fields.page) ?? 1, pageSize: Math.min(100, toOptionalInt(fields.pageSize) ?? 20) };
      if (typeof (this.deps.orders as unknown as { list?: unknown }).list !== 'function') return executeNativeWorkspaceRead({ store: this.deps.store, adminId: input.adminId, accountId: input.accountId, instruction: normalized });
      const result = await this.deps.orders.list(input.adminId, query);
      return orderListResult(result.items, result.total);
    }
    if (kind === 'orders' && /(详情|订单号|order)/i.test(normalized)) {
      const orderNo = fields.orderNo ?? normalized.match(/(?:订单号|order(?:\s*no)?)\s*[:：]?\s*([A-Za-z0-9_-]{4,})/i)?.[1];
      if (!orderNo) throw new ServiceError(422, 'VALIDATION_FAILED', '订单号不能为空');
      const order = await this.deps.orders.get({ adminId: input.adminId, orderNo, accountId: input.accountId });
      return { kind: 'orders', title: '订单详情', summary: `已读取订单 ${order.orderNo}`, content: `订单 ${order.orderNo} · ${order.itemTitle} · 支付 ${order.paymentStatus} · 交付 ${order.deliveryStatus} · 售后 ${order.afterSalesStatus}`, data: { order } };
    }
    if (kind === 'agent_settings') {
      const settings = await this.deps.autoReplyAgentSettings.get(input.adminId, input.accountId);
      const safe = { ...settings, systemPrompt: undefined, userPromptTemplate: undefined };
      return { kind: 'agent_activity', title: 'Agent 配置', summary: `已读取 Agent 配置 v${settings.configVersion}`, content: `自动回复 Agent 当前${settings.enabled ? '已启用' : '已停用'}，配置版本 v${settings.configVersion}，发送模式 ${settings.sendMode}，循环上限 ${settings.maxLoops}，工具调用上限 ${settings.maxToolCalls}，总超时 ${settings.totalTimeoutMs}ms。`, data: safe };
    }
    if (kind === 'model_settings') {
      const configs = await this.deps.openaiSettings.list({ adminId: input.adminId, accountId: input.accountId });
      if (/(测试|连通|模型列表)/i.test(normalized)) {
        const configId = fields.configId ?? configs.find((item) => item.role === 'primary')?.id;
        const models = await this.deps.openaiSettings.listModels({ adminId: input.adminId, accountId: input.accountId, configId });
        return { kind: 'agent_activity', title: '模型连通性', summary: `模型连接成功，返回 ${models.length} 个模型`, content: `模型 Provider 连接成功，当前可用模型 ${models.length} 个。${models.slice(0, 12).map((item) => `\n- ${item.id}`).join('')}`, data: { configId, modelCount: models.length, models: models.slice(0, 50) } };
      }
      return { kind: 'agent_activity', title: '模型配置', summary: `已读取 ${configs.length} 个模型配置`, content: configs.length ? configs.map((item) => `${item.role === 'primary' ? '主' : '备'}配置：${item.provider} / ${item.model} / ${item.baseUrl} / API Key ${item.apiKeyHint ?? '已配置'}`).join('\n') : '当前账号尚未配置 OpenAI-compatible 模型。', data: { items: configs } };
    }
    return executeNativeWorkspaceRead({ store: this.deps.store, adminId: input.adminId, accountId: input.accountId, instruction: normalized });
  }

  async confirm(input: { plan: NativeWorkspaceWritePlan; run: RunRecord; step: StepRecord; adminId: string; requestId: string; traceId: string }): Promise<{ resultSummary: string; outputSummary: string; data?: Record<string, unknown> }> {
    const { action, accountId } = input.plan.manifest;
    const fields = parseFields(input.run.instruction);
    if (action === 'product_publish') {
      return this.confirmProductPublish(input, String(accountId ?? input.run.accountId));
    }
    if (action === 'product_update' || action === 'product_knowledge_update' || action === 'product_automation_update') {
      const productId = String(input.plan.manifest.productId);
      const product = await this.deps.products.get(input.adminId, productId);
      const version = Number(input.plan.manifest.expectedConfigVersion ?? product.configVersion);
      if (action === 'product_update') {
        const patch: Record<string, unknown> = {};
        for (const key of ['title', 'description', 'categoryCode', 'defaultReplyTemplate', 'priceMinor']) if (fields[key] !== undefined) patch[key] = key === 'priceMinor' ? Number(fields[key]) : fields[key];
        if (Object.keys(patch).length === 0) throw new ServiceError(422, 'VALIDATION_FAILED', '商品变更至少需要一个可编辑字段');
        const updated = await this.deps.products.update({ adminId: input.adminId, productId, accountId: String(accountId), expectedConfigVersion: version, patch, requestId: input.requestId, traceId: input.traceId });
        return { resultSummary: `商品信息已更新（v${updated.configVersion}）`, outputSummary: `商品 ${updated.title} 信息已更新`, data: { productId, configVersion: updated.configVersion, changedFields: Object.keys(patch) } };
      }
      if (action === 'product_knowledge_update') {
        const knowledgeBase = fields.knowledgeBase ?? fields.content;
        if (!knowledgeBase) {
          const generated = /优化/i.test(input.run.instruction)
            ? await this.deps.productKnowledgeBase.optimize({ adminId: input.adminId, productId, accountId: String(accountId), expectedConfigVersion: version, requestId: input.requestId, traceId: input.traceId })
            : await this.deps.productKnowledgeBase.appendFromConversations({ adminId: input.adminId, productId, accountId: String(accountId), expectedConfigVersion: version, requestId: input.requestId, traceId: input.traceId });
          return { resultSummary: generated.changed ? `商品知识库已${/优化/i.test(input.run.instruction) ? '优化' : '生成'}（v${generated.product.configVersion}）` : '商品知识库无需变更', outputSummary: generated.changed ? `商品 ${generated.product.title} 知识库已更新` : `商品 ${generated.product.title} 知识库内容未变化`, data: { productId, configVersion: generated.product.configVersion, changed: generated.changed, conversationCount: generated.conversationCount, messageCount: generated.messageCount } };
        }
        const updated = await this.deps.products.update({ adminId: input.adminId, productId, accountId: String(accountId), expectedConfigVersion: version, patch: { knowledgeBase }, requestId: input.requestId, traceId: input.traceId });
        return { resultSummary: `商品知识库已更新（v${updated.configVersion}）`, outputSummary: `商品 ${updated.title} 知识库已更新`, data: { productId, configVersion: updated.configVersion } };
      }
      const configRaw = fields.config ?? fields.automation;
      let config: unknown;
      try { config = configRaw ? JSON.parse(configRaw) : undefined; } catch { throw new ServiceError(422, 'VALIDATION_FAILED', '自动化规则必须是 JSON 对象'); }
      config ??= input.plan.manifest.config;
      if (!config) throw new ServiceError(422, 'VALIDATION_FAILED', '自动化规则配置不能为空');
      const updated = await this.deps.productAutomation.update({ adminId: input.adminId, productId, expectedConfigVersion: Number(input.plan.manifest.expectedConfigVersion ?? 1), config, requestId: input.requestId, traceId: input.traceId });
      return { resultSummary: `商品自动化规则已更新（v${updated.configVersion}）`, outputSummary: `商品 ${product.title} 自动化规则已更新`, data: { productId, configVersion: updated.configVersion, config: updated.config } };
    }
    if (typeof action === 'string' && action.startsWith('coupon_')) return this.confirmCoupon(input, action);
    if (action === 'order_deliver' || action === 'order_retry' || action === 'order_cancel') {
      const delivery = this.deps.orderDelivery;
      if (!delivery) throw new ServiceError(501, 'ORDER_DELIVERY_UNAVAILABLE', '订单交付能力未接入');
      const orderNo = String(input.plan.manifest.orderNo ?? '');
      const accountIdValue = String(accountId ?? input.run.accountId);
      if (!orderNo) throw new ServiceError(422, 'VALIDATION_FAILED', '订单号不能为空');
      if (action === 'order_cancel') {
        const cancelled = await delivery.cancel({ adminId: input.adminId, accountId: accountIdValue, orderNo, requestId: input.requestId, traceId: input.traceId });
        return { resultSummary: `订单 ${orderNo} 交付已取消`, outputSummary: `订单 ${orderNo} 的交付动作已取消`, data: { record: cancelled } };
      }
      const result = action === 'order_retry'
        ? await delivery.retry({ adminId: input.adminId, accountId: accountIdValue, orderNo, requestId: input.requestId, traceId: input.traceId, idempotencyKey: String(input.plan.manifest.idempotencyKey ?? `workspace-order:${accountIdValue}:${orderNo}:retry`) })
        : await delivery.deliver({ adminId: input.adminId, accountId: accountIdValue, orderNo, deliveryType: input.plan.manifest.deliveryType as OrderDeliveryType | undefined, trackingRef: typeof input.plan.manifest.trackingRef === 'string' ? input.plan.manifest.trackingRef : undefined, tradeText: typeof input.plan.manifest.tradeText === 'string' ? input.plan.manifest.tradeText : undefined, idempotencyKey: String(input.plan.manifest.idempotencyKey ?? `workspace-order:${accountIdValue}:${orderNo}:deliver`), requestId: input.requestId, traceId: input.traceId });
      return { resultSummary: `订单 ${orderNo} 交付${result.record.status === 'succeeded' ? '成功' : '已记录为 ' + result.record.status}`, outputSummary: `订单 ${orderNo} 交付状态：${result.record.status}`, data: { record: result.record, order: result.order } };
    }
    if (action === 'model_settings_update') {
      const configId = typeof input.plan.manifest.configId === 'string' ? input.plan.manifest.configId : undefined;
      const saved = await this.deps.openaiSettings.save({ adminId: input.adminId, accountId: String(accountId), configId, role: (String(input.plan.manifest.role ?? 'primary') as 'primary' | 'backup'), provider: String(input.plan.manifest.provider ?? ''), alias: String(input.plan.manifest.alias ?? input.plan.manifest.role ?? 'primary'), label: typeof input.plan.manifest.label === 'string' ? input.plan.manifest.label : undefined, baseUrl: String(input.plan.manifest.baseUrl ?? ''), model: String(input.plan.manifest.model ?? ''), wireApi: typeof input.plan.manifest.wireApi === 'string' ? input.plan.manifest.wireApi as never : undefined, timeoutMs: Number(input.plan.manifest.timeoutMs ?? 60_000), apiKey: fields.apiKey, expectedVersion: Number(input.plan.manifest.expectedVersion ?? 0) || undefined, requestId: input.requestId, traceId: input.traceId });
      return { resultSummary: `模型配置已保存（${saved.provider} / ${saved.model}）`, outputSummary: `模型配置已保存，API Key ${saved.apiKeyHint ?? '已配置'}`, data: { id: saved.id, provider: saved.provider, model: saved.model, apiKeyHint: saved.apiKeyHint } };
    }
    throw new ServiceError(422, 'VALIDATION_FAILED', `unsupported workspace action: ${String(action)}`);
  }

  async canExecuteProductPublish(input: { adminId: string; manifest: Record<string, unknown> }): Promise<boolean> {
    if (input.manifest.action !== 'product_publish') return false;
    const productId = String(input.manifest.productId ?? '');
    const accountId = String(input.manifest.accountId ?? '');
    if (!productId || !accountId) return false;
    const product = await this.deps.products.get(input.adminId, productId);
    if (product.accountId !== accountId || product.status === 'published') return false;
    return (await this.loadProductImages(product)).length > 0;
  }

  private async confirmProductPublish(input: { plan: NativeWorkspaceWritePlan; run: RunRecord; step: StepRecord; adminId: string; requestId: string; traceId: string }, accountId: string) {
    const productId = String(input.plan.manifest.productId ?? '');
    if (!productId) throw new ServiceError(422, 'VALIDATION_FAILED', 'productId is required');
    const product = await this.deps.products.get(input.adminId, productId);
    if (product.accountId !== accountId) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
    if (product.status === 'published' && product.externalProductRef) throw new ServiceError(409, 'CONFLICT', 'product is already published');
    const images = await this.loadProductImages(product);
    if (images.length === 0) throw new ServiceError(422, 'VALIDATION_FAILED', 'product publish requires at least one stored product image');
    const attrs = product.attributes?.publish && typeof product.attributes.publish === 'object' ? product.attributes.publish as Record<string, unknown> : {};
    const postageMode = normalizePostageMode(attrs.postageMode);
    const published = await this.deps.productPublisher.publish({
      adminId: input.adminId,
      accountId,
      title: product.title,
      description: product.description ?? product.title,
      categoryCode: product.categoryCode,
      priceMinor: Number(product.priceMinor ?? 0),
      originalPriceMinor: toOptionalInt(attrs.originalPriceMinor),
      postageMode,
      postageMinor: toOptionalInt(attrs.postageMinor),
      location: attrs.location && typeof attrs.location === 'object' ? attrs.location as never : undefined,
      images,
      requestId: input.requestId,
      traceId: input.traceId,
    });
    return {
      resultSummary: `商品“${published.product.title}”已发布到闲鱼`,
      outputSummary: `商品发布成功，闲鱼商品 ${published.itemId}`,
      data: { productId: published.product.id, itemId: published.itemId, itemUrl: published.itemUrl, imageCount: published.imageUrls.length, redacted: true },
    };
  }

  private async loadProductImages(product: Awaited<ReturnType<ProductService['get']>>): Promise<ProductPublishImageInput[]> {
    const assets = (product.assets ?? []).filter((asset) => asset.status === 'active');
    const output: ProductPublishImageInput[] = [];
    for (const asset of assets.slice(0, 9)) {
      const stored = this.deps.objectStorage ? await this.deps.objectStorage.getObject(asset.storageKey) : undefined;
      if (!stored) continue;
      output.push({ filename: asset.storageKey.split('/').pop() || asset.id, contentType: stored.contentType || asset.mimeType || 'application/octet-stream', data: stored.body });
    }
    return output;
  }

  private async confirmCoupon(input: { plan: NativeWorkspaceWritePlan; run: RunRecord; step: StepRecord; adminId: string; requestId: string; traceId: string }, action: string) {
    const batchId = String(input.plan.manifest.batchId);
    if (action === 'coupon_bind' || action === 'coupon_unbind') {
      const productId = String(input.plan.manifest.productId ?? '');
      if (!productId) throw new ServiceError(422, 'VALIDATION_FAILED', 'productId is required');
      const result = action === 'coupon_bind' ? await this.deps.coupons.bind({ adminId: input.adminId, batchId, productId, requestId: input.requestId, traceId: input.traceId }) : await this.deps.coupons.unbind({ adminId: input.adminId, batchId, productId, requestId: input.requestId, traceId: input.traceId });
      return { resultSummary: action === 'coupon_bind' ? '卡券已关联商品' : '卡券已解除商品关联', outputSummary: action === 'coupon_bind' ? '卡券商品关联已完成' : '卡券商品解绑已完成', data: result };
    }
    if (action === 'coupon_void') {
      const result = await this.deps.coupons.void({ adminId: input.adminId, batchId, requestId: input.requestId, traceId: input.traceId });
      return { resultSummary: '卡券批次已作废', outputSummary: '卡券批次已作废并保留历史', data: result };
    }
    if (action === 'coupon_enable' || action === 'coupon_disable') {
      const result = await this.deps.coupons.update({ adminId: input.adminId, batchId, patch: { status: action === 'coupon_enable' ? 'active' : 'paused' }, requestId: input.requestId, traceId: input.traceId });
      return { resultSummary: `卡券批次已${action === 'coupon_enable' ? '启用' : '禁用'}`, outputSummary: `卡券批次状态：${result.status}`, data: result };
    }
    if (action === 'coupon_copy') {
      const source = await this.deps.store.getCouponBatch(input.adminId, batchId);
      if (!source) throw new ServiceError(404, 'NOT_FOUND', 'coupon batch not found');
      const created = await this.deps.coupons.create({ adminId: input.adminId, accountId: source.accountId, label: `${source.label ?? source.sequenceId ?? batchId}（复制）`, purpose: source.purpose, metadata: source.metadata, requestId: input.requestId, traceId: input.traceId });
      const contents = (source.items ?? []).map((item) => item.content).filter(Boolean);
      if (contents.length) await this.deps.coupons.importItems({ adminId: input.adminId, batchId: String((created as Record<string, unknown>).batchId ?? ''), contents, requestId: input.requestId, traceId: input.traceId });
      return { resultSummary: `卡券批次已复制为 ${String((created as Record<string, unknown>).batchId ?? '')}`, outputSummary: '卡券复制完成', data: { created, copiedItemCount: contents.length } };
    }
    const patch = (input.plan.manifest.patch ?? {}) as Record<string, unknown>;
    const result = await this.deps.coupons.update({ adminId: input.adminId, batchId, patch: { label: typeof patch.label === 'string' ? patch.label : undefined, purpose: typeof patch.purpose === 'string' ? patch.purpose : undefined, status: typeof patch.status === 'string' ? patch.status as never : undefined }, requestId: input.requestId, traceId: input.traceId });
    return { resultSummary: '卡券批次已更新', outputSummary: '卡券批次更新完成', data: result };
  }

  private async resolveProductId(input: WorkspaceCommandInput, explicit?: string): Promise<string> {
    const extractedTitle = extractProductTitle(input.instruction);
    const productRef = explicit ?? extractedTitle ?? extractProductId(input.instruction) ?? extractId(input.instruction) ?? extractExternalProductRef(input.instruction);
    if (!productRef) throw new ServiceError(422, 'VALIDATION_FAILED', '商品 ID 或外部商品编号不能为空');
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(productRef)) {
      await this.deps.products.get(input.adminId, productRef);
      return productRef;
    }
    const productService = this.deps.products as ProductService & { list?: ProductService['list'] };
    if (typeof productService.list !== 'function') {
      await this.deps.products.get(input.adminId, productRef);
      return productRef;
    }
    const listed = await productService.list(input.adminId, { accountId: input.accountId, keyword: productRef, page: 1, pageSize: 20 });
    const normalizedRef = productRef.trim().toLocaleLowerCase();
    const matched = listed.items.find((product) => product.title.trim().toLocaleLowerCase() === normalizedRef)
      ?? listed.items.find((product) => product.id === productRef || product.externalProductRef === productRef)
      ?? (extractedTitle === productRef && listed.items.length === 1 ? listed.items[0] : undefined);
    if (!matched) throw new ServiceError(404, 'NOT_FOUND', `未找到商品 ${productRef}`);
    return matched.id;
  }

  private async searchProducts(input: WorkspaceCommandInput, query: string): Promise<Awaited<ReturnType<ProductService['list']>>> {
    const productService = this.deps.products as ProductService & { list?: ProductService['list'] };
    if (typeof productService.list !== 'function') throw new ServiceError(501, 'WORKSPACE_PRODUCT_SEARCH_UNAVAILABLE', '商品搜索能力未接入');
    return productService.list(input.adminId, { accountId: input.accountId, keyword: query, page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' });
  }

  private async currentProductVersion(adminId: string, productId: string): Promise<number> {
    return (await this.deps.products.get(adminId, productId)).configVersion;
  }

  private async currentProductAutomationVersion(adminId: string, productId: string): Promise<number> {
    return (await this.deps.productAutomation.get(adminId, productId)).configVersion;
  }

  private async accountsResult(input: WorkspaceCommandInput): Promise<WorkspaceCommandResult> {
    const result = await this.deps.accounts.list(input.adminId, { page: 1, pageSize: 100 });
    const items = result.items.map((item) => ({ id: item.id, displayName: item.displayName, sellerRef: item.sellerRef, platform: item.platform, status: item.status, updatedAt: item.updatedAt }));
    let health: DashboardSnapshot['health'] | undefined;
    try { health = (await this.deps.dashboard.getSnapshot(input.adminId, new Date(), { accountId: input.accountId })).health; } catch { /* account listing remains available when the dashboard projection is unavailable */ }
    return { kind: 'agent_activity', title: '账号与健康度', summary: `已读取 ${items.length} 个账号`, content: items.length ? items.map((item) => `${item.displayName ?? item.sellerRef} · ${item.platform} · ${item.status}`).join('\n') : '当前管理员暂无账号。', data: { items, currentAccountId: input.accountId, health, redacted: true } };
  }

  private async dashboardResult(input: WorkspaceCommandInput): Promise<WorkspaceCommandResult> {
    const snapshot = await this.deps.dashboard.getSnapshot(input.adminId, new Date(), { accountId: input.accountId, range: parseRange(input.instruction) });
    return { kind: 'agent_activity', title: '运营分析', summary: '已生成真实经营分析', content: formatDashboard(snapshot), data: { snapshot, recommendations: recommendations(snapshot) } };
  }

  private async orderDeliveryPreview(input: WorkspaceCommandInput, orderNo: string): Promise<WorkspaceCommandResult> {
    if (!this.deps.orderDelivery) {
      const order = await this.deps.orders.get({ adminId: input.adminId, orderNo, accountId: input.accountId });
      const checks: Array<{ code: string; status: 'pass' | 'blocked'; message: string }> = [];
      checks.push(order.paymentStatus === 'paid' ? { code: 'PAYMENT_PAID', status: 'pass', message: '订单已支付' } : { code: 'PAYMENT_NOT_PAID', status: 'blocked', message: '订单尚未支付' });
      checks.push(['requested', 'refunding', 'refunded'].includes(order.afterSalesStatus) ? { code: 'AFTER_SALES_BLOCKED', status: 'blocked', message: '订单处于售后/退款流程' } : { code: 'AFTER_SALES_CLEAR', status: 'pass', message: '订单无进行中的售后阻断' });
      const ready = checks.every((check) => check.status === 'pass');
      const preview = { orderNo: order.orderNo, accountId: order.accountId, deliveryType: order.deliveryType as OrderDeliveryType, state: ready ? 'ready' : 'blocked', checks, couponBatchIds: [], redacted: true };
      return { kind: 'orders', title: '订单交付预览', summary: ready ? `订单 ${order.orderNo} 可以进入交付确认` : `订单 ${order.orderNo} 暂不能交付`, content: ready ? `订单 ${order.orderNo} 已通过基础检查，可继续发货确认。` : `订单 ${order.orderNo} 暂不能发货：${checks.filter((check) => check.status === 'blocked').map((check) => check.message).join('；')}`, data: { preview } };
    }
    const preview = await this.deps.orderDelivery.preview({ adminId: input.adminId, accountId: input.accountId, orderNo });
    return { kind: 'orders', title: '订单交付预览', summary: preview.state === 'ready' ? `订单 ${preview.orderNo} 可以进入交付确认` : `订单 ${preview.orderNo} 暂不能交付`, content: preview.state === 'ready' ? `订单 ${preview.orderNo} 已通过支付、售后、商品与交付配置检查，可继续发货确认。` : `订单 ${preview.orderNo} 暂不能发货：${preview.checks.filter((check) => check.status === 'blocked').map((check) => check.message).join('；')}`, data: { preview } };
  }

  private plan(action: string, title: string, summary: string, expiresAt: string, manifest: Record<string, unknown>): NativeWorkspaceWritePlan {
    return { kind: action as NativeWorkspaceWritePlan['kind'], action: action as NativeWorkspaceWritePlan['action'], policyRef: `workspace.${action}.confirm`, title, summary, content: `已生成${title}。\n${summary}\n确认后将调用现有领域服务并写入审计。`, expiresAt, manifest: { ...manifest, action, requiresLocalExecution: true, redacted: true } };
  }
}

export function detectCommand(instruction: string): CommandKind | undefined {
  const value = instruction.toLowerCase();
  if (/(经营|运营分析|仪表盘|销售趋势|风险待办|订单趋势|异常|待处理|需要处理)/i.test(value)) return 'dashboard';
  if (/(商品|货架|库存|知识库|自动化规则|发货规则|改价|赠品|评价)/i.test(value) || /(?:搜索|查找|匹配).*(?:商品|产品)/i.test(value)) return 'products';
  if (/(卡券|卡密|优惠券|券批次)/i.test(value)) return 'coupons';
  if (/(订单|买家|付款|支付|发货|交付)/i.test(value)) return 'orders';
  if (/(agent|自动回复|智能客服|运行动态|工作流程|转人工)/i.test(value)) return /(配置|设置|修改|更新|启用|禁用|关闭)/i.test(value) ? 'agent_settings' : 'agent_activity';
  if (/(模型|provider|openai|兼容|base url|api key)/i.test(value)) return 'model_settings';
  if (/(账号|账户|店铺|登录态|连接状态)/i.test(value)) return 'accounts';
  return undefined;
}

function shouldDelegateNativeRead(instruction: string): boolean {
  const normalized = instruction.replace(/\s+/g, ' ').trim();
  if (requiresWorkspaceWrite(normalized) || !detectNativeWorkspaceRead(normalized)) return false;
  return /(当前账号|本账号|这个账号|最近|今天)/i.test(normalized);
}

function parseFields(input: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const part of input.split(/[;；\n]+/).map((item) => item.trim()).filter(Boolean)) {
    const match = part.match(/^(?:字段)?([\w\u4e00-\u9fa5-]+)\s*[:=：]\s*([\s\S]+)$/);
    if (match) output[normalizeField(match[1])] = match[2].trim();
  }
  return output;
}

function normalizeField(value: string): string {
  const key = value.toLowerCase();
  const map: Record<string, string> = { 商品: 'productId', 商品id: 'productId', product: 'productId', productid: 'productId', 批次: 'batchId', 卡券批次: 'batchId', batch: 'batchId', batchid: 'batchId', 知识库: 'knowledgeBase', 内容: 'content', 配置: 'config', 规则: 'config', 自动化: 'automation', 名称: 'label', 类型: 'purpose', 状态: 'status', 标题: 'title', 描述: 'description', 分类: 'categoryCode', 默认回复: 'defaultReplyTemplate', 价格: 'priceMinor', 页大小: 'pageSize', pagesize: 'pageSize', 最大页数: 'maxPages', maxpages: 'maxPages', provider: 'provider', 厂商: 'provider', 模型: 'model', baseurl: 'baseUrl', 'base url': 'baseUrl', 角色: 'role', wireapi: 'wireApi', api_key: 'apiKey', apikey: 'apiKey', 密钥: 'apiKey', 配置id: 'configId', configid: 'configId', 版本: 'expectedVersion', expectedversion: 'expectedVersion', 超时: 'timeoutMs', runid: 'runId', 'run id': 'runId', 订单号: 'orderNo', orderno: 'orderNo', 'order no': 'orderNo' };
  return map[key] ?? value;
}

function extractId(input: string): string | undefined { return input.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0] ?? input.match(/(?:\bID\b|编号)\s*[:：]?\s*([A-Za-z0-9_-]{4,})/i)?.[1]; }
function extractProductId(input: string): string | undefined { return input.match(/商品(?:ID|id)?\s*[:：]?\s*([A-Za-z0-9_-]{4,})/)?.[1]; }
function extractExternalProductRef(input: string): string | undefined { return input.match(/\b\d{6,20}\b/)?.[0]; }
function extractOrderNo(input: string): string | undefined { return input.match(/(?:订单号|order(?:\s*no)?)\s*[:：]?\s*([A-Za-z0-9_-]{4,})/i)?.[1] ?? input.match(/\b(XY|ORD|ORDER)[A-Za-z0-9_-]{3,}\b/i)?.[0]; }
function extractProductTitle(input: string): string | undefined {
  const named = input.match(/(?:商品名称|商品标题|标题)\s*[:：=]\s*[“"']?([^“”"'\n;；]+?)[”"']?(?=\s*(?:这个商品|的自动化|自动化规则|[;；]|$))/i)?.[1];
  const contextual = input.match(/(?:^|[\s,，])(?:帮我|请|麻烦|我要)?\s*(?:取消|关闭|停用|禁用|更新|修改|配置|设置|启用|查看|查询|搜索|查找)?\s*([^\n]+?)\s*这个商品(?:的)?\s*(?:自动化规则|自动化|规则)/i)?.[1];
  const value = (named ?? contextual)?.replace(/^[“"']|[”"']$/g, '').replace(/^(?:商品名称|商品标题|标题)\s*[:：=]\s*/i, '').replace(/[，,；;:：]+$/g, '').trim();
  return value || undefined;
}
function extractKeyword(input: string, prefixes: string[]): string | undefined { const stripped = prefixes.reduce((value, prefix) => value.replace(new RegExp(prefix, 'i'), ''), input).replace(/(?:关键词|关键字|keyword)\s*[:：]?\s*/i, '').trim(); return stripped && !/^(商品|订单|列表|查询|查看|列出|搜索|查找|匹配|状态|详情)$/i.test(stripped) ? stripped : undefined; }
function extractStatus(input: string): string | undefined { return input.match(/(?:状态|status)\s*[:：]?\s*([\w-]+)/i)?.[1]; }
function extractStatusToken(input: string, tokens: string[]): string | undefined { return tokens.find((token) => input.includes(token)); }
function normalizeProductStatus(value?: string): ProductRecord['status'] | undefined { return value && ['draft', 'ready', 'publishing', 'published', 'failed', 'archived'].includes(value) ? value as ProductRecord['status'] : undefined; }
function normalizePaymentStatus(value?: string): 'unpaid' | 'paid' | 'closed' | 'unknown' | undefined { if (!value) return undefined; if (/待付款|未付款|unpaid/i.test(value)) return 'unpaid'; if (/已付款|已支付|paid/i.test(value)) return 'paid'; if (/关闭|closed/i.test(value)) return 'closed'; if (/未知|unknown/i.test(value)) return 'unknown'; return undefined; }
function normalizeOrderStatus(value?: string): OrderRecord['orderStatus'] | undefined { return value && ['open', 'cancelling', 'cancelled', 'completed', 'closed', 'failed'].includes(value) ? value as OrderRecord['orderStatus'] : undefined; }
function normalizeDeliveryStatus(value?: string): OrderRecord['deliveryStatus'] | undefined { if (!value) return undefined; if (/待发货|pending/i.test(value)) return 'pending'; if (/待收货|已发货|delivered/i.test(value)) return 'delivered'; if (/失败|failed/i.test(value)) return 'failed'; if (/取消|cancelled/i.test(value)) return 'cancelled'; return undefined; }
function normalizeDeliveryType(value?: string): OrderDeliveryType | undefined {
  if (!value) return undefined;
  if (/免物流|no_logistics/i.test(value)) return 'no_logistics';
  if (/只发卡券|coupon_only/i.test(value)) return 'coupon_only';
  if (/混合|mixed/i.test(value)) return 'mixed';
  if (/人工|manual/i.test(value)) return 'manual';
  return undefined;
}
function normalizeAfterSalesStatus(value?: string): OrderRecord['afterSalesStatus'] | undefined { if (!value) return undefined; if (/退款中|refunding/i.test(value)) return 'refunding'; if (/已退款|refunded/i.test(value)) return 'refunded'; if (/申请|requested|售后/i.test(value)) return 'requested'; if (/关闭|closed/i.test(value)) return 'closed'; return value === 'none' ? 'none' : undefined; }
function safeProduct(product: ProductRecord): Record<string, unknown> { return { id: product.id, accountId: product.accountId, externalProductRef: product.externalProductRef, title: product.title, description: product.description, categoryCode: product.categoryCode, priceMinor: product.priceMinor, status: product.status, configVersion: product.configVersion, skuCount: product.skuCount ?? 0, assetCount: product.assetCount ?? 0, updatedAt: product.updatedAt, redacted: true }; }
function productListResult(items: ProductRecord[], total: number): WorkspaceCommandResult { const rows = items.map((item) => safeProduct(item)); return { kind: 'products', title: '商品查询', summary: `已读取 ${total} 个商品`, content: rows.length ? [`当前账号共有 ${total} 个商品：`, ...rows.map((item, index) => `${index + 1}. ${String(item.title)} · ${String(item.status)} · ${formatMoney(typeof item.priceMinor === 'number' ? item.priceMinor : undefined)}`)].join('\n') : '当前账号暂无匹配商品。', data: { total, items: rows } }; }
function orderListResult(items: OrderRecord[], total: number): WorkspaceCommandResult { const rows = items.map((item) => ({ orderNo: item.orderNo, itemTitle: item.itemTitle, amountMinor: item.amountMinor, paymentStatus: item.paymentStatus, orderStatus: item.orderStatus, deliveryStatus: item.deliveryStatus, afterSalesStatus: item.afterSalesStatus, createdAt: item.createdAt, updatedAt: item.updatedAt, redacted: true })); return { kind: 'orders', title: '订单查询', summary: `已读取 ${total} 个订单`, content: rows.length ? [`当前账号共有 ${total} 个订单：`, ...rows.map((item, index) => `${index + 1}. ${item.orderNo} · ${item.itemTitle} · 支付 ${item.paymentStatus} · 交付 ${item.deliveryStatus} · 售后 ${item.afterSalesStatus}`)].join('\n') : '当前账号暂无匹配订单。', data: { total, items: rows } }; }
function safeFieldNames(fields: Record<string, string>): string[] { return Object.keys(fields).filter((key) => key !== 'content' && key !== 'knowledgeBase' && key !== 'apiKey'); }
function productSearchContent(items: ProductRecord[], total: number): string { return items.length ? [`匹配到 ${total} 个商品：`, ...items.map((item, index) => `${index + 1}. ${item.title} · ${item.externalProductRef ?? item.id} · ${item.status}`)].join('\n') : '未匹配到商品。'; }
function stripNegatedWorkspaceClauses(instruction: string): string {
  // Model-generated read requests often repeat the write vocabulary in an
  // explicit safety clause (for example, “不要执行任何订单更新”). Those
  // terms describe what must not happen and must not route the request to a
  // mutation tool.
  return instruction.replace(/(?:仅执行只读查询|仅查询|只读|只查询|不(?:要|做|进行|执行)|无需|禁止)[^。！？\n；;]*(?=[。！？\n；;]|$)/gi, ' ');
}

function requiresWorkspaceWrite(instruction: string): boolean {
  const readNormalized = stripNegatedWorkspaceClauses(instruction).replace(/(?:未|待)发货/gi, '');
  return /(取消|关闭|停用|禁用|修改|更新|配置|设置|启用|删除|发布|发货|改价|赠品|评价|绑定|解绑)/i.test(readNormalized) && /(商品|自动化|规则|知识库|卡券|订单|发货)/i.test(readNormalized);
}
function requiresWorkspaceProductSearch(instruction: string): boolean {
  const normalized = instruction.replace(/\s+/g, ' ').trim();
  if (!/(商品|产品)/i.test(normalized) || !/(搜索|查找|匹配|按名称|按标题|商品名称|商品标题|外部商品编号)/i.test(normalized)) return false;
  if (/(列表|全部|所有|总数|分页)/i.test(normalized) && !/(按名称|按标题|商品名称|商品标题|外部商品编号)/i.test(normalized)) return false;
  return true;
}
function parseRange(input: string): 'today' | '3d' | '7d' | '1m' | undefined { if (/今天|今日/.test(input)) return 'today'; if (/3天|三天/.test(input)) return '3d'; if (/月|30天/.test(input)) return '1m'; if (/7天|一周|本周/.test(input)) return '7d'; return undefined; }
function formatDashboard(snapshot: DashboardSnapshot): string { return [`销售额 ${snapshot.totalSales.toFixed(2)}，选定区间销售额 ${snapshot.selectedRangeSales.toFixed(2)}`, `今日订单金额 ${snapshot.todayOrderAmount.toFixed(2)}，自动处理率 ${snapshot.autoProcessRate.toFixed(1)}%，待人工 ${snapshot.pendingManualCount}`, snapshot.riskTodos.length ? `风险待办：${snapshot.riskTodos.slice(0, 5).map((item) => item.title).join('；')}` : '当前无高优先级风险待办'].join('\n'); }
function formatMoney(valueMinor?: number): string { return typeof valueMinor === 'number' && Number.isFinite(valueMinor) ? `¥${(valueMinor / 100).toFixed(2)}` : '价格未设置'; }
function recommendations(snapshot: DashboardSnapshot): string[] { const items: string[] = []; if (snapshot.pendingManualCount > 0) items.push('优先处理待人工队列，避免已付款订单延迟交付。'); if (snapshot.autoProcessRate < 80) items.push('检查商品交付配置与自动化规则，提升自动处理率。'); if (snapshot.health.some((item) => item.tone === 'danger' || item.tone === 'warn')) items.push('先修复账号连接或卡券配置告警，再扩大自动化范围。'); if (items.length === 0) items.push('当前指标稳定，可继续观察订单趋势并维护知识库。'); return items; }
function formatAgentDetail(detail: { run: { id: string; status: string; stage?: string; decision?: string; failureCode?: string }; events?: Array<{ eventType: string; createdAt?: string }> }): string { const run = detail.run; const events = detail.events ?? []; return [`Run ${run.id} · 状态 ${run.status} · 阶段 ${run.stage ?? 'unknown'} · 决策 ${run.decision ?? 'unknown'}`, `事件 ${events.length} 条${events.length ? `：${events.slice(-6).map((event) => event.eventType).join('、')}` : ''}`, run.failureCode ? `失败原因：${run.failureCode}` : '当前未记录失败原因'].join('\n'); }
function normalizePostageMode(value: unknown): ProductPostageMode {
  return value === 'free' || value === 'distance' || value === 'fixed' || value === 'none' ? value : 'none';
}
function toOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
