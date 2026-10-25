import { setTimeout as delay } from 'node:timers/promises';
import type { XianyuVerificationPage, XianyuVerificationRequest } from './xianyu-browser-port.js';

/** Never expose a browser exception: it can contain signed URLs or credentials. */
export class XianyuBrowserStageError extends Error {
  constructor(prefix: string, stage: string, reason: string) { super(`${prefix}_${stage}_${reason}`); }
}

export function browserStageError(prefix: string, stage: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  const reason = /ERR_ABORTED|interrupted by another navigation/i.test(message) ? 'NAVIGATION_ABORTED'
    : /Execution context was destroyed|Cannot find context/i.test(message) ? 'CONTEXT_DESTROYED'
    : /Target.*closed|page.*closed|browser.*closed/i.test(message) ? 'CLOSED'
    : /timeout|timed out/i.test(message) ? 'TIMEOUT'
    : /net::ERR_/i.test(message) ? 'NETWORK_FAILED' : 'FAILED';
  return new XianyuBrowserStageError(prefix, stage, reason);
}

/**
 * Slider verdicts precede the page's own session exchange. Observe before the
 * solver runs, then let document/XHR/fetch callbacks settle without navigating
 * or deleting their cookies. Quietness only permits the business probe; it is
 * never evidence that an account or a risk has recovered.
 */
export async function completeBrowserChallenge(page: XianyuVerificationPage, solve: () => Promise<void>, prefix: string): Promise<void> {
  const pending = new Set<XianyuVerificationRequest>();
  let activity = Date.now();
  const started = (request: XianyuVerificationRequest) => {
    if (['document', 'xhr', 'fetch'].includes(request.resourceType())) {
      pending.add(request);
      activity = Date.now();
    }
  };
  const finished = (request: XianyuVerificationRequest) => {
    if (pending.delete(request)) activity = Date.now();
  };
  page.on?.('request', started);
  page.on?.('requestfinished', finished);
  page.on?.('requestfailed', finished);
  try {
    await solve();
    const accepted = Date.now();
    let previousUrl = page.url();
    while (Date.now() - accepted < 10_000) {
      const currentUrl = page.url();
      if (currentUrl !== previousUrl) { previousUrl = currentUrl; activity = Date.now(); }
      let ready = false;
      try { ready = await page.evaluate(() => document.readyState === 'complete'); }
      catch (error) {
        const classified = browserStageError(prefix, 'CHALLENGE_HANDOFF', error);
        if (!classified.message.endsWith('_CONTEXT_DESTROYED')) throw classified;
        activity = Date.now();
      }
      if (ready && pending.size === 0 && Date.now() - accepted >= 1_000 && Date.now() - activity >= 500) return;
      await delay(50);
    }
    throw new XianyuBrowserStageError(prefix, 'CHALLENGE_HANDOFF', 'TIMEOUT');
  } finally {
    page.off?.('request', started);
    page.off?.('requestfinished', finished);
    page.off?.('requestfailed', finished);
  }
}
