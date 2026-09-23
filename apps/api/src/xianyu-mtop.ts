import crypto from 'node:crypto';
import type { ProductSyncPageResult, XianyuOrderItem } from './domain.js';
import { mapXianyuProductPage } from './xianyu-product-mapper.js';
import { mapXianyuOrderPage, type XianyuOrderPageResult } from './xianyu-order-mapper.js';
import { mapXianyuItemDetail, type XianyuItemDetailSummary } from './xianyu-item-detail-mapper.js';
import {
  applySetCookies,
  cookieHeaderForSigning,
  cookieHeaderForUrl,
  cookieHeaderFromSnapshot,
  cookieSnapshotFromMetadata,
  metadataWithCookieSnapshot,
  setCookieValues,
  XIANYU_TOP_SITE,
  type XianyuCookieSnapshot,
} from './xianyu-cookie-jar.js';

const APP_KEY = '34839810';
export const XIANYU_IM_APP_KEY = '444e9908a51d1cb236a27862abc769c9';
const BASE_URL = 'https://h5api.m.goofish.com/h5';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const SOLD_ORDERS_API = 'mtop.taobao.idle.trade.merchant.sold.get';
const SOLD_ORDERS_REFERER = 'https://seller.goofish.com/?site=COMMONPRO#/seller-trade/order-manage';
const SELLER_ORDER_MANAGE_REFERER = SOLD_ORDERS_REFERER;
const CONSIGN_API = 'mtop.taobao.idle.logistic.consign.dummy';
const ADJUST_PRICE_API = 'mtop.taobao.idle.trade.user.adjust.price';
const ORDER_DETAIL_API = 'mtop.idle.web.trade.order.detail';
const DEFAULT_SOLD_ORDER_PAGE_SIZE = 30;

export interface MtopCredential { cookieHeader?: string; deviceId?: string; metadata?: Record<string, string>; }

export interface MtopResult {
  success: boolean;
  accountInvalid: boolean;
  errorCode?: string;
  message?: string;
  response?: Record<string, unknown>;
  cookieHeader: string;
}

export interface XianyuItemsPageResult extends MtopResult, ProductSyncPageResult {}
export interface XianyuOrdersPageResult extends MtopResult, XianyuOrderPageResult {}
export interface XianyuItemDetailResult extends MtopResult { summary: XianyuItemDetailSummary; }

export type XianyuExternalMutationStatus = 'succeeded' | 'failed' | 'unknown';

export interface XianyuExternalMutationResult {
  status: XianyuExternalMutationStatus;
  externalRef?: string;
  errorCode?: string;
  message?: string;
  response?: Record<string, unknown>;
  cookieHeader: string;
}

export interface XianyuOrderDetailSummary {
  orderNo: string;
  quantity?: number;
  skuSpec?: string;
  amountMinor?: number;
  orderStatus?: string;
  paymentStatus?: string;
  deliveryStatus?: string;
  buyerId?: string;
  conversationId?: string;
  itemId?: string;
  itemTitle?: string;
  reviewedAt?: string;
}

export interface XianyuOrderDetailResult extends MtopResult {
  detail?: XianyuOrderDetailSummary;
}

export interface XianyuItemDetailOptions {
  categoryId?: string | number;
  spmPre?: string;
  logId?: string;
  referer?: string;
}

interface MtopRequestOptions { referer?: string; }

export interface XianyuChatImageUploadResult {
  success: boolean;
  accountInvalid: boolean;
  errorCode?: string;
  message?: string;
  url?: string;
  width?: number;
  height?: number;
  cookieHeader: string;
}

export interface XianyuMtopClientOptions {
  timeoutMs?: number;
  loadCredential: (adminId: string, accountId: string) => Promise<MtopCredential | undefined>;
  saveCookie: (adminId: string, accountId: string, cookieHeader: string, metadata?: Record<string, string>) => Promise<void>;
  onFailure?: (input: { adminId: string; accountId: string; api: string; errorCode?: string; message?: string; accountInvalid: boolean }) => Promise<void> | void;
}

export class XianyuMtopClient {
  private readonly timeoutMs: number;
  private readonly loadCredential: XianyuMtopClientOptions['loadCredential'];
  private readonly saveCookie: XianyuMtopClientOptions['saveCookie'];
  private readonly onFailure?: XianyuMtopClientOptions['onFailure'];

  constructor(options: XianyuMtopClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.loadCredential = options.loadCredential;
    this.saveCookie = options.saveCookie;
    this.onFailure = options.onFailure;
  }

  private reportFailure(input: { adminId: string; accountId: string; api: string; errorCode?: string; message?: string; accountInvalid: boolean }): void {
    try {
      const { adminId, accountId, api, errorCode, message, accountInvalid } = input;
      const result = this.onFailure?.({ adminId, accountId, api, errorCode, message, accountInvalid });
      if (result && typeof (result as PromiseLike<void>).then === 'function') void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Failure reporting must never mask the original external error.
    }
  }

