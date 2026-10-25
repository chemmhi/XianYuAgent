import { randomUUID } from 'node:crypto';
import type { AccountRecord, ConversationRecord, CredentialRecord, InboundInboxRecord, Store } from './domain.js';
import { ServiceError } from './services.js';
import { classifyXianyuFailure } from './xianyu-account-health.js';
import type { MessageService } from './messages.js';
import type { AutoReplyProcessResult, AutoReplyService } from './auto-reply.js';
import { XianyuImClient, XianyuImMessageEvent, XianyuImReadReceiptEvent, XianyuImCredential, type XianyuImClientOptions, XIANYU_IM_TOKEN_API } from './xianyu-im.js';
import { hasXianyuStructuredSystemMarker, matchesXianyuOrderStatus, parseXianyuSystemMessageKind } from './xianyu-system-message.js';
import { XianyuMtopClient } from './xianyu-mtop.js';
import type { ProductAutomationImEventResult, ProductAutomationTrigger } from './product-automation-trigger.js';
import { InboundInboxWorker } from './inbound-inbox-worker.js';
import { cookieHeaderFromSnapshot, cookieSnapshotFromMetadata, dropStaleCaptchaChallengeCookies, metadataWithCookieSnapshot, type XianyuCookieSnapshot } from './xianyu-cookie-jar.js';
import type { XianyuVerificationBrowser, XianyuVerificationBrowserResult } from './xianyu-verification-browser.js';
import type { XianyuImOwnerClient } from './xianyu-im-owner-rpc.js';
import { planXianyuChatRefresh } from './xianyu-chat-refresh-policy.js';
import { refreshXianyuChatRequests } from './xianyu-chat-refresh.js';
import { recheckVerificationRisks } from './xianyu-verification-risk-recheck.js';
import { recoverVerificationReads, XianyuReadRecoveryError } from './xianyu-verification-read-recovery.js';
import { isImVerificationSource } from './xianyu-verification-request.js';

interface ExternalPage {
  hasMore: boolean;
  nextCursor?: number;
}

/** This attempt failed before any outbound message was submitted. */
export class XianyuImSendNotStartedError extends ServiceError {
  constructor(error: unknown) {
    const code = error instanceof ServiceError ? error.code
      : (error as { code?: string })?.code ?? (error instanceof Error && /^XIANYU_[A-Z0-9_]+$/.test(error.message) ? error.message : 'XIANYU_IM_NOT_READY');
    super(error instanceof ServiceError ? error.statusCode : 503, code, 'IM send preparation failed');
  }
}

async function prepareImSend<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { throw new XianyuImSendNotStartedError(error); }
}

export class XianyuImService {
  private readonly clients = new Map<string, XianyuImClient>();
  private readonly clientInFlight = new Map<string, Promise<XianyuImClient>>();
  private readonly verificationInFlight = new Map<string, Promise<XianyuVerificationBrowserResult>>();
  private readonly verificationRetryAfter = new Map<string, number>();
  private readonly recoveryInFlight = new Map<string, Promise<void>>();
  private readonly recoveryRetryAfter = new Map<string, number>();
  private readonly credentialRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly chatRefreshInFlight = new Map<string, Promise<boolean>>();
  private readonly clientHealthLanes = new Map<string, Promise<void>>();
  private readonly transportHeartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly credentialRefreshInFlight = new Map<string, Promise<void>>();
  private readonly tokenRefreshInFlight = new Map<string, Promise<CredentialRecord>>();
  private readonly verificationRecoveryInFlight = new Map<string, Promise<void>>();
  private readonly verificationRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly verificationRecoverySignals = new Map<string, Set<string>>();
  private readonly verificationRecoverySignalVersions = new Map<string, number>();
  private closed = false;
  private readonly deletedAccounts = new Set<string>();
  private readonly identityCache = new Map<string, { buyerDisplayName?: string; buyerAvatarUrl?: string }>();
  private readonly inboundInboxWorker: InboundInboxWorker;
  private inboundInboxWakeInFlight?: Promise<void>;
  private inboundInboxWakeRequested = false;

  constructor(
    private readonly store: Store,
    private readonly mtop: XianyuMtopClient,
    private readonly messages: MessageService,
    private readonly autoReply?: AutoReplyService,
    private readonly productAutomation?: ProductAutomationTrigger,
    private readonly verificationBrowser?: XianyuVerificationBrowser,
    private readonly refreshOrdersForTrustedOrderEvent?: (input: { adminId: string; accountId: string; event: XianyuImMessageEvent }) => Promise<void>,
    private readonly notifyVerificationRequired?: (adminId: string, accountId: string, source: string) => Promise<void>,
    private readonly ownerClient?: XianyuImOwnerClient,
    private readonly imClientFactory: (options: XianyuImClientOptions) => XianyuImClient = options => new XianyuImClient(options),
  ) {
    this.inboundInboxWorker = new InboundInboxWorker(store, this, {
      workerId: `listener-fallback:${process.pid}:${randomUUID()}`,
      batchSize: 10,
      leaseMs: 120_000,
      maxAttempts: 5,
    });
  }

