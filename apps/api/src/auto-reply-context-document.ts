import type { AutoReplyClassification, AutoReplyContext } from './auto-reply.js';

export interface AutoReplyContextDocumentOptions {
  maxHistory: number;
  maxFieldLength: number;
  maxOrders: number;
}

/**
 * Render model-facing context as a compact document instead of JSON. Internal
 * identifiers are intentionally omitted; they are useful for routing and
 * observability, not for buyer-facing reply generation.
 */
export function formatAutoReplyContextDocument(
  context: AutoReplyContext,
  classification: AutoReplyClassification | undefined,
  options: AutoReplyContextDocumentOptions,
): string {
  const history = context.recentMessages
    .filter((message) => Boolean(message.bodyText?.trim()) || Boolean(message.bodyRef))
    .slice(-Math.max(1, options.maxHistory))
    .reverse();
  const lines = [
    '当前买家消息：',
    textValue(context.inboundMessage.bodyText, context.inboundMessage.bodyRef ? '[图片或附件]' : '[无文本]'),
  ];
  if (context.inboundMessage.bodyType !== 'text') lines.push(`当前消息类型：${textValue(context.inboundMessage.bodyType)}`);

  if (history.length > 0) {
    lines.push('', '已加载会话消息（最新在前）：');
    for (const message of history) {
      const role = message.senderRole === 'buyer' || message.direction === 'inbound' ? '买家' : '卖家';
      lines.push(`- ${role}：${textValue(trimField(message.bodyText, options.maxFieldLength), message.bodyRef ? '[图片或附件]' : '[无文本]')}`);
    }
  }

  if (classification?.riskFlags?.length) lines.push('', `风险标记：${classification.riskFlags.join('、')}`);

  const orders = context.orders.slice(0, Math.max(1, options.maxOrders));
  lines.push('', orders.length > 0 ? `已加载买家订单（${orders.length} 条）：` : '已加载买家订单：无');
  orders.forEach((order, index) => {
    lines.push(`- 订单${index + 1}：${textValue(order.itemTitle, '未提供商品')}｜支付${textValue(order.paymentStatus)}｜订单${textValue(order.orderStatus)}｜发货${textValue(order.deliveryStatus)}｜售后${textValue(order.afterSalesStatus)}`);
  });

  const product = context.product;
  if (product) {
    lines.push('', '商品事实：', `- 标题：${textValue(trimField(product.title, options.maxFieldLength))}`, `- 价格：${formatPrice(product.priceMinor)}`);
    appendOptionalLine(lines, '- 说明', trimField(product.description, options.maxFieldLength));
    appendOptionalLine(lines, '- 知识库', trimField(product.knowledgeBase, options.maxFieldLength));
    appendOptionalLine(lines, '- 回复模板', trimField(product.defaultReplyTemplate, options.maxFieldLength));
  } else {
    lines.push('', '商品事实：无');
  }
  return lines.join('\n');
}

function trimField(value: string | undefined, limit: number): string | undefined {
  const normalized = value?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > limit ? `${normalized.slice(0, Math.max(1, limit - 1)).trim()}…` : normalized;
}

function appendOptionalLine(lines: string[], label: string, value: string | undefined): void {
  if (value) lines.push(`${label}：${value}`);
}

function formatPrice(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value / 100).toFixed(2)}元` : '未提供';
}

function textValue(value: unknown, fallback = '未提供'): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}
