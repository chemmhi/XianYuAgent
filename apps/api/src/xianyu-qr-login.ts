import crypto from 'node:crypto';
import QRCode from 'qrcode';

const APP_KEY = '34839810';
const PASSPORT_HOST = 'https://passport.goofish.com';
const API_H5TK = 'https://h5api.m.goofish.com/h5/mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get/1.0/';
const API_MINI_LOGIN = `${PASSPORT_HOST}/mini_login.htm`;
const API_GENERATE_QR = `${PASSPORT_HOST}/newlogin/qrcode/generate.do`;
const API_SCAN_STATUS = `${PASSPORT_HOST}/newlogin/qrcode/query.do`;
const QR_VERIFY_TARGET = 'https://www.goofish.com/im';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

export type XianyuQrStatus = 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'cancelled' | 'failed' | 'verification_required';

export interface XianyuQrPublicSession {
  sessionId: string;
  accountId?: string;
  status: XianyuQrStatus;
  qrImageDataUrl?: string;
  expiresAt: string;
  pollAfterMs: number;
  errorCode?: string;
  verificationUrl?: string;
}

export type XianyuQrStatusEvent = XianyuQrPublicSession & { adminId: string };

export interface XianyuQrSuccess {
  sessionId: string;
  adminId: string;
  accountId?: string;
  cookieHeader: string;
  unb: string;
}

export interface XianyuQrAdapterOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  onSuccess?: (result: XianyuQrSuccess) => Promise<void>;
  onStatus?: (session: XianyuQrStatusEvent) => Promise<void>;
}

type CookieJar = Map<string, string>;
type LoginParams = Record<string, string>;

interface InternalSession {
  sessionId: string;
  accountId?: string;
  adminId: string;
  createdAt: number;
  expiresAt: number;
  status: XianyuQrStatus;
  qrImageDataUrl?: string;
  qrParams: LoginParams;
  jar: CookieJar;
  errorCode?: string;
  verificationUrl?: string;
  completionNotified: boolean;
}

export class XianyuQrLoginAdapter {
  private readonly sessions = new Map<string, InternalSession>();
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly onSuccess?: XianyuQrAdapterOptions['onSuccess'];
  private readonly onStatus?: XianyuQrAdapterOptions['onStatus'];

  constructor(options: XianyuQrAdapterOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_500;
    this.maxWaitMs = options.maxWaitMs ?? 5 * 60_000;
    this.onSuccess = options.onSuccess;
    this.onStatus = options.onStatus;
  }

  async create(input: { sessionId: string; adminId: string; accountId?: string }): Promise<XianyuQrPublicSession> {
    const now = Date.now();
    const session: InternalSession = {
      sessionId: input.sessionId,
      accountId: input.accountId,
      adminId: input.adminId,
      createdAt: now,
      expiresAt: now + this.maxWaitMs,
      status: 'waiting',
      qrParams: {},
      jar: new Map(),
      completionNotified: false,
    };
    this.sessions.set(session.sessionId, session);
    try {
      await this.getMh5Token(session);
      await this.getLoginParams(session);
      const result = await this.generateQr(session);
      void this.monitor(session.sessionId);
      await this.emitStatus(session);
      return result;
    } catch (error) {
      session.status = 'failed';
      session.errorCode = classifyError(error);
      await this.emitStatus(session);
      throw error;
    }
  }

