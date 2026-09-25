/**
 * The IM gateway sometimes exposes order/status notices as plain text inside
 * the legacy chat envelope. Those notices remain visible in history but must
 * never enter the buyer-facing auto-reply pipeline.
 */
export function isXianyuSystemMessageText(value: string | undefined): boolean {
  const normalized = value?.replace(/\s+/gu, ' ').trim();
  if (!normalized) return false;

  const statusText = unwrapStatusText(normalized);
  return /^(?:我已拍下|我已付款|我已支付|买家已拍下|买家已付款|买家已支付|已付款|已支付|已拍下)[，,、:：\s].*(?:待付款|等待发货|待发货|等待你发货|等待您发货)$/u.test(statusText)
    || /^(?:已确认收货|已评价|评价完成|交易成功|交易关闭|退款成功|退款关闭)[。！!]?$/.test(statusText);
}

function unwrapStatusText(value: string): string {
  const pairs: Array<[string, string]> = [['[', ']'], ['【', '】'], ['（', '）'], ['(', ')']];
  for (const [left, right] of pairs) {
    if (value.startsWith(left) && value.endsWith(right)) return value.slice(left.length, -right.length).trim();
  }
  return value;
}