  async listConversations(adminId: string, accountId: string, startCursor?: number, limit = 50): Promise<ExternalPage> {
    if (this.ownerClient) return this.ownerClient.call('listConversations', [adminId, accountId, startCursor, limit]);
    const client = await this.ensureClient(adminId, accountId);
    let cursor = startCursor;
    let hasMore = false;
    let nextCursor: number | undefined;
    const maxPages = startCursor === undefined ? 20 : 1;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await this.withAccountFailure(adminId, accountId, () => client.listConversations(cursor, limit), 'im_read');
      const items = Array.isArray(page.userConvs) ? page.userConvs : [];
      const parsedItems = items.map((item) => normalizeConversation(item, client.selfUserIds)).filter((item): item is NonNullable<ReturnType<typeof normalizeConversation>> => Boolean(item));
      // The conversation payload is not consistent across account/session
      // types: some rows include the avatar but omit the nickname and others
      // include neither. Enrich whenever either identity field is missing so
      // the list does not silently fall back to a numeric buyer id.
      const enrichTargets = parsedItems.filter((item) => !item.buyerAvatarUrl || !item.buyerDisplayName);
      const enrichedEntries: Array<readonly [string, typeof parsedItems[number]]> = [];
      // Resolve every incomplete row, but keep the external profile calls bounded
      // so a large conversation page does not create an unbounded request burst.
      for (let index = 0; index < enrichTargets.length; index += 8) {
        const batch = enrichTargets.slice(index, index + 8);
        const resolved = await Promise.all(batch.map(async (item) => [item.externalConversationRef, await this.enrichConversationIdentity(adminId, accountId, item)] as const));
        enrichedEntries.push(...resolved);
      }
      const enrichedByRef = new Map(enrichedEntries);
      for (const parsed of parsedItems) await this.store.upsertExternalConversation({ adminId, accountId, ...(enrichedByRef.get(parsed.externalConversationRef) ?? parsed) });
      hasMore = Boolean(page.hasMore);
      nextCursor = numeric(page.nextCursor);
      if (!hasMore || nextCursor === undefined || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return { hasMore, nextCursor };
  }

  async listMessages(adminId: string, accountId: string, conversationId: string, startCursor?: number, limit = 100): Promise<ExternalPage> {
    if (this.ownerClient) return this.ownerClient.call('listMessages', [adminId, accountId, conversationId, startCursor, limit]);
    const conversation = await this.getConversation(adminId, accountId, conversationId);
    const externalRef = conversation.externalConversationRef;
    if (!externalRef) throw new ServiceError(409, 'EXTERNAL_CONVERSATION_MISSING', 'conversation is not linked to xianyu');
    const client = await this.ensureClient(adminId, accountId);
    const page = await this.withAccountFailure(adminId, accountId, () => client.listMessages(externalRef, startCursor, limit), 'im_read');
    const models = Array.isArray(page.userMessageModels) ? page.userMessageModels : [];
    for (const item of [...models].reverse()) {
      const parsed = normalizeHistoryMessage(item, client.selfUserIds);
      if (!parsed) continue;
      const classified = await this.classifySystemCandidate(adminId, accountId, conversationId, parsed);
      await this.messages.importExternalMessage({
        adminId,
        conversationId,
        direction: parsed.direction,
        senderRole: parsed.direction === 'outbound' ? 'agent' : classified.bodyType === 'system' ? 'system' : 'buyer',
        bodyType: classified.bodyType,
        bodyText: parsed.bodyText,
        bodyRef: parsed.bodyRef,
        externalMessageRef: parsed.externalMessageRef,
        externalMessageRefAliases: parsed.externalMessageRefAliases,
        source: parsed.direction === 'outbound' ? 'human' : 'system',
        riskFlags: classified.riskFlags,
        createdAt: parsed.createdAt,
        traceId: `xianyu:history:${parsed.externalMessageRef}`,
      });
    }
    return { hasMore: Boolean(page.hasMore), nextCursor: numeric(page.nextCursor) };
  }

  async markConversationRead(adminId: string, accountId: string, conversationId: string, requestId: string, traceId: string): Promise<unknown> {
    if (this.ownerClient) return this.ownerClient.call('markConversationRead', [adminId, accountId, conversationId, requestId, traceId]);
    const conversation = await this.getConversation(adminId, accountId, conversationId);
    const externalRef = conversation.externalConversationRef;
    if (externalRef) {
      try {
        const client = await this.ensureClient(adminId, accountId);
        const history = await this.messages.listMessages(adminId, conversationId, { limit: 200 });
        const refs = history.items
          .filter((message) => message.direction === 'inbound' && message.externalMessageRef)
          .map((message) => message.externalMessageRef!)
          .filter(Boolean);
        await this.withAccountFailure(adminId, accountId, () => client.markRead(refs), 'im_read');
      } catch (error) {
        await this.markAccountFailure(adminId, accountId, error, 'im_read');
        // Local unread state is authoritative for the UI. A transient Xianyu
        // receipt failure must not leave the conversation badge stuck.
      }
    }
    return this.messages.markConversationRead(adminId, conversationId, requestId, traceId);
  }

  async sendExternalText(adminId: string, accountId: string, conversationId: string, text: string, requestId: string, traceId: string): Promise<{ externalMessageRef?: string }> {
    if (this.ownerClient) return this.ownerClient.call('sendExternalText', [adminId, accountId, conversationId, text, requestId, traceId]);
    return this.withSendLock(accountId, conversationId, () => this.sendExternalTextLocked(adminId, accountId, conversationId, text, requestId, traceId));
  }

  private async withSendLock<T>(accountId: string, conversationId: string, work: () => Promise<T>): Promise<T> {
    let entered = false;
    try {
      return await this.store.withOutboundConversationLock(accountId, conversationId, () => { entered = true; return work(); });
    } catch (error) {
      if (!entered) throw new XianyuImSendNotStartedError(error);
      // A lock-release failure can follow a completed platform write.
      throw error;
    }
  }

  private async sendExternalTextLocked(adminId: string, accountId: string, conversationId: string, text: string, requestId: string, traceId: string): Promise<{ externalMessageRef?: string }> {
    const normalizedText = text.trim();
    if (!normalizedText) throw new ServiceError(422, 'VALIDATION_FAILED', 'text is required');
    const conversation = await prepareImSend(() => this.getConversation(adminId, accountId, conversationId));
    const externalRef = conversation.externalConversationRef;
    if (!externalRef) throw new XianyuImSendNotStartedError(new ServiceError(409, 'EXTERNAL_CONVERSATION_MISSING', 'conversation is not linked to xianyu'));
    let client = await prepareImSend(() => this.ensureClient(adminId, accountId));
    const startedAt = new Date().toISOString();
    let sent: { externalMessageRef?: string };
    try {
      sent = await this.withAccountFailure(adminId, accountId, () => client.sendText(externalRef, conversation.buyerRef, normalizedText, requestId));
    } catch (error) {
      if (isAmbiguousImSendError(error)) {
        const recovered = await this.reconcileOutboundSend(adminId, accountId, externalRef, { bodyType: 'text', content: normalizedText, startedAt });
        if (!recovered) throw new ServiceError(502, 'XIANYU_IM_SEND_OUTCOME_UNKNOWN', 'message send outcome is unknown');
        await this.clearImSendRisk(adminId, accountId, startedAt);
        return { externalMessageRef: recovered };
      }
      if (!isRecoverableTextSendError(error)) throw error;
      await this.resetClient(adminId, accountId);
      // Refresh once inside bootstrap: a cached token can survive a rejected
      // send, but a second token request can immediately issue another challenge.
      client = await this.ensureClient(adminId, accountId, { forceCredentialRefresh: isValidationTextSendError(error) });
      sent = await this.withAccountFailure(adminId, accountId, () => client.sendText(externalRef, conversation.buyerRef, normalizedText, requestId));
    }
    if (!sent.externalMessageRef) {
      const recovered = await this.reconcileOutboundSend(adminId, accountId, externalRef, { bodyType: 'text', content: normalizedText, startedAt });
      if (!recovered) throw new ServiceError(502, 'XIANYU_IM_SEND_OUTCOME_UNKNOWN', 'text acknowledgement has no message reference');
      sent = { externalMessageRef: recovered };
    }
    await this.clearImSendRisk(adminId, accountId, startedAt);
    return sent;
  }

  async sendText(adminId: string, accountId: string, conversationId: string, text: string, requestId: string, traceId: string): Promise<unknown> {
    if (this.ownerClient) return this.ownerClient.call('sendText', [adminId, accountId, conversationId, text, requestId, traceId]);
    const normalizedText = text.trim();
    if (!normalizedText) throw new ServiceError(422, 'VALIDATION_FAILED', 'text is required');
    const conversation = await prepareImSend(() => this.getConversation(adminId, accountId, conversationId));
    const sent = await this.sendExternalText(adminId, accountId, conversationId, normalizedText, requestId, traceId);
    const created = await this.messages.createMessage({
      adminId,
      conversationId,
      direction: 'outbound',
      senderRole: 'agent',
      bodyType: 'text',
      bodyText: normalizedText,
      externalMessageRef: sent.externalMessageRef,
      source: 'human',
      requestId,
      traceId,
    });
    return created.message;
  }

  async sendImage(adminId: string, accountId: string, conversationId: string, file: { filename: string; contentType: string; data: Buffer }, requestId: string, traceId: string): Promise<unknown> {
    if (this.ownerClient) return this.ownerClient.call('sendImage', [adminId, accountId, conversationId, file, requestId, traceId]);
    if (!file.data?.length) throw new ServiceError(422, 'VALIDATION_FAILED', 'image is required');
    if (!file.contentType.startsWith('image/')) throw new ServiceError(422, 'VALIDATION_FAILED', 'only image files are supported');
    if (file.data.length > 10 * 1024 * 1024) throw new ServiceError(413, 'PAYLOAD_TOO_LARGE', 'image must be 10MB or smaller');
    const conversation = await prepareImSend(() => this.getConversation(adminId, accountId, conversationId));
    const externalRef = conversation.externalConversationRef;
    if (!externalRef) throw new XianyuImSendNotStartedError(new ServiceError(409, 'EXTERNAL_CONVERSATION_MISSING', 'conversation is not linked to xianyu'));
    // Image uploads use the MTOP/browser cookie session while text messages
    // use the already-connected IM socket. Wait for the account-scoped IM
    // session first so a background reconnect/token refresh cannot race the
    // upload and make it read a stale cookie snapshot.
    const upload = await prepareImSend(async () => {
      await this.ensureClient(adminId, accountId);
      const result = await this.mtop.uploadChatImage(adminId, accountId, file.filename, file.contentType, file.data);
      if (!result.success || !result.url) throw new ServiceError(result.accountInvalid ? 401 : 502, result.errorCode ?? 'IMAGE_UPLOAD_FAILED', result.message ?? 'unable to upload image');
      return result;
    });
    return this.withSendLock(accountId, conversationId, () => this.sendUploadedImageLocked(adminId, accountId, conversationId, conversation, upload.url!, upload.width, upload.height, requestId, traceId));
  }

  private async sendUploadedImageLocked(adminId: string, accountId: string, conversationId: string, conversation: ConversationRecord, imageUrl: string, width: number | undefined, height: number | undefined, requestId: string, traceId: string): Promise<unknown> {
    const externalRef = conversation.externalConversationRef!;
    const client = await prepareImSend(() => this.ensureClient(adminId, accountId));
    const startedAt = new Date().toISOString();
    let sent: { externalMessageRef?: string };
    try {
      sent = await this.withAccountFailure(adminId, accountId, () => client.sendImage(externalRef, conversation.buyerRef, imageUrl, width, height, requestId));
    } catch (error) {
      if (!isAmbiguousImSendError(error)) throw error;
      const recovered = await this.reconcileOutboundSend(adminId, accountId, externalRef, { bodyType: 'image', content: imageUrl, startedAt });
      if (!recovered) throw new ServiceError(502, 'XIANYU_IM_SEND_OUTCOME_UNKNOWN', 'image send outcome is unknown');
      sent = { externalMessageRef: recovered };
    }
    if (!sent.externalMessageRef) {
      const recovered = await this.reconcileOutboundSend(adminId, accountId, externalRef, { bodyType: 'image', content: imageUrl, startedAt });
      if (!recovered) throw new ServiceError(502, 'XIANYU_IM_SEND_OUTCOME_UNKNOWN', 'image acknowledgement has no message reference');
      sent = { externalMessageRef: recovered };
    }
    await this.clearImSendRisk(adminId, accountId, startedAt);
    const created = await this.messages.createMessage({
      adminId,
      conversationId,
      direction: 'outbound',
      senderRole: 'agent',
      bodyType: 'image',
      bodyRef: imageUrl,
      externalMessageRef: sent.externalMessageRef,
      source: 'human',
      requestId,
      traceId,
    });
    return created.message;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.inboundInboxWakeInFlight;
    for (const timer of this.credentialRefreshTimers.values()) clearTimeout(timer);
    this.credentialRefreshTimers.clear();
    for (const timer of this.transportHeartbeatTimers.values()) clearInterval(timer);
    this.transportHeartbeatTimers.clear();
    for (const timer of this.verificationRecoveryTimers.values()) clearTimeout(timer);
    this.verificationRecoveryTimers.clear();
    await Promise.allSettled([...this.verificationRecoveryInFlight.values(), ...this.tokenRefreshInFlight.values(), ...this.chatRefreshInFlight.values(), ...this.credentialRefreshInFlight.values()]);
    this.credentialRefreshInFlight.clear();
    const inFlight = [...this.clientInFlight.values()];
    this.clientInFlight.clear();
    this.recoveryInFlight.clear();
    this.recoveryRetryAfter.clear();
    this.verificationInFlight.clear();
    this.verificationRetryAfter.clear();
    const clients = new Set(this.clients.values());
    this.clients.clear();
    this.identityCache.clear();
    await Promise.allSettled(inFlight);
    for (const client of this.clients.values()) clients.add(client);
    this.clients.clear();
    await Promise.all([...clients].map((client) => client.disconnect()));
  }

  /**
   * Start (or re-use) the account-scoped IM listener.
   *
   * The listener used to be created only as a side effect of a conversation
   * query/send operation. That meant a freshly connected account could sit
   * idle until an operator opened the chat page, so push events (and the
   * automatic-reply pipeline) were never observed. Keep the lifecycle entry
   * point explicit so the application can start it immediately after a
   * credential becomes active without duplicating client construction.
   */
  async startListener(adminId: string, accountId: string): Promise<void> {
    if (this.ownerClient) return this.ownerClient.call('startListener', [adminId, accountId]);
    if (this.deletedAccounts.has(accountId)) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
    // Register the keepalive before bootstrap so an active login is retried
    // even when the first socket/token exchange fails transiently.
    this.scheduleCredentialRefresh(adminId, accountId);
    const client = await this.ensureClient(adminId, accountId);
    this.requestVerificationRecovery(adminId, accountId, 'listener_start');
    if (client) this.scheduleRecentMessageRecovery(adminId, accountId);
  }

  /** Wake recovery after a committed risk signal without blocking its request. */
  requestVerificationRecovery(adminId: string, accountId: string, source: string): void {
    const key = `${adminId}:${accountId}`;
    if (this.closed || this.deletedAccounts.has(accountId) || !this.verificationBrowser?.enabled) return;
    if (this.verificationRecoveryInFlight.has(key)) {
      // Token refresh reports its own failure while this recovery owns it.
      if (isImVerificationSource(source)) return;
      const signals = this.verificationRecoverySignals.get(key) ?? new Set<string>();
      signals.add(source);
      this.verificationRecoverySignals.set(key, signals);
      this.verificationRecoverySignalVersions.set(key, (this.verificationRecoverySignalVersions.get(key) ?? 0) + 1);
      return;
    }
    const retryInMs = (this.verificationRetryAfter.get(key) ?? 0) - Date.now();
    if (retryInMs > 0) {
      if (!this.verificationRecoveryTimers.has(key)) {
        const timer = setTimeout(() => {
          this.verificationRecoveryTimers.delete(key);
          this.requestVerificationRecovery(adminId, accountId, source);
        }, retryInMs);
        timer.unref?.();
        this.verificationRecoveryTimers.set(key, timer);
      }
      return;
    }
    const pendingTimer = this.verificationRecoveryTimers.get(key);
    if (pendingTimer) clearTimeout(pendingTimer);
    this.verificationRecoveryTimers.delete(key);
    const attemptedRevisions = new Map<string, string>();
    const task = Promise.resolve().then(async () => {
      // A bootstrap failure callback must never wait on its own connection.
      await Promise.allSettled([this.clientInFlight.get(key), this.tokenRefreshInFlight.get(key), this.credentialRefreshInFlight.get(key)]);
      if (this.closed || (this.verificationRetryAfter.get(key) ?? 0) > Date.now()) return;
      const account = await this.store.getAccount(adminId, accountId);
      if (!account || account.status === 'disabled' || (!account.riskEpisode && account.status !== 'verification_required')) return;
      const credential = await this.store.getCredential(adminId, accountId);
      if (this.closed || credential?.status !== 'active' || !credential.cookieHeader) return;
      for (const risk of await this.store.listAccountVerificationRisks(adminId, accountId)) attemptedRevisions.set(risk.source, risk.revision);
      console.info(JSON.stringify({ component: 'xianyu-im', event: 'verification_recovery_started', adminId, accountId, source }));
      // A prior browser recovery may already have restored this API. Recheck
      // before forcing another Token exchange/challenge against a healthy IM.
      let readRecoveryFailed = false;
      const recheckReads = async () => {
        try { await recheckVerificationRisks(this.store, this.mtop, adminId, accountId); }
        catch {
          readRecoveryFailed = true;
          console.warn(JSON.stringify({ component: 'xianyu-im', event: 'verification_read_recheck_failed', adminId, accountId,
            errorCode: 'XIANYU_VERIFICATION_READ_RECHECK_FAILED' }));
        }
      };
      await recheckReads();
      try { await recoverVerificationReads(this.store, this.mtop, this.verificationBrowser!, adminId, accountId); }
      catch (error) {
        if (error instanceof XianyuReadRecoveryError && error.abortAccountRecovery) throw error;
        readRecoveryFailed = true;
        console.warn(JSON.stringify({ component: 'xianyu-im', event: 'verification_read_recovery_failed', adminId, accountId,
          errorCode: 'XIANYU_VERIFICATION_READ_RECOVERY_FAILED' }));
      }
      let remaining = await this.store.getAccount(adminId, accountId);
      if (this.closed || !remaining || remaining.status === 'disabled' || remaining.status === 'expired') return;
      if ((await this.store.getCredential(adminId, accountId))?.status !== 'active') return;
      const remainingRisks = await this.store.listAccountVerificationRisks(adminId, accountId);
      if ((remaining?.riskEpisode || remaining?.status === 'verification_required')
        && remainingRisks.some(risk => isImVerificationSource(risk.source))) {
        await this.refreshActiveCredential(adminId, accountId, { forceCredentialRefresh: true });
        await recheckReads();
        remaining = await this.store.getAccount(adminId, accountId);
      }
      if (this.closed || !remaining || remaining.status === 'disabled' || remaining.status === 'expired') return;
      const savedCredential = await this.store.getCredential(adminId, accountId);
      if (savedCredential?.status !== 'active') return;
      if (!remaining.riskEpisode && remaining.status !== 'verification_required' && !this.clients.get(key)?.connected) {
        await this.ensureClient(adminId, accountId);
        remaining = await this.store.getAccount(adminId, accountId);
      }
      if (readRecoveryFailed || remaining?.riskEpisode || remaining?.status === 'verification_required') {
        if (!remainingRisks.some(risk => this.verificationRecoverySignals.get(key)?.has(risk.source)
          && attemptedRevisions.get(risk.source) !== risk.revision)) {
          this.verificationRetryAfter.set(key, Date.now() + 30_000);
        }
        console.warn(JSON.stringify({ component: 'xianyu-im', event: 'verification_recovery_pending', adminId, accountId,
          source, riskSource: remaining?.riskSource, errorCode: readRecoveryFailed ? 'XIANYU_VERIFICATION_READ_RECOVERY_FAILED' : 'XIANYU_VERIFICATION_RISK_UNRESOLVED' }));
        return;
      }
      console.info(JSON.stringify({ component: 'xianyu-im', event: 'verification_recovery_completed', adminId, accountId, source }));
    }).catch(error => {
      this.verificationRetryAfter.set(key, Date.now() + 30_000);
      console.warn(JSON.stringify({ component: 'xianyu-im', event: 'verification_recovery_failed', adminId, accountId, errorCode: recoveryErrorCode(error) }));
    }).finally(async () => {
      let pendingSource: string | undefined;
      try {
        if (!this.closed && this.verificationRecoverySignals.has(key)) {
          const generation = this.verificationRecoverySignalVersions.get(key);
          const pending = await this.store.listAccountVerificationRisks(adminId, accountId);
          pendingSource = pending.find(risk => this.verificationRecoverySignals.get(key)?.has(risk.source)
            && attemptedRevisions.get(risk.source) !== risk.revision)?.source;
          if (!pendingSource && generation !== this.verificationRecoverySignalVersions.get(key)) {
            pendingSource = this.verificationRecoverySignals.get(key)?.values().next().value;
          }
        }
      } catch { console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'pending_risk_scan_failed', accountId })); }
      finally {
        if (this.verificationRecoveryInFlight.get(key) === task) this.verificationRecoveryInFlight.delete(key);
        this.verificationRecoverySignals.delete(key);
        this.verificationRecoverySignalVersions.delete(key);
      }
      if (!this.closed && pendingSource) this.requestVerificationRecovery(adminId, accountId, pendingSource);
    });
    this.verificationRecoveryInFlight.set(key, task);
  }

  /** Ensure the account-scoped socket is usable before an irreversible send. */
  async isReady(adminId: string, accountId: string): Promise<boolean> {
    if (this.ownerClient) return this.ownerClient.call('isReady', [adminId, accountId]).catch(() => false);
    try {
      const client = await this.ensureClient(adminId, accountId);
      return client.connected;
    } catch {
      return false;
    }
  }

  async verifyPartialDeliveryImage(adminId: string, accountId: string, conversationId: string,
    expected: { externalMessageRef: string; imageUrl: string; startedAt: string }): Promise<boolean> {
    if (this.ownerClient) return this.ownerClient.call('verifyPartialDeliveryImage', [adminId, accountId, conversationId, expected]);
    const conversation = await this.getConversation(adminId, accountId, conversationId);
    if (!conversation.externalConversationRef) throw new ServiceError(409, 'EXTERNAL_CONVERSATION_MISSING', 'conversation is not linked to xianyu');
    const client = await this.ensureClient(adminId, accountId);
    const history = await client.listMessages(conversation.externalConversationRef, undefined, 100);
    return confirmPartialDeliveryImage(history.userMessageModels, client.selfUserIds, expected);
  }

  /**
   * Recover the newest messages for conversations already known locally.
   *
   * The IM gateway is a live stream, so a reconnect or a transient handler
   * failure can leave a message absent from the local timeline even though the
   * platform history endpoint still returns it. Importing history is
   * idempotent; buyer messages at or after the latest locally persisted
   * message are offered back to the durable inbound inbox, which itself
   * suppresses already-processed duplicates.
   */
  async recoverRecentMessages(adminId: string, accountId: string, options: { conversationLimit?: number; messageLimit?: number } = {}): Promise<{ conversationsScanned: number; imported: number; queued: number }> {
    if (this.ownerClient) return this.ownerClient.call('recoverRecentMessages', [adminId, accountId, options]);
    const client = await this.ensureClient(adminId, accountId);
    const conversationLimit = Math.min(100, Math.max(1, Math.trunc(options.conversationLimit ?? 50)));
    const messageLimit = Math.min(100, Math.max(1, Math.trunc(options.messageLimit ?? 20)));
    const conversations = await this.store.listConversations(adminId, { accountId, limit: conversationLimit });
    let imported = 0;
    let queued = 0;
    for (const conversation of conversations.items) {
      if (!conversation.externalConversationRef) continue;
      const local = await this.store.listMessages(adminId, conversation.id, { limit: 1 });
      const latestLocalCreatedAt = local.items[local.items.length - 1]?.createdAt;
      const page = await this.withAccountFailure(adminId, accountId, () => client.listMessages(conversation.externalConversationRef!, undefined, messageLimit), 'im_read');
      const models = Array.isArray(page.userMessageModels) ? page.userMessageModels : [];
      for (const item of [...models].reverse()) {
        const parsed = normalizeHistoryMessage(item, client.selfUserIds);
        if (!parsed) continue;
        const classified = await this.classifySystemCandidate(adminId, accountId, conversation.id, parsed);
        const importedMessage = await this.messages.importExternalMessage({
          adminId,
          conversationId: conversation.id,
          direction: parsed.direction,
          senderRole: parsed.direction === 'outbound' ? 'agent' : classified.bodyType === 'system' ? 'system' : 'buyer',
          bodyType: classified.bodyType,
          bodyText: parsed.bodyText,
          bodyRef: parsed.bodyRef,
          externalMessageRef: parsed.externalMessageRef,
          externalMessageRefAliases: parsed.externalMessageRefAliases,
          source: parsed.direction === 'outbound' ? 'human' : 'system',
          riskFlags: classified.riskFlags,
          createdAt: parsed.createdAt,
          traceId: `xianyu:recovery:${parsed.externalMessageRef}`,
        });
        if (importedMessage.created) imported += 1;
        if (parsed.direction === 'inbound' && parsed.platformSystemMessage && parseXianyuSystemMessageKind(parsed.bodyText) === 'paid_waiting_shipment' && this.refreshOrdersForTrustedOrderEvent) {
          await this.refreshOrdersForTrustedOrderEvent({ adminId, accountId, event: {
            accountId, externalConversationRef: conversation.externalConversationRef, externalMessageRef: parsed.externalMessageRef,
            senderRef: parsed.senderRef ?? conversation.buyerRef, itemRef: parsed.itemRef ?? conversation.itemRef,
            direction: 'inbound', bodyType: 'system', bodyText: parsed.bodyText, platformSystemMessage: true,
            occurredAt: parsed.createdAt, raw: record(item),
          } });
        }
        if (!this.autoReply || parsed.direction !== 'inbound' || !['text', 'image'].includes(classified.bodyType)) continue;
        if (latestLocalCreatedAt && parsed.createdAt < latestLocalCreatedAt) continue;
        const inbox = await this.store.enqueueInboundInbox({
          adminId,
          accountId,
          conversationId: conversation.id,
          inboundMessageId: importedMessage.message.messageId,
          externalConversationRef: conversation.externalConversationRef,
          externalMessageRef: parsed.externalMessageRef,
          sourceEventId: `history:${parsed.externalMessageRef}`,
        });
        if (inbox.created) queued += 1;
      }
    }
    return { conversationsScanned: conversations.items.length, imported, queued };
  }

  private async reconcileOutboundSend(adminId: string, accountId: string, conversationRef: string, expected: { bodyType: 'text' | 'image'; content: string; startedAt: string }): Promise<string | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await new Promise<void>((resolve) => setTimeout(resolve, 350 * attempt));
      try {
        const client = await this.ensureClient(adminId, accountId);
        const page = await client.listMessages(conversationRef, undefined, 100);
        const match = matchRecentOutboundMessage(page.userMessageModels, client.selfUserIds, expected);
        if (match) {
          console.info(JSON.stringify({ component: 'xianyu-im', event: 'send_ack_reconciled', accountId, bodyType: expected.bodyType, externalMessageRef: match }));
          return match;
        }
      } catch (error) {
        console.warn(JSON.stringify({ component: 'xianyu-im', event: 'send_ack_reconcile_failed', accountId, bodyType: expected.bodyType, errorCode: recoveryErrorCode(error) }));
      }
    }
    return undefined;
  }

  async deleteAccountState(adminId: string, accountId: string): Promise<void> {
    if (this.ownerClient) return this.ownerClient.call('deleteAccountState', [adminId, accountId]);
    this.deletedAccounts.add(accountId);
    const matches = (key: string) => key.endsWith(`:${accountId}`);
    for (const timers of [this.credentialRefreshTimers, this.verificationRecoveryTimers]) {
      for (const [key, timer] of timers) if (matches(key)) { clearTimeout(timer); timers.delete(key); }
    }
    for (const [key, timer] of this.transportHeartbeatTimers) if (matches(key)) { clearInterval(timer); this.transportHeartbeatTimers.delete(key); }
    const pending: Promise<unknown>[] = [];
    for (const entries of [this.clientInFlight, this.verificationInFlight, this.recoveryInFlight, this.chatRefreshInFlight, this.credentialRefreshInFlight, this.tokenRefreshInFlight, this.verificationRecoveryInFlight]) {
      for (const [key, promise] of entries) if (matches(key)) pending.push(promise);
    }
    await Promise.allSettled(pending);
    for (const [key, client] of this.clients) if (matches(key)) { this.clients.delete(key); await client.disconnect(); }
    for (const entries of [this.clientInFlight, this.verificationInFlight, this.recoveryInFlight, this.recoveryRetryAfter, this.verificationRetryAfter, this.chatRefreshInFlight, this.credentialRefreshInFlight, this.tokenRefreshInFlight, this.verificationRecoveryInFlight]) {
      for (const key of entries.keys()) if (matches(key)) entries.delete(key);
    }
    for (const key of this.identityCache.keys()) if (key.startsWith(`${accountId}:`)) this.identityCache.delete(key);
  }

  async resetClient(adminId: string, accountId: string): Promise<void> {
    if (this.ownerClient) return this.ownerClient.call('resetClient', [adminId, accountId]);
    const key = `${adminId}:${accountId}`;
    const client = this.clients.get(key);
    if (!client) return;
    this.clients.delete(key);
    this.stopTransportHeartbeat(key);
    await client.disconnect();
  }

  private async getConversation(adminId: string, accountId: string, conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.store.getConversation(adminId, conversationId);
    if (!conversation || conversation.accountId !== accountId) throw new ServiceError(404, 'NOT_FOUND', 'conversation not found');
    return conversation;
  }

  private async ensureClient(adminId: string, accountId: string, options: { forceCredentialRefresh?: boolean } = {}): Promise<XianyuImClient> {
    if (this.ownerClient) throw new ServiceError(503, 'XIANYU_IM_OWNER_REQUIRED', 'IM connections belong to the API process');
    if (this.deletedAccounts.has(accountId)) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
    const key = `${adminId}:${accountId}`;
    if (options.forceCredentialRefresh) {
      const existing = this.clients.get(key);
      if (existing) {
        this.clients.delete(key);
        this.stopTransportHeartbeat(key);
        await existing.disconnect().catch(() => undefined);
      }
    }
    const existing = this.clients.get(key);
    if (existing) {
      try { await existing.connect(); return existing; } catch (error) {
        await this.markAccountFailure(adminId, accountId, error, 'im_listener');
        if (this.clients.get(key) === existing) this.clients.delete(key);
        // Existing clients can schedule their own reconnect timer before
        // connect() rejects. Stop that timer before dropping the reference;
        // otherwise every retry can launch another verification browser.
        await existing.disconnect().catch(() => undefined);
      }
    }
    const inFlight = this.clientInFlight.get(key);
    if (inFlight) return inFlight;

    const connectPromise = (async () => {
      try {
        const account = await this.store.getAccount(adminId, accountId);
        if (!account) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
        const loadedCredential = await this.store.getCredential(adminId, accountId);
        if (!loadedCredential?.cookieHeader) throw new ServiceError(409, 'CREDENTIAL_MISSING', 'account credential is missing');
        let connectionRisks = await this.store.listAccountVerificationRisks(adminId, accountId);
        let tokenRechecked = false;
        let credential: CredentialRecord = loadedCredential;
        if (!credential.accessToken || options.forceCredentialRefresh
          || (this.verificationBrowser?.enabled && account.status === 'verification_required')) {
          credential = await this.refreshCredential(adminId, account, credential);
          tokenRechecked = true;
        }
        credential = structuredClone(credential);
        let connectionAttemptStartedAt = new Date().toISOString();
        const client = this.imClientFactory({
          accountId,
          credential: toImCredential(credential),
          selfUserIds: [account.sellerRef, account.platformUserId].filter((value): value is string => Boolean(value)),
          refreshCredential: async () => {
            const current = await this.store.getCredential(adminId, accountId);
            if (!current?.cookieHeader) throw new ServiceError(409, 'CREDENTIAL_MISSING', 'account credential is missing');
            if (current.generation !== credential.generation || current.status !== 'active') throw new ServiceError(409, 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED', '账号凭证已变化');
            connectionRisks = await this.store.listAccountVerificationRisks(adminId, accountId);
            connectionAttemptStartedAt = new Date().toISOString();
            credential = structuredClone(await this.refreshCredential(adminId, account, current));
            tokenRechecked = true;
            return toImCredential(credential);
          },
          onStatusChange: (status) => {
            const generation = credential.generation;
            return this.serializeClientHealth(key, async () => {
              // An old client cannot publish after reset/replacement. All
              // heartbeat and status writes for this account share this lane.
              if (this.clients.has(key) && this.clients.get(key) !== client) return;
              const generationNow = await this.store.getCredential(adminId, accountId);
              if (generationNow?.generation !== generation || generationNow?.status !== 'active') return;
              if (status === 'connected' && !client.connected) return;
              if (status === 'connecting' || status === 'reconnecting') connectionAttemptStartedAt = new Date().toISOString();
              const transport = status === 'connected' ? 'connecting' : status === 'connecting' || status === 'reconnecting' ? 'connecting' : status === 'failed' ? 'failed' : 'disconnected';
              this.stopTransportHeartbeat(key);
              await this.store.setAccountTransport({ adminId, accountId, status: transport, expectedGeneration: generation });
            });
          },
          onHeartbeat: (receivedAt, epoch) => {
            // Freeze the socket generation and recovery evidence before any
            // queue/storage wait. Reconnect on this same object is a new epoch.
            const generation = credential.generation;
            const risks = structuredClone(connectionRisks);
            const startedAt = connectionAttemptStartedAt;
            const tokenVerified = tokenRechecked;
            const connectionEpoch = epoch ?? client.connectionEpoch;
            const live = () => client.connected && client.connectionEpoch === connectionEpoch
              && (!this.clients.has(key) || this.clients.get(key) === client)
              && Date.now() - Date.parse(receivedAt) <= 5_000;
            return this.serializeClientHealth(key, async () => {
              if (!live()) return;
              const current = await this.store.getCredential(adminId, accountId);
              if (!live() || !current || current.generation !== generation || current.status !== 'active') return;
              await this.store.setAccountTransport({ adminId, accountId, status: 'connected', expectedGeneration: generation });
              if (!live()) return;
              for (const risk of risks) {
                if (!live()) return;
                if (!['im_listener', 'xianyu', XIANYU_IM_TOKEN_API].includes(risk.source)) continue;
                if (risk.source === XIANYU_IM_TOKEN_API && !tokenVerified) continue;
                await this.store.clearAccountRisk({ adminId, accountId, episode: risk.episode, source: risk.source,
                  expectedRiskRevision: risk.revision, expectedGeneration: generation, startedAt, isCurrent: live });
                if (!live()) return;
              }
              await this.store.clearAccountDegraded({ adminId, accountId, source: 'im_listener', startedAt, expectedGeneration: generation, isCurrent: live });
              if (live()) this.scheduleRecentMessageRecovery(adminId, accountId);
            });
          },
          onFailure: async (error) => { await this.markAccountFailure(adminId, accountId, error, 'im_listener', credential.generation); },
          onEvent: async (event) => {
            await this.handleExternalEvent(adminId, event, { deferAutoReply: true });
            // The dedicated worker remains the durable primary path. Wake a
            // local one-shot poll as a fallback so API-only deployments do
            // not leave queued replies waiting for a separate process.
            this.wakeInboundInboxWorker();
          },
          onQuarantine: async (event) => { await this.store.recordInboundQuarantine(event); },
          saveCredential: async (next) => { credential = structuredClone(await this.saveCredential(adminId, account, next, credential)); },
        });
        try { await client.connect(); } catch (error) {
          if (this.clients.get(key) === client) this.clients.delete(key);
          // A failed bootstrap can schedule the client's internal reconnect
          // timer before surfacing the original error. Stop that client here
          // so a validation challenge cannot spawn orphan browser windows in
          // the background after the request has already failed.
          await client.disconnect().catch(() => undefined);
          throw error;
        }
        this.clients.set(key, client);
        return client;
      } catch (error) {
        await this.markAccountFailure(adminId, accountId, error, 'im_listener');
        throw error;
      }
    })();
    this.clientInFlight.set(key, connectPromise);
    try {
      return await connectPromise;
    } finally {
      if (this.clientInFlight.get(key) === connectPromise) this.clientInFlight.delete(key);
    }
  }

  private refreshCredential(adminId: string, account: AccountRecord, credential: CredentialRecord): Promise<CredentialRecord> {
    const key = `${adminId}:${account.id}`;
    const existing = this.tokenRefreshInFlight.get(key);
    if (existing) return existing;
    const task = Promise.resolve().then(() => this.refreshCredentialInternal(adminId, account, credential)).finally(() => {
      if (this.tokenRefreshInFlight.get(key) === task) this.tokenRefreshInFlight.delete(key);
    });
    this.tokenRefreshInFlight.set(key, task);
    return task;
  }

  private async refreshCredentialInternal(adminId: string, account: AccountRecord, credential: CredentialRecord): Promise<CredentialRecord> {
    const initial = structuredClone(credential);
    const isolated = this.mtop.createCredentialSession?.(adminId, account.id, initial);
    const tokenClient = isolated?.client ?? this.mtop;
    const deviceId = credential.deviceId ?? `xianyu-${account.id}`;
    let token = await tokenClient.fetchImToken(adminId, account.id, deviceId);
    if (!token.success || !token.accessToken) {
      if (token.errorCode === 'ACCOUNT_VALIDATION_REQUIRED' && this.verificationBrowser?.enabled && token.verificationUrl) {
        const latest = initial;
        const nativeRecoveryStartedAt = new Date().toISOString();
        // Keep stable account cookies from the browser snapshot, but prefer
        // the fresh flat header returned by this validation response. The
        // x5secdata/x5sectag markers in that header bind the challenge URL to
        // this browser session and must be present while solving it.
        const initialSnapshot = mergeCookieSnapshots(
          cookieSnapshotFromMetadata(latest.metadata)?.filter((cookie) => !isCaptchaChallengeCookie(cookie.name)),
          cookieSnapshotFromHeader(token.cookieHeader || latest.cookieHeader || credential.cookieHeader),
        );
        let completed: XianyuVerificationBrowserResult | undefined;
        const verificationKey = `${adminId}:${account.id}`;
        try {
          // Use the verification browser's configured timeout. The browser
          // owns the production wait budget because slider solving can take
          // longer than a short IM request retry window.
          const retryAfter = this.verificationRetryAfter.get(verificationKey) ?? 0;
          if (retryAfter > Date.now()) throw new Error('XIANYU_VERIFICATION_COOLDOWN');
          const existingVerification = this.verificationInFlight.get(verificationKey);
          if (existingVerification) {
            completed = await existingVerification;
          } else {
            const verificationPromise = this.verificationBrowser.waitForCompletion({
              verificationUrl: token.verificationUrl,
              profileKey: account.id,
              initialCookieSnapshot: initialSnapshot,
              allowManualFallback: false,
              pollIntervalMs: 250,
              imTokenRequest: { deviceId, expectedUserId: account.platformUserId ?? account.sellerRef },
            });
            this.verificationInFlight.set(verificationKey, verificationPromise);
            try {
              completed = await verificationPromise;
              this.verificationRetryAfter.delete(verificationKey);
            } catch (error) {
              this.verificationRetryAfter.set(verificationKey, Date.now() + 30_000);
              throw error;
            } finally {
              if (this.verificationInFlight.get(verificationKey) === verificationPromise) this.verificationInFlight.delete(verificationKey);
            }
          }
        } catch (error) {
          console.warn(JSON.stringify({ component: 'xianyu-im', event: 'verification_browser_failed', adminId, accountId: account.id, errorCode: recoveryErrorCode(error) }));
        }
        // Database failures must propagate, rather than becoming a slider failure.
        if (completed) {
          const mergedSnapshot = dropStaleCaptchaChallengeCookies(completed.imToken
            ? completed.cookieSnapshot
            : mergeCookieSnapshots(initialSnapshot, completed.cookieSnapshot));
          const browserCookieHeader = cookieHeaderFromSnapshot(completed.imToken
            ? mergedSnapshot.filter(cookie => /(^|\.)goofish\.com$/.test(cookie.domain ?? '')
              && cookie._crHasCrossSiteAncestor !== true)
            : mergedSnapshot);
          const current = latest;
          const browserMetadata = metadataWithCookieSnapshot(current.metadata, mergedSnapshot);
          if (completed.imToken) {
            const native = completed.imToken;
            if (!browserCookieHeader || !native.accessToken?.trim() || native.deviceId !== deviceId
              || native.userId !== (account.platformUserId ?? account.sellerRef)) {
              throw new ServiceError(409, 'XIANYU_BROWSER_IM_IDENTITY_MISMATCH', '浏览器恢复凭证与当前账号不匹配');
            }
            // Save the matching cookie snapshot and native token together before
            // any IM client can use the recovered credential.
            const saved = await this.store.commitCredentialRefresh({ adminId, accountId: account.id, expected: current,
              cookieHeader: browserCookieHeader, accessToken: native.accessToken, deviceId, metadata: browserMetadata });
            if (!saved) throw new ServiceError(409, 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED', '账号凭证已变化');
            await this.store.clearAccountDegraded({ adminId, accountId: account.id, source: XIANYU_IM_TOKEN_API, startedAt: nativeRecoveryStartedAt });
            return saved;
          }
          const fallbackHeader = browserCookieHeader || token.cookieHeader || latest.cookieHeader || credential.cookieHeader;
          if (!fallbackHeader) throw new ServiceError(409, 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED', '账号凭证已变化');
          const first = await this.store.commitCredentialRefresh({
            adminId,
            accountId: account.id,
            expected: current,
            cookieHeader: fallbackHeader,
            deviceId,
            accessToken: current.accessToken,
            metadata: browserMetadata,
          });
          if (!first) throw new ServiceError(409, 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED', '账号凭证已变化');
          const retryExpected = structuredClone(first);
          const retrySession = this.mtop.createCredentialSession?.(adminId, account.id, retryExpected);
          token = await (retrySession?.client ?? this.mtop).fetchImToken(adminId, account.id, deviceId);
          if (token.success && token.accessToken) {
            const buffered = retrySession?.getCredential() ?? retryExpected;
            const saved = await this.store.commitCredentialRefresh({ adminId, accountId: account.id, expected: retryExpected, cookieHeader: token.cookieHeader, accessToken: token.accessToken, deviceId, metadata: buffered.metadata ?? retryExpected.metadata });
            if (!saved) throw new ServiceError(409, 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED', '账号凭证已变化');
            return saved;
          }
          this.verificationRetryAfter.set(verificationKey, Date.now() + 30_000);
        }
      }
      const statusCode = token.errorCode === 'ACCOUNT_VALIDATION_REQUIRED' ? 409 : token.accountInvalid ? 401 : 502;
      const message = token.errorCode === 'ACCOUNT_VALIDATION_REQUIRED'
        ? '请先在闲鱼页面完成滑块验证，再把验证后的最新完整 Cookie 回写到账号管理。'
        : token.message ?? 'unable to obtain xianyu im token';
      throw new ServiceError(statusCode, token.errorCode ?? 'IM_TOKEN_FAILED', message);
    }
    const buffered = isolated?.getCredential() ?? initial;
    const saved = await this.store.commitCredentialRefresh({ adminId, accountId: account.id, expected: initial, cookieHeader: token.cookieHeader, accessToken: token.accessToken, deviceId, metadata: buffered.metadata ?? initial.metadata });
    if (!saved) throw new ServiceError(409, 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED', '账号凭证已变化');
    return saved;
  }

  private scheduleCredentialRefresh(adminId: string, accountId: string): void {
    if (this.deletedAccounts.has(accountId)) return;
    const key = `${adminId}:${accountId}`;
    if (this.closed || this.credentialRefreshTimers.has(key)) return;
    const plan = planXianyuChatRefresh();
    const timer = setTimeout(() => {
      // Keep the timer registered until work completes so repeated listener starts
      // cannot create a second schedule while the request is in flight.
      let keepScheduling = true;
      void Promise.resolve().then(async () => {
        if (this.closed) return;
        // A suspended process may resume in a quieter period than it planned for.
        if (plan.refresh && planXianyuChatRefresh(Date.now(), () => 0).period === plan.period) {
          keepScheduling = await this.refreshChatSession(adminId, accountId);
        }
      }).catch((error) => {
        console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'credential_refresh_failed', adminId, accountId, errorCode: recoveryErrorCode(error) }));
      }).finally(() => {
        if (this.credentialRefreshTimers.get(key) !== timer) return;
        this.credentialRefreshTimers.delete(key);
        if (keepScheduling && !this.closed) this.scheduleCredentialRefresh(adminId, accountId);
      });
    }, plan.delayMs);
    timer.unref?.();
    this.credentialRefreshTimers.set(key, timer);
    console.info(JSON.stringify({ component: 'xianyu-im-listener', event: 'chat_refresh_scheduled', adminId, accountId,
      period: plan.period, delayMs: plan.delayMs, refresh: plan.refresh }));
  }

  /** HTTP session maintenance does not interrupt a healthy message listener. */
  private refreshChatSession(adminId: string, accountId: string): Promise<boolean> {
    const key = `${adminId}:${accountId}`;
    const existing = this.chatRefreshInFlight.get(key);
    if (existing) return existing;
    const task = Promise.resolve().then(async () => {
      // Let account recovery/token refresh own the credential if already active.
      if (this.closed || this.verificationRecoveryInFlight.has(key) || this.tokenRefreshInFlight.has(key)
        || this.credentialRefreshInFlight.has(key) || this.clientInFlight.has(key)) return true;
      const account = await this.store.getAccount(adminId, accountId);
      const loaded = await this.store.getCredential(adminId, accountId);
      // MemoryStore mutates records in place; retain the original generation.
      const credential = loaded ? { ...loaded, metadata: { ...loaded.metadata } } : undefined;
      if (!account || account.status === 'disabled' || !credential || credential.status === 'revoked' || !credential.cookieHeader) return false;
      if (credential.status !== 'active' || account.status === 'verification_required') return true;
      // Recheck after storage awaits, then reserve the same single-flight slot
      // used by socket 401 and verification recovery before issuing any HTTP.
      if (this.closed || this.tokenRefreshInFlight.has(key) || this.credentialRefreshInFlight.has(key)
        || this.verificationRecoveryInFlight.has(key) || this.clientInFlight.has(key)) return true;
      let committed = false;
      const tokenTask = Promise.resolve().then(async () => {
        const next = await refreshXianyuChatRequests(this.mtop, adminId, account,
          { ...credential, deviceId: credential.deviceId ?? this.clients.get(key)?.deviceId });
        if (this.closed) throw new ServiceError(409, 'CREDENTIAL_REFRESH_CANCELLED', '会话维护已停止');
        // Cookie deltas have only touched the request-local snapshot so far.
        const saved = await this.store.commitCredentialRefresh({ adminId, accountId, expected: credential,
          cookieHeader: next.cookieHeader, accessToken: next.accessToken!, deviceId: next.deviceId!, metadata: next.metadata });
        if (saved) { committed = true; return saved; }
        // An on-demand caller sharing this promise may use the newer generation.
        const current = await this.store.getCredential(adminId, accountId);
        if (current?.status === 'active' && current.cookieHeader && current.accessToken) return current;
        throw new ServiceError(409, 'CREDENTIAL_REFRESH_SUPERSEDED', '账号凭证已撤销或替换');
      }).finally(() => {
        if (this.tokenRefreshInFlight.get(key) === tokenTask) this.tokenRefreshInFlight.delete(key);
      });
      this.tokenRefreshInFlight.set(key, tokenTask);
      const saved = await tokenTask;
      if (this.closed) return false;
      if (!committed) return true;
      const client = this.clients.get(key);
      client?.updateCredential(toImCredential(saved));
      if (!client?.connected) await this.ensureClient(adminId, accountId);
      console.info(JSON.stringify({ component: 'xianyu-im-listener', event: 'chat_refresh_completed', adminId, accountId }));
      return true;
    }).finally(() => {
      if (this.chatRefreshInFlight.get(key) === task) this.chatRefreshInFlight.delete(key);
    });
    this.chatRefreshInFlight.set(key, task);
    return task;
  }

  private async refreshActiveCredential(adminId: string, accountId: string, options: { forceCredentialRefresh?: boolean } = {}): Promise<void> {
    const key = `${adminId}:${accountId}`;
    const existing = this.credentialRefreshInFlight.get(key);
    if (existing) return existing;
    const task = (async () => {
      const client = this.clients.get(key);
      if (!client || !client.connected) {
        await this.ensureClient(adminId, accountId, options);
        return;
      }
      await client.refreshSession();
    })().finally(() => {
      if (this.credentialRefreshInFlight.get(key) === task) this.credentialRefreshInFlight.delete(key);
    });
    this.credentialRefreshInFlight.set(key, task);
    return task;
  }

  private async markAccountFailure(adminId: string, accountId: string, error: unknown, source = 'im', expectedGeneration?: number): Promise<void> {
      const account = await this.store.getAccount(adminId, accountId);
      if (!account || account.status === 'disabled' || (expectedGeneration !== undefined && account.credentialGeneration !== expectedGeneration)) return;
      const code = error instanceof ServiceError ? error.code : (error as { code?: unknown } | null)?.code;
      const normalizedCode = typeof code === 'string' ? code : error instanceof Error ? error.message : String(error);
      const classification = classifyXianyuFailure({ errorCode: normalizedCode });
      if (classification.kind === 'verification_required') {
        await this.store.recordAccountRisk({ adminId, accountId, code: normalizedCode.slice(0, 120), source, expectedGeneration });
        this.requestVerificationRecovery(adminId, accountId, source);
        await this.notifyVerificationRequired?.(adminId, accountId, source);
        return;
      }
      const status = classification.accountStatus!;
      if (account.status === 'expired' && status === 'degraded') return;
      if (status === 'degraded') await this.store.recordAccountDegraded({ adminId, accountId, source, expectedGeneration });
      else if (account.status !== status) await this.store.updateAccount(adminId, accountId, { status });
  }

  private scheduleRecentMessageRecovery(adminId: string, accountId: string): void {
    if (typeof this.store.listConversations !== 'function') return;
    const key = `${adminId}:${accountId}`;
    if (this.recoveryInFlight.has(key)) return;
    if ((this.recoveryRetryAfter.get(key) ?? 0) > Date.now()) return;
    const task = new Promise<void>((resolve) => {
      setTimeout(() => {
        void this.recoverRecentMessages(adminId, accountId)
          .then((result) => {
            this.recoveryRetryAfter.delete(key);
            if (result.imported > 0 || result.queued > 0) {
              console.info(JSON.stringify({ component: 'xianyu-im-listener', event: 'history_recovery_completed', adminId, accountId, ...result }));
            }
          })
          .catch((error) => {
            this.recoveryRetryAfter.set(key, Date.now() + 30_000);
            console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'history_recovery_failed', adminId, accountId, errorCode: recoveryErrorCode(error) }));
          })
          .finally(resolve);
      }, 0);
    }).finally(() => {
      if (this.recoveryInFlight.get(key) === task) this.recoveryInFlight.delete(key);
    });
    this.recoveryInFlight.set(key, task);
  }

  private async withAccountFailure<T>(adminId: string, accountId: string, operation: () => Promise<T>, source = 'im'): Promise<T> {
    const startedAt = new Date().toISOString();
    try {
      const result = await operation();
      if (source === 'im_read') {
        const account = await this.store.getAccount(adminId, accountId);
        if (account?.riskEpisode) await this.store.clearAccountRisk({ adminId, accountId, episode: account.riskEpisode, source, startedAt });
        if (account) await this.store.clearAccountDegraded({ adminId, accountId, source, startedAt });
      }
      return result;
    } catch (error) {
      await this.markAccountFailure(adminId, accountId, error, source);
      throw error;
    }
  }

  private async clearImSendRisk(adminId: string, accountId: string, startedAt: string): Promise<void> {
    const account = await this.store.getAccount(adminId, accountId);
    if (account?.riskEpisode) {
      await this.store.clearAccountRisk({ adminId, accountId, episode: account.riskEpisode, source: 'im', startedAt });
    }
    if (account) await this.store.clearAccountDegraded({ adminId, accountId, source: 'im', startedAt });
  }

  private serializeClientHealth(key: string, work: () => Promise<void>): Promise<void> {
    const prior = this.clientHealthLanes.get(key) ?? Promise.resolve();
    const task = prior.catch(() => undefined).then(work);
    this.clientHealthLanes.set(key, task);
    void task.finally(() => { if (this.clientHealthLanes.get(key) === task) this.clientHealthLanes.delete(key); }).catch(() => undefined);
    return task;
  }

  private stopTransportHeartbeat(key: string): void {
    const timer = this.transportHeartbeatTimers.get(key);
    if (timer) clearInterval(timer);
    this.transportHeartbeatTimers.delete(key);
  }

  private async saveCredential(adminId: string, account: AccountRecord, credential: XianyuImCredential, expected: CredentialRecord): Promise<CredentialRecord> {
    // IM token refresh callbacks only carry the refreshed transport fields.
    // Preserve the browser cookie snapshot and expiry metadata already stored
    // by QR/cookie login; dropping them forces image uploads back to a stale
    // flat Cookie header and causes SESSION_EXPIRED on the upload host.
    const saved = await this.store.commitCredentialRefresh({
      adminId,
      accountId: account.id,
      expected: structuredClone(expected),
      cookieHeader: credential.cookieHeader,
      accessToken: credential.accessToken,
      deviceId: credential.deviceId,
      metadata: expected.metadata,
    });
    if (!saved) throw new ServiceError(409, 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED', '账号凭证已变化');
    return saved;
  }

  private async enrichConversationIdentity(adminId: string, accountId: string, parsed: { externalConversationRef: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; unreadCount?: number; lastMessagePreview?: string; lastMessageAt?: string }): Promise<typeof parsed> {
    const cacheKey = `${accountId}:${parsed.externalConversationRef}`;
    const cached = this.identityCache.get(cacheKey);
    if (cached) return { ...parsed, ...cached };
    if (parsed.buyerAvatarUrl && parsed.buyerDisplayName) {
      this.identityCache.set(cacheKey, { buyerDisplayName: parsed.buyerDisplayName, buyerAvatarUrl: parsed.buyerAvatarUrl });
      return parsed;
    }
    try {
      const profile = await withTimeout(this.mtop.fetchChatUserInfo(adminId, accountId, parsed.externalConversationRef), 2_500);
      if (!profile) return parsed;
      const identity = { buyerDisplayName: profile.buyerDisplayName, buyerAvatarUrl: profile.buyerAvatarUrl };
      if (identity.buyerDisplayName || identity.buyerAvatarUrl) this.identityCache.set(cacheKey, identity);
      return { ...parsed, buyerDisplayName: parsed.buyerDisplayName ?? identity.buyerDisplayName, buyerAvatarUrl: parsed.buyerAvatarUrl ?? identity.buyerAvatarUrl };
    } catch {
      return parsed;
    }
  }

  async handleExternalEvent(adminId: string, event: XianyuImMessageEvent | XianyuImReadReceiptEvent, options: { deferAutoReply?: boolean } = {}): Promise<{ created: boolean; autoReply?: AutoReplyProcessResult; automation?: ProductAutomationImEventResult }> {
    if (isReadReceiptEvent(event)) {
      const externalConversationRef = event.externalConversationRef;
      if (!externalConversationRef) return { created: false };
      const conversation = await this.store.findConversationByExternalRef(adminId, event.accountId, externalConversationRef);
      if (!conversation) return { created: false };
      await this.messages.markExternalMessageRead({
        adminId,
        accountId: event.accountId,
        conversationId: conversation.id,
        externalMessageRef: event.externalMessageRef,
        readAt: new Date(event.readAt).toISOString(),
        requestId: `xianyu:read:${event.externalMessageRef}`,
        traceId: `xianyu:read:${event.externalMessageRef}`,
      });
      return { created: false };
    }
    let conversation = await this.store.findConversationByExternalRef(adminId, event.accountId, event.externalConversationRef);
    const account = await this.store.getAccount(adminId, event.accountId);
    const client = this.clients.get(`${adminId}:${event.accountId}`);
    const selfUserIds = [
      account?.sellerRef,
      account?.platformUserId,
      ...(client?.selfUserIds ?? []),
    ].filter((value): value is string => Boolean(value));
    let effectiveEvent = reconcileMessageDirection(event, selfUserIds, conversation?.buyerRef);
    const trustedOrderEventKind = trustedOrderRefreshKind(effectiveEvent);
    if (trustedOrderEventKind && this.refreshOrdersForTrustedOrderEvent) {
      await this.refreshOrdersForTrustedOrderEvent({ adminId, accountId: event.accountId, event: effectiveEvent });
    }
    const classified = await this.classifySystemCandidate(adminId, event.accountId, conversation?.id, effectiveEvent);
    effectiveEvent = { ...effectiveEvent, bodyType: classified.bodyType, riskFlags: classified.riskFlags };
    if (event.direction === 'inbound' && !event.senderName && !conversation?.buyerDisplayName) {
      // Gateway pushes can omit the nickname even though the conversation
      // itself is addressable by a stable external ref. Resolve the profile
      // before the allowlist gate so a missing display name does not turn a
      // valid buyer into an unconditional TEST_BUYER_NOT_ALLOWLISTED skip.
      const enriched = await this.enrichConversationIdentity(adminId, event.accountId, {
        externalConversationRef: event.externalConversationRef,
        buyerRef: event.senderRef,
      });
      if (enriched.buyerDisplayName) effectiveEvent = { ...effectiveEvent, senderName: enriched.buyerDisplayName };
    }
    if (!conversation && effectiveEvent.direction === 'inbound') {
      conversation = await this.store.upsertExternalConversation({
        adminId,
        accountId: effectiveEvent.accountId,
        externalConversationRef: effectiveEvent.externalConversationRef,
        buyerRef: effectiveEvent.senderRef,
        buyerDisplayName: effectiveEvent.senderName,
        itemRef: effectiveEvent.itemRef,
        itemTitle: effectiveEvent.itemTitle,
        itemImageUrl: effectiveEvent.itemImageUrl,
        unreadCount: 0,
        lastMessagePreview: effectiveEvent.bodyText,
        lastMessageAt: effectiveEvent.occurredAt,
      });
    } else if (conversation && effectiveEvent.direction === 'inbound' && hasConversationMetadataPatch(conversation, effectiveEvent)) {
      // Persist a recovered nickname so later events can use the local
      // conversation identity even if profile lookup is temporarily down, and
      // fill product metadata carried by the live push before a manual list
      // refresh has a chance to run.
      conversation = await this.store.upsertExternalConversation({
        adminId,
        accountId: effectiveEvent.accountId,
        externalConversationRef: effectiveEvent.externalConversationRef,
        buyerRef: effectiveEvent.senderRef,
        buyerDisplayName: effectiveEvent.senderName,
        itemRef: effectiveEvent.itemRef,
        itemTitle: effectiveEvent.itemTitle,
        itemImageUrl: effectiveEvent.itemImageUrl,
      });
    }
    if (!conversation) return { created: false };
    const imported = await this.messages.importExternalMessage({
      adminId,
      conversationId: conversation.id,
      direction: effectiveEvent.direction,
      senderRole: effectiveEvent.direction === 'outbound' ? 'agent' : effectiveEvent.bodyType === 'system' ? 'system' : 'buyer',
      bodyType: effectiveEvent.bodyType,
      bodyText: effectiveEvent.bodyText,
      bodyRef: effectiveEvent.assetRef,
      externalMessageRef: effectiveEvent.externalMessageRef,
      externalMessageRefAliases: effectiveEvent.externalMessageRefAliases,
      source: effectiveEvent.direction === 'outbound' ? 'human' : 'system',
      riskFlags: effectiveEvent.riskFlags,
      createdAt: effectiveEvent.occurredAt,
      traceId: `xianyu:push:${effectiveEvent.externalMessageRef}`,
    });
    const automation = this.productAutomation ? await this.productAutomation.onImEvent(adminId, effectiveEvent) : undefined;
    if (effectiveEvent.direction !== 'inbound' || !['text', 'image'].includes(effectiveEvent.bodyType) || !this.autoReply) return { created: imported.created, ...(automation ? { automation } : {}) };
    if (options.deferAutoReply) {
      await this.store.enqueueInboundInbox({ adminId, accountId: effectiveEvent.accountId, conversationId: conversation.id, inboundMessageId: imported.message.messageId, externalConversationRef: effectiveEvent.externalConversationRef, externalMessageRef: effectiveEvent.externalMessageRef, sourceEventId: effectiveEvent.sourceEventId ?? effectiveEvent.externalMessageRef, sourceSequence: effectiveEvent.sourceSequence });
      return { created: imported.created, ...(automation ? { automation } : {}) };
    }
    const autoReply = await this.autoReply.processInbound({ adminId, conversationId: conversation.id, inboundMessageId: imported.message.messageId, senderName: effectiveEvent.senderName, requestId: `xianyu:auto-reply:${effectiveEvent.externalMessageRef}`, traceId: `xianyu:auto-reply:${effectiveEvent.externalMessageRef}`, sourceEventId: effectiveEvent.sourceEventId ?? effectiveEvent.externalMessageRef, sourceSequence: effectiveEvent.sourceSequence });
    return { created: imported.created, autoReply, ...(automation ? { automation } : {}) };
  }

  async processInboundInbox(record: InboundInboxRecord): Promise<AutoReplyProcessResult | undefined> {
    if (!this.autoReply) return undefined;
    const conversation = await this.store.getConversation(record.adminId, record.conversationId);
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    const inbound = await this.store.findMessageByExternalRef(record.adminId, record.conversationId, record.externalMessageRef);
    if (!inbound) throw new Error('INBOUND_MESSAGE_NOT_FOUND');
    return this.autoReply.processInbound({ adminId: record.adminId, conversationId: record.conversationId, inboundMessageId: inbound.id, senderName: conversation.buyerDisplayName, requestId: `xianyu:auto-reply:${record.externalMessageRef}`, traceId: `xianyu:auto-reply:${record.externalMessageRef}`, sourceEventId: record.sourceEventId ?? record.externalMessageRef, sourceSequence: record.sourceSequence });
  }

  private async classifySystemCandidate(
    adminId: string,
    accountId: string,
    conversationId: string | undefined,
    message: { bodyType: 'text' | 'image' | 'system'; bodyText?: string; senderRef?: string; itemRef?: string; platformSystemMessage?: boolean; riskFlags?: string[] },
  ): Promise<{ bodyType: 'text' | 'image' | 'system'; riskFlags?: string[] }> {
    const baseRiskFlags = [...new Set(message.riskFlags ?? [])];
    if (message.bodyType !== 'text' || !message.platformSystemMessage) {
      return { bodyType: message.bodyType, riskFlags: baseRiskFlags.length > 0 ? baseRiskFlags : undefined };
    }
    const kind = parseXianyuSystemMessageKind(message.bodyText);
    // Generic platform reminders do not carry an order-status phrase. The
    // gateway reminder marker is still authoritative, so isolate them as
    // system messages and keep them out of the buyer auto-reply path.
    if (!kind) return { bodyType: 'system', riskFlags: appendRiskFlag(baseRiskFlags, 'xianyu_system_message') };
    try {
      const orders = await this.store.listAutoReplyOrders(adminId, {
        accountId,
        buyerId: message.senderRef,
        conversationId,
        limit: 50,
      });
      const matched = orders.items.some((order) => {
        if (message.itemRef && order.itemId && message.itemRef !== order.itemId) return false;
        return matchesXianyuOrderStatus(kind, order);
      });
      if (matched) return { bodyType: 'system', riskFlags: appendRiskFlag(baseRiskFlags, 'xianyu_system_message') };
    } catch {
      // Fail closed: a reminder without a verified order must never reach auto reply.
    }
    return { bodyType: 'system', riskFlags: appendRiskFlag(baseRiskFlags, 'xianyu_system_candidate_unverified') };
  }

  /** Wake a bounded one-shot inbox poll without replacing the durable worker. */
  wakeInboundInboxWorker(): void {
    this.inboundInboxWakeRequested = true;
    if (this.inboundInboxWakeInFlight) return;
    this.inboundInboxWakeInFlight = (async () => {
      while (this.inboundInboxWakeRequested) {
        this.inboundInboxWakeRequested = false;
        try {
          await this.inboundInboxWorker.pollOnce();
        } catch (error) {
          console.warn(JSON.stringify({ component: 'inbound-inbox-fallback', event: 'poll_failed', errorCode: recoveryErrorCode(error) }));
        }
      }
    })().finally(() => {
      this.inboundInboxWakeInFlight = undefined;
      if (this.inboundInboxWakeRequested) this.wakeInboundInboxWorker();
    });
  }
}