  async verifyLogin(adminId: string, accountId: string): Promise<MtopResult> {
    return this.call(adminId, accountId, 'mtop.taobao.idlemessage.pc.loginuser.get', '1.0', {}, { spm_cnt: 'a21ybx.im.0.0', needLogin: 'false' });
  }

  async fetchImToken(adminId: string, accountId: string, deviceId: string): Promise<{ success: boolean; accountInvalid: boolean; errorCode?: string; message?: string; accessToken?: string; cookieHeader: string }> {
    const result = await this.call(adminId, accountId, 'mtop.taobao.idlemessage.pc.login.token', '1.0', { appKey: XIANYU_IM_APP_KEY, deviceId }, { spm_cnt: 'a21ybx.im.0.0', spm_pre: 'a21ybx.item.want.1.14ad3da6ALVq3n', log_id: '14ad3da6ALVq3n' });
    const accessToken = nestedString(result.response, ['data', 'accessToken']);
    if (!result.success || !accessToken) {
      const failure = { success: false, accountInvalid: result.accountInvalid, errorCode: result.errorCode ?? 'IM_TOKEN_MISSING', message: result.message ?? 'unable to obtain im token', cookieHeader: result.cookieHeader };
      if (result.success) this.reportFailure({ adminId, accountId, api: 'mtop.taobao.idlemessage.pc.login.token', ...failure });
      return failure;
    }
    return { success: true, accountInvalid: false, accessToken, cookieHeader: result.cookieHeader };
  }

  async fetchProfile(adminId: string, accountId: string): Promise<MtopResult> {
    return this.call(adminId, accountId, 'mtop.idle.web.user.page.nav', '1.0', {}, { spm_cnt: 'a21ybx.home.0.0', ecode: '0' });
  }

  async fetchChatUserInfo(adminId: string, accountId: string, sessionId: string): Promise<{ success: boolean; accountInvalid: boolean; errorCode?: string; message?: string; buyerDisplayName?: string; buyerAvatarUrl?: string }> {
    const normalizedSessionId = sessionId.replace(/@goofish$/, '');
    const result = await this.call(adminId, accountId, 'mtop.taobao.idlemessage.pc.user.query', '4.0', { type: 0, sessionType: 1, sessionId: normalizedSessionId, isOwner: false });
    const data = recordAt(result.response, ['data']);
    // The web endpoint has returned both `userInfo` and `user` wrappers in
    // different sessions. Keep the adapter tolerant so a valid identity does
    // not disappear just because the envelope changed slightly.
    const userInfo = record(data.userInfo ?? data.user ?? data.profile ?? result.response);
    return { success: result.success, accountInvalid: result.accountInvalid, errorCode: result.errorCode, message: result.message, buyerDisplayName: stringAt(userInfo, ['fishNick', 'nick', 'nickname', 'userNick', 'displayName']), buyerAvatarUrl: stringAt(userInfo, ['logo', 'avatar', 'avatarUrl', 'headPic', 'userAvatar']) };
  }

  async uploadChatImage(adminId: string, accountId: string, filename: string, contentType: string, data: Buffer): Promise<XianyuChatImageUploadResult> {
    const firstAttempt = await this.uploadChatImageOnce(adminId, accountId, filename, contentType, data);
    if (firstAttempt.success) return firstAttempt;
    if (firstAttempt.errorCode !== 'SESSION_EXPIRED') {
      this.reportFailure({ adminId, accountId, api: 'stream-upload.goofish.com/api/upload.api', ...firstAttempt });
      return firstAttempt;
    }

    // The IM WebSocket can remain connected after the browser-side MTOP
    // session expires. Re-run the IM token flow so MTOP can rotate the
    // persisted Cookie snapshot, then retry the upload with that cookie.
    const credential = await this.loadCredential(adminId, accountId);
    const refreshed = await this.fetchImToken(adminId, accountId, credential?.deviceId ?? `xianyu-${accountId}`);
    if (!refreshed.success) return firstAttempt;
    const finalAttempt = await this.uploadChatImageOnce(adminId, accountId, filename, contentType, data);
    if (!finalAttempt.success) this.reportFailure({ adminId, accountId, api: 'stream-upload.goofish.com/api/upload.api', ...finalAttempt });
    return finalAttempt;
  }

