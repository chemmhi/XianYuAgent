import { generatePhysicsTrajectory, replayTrajectory, type GeneratedSliderTrajectory } from './xianyu-slider-trajectory.js';

export interface SliderCdpConnection {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export type XianyuSliderMode = 'disabled' | 'auto';

export interface XianyuSliderSolverOptions {
  maxRetries?: number;
  elementTimeoutMs?: number;
  verificationTimeoutMs?: number;
  verificationPollMs?: number;
  retryDelayMs?: number;
  rng?: () => number;
  logger?: Pick<Console, 'info' | 'warn'>;
}

export interface XianyuSliderSolveResult {
  success: boolean;
  attempts: number;
  distance?: number;
  trajectoryPoints: number;
  retryClicked: boolean;
  pageReloaded: boolean;
  failureReason?: string;
  errors: string[];
}

interface SliderElementSnapshot {
  containerRect: Rect;
  buttonRect: Rect;
  trackRect: Rect;
  distance: number;
}

interface SliderProbeSnapshot {
  containerVisible: boolean;
  failureText?: string;
  pageUrl: string;
  retryRect?: Rect;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_CONTAINER_SELECTORS = [
  '.nc-container',
  '#nocaptcha',
  '.nc_wrapper',
  '.scratch-captcha',
  '.scratch-captcha-slider',
  '[class*="captcha"]',
];

const DEFAULT_BUTTON_SELECTORS = [
  '#nc_1_n1z',
  '.nc_iconfont',
  '.btn_slide',
  '#scratch-captcha-btn',
  '.scratch-captcha-slider .button',
  '[class*="slider"]',
  '[class*="btn"]',
  '[role="button"]',
];

const DEFAULT_TRACK_SELECTORS = [
  '#nc_1_n1t',
  '.nc_scale',
  '.nc-lang-cnt',
  '.slider-track',
  '.track',
  '[class*="track"]',
  '[class*="scale"]',
];

const DEFAULT_FAILURE_KEYWORDS = ['验证失败', '点击框体重试', '滑动验证失败', '验证码错误', '换一换'];

export class XianyuSliderSolver {
  private readonly maxRetries: number;
  private readonly elementTimeoutMs: number;
  private readonly verificationTimeoutMs: number;
  private readonly verificationPollMs: number;
  private readonly retryDelayMs: number;
  private readonly rng: () => number;
  private readonly logger?: Pick<Console, 'info' | 'warn'>;

  constructor(private readonly cdp: SliderCdpConnection, options: XianyuSliderSolverOptions = {}) {
    this.maxRetries = Math.max(1, Math.floor(options.maxRetries ?? 3));
    this.elementTimeoutMs = Math.max(100, Math.floor(options.elementTimeoutMs ?? 2_000));
    this.verificationTimeoutMs = Math.max(250, Math.floor(options.verificationTimeoutMs ?? 4_000));
    this.verificationPollMs = Math.max(25, Math.floor(options.verificationPollMs ?? 200));
    this.retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 700));
    this.rng = options.rng ?? Math.random;
    this.logger = options.logger;
  }

