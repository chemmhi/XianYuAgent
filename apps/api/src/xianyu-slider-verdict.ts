import type { XianyuVerificationPage, XianyuVerificationResponse, XianyuVerificationRequest } from './xianyu-browser-port.js';

/** Keep only the verdict, never the challenge URL, signature or response body. */
export function observeXianyuSliderVerdicts(page: XianyuVerificationPage) {
  let current: { sequence: number; code?: number; success?: boolean } | undefined;
  let sequence = 0;
  const requestSequences = new WeakMap<XianyuVerificationRequest, number>();
  const pending = new Set<Promise<void>>();
  const requests = new Set<XianyuVerificationRequest>(); let unknown = 0;
  const slideUrl = (value: string) => { try { const url = new URL(value); return /\/slide\/?$/.test(url.pathname) && /(^|\.)goofish\.com$/.test(url.hostname); } catch { return false; } };
  const requestStarted = (request: XianyuVerificationRequest) => {
    if (!slideUrl(request.url?.() ?? '')) return;
    requestSequences.set(request, ++sequence); current = undefined; requests.add(request);
  };
  const requestFinished = (request: XianyuVerificationRequest) => { requests.delete(request); };
  const requestFailed = (request: XianyuVerificationRequest) => { if (requests.delete(request)) unknown++; };
  page.on?.('request', requestStarted); page.on?.('requestfinished', requestFinished); page.on?.('requestfailed', requestFailed);
  const listener = (response: XianyuVerificationResponse) => {
    let url: URL;
    try { url = new URL(response.url()); } catch { return; }
    if (!/\/slide\/?$/.test(url.pathname) || !/(^|\.)goofish\.com$/.test(url.hostname)) return;
    const request = response.request?.();
    const responseSequence = request && requestSequences.get(request);
    if (responseSequence === undefined) { unknown++; return; }
    const task = (async () => {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let payload: { code?: unknown; success?: unknown };
        try {
          payload = await Promise.race([response.json(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('SLIDER_RESPONSE_TIMEOUT')), 2000);
          })]) as typeof payload;
        } finally { if (timer) clearTimeout(timer); }
        const code = typeof payload.code === 'number' && Number.isInteger(payload.code) && payload.code >= 0 && payload.code <= 9999 ? payload.code : undefined;
        if (code === undefined) unknown++;
        const verdict = { sequence: responseSequence, ...(code === undefined ? {} : { code }), success: payload.success === true };
        if (responseSequence === sequence) current = verdict;
        console.info(JSON.stringify({ component: 'xianyu-verification', event: 'slider_platform_verdict', strategy: 'ydisks',
          code: verdict.code, platformResponseSuccess: verdict.success, passed: verdict.code === 0 && verdict.success === true, sequence: responseSequence, applied: responseSequence === sequence }));
      } catch {
        unknown++;
        console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'slider_platform_verdict_unavailable' }));
      }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  page.on?.('response', listener);
  return { read: () => current, watermark: () => sequence, pendingAnswers: () => requests.size + pending.size + unknown, close: async () => {
    page.off?.('response', listener); page.off?.('request', requestStarted); page.off?.('requestfinished', requestFinished); page.off?.('requestfailed', requestFailed);
    requests.clear(); await Promise.allSettled([...pending]);
  } };
}