  get(sessionId: string): XianyuQrPublicSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (Date.now() >= session.expiresAt && !['succeeded', 'cancelled', 'failed'].includes(session.status)) {
      session.status = 'expired';
      session.errorCode = 'QR_EXPIRED';
    }
    return this.toPublic(session);
  }

  cancel(sessionId: string): XianyuQrPublicSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (!['succeeded', 'expired', 'failed'].includes(session.status)) session.status = 'cancelled';
    return this.toPublic(session);
  }

  private async monitor(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const deadline = Date.now() + this.maxWaitMs;
    let lastStatus = session.status;
    while (Date.now() < deadline && !['succeeded', 'expired', 'cancelled', 'failed'].includes(session.status)) {
      try {
        const result = await this.pollQrStatus(session);
        if (result.status === 'SCANNED') session.status = 'scanned';
        else if (result.status === 'EXPIRED') { session.status = 'expired'; session.errorCode = 'QR_EXPIRED'; }
        else if (result.status === 'CANCELED') { session.status = 'cancelled'; session.errorCode = 'QR_CANCELLED'; }
        else if (result.status === 'ERROR') { session.status = 'failed'; session.errorCode = 'QR_PROVIDER_ERROR'; }
        else if (result.status === 'CONFIRMED') {
          if (result.iframeRedirect && result.iframeRedirectUrl) {
            session.status = 'verification_required';
            session.verificationUrl = result.iframeRedirectUrl;
            session.errorCode = 'VERIFICATION_REQUIRED';
            // 人脸/风控链路依赖页面挑战，先保留可复核状态，不伪造成功。
            await this.emitStatus(session);
            return;
          }
          await this.completeConfirmedLogin(session);
        }
        if (session.status !== lastStatus) {
          lastStatus = session.status;
          await this.emitStatus(session);
        }
        if (['succeeded', 'expired', 'cancelled', 'failed', 'verification_required'].includes(session.status)) return;
      } catch (error) {
        session.errorCode = classifyError(error);
        // 网络抖动不立即失败，继续等待到二维码超时。
      }
      await sleep(this.pollIntervalMs);
    }
    if (!['succeeded', 'expired', 'cancelled', 'failed', 'verification_required'].includes(session.status)) {
      session.status = 'expired';
      session.errorCode = 'QR_TIMEOUT';
      await this.emitStatus(session);
    }
  }

  private async getMh5Token(session: InternalSession): Promise<void> {
    const response = await this.request(API_H5TK, { method: 'GET', headers: passportHeaders() });
    absorbSetCookies(session.jar, response.headers);
    const data = '{"bizScene":"home"}';
    const timestamp = String(Date.now());
    const token = (session.jar.get('_m_h5_tk') ?? '').split('_', 1)[0];
    const params = new URLSearchParams({
      jsv: '2.7.2', appKey: APP_KEY, t: timestamp,
      sign: md5(`${token}&${timestamp}&${APP_KEY}&${data}`),
      v: '1.0', type: 'originaljson', dataType: 'json', timeout: '20000',
      api: 'mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get', data,
    });
    const post = await this.request(`${API_H5TK}?${params.toString()}`, {
      method: 'POST', headers: { ...passportHeaders(), 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(session.jar) },
    });
    absorbSetCookies(session.jar, post.headers);
    if (!session.jar.get('_m_h5_tk')) throw new Error('QR_H5_TOKEN_INIT_FAILED');
  }

  private async getLoginParams(session: InternalSession): Promise<void> {
    const params = new URLSearchParams({ lang: 'zh_cn', appName: 'xianyu', appEntrance: 'web', styleType: 'vertical', bizParams: '', notLoadSsoView: 'false', notKeepLogin: 'false', isMobile: 'false', qrCodeFirst: 'false', stie: '77', rnd: String(Math.random()) });
    const response = await this.request(`${API_MINI_LOGIN}?${params.toString()}`, { method: 'GET', headers: { ...passportHeaders(), cookie: cookieHeader(session.jar) } });
    absorbSetCookies(session.jar, response.headers);
    const html = await response.text();
    const viewData = extractJsonAssignment(html, 'window.viewData') as Record<string, unknown>;
    const form = viewData.loginFormData;
    if (!form || typeof form !== 'object') throw new Error('QR_LOGIN_FORM_MISSING');
    session.qrParams = Object.fromEntries(Object.entries(form as Record<string, unknown>).map(([key, value]) => [key, value == null ? '' : String(value)]));
    session.qrParams.umidTag = 'SERVER';
  }

  private async generateQr(session: InternalSession): Promise<XianyuQrPublicSession> {
    const params = new URLSearchParams(session.qrParams);
    const response = await this.request(`${API_GENERATE_QR}?${params.toString()}`, { method: 'GET', headers: { ...passportHeaders(), cookie: cookieHeader(session.jar) } });
    absorbSetCookies(session.jar, response.headers);
    const payload = await response.json() as { content?: { success?: boolean; data?: { codeContent?: string; t?: string | number; ck?: string } } };
    const data = payload.content?.data;
    if (!payload.content?.success || !data?.codeContent) throw new Error('QR_GENERATE_FAILED');
    session.qrParams.t = String(data.t ?? '');
    session.qrParams.ck = String(data.ck ?? '');
    session.qrImageDataUrl = await QRCode.toDataURL(data.codeContent, { margin: 2, width: 360 });
    return this.toPublic(session);
  }

  private async pollQrStatus(session: InternalSession): Promise<{ status: string; iframeRedirect?: boolean; iframeRedirectUrl?: string }> {
    const form = new URLSearchParams({ ...session.qrParams, ua: '', navlanguage: 'zh-CN', navUserAgent: USER_AGENT, navPlatform: 'Win32', isIframe: 'true', documentReferer: QR_VERIFY_TARGET, defaultView: 'qrcode' });
    const response = await this.request(API_SCAN_STATUS, { method: 'POST', headers: { ...passportHeaders(), 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(session.jar) }, body: form.toString() });
    absorbSetCookies(session.jar, response.headers);
    const payload = await response.json() as { hasError?: boolean; content?: { data?: { qrCodeStatus?: string; iframeRedirect?: boolean; iframeRedirectUrl?: string } } };
    if (payload.hasError) return { status: 'ERROR' };
    return { status: String(payload.content?.data?.qrCodeStatus ?? 'UNKNOWN'), iframeRedirect: Boolean(payload.content?.data?.iframeRedirect), iframeRedirectUrl: normalizeUrl(payload.content?.data?.iframeRedirectUrl ?? '') };
  }

  private async completeConfirmedLogin(session: InternalSession): Promise<void> {
    const response = await this.request(QR_VERIFY_TARGET, { method: 'GET', headers: { ...documentHeaders(), cookie: cookieHeader(session.jar) } });
    absorbSetCookies(session.jar, response.headers);
    const unb = session.jar.get('unb') ?? '';
    if (!unb) throw new Error('QR_CONFIRMED_WITHOUT_UNB');
    try {
      if (!session.completionNotified) {
        session.completionNotified = true;
        if (this.onSuccess) await this.onSuccess({ sessionId: session.sessionId, adminId: session.adminId, accountId: session.accountId, cookieHeader: cookieHeader(session.jar), unb });
      }
      session.status = 'succeeded';
      session.errorCode = undefined;
    } catch (error) {
      session.status = 'failed';
      session.errorCode = classifyError(error);
      throw error;
    }
  }

  private toPublic(session: InternalSession): XianyuQrPublicSession {
    return { sessionId: session.sessionId, accountId: session.accountId, status: session.status, qrImageDataUrl: session.qrImageDataUrl, expiresAt: new Date(session.expiresAt).toISOString(), pollAfterMs: this.pollIntervalMs, errorCode: session.errorCode, verificationUrl: session.verificationUrl };
  }

  private async emitStatus(session: InternalSession): Promise<void> {
    if (this.onStatus) await this.onStatus({ ...this.toPublic(session), adminId: session.adminId });
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { ...init, redirect: 'follow', signal: controller.signal });
      if (!response.ok && response.status >= 500) throw new Error(`HTTP_${response.status}`);
      return response;
    } finally { clearTimeout(timeout); }
  }
}

