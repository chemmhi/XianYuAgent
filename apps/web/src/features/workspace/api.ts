import type { WorkspaceConfirmationVM, WorkspaceMessageVM, WorkspaceOutboxVM, WorkspaceRunEventVM, WorkspaceRunVM, WorkspaceSessionVM } from './types';

export interface WorkspaceApiTransport {
  get<T>(path: string): Promise<T>;
  post?<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
}

export interface WorkspaceApi {
  listSessions(accountId?: string, search?: string): Promise<WorkspaceSessionVM[]>;
  createSession(input: { accountId: string; title: string; summary?: string }): Promise<WorkspaceSessionVM>;
  switchSession(sessionId: string): Promise<WorkspaceSessionVM>;
  archiveSession(sessionId: string): Promise<WorkspaceSessionVM>;
  listMessages(sessionId: string, limit?: number): Promise<WorkspaceMessageVM[]>;
  startRun(input: { accountId: string; sessionId: string; instruction: string; clientRunRef: string }): Promise<WorkspaceRunVM>;
  getRun(runId: string): Promise<WorkspaceRunVM>;
  listEvents(runId: string, afterSequence?: number): Promise<WorkspaceRunEventVM[]>;
  getConfirmation(runId: string): Promise<WorkspaceConfirmationVM>;
  confirmRun(runId: string, expectedVersion: number): Promise<{ run: WorkspaceRunVM; confirmation: WorkspaceConfirmationVM; outbox: WorkspaceOutboxVM }>;
  cancelRun(runId: string, expectedVersion: number): Promise<{ run: WorkspaceRunVM; confirmation: WorkspaceConfirmationVM }>;
  retryRun(runId: string): Promise<{ run: WorkspaceRunVM; outbox: WorkspaceOutboxVM }>;
  listOutbox(runId: string): Promise<WorkspaceOutboxVM[]>;
  openRunEvents(runId: string, afterSequence: number, handlers: { onOpen: () => void; onEvent: (event: WorkspaceRunEventVM) => void; onClose: () => void; onError: () => void }): WebSocket;
}

interface ApiEnvelope<T> { success: boolean; data: T | null; message?: string | null; error?: { code?: string }; }
interface SessionPayload { items?: WorkspaceSessionVM[]; }
interface EventPayload { items?: WorkspaceRunEventVM[]; }
interface MessagePayload { items?: Array<{ id: string; sessionId: string; runId?: string; type: WorkspaceMessageVM['type']; content: string; summary?: string; createdAt: string; sequence: number }>; }
interface OutboxPayload { items?: WorkspaceOutboxVM[]; }

function messageTitle(type: WorkspaceMessageVM['type']): string {
  if (type === 'user_message') return '用户';
  if (type === 'reasoning_summary') return '推理摘要';
  if (type === 'tool_event') return '工具事件';
  return 'Agent';
}

function unwrap<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) throw new Error(envelope.message ?? envelope.error?.code ?? 'WORKSPACE_REQUEST_FAILED');
    return envelope.data;
  }
  return payload as T;
}

function idempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createWorkspaceApi(transport: WorkspaceApiTransport, options: { baseUrl?: string } = {}): WorkspaceApi {
  const post = <T>(path: string, body: unknown, prefix: string) => {
    if (!transport.post) throw new Error('WORKSPACE_MUTATION_UNAVAILABLE');
    return transport.post<T>(path, body, { headers: { 'Idempotency-Key': idempotencyKey(prefix) } });
  };
  return {
    async listSessions(accountId, search) {
      const params = new URLSearchParams();
      if (accountId) params.set('accountId', accountId);
      if (search?.trim()) params.set('search', search.trim());
      const query = params.toString();
      const payload = await transport.get<SessionPayload | ApiEnvelope<SessionPayload>>(`/api/v1/workspace/agent-sessions${query ? `?${query}` : ''}`);
      return unwrap(payload).items ?? [];
    },
    async createSession(input) { return unwrap(await post<WorkspaceSessionVM | ApiEnvelope<WorkspaceSessionVM>>('/api/v1/workspace/agent-sessions', input, 'workspace-session')); },
    async switchSession(sessionId) { return unwrap(await post<WorkspaceSessionVM | ApiEnvelope<WorkspaceSessionVM>>(`/api/v1/workspace/agent-sessions/${encodeURIComponent(sessionId)}/switch`, {}, 'workspace-switch')); },
    async archiveSession(sessionId) { return unwrap(await post<WorkspaceSessionVM | ApiEnvelope<WorkspaceSessionVM>>(`/api/v1/workspace/agent-sessions/${encodeURIComponent(sessionId)}/archive`, {}, 'workspace-archive')); },
    async listMessages(sessionId, limit = 100) {
      const payload = await transport.get<MessagePayload | ApiEnvelope<MessagePayload>>(`/api/v1/workspace/agent-sessions/${encodeURIComponent(sessionId)}/messages?limit=${Math.max(1, Math.min(500, Math.trunc(limit)))}`);
      return (unwrap(payload).items ?? []).map((message) => ({ id: message.id, runId: message.runId, type: message.type, createdAt: message.createdAt, title: message.type === 'tool_event' && message.summary?.trim() ? message.summary.trim() : messageTitle(message.type), content: message.content, summary: message.summary, sequence: message.sequence, collapsible: message.type === 'reasoning_summary' }));
    },
    async startRun(input) { return unwrap(await post<WorkspaceRunVM | ApiEnvelope<WorkspaceRunVM>>('/api/v1/workspace/runs', input, 'workspace-run')); },
    async getRun(runId) { return unwrap(await transport.get<WorkspaceRunVM | ApiEnvelope<WorkspaceRunVM>>(`/api/v1/workspace/runs/${encodeURIComponent(runId)}`)); },
    async listEvents(runId, afterSequence = 0) {
      const payload = await transport.get<EventPayload | ApiEnvelope<EventPayload>>(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/events?after=${afterSequence}`);
      return unwrap(payload).items ?? [];
    },
    async getConfirmation(runId) { return unwrap(await transport.get<WorkspaceConfirmationVM | ApiEnvelope<WorkspaceConfirmationVM>>(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/confirmation`)); },
    async confirmRun(runId, expectedVersion) { return unwrap(await post<{ run: WorkspaceRunVM; confirmation: WorkspaceConfirmationVM; outbox: WorkspaceOutboxVM } | ApiEnvelope<{ run: WorkspaceRunVM; confirmation: WorkspaceConfirmationVM; outbox: WorkspaceOutboxVM }>>(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/confirm`, { expectedVersion }, 'workspace-confirm')); },
    async cancelRun(runId, expectedVersion) { return unwrap(await post<{ run: WorkspaceRunVM; confirmation: WorkspaceConfirmationVM } | ApiEnvelope<{ run: WorkspaceRunVM; confirmation: WorkspaceConfirmationVM }>>(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/cancel`, { expectedVersion }, 'workspace-cancel')); },
    async retryRun(runId) { return unwrap(await post<{ run: WorkspaceRunVM; outbox: WorkspaceOutboxVM } | ApiEnvelope<{ run: WorkspaceRunVM; outbox: WorkspaceOutboxVM }>>(`/api/v1/workspace/runs/${encodeURIComponent(runId)}/retry`, {}, 'workspace-retry')); },
    async listOutbox(runId) { return (unwrap(await transport.get<OutboxPayload | ApiEnvelope<OutboxPayload>>(`/api/v1/execution/outbox?runId=${encodeURIComponent(runId)}`))).items ?? []; },
    openRunEvents(runId, afterSequence, handlers) {
      const base = options.baseUrl ? new URL(options.baseUrl, window.location.origin) : new URL(window.location.origin);
      base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
      base.pathname = `/api/v1/workspace/runs/${encodeURIComponent(runId)}/events`;
      base.search = `?after=${afterSequence}`;
      const socket = new WebSocket(base.toString());
      socket.addEventListener('open', handlers.onOpen);
      socket.addEventListener('error', handlers.onError);
      socket.addEventListener('close', handlers.onClose);
      socket.addEventListener('message', (message) => {
        try {
          const parsed = JSON.parse(String(message.data)) as { type?: string; event?: WorkspaceRunEventVM };
          if (parsed.type === 'event' && parsed.event) handlers.onEvent(parsed.event);
        } catch { handlers.onError(); }
      });
      return socket;
    },
  };
}

export { unwrap };
