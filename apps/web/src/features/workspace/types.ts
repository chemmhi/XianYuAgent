export type WorkspaceRunStatus = 'queued' | 'running' | 'waiting_confirmation' | 'executing' | 'retrying' | 'cancelling' | 'succeeded' | 'partially_succeeded' | 'failed' | 'cancelled' | 'expired';
export type WorkspaceStepStatus = 'pending' | 'running' | 'waiting_confirmation' | 'executing' | 'retrying' | 'succeeded' | 'partially_succeeded' | 'failed' | 'skipped' | 'cancelled';
export type WorkspaceMessageType = 'user_message' | 'reasoning_summary' | 'tool_event' | 'final_answer';
export type WorkspaceConfirmationStatus = 'active' | 'confirmed' | 'expired' | 'rejected' | 'cancelled';
export type WorkspaceOutboxStatus = 'pending' | 'processing' | 'retryable' | 'succeeded' | 'dead_lettered';

export interface WorkspaceSessionVM {
  id: string;
  accountId: string;
  title: string;
  status: 'active' | 'archived';
  summary?: string;
  lastActiveAt: string;
  archivedAt?: string;
  updatedAt: string;
}

export interface WorkspaceStepVM {
  stepId: string;
  runId: string;
  sequence: number;
  kind: 'plan' | 'tool_call' | 'policy_check' | 'mutation' | 'observation';
  label: string;
  status: WorkspaceStepStatus;
  startedAt?: string;
  finishedAt?: string;
  inputSummary?: string;
  outputSummary?: string;
  errorCode?: string;
}

export interface WorkspaceRunVM {
  runId: string;
  sessionId: string;
  accountId: string;
  status: WorkspaceRunStatus;
  instructionSummary: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  currentStepId?: string;
  steps: WorkspaceStepVM[];
  resultSummary?: string;
  errorCode?: string;
  clientRunRef?: string;
}

export interface WorkspaceConfirmationVM {
  confirmationId: string;
  runId: string;
  stepId: string;
  accountId: string;
  action: 'product_publish' | 'coupon_create' | 'agent_settings_update';
  policyRef: string;
  manifest: Record<string, unknown>;
  status: WorkspaceConfirmationStatus;
  version: number;
  expiresAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceOutboxVM {
  outboxId: string;
  runId: string;
  scope: string;
  operation: string;
  status: WorkspaceOutboxStatus;
  attempt: number;
  availableAt: string;
  externalOutcome?: 'known_success' | 'known_failure' | 'unknown';
  lastErrorCode?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRunEventVM {
  sequence: number;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceMessageVM {
  id: string;
  runId?: string;
  type: WorkspaceMessageType;
  createdAt: string;
  title: string;
  content: string;
  summary?: string;
  status?: WorkspaceRunStatus | WorkspaceStepStatus;
  eventType?: string;
  sequence?: number;
  collapsible?: boolean;
}

export interface WorkspaceState {
  phase: 'idle' | 'loading' | 'empty' | 'success' | 'error' | 'forbidden';
  sessions: WorkspaceSessionVM[];
  activeSessionId?: string;
  run: WorkspaceRunVM | null;
  messages: WorkspaceMessageVM[];
  events: WorkspaceRunEventVM[];
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
  error: string | null;
  submitting: boolean;
  confirmation: WorkspaceConfirmationVM | null;
  outbox: WorkspaceOutboxVM[];
  actionSubmitting: boolean;
}
