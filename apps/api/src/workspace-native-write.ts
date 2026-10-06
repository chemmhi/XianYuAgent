import type { AutoReplyAgentConfigPatch, CouponBatchMetadata, ProductRecord, Store } from './domain.js';

export type NativeWorkspaceWriteKind = 'product_publish' | 'product_update' | 'coupon_create' | 'agent_settings_update' | 'product_knowledge_update' | 'product_automation_update' | 'coupon_update' | 'coupon_enable' | 'coupon_disable' | 'coupon_bind' | 'coupon_unbind' | 'coupon_void' | 'coupon_copy' | 'model_settings_update';
export type NativeWorkspaceWriteAction = NativeWorkspaceWriteKind;

export interface NativeCouponCreateInput {
  label: string;
  purpose: 'text' | 'data' | 'api' | 'image';
  metadata: CouponBatchMetadata;
  items: string[];
}

export interface NativeAgentSettingsUpdateInput {
  patch: AutoReplyAgentConfigPatch;
  changes: Array<{ field: string; label: string; value: string | number | boolean }>;
}

export interface NativeWorkspaceWritePlan {
  kind: NativeWorkspaceWriteKind;
  action: NativeWorkspaceWriteAction;
  policyRef: string;
  title: string;
  summary: string;
  content: string;
  expiresAt: string;
  manifest: Record<string, unknown>;
}

const PRODUCT_PUBLISH_TERMS = /(发布商品|上架商品|发布一个商品|上架一个商品)/i;
// Natural-language requests may insert a quantity or a label between the
// create verb and “卡券”, e.g. “帮我新建一个测试卡券”. Keep intent detection
// broader than the exact phrase we strip while parsing.
const COUPON_CREATE_INTENT = /(?:新增|创建|新建)[^。！？!?\n]{0,24}卡券/i;
const COUPON_CREATE_TERMS = /(?:新增|创建|新建)\s*(?:一个|一张|一批|一份)?\s*/i;
const AGENT_SETTINGS_TERMS = /(自动回复(?:\s*Agent)?|Agent)/i;
const AGENT_SETTINGS_MUTATION_TERMS = /(修改|更新|调整|设置|配置|开启|启用|关闭|禁用|停用|打开)/i;
const PURPOSES: Record<string, NativeCouponCreateInput['purpose']> = {
  text: 'text', data: 'data', api: 'api', image: 'image',
  '固定文字': 'text', '固定文本': 'text', '批量数据': 'data', '批量数据卡券': 'data', 'API接口': 'api', '接口': 'api', '图片': 'image',
};

export function detectNativeWorkspaceWrite(instruction: string): NativeWorkspaceWriteKind | undefined {
  const normalized = instruction.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (PRODUCT_PUBLISH_TERMS.test(normalized)) return 'product_publish';
  if (COUPON_CREATE_INTENT.test(normalized) && !/(?:不要|无需|不需要|禁止)[^。！？!?\n]{0,8}(?:新增|创建|新建)[^。！？!?\n]{0,24}卡券/i.test(normalized)) return 'coupon_create';
  if (AGENT_SETTINGS_TERMS.test(normalized) && AGENT_SETTINGS_MUTATION_TERMS.test(normalized) && !/(查看|查询|读取|获取)/i.test(normalized)) return 'agent_settings_update';
  return undefined;
}

export function sanitizeWorkspaceInstruction(instruction: string): string {
  const kind = detectNativeWorkspaceWrite(instruction);
  if (kind === 'coupon_create' || /(卡券|卡密|优惠券).*(内容|正文|数据)/i.test(instruction)) return '已请求卡券操作（卡券正文将在确认后通过受控卡券域写入）';
  if (kind === 'agent_settings_update') return '已请求修改自动回复 Agent 配置（等待管理员确认）';
  return instruction
    .replace(/((?:api[_ -]?key|access[_ -]?token|cookie|密钥|令牌|token)\s*[:：=]\s*)[^;；\n\s]+/gi, '$1[REDACTED]')
    .slice(0, 2_000);
}