function trustedOrderRefreshKind(event: XianyuImMessageEvent): 'unpaid_order' | 'paid_waiting_shipment' | undefined {
  if (event.direction !== 'inbound' || event.platformSystemMessage !== true) return undefined;
  const kind = parseXianyuSystemMessageKind(event.bodyText);
  return kind === 'unpaid_order' || kind === 'paid_waiting_shipment' ? kind : undefined;
}

function isReadReceiptEvent(event: XianyuImMessageEvent | XianyuImReadReceiptEvent): event is XianyuImReadReceiptEvent {
  return 'kind' in event && event.kind === 'read';
}

function hasConversationMetadataPatch(conversation: ConversationRecord, event: XianyuImMessageEvent): boolean {
  return (!conversation.buyerDisplayName && Boolean(event.senderName))
    || (!conversation.itemRef && Boolean(event.itemRef))
    || (!conversation.itemTitle && Boolean(event.itemTitle))
    || (!conversation.itemImageUrl && Boolean(event.itemImageUrl));
}

function toImCredential(credential: CredentialRecord): XianyuImCredential {
  return { cookieHeader: credential.cookieHeader ?? '', accessToken: credential.accessToken, deviceId: credential.deviceId };
}

function normalizeConversation(value: unknown, myId: string | readonly string[]): { externalConversationRef: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; unreadCount?: number; lastMessagePreview?: string; lastMessageAt?: string } | undefined {
  const wrapper = record(value);
  const conv = record(wrapper.singleChatUserConversation ?? wrapper);
  const single = record(conv.singleChatConversation ?? conv);
  const externalConversationRef = strip(single.cid ?? conv.cid ?? wrapper.cid);
  const first = strip(single.pairFirst ?? conv.pairFirst);
  const second = strip(single.pairSecond ?? conv.pairSecond);
  const extension = mergeRecords(
    record(single.extension),
    parseJsonObject(record(single.extension).extJson),
    record(conv.extension),
    parseJsonObject(record(conv.extension).extJson),
    record(wrapper.extension),
    parseJsonObject(record(wrapper.extension).extJson),
  );
  const last = record(record(conv.lastMessage).message ?? conv.lastMessage);
  const lastExtension = mergeRecords(record(last.extension), parseJsonObject(record(last.extension).extJson));
  const reminderUrl = string(lastExtension.reminderUrl ?? extension.reminderUrl);
  const buyerRef = matchesIdentity(first, myId)
      ? second
      : matchesIdentity(second, myId)
        ? first
      : strip(extension.extUserId ?? extension.peerUserId ?? (first || second)) || strip(parseQueryParam(reminderUrl, 'peerUserId'));
  if (!externalConversationRef || !buyerRef || buyerRef === '0') return undefined;
  const content = decodeCustom(record(last.content).custom);
  const custom = record(record(last.content).custom);
  const preview = content.text ?? string(lastExtension.reminderContent ?? lastExtension.detailNotice ?? custom.summary);
  const identitySources = [
    extension,
    lastExtension,
    record(single.peer),
    record(single.buyer),
    record(single.user),
    record(single.userInfo),
    record(conv.peer),
    record(conv.buyer),
    record(conv.user),
    record(conv.userInfo),
    record(extension.peer),
    record(extension.buyer),
    record(extension.user),
    record(extension.userInfo),
    record(extension.peerInfo),
    record(extension.targetUser),
    record(lastExtension.peer),
    record(lastExtension.buyer),
    record(lastExtension.user),
    record(lastExtension.userInfo),
  ];
  const itemRef = firstString(identitySources, ['itemId', 'itemID', 'itemRef']) ?? parseQueryParam(reminderUrl, 'itemId');
  const itemTitle = firstString(identitySources, ['itemTitle', 'title', 'itemName']);
  const buyerDisplayName = firstString(identitySources, ['peerNick', 'peerUserNick', 'buyerNick', 'buyerName', 'userNick', 'userNickname', 'fishNick', 'nickname', 'nick', 'displayName', 'userName', 'name'])
    ?? parseQueryParam(reminderUrl, 'peerUserNick')
    ?? parseQueryParam(reminderUrl, 'buyerNick');
  const buyerAvatarUrl = normalizeAssetUrl(firstString(identitySources, ['peerAvatar', 'peerUserAvatar', 'buyerAvatar', 'buyerHeadPic', 'avatarUrl', 'peerHeadPic', 'headPic', 'headPicUrl', 'logo', 'avatar', 'userAvatar', 'profilePic', 'headPortrait', 'iconUrl']));
  const itemImageUrl = normalizeAssetUrl(firstString(identitySources, ['itemMainPic', 'itemImage', 'itemImageUrl', 'mainPic', 'itemPic', 'itemCover']));
  const timestamp = normalizeTimestamp(last.createAt ?? conv.modifyTime);
  return { externalConversationRef, buyerRef, buyerDisplayName, buyerAvatarUrl, itemRef, itemTitle, itemImageUrl, unreadCount: numberValue(conv.redPoint), lastMessagePreview: preview, lastMessageAt: timestamp };
}

