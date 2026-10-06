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
  runId?: string;
  runStatus?: WorkspaceRunStatus;
  summary?: string;
  lastActiveAt: string;
  archivedAt?: string;
  updatedAt: string;
  titlePending?: boolean;
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
  action: 'product_publish' | 'product_update' | 'coupon_create' | 'agent_settings_update' | 'product_knowledge_update' | 'product_automation_update' | 'coupon_update' | 'coupon_enable' | 'coupon_disable' | 'coupon_bind' | 'coupon_unbind' | 'coupon_void' | 'coupon_copy' | 'model_settings_update' | 'order_deliver' | 'order_retry' | 'order_cancel';
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
  result?: Record<string, unknown>;
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
  unreadSessionIds: string[];
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
