import { executeYdisksGesture, generateYdisksTrajectory, prepareYdisksPage } from './xianyu-slider-ydisks.js';
import type { XianyuSliderFrame, XianyuSliderLocator, XianyuSliderPage, XianyuSliderRect } from './xianyu-slider-port.js';

export type { XianyuSliderFrame, XianyuSliderLocator, XianyuSliderPage, XianyuSliderRect } from './xianyu-slider-port.js';

export type XianyuSliderMode = 'disabled' | 'auto';

export interface XianyuSliderSolverOptions {
  maxRetries?: number;
  elementTimeoutMs?: number;
  verificationTimeoutMs?: number;
  verificationPollMs?: number;
  retryDelayMs?: number;
  rng?: () => number;
  logger?: Pick<Console, 'info' | 'warn'>;
  readVerdict?: () => { sequence: number; code?: number; success?: boolean } | undefined;
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
  protocolCodes: number[];
}

interface SliderElementSnapshot {
  button: XianyuSliderLocator;
  container: XianyuSliderLocator;
  frame: XianyuSliderFrame;
  buttonRect: XianyuSliderRect;
  trackRect: XianyuSliderRect;
  distance: number;
}

interface SliderProbeSnapshot {
  container?: XianyuSliderLocator;
  retry?: XianyuSliderLocator;
  failureText?: string;
  pageUrl: string;
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

const DEFAULT_FAILURE_KEYWORDS = ['验证失败', '点击框体重试', '滑动验证失败', '验证码错误', '换一换', '哎呀，出错了'];

export class XianyuSliderSolver {
  private readonly maxRetries: number;
  private readonly elementTimeoutMs: number;
  private readonly verificationTimeoutMs: number;
  private readonly verificationPollMs: number;
  private readonly retryDelayMs: number;
  private readonly rng: () => number;
  private readonly logger?: Pick<Console, 'info' | 'warn'>;
  private readonly readVerdict?: XianyuSliderSolverOptions['readVerdict'];