function normalizeHistoryMessage(value: unknown, myId: string | readonly string[]): { externalMessageRef: string; externalMessageRefAliases?: string[]; senderRef?: string; itemRef?: string; direction: 'inbound' | 'outbound'; bodyType: 'text' | 'image' | 'system'; bodyText?: string; bodyRef?: string; platformSystemMessage?: boolean; riskFlags?: string[]; createdAt: string } | undefined {
  const model = record(value);
  const message = record(model.message ?? model);
  const extension = mergeRecords(record(model.extension), record(message.extension), parseJsonObject(record(model.extension).extJson), parseJsonObject(record(message.extension).extJson));
  // History and live push may expose the same platform message under both a
  // stable `.PNM` id and an internal transport id. Keep the stable id when it
  // is present so the store's external-message uniqueness remains effective.
  const externalMessageRefCandidates = uniqueStrings([
    message.messageId,
    extension.messageId,
    parseQueryParam(string(extension.reminderUrl), 'messageId'),
  ]);
  const externalMessageRef = selectCanonicalMessageRef(...externalMessageRefCandidates);
  if (!externalMessageRef) return undefined;
  const senderRef = strip(extension.senderUserId ?? message.senderUserId);
  const direction = senderRef && matchesIdentity(senderRef, myId) ? 'outbound' : 'inbound';
  const content = decodeCustom(record(message.content).custom);
  const custom = record(record(message.content).custom);
  const fallback = string(custom.summary ?? extension.reminderContent ?? extension.detailNotice);
  const bodyText = content.text ?? fallback;
  const bodyRef = content.images[0];
  const itemRef = firstString([extension, message], ['itemId', 'itemID', 'itemRef']);
  const platformSystemMessage = hasXianyuStructuredSystemMarker(model, message, extension, custom);
  const bodyType = bodyRef ? 'image' : bodyText ? 'text' : 'system';
  const receivedAt = new Date().toISOString();
  const createdAt = normalizeTimestamp(message.createAt);
  return { externalMessageRef, externalMessageRefAliases: externalMessageRefCandidates.filter((value) => value !== externalMessageRef), senderRef: senderRef || undefined, itemRef, direction, bodyType, bodyText, bodyRef, ...(platformSystemMessage ? { platformSystemMessage: true } : {}), riskFlags: createdAt ? undefined : ['source_timestamp_invalid'], createdAt: createdAt ?? receivedAt };
}

