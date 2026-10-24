export interface XianyuSliderLocator {
  first(): XianyuSliderLocator;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  boundingBox(): Promise<XianyuSliderRect | null>;
  textContent(): Promise<string | null>;
  hover(options?: { timeout?: number }): Promise<void>;
  click(options?: { timeout?: number }): Promise<void>;
  evaluate<T, A>(pageFunction: (element: HTMLElement, arg: A) => T | Promise<T>, arg: A, options?: { timeout?: number }): Promise<T>;
}

export interface XianyuSliderFrame {
  locator(selector: string): XianyuSliderLocator;
}

export interface XianyuSliderPage extends XianyuSliderFrame {
  url(): string;
  frames(): readonly XianyuSliderFrame[];
  mouse: {
    move(x: number, y: number, options?: { steps?: number }): Promise<void>;
    wheel(deltaX: number, deltaY: number): Promise<void>;
    down(options?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
    up(options?: { button?: 'left' | 'right' | 'middle' }): Promise<void>;
  };
  reload(options?: { waitUntil?: 'domcontentloaded' | 'load' | 'networkidle'; timeout?: number }): Promise<unknown>;
}

export interface XianyuSliderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
