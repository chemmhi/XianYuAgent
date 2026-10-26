import type { XianyuVerificationPage } from './xianyu-browser-port.js';
import { isNativeXianyuMtopChallenge, nativeXianyuChallengePresentationUrl } from './xianyu-challenge-presentation.js';

/** Use the platform's actual embedded rendering branch in the same original
 * page/context. This never loads the account/chat application or changes the
 * challenge signature, device identity, native callback or business checks. */
export async function presentNativeXianyuChallengeFrame(page: XianyuVerificationPage, value: string, timeout: number): Promise<boolean> {
  if (!isNativeXianyuMtopChallenge(value)) return false;
  const current = new URL(page.url());
  if (!['https://www.goofish.com', 'https://seller.goofish.com'].includes(current.origin) || current.pathname !== '/robots.txt') {
    await page.goto('https://www.goofish.com/robots.txt', { waitUntil: 'domcontentloaded', timeout });
  }
  // scripts+same-origin only isolates a cross-origin child. A same-origin
  // child could otherwise access frameElement and remove its own sandbox.
  if (new URL(page.url()).origin === new URL(value).origin) throw new Error('VERIFICATION_NATIVE_FRAME_ORIGIN_UNSAFE');
  await page.evaluate(({ url, timeout }) => new Promise<void>((resolve, reject) => {
    // Keep redirects cross-origin too: an initially isolated child must not
    // navigate onto the parent origin and then remove its sandbox. This CSP
    // is enforced by the browser before child document scripts can execute.
    if (!document.getElementById('xianyu-native-frame-policy')) {
      const policy = document.createElement('meta'); policy.id = 'xianyu-native-frame-policy'; policy.httpEquiv = 'Content-Security-Policy';
      policy.content = `frame-src ${['https://h5api.m.goofish.com', 'https://punish.goofish.com', 'https://captcha.goofish.com', 'https://www.goofish.com'].filter(origin => origin !== location.origin).join(' ')}`;
      document.head.append(policy);
    }
    const existing = document.getElementById('xianyu-native-challenge-frame');
    if (existing) existing.remove();
    const frame = document.createElement('iframe'); frame.id = 'xianyu-native-challenge-frame';
    frame.title = '安全验证'; frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.style.cssText = 'position:fixed;left:20px;top:20px;width:420px;height:320px;border:0;background:white;z-index:2147483647';
    const timer = setTimeout(() => reject(new Error('VERIFICATION_NATIVE_FRAME_TIMEOUT')), timeout);
    frame.onload = () => { clearTimeout(timer); resolve(); };
    frame.onerror = () => { clearTimeout(timer); reject(new Error('VERIFICATION_NATIVE_FRAME_UNAVAILABLE')); };
    frame.src = url; document.body.append(frame);
  }), { url: nativeXianyuChallengePresentationUrl(value), timeout });
  return true;
}