export function parseNativeWorkspaceCouponCreate(instruction: string): NativeCouponCreateInput | undefined {
  if (detectNativeWorkspaceWrite(instruction) !== 'coupon_create') return undefined;
  const normalized = instruction.replace(/\r/g, '').trim();
  const body = normalized.replace(/^(?:帮我|请帮我|请|麻烦|帮忙)\s*/i, '').replace(COUPON_CREATE_TERMS, '').trim().replace(/^[:：\-\s]+/, '');
  const fields = parseFields(body);
  const purpose = resolvePurpose(fields.purpose, body);
  const label = (fields.label ?? inferLabel(body, fields)).trim().slice(0, 200) || 'Workspace 新建卡券';
  const metadata: CouponBatchMetadata = {};
  if (fields.description) metadata.description = fields.description.slice(0, 2_000);
  const delay = Number(fields.delaySeconds);
  if (Number.isFinite(delay)) metadata.delaySeconds = Math.max(0, Math.min(3_600, Math.trunc(delay)));
  const useNoLogisticsForm = parseCouponBoolean(fields.useNoLogisticsForm);
  if (useNoLogisticsForm !== undefined) metadata.useNoLogisticsForm = useNoLogisticsForm;
  if (fields.feePayer === 'distributor' || fields.feePayer === 'dealer') metadata.feePayer = fields.feePayer;
  if (fields.minPrice?.trim()) metadata.minPrice = fields.minPrice.trim();
  if (fields.dockVisibility === 'public' || fields.dockVisibility === 'dealer_only') metadata.dockVisibility = fields.dockVisibility;
  const multiSpec = parseCouponBoolean(fields.multiSpec);
  if (multiSpec !== undefined) metadata.multiSpec = multiSpec;
  if (fields.specName?.trim()) metadata.specName = fields.specName.trim();
  if (fields.specValue?.trim()) metadata.specValue = fields.specValue.trim();

  if (purpose === 'text') metadata.textContent = fields.content ?? inferTrailingContent(body, fields, label);
  if (purpose === 'data') metadata.dataContent = fields.content ?? inferTrailingContent(body, fields, label);
  if (purpose === 'api') {
    const url = (fields.url ?? '').trim();
    const timeout = Number(fields.apiTimeout);
    if (url) {
      metadata.apiConfig = {
        url,
        method: fields.method === 'POST' ? 'POST' : 'GET',
        timeout: Number.isFinite(timeout) ? Math.max(1, Math.min(3_600, Math.trunc(timeout))) : undefined,
        headers: fields.apiHeaders?.trim() || undefined,
        params: fields.apiParams?.trim() || undefined,
        responseField: fields.responseField?.trim() || undefined,
      };
    }
  }
  if (purpose === 'image') metadata.imageUrls = (fields.images ?? fields.content ?? '').split(/\s+/).map((value) => value.trim()).filter(Boolean).slice(0, 3);

  const items = purpose === 'data' ? splitDataContent(metadata.dataContent) : [];
  return { label, purpose, metadata, items };
}

export function parseNativeWorkspaceAgentSettingsUpdate(instruction: string): NativeAgentSettingsUpdateInput | undefined {
  if (detectNativeWorkspaceWrite(instruction) !== 'agent_settings_update') return undefined;
  const normalized = instruction.replace(/\r/g, '').trim();
  const body = normalized.replace(AGENT_SETTINGS_TERMS, '').trim().replace(/^[:：\-\s]+/, '');
  const fields = parseAgentFields(body);
  const patch: AutoReplyAgentConfigPatch = {};
  const changes: Array<{ field: string; label: string; value: string | number | boolean }> = [];
  for (const [key, raw] of Object.entries(fields)) {
    const parsed = parseAgentField(key, raw);
    if (!parsed) continue;
    patch[parsed.field] = parsed.value as never;
    changes.push({ field: parsed.field, label: parsed.label, value: parsed.value });
  }
  if (!Object.keys(patch).length) {
    if (/(关闭|禁用|停用)/i.test(normalized)) { patch.enabled = false; changes.push({ field: 'enabled', label: '自动回复', value: false }); }
    else if (/(开启|启用|打开)/i.test(normalized)) { patch.enabled = true; changes.push({ field: 'enabled', label: '自动回复', value: true }); }
  }
  if (!Object.keys(patch).length) return undefined;
  return { patch, changes };
}

