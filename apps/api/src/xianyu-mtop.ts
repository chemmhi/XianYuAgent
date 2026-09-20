import crypto from 'node:crypto';
import type { ProductSyncPageResult } from './domain.js';
import { mapXianyuProductPage } from './xianyu-product-mapper.js';

const APP_KEY = '34839810';
export const XIANYU_IM_APP_KEY = '444e9908a51d1cb236a27862abc769c9';
const BASE_URL = 'https://h5api.m.goofish.com/h5';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

export interface MtopCredential { cookieHeader?: string; }

export interface MtopResult {
  success: boolean;
  accountInvalid: boolean;
  errorCode?: string;
  message?: string;
  response?: Record<string, unknown>;
  cookieHeader: string;
}

export interface XianyuItemsPageResult extends MtopResult, ProductSyncPageResult {}

export interface XianyuMtopClientOptions {
  timeoutMs?: number;
  loadCredential: (adminId: string, accountId: string) => Promise<MtopCredential | undefined>;
  saveCookie: (adminId: string, accountId: string, cookieHeader: string) => Promise<void>;
}

export class XianyuMtopClient {
  private readonly timeoutMs: number;
  private readonly loadCredential: XianyuMtopClientOptions['loadCredential'];
  private readonly saveCookie: XianyuMtopClientOptions['saveCookie'];

  constructor(options: XianyuMtopClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.loadCredential = options.loadCredential;
    this.saveCookie = options.saveCookie;
  }

  async verifyLogin(adminId: string, accountId: string): Promise<MtopResult> {
    return this.call(adminId, accountId, 'mtop.taobao.idlemessage.pc.loginuser.get', '1.0', {}, { spm_cnt: 'a21ybx.im.0.0', needLogin: 'false' });
  }

  async fetchImToken(adminId: string, accountId: string, deviceId: string): Promise<{ success: boolean; accountInvalid: boolean; errorCode?: string; message?: string; accessToken?: string; cookieHeader: string }> {
    const result = await this.call(adminId, accountId, 'mtop.taobao.idlemessage.pc.login.token', '1.0', { appKey: XIANYU_IM_APP_KEY, deviceId }, { spm_cnt: 'a21ybx.im.0.0', spm_pre: 'a21ybx.item.want.1.14ad3da6ALVq3n', log_id: '14ad3da6ALVq3n' });
    const accessToken = nestedString(result.response, ['data', 'accessToken']);
    if (!result.success || !accessToken) return { success: false, accountInvalid: result.accountInvalid, errorCode: result.errorCode ?? 'IM_TOKEN_MISSING', message: result.message ?? 'unable to obtain im token', cookieHeader: result.cookieHeader };
    return { success: true, accountInvalid: false, accessToken, cookieHeader: result.cookieHeader };
  }

  async fetchProfile(adminId: string, accountId: string): Promise<MtopResult> {
    return this.call(adminId, accountId, 'mtop.idle.web.user.page.nav', '1.0', {}, { spm_cnt: 'a21ybx.home.0.0', ecode: '0' });
  }

