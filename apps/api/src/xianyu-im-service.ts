import { randomUUID } from 'node:crypto';
import type { AccountRecord, ConversationRecord, CredentialRecord, InboundInboxRecord, Store } from './domain.js';
import { ServiceError } from './services.js';
import { classifyXianyuFailure } from './xianyu-account-health.js';
import type { MessageService } from './messages.js';
import type { AutoReplyProcessResult, AutoReplyService } from './auto-reply.js';
import { XianyuImClient, XianyuImMessageEvent, XianyuImReadReceiptEvent, XianyuImCredential } from './xianyu-im.js';
import { hasXianyuStructuredSystemMarker, matchesXianyuOrderStatus, parseXianyuSystemMessageKind } from './xianyu-system-message.js';
import { XianyuMtopClient } from './xianyu-mtop.js';
import type { ProductAutomationImEventResult, ProductAutomationTrigger } from './product-automation-trigger.js';
import { InboundInboxWorker } from './inbound-inbox-worker.js';
import { cookieHeaderFromSnapshot, cookieSnapshotFromMetadata, dropStaleCaptchaChallengeCookies, metadataWithCookieSnapshot, type XianyuCookieSnapshot } from './xianyu-cookie-jar.js';
import type { XianyuVerificationBrowser, XianyuVerificationBrowserResult } from './xianyu-verification-browser.js';

interface ExternalPage {
  hasMore: boolean;
  nextCursor?: number;
}