export function matchRecentOutboundMessage(models: unknown, selfUserIds: readonly string[], expected: { bodyType: 'text' | 'image'; content: string; startedAt: string }): string | undefined {
  if (!Array.isArray(models)) return undefined;
  const start = Date.parse(expected.startedAt);
  if (!Number.isFinite(start)) return undefined;
  const matches = models.map((model) => normalizeHistoryMessage(model, selfUserIds)).filter((message) =>
    message?.direction === 'outbound'
    && message.senderRef
    && message.bodyType === expected.bodyType
    && (expected.bodyType === 'text' ? message.bodyText : message.bodyRef) === expected.content
    && !message.riskFlags?.includes('source_timestamp_invalid')
    && Date.parse(message.createdAt) >= start
    && Date.parse(message.createdAt) <= Date.now() + 5_000,
  );
  return matches.length === 1 ? matches[0]?.externalMessageRef : undefined;
}

export function confirmPartialDeliveryImage(models: unknown, selfUserIds: readonly string[], expected: { externalMessageRef: string; imageUrl: string; startedAt: string }): boolean {
  if (!Array.isArray(models)) return false;
  const start = Date.parse(expected.startedAt);
  if (!Number.isFinite(start)) return false;
  const outbound = models.map((model) => normalizeHistoryMessage(model, selfUserIds))
    .filter((message) => message?.direction === 'outbound' && !message.riskFlags?.includes('source_timestamp_invalid'));
  const image = outbound.filter((message) => message?.externalMessageRef === expected.externalMessageRef
    && message.bodyType === 'image' && message.bodyRef === expected.imageUrl
    && Date.parse(message.createdAt) >= start - 2_000);
  if (image.length !== 1) return false;
  const imageAt = Date.parse(image[0]!.createdAt);
  return !outbound.some((message) => message?.externalMessageRef !== expected.externalMessageRef
    && Date.parse(message!.createdAt) >= imageAt && (message?.bodyType === 'text' || message?.bodyType === 'image'));
}

