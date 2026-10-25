import type { VerificationRecoveryRequest } from './domain.js';

export interface XianyuReadRequest {
  kind: 'mtop_read';
  api: string;
  version: string;
  data: Record<string, unknown>;
  extraParams: Record<string, string>;
  referer: string;
}

// An API is replayable only after its read contract has been registered here.
// HTTP POST and names ending in get are not evidence that a call is read-only.
const READ_VERSIONS: Readonly<Record<string, string>> = {
  'mtop.taobao.idle.pc.detail': '1.0',
  'mtop.idle.web.xyh.item.list': '1.0',
  'mtop.taobao.idle.trade.merchant.sold.get': '1.0',
  'mtop.idle.web.trade.order.detail': '1.0',
  'mtop.taobao.idlemessage.pc.loginuser.get': '1.0',
  'mtop.idle.web.user.page.nav': '1.0',
  'mtop.taobao.idlemessage.pc.user.query': '4.0',
};
const EXTRA_KEYS = new Set(['spm_cnt', 'spm_pre', 'log_id', 'needLogin', 'ecode', 'valueType']);

export function isImVerificationSource(source: string): boolean {
  return ['mtop.taobao.idlemessage.pc.login.token', 'im', 'im_listener', 'im_read', 'im_send'].includes(source);
}

export function createVerificationReadRequest(api: string, version: string, data: Record<string, unknown>,
  extraParams: Record<string, string> = {}, referer?: string): XianyuReadRequest | undefined {
  if (!Object.hasOwn(READ_VERSIONS, api) || READ_VERSIONS[api] !== version) return undefined;
  try {
    const serialized = JSON.stringify(data);
    if (serialized.length > 8_192 || /"(?:cookie|accessToken|password|sign|token|authorization)"\s*:/i.test(serialized)) return undefined;
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    if (Object.entries(extraParams).some(([key, value]) => !EXTRA_KEYS.has(key) || typeof value !== 'string' || value.length > 512)) return undefined;
    const url = new URL(referer ?? (api === 'mtop.taobao.idle.trade.merchant.sold.get' || api === 'mtop.idle.web.trade.order.detail'
      ? 'https://seller.goofish.com/?site=COMMONPRO#/seller-trade/order-manage' : 'https://www.goofish.com/im'));
    if (url.protocol !== 'https:' || !['www.goofish.com', 'seller.goofish.com'].includes(url.hostname)
      || url.username || url.password || url.port || url.href.length > 2_048) return undefined;
    return { kind: 'mtop_read', api, version, data: parsed, extraParams: { ...extraParams }, referer: url.href };
  } catch { return undefined; }
}

/** Persisted JSON is untrusted, including records written by older releases. */
export function resolveVerificationReadRequest(source: string, request: VerificationRecoveryRequest | undefined): XianyuReadRequest | undefined {
  if (request?.kind === 'item_detail' && source === 'mtop.taobao.idle.pc.detail'
    && typeof request.itemId === 'string' && request.itemId.trim() && request.itemId.length <= 128) {
    return createVerificationReadRequest(source, '1.0', { itemId: request.itemId }, {},
      `https://www.goofish.com/item?id=${encodeURIComponent(request.itemId)}`);
  }
  if (request?.kind !== 'mtop_read' || request.api !== source) return undefined;
  return createVerificationReadRequest(request.api, request.version, request.data, request.extraParams, request.referer);
}
