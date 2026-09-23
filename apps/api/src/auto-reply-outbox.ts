import { randomUUID } from 'node:crypto';
import type { AutoReplyOutboxRecord, ConversationRecord, Store } from './domain.js';
import type { MessageService } from './messages.js';
import type { AutoReplySendInput, AutoReplySender } from './auto-reply.js';
import { digestJson } from './security.js';

export const AUTO_REPLY_SEND_OUTBOX_SCOPE = 'auto_reply_send';

export interface AutoReplyOutboxSendInput extends AutoReplySendInput {
  runId?: string;
  inboundMessageId?: string;
  productRef?: string;
  riskFlags?: string[];
  segmentIndex?: number;
  segmentCount?: number;
}

export interface AutoReplyOutboxSenderOptions {
  workerId?: string;
  leaseMs?: number;
  retryDelayMs?: number;
}

export interface AutoReplyOutboxRecoveryResult {
  outboundMessageIds: string[];
  senderOutcome?: 'known_success' | 'unknown';
}

/**
 * Live auto-reply sender with a persisted request idempotency key. The sender
 * records the external operation before calling the platform, and only marks
 * it succeeded after the platform returns. A later replay can reclaim an
 * expired lease and reuse the same requestId instead of generating a new send.
 */
export class ReliableExternalAutoReplySender implements AutoReplySender {
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly store: Store,
    private readonly messages: MessageService,
    private readonly sendExternal: (input: AutoReplyOutboxSendInput) => Promise<{ externalMessageRef?: string }>,
    options: AutoReplyOutboxSenderOptions = {},
  ) {
    this.workerId = options.workerId ?? `auto-reply-send:${process.pid}:${randomUUID()}`;
    this.leaseMs = Math.max(5_000, Math.min(options.leaseMs ?? 30_000, 300_000));
    this.retryDelayMs = Math.max(100, Math.min(options.retryDelayMs ?? 1_000, 60_000));
  }

  async send(input: AutoReplyOutboxSendInput): Promise<{ outcome: 'simulated' | 'known_success' | 'known_failure' | 'unknown'; externalMessageRef?: string; outboxJobId?: string }> {
    if (input.mode === 'simulate') return { outcome: 'simulated', externalMessageRef: `simulated:auto-reply:${input.traceId}` };
    const aggregateId = input.runId ?? deterministicAggregateId(input.requestId);
    const payload = payloadFor(input);
    let job = await this.store.getAutoReplyOutbox(AUTO_REPLY_SEND_OUTBOX_SCOPE, input.requestId);
    if (!job) {
      job = (await this.store.enqueueAutoReplyOutbox({ scope: AUTO_REPLY_SEND_OUTBOX_SCOPE, aggregateType: 'auto_reply_run', aggregateId, operation: 'send_text', idempotencyKey: input.requestId, payload, traceId: input.traceId })).record;
    }
    if (job.status === 'succeeded' && job.externalMessageRef) return { outcome: 'known_success', externalMessageRef: job.externalMessageRef, outboxJobId: job.id };
    if (job.status === 'processing' && !leaseExpired(job)) return { outcome: 'unknown', outboxJobId: job.id };
    const claimed = await this.store.claimAutoReplyOutbox({ scope: AUTO_REPLY_SEND_OUTBOX_SCOPE, workerId: this.workerId, limit: 1, leaseMs: this.leaseMs, id: job.id });
    const claimedJob = claimed.find((candidate) => candidate.id === job!.id);
    if (!claimedJob) {
      const current = await this.store.getAutoReplyOutbox(AUTO_REPLY_SEND_OUTBOX_SCOPE, input.requestId);
      if (current?.status === 'succeeded' && current.externalMessageRef) return { outcome: 'known_success', externalMessageRef: current.externalMessageRef, outboxJobId: current.id };
      return { outcome: 'unknown', outboxJobId: current?.id ?? job.id };
    }
    try {
      const sent = await this.sendExternal(input);
      const completed = await this.store.completeAutoReplyOutbox({ id: claimedJob.id, workerId: this.workerId, externalOutcome: 'known_success', externalMessageRef: sent.externalMessageRef });
      if (!completed) return { outcome: 'unknown', externalMessageRef: sent.externalMessageRef, outboxJobId: claimedJob.id };
      return { outcome: 'known_success', externalMessageRef: sent.externalMessageRef, outboxJobId: claimedJob.id };
    } catch (error) {
      await this.store.retryAutoReplyOutbox({ id: claimedJob.id, workerId: this.workerId, errorCode: errorCode(error), errorDigest: digestJson({ code: errorCode(error) }), availableAt: new Date(Date.now() + this.retryDelayMs).toISOString() });
      throw error;
    }
  }

  async markPersisted(input: { outboxJobId?: string; outboundMessageId: string }): Promise<void> {
    if (!input.outboxJobId) return;
    await this.store.persistAutoReplyOutbox({ id: input.outboxJobId, outboundMessageId: input.outboundMessageId });
  }

  async recoverRun(input: { adminId: string; runId: string }): Promise<AutoReplyOutboxRecoveryResult> {
    const jobs = await this.store.listAutoReplyOutboxByAggregate(AUTO_REPLY_SEND_OUTBOX_SCOPE, input.runId);
    const outboundMessageIds: string[] = [];
    let senderOutcome: AutoReplyOutboxRecoveryResult['senderOutcome'];
    for (const job of jobs) {
      let current = job;
      if (current.status !== 'succeeded') {
        if (current.status === 'processing' && !leaseExpired(current)) continue;
        const claimed = await this.store.claimAutoReplyOutbox({ scope: AUTO_REPLY_SEND_OUTBOX_SCOPE, workerId: this.workerId, limit: 1, leaseMs: this.leaseMs, id: current.id });
        const claimedJob = claimed.find((candidate) => candidate.id === current.id);
        if (!claimedJob) continue;
        try {
          const sent = await this.sendExternal(inputForPayload(current.payload));
          if (!await this.store.completeAutoReplyOutbox({ id: current.id, workerId: this.workerId, externalOutcome: 'known_success', externalMessageRef: sent.externalMessageRef })) continue;
          current = { ...current, status: 'succeeded', externalOutcome: 'known_success', externalMessageRef: sent.externalMessageRef };
        } catch (error) {
          await this.store.retryAutoReplyOutbox({ id: current.id, workerId: this.workerId, errorCode: errorCode(error), errorDigest: digestJson({ code: errorCode(error) }), availableAt: new Date(Date.now() + this.retryDelayMs).toISOString() });
          continue;
        }
      }
      senderOutcome = 'known_success';
      if (current.outboundMessageId) {
        outboundMessageIds.push(current.outboundMessageId);
        continue;
      }
      if (!current.externalMessageRef) continue;
      const payload = inputForPayload(current.payload);
      const existing = await this.store.findMessageByExternalRef(payload.adminId, payload.conversation.id, current.externalMessageRef);
      const outbound = existing
        ? { messageId: existing.id }
        : await this.messages.createMessage({ adminId: payload.adminId, conversationId: payload.conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: payload.text, externalMessageRef: current.externalMessageRef, source: 'ai', productRef: payload.productRef, riskFlags: payload.riskFlags, requestId: payload.requestId, traceId: payload.traceId });
      const outboundMessageId = 'messageId' in outbound ? outbound.messageId : outbound.message.messageId;
      await this.store.persistAutoReplyOutbox({ id: current.id, outboundMessageId });
      outboundMessageIds.push(outboundMessageId);
    }
    return { outboundMessageIds, senderOutcome };
  }
}