  constructor(private readonly page: XianyuSliderPage, options: XianyuSliderSolverOptions = {}) {
    this.maxRetries = Math.max(1, Math.floor(options.maxRetries ?? 3));
    this.elementTimeoutMs = Math.max(100, Math.floor(options.elementTimeoutMs ?? 15_000));
    this.verificationTimeoutMs = Math.max(250, Math.floor(options.verificationTimeoutMs ?? 4_000));
    this.verificationPollMs = Math.max(25, Math.floor(options.verificationPollMs ?? 200));
    this.retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 700));
    this.rng = options.rng ?? Math.random;
    this.logger = options.logger;
    this.readVerdict = options.readVerdict;
  }

  async solve(): Promise<XianyuSliderSolveResult> {
    const result: XianyuSliderSolveResult = {
      success: false,
      attempts: 0,
      trajectoryPoints: 0,
      retryClicked: false,
      pageReloaded: false,
      errors: [],
      protocolCodes: [],
    };
    await prepareYdisksPage(this.page, this.rng);

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
          strategy: 'ydisks',
        });

        const generated = generateYdisksTrajectory(elements.distance + this.rng() - 0.5,
          (elements.trackRect.height || elements.buttonRect.height) / 2, this.rng);
        result.distance = generated.distance;
        result.trajectoryPoints = generated.points.length;
        const verdictStart = this.readVerdict?.()?.sequence ?? 0;
        const accepted = () => {
          const verdict = this.readVerdict?.();
          return Boolean(verdict && verdict.sequence > verdictStart && verdict.code === 0 && verdict.success === true);
        };
        await executeYdisksGesture(this.page, elements.button, elements.buttonRect, generated, this.rng, accepted);

        const verification = await this.waitForVerificationResult(elements.container, verdictStart);
        const verdict = this.readVerdict?.();
        if (verdict && verdict.sequence > verdictStart && verdict.code !== undefined) result.protocolCodes.push(verdict.code);
        if (verification.success) {
          result.success = true;
          result.failureReason = undefined;
          return result;
        }

        result.failureReason = verification.reason;
        result.errors.push(verification.reason);
        if (attempt >= this.maxRetries) break;
        if (!await this.recoverControl(() => { result.retryClicked = true; })) break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failureReason = `exception:${error instanceof Error ? error.name : 'Error'}`;
        result.errors.push(message);
        this.logger?.warn('xianyu slider attempt failed', { attempt, message });
        if (attempt < this.maxRetries && !await this.recoverControl(() => { result.retryClicked = true; })) break;
      }
    }

    return result;
  }

  private async waitForElements(timeoutMs = this.elementTimeoutMs): Promise<SliderElementSnapshot | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of this.iterFrames()) {
        const container = await this.firstVisible(frame, DEFAULT_CONTAINER_SELECTORS);
        if (!container) continue;
        const button = await this.firstVisible(frame, DEFAULT_BUTTON_SELECTORS);
        const track = await this.firstVisible(frame, DEFAULT_TRACK_SELECTORS);
        if (!button || !track) continue;
        const buttonRect = await button.boundingBox();
        const trackRect = await track.boundingBox();
        if (!buttonRect || !trackRect) continue;
        const distance = calculateSliderDistance(trackRect, buttonRect);
        if (distance > 0) return { button, container, frame, buttonRect, trackRect, distance };
      }
      await sleep(Math.min(100, this.elementTimeoutMs));
    }
    return undefined;
  }

  private async waitForVerificationResult(container: XianyuSliderLocator, verdictStart: number): Promise<{ success: boolean; reason: string; retry?: XianyuSliderLocator }> {
    const deadline = Date.now() + this.verificationTimeoutMs;
    while (Date.now() < deadline) {
      const verdict = this.readVerdict?.();
      if (verdict && verdict.sequence > verdictStart && verdict.code !== undefined) {
        return { success: verdict.code === 0 && verdict.success === true, reason: `platform_code:${verdict.code}` };
      }
      const probe = await this.probe(container);
      if (!probe.container || isPostVerificationUrl(probe.pageUrl)) return { success: true, reason: 'verification_succeeded' };
      if (probe.failureText) return { success: false, reason: `failure_keyword:${probe.failureText}`, retry: probe.retry };
      await sleep(this.verificationPollMs);
    }
    const probe = await this.probe(container);
    if (!probe.container || isPostVerificationUrl(probe.pageUrl)) return { success: true, reason: 'verification_succeeded' };
    return { success: false, reason: 'verification_timeout', retry: probe.retry };
  }

  private async probe(container: XianyuSliderLocator): Promise<SliderProbeSnapshot> {
    const containerVisible = await container.isVisible({ timeout: 250 }).catch(() => false);
    const text = (await container.textContent().catch(() => null))?.trim() ?? '';
    const failureText = DEFAULT_FAILURE_KEYWORDS.find((keyword) => text.includes(keyword));
    let retry: XianyuSliderLocator | undefined;
    if (failureText) {
      for (const frame of this.iterFrames()) {
        retry = await this.firstVisible(frame, ['#nc_1_refresh1', '.errloading', '[class*="retry"]', '[aria-label*="重试"]', '[aria-label*="验证失败"]', '.nc-lang-cnt']);
        if (retry) break;
      }
    }
    return { container: containerVisible ? container : undefined, retry, failureText, pageUrl: this.page.url() };
  }

  private async clickRetry(retry: XianyuSliderLocator): Promise<boolean> {
    try {
      await retry.click({ timeout: this.elementTimeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  private async recoverControl(onRetryClicked: () => void): Promise<boolean> {
    const deadline = Date.now() + 800;
    let retry: XianyuSliderLocator | undefined;
    do {
      for (const selector of ['#nc_1_refresh1', '.nc_iconfont.btn_refresh', '.errloading', '[class*="refresh"]']) {
        for (const frame of this.iterFrames()) {
          retry = await this.firstVisible(frame, [selector]);
          if (retry) break;
        }
        if (retry) break;
      }
      if (!retry) for (const frame of this.iterFrames()) {
        const container = await this.firstVisible(frame, ['.nc-container']);
        const text = (await container?.textContent().catch(() => '') ?? '').toLowerCase();
        if (['重试', '刷新', '失败', 'retry', 'refresh', 'failed'].some(word => text.includes(word))) { retry = container; break; }
      }
      if (!retry) await sleep(150);
    } while (!retry && Date.now() < deadline);
    if (!retry || !await this.clickRetry(retry)) return false;
    onRetryClicked();
    const resetDeadline = Date.now() + 4000;
    while (Date.now() < resetDeadline) {
      await sleep(300);
      const control = await this.waitForElements(Math.min(250, resetDeadline - Date.now()));
      if (control && Math.abs(control.buttonRect.x - control.trackRect.x) <= 3) return true;
    }
    return false;
  }

  private iterFrames(): XianyuSliderFrame[] {
    const frames = [this.page as unknown as XianyuSliderFrame, ...this.page.frames()];
    return frames.filter((frame, index) => frames.indexOf(frame) === index);
  }

  private async firstVisible(frame: XianyuSliderFrame, selectors: readonly string[]): Promise<XianyuSliderLocator | undefined> {
    for (const selector of selectors) {
      try {
        const locator = frame.locator(selector).first();
        if (await locator.isVisible({ timeout: Math.min(250, this.elementTimeoutMs) })) return locator;
      } catch {
        // A frame can disappear while NC replaces the challenge. Probe the next one.
      }
    }
    return undefined;
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

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function solveXianyuSlider(page: XianyuSliderPage, options?: XianyuSliderSolverOptions): Promise<XianyuSliderSolveResult> {
  return new XianyuSliderSolver(page, options).solve();
}

/**
 * Match the pinned Ydisks browser measurement. NC clamps the controlled
 * overshoot; border offsets must not shorten the measured track width.
 */
export function calculateSliderDistance(trackRect: XianyuSliderRect, buttonRect: XianyuSliderRect): number {
  const distance = trackRect.width - buttonRect.width;
  return Number.isFinite(distance) ? Math.max(0, distance) : 0;
}
