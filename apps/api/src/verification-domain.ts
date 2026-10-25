import type { VerificationFrame, VerificationPointer } from './verification-remote-browser.js';

export type VerificationState = 'preparing' | 'priority_wait' | 'human_active' | 'auto_active' | 'settling' | 'handoff' | 'rechecking'
  | 'succeeded' | 'completed_partial' | 'failed' | 'expired' | 'cancelled';
export type VerificationMode = 'manual_then_auto' | 'manual_only';
export interface VerificationSubject {
  adminId: string; accountId?: string; loginSessionId?: string; expiresAt?: number; flowId?: string;
}
export interface VerificationSession {
  id: string; subject: VerificationSubject; ownerId: string; state: VerificationState; mode: VerificationMode;
  version: number; eventSequence: number; createdAt: number; updatedAt: number; expiresAt: number;
  readyAt: number; setupDeadline: number; discoveryDeadline: number; priorityDeadline?: number; priorityConsumed: boolean;
  humanDeadline?: number; reconnectDeadline?: number; controlEpoch: number;
  controller?: { adminId: string; authSessionId: string; clientId: string; connectionId: string };
  presentation?: { adminId: string; clientId: string; until: number };
  autoAttempts: number; challengeGeneration: number; failureCode?: string; humanRequested?: boolean;
  sourceResults?: Array<{ source: string; status: 'verified' | 'probe_only' | 'failed' | 'superseded'; nextAction?: string }>;
}
export const VERIFICATION_TERMINAL = new Set<VerificationState>(['succeeded', 'completed_partial', 'failed', 'expired', 'cancelled']);
export const VERIFICATION_TIMING = Object.freeze({ priority: 5_000, human: 30_000, discovery: 2_000, setup: 8_000,
  presentation: 4_000, reconnect: 3_000, drain: 3_000, settling: 10_000, total: 300_000, ownerLease: 6_000 });
export function verificationSubjectKey(subject: VerificationSubject): string {
  if (Boolean(subject.accountId) === Boolean(subject.loginSessionId)) throw new Error('VERIFICATION_SUBJECT_INVALID');
  return subject.accountId ? `account:${subject.accountId}` : `login:${subject.loginSessionId}`;
}
export function verificationBuckets(subject: VerificationSubject): string[] {
  return subject.accountId ? [`account:${subject.accountId}`] : [`flow:${subject.flowId ?? subject.adminId}`, `admin:${subject.adminId}`];
}
export function publicVerificationSession(session: VerificationSession) {
  const { ownerId: _ownerId, controller, ...safe } = session;
  return { ...safe, controller: controller ? { clientId: controller.clientId } : undefined, serverTime: Date.now() };
}
export interface VerificationBrowserPort {
  capture(): Promise<VerificationFrame | undefined>;
  canSend(frame: VerificationFrame): Promise<boolean>;
  pointer(input: VerificationPointer, admit: () => Promise<boolean>): Promise<void>;
  release(): Promise<void>; close(): Promise<void>; invalidate(): void;
}
export interface VerificationChallenge {
  subject: VerificationSubject; browser: VerificationBrowserPort; closeContext: () => Promise<void>;
  verdict: () => { sequence: number; code?: number; success?: boolean } | undefined;
  pendingAnswers: () => number;
  autoAttempt: (admit: () => Promise<void>, beforeAttempt: () => Promise<void>) => Promise<{ success: boolean }>;
}
export class VerificationError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) { super(code); }
}
