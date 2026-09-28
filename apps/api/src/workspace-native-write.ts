import type { CouponBatchMetadata, ProductRecord, Store } from './domain.js';

export type NativeWorkspaceWriteKind = 'product_publish' | 'coupon_create';
export type NativeWorkspaceWriteAction = NativeWorkspaceWriteKind;

export interface NativeCouponCreateInput {
  label: string;
  purpose: 'text' | 'data' | 'api' | 'image';
  metadata: CouponBatchMetadata;
  items: string[];
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
const COUPON_CREATE_TERMS = /(新增卡券|创建卡券|新建卡券)/i;
const PURPOSES: Record<string, NativeCouponCreateInput['purpose']> = {
  text: 'text', data: 'data', api: 'api', image: 'image',
  '固定文字': 'text', '固定文本': 'text', '批量数据': 'data', '批量数据卡券': 'data', 'API接口': 'api', '接口': 'api', '图片': 'image',
};

export function detectNativeWorkspaceWrite(instruction: string): NativeWorkspaceWriteKind | undefined {
  const normalized = instruction.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (PRODUCT_PUBLISH_TERMS.test(normalized)) return 'product_publish';
  if (COUPON_CREATE_TERMS.test(normalized)) return 'coupon_create';
  return undefined;
}

export function sanitizeWorkspaceInstruction(instruction: string): string {
  return detectNativeWorkspaceWrite(instruction) === 'coupon_create'
    ? '已请求新增卡券（卡券正文将在确认后写入卡券域）'
    : instruction.slice(0, 2_000);
}

export function parseNativeWorkspaceCouponCreate(instruction: string): NativeCouponCreateInput | undefined {
  if (detectNativeWorkspaceWrite(instruction) !== 'coupon_create') return undefined;
  const normalized = instruction.replace(/\r/g, '').trim();
  const body = normalized.replace(COUPON_CREATE_TERMS, '').trim().replace(/^[:：\-\s]+/, '');
  const fields = parseFields(body);
  const purpose = resolvePurpose(fields.purpose, body);
  const label = (fields.label ?? inferLabel(body, fields)).trim().slice(0, 200) || 'Workspace 新建卡券';
  const metadata: CouponBatchMetadata = {};
  if (fields.description) metadata.description = fields.description.slice(0, 2_000);
  const delay = Number(fields.delaySeconds);
  if (Number.isFinite(delay)) metadata.delaySeconds = Math.max(0, Math.min(3_600, Math.trunc(delay)));

  if (purpose === 'text') metadata.textContent = fields.content ?? inferTrailingContent(body, fields);
  if (purpose === 'data') metadata.dataContent = fields.content ?? inferTrailingContent(body, fields);
  if (purpose === 'api') {
    const url = (fields.url ?? '').trim();
    if (url) metadata.apiConfig = { url, method: fields.method === 'POST' ? 'POST' : 'GET', responseField: fields.responseField?.trim() || undefined };
  }
  if (purpose === 'image') metadata.imageUrls = (fields.images ?? fields.content ?? '').split(/\s+/).map((value) => value.trim()).filter(Boolean).slice(0, 3);

  const items = purpose === 'data' ? splitDataContent(metadata.dataContent) : [];
  return { label, purpose, metadata, items };
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
    const match = segment.match(/^(名称|卡券名称|label|类型|purpose|卡券类型|内容|正文|固定文字|数据|dataContent|图片|imageUrls|接口|URL|url|请求方法|method|备注|description|延时发货时间|delaySeconds|响应取值字段|responseField)\s*[:=：]\s*([\s\S]*)$/i);
    if (!match) continue;
    const key = normalizeFieldKey(match[1]);
    fields[key] = match[2].trim();
  }
  return fields;
}

function normalizeFieldKey(key: string): string {
  const normalized = key.toLowerCase();
  if (['名称', '卡券名称', 'label'].includes(normalized)) return 'label';
  if (['类型', 'purpose', '卡券类型'].includes(normalized)) return 'purpose';
  if (['内容', '正文', '固定文字', '数据', 'datacontent'].includes(normalized)) return 'content';
  if (['图片', 'imageurls'].includes(normalized)) return 'images';
  if (['接口', 'url'].includes(normalized)) return 'url';
  if (['请求方法', 'method'].includes(normalized)) return 'method';
  if (['备注', 'description'].includes(normalized)) return 'description';
  if (['延时发货时间', 'delayseconds'].includes(normalized)) return 'delaySeconds';
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

function inferTrailingContent(body: string, fields: Record<string, string>): string {
  if (fields.content) return fields.content;
  const stripped = body.replace(COUPON_CREATE_TERMS, '').replace(/(?:名称|卡券名称|label|类型|purpose|卡券类型)\s*[:=：]\s*[^;；\n]+/gi, '').trim();
  return stripped.replace(/^[;；,，\s]+/, '').trim();
}

function splitDataContent(value?: string): string[] {
  return (value ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 1_000);
}

function productStatusLabel(status: string): string { return ({ draft: '草稿', ready: '待发布', publishing: '发布中', published: '已发布', failed: '发布失败', archived: '已归档' } as Record<string, string>)[status] ?? status; }
function couponPurposeLabel(purpose: NativeCouponCreateInput['purpose']): string { return ({ text: '固定文字', data: '批量数据', api: 'API 接口', image: '图片' })[purpose]; }
function formatMoney(valueMinor?: number): string { return typeof valueMinor === 'number' && Number.isFinite(valueMinor) ? `¥${(valueMinor / 100).toFixed(2)}` : '价格未设置'; }

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