function payloadFor(input: AutoReplyOutboxSendInput): Record<string, unknown> {
  return {
    adminId: input.adminId,
    accountId: input.accountId,
    conversationId: input.conversation.id,
    recipientRef: input.recipientRef,
    text: input.text,
    requestId: input.requestId,
    traceId: input.traceId,
    runId: input.runId,
    inboundMessageId: input.inboundMessageId,
    productRef: input.productRef,
    riskFlags: input.riskFlags ?? [],
    segmentIndex: input.segmentIndex,
    segmentCount: input.segmentCount,
    conversation: { id: input.conversation.id, accountId: input.conversation.accountId, buyerRef: input.conversation.buyerRef, externalConversationRef: input.conversation.externalConversationRef, buyerDisplayName: input.conversation.buyerDisplayName },
  };
}

function inputForPayload(payload: Record<string, unknown>): AutoReplyOutboxSendInput {
  const conversation = (payload.conversation && typeof payload.conversation === 'object' && !Array.isArray(payload.conversation) ? payload.conversation : {}) as Record<string, unknown>;
  const conversationId = String(payload.conversationId ?? conversation.id ?? '');
  const accountId = String(payload.accountId ?? conversation.accountId ?? '');
  const recipientRef = String(payload.recipientRef ?? conversation.buyerRef ?? '');
  const conversationRecord = { id: conversationId, accountId, buyerRef: recipientRef, externalConversationRef: String(conversation.externalConversationRef ?? conversationId), buyerDisplayName: typeof conversation.buyerDisplayName === 'string' ? conversation.buyerDisplayName : undefined } as ConversationRecord;
  return { adminId: String(payload.adminId ?? ''), accountId, requestId: String(payload.requestId ?? ''), conversation: conversationRecord, recipientRef, text: String(payload.text ?? ''), mode: 'live', traceId: String(payload.traceId ?? ''), runId: typeof payload.runId === 'string' ? payload.runId : undefined, inboundMessageId: typeof payload.inboundMessageId === 'string' ? payload.inboundMessageId : undefined, productRef: typeof payload.productRef === 'string' ? payload.productRef : undefined, riskFlags: Array.isArray(payload.riskFlags) ? payload.riskFlags.filter((value): value is string => typeof value === 'string') : [], segmentIndex: typeof payload.segmentIndex === 'number' ? payload.segmentIndex : undefined, segmentCount: typeof payload.segmentCount === 'number' ? payload.segmentCount : undefined };
}

function leaseExpired(job: AutoReplyOutboxRecord): boolean { return !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now(); }
function errorCode(error: unknown): string { const code = (error as { code?: unknown } | null)?.code; if (typeof code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(code)) return code; return error instanceof Error && error.message ? error.message.slice(0, 64).toUpperCase().replace(/[^A-Z0-9_:-]/g, '_') : 'AUTO_REPLY_SEND_FAILED'; }
function deterministicAggregateId(requestId: string): string { const normalized = requestId.replace(/[^a-zA-Z0-9]/g, '').padEnd(32, '0').slice(0, 32); return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-4${normalized.slice(13, 16)}-8${normalized.slice(17, 20)}-${normalized.slice(20, 32)}`; }
