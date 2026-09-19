export type WorkspaceRunStatus = 'queued' | 'running' | 'waiting_confirmation' | 'executing' | 'retrying' | 'cancelling' | 'succeeded' | 'partially_succeeded' | 'failed' | 'cancelled' | 'expired';
export type WorkspaceStepStatus = 'pending' | 'running' | 'waiting_confirmation' | 'executing' | 'retrying' | 'succeeded' | 'partially_succeeded' | 'failed' | 'skipped' | 'cancelled';

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

export interface WorkspaceRunEventVM {
  sequence: number;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceState {
  phase: 'idle' | 'loading' | 'empty' | 'success' | 'error' | 'forbidden';
  sessions: WorkspaceSessionVM[];
  activeSessionId?: string;
  run: WorkspaceRunVM | null;
  events: WorkspaceRunEventVM[];
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
  error: string | null;
  submitting: boolean;
}