function passportHeaders(): Record<string, string> {
  return { accept: 'application/json, text/plain, */*', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8', 'cache-control': 'no-cache', origin: PASSPORT_HOST, pragma: 'no-cache', referer: `${PASSPORT_HOST}/`, 'user-agent': USER_AGENT };
}

function documentHeaders(): Record<string, string> {
  return { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8', 'cache-control': 'no-cache', pragma: 'no-cache', referer: 'https://www.goofish.com/', 'user-agent': USER_AGENT };
}

function absorbSetCookies(jar: CookieJar, headers: Headers): void {
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const raw of values) {
    const first = raw.split(';', 1)[0] ?? '';
    const index = first.indexOf('=');
    if (index > 0) jar.set(first.slice(0, index).trim(), first.slice(index + 1).trim());
  }
}

function cookieHeader(jar: CookieJar): string { return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; '); }
function md5(value: string): string { return crypto.createHash('md5').update(value).digest('hex'); }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function classifyError(error: unknown): string { const message = error instanceof Error ? error.message : String(error); return message.startsWith('QR_') ? message : 'QR_NETWORK_ERROR'; }
function normalizeUrl(raw: string): string | undefined { const value = String(raw ?? '').replaceAll('\\/', '/').trim(); if (!value) return undefined; return value.startsWith('//') ? `https:${value}` : new URL(value, PASSPORT_HOST).toString(); }

function extractJsonAssignment(html: string, marker: string): Record<string, unknown> {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error('QR_LOGIN_FORM_MISSING');
  const start = html.indexOf('{', markerIndex);
  if (start < 0) throw new Error('QR_LOGIN_FORM_MISSING');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start, index + 1)) as Record<string, unknown>;
    }
  }
  throw new Error('QR_LOGIN_FORM_MALFORMED');
}