  async fetchChatUserInfo(adminId: string, accountId: string, sessionId: string): Promise<{ success: boolean; accountInvalid: boolean; errorCode?: string; message?: string; buyerDisplayName?: string; buyerAvatarUrl?: string }> {
    const normalizedSessionId = sessionId.replace(/@goofish$/, '');
    const result = await this.call(adminId, accountId, 'mtop.taobao.idlemessage.pc.user.query', '4.0', { type: 0, sessionType: 1, sessionId: normalizedSessionId, isOwner: false });
    const userInfo = recordAt(result.response, ['data', 'userInfo']);
    return { success: result.success, accountInvalid: result.accountInvalid, errorCode: result.errorCode, message: result.message, buyerDisplayName: stringAt(userInfo, ['fishNick', 'nick', 'nickname']), buyerAvatarUrl: stringAt(userInfo, ['logo', 'avatar', 'avatarUrl']) };
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

  async fetchSoldOrders(adminId: string, accountId: string, data: Record<string, unknown> = {}): Promise<MtopResult> {
    return this.call(adminId, accountId, 'mtop.taobao.idle.trade.merchant.sold.get', '1.0', data);
  }

  async call(adminId: string, accountId: string, api: string, version: string, data: Record<string, unknown>, extraParams: Record<string, string> = {}): Promise<MtopResult> {
    const credential = await this.loadCredential(adminId, accountId);
    const initialCookieHeader = credential?.cookieHeader?.trim() ?? '';
    let cookieHeader = initialCookieHeader;
    if (!cookieHeader) return { success: false, accountInvalid: true, errorCode: 'CREDENTIAL_MISSING', message: 'account credential is missing', cookieHeader };
    const dataValue = JSON.stringify(data);
    let lastError = 'MTOP_REQUEST_FAILED';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = cookieValue(cookieHeader, '_m_h5_tk').split('_', 1)[0] ?? '';
      if (!token) return { success: false, accountInvalid: true, errorCode: 'MTOP_TOKEN_MISSING', message: 'credential does not contain _m_h5_tk', cookieHeader };
      const timestamp = String(Date.now());
      const params = new URLSearchParams({
        jsv: '2.7.2', appKey: APP_KEY, t: timestamp, sign: md5(`${token}&${timestamp}&${APP_KEY}&${dataValue}`),
        v: version, type: 'originaljson', accountSite: 'xianyu', dataType: 'json', timeout: '20000', api,
        sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.item.0.0', ...extraParams,
      });
      try {
        const response = await fetch(`${BASE_URL}/${api}/${version}/?${params.toString()}`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'cache-control': 'no-cache',
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'https://www.goofish.com',
            pragma: 'no-cache',
            referer: refererFor(api),
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': USER_AGENT,
            cookie: cookieHeader,
          },
          body: new URLSearchParams({ data: dataValue }).toString(),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const payload = await response.json() as Record<string, unknown>;
        const setCookies = getSetCookies(response.headers);
        if (setCookies.length > 0) cookieHeader = mergeCookies(cookieHeader, setCookies);
        if (cookieHeader !== initialCookieHeader) await this.saveCookie(adminId, accountId, cookieHeader);
        const ret = Array.isArray(payload.ret) ? payload.ret.map(String) : [];
        const retMessage = ret[0] ?? '';
        if (retMessage.includes('SUCCESS::')) return { success: true, accountInvalid: false, response: payload, cookieHeader };
        if (isTokenExpired(retMessage)) {
          lastError = retMessage;
          if (setCookies.length > 0) continue;
          return { success: false, accountInvalid: true, errorCode: 'MTOP_TOKEN_EXPIRED', message: retMessage || 'mtop token expired', response: payload, cookieHeader };
        }
        if (isSessionExpired(ret)) return { success: false, accountInvalid: true, errorCode: 'SESSION_EXPIRED', message: retMessage, response: payload, cookieHeader };
        if (isValidationFailure(retMessage)) return { success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED', message: retMessage, response: payload, cookieHeader };
        return { success: false, accountInvalid: false, errorCode: 'MTOP_BUSINESS_ERROR', message: retMessage || 'mtop request failed', response: payload, cookieHeader };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return { success: false, accountInvalid: false, errorCode: 'MTOP_RETRY_EXHAUSTED', message: lastError, cookieHeader };
  }
}

function cookieValue(cookieHeader: string, name: string): string {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
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

function getSetCookies(headers: Headers): string[] { return (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []; }
function md5(value: string): string { return crypto.createHash('md5').update(value).digest('hex'); }
function isTokenExpired(value: string): boolean { return ['FAIL_SYS_TOKEN_EXOIRED', 'FAIL_SYS_TOKEN_EXPIRED', 'FAIL_SYS_TOKEN_EMPTY', '浠ょ墝杩囨湡', '浠ょ墝涓虹┖'].some((marker) => value.includes(marker)); }
function isSessionExpired(ret: string[]): boolean { return ret.some((value) => { const normalized = value.toLowerCase(); return normalized.includes('fail_sys_session_expired') || normalized.includes('session_expired') || normalized.includes('session杩囨湡'); }); }
function isValidationFailure(value: string): boolean { const normalized = value.toLowerCase(); return ['fail_sys_user_validate', 'rgv587', 'fail_sys_illegal_access', 'fail_biz_wua_is_machine', 'wua_is_machine', 'captcha', 'validate', 'punish', 'x5sec'].some((marker) => normalized.includes(marker)); }
function refererFor(api: string): string { if (api.includes('merchant.sold') || api.includes('order')) return 'https://seller.goofish.com/'; if (api.includes('loginuser')) return 'https://www.goofish.com/im'; return 'https://www.goofish.com/'; }

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