function decodeCustom(value: unknown): { text?: string; images: string[] } {
  const custom = record(value);
  const encoded = string(custom.data);
  let parsed: Record<string, any> = {};
  if (encoded) {
    try { parsed = record(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))); } catch { try { parsed = record(JSON.parse(encoded)); } catch { parsed = {}; } }
  }
  const text = string(record(parsed.text).text);
  const pics: unknown[] = Array.isArray(record(parsed.image).pics) ? record(parsed.image).pics : [];
  const images = pics.map((pic: unknown) => string(record(pic).url)).filter((item: string | undefined): item is string => Boolean(item));
  return { text, images };
}

function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function string(value: unknown): string | undefined { return typeof value === 'string' && value.trim() && value !== '<nil>' ? value.trim() : undefined; }
function selectCanonicalMessageRef(...values: unknown[]): string | undefined {
  const candidates = values.map(string).filter((value): value is string => Boolean(value));
  return candidates.find((value) => value.toUpperCase().endsWith('.PNM')) ?? candidates[0];
}
function uniqueStrings(values: unknown[]): string[] { return [...new Set(values.map((value) => string(typeof value === 'number' || typeof value === 'bigint' ? String(value) : value)).filter((value): value is string => Boolean(value)))]; }
function parseJsonObject(value: unknown): Record<string, any> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try { return record(JSON.parse(value)); } catch { return {}; }
}
function mergeRecords(...values: Record<string, any>[]): Record<string, any> { return Object.assign({}, ...values); }
function firstString(records: Record<string, any>[], keys: string[]): string | undefined {
  for (const source of records) {
    for (const key of keys) {
      const value = string(source[key]);
      if (value) return value;
    }
  }
  return undefined;
}
function normalizeAssetUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('//')) return `https:${value}`;
  return value;
}

