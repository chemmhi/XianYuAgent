import type { ActionKind, AutoReplyRunRecord, AutoReplyRunStatus } from './domain.js';

export type AutoReplyTransportStatus = 'generated' | 'simulated' | 'persisted' | 'known_failure' | 'unknown';
export type AutoReplyResolutionStatus = 'review_pending' | 'resolved' | 'needs_followup' | 'unresolved' | 'unknown';

export interface AutoReplyActivityProjection {
  transportStatus: AutoReplyTransportStatus;
  resolutionStatus: AutoReplyResolutionStatus;
  goalProgress: 'unknown';
  primaryAction?: ActionKind;
  nextAction?: ActionKind;
  legacyActionKind?: string;
  legacyTransportStatus?: string;
  legacyHandoffReason?: string;
}

export function projectAutoReplyRun(run: AutoReplyRunRecord): AutoReplyActivityProjection {
  const transportStatus = transportForStatus(run.status, run.senderOutcome);
  const resolutionStatus: AutoReplyResolutionStatus = run.status === 'persisted' && run.senderOutcome === 'known_success' ? 'review_pending' : 'unknown';
  return {
    transportStatus,
    resolutionStatus,
    goalProgress: 'unknown',
    legacyActionKind: run.decision === 'handoff' ? 'LEGACY_HANDOFF' : run.decision === 'replied' ? 'LEGACY_REPLIED' : run.decision.toUpperCase(),
    legacyTransportStatus: run.status,
    ...(run.decision === 'handoff' ? { legacyHandoffReason: run.failureCode ?? 'LEGACY_UNCLASSIFIED' } : {}),
  };
}

function transportForStatus(status: AutoReplyRunStatus, senderOutcome: AutoReplyRunRecord['senderOutcome']): AutoReplyTransportStatus {
  if (status === 'persisted') return 'persisted';
  if (status === 'simulated' || senderOutcome === 'simulated') return 'simulated';
  if (status === 'generated') return 'generated';
  if (senderOutcome === 'known_failure' || status === 'failed') return 'known_failure';
  return 'unknown';
}