export class XianyuImService {
  private readonly clients = new Map<string, XianyuImClient>();
  private readonly clientInFlight = new Map<string, Promise<XianyuImClient>>();
  private readonly verificationInFlight = new Map<string, Promise<XianyuVerificationBrowserResult>>();
  private readonly verificationRetryAfter = new Map<string, number>();
  private readonly recoveryInFlight = new Map<string, Promise<void>>();
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
    private readonly refreshOrdersForTrustedUnpaidEvent?: (input: { adminId: string; accountId: string; event: XianyuImMessageEvent }) => Promise<void>,
  ) {
    this.inboundInboxWorker = new InboundInboxWorker(store, this, {
      workerId: `listener-fallback:${process.pid}:${randomUUID()}`,
      batchSize: 10,
      leaseMs: 120_000,
      maxAttempts: 5,
    });
  }

  async listConversations(adminId: string, accountId: string, startCursor?: number, limit = 50): Promise<ExternalPage> {
    const client = await this.ensureClient(adminId, accountId);
    let cursor = startCursor;
    let hasMore = false;
    let nextCursor: number | undefined;
    const maxPages = startCursor === undefined ? 20 : 1;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await this.withAccountFailure(adminId, accountId, () => client.listConversations(cursor, limit));
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
    const conversation = await this.getConversation(adminId, accountId, conversationId);
    const externalRef = conversation.externalConversationRef;
    if (!externalRef) throw new ServiceError(409, 'EXTERNAL_CONVERSATION_MISSING', 'conversation is not linked to xianyu');
    const client = await this.ensureClient(adminId, accountId);
    const page = await this.withAccountFailure(adminId, accountId, () => client.listMessages(externalRef, startCursor, limit));
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
        await this.withAccountFailure(adminId, accountId, () => client.markRead(refs));
      } catch (error) {
        await this.markAccountFailure(adminId, accountId, error);
        // Local unread state is authoritative for the UI. A transient Xianyu
        // receipt failure must not leave the conversation badge stuck.
      }
    }
    return this.messages.markConversationRead(adminId, conversationId, requestId, traceId);
  }

  async sendExternalText(adminId: string, accountId: string, conversationId: string, text: string, requestId: string, traceId: string): Promise<{ externalMessageRef?: string }> {
    const normalizedText = text.trim();
    if (!normalizedText) throw new ServiceError(422, 'VALIDATION_FAILED', 'text is required');
    const conversation = await this.getConversation(adminId, accountId, conversationId);
    const externalRef = conversation.externalConversationRef;
    if (!externalRef) throw new ServiceError(409, 'EXTERNAL_CONVERSATION_MISSING', 'conversation is not linked to xianyu');
    let client = await this.ensureClient(adminId, accountId);
    try {
      return await this.withAccountFailure(adminId, accountId, () => client.sendText(externalRef, conversation.buyerRef, normalizedText, requestId));
    } catch (error) {
      if (!isRecoverableTextSendError(error)) throw error;
      await this.resetClient(adminId, accountId);
      if (isValidationTextSendError(error)) {
        const account = await this.store.getAccount(adminId, accountId);
        const credential = await this.store.getCredential(adminId, accountId);
        if (!account) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
        if (!credential?.cookieHeader) throw new ServiceError(409, 'CREDENTIAL_MISSING', 'account credential is missing');
        // A cached IM access token can survive the browser slider challenge.
        // Force a fresh MTOP token before constructing the replacement client.
        await this.refreshCredential(adminId, account, credential);
      }
      client = await this.ensureClient(adminId, accountId, { forceCredentialRefresh: isValidationTextSendError(error) });
      return this.withAccountFailure(adminId, accountId, () => client.sendText(externalRef, conversation.buyerRef, normalizedText, requestId));
    }
  }

  async sendText(adminId: string, accountId: string, conversationId: string, text: string, requestId: string, traceId: string): Promise<unknown> {
    const normalizedText = text.trim();
    if (!normalizedText) throw new ServiceError(422, 'VALIDATION_FAILED', 'text is required');
    const conversation = await this.getConversation(adminId, accountId, conversationId);
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
    if (!file.data?.length) throw new ServiceError(422, 'VALIDATION_FAILED', 'image is required');
    if (!file.contentType.startsWith('image/')) throw new ServiceError(422, 'VALIDATION_FAILED', 'only image files are supported');
    if (file.data.length > 10 * 1024 * 1024) throw new ServiceError(413, 'PAYLOAD_TOO_LARGE', 'image must be 10MB or smaller');
    const conversation = await this.getConversation(adminId, accountId, conversationId);
    const externalRef = conversation.externalConversationRef;
    if (!externalRef) throw new ServiceError(409, 'EXTERNAL_CONVERSATION_MISSING', 'conversation is not linked to xianyu');
    // Image uploads use the MTOP/browser cookie session while text messages
    // use the already-connected IM socket. Wait for the account-scoped IM
    // session first so a background reconnect/token refresh cannot race the
    // upload and make it read a stale cookie snapshot.
    const client = await this.ensureClient(adminId, accountId);
    const upload = await this.mtop.uploadChatImage(adminId, accountId, file.filename, file.contentType, file.data);
    if (!upload.success || !upload.url) throw new ServiceError(upload.accountInvalid ? 401 : 502, upload.errorCode ?? 'IMAGE_UPLOAD_FAILED', upload.message ?? 'unable to upload image');
    const sent = await this.withAccountFailure(adminId, accountId, () => client.sendImage(externalRef, conversation.buyerRef, upload.url!, upload.width, upload.height));
    const created = await this.messages.createMessage({
      adminId,
      conversationId,
      direction: 'outbound',
      senderRole: 'agent',
      bodyType: 'image',
      bodyRef: upload.url,
      externalMessageRef: sent.externalMessageRef,
      source: 'human',
      requestId,
      traceId,
    });
    return created.message;
  }

  async close(): Promise<void> {
    await this.inboundInboxWakeInFlight;
    const inFlight = [...this.clientInFlight.values()];
    this.clientInFlight.clear();
    this.recoveryInFlight.clear();
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
    const client = await this.ensureClient(adminId, accountId);
    if (client) this.scheduleRecentMessageRecovery(adminId, accountId);
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
      const page = await this.withAccountFailure(adminId, accountId, () => client.listMessages(conversation.externalConversationRef!, undefined, messageLimit));
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

  async resetClient(adminId: string, accountId: string): Promise<void> {
    const key = `${adminId}:${accountId}`;
    const client = this.clients.get(key);
    if (!client) return;
    this.clients.delete(key);
    await client.disconnect();
  }

  private async getConversation(adminId: string, accountId: string, conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.store.getConversation(adminId, conversationId);
    if (!conversation || conversation.accountId !== accountId) throw new ServiceError(404, 'NOT_FOUND', 'conversation not found');
    return conversation;
  }

  private async ensureClient(adminId: string, accountId: string, options: { forceCredentialRefresh?: boolean } = {}): Promise<XianyuImClient> {
    const key = `${adminId}:${accountId}`;
    if (options.forceCredentialRefresh) {
      const existing = this.clients.get(key);
      if (existing) {
        this.clients.delete(key);
        await existing.disconnect().catch(() => undefined);
      }
    }
    const existing = this.clients.get(key);
    if (existing) {
      try { await existing.connect(); return existing; } catch (error) {
        await this.markAccountFailure(adminId, accountId, error);
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
        let credential = await this.store.getCredential(adminId, accountId);
        if (!credential?.cookieHeader) throw new ServiceError(409, 'CREDENTIAL_MISSING', 'account credential is missing');
        if (!credential.accessToken) credential = await this.refreshCredential(adminId, account, credential);
        const client = new XianyuImClient({
          accountId,
          credential: toImCredential(credential),
          selfUserIds: [account.sellerRef, account.platformUserId].filter((value): value is string => Boolean(value)),
          refreshCredential: async () => {
            const current = await this.store.getCredential(adminId, accountId);
            if (!current?.cookieHeader) throw new ServiceError(409, 'CREDENTIAL_MISSING', 'account credential is missing');
            return toImCredential(await this.refreshCredential(adminId, account, current));
          },
          onStatusChange: async (status) => {
            if (status === 'connected') {
              await this.store.updateAccount(adminId, accountId, { status: 'connected', lastConnectedAt: new Date().toISOString() });
              this.scheduleRecentMessageRecovery(adminId, accountId);
            }
          },
          onFailure: async (error) => { await this.markAccountFailure(adminId, accountId, error); },
          onEvent: async (event) => {
            await this.handleExternalEvent(adminId, event, { deferAutoReply: true });
            // The dedicated worker remains the durable primary path. Wake a
            // local one-shot poll as a fallback so API-only deployments do
            // not leave queued replies waiting for a separate process.
            this.wakeInboundInboxWorker();
          },
          onQuarantine: async (event) => { await this.store.recordInboundQuarantine(event); },
          saveCredential: async (next) => { await this.saveCredential(adminId, account, next); },
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
        await this.markAccountFailure(adminId, accountId, error);
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

  private async refreshCredential(adminId: string, account: AccountRecord, credential: CredentialRecord): Promise<CredentialRecord> {
    const deviceId = credential.deviceId ?? `xianyu-${account.id}`;
    let token = await this.mtop.fetchImToken(adminId, account.id, deviceId);
    if (!token.success || !token.accessToken) {
      if (token.errorCode === 'ACCOUNT_VALIDATION_REQUIRED' && this.verificationBrowser?.enabled && token.verificationUrl) {
        const latest = await this.store.getCredential(adminId, account.id) ?? credential;
        // Keep stable account cookies from the browser snapshot, but prefer
        // the fresh flat header returned by this validation response. The
        // x5secdata/x5sectag markers in that header bind the challenge URL to
        // this browser session and must be present while solving it.
        const initialSnapshot = mergeCookieSnapshots(
          cookieSnapshotFromMetadata(latest.metadata)?.filter((cookie) => !isCaptchaChallengeCookie(cookie.name)),
          cookieSnapshotFromHeader(token.cookieHeader || latest.cookieHeader || credential.cookieHeader),
        );
        try {
          // IM sends must not hold an HTTP request open for the QR/manual
          // verification window. Auto mode is fail-fast: either a fresh
          // challenge cookie is obtained quickly or the caller gets the
          // validation error and can retry with a new token.
          const verificationKey = `${adminId}:${account.id}`;
          const retryAfter = this.verificationRetryAfter.get(verificationKey) ?? 0;
          if (retryAfter > Date.now()) throw new Error('XIANYU_VERIFICATION_COOLDOWN');
          const existingVerification = this.verificationInFlight.get(verificationKey);
          let completed: XianyuVerificationBrowserResult;
          if (existingVerification) {
            completed = await existingVerification;
          } else {
            const verificationPromise = this.verificationBrowser.waitForCompletion({
              verificationUrl: token.verificationUrl,
              profileKey: account.id,
              initialCookieSnapshot: initialSnapshot,
              allowManualFallback: false,
              maxWaitMs: 20_000,
              pollIntervalMs: 250,
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
          const mergedSnapshot = dropStaleCaptchaChallengeCookies(mergeCookieSnapshots(initialSnapshot, completed.cookieSnapshot));
          const browserCookieHeader = cookieHeaderFromSnapshot(mergedSnapshot);
          const browserMetadata = metadataWithCookieSnapshot(latest.metadata, mergedSnapshot);
          await this.store.upsertCredential({
            adminId,
            accountId: account.id,
            platform: account.platform,
            cookieHeader: browserCookieHeader || token.cookieHeader || latest.cookieHeader || credential.cookieHeader,
            deviceId,
            metadata: browserMetadata,
            expiresAt: latest.expiresAt ?? credential.expiresAt,
          });
          token = await this.mtop.fetchImToken(adminId, account.id, deviceId);
          if (token.success && token.accessToken) {
            const persisted = await this.store.getCredential(adminId, account.id);
            return this.store.upsertCredential({ adminId, accountId: account.id, platform: account.platform, cookieHeader: token.cookieHeader, accessToken: token.accessToken, deviceId, metadata: persisted?.metadata ?? browserMetadata, expiresAt: persisted?.expiresAt ?? latest.expiresAt ?? credential.expiresAt });
          }
          this.verificationRetryAfter.set(verificationKey, Date.now() + 30_000);
        } catch (error) {
          console.warn(JSON.stringify({ component: 'xianyu-im', event: 'verification_browser_failed', adminId, accountId: account.id, errorCode: recoveryErrorCode(error) }));
        }
      }
      const statusCode = token.errorCode === 'ACCOUNT_VALIDATION_REQUIRED' ? 409 : token.accountInvalid ? 401 : 502;
      const message = token.errorCode === 'ACCOUNT_VALIDATION_REQUIRED'
        ? '请先在闲鱼页面完成滑块验证，再把验证后的最新完整 Cookie 回写到账号管理。'
        : token.message ?? 'unable to obtain xianyu im token';
      throw new ServiceError(statusCode, token.errorCode ?? 'IM_TOKEN_FAILED', message);
    }
    return this.store.upsertCredential({ adminId, accountId: account.id, platform: account.platform, cookieHeader: token.cookieHeader, accessToken: token.accessToken, deviceId, metadata: credential.metadata, expiresAt: credential.expiresAt });
  }

  private async markAccountFailure(adminId: string, accountId: string, error: unknown): Promise<void> {
    try {
      const account = await this.store.getAccount(adminId, accountId);
      if (!account || account.status === 'disabled') return;
      const code = error instanceof ServiceError ? error.code : (error as { code?: unknown } | null)?.code;
      const normalizedCode = typeof code === 'string' ? code : error instanceof Error ? error.message : String(error);
      const classification = classifyXianyuFailure({ errorCode: normalizedCode });
      // Slider validation is an external challenge, not proof that the QR
      // login cookie is invalid. Preserve the authenticated account state.
      if (classification.kind === 'verification_required') return;
      const status = classification.accountStatus!;
      if (account.status === 'expired' && status === 'degraded') return;
      if (account.status !== status) await this.store.updateAccount(adminId, accountId, { status });
    } catch {
      // Account-state persistence must never hide the original Xianyu failure.
    }
  }

  private scheduleRecentMessageRecovery(adminId: string, accountId: string): void {
    if (typeof this.store.listConversations !== 'function') return;
    const key = `${adminId}:${accountId}`;
    if (this.recoveryInFlight.has(key)) return;
    const task = new Promise<void>((resolve) => {
      setTimeout(() => {
        void this.recoverRecentMessages(adminId, accountId)
          .then((result) => {
            if (result.imported > 0 || result.queued > 0) {
              console.info(JSON.stringify({ component: 'xianyu-im-listener', event: 'history_recovery_completed', adminId, accountId, ...result }));
            }
          })
          .catch((error) => {
            console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'history_recovery_failed', adminId, accountId, errorCode: recoveryErrorCode(error) }));
          })
          .finally(resolve);
      }, 0);
    }).finally(() => {
      if (this.recoveryInFlight.get(key) === task) this.recoveryInFlight.delete(key);
    });
    this.recoveryInFlight.set(key, task);
  }

  private async withAccountFailure<T>(adminId: string, accountId: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await this.markAccountFailure(adminId, accountId, error);
      throw error;
    }
  }

  private async saveCredential(adminId: string, account: AccountRecord, credential: XianyuImCredential): Promise<void> {
    // IM token refresh callbacks only carry the refreshed transport fields.
    // Preserve the browser cookie snapshot and expiry metadata already stored
    // by QR/cookie login; dropping them forces image uploads back to a stale
    // flat Cookie header and causes SESSION_EXPIRED on the upload host.
    const current = await this.store.getCredential(adminId, account.id);
    await this.store.upsertCredential({
      adminId,
      accountId: account.id,
      platform: account.platform,
      cookieHeader: credential.cookieHeader,
      accessToken: credential.accessToken,
      deviceId: credential.deviceId,
      metadata: current?.metadata,
      expiresAt: current?.expiresAt,
    });
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
    if (isTrustedUnpaidOrderEvent(effectiveEvent) && this.refreshOrdersForTrustedUnpaidEvent) {
      try {
        await this.refreshOrdersForTrustedUnpaidEvent({ adminId, accountId: event.accountId, event: effectiveEvent });
      } catch (error) {
        console.warn(JSON.stringify({ component: 'xianyu-im', event: 'trusted_unpaid_order_refresh_failed', adminId, accountId: event.accountId, externalMessageRef: event.externalMessageRef, error: error instanceof Error ? error.message : String(error) }));
      }
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

function isTrustedUnpaidOrderEvent(event: XianyuImMessageEvent): boolean {
  return event.direction === 'inbound'
    && event.platformSystemMessage === true
    && parseXianyuSystemMessageKind(event.bodyText) === 'unpaid_order';
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

function isValidationTextSendError(error: unknown): boolean {
  const code = recoveryErrorCode(error);
  return /FAIL_SYS_USER_VALIDATE|ACCOUNT_VALIDATION_REQUIRED|X5SEC|CAPTCHA|SLIDER|VALIDAT(?:E|ION)/u.test(code);
}

function mergeCookieSnapshots(base: XianyuCookieSnapshot | undefined, updates: XianyuCookieSnapshot): XianyuCookieSnapshot {
  const byIdentity = new Map<string, XianyuCookieSnapshot[number]>();
  for (const cookie of base ?? []) byIdentity.set(cookieIdentity(cookie), cookie);
  for (const cookie of updates) byIdentity.set(cookieIdentity(cookie), cookie);
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
