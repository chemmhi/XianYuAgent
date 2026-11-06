import { constants, createPublicKey, publicEncrypt } from 'node:crypto';

/** JSON only: never evaluates scripts supplied by the remote login document. */
export function loginJsonAssignment(html: string, marker: string): Record<string, unknown> {
  const position = html.indexOf(marker); if (position < 0) throw new Error('PASSWORD_LOGIN_BOOTSTRAP_INVALID');
  const start = html.indexOf('{', position); let depth = 0, quoted = false, escaped = false;
  for (let i = start; i >= 0 && i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { break; }
    }
  }
  throw new Error('PASSWORD_LOGIN_BOOTSTRAP_INVALID');
}
function hexBytes(hex: string) { return Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex'); }
/** Same PKCS#1 v1.5 / UTF-16-unit encoding / even-length hex contract as havana-nlogin 0.10.38. */
export function encryptXianyuPassword(password: string, modulus: string, exponent: string): string {
  if (!/^[0-9a-f]{256,1024}$/i.test(modulus) || !/^[0-9a-f]{1,8}$/i.test(exponent)) throw new Error('PASSWORD_LOGIN_RSA_INVALID');
  const bytes: number[] = [];
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    if (c < 128) bytes.push(c); else if (c < 2048) bytes.push((c >> 6) | 192, (c & 63) | 128);
    else bytes.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128);
  }
  if (bytes.length > hexBytes(modulus).length - 11) throw new Error('PASSWORD_LOGIN_LENGTH_UNSUPPORTED');
  const key = createPublicKey({ format: 'jwk', key: { kty: 'RSA', n: hexBytes(modulus).toString('base64url'), e: hexBytes(exponent).toString('base64url') } });
  const hex = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(bytes)).toString('hex').replace(/^0+/, '');
  return hex.length % 2 ? '0' + hex : hex;
}
export function loginFormFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PASSWORD_LOGIN_BOOTSTRAP_INVALID');
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v == null || ['string','number','boolean'].includes(typeof v)).map(([k,v]) => [k, v == null ? '' : String(v)]));
}
