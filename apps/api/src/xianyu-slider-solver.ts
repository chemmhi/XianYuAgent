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
  containerDescriptor?: string;
  buttonDescriptor?: string;
  trackDescriptor?: string;
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
  private readonly debugInput = process.env.XIANYU_VERIFICATION_DEBUG_INPUT === 'true';

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

        this.logger?.info('xianyu slider elements detected', {
          attempt,
          distance: elements.distance,
          buttonRect: elements.buttonRect,
          trackRect: elements.trackRect,
          container: elements.containerDescriptor,
          button: elements.buttonDescriptor,
          track: elements.trackDescriptor,
        });

        const generated = generatePhysicsTrajectory(elements.distance, { rng: this.rng });
        result.distance = elements.distance;
        result.trajectoryPoints = generated.points.length;
        await this.simulateSlide(elements.buttonRect, generated, attempt === 2);

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

  private async simulateSlide(buttonRect: Rect, trajectory: GeneratedSliderTrajectory, useTouch = false): Promise<void> {
    const startX = buttonRect.x + buttonRect.width / 2;
    const startY = buttonRect.y + buttonRect.height / 2;
    // Recreate the hover/settle phase used by the browser implementation so
    // the widget sees pointerover/mouseover before the press.
    await this.moveMouse(startX - 24, startY - 4, false);
    await this.moveMouse(startX - 12, startY + 2, false);
    await sleep(120);
    await this.moveMouse(startX, startY, false);
    await sleep(80);
    if (this.debugInput) await this.installInputTrace();
    let pressed = false;
    let releaseX = startX;
    let releaseY = startY;
    try {
    if (useTouch) {
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY, radiusX: 8, radiusY: 8, force: 0.8, id: 1 }] });
    } else {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    }
      pressed = true;
      // A short hold after mouse-down matches the reference implementation's
      // human pause before the first drag sample.
      await sleep(90);
      await replayTrajectory(
        trajectory.points,
        startX,
        startY,
        async (x, y) => {
          releaseX = x;
          releaseY = y;
          // Keep the generated overshoot/rebound samples intact. The widget
          // itself clamps the handle; clamping CDP coordinates removes the
          // correction phase that the original solver relies on.
          if (useTouch) await this.moveTouch(x, y);
          else await this.moveMouse(x, y, true);
        },
      );
      if (this.debugInput) {
        const trace = await this.readInputTrace();
        this.logger?.info('xianyu slider input trace', trace);
      }
      // Do not release immediately at the final sample; the reference flow
      // pauses briefly to let the widget settle before mouse-up.
      await sleep(150);
    } finally {
      if (pressed) {
        if (useTouch) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => undefined);
        else await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: releaseX, y: releaseY, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' }).catch(() => undefined);
      }
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
      await this.moveMouse(x, y, false);
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
      return true;
    } catch {
      return false;
    }
  }

  private async moveMouse(x: number, y: number, dragging: boolean): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: dragging ? 'left' : 'none', buttons: dragging ? 1 : 0, pointerType: 'mouse' });
  }

  private async moveTouch(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 0.8, id: 1 }] });
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const response = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error('XIANYU_SLIDER_RUNTIME_EVALUATION_FAILED');
    const value = (response.result as { value?: unknown } | undefined)?.value;
    return value as T;
  }

  private async installInputTrace(): Promise<void> {
    await this.evaluate(`(() => {
      const target = window;
      target.__xianyuInputTrace = [];
      const record = (event) => {
        const trace = target.__xianyuInputTrace;
        if (!Array.isArray(trace) || trace.length >= 120) return;
        trace.push({ type: event.type, x: event.clientX, y: event.clientY, buttons: event.buttons, button: event.button, trusted: event.isTrusted, time: event.timeStamp });
      };
      for (const type of ['pointerover', 'pointermove', 'pointerdown', 'pointerup', 'mousedown', 'mousemove', 'mouseup']) target.addEventListener(type, record, true);
      return true;
    })()`);
  }

  private async readInputTrace(): Promise<Record<string, unknown>> {
    return this.evaluate(`(() => {
      const trace = Array.isArray(window.__xianyuInputTrace) ? window.__xianyuInputTrace : [];
      const button = document.querySelector('#nc_1_n1z');
      return {
        count: trace.length,
        first: trace[0],
        last: trace.at(-1),
        trustedCount: trace.filter((event) => event.trusted).length,
        buttonStyle: button?.getAttribute('style') ?? null,
        buttonLeft: button ? getComputedStyle(button).left : null,
      };
    })()`);
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
      // The NC widget validates the logical slider travel using its own
      // track/button widths. The visible handle is inset by a small border,
      // so calculating from the current right edge under-travels by 2px and
      // is rejected even when the geometry looks aligned on screen.
      const distance = Math.max(0, trackRect.width - buttonRect.width);
      const describe = (element) => element ? element.tagName.toLowerCase() + '#' + (element.id || '') + '.' + String(element.className || '').replace(/\s+/g, '.') : undefined;
      return { containerRect: rect(container), buttonRect, trackRect, distance, containerDescriptor: describe(container), buttonDescriptor: describe(button), trackDescriptor: describe(track) };
    }
    return null;
  })()`;
}

function buildProbeScript(): string {
  return `(() => {
    const containerSelectors = ${JSON.stringify(DEFAULT_CONTAINER_SELECTORS)};
    const retrySelectors = ['#nc_1_refresh1', '.errloading', '[class*="retry"]', '.nc-lang-cnt', '[aria-label*="重试"]', '[aria-label*="验证失败"]'];
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
      const text = (container?.innerText || container?.textContent || '').trim();
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