function reconcileMessageDirection(event: XianyuImMessageEvent, selfUserIds: readonly string[], buyerRef?: string): XianyuImMessageEvent {
  if (matchesIdentity(event.senderRef, selfUserIds)) {
    return event.direction === 'outbound'
      ? event
      : { ...event, direction: 'outbound', riskFlags: appendRiskFlag(event.riskFlags, 'sender_identity_reconciled') };
  }
  if (buyerRef && matchesIdentity(event.senderRef, [buyerRef])) {
    return event.direction === 'inbound'
      ? event
      : { ...event, direction: 'inbound', riskFlags: appendRiskFlag(event.riskFlags, 'buyer_identity_reconciled') };
  }
  return event;
}

function appendRiskFlag(riskFlags: string[] | undefined, flag: string): string[] {
  return [...new Set([...(riskFlags ?? []), flag])];
}

function matchesIdentity(value: unknown, identities: string | readonly string[]): boolean {
  const normalized = normalizeIdentity(value);
  if (!normalized) return false;
  const candidates = Array.isArray(identities) ? identities : [identities];
  return candidates.some((candidate) => normalizeIdentity(candidate) === normalized);
}

function normalizeIdentity(value: unknown): string | undefined {
  const normalized = strip(value);
  return normalized || undefined;
}