  private async uploadChatImageOnce(adminId: string, accountId: string, filename: string, contentType: string, data: Buffer): Promise<XianyuChatImageUploadResult> {
    const credential = await this.loadCredential(adminId, accountId);
    const initialCookieHeader = credential?.cookieHeader?.trim() ?? '';
    let cookieHeader = initialCookieHeader;
    let cookieSnapshot: XianyuCookieSnapshot | undefined = cookieSnapshotFromMetadata(credential?.metadata);
    const initialMetadata = credential?.metadata;
    if (!cookieHeader && cookieSnapshot) cookieHeader = cookieHeaderFromSnapshot(cookieSnapshot);
    if (!cookieHeader) {
      const result = { success: false, accountInvalid: true, errorCode: 'CREDENTIAL_MISSING', message: 'account credential is missing', cookieHeader };
      return result;
    }
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type: contentType || 'application/octet-stream' }), filename || 'image');
    const endpoint = new URL('https://stream-upload.goofish.com/api/upload.api');
    endpoint.searchParams.set('floderId', '0');
    endpoint.searchParams.set('appkey', 'xy_chat');
    endpoint.searchParams.set('_input_charset', 'utf-8');
    try {
      // The upload host is a different subdomain from the MTOP host. When a
      // browser cookie snapshot is available, apply the same domain/path and
      // expiry filtering used by MTOP instead of replaying the legacy flat
      // header (which can contain stale or wrong-domain values).
      const requestCookieHeader = cookieSnapshot
        ? cookieHeaderForUrl(cookieSnapshot, endpoint.toString(), Date.now(), XIANYU_TOP_SITE)
        : cookieHeader;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/javascript, */*; q=0.01',
          origin: 'https://www.goofish.com',
          referer: 'https://www.goofish.com/',
          'user-agent': USER_AGENT,
          'x-requested-with': 'XMLHttpRequest',
          cookie: requestCookieHeader,
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const setCookies = getSetCookies(response.headers);
      if (cookieSnapshot) {
        if (setCookies.length > 0) cookieSnapshot = applySetCookies(cookieSnapshot, endpoint.toString(), setCookies, Date.now(), XIANYU_TOP_SITE);
        cookieHeader = cookieHeaderFromSnapshot(cookieSnapshot);
      } else if (setCookies.length > 0) {
        cookieHeader = mergeCookies(cookieHeader, setCookies);
      }
      const nextMetadata = cookieSnapshot ? metadataWithCookieSnapshot(initialMetadata, cookieSnapshot) : initialMetadata;
      if (cookieHeader !== initialCookieHeader || (cookieSnapshot && JSON.stringify(nextMetadata) !== JSON.stringify(initialMetadata))) {
        await this.saveCookie(adminId, accountId, cookieHeader, nextMetadata);
      }
      const raw = await response.text();
      if (response.status < 200 || response.status >= 300) {
        const accountInvalid = isSessionExpiredText(raw);
        return { success: false, accountInvalid, errorCode: accountInvalid ? 'SESSION_EXPIRED' : 'IMAGE_UPLOAD_HTTP_ERROR', message: accountInvalid ? 'xianyu session expired' : `image upload failed: http=${response.status}`, cookieHeader };
      }
      let payload: Record<string, any>;
      try { payload = JSON.parse(raw) as Record<string, any>; } catch {
        const accountInvalid = /<html|<!doctype/i.test(raw) || isSessionExpiredText(raw);
        return { success: false, accountInvalid, errorCode: accountInvalid ? 'SESSION_EXPIRED' : 'IMAGE_UPLOAD_INVALID_RESPONSE', message: accountInvalid ? 'xianyu session expired' : 'image upload response is not valid JSON', cookieHeader };
      }
      if (isSessionExpiredText(raw)) return { success: false, accountInvalid: true, errorCode: 'SESSION_EXPIRED', message: 'xianyu session expired', cookieHeader };
      const object = record(payload.object ?? payload.data ?? payload);
      const url = stringAt(object, ['url', 'imageUrl', 'imageURL']) ?? stringAt(payload, ['url', 'imageUrl', 'imageURL']);
      const [width, height] = parsePix(stringAt(object, ['pix', 'size']) ?? stringAt(payload, ['pix', 'size']));
      if (!url) return { success: false, accountInvalid: false, errorCode: 'IMAGE_UPLOAD_URL_MISSING', message: 'image upload response missing url', cookieHeader };
      return { success: true, accountInvalid: false, url, width: width || 800, height: height || 600, cookieHeader };
    } catch (error) {
      return { success: false, accountInvalid: false, errorCode: 'IMAGE_UPLOAD_FAILED', message: error instanceof Error ? error.message : 'image upload failed', cookieHeader };
    }
  }

  async fetchItems(adminId: string, accountId: string, data: Record<string, unknown> = {}): Promise<MtopResult> {
    return this.call(adminId, accountId, 'mtop.idle.web.xyh.item.list', '1.0', data);
  }

  async fetchItemsPage(adminId: string, accountId: string, pageNumber = 1, pageSize = 20): Promise<XianyuItemsPageResult> {
    const credential = await this.loadCredential(adminId, accountId);
    const cookieHeader = credential?.cookieHeader?.trim() ?? '';
    const userId = cookieValue(cookieHeader, 'unb');
    const response = await this.call(adminId, accountId, 'mtop.idle.web.xyh.item.list', '1.0', {
      needGroupInfo: false,
      pageNumber: Math.max(1, Math.trunc(pageNumber)),
      pageSize: Math.min(100, Math.max(1, Math.trunc(pageSize))),
      groupName: '在售',
      groupId: '58877261',
      defaultGroup: true,
      ...(userId ? { userId } : {}),
    }, { spm_cnt: 'a21ybx.im.0.0' });
    const normalizedPage = mapXianyuProductPage(response.response, Math.max(1, Math.trunc(pageNumber)), Math.min(100, Math.max(1, Math.trunc(pageSize))));
    return { ...response, ...normalizedPage };
  }

  async fetchItemsAll(adminId: string, accountId: string, pageSize = 20, maxPages = 20): Promise<{ pages: XianyuItemsPageResult[]; items: ProductSyncPageResult['items']; hasMore: boolean }> {
    const pages: XianyuItemsPageResult[] = [];
    const items: ProductSyncPageResult['items'] = [];
    let pageNumber = 1;
    let hasMore = false;
    const limit = Math.min(100, Math.max(1, Math.trunc(maxPages)));
    do {
      const page = await this.fetchItemsPage(adminId, accountId, pageNumber, pageSize);
      pages.push(page);
      if (!page.success) return { pages, items, hasMore: false };
      items.push(...page.items);
      hasMore = page.hasMore;
      pageNumber += 1;
    } while (hasMore && pages.length < limit);
    return { pages, items, hasMore };
  }

  async fetchItemDetail(adminId: string, accountId: string, itemId: string | number, options: XianyuItemDetailOptions = {}): Promise<XianyuItemDetailResult> {
    const normalizedItemId = String(itemId).trim();
    if (!normalizedItemId) return { success: false, accountInvalid: false, errorCode: 'ITEM_ID_MISSING', message: 'item id is required', cookieHeader: '', summary: {} };
    const referer = options.referer ?? buildItemReferer(normalizedItemId, options.categoryId);
    const extraParams: Record<string, string> = { spm_cnt: 'a21ybx.item.0.0' };
    if (options.spmPre) extraParams.spm_pre = options.spmPre;
    if (options.logId) extraParams.log_id = options.logId;
    const response = await this.call(adminId, accountId, 'mtop.taobao.idle.pc.detail', '1.0', { itemId: normalizedItemId }, extraParams, { referer });
    return { ...response, summary: mapXianyuItemDetail(response.response, normalizedItemId) };
  }

  async fetchSoldOrders(adminId: string, accountId: string, data: Record<string, unknown> = {}): Promise<MtopResult> {
    const requestedPageNumber = Number(data.pageNumber);
    const requestedPageSize = Number(data.rowsPerPage ?? data.pageSize);
    const payload: Record<string, unknown> = {
      ...data,
      pageNumber: Number.isFinite(requestedPageNumber) && requestedPageNumber > 0 ? Math.trunc(requestedPageNumber) : 1,
      rowsPerPage: Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? Math.min(100, Math.trunc(requestedPageSize)) : DEFAULT_SOLD_ORDER_PAGE_SIZE,
      orderIds: data.orderIds ?? '',
      queryCode: data.queryCode ?? 'ALL',
      orderSearchParam: data.orderSearchParam ?? '{}',
    };
    delete payload.pageSize;
    return this.call(adminId, accountId, SOLD_ORDERS_API, '1.0', payload);
  }

  async fetchOrdersAll(adminId: string, accountId: string, pageSize = DEFAULT_SOLD_ORDER_PAGE_SIZE, maxPages = 20): Promise<{ pages: XianyuOrdersPageResult[]; items: XianyuOrderItem[]; hasMore: boolean }> {
    const pages: XianyuOrdersPageResult[] = [];
    const items: XianyuOrderItem[] = [];
    let pageNumber = 1;
    let hasMore = false;
    const limit = Math.min(100, Math.max(1, Math.trunc(maxPages)));
    const normalizedPageSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));
    do {
      // The seller workbench contract uses rowsPerPage plus the legacy filter
      // fields below. Sending pageSize returns a successful envelope with no
      // order rows for active seller accounts.
      const response = await this.fetchSoldOrders(adminId, accountId, {
        pageNumber,
        rowsPerPage: normalizedPageSize,
        orderIds: '',
        queryCode: 'ALL',
        orderSearchParam: '{}',
      });
      const normalized = mapXianyuOrderPage(response.response, pageNumber, normalizedPageSize);
      const page: XianyuOrdersPageResult = { ...response, ...normalized };
      pages.push(page);
      if (!page.success) return { pages, items, hasMore: false };
      items.push(...page.items);
      hasMore = page.hasMore;
      pageNumber += 1;
    } while (hasMore && pages.length < limit);
    return { pages, items, hasMore };
  }

  /**
   * Confirm virtual shipment for an order.
   *
   * This is intentionally a thin mutation wrapper around the shared MTOP
   * request path so cookie rotation, token retry and account health reporting
   * remain identical to the existing read APIs. A transport retry exhaustion
   * is classified as unknown because the remote side may have committed the
   * shipment even though the HTTP response was not observed.
   */
  async confirmShipment(adminId: string, accountId: string, orderNo: string): Promise<XianyuExternalMutationResult> {
    const normalizedOrderNo = String(orderNo ?? '').trim();
    if (!normalizedOrderNo) return { status: 'failed', errorCode: 'ORDER_NO_MISSING', message: 'orderNo is required', cookieHeader: '' };
    const result = await this.call(
      adminId,
      accountId,
      CONSIGN_API,
      '1.0',
      { orderId: normalizedOrderNo, tradeText: '', picList: [], newUnconsign: true },
      {},
      { referer: SELLER_ORDER_MANAGE_REFERER },
    );
    return classifyMutationResult(result, normalizedOrderNo);
  }

  /**
   * Adjust the total price of an unpaid order. targetPriceMinor is integer fen.
   * The MTOP endpoint returns ret=SUCCESS even when data.success=false, so the
   * response body is checked before reporting a successful mutation.
   */
  async repriceOrder(adminId: string, accountId: string, orderNo: string, targetPriceMinor: number): Promise<XianyuExternalMutationResult> {
    const normalizedOrderNo = String(orderNo ?? '').trim();
    if (!normalizedOrderNo) return { status: 'failed', errorCode: 'ORDER_NO_MISSING', message: 'orderNo is required', cookieHeader: '' };
    if (!Number.isSafeInteger(targetPriceMinor) || targetPriceMinor < 0) {
      return { status: 'failed', errorCode: 'TARGET_PRICE_INVALID', message: 'targetPriceMinor must be a non-negative integer', cookieHeader: '' };
    }
    const result = await this.call(
      adminId,
      accountId,
      ADJUST_PRICE_API,
      '1.0',
      { modifyFee: targetPriceMinor, newTransportFee: '0', orderId: normalizedOrderNo },
      {},
      { referer: SELLER_ORDER_MANAGE_REFERER },
    );
    const businessSuccess = nestedBoolean(result.response, ['data', 'success']);
    if (result.success && businessSuccess !== true) {
      return {
        status: 'failed',
        externalRef: normalizedOrderNo,
        errorCode: 'MTOP_BUSINESS_ERROR',
        message: '闲鱼订单改价接口未确认 data.success=true',
        response: result.response,
        cookieHeader: result.cookieHeader,
      };
    }
    return classifyMutationResult(result, normalizedOrderNo);
  }

  /**
   * Read an authoritative order detail snapshot for state re-checks before a
   * destructive automation action. The endpoint is read-only; malformed or
   * structurally empty successful responses are surfaced as known failures so
   * callers never treat an incomplete order as eligible.
   */
  async readOrderDetail(adminId: string, accountId: string, orderNo: string): Promise<XianyuOrderDetailResult> {
    const normalizedOrderNo = String(orderNo ?? '').trim();
    if (!normalizedOrderNo) return { success: false, accountInvalid: false, errorCode: 'ORDER_NO_MISSING', message: 'orderNo is required', cookieHeader: '' };
    const result = await this.call(
      adminId,
      accountId,
      ORDER_DETAIL_API,
      '1.0',
      { tid: normalizedOrderNo },
      { valueType: 'string' },
      { referer: buildOrderDetailReferer(normalizedOrderNo) },
    );
    if (!result.success) return { ...result };
    const detail = mapXianyuOrderDetail(result.response, normalizedOrderNo);
    if (!detail) {
      const failure = {
        ...result,
        success: false,
        errorCode: 'ORDER_DETAIL_EMPTY',
        message: 'order detail response did not contain an orderInfoVO snapshot',
      } satisfies XianyuOrderDetailResult;
      this.reportFailure({ adminId, accountId, api: ORDER_DETAIL_API, errorCode: failure.errorCode, message: failure.message, accountInvalid: false });
      return failure;
    }
    return { ...result, detail };
  }

  async call(adminId: string, accountId: string, api: string, version: string, data: Record<string, unknown>, extraParams: Record<string, string> = {}, requestOptions: MtopRequestOptions = {}): Promise<MtopResult> {
    const credential = await this.loadCredential(adminId, accountId);
    const initialCookieHeader = credential?.cookieHeader?.trim() ?? '';
    let cookieHeader = initialCookieHeader;
    let cookieSnapshot: XianyuCookieSnapshot | undefined = cookieSnapshotFromMetadata(credential?.metadata);
    const initialMetadata = credential?.metadata;
    if (!cookieHeader && cookieSnapshot) cookieHeader = cookieHeaderFromSnapshot(cookieSnapshot);
    if (!cookieHeader) {
      const result = { success: false, accountInvalid: true, errorCode: 'CREDENTIAL_MISSING', message: 'account credential is missing', cookieHeader };
      this.reportFailure({ adminId, accountId, api, ...result });
      return result;
    }
    // A manually refreshed raw Cookie is authoritative. Once it diverges from
    // the persisted browser snapshot, discard the stale snapshot for the whole
    // request so a response Set-Cookie cannot rehydrate old validation tokens.
    if (cookieSnapshot && !cookieHeadersMatch(cookieSnapshot, cookieHeader)) cookieSnapshot = [];
    const dataValue = JSON.stringify(data);
    let lastError = 'MTOP_REQUEST_FAILED';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const isSellerRequest = isSellerApi(api);
      const isSellerOrders = api === SOLD_ORDERS_API;
      const documentUrl = requestOptions.referer ?? (isSellerRequest ? SELLER_ORDER_MANAGE_REFERER : 'https://www.goofish.com/im');
      const requestUrl = `${BASE_URL}/${api}/${version}/`;
      const snapshotSigningCookieHeader = cookieSnapshot ? cookieHeaderForSigning(cookieSnapshot, documentUrl, XIANYU_TOP_SITE) : '';
      const snapshotRequestCookieHeader = cookieSnapshot ? cookieHeaderForUrl(cookieSnapshot, requestUrl, Date.now(), XIANYU_TOP_SITE) : '';
      const snapshotToken = cookieValue(snapshotSigningCookieHeader, '_m_h5_tk');
      // A persisted browser snapshot can outlive its in-memory expiry metadata.
      // If the raw saved cookie still contains _m_h5_tk, replay it and let MTOP
      // return the authoritative session-expired response instead of failing
      // locally with MTOP_TOKEN_MISSING.
      // If a user refreshed the raw Cookie after completing a slider challenge,
      // prefer that newer flat header over an older persisted browser snapshot.
      const useSnapshot = Boolean(snapshotToken && cookieHeadersMatch(cookieSnapshot, cookieHeader));
      const signingCookieHeader = useSnapshot ? snapshotSigningCookieHeader : cookieHeader;
      const requestCookieHeader = useSnapshot ? snapshotRequestCookieHeader : cookieHeader;
      const token = (useSnapshot ? snapshotToken : cookieValue(cookieHeader, '_m_h5_tk')).split('_', 1)[0] ?? '';
      if (!token) {
        const result = { success: false, accountInvalid: true, errorCode: 'MTOP_TOKEN_MISSING', message: 'credential does not contain _m_h5_tk', cookieHeader };
        this.reportFailure({ adminId, accountId, api, ...result });
        return result;
      }
      const timestamp = String(Date.now());
      const params = new URLSearchParams({
        jsv: '2.7.2', appKey: APP_KEY, t: timestamp, sign: md5(`${token}&${timestamp}&${APP_KEY}&${dataValue}`),
        v: version,
        type: isSellerOrders ? 'json' : 'originaljson',
        accountSite: 'xianyu', dataType: 'json', timeout: '20000', api,
        ...(isSellerOrders ? { valueType: 'string' } : {}),
        sessionOption: 'AutoLoginOnly',
        spm_cnt: isSellerOrders ? 'a21107h.42831410.0.0' : 'a21ybx.item.0.0',
        ...extraParams,
      });
      try {
        const requestHeaders: Record<string, string> = {
          accept: 'application/json',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'cache-control': 'no-cache',
          'content-type': 'application/x-www-form-urlencoded',
          origin: originForReferer(requestOptions.referer ?? (isSellerRequest ? SELLER_ORDER_MANAGE_REFERER : refererFor(api))),
          pragma: 'no-cache',
          priority: 'u=1, i',
          referer: requestOptions.referer ?? (isSellerRequest ? SELLER_ORDER_MANAGE_REFERER : refererFor(api)),
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          'sec-ch-ua': '"Chromium";v="139", "Not(A:Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'user-agent': USER_AGENT,
          cookie: requestCookieHeader,
        };
        const response = await fetch(`${requestUrl}?${params.toString()}`, {
          method: 'POST',
          headers: requestHeaders,
          body: new URLSearchParams({ data: dataValue }).toString(),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const setCookies = setCookieValues(response.headers);
        if (cookieSnapshot && setCookies.length > 0) {
          cookieSnapshot = applySetCookies(cookieSnapshot, requestUrl, setCookies, Date.now(), XIANYU_TOP_SITE);
          const snapshotCookieHeader = cookieHeaderFromSnapshot(cookieSnapshot);
          cookieHeader = cookieValue(snapshotCookieHeader, '_m_h5_tk') ? snapshotCookieHeader : mergeCookies(cookieHeader, setCookies);
        } else if (setCookies.length > 0) {
          cookieHeader = mergeCookies(cookieHeader, setCookies);
        }
        const nextMetadata = cookieSnapshot ? metadataWithCookieSnapshot(initialMetadata, cookieSnapshot) : initialMetadata;
        if (cookieHeader !== initialCookieHeader || (cookieSnapshot && JSON.stringify(nextMetadata) !== JSON.stringify(initialMetadata))) await this.saveCookie(adminId, accountId, cookieHeader, nextMetadata);
        const payload = await response.json() as Record<string, unknown>;
        const ret = Array.isArray(payload.ret) ? payload.ret.map(String) : [];
        const retMessage = ret[0] ?? '';
        if (retMessage.includes('SUCCESS::')) return { success: true, accountInvalid: false, response: payload, cookieHeader };
        if (isTokenExpired(retMessage)) {
          lastError = retMessage;
          if (setCookies.length > 0) continue;
          const result = { success: false, accountInvalid: true, errorCode: 'MTOP_TOKEN_EXPIRED', message: retMessage || 'mtop token expired', response: payload, cookieHeader };
          this.reportFailure({ adminId, accountId, api, ...result });
          return result;
        }
        if (isSessionExpired(ret)) {
          const result = { success: false, accountInvalid: true, errorCode: 'SESSION_EXPIRED', message: retMessage, response: payload, cookieHeader };
          this.reportFailure({ adminId, accountId, api, ...result });
          return result;
        }
        if (isValidationFailure(retMessage)) {
          const result = { success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED', message: retMessage, response: payload, cookieHeader };
          this.reportFailure({ adminId, accountId, api, ...result });
          return result;
        }
        if (isPermissionFailure(retMessage)) {
          const result = { success: false, accountInvalid: false, errorCode: 'MTOP_PERMISSION_DENIED', message: retMessage, response: payload, cookieHeader };
          this.reportFailure({ adminId, accountId, api, ...result });
          return result;
        }
        const result = { success: false, accountInvalid: false, errorCode: 'MTOP_BUSINESS_ERROR', message: retMessage || 'mtop request failed', response: payload, cookieHeader };
        this.reportFailure({ adminId, accountId, api, ...result });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    const result = { success: false, accountInvalid: false, errorCode: 'MTOP_RETRY_EXHAUSTED', message: lastError, cookieHeader };
    this.reportFailure({ adminId, accountId, api, ...result });
    return result;
  }
}

function isSellerApi(api: string): boolean {
  return api === SOLD_ORDERS_API || api === CONSIGN_API || api === ADJUST_PRICE_API;
}

function originForReferer(referer: string): string {
  try {
    const parsed = new URL(referer);
    return parsed.origin;
  } catch {
    return 'https://www.goofish.com';
  }
}

function classifyMutationResult(result: MtopResult, externalRef: string): XianyuExternalMutationResult {
  if (result.success) return { status: 'succeeded', externalRef, response: result.response, cookieHeader: result.cookieHeader };
  const unknown = result.errorCode === 'MTOP_RETRY_EXHAUSTED' || result.errorCode === 'MTOP_REQUEST_FAILED';
  return {
    status: unknown ? 'unknown' : 'failed',
    externalRef,
    errorCode: result.errorCode,
    message: result.message,
    response: result.response,
    cookieHeader: result.cookieHeader,
  };
}

function buildOrderDetailReferer(orderNo: string): string {
  const url = new URL('https://www.goofish.com/order-detail');
  url.searchParams.set('orderId', orderNo);
  url.searchParams.set('role', 'seller');
  return url.toString();
}

function nestedBoolean(root: unknown, path: string[]): boolean | undefined {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current === 'boolean') return current;
  if (typeof current === 'number') return current !== 0;
  if (typeof current === 'string' && current.trim()) return /^(true|1|yes)$/i.test(current.trim());
  return undefined;
}

function mapXianyuOrderDetail(response: Record<string, unknown> | undefined, orderNo: string): XianyuOrderDetailSummary | undefined {
  const data = record(response?.data);
  const utArgs = record(data.utArgs);
  const components = Array.isArray(data.components) ? data.components : [];
  const orderInfo = components
    .map((value) => record(value))
    .find((value) => value.render === 'orderInfoVO');
  const componentData = record(orderInfo?.data);
  const itemInfo = record(componentData.itemInfo ?? componentData.itemVO ?? componentData.item);
  const priceInfo = record(componentData.priceInfo ?? componentData.price);
  const amountInfo = record(priceInfo.amount);
  const rootOrder = findFirstRecord(response, ['orderInfo', 'order', 'trade', 'orderDetail']);
  const item = record(rootOrder?.item ?? rootOrder?.itemInfo ?? rootOrder?.goods);
  const buyer = record(rootOrder?.buyer ?? rootOrder?.buyerInfo);
  const quantityValue = firstScalar(itemInfo.buyAmount, itemInfo.quantity, rootOrder?.quantity, rootOrder?.buyAmount);
  const amountValue = firstScalar(amountInfo.value, priceInfo.totalPrice, priceInfo.amount, rootOrder?.amount, rootOrder?.totalPrice);
  const orderStatus = firstScalar(utArgs.orderStatus, rootOrder?.orderStatus, rootOrder?.status);
  const detail: XianyuOrderDetailSummary = {
    orderNo,
    quantity: parsePositiveInt(quantityValue),
    skuSpec: joinSpec(firstScalar(itemInfo.specName, rootOrder?.specName), firstScalar(itemInfo.specValue, rootOrder?.specValue)),
    amountMinor: parseAmountMinor(amountValue),
    orderStatus,
    paymentStatus: firstScalar(rootOrder?.paymentStatus, rootOrder?.payStatus),
    deliveryStatus: firstScalar(rootOrder?.deliveryStatus, rootOrder?.shipStatus, orderStatus),
    buyerId: firstScalar(rootOrder?.buyerId, buyer.id, buyer.userId),
    conversationId: firstScalar(rootOrder?.conversationId, rootOrder?.sessionId, rootOrder?.cid),
    itemId: firstScalar(rootOrder?.itemId, item.itemId, item.id, itemInfo.itemId, itemInfo.id),
    itemTitle: firstScalar(rootOrder?.itemTitle, item.title, item.itemTitle, itemInfo.title, itemInfo.itemTitle, itemInfo.name),
    reviewedAt: firstScalar(rootOrder?.reviewedAt, rootOrder?.rateTime, rootOrder?.reviewTime),
  };
  const hasSnapshot = Object.entries(detail).some(([key, value]) => key !== 'orderNo' && value !== undefined);
  return hasSnapshot ? detail : undefined;
}

function findFirstRecord(root: unknown, keys: string[]): Record<string, unknown> {
  const value = record(root);
  for (const key of keys) {
    const candidate = record(value[key]);
    if (Object.keys(candidate).length > 0) return candidate;
  }
  return {};
}

function firstScalar(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
  }
  return undefined;
}

function joinSpec(name?: string, value?: string): string | undefined {
  if (!name && !value) return undefined;
  if (!name) return value;
  if (!value) return name;
  return `${name}:${value}`;
}

function parsePositiveInt(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function parseAmountMinor(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return normalized.includes('.') ? Math.round(parsed * 100) : Math.round(parsed);
}

function cookieValue(cookieHeader: string, name: string): string {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

function cookieHeadersMatch(snapshot: XianyuCookieSnapshot | undefined, rawCookieHeader: string): boolean {
  if (!snapshot || !rawCookieHeader.trim()) return true;
  const snapshotValues = parseCookieHeader(cookieHeaderFromSnapshot(snapshot));
  const rawValues = parseCookieHeader(rawCookieHeader);
  const volatile = new Set(['_m_h5_tk', '_m_h5_tk_enc', 'x5sec', 'x5secdata', 'wua', 'umid', 'cna', 'cookie2', 'unb', 'munb', 'tfstk']);
  for (const [name, value] of rawValues) {
    if (!volatile.has(name)) continue;
    const snapshotValue = snapshotValues.get(name);
    // Some persisted flat cookies contain only the token prefix while the
    // browser snapshot still has the authoritative `_m_h5_tk=<token>_<suffix>`
    // value. Treat that incomplete prefix as compatible, but keep strict
    // equality for complete values and all other volatile cookies.
    if (name === '_m_h5_tk' && value && snapshotValue?.startsWith(`${value}_`)) continue;
    if (snapshotValue !== value) return false;
  }
  return true;
}

function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) values.set(name, rest.join('='));
  }
  return values;
}

function mergeCookies(cookieHeader: string, setCookies: string[]): string {
  const values = new Map<string, string>();
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) values.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  for (const raw of setCookies) {
    const first = raw.split(';', 1)[0] ?? '';
    const index = first.indexOf('=');
    if (index > 0) values.set(first.slice(0, index).trim(), first.slice(index + 1).trim());
  }
  return [...values.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function getSetCookies(headers: Headers): string[] { return setCookieValues(headers); }
function md5(value: string): string { return crypto.createHash('md5').update(value).digest('hex'); }
function isTokenExpired(value: string): boolean { return ['FAIL_SYS_TOKEN_EXOIRED', 'FAIL_SYS_TOKEN_EXPIRED', 'FAIL_SYS_TOKEN_EMPTY', '浠ょ墝杩囨湡', '浠ょ墝涓虹┖'].some((marker) => value.includes(marker)); }
function isSessionExpired(ret: string[]): boolean { return ret.some(isSessionExpiredText); }
function isSessionExpiredText(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes('fail_sys_session_expired') || normalized.includes('session_expired') || normalized.includes('session expired') || normalized.includes('session杩囨湡') || normalized.includes('会话已过期') || normalized.includes('登录已失效');
}
function isValidationFailure(value: string): boolean { const normalized = value.toLowerCase(); return ['fail_sys_user_validate', 'rgv587', 'fail_sys_illegal_access', 'fail_biz_wua_is_machine', 'wua_is_machine', 'captcha', 'validate', 'punish', 'x5sec'].some((marker) => normalized.includes(marker)); }
function isPermissionFailure(value: string): boolean { const normalized = value.toLowerCase(); return normalized.includes('permission_exception') || normalized.includes('permission denied') || value.includes('无权限访问'); }
function refererFor(api: string): string { if (api.includes('merchant.sold') || api.includes('order')) return 'https://seller.goofish.com/'; if (api.includes('loginuser')) return 'https://www.goofish.com/im'; return 'https://www.goofish.com/'; }

function buildItemReferer(itemId: string, categoryId?: string | number): string {
  const url = new URL('https://www.goofish.com/item');
  url.searchParams.set('id', itemId);
  if (categoryId !== undefined && String(categoryId).trim()) url.searchParams.set('categoryId', String(categoryId));
  return url.toString();
}

function nestedString(root: unknown, path: string[]): string | undefined {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined;
}

function recordAt(root: unknown, path: string[]): Record<string, unknown> {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return {};
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : {};
}

function stringAt(root: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = root[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function parsePix(value: string | undefined): [number, number] {
  if (!value) return [0, 0];
  const match = value.match(/(\d+)\s*[xX*]\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
