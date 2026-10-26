import type { VerificationSession } from './model';
export function session(overrides: Partial<VerificationSession> = {}): VerificationSession {
  return { id: 'session', subject: { accountId: 'account' }, state: 'preparing', mode: 'manual_then_auto', autoAllowed: true, version: 1, eventSequence: 1, createdAt: 100, expiresAt: 300_100, setupDeadline: 8_100,
    controlEpoch: 0, autoAttempts: 0, challengeGeneration: 1, actions: [], sourceResults: [], serverTime: 100, ...overrides };
}
