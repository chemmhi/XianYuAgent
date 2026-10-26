import { VerificationError } from './verification-domain.js';
import { isNativeXianyuMtopChallenge } from './xianyu-challenge-presentation.js';

export interface NativeVerificationCandidate { value: string; expire: number; host: string }
export interface NativeVerificationChallenge {
  /** Ephemeral platform URL. Never persist in session rows or broadcast DTOs. */
  url: string;
  applyCandidate(candidate: NativeVerificationCandidate): Promise<void>;
}
export interface NativeVerificationControl {
  adminId: string; authSessionId: string; clientId: string; leaseId: string;
  challengeGeneration: number; controlEpoch: number;
}

export function nativeVerificationUrl(value: string): string {
  if (!isNativeXianyuMtopChallenge(value)) throw new VerificationError('VERIFICATION_NATIVE_UNAVAILABLE', 422);
  const url = new URL(value);
  if (url.searchParams.has('addCookieToHeader')) return value;
  const index = value.indexOf('#'), base = index < 0 ? value : value.slice(0, index), hash = index < 0 ? '' : value.slice(index);
  return `${base}${base.includes('?') ? /[?&]$/.test(base) ? '' : '&' : '?'}addCookieToHeader=1${hash}`;
}

/** The SDK's child message is an untrusted credential candidate, never a
 * strict platform verdict. Only this issued host and one Cookie are allowed. */
export function nativeVerificationCandidate(input: unknown, challengeUrl: string, now: number): NativeVerificationCandidate {
  const value = input as Partial<NativeVerificationCandidate> | null;
  const host = new URL(nativeVerificationUrl(challengeUrl)).host;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['value', 'expire', 'host'].includes(k))
    || value.host !== host || typeof value.value !== 'string' || !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,8192}$/.test(value.value)
    || typeof value.expire !== 'number' || !Number.isFinite(value.expire) || value.expire <= now || value.expire > now + 86_400_000) {
    throw new VerificationError('VERIFICATION_NATIVE_CANDIDATE_INVALID', 422);
  }
  return { value: value.value, expire: value.expire, host };
}
