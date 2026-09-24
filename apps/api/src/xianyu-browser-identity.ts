const DEFAULT_XIANYU_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

export const XIANYU_USER_AGENT = process.env.XIANYU_BROWSER_USER_AGENT?.trim() || DEFAULT_XIANYU_USER_AGENT;

export function xianyuChromeVersion(userAgent = XIANYU_USER_AGENT): string {
  return /Chrome\/([\d.]+)/i.exec(userAgent)?.[1] ?? '153.0.0.0';
}

export function xianyuSecChUa(userAgent = XIANYU_USER_AGENT): string {
  const major = xianyuChromeVersion(userAgent).split('.')[0] || '153';
  return `"Not(A:Brand";v="99", "Chromium";v="${major}", "Google Chrome";v="${major}"`;
}