  async solve(): Promise<XianyuSliderSolveResult> {
    const result: XianyuSliderSolveResult = {
      success: false,
      attempts: 0,
      trajectoryPoints: 0,
      retryClicked: false,
      pageReloaded: false,
      errors: [],
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      result.attempts = attempt;
      if (attempt > 1 && this.retryDelayMs > 0) await sleep(this.retryDelayMs);
      try {
        const elements = await this.waitForElements();
        if (!elements) {
          result.failureReason = 'slider_elements_not_found';
          result.errors.push(result.failureReason);
          break;
        }
        if (elements.distance <= 0) {
          result.failureReason = 'invalid_slide_distance';
          result.errors.push(result.failureReason);
          break;
        }

        const generated = generatePhysicsTrajectory(elements.distance, { rng: this.rng });
        result.distance = elements.distance;
        result.trajectoryPoints = generated.points.length;
        await this.simulateSlide(elements.buttonRect, generated);

        const verification = await this.waitForVerificationResult();
        if (verification.success) {
          result.success = true;
          result.failureReason = undefined;
          return result;
        }

        result.failureReason = verification.reason;
        result.errors.push(verification.reason);
        if (attempt < this.maxRetries) {
          if (verification.retryRect) {
            result.retryClicked = (await this.clickRect(verification.retryRect)) || result.retryClicked;
          } else {
            await this.cdp.send('Page.reload', { ignoreCache: true }).catch(() => undefined);
            result.pageReloaded = true;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failureReason = `exception:${error instanceof Error ? error.name : 'Error'}`;
        result.errors.push(message);
        this.logger?.warn('xianyu slider attempt failed', { attempt, message });
      }
    }

    return result;
  }

  private async waitForElements(): Promise<SliderElementSnapshot | undefined> {
    const deadline = Date.now() + this.elementTimeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await this.evaluate<SliderElementSnapshot | null>(buildFindElementsScript());
      if (snapshot && snapshot.distance > 0) return snapshot;
      await sleep(Math.min(100, this.elementTimeoutMs));
    }
    return undefined;
  }

  private async simulateSlide(buttonRect: Rect, trajectory: GeneratedSliderTrajectory): Promise<void> {
    const startX = buttonRect.x + buttonRect.width / 2;
    const startY = buttonRect.y + buttonRect.height / 2;
    await this.moveMouse(startX - 20, startY);
    await sleep(120);
    await this.moveMouse(startX, startY);
    await sleep(80);
    let pressed = false;
    let releaseX = startX;
    let releaseY = startY;
    try {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', clickCount: 1 });
      pressed = true;
      await replayTrajectory(
        trajectory.points,
        startX,
        startY,
        async (x, y) => {
          releaseX = x;
          releaseY = y;
          await this.moveMouse(x, y);
        },
      );
    } finally {
      if (pressed) await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: releaseX, y: releaseY, button: 'left', clickCount: 1 }).catch(() => undefined);
    }
  }

  private async waitForVerificationResult(): Promise<{ success: boolean; reason: string; retryRect?: Rect }> {
    const deadline = Date.now() + this.verificationTimeoutMs;
    while (Date.now() < deadline) {
      const state = await this.evaluate<SliderProbeSnapshot>(buildProbeScript());
      if (!state.containerVisible || isPostVerificationUrl(state.pageUrl)) return { success: true, reason: 'verification_succeeded' };
      if (state.failureText) return { success: false, reason: `failure_keyword:${state.failureText}`, retryRect: state.retryRect };
      await sleep(this.verificationPollMs);
    }
    const state = await this.evaluate<SliderProbeSnapshot>(buildProbeScript());
    if (!state.containerVisible || isPostVerificationUrl(state.pageUrl)) return { success: true, reason: 'verification_succeeded' };
    return { success: false, reason: 'verification_timeout', retryRect: state.retryRect };
  }

  private async clickRect(rect: Rect): Promise<boolean> {
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    try {
      await this.moveMouse(x, y);
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      return true;
    } catch {
      return false;
    }
  }

  private async moveMouse(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const response = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error('XIANYU_SLIDER_RUNTIME_EVALUATION_FAILED');
    const value = (response.result as { value?: unknown } | undefined)?.value;
    return value as T;
  }
}

export function isPostVerificationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return !/captcha|punish|verify|security/i.test(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return false;
  }
}

function buildFindElementsScript(): string {
  return `(() => {
    const containerSelectors = ${JSON.stringify(DEFAULT_CONTAINER_SELECTORS)};
    const buttonSelectors = ${JSON.stringify(DEFAULT_BUTTON_SELECTORS)};
    const trackSelectors = ${JSON.stringify(DEFAULT_TRACK_SELECTORS)};
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const rect = (element) => { const box = element.getBoundingClientRect(); return { x: box.left, y: box.top, width: box.width, height: box.height }; };
    const first = (root, selectors) => selectors.map((selector) => root.querySelector(selector)).find(visible);
    const documents = [];
    const visit = (root) => {
      documents.push(root);
      root.querySelectorAll('iframe').forEach((frame) => { try { if (frame.contentDocument) visit(frame.contentDocument); } catch {} });
    };
    visit(document);
    for (const root of documents) {
      const container = first(root, containerSelectors);
      if (!container) continue;
      const button = first(root, buttonSelectors);
      const track = first(root, trackSelectors);
      if (!button || !track) continue;
      const buttonRect = rect(button);
      const trackRect = rect(track);
      return { containerRect: rect(container), buttonRect, trackRect, distance: Math.max(0, trackRect.width - buttonRect.width) };
    }
    return null;
  })()`;
}

function buildProbeScript(): string {
  return `(() => {
    const containerSelectors = ${JSON.stringify(DEFAULT_CONTAINER_SELECTORS)};
    const retrySelectors = ['[class*="retry"]', '.nc-lang-cnt', '[aria-label*="重试"]', '[aria-label*="验证失败"]'];
    const failureKeywords = ${JSON.stringify(DEFAULT_FAILURE_KEYWORDS)};
    const visible = (element) => {
      if (!element) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const rect = (element) => { const box = element.getBoundingClientRect(); return { x: box.left, y: box.top, width: box.width, height: box.height }; };
    const documents = [];
    const visit = (root) => {
      documents.push(root);
      root.querySelectorAll('iframe').forEach((frame) => { try { if (frame.contentDocument) visit(frame.contentDocument); } catch {} });
    };
    visit(document);
    let container;
    let retry;
    let failureText;
    for (const root of documents) {
      container = container || containerSelectors.map((selector) => root.querySelector(selector)).find(visible);
      const text = (root.body?.innerText || '').trim();
      failureText = failureKeywords.find((keyword) => text.includes(keyword));
      retry = retry || retrySelectors.map((selector) => root.querySelector(selector)).find(visible);
    }
    return { containerVisible: Boolean(container), failureText, pageUrl: location.href, retryRect: retry ? rect(retry) : undefined };
  })()`;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function solveXianyuSlider(cdp: SliderCdpConnection, options?: XianyuSliderSolverOptions): Promise<XianyuSliderSolveResult> {
  return new XianyuSliderSolver(cdp, options).solve();
}
