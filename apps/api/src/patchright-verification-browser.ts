import type { XianyuVerificationBrowserFactory, XianyuVerificationContext, XianyuVerificationLaunchOptions } from './xianyu-browser-port.js';

/**
 * The only browser-library adapter used by verification.
 *
 * Patchright is loaded lazily so normal API startup and non-verification paths
 * do not eagerly load a browser runtime. No CDP fallback belongs here.
 */
export function createPatchrightVerificationBrowserFactory(): XianyuVerificationBrowserFactory {
  return {
    async launchPersistentContext(options: XianyuVerificationLaunchOptions): Promise<XianyuVerificationContext> {
      const { chromium } = await import('patchright');
      const context = await chromium.launchPersistentContext(options.profileDir, {
        channel: options.executablePath ? undefined : 'chrome',
        ...(options.executablePath ? { executablePath: options.executablePath } : {}),
        headless: options.headless,
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        viewport: { width: 1440, height: 900 },
        locale: 'zh-CN',
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=AutomationControlled',
          '--disable-popup-blocking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-extensions',
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=1440,900',
          '--lang=zh-CN',
          ...(!options.headless && options.hideWindow ? ['--start-minimized', '--window-position=-32000,-32000'] : []),
          ...(!options.headless && !options.hideWindow ? ['--start-minimized'] : []),
        ],
      });
      return context as unknown as XianyuVerificationContext;
    },
  };
}