export async function prepareNativeWorkspaceWrite(input: { store: Store; adminId: string; accountId: string; instruction: string; now?: Date }): Promise<NativeWorkspaceWritePlan | undefined> {
  const kind = detectNativeWorkspaceWrite(input.instruction);
  if (!kind) return undefined;
  if (!input.adminId || !(await input.store.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();

  if (kind === 'product_publish') {
    const product = await resolveProduct(input.store, input.adminId, input.accountId, input.instruction);
    if (!product) throw new Error('WORKSPACE_PRODUCT_REQUIRED');
    const manifest = {
      action: 'product_publish',
      productId: product.id,
      accountId: product.accountId,
      title: product.title,
      status: product.status,
      priceMinor: product.priceMinor,
      categoryCode: product.categoryCode,
      externalProductRef: product.externalProductRef,
      requiresExternalExecution: true,
      redacted: true,
    } satisfies Record<string, unknown>;
    const summary = `准备发布商品“${product.title}”（当前状态：${productStatusLabel(product.status)}，价格：${formatMoney(product.priceMinor)}）`;
    return { kind, action: 'product_publish', policyRef: 'product.publish.confirm', title: '商品发布确认', summary, content: `已生成商品发布确认卡。\n${summary}\n确认后会进入服务端 Outbox，等待外部发布 Worker 执行。`, expiresAt, manifest };
  }

  if (kind === 'agent_settings_update') {
    const settings = parseNativeWorkspaceAgentSettingsUpdate(input.instruction);
    if (!settings) throw new Error('WORKSPACE_AGENT_SETTINGS_REQUIRED');
    const current = await input.store.getAutoReplyAgentConfig(input.adminId, input.accountId);
    const expectedVersion = current?.configVersion ?? 0;
    const summary = `准备修改自动回复 Agent 配置（${settings.changes.map((change) => `${change.label}：${formatAgentValue(change.value)}`).join('、')}）`;
    const manifest = {
      action: 'agent_settings_update',
      accountId: input.accountId,
      expectedVersion,
      changes: settings.changes,
      changedFields: settings.changes.map((change) => change.field),
      requiresLocalExecution: true,
      redacted: true,
    } satisfies Record<string, unknown>;
    return {
      kind,
      action: 'agent_settings_update',
      policyRef: 'agent.settings.update.confirm',
      title: '自动回复 Agent 配置确认',
      summary,
      content: `已生成自动回复 Agent 配置确认卡。\n${summary}\n确认后会写入当前账号配置；Prompt 原文和凭证不会显示在 Workspace 消息或确认卡中。`,
      expiresAt,
      manifest,
    };
  }

  const coupon = parseNativeWorkspaceCouponCreate(input.instruction);
  if (!coupon) throw new Error('WORKSPACE_COUPON_REQUIRED');
  const configured = coupon.purpose === 'api' ? Boolean(coupon.metadata.apiConfig?.url) : coupon.purpose === 'image' ? Boolean(coupon.metadata.imageUrls?.length) : Boolean(coupon.metadata.textContent || coupon.metadata.dataContent);
  const count = coupon.purpose === 'data' ? coupon.items.length : configured ? 1 : 0;
  const summary = `准备新增卡券“${coupon.label}”（类型：${couponPurposeLabel(coupon.purpose)}，${count > 0 ? `已配置 ${count} 项` : '待填写内容'}）`;
  const manifest = {
    action: 'coupon_create',
    accountId: input.accountId,
    title: coupon.label,
    label: coupon.label,
    purpose: coupon.purpose,
    itemCount: coupon.items.length,
    configured,
    requiresLocalExecution: true,
    redacted: true,
  } satisfies Record<string, unknown>;
  return {
    kind,
    action: 'coupon_create',
    policyRef: 'coupon.create.confirm',
    title: '新增卡券确认',
    summary,
    content: `已生成新增卡券确认卡。\n${summary}\n确认后会写入当前账号的卡券批次；卡券正文不会显示在 Workspace 消息或确认卡中。`,
    expiresAt,
    manifest,
  };
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const segment of body.split(/[;；]+/).map((item) => item.trim()).filter(Boolean)) {
    const match = segment.match(/^(名称|卡券名称|label|类型|purpose|卡券类型|内容|正文|固定文字|数据|dataContent|图片|imageUrls|接口|URL|url|请求方法|method|超时时间|timeout|apiTimeout|请求头|headers|请求参数|params|备注|description|延时发货时间|delaySeconds|无须填写凭证|无需填写凭证|useNoLogisticsForm|费用承担|feePayer|最低售价|minPrice|投放可见性|dockVisibility|多规格|multiSpec|规格名称|specName|规格值|specValue|响应取值字段|responseField)\s*[:=：]\s*([\s\S]*)$/i);
    if (!match) continue;
    const key = normalizeFieldKey(match[1]);
    fields[key] = match[2].trim();
  }
  return fields;
}

function parseAgentFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const segment of body.split(/[;；]+/).map((item) => item.trim()).filter(Boolean)) {
    const match = segment.match(/^(启用|开启|停用|禁用|关闭|打开|enabled|最大循环次数|循环次数|maxLoops|工具调用上限|maxToolCalls|工具超时|toolTimeoutMs|总超时|totalTimeoutMs|上下文历史条数|maxHistory|最大回复长度|maxReplyLength|分段发送间隔|replySegmentDelayMs|自动回复接管等待时间|发送延迟|sendDelaySeconds|发送模式|sendMode)\s*[:=：]?\s*([\s\S]*)$/i);
    if (!match) continue;
    fields[normalizeAgentFieldKey(match[1])] = match[2].trim();
  }
  return fields;
}