function strip(value: unknown): string { return String(value ?? '').replace(/@goofish$/, '').trim(); }
function numberValue(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : undefined; }
function numeric(value: unknown): number | undefined { const number = Number(value); return Number.isSafeInteger(number) ? number : undefined; }
function normalizeTimestamp(value: unknown): string | undefined { const number = Number(value); if (!Number.isFinite(number) || number <= 0) return undefined; const millis = number > 10_000_000_000 ? number : number * 1000; const parsed = new Date(millis); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString(); }
function parseQueryParam(value: string | undefined, key: string): string | undefined { if (!value) return undefined; try { return new URL(value.replace(/^fleamarket:\/\//, 'https://placeholder/')).searchParams.get(key) ?? undefined; } catch { return undefined; } }

function recoveryErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(code)) return code;
  const message = error instanceof Error ? error.message : String(error);
  const messageCode = message.split(':', 1)[0]?.trim();
  if (messageCode && /^[A-Z][A-Z0-9_:-]{1,64}$/.test(messageCode)) return messageCode;
  if (error instanceof Error && error.name) return error.name.toUpperCase().replace(/[^A-Z0-9_:-]/g, '_');
  return 'XIANYU_HISTORY_RECOVERY_FAILED';
}

function isRecoverableTextSendError(error: unknown): boolean {
  const code = recoveryErrorCode(error);
  const message = error instanceof Error ? error.message.toUpperCase() : String(error).toUpperCase();
  return isValidationTextSendError(error) || /XIANYU_IM_(?:CONNECTION_CLOSED|NOT_CONNECTED|WS_OPEN_TIMEOUT)|ECONNRESET|ETIMEDOUT|TIMEOUT|FAILED_TO_FETCH/u.test(code) || /FAILED TO FETCH|FETCH FAILED/u.test(message);
}

function isAmbiguousImSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /xianyu IM connection closed|XIANYU_IM_TIMEOUT:/iu.test(message);
}

function isValidationTextSendError(error: unknown): boolean {
  const code = recoveryErrorCode(error);
  return /FAIL_SYS_USER_VALIDATE|ACCOUNT_VALIDATION_REQUIRED|X5SEC|CAPTCHA|SLIDER|VALIDAT(?:E|ION)/u.test(code);
}

function mergeCookieSnapshots(base: XianyuCookieSnapshot | undefined, updates: XianyuCookieSnapshot): XianyuCookieSnapshot {
  const byIdentity = new Map<string, XianyuCookieSnapshot[number]>();
  for (const cookie of base ?? []) byIdentity.set(cookieIdentity(cookie), cookie);
  for (const cookie of updates) {
    const identity = cookieIdentity(cookie);
    // Flat response headers update values without describing browser flags.
    // Keep known scope/security attributes unless an update supplies them.
    const previous = byIdentity.get(identity);
    const merged = { ...previous, ...cookie };
    // A rotated value with no supplied expiry has an unknown lifetime; an old
    // token's expiry must not make Chrome immediately discard its replacement.
    if (previous?.value !== cookie.value && cookie.expires === undefined) delete merged.expires;
    byIdentity.set(identity, merged);
  }
  return [...byIdentity.values()];
}

function cookieIdentity(cookie: XianyuCookieSnapshot[number]): string {
  return `${cookie.name}\u0000${cookie.domain ?? ''}\u0000${cookie.path ?? '/'}\u0000${cookie.partitionKey ?? ''}`;
}

function isCaptchaChallengeCookie(name: string): boolean {
  return new Set(['x5secdata', 'x5sectag', 'x5step']).has(name.toLowerCase());
}

function cookieSnapshotFromHeader(cookieHeader: string | undefined): XianyuCookieSnapshot {
  return (cookieHeader ?? '').split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator <= 0) return [];
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return name && value ? [{ name, value, domain: '.goofish.com', path: '/' }] : [];
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return await Promise.race([promise.catch(() => undefined), new Promise<undefined>((resolve) => setTimeout(resolve, timeoutMs))]);
}
