import { generatePhysicsTrajectory, replayTrajectory, type GeneratedSliderTrajectory } from './xianyu-slider-trajectory.js';
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

  constructor(private readonly page: XianyuSliderPage, options: XianyuSliderSolverOptions = {}) {
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
        });

        const generated = generatePhysicsTrajectory(elements.distance, {
          rng: this.rng,
          verticalLimit: Math.max(0.5, (elements.trackRect.height - elements.buttonRect.height) / 2),
        });
        result.distance = elements.distance;
        result.trajectoryPoints = generated.points.length;
        await this.simulateSlide(elements.button, elements.buttonRect, generated);

        const verification = await this.waitForVerificationResult(elements.container);
        if (verification.success) {
          result.success = true;
          result.failureReason = undefined;
          return result;
        }

        result.failureReason = verification.reason;
        result.errors.push(verification.reason);
        if (attempt >= this.maxRetries) break;
        if (verification.retry) {
          result.retryClicked = (await this.clickRetry(verification.retry)) || result.retryClicked;
        }
        if (!verification.retry || !result.retryClicked) {
          await this.reloadPage();
          result.pageReloaded = true;
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

  private async simulateSlide(button: XianyuSliderLocator, buttonRect: XianyuSliderRect, trajectory: GeneratedSliderTrajectory): Promise<void> {
    const startX = buttonRect.x + buttonRect.width / 2;
    const startY = buttonRect.y + buttonRect.height / 2;
    await this.page.mouse.move(startX - 24, startY - 4);
    await this.page.mouse.move(startX - 12, startY + 2);
    await sleep(120);
    await button.hover({ timeout: this.elementTimeoutMs });
    await this.page.mouse.move(startX, startY);
    await sleep(80);
    let pressed = false;
    try {
      await this.page.mouse.down({ button: 'left' });
      pressed = true;
      await sleep(90);
      await replayTrajectory(trajectory.points, startX, startY, (x, y) => this.page.mouse.move(x, y));
      await sleep(150);
    } finally {
      if (pressed) await this.page.mouse.up({ button: 'left' }).catch(() => undefined);
    }
  }

  private async waitForVerificationResult(container: XianyuSliderLocator): Promise<{ success: boolean; reason: string; retry?: XianyuSliderLocator }> {
    const deadline = Date.now() + this.verificationTimeoutMs;
    while (Date.now() < deadline) {
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

  private async reloadPage(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: Math.max(5_000, this.elementTimeoutMs * 5) });
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
 * NC's track box can start a couple of pixels before the draggable handle.
 * The usable travel is therefore the distance between the two right edges,
 * not the difference between the element widths.
 */
export function calculateSliderDistance(trackRect: XianyuSliderRect, buttonRect: XianyuSliderRect): number {
  const trackRight = trackRect.x + trackRect.width;
  const buttonRight = buttonRect.x + buttonRect.width;
  const distance = trackRight - buttonRight;
  return Number.isFinite(distance) ? Math.max(0, distance) : 0;
}