function normalizeAgentFieldKey(key: string): string {
  const normalized = key.toLowerCase();
  if (['启用', '开启', '停用', '禁用', '关闭', '打开', 'enabled'].includes(normalized)) return 'enabled';
  if (['最大循环次数', '循环次数', 'maxloops'].includes(normalized)) return 'maxLoops';
  if (['工具调用上限', 'maxtoolcalls'].includes(normalized)) return 'maxToolCalls';
  if (['工具超时', 'tooltimeoutms'].includes(normalized)) return 'toolTimeoutMs';
  if (['总超时', 'totaltimeoutms'].includes(normalized)) return 'totalTimeoutMs';
  if (['上下文历史条数', 'maxhistory'].includes(normalized)) return 'maxHistory';
  if (['最大回复长度', 'maxreplylength'].includes(normalized)) return 'maxReplyLength';
  if (['分段发送间隔', 'replysegmentdelayms'].includes(normalized)) return 'replySegmentDelayMs';
  if (['自动回复接管等待时间', '发送延迟', 'senddelayseconds'].includes(normalized)) return 'sendDelaySeconds';
  if (['发送模式', 'sendmode'].includes(normalized)) return 'sendMode';
  return normalized;
}

function parseAgentField(field: string, raw: string): { field: keyof AutoReplyAgentConfigPatch; label: string; value: string | number | boolean } | undefined {
  if (field === 'enabled') {
    const value = parseAgentBoolean(raw);
    return value === undefined ? undefined : { field, label: '自动回复', value };
  }
  if (field === 'sendMode') {
    const value = /^(live|真实发送|实时发送)$/i.test(raw) ? 'live' : /^(simulate|模拟发送)$/i.test(raw) ? 'simulate' : undefined;
    return value ? { field, label: '发送模式', value } : undefined;
  }
  const numbers: Record<string, { label: string; min: number; max: number; multiplier?: number }> = {
    maxLoops: { label: '最大循环次数', min: 1, max: 12 },
    maxToolCalls: { label: '工具调用上限', min: 1, max: 32 },
    toolTimeoutMs: { label: '工具超时（毫秒）', min: 100, max: 120_000 },
    totalTimeoutMs: { label: '总超时（毫秒）', min: 1_000, max: 300_000 },
    maxHistory: { label: '上下文历史条数', min: 0, max: 100 },
    maxReplyLength: { label: '最大回复长度', min: 30, max: 4_000 },
    replySegmentDelayMs: { label: '分段发送间隔（毫秒）', min: 0, max: 30_000 },
    sendDelaySeconds: { label: '自动回复接管等待时间（秒）', min: 0, max: 86_400, multiplier: /毫秒|ms/i.test(raw) ? 0.001 : 1 },
  };
  const definition = numbers[field];
  if (!definition) return undefined;
  const numeric = Number(raw.replace(/毫秒|ms|秒|s/gi, '').trim()) * (definition.multiplier ?? 1);
  if (!Number.isInteger(numeric) || numeric < definition.min || numeric > definition.max) return undefined;
  return { field: field as keyof AutoReplyAgentConfigPatch, label: definition.label, value: numeric };
}

function parseAgentBoolean(value: string): boolean | undefined {
  if (/^(true|1|yes|on|是|启用|开启|打开)$/i.test(value)) return true;
  if (/^(false|0|no|off|否|停用|禁用|关闭)$/i.test(value)) return false;
  return undefined;
}

function parseCouponBoolean(value?: string): boolean | undefined {
  if (!value) return undefined;
  if (/^(true|1|yes|on|是|启用|开启|打开)$/i.test(value.trim())) return true;
  if (/^(false|0|no|off|否|停用|禁用|关闭)$/i.test(value.trim())) return false;
  return undefined;
}

