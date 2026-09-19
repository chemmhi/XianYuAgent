import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function digestJson(value: unknown): string {
  return sha256(JSON.stringify(value, (_key, item) => typeof item === 'string' && item.length > 256 ? `${item.slice(0, 32)}…` : item));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [, salt, expectedHex] = encoded.split('$');
  if (!salt || !expectedHex) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

export function createId(): string {
  return randomUUID();
}

export function isSessionFresh(session: { issuedAt: string; lastSeenAt: string; expiresAt: string }, idleMs: number, absoluteMs: number, now = Date.now()): boolean {
  const issued = Date.parse(session.issuedAt);
  const lastSeen = Date.parse(session.lastSeenAt);
  const expires = Date.parse(session.expiresAt);
  return now < expires && now - issued < absoluteMs && now - lastSeen < idleMs;
}
