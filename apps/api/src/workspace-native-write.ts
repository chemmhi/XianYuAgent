import type { ProductRecord, Store } from './domain.js';

export type NativeWorkspaceWriteKind = 'product_publish';

export interface NativeWorkspaceWritePlan {
  kind: NativeWorkspaceWriteKind;
  action: 'product_publish';
  policyRef: 'product.publish.confirm';
  title: string;
  summary: string;
  content: string;
  expiresAt: string;
  manifest: Record<string, unknown>;
}

const PRODUCT_PUBLISH_TERMS = /(发布商品|上架商品|发布一个商品|上架一个商品)/i;

export function detectNativeWorkspaceWrite(instruction: string): NativeWorkspaceWriteKind | undefined {
  const normalized = instruction.replace(/\s+/g, ' ').trim();
  return normalized && PRODUCT_PUBLISH_TERMS.test(normalized) ? 'product_publish' : undefined;
}

export async function prepareNativeWorkspaceWrite(input: { store: Store; adminId: string; accountId: string; instruction: string; now?: Date }): Promise<NativeWorkspaceWritePlan | undefined> {
  if (detectNativeWorkspaceWrite(input.instruction) !== 'product_publish') return undefined;
  if (!input.adminId || !(await input.store.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');

  const product = await resolveProduct(input.store, input.adminId, input.accountId, input.instruction);
  if (!product) throw new Error('WORKSPACE_PRODUCT_REQUIRED');
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
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
  return {
    kind: 'product_publish',
    action: 'product_publish',
    policyRef: 'product.publish.confirm',
    title: '商品发布确认',
    summary,
    content: `已生成商品发布确认卡。\n${summary}\n确认后会进入服务端 Outbox，等待外部发布 Worker 执行。`,
    expiresAt,
    manifest,
  };
}

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

function productStatusLabel(status: string): string { return ({ draft: '草稿', ready: '待发布', publishing: '发布中', published: '已发布', failed: '发布失败', archived: '已归档' } as Record<string, string>)[status] ?? status; }
function formatMoney(valueMinor?: number): string { return typeof valueMinor === 'number' && Number.isFinite(valueMinor) ? `¥${(valueMinor / 100).toFixed(2)}` : '价格未设置'; }
