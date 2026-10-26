import { VERIFICATION_TERMINAL, type VerificationSession } from './verification-domain.js';

export interface VerificationAccountHealth {
  status: string; transportStatus?: string; transportSeenAt?: string; riskSources: string[];
}
/** Deliberately selected fields: domain records contain owner/auth identities. */
export function verificationDto(row: VerificationSession, accountHealth?: VerificationAccountHealth) {
  return {
    id: row.id, subject: { accountId: row.subject.accountId, loginSessionId: row.subject.loginSessionId },
    state: row.state, mode: row.mode, autoAllowed: row.autoAllowed !== false, version: row.version, eventSequence: row.eventSequence,
    presentationKind: row.presentationKind, resultCandidateReceived: row.resultCandidateReceived,
    createdAt: row.createdAt, expiresAt: row.expiresAt, setupDeadline: row.setupDeadline,
    priorityDeadline: row.priorityDeadline, humanDeadline: row.humanDeadline, reconnectDeadline: row.reconnectDeadline,
    controlEpoch: row.controlEpoch, autoAttempts: row.autoAttempts, challengeGeneration: row.challengeGeneration,
    controller: row.controller ? { clientId: row.controller.clientId } : undefined,
    presentation: row.presentation ? { clientId: row.presentation.clientId, until: row.presentation.until } : undefined,
    failureCode: row.failureCode, platformResult: row.platformResult ? {
      status: row.platformResult.status, code: row.platformResult.code, sequence: row.platformResult.sequence,
      challengeGeneration: row.platformResult.challengeGeneration, observedAt: row.platformResult.observedAt,
    } : undefined, sourceResults: row.sourceResults ?? [], accountHealth,
    executionOutcome: VERIFICATION_TERMINAL.has(row.state) ? row.state : undefined,
    actions: VERIFICATION_TERMINAL.has(row.state) ? ['retry'] : row.state === 'priority_wait' ? row.autoAllowed === false ? ['claim'] : ['claim', 'auto']
      : row.state === 'human_active' ? ['resume', 'release'] : row.state === 'auto_active' ? ['request-human'] : row.state === 'preparing' ? ['presentation'] : [],
    serverTime: Date.now(),
  };
}
export type VerificationSessionDto = ReturnType<typeof verificationDto>;