function normalizeFieldKey(key: string): string {
  const normalized = key.toLowerCase();
  if (['名称', '卡券名称', 'label'].includes(normalized)) return 'label';
  if (['类型', 'purpose', '卡券类型'].includes(normalized)) return 'purpose';
  if (['内容', '正文', '固定文字', '数据', 'datacontent'].includes(normalized)) return 'content';
  if (['图片', 'imageurls'].includes(normalized)) return 'images';
  if (['接口', 'url'].includes(normalized)) return 'url';
  if (['请求方法', 'method'].includes(normalized)) return 'method';
  if (['超时时间', 'timeout', 'apitimeout'].includes(normalized)) return 'apiTimeout';
  if (['请求头', 'headers'].includes(normalized)) return 'apiHeaders';
  if (['请求参数', 'params'].includes(normalized)) return 'apiParams';
  if (['备注', 'description'].includes(normalized)) return 'description';
  if (['延时发货时间', 'delayseconds'].includes(normalized)) return 'delaySeconds';
  if (['无须填写凭证', '无需填写凭证', '无需邮寄', 'usenologisticsform'].includes(normalized)) return 'useNoLogisticsForm';
  if (['费用承担', 'feepayer'].includes(normalized)) return 'feePayer';
  if (['最低售价', 'minprice'].includes(normalized)) return 'minPrice';
  if (['投放可见性', 'dockvisibility'].includes(normalized)) return 'dockVisibility';
  if (['多规格', 'multispec'].includes(normalized)) return 'multiSpec';
  if (['规格名称', 'specname'].includes(normalized)) return 'specName';
  if (['规格值', 'specvalue'].includes(normalized)) return 'specValue';
  if (['响应取值字段', 'responsefield'].includes(normalized)) return 'responseField';
  return normalized;
}

function resolvePurpose(value: string | undefined, body: string): NativeCouponCreateInput['purpose'] {
  if (value) {
    const key = Object.keys(PURPOSES).find((candidate) => candidate.toLowerCase() === value.trim().toLowerCase());
    if (key) return PURPOSES[key]!;
  }
  const matched = body.match(/(?:类型|purpose|卡券类型)\s*[:=：]?\s*(固定文字|固定文本|批量数据|API接口|接口|图片|text|data|api|image)/i);
  if (matched) return PURPOSES[matched[1]!] ?? 'text';
  return 'text';
}

function inferLabel(body: string, fields: Record<string, string>): string {
  if (fields.label) return fields.label;
  const first = body.split(/[;；\n]+/)[0]?.trim() ?? '';
  if (!first || /^(类型|purpose|卡券类型|内容|正文|固定文字|数据|接口|图片)\s*[:=：]/i.test(first)) return '';
  return first.replace(/^(名称|卡券名称)\s*[:=：]\s*/i, '');
}

function inferTrailingContent(body: string, fields: Record<string, string>, label?: string): string {
  if (fields.content) return fields.content;
  const stripped = body.replace(COUPON_CREATE_TERMS, '').replace(/(?:名称|卡券名称|label|类型|purpose|卡券类型)\s*[:=：]\s*[^;；\n]+/gi, '').trim();
  if (label && stripped === label) return '';
  return stripped.replace(/^[;；,，\s]+/, '').trim();
}

function splitDataContent(value?: string): string[] {
  return (value ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 1_000);
}

function productStatusLabel(status: string): string { return ({ draft: '草稿', ready: '待发布', publishing: '发布中', published: '已发布', failed: '发布失败', archived: '已归档' } as Record<string, string>)[status] ?? status; }
function couponPurposeLabel(purpose: NativeCouponCreateInput['purpose']): string { return ({ text: '固定文字', data: '批量数据', api: 'API 接口', image: '图片' })[purpose]; }
function formatMoney(valueMinor?: number): string { return typeof valueMinor === 'number' && Number.isFinite(valueMinor) ? `¥${(valueMinor / 100).toFixed(2)}` : '价格未设置'; }
function formatAgentValue(value: string | number | boolean): string { return typeof value === 'boolean' ? (value ? '启用' : '停用') : typeof value === 'number' ? String(value) : value === 'live' ? '真实发送' : value === 'simulate' ? '模拟发送' : value; }

async function resolveProduct(store: Store, adminId: string, accountId: string, instruction: string): Promise<ProductRecord | undefined> {
  const candidates = instruction.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i) ?? [];
  const requestedId = candidates[0];
  if (requestedId) {
    const product = await store.getProduct(adminId, requestedId);
    if (!product || product.accountId !== accountId) throw new Error('WORKSPACE_PRODUCT_NOT_FOUND');
    return product;
  }
  const result = await store.listProducts(adminId, { accountId, page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' });
  const keyword = instruction.replace(PRODUCT_PUBLISH_TERMS, '').trim();
  if (keyword) {
    const matched = result.items.find((item) => item.title.includes(keyword) || item.externalProductRef === keyword);
    if (matched) return matched;
  }
  if (result.items.length === 1) return result.items[0];
  return result.items.find((item) => item.status === 'draft' || item.status === 'ready');
}
