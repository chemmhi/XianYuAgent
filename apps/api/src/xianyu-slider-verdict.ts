import type { XianyuVerificationPage, XianyuVerificationResponse } from './xianyu-browser-port.js';

/** Keep only the verdict, never the challenge URL, signature or response body. */
export function observeXianyuSliderVerdicts(page: XianyuVerificationPage) {
  let current: { sequence: number; code?: number; success?: boolean } | undefined;
  let sequence = 0;
  const pending = new Set<Promise<void>>();
  const listener = (response: XianyuVerificationResponse) => {
    let url: URL;
    try { url = new URL(response.url()); } catch { return; }
    if (!/\/slide\/?$/.test(url.pathname) || !/(^|\.)goofish\.com$/.test(url.hostname)) return;
    const task = (async () => {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let payload: { code?: unknown; success?: unknown };
        try {
          payload = await Promise.race([response.json(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('SLIDER_RESPONSE_TIMEOUT')), 2000);
          })]) as typeof payload;
        } finally { if (timer) clearTimeout(timer); }
        current = { sequence: ++sequence, ...(typeof payload.code === 'number' ? { code: payload.code } : {}), success: payload.success === true };
        console.info(JSON.stringify({ component: 'xianyu-verification', event: 'slider_platform_verdict', strategy: 'ydisks',
          code: current.code, success: current.success, sequence }));
      } catch {
        console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'slider_platform_verdict_unavailable' }));
      }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  page.on?.('response', listener);
  return { read: () => current, close: async () => { page.off?.('response', listener); await Promise.allSettled([...pending]); } };
}
