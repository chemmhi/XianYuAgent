import type { AccountRecord, ConversationRecord, CredentialRecord, InboundInboxRecord, Store } from './domain.js';
import { ServiceError } from './services.js';
import type { MessageService } from './messages.js';
import type { AutoReplyProcessResult, AutoReplyService } from './auto-reply.js';
import { XianyuImClient, XianyuImMessageEvent, XianyuImReadReceiptEvent, XianyuImCredential } from './xianyu-im.js';
import { XianyuMtopClient } from './xianyu-mtop.js';

interface ExternalPage {
  hasMore: boolean;
  nextCursor?: number;
}

export class XianyuImService {
  private readonly clients = new Map<string, XianyuImClient>();
  private readonly clientInFlight = new Map<string, Promise<XianyuImClient>>();
  private readonly identityCache = new Map<string, { buyerDisplayName?: string; buyerAvatarUrl?: string }>();

  constructor(private readonly store: Store, private readonly mtop: XianyuMtopClient, private readonly messages: MessageService, private readonly autoReply?: AutoReplyService) {}

  async listConversations(adminId: string, accountId: string, startCursor?: number, limit = 50): Promise<ExternalPage> {
    const client = await this.ensureClient(adminId, accountId);
    let cursor = startCursor;
    let hasMore = false;
    let nextCursor: number | undefined;
    const maxPages = startCursor === undefined ? 20 : 1;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await client.listConversations(cursor, limit);
      const items = Array.isArray(page.userConvs) ? page.userConvs : [];
      const parsedItems = items.map((item) => normalizeConversation(item, client.userId)).filter((item): item is NonNullable<ReturnType<typeof normalizeConversation>> => Boolean(item));
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
    const page = await client.listMessages(externalRef, startCursor, limit);
    const models = Array.isArray(page.userMessageModels) ? page.userMessageModels : [];
    for (const item of [...models].reverse()) {
      const parsed = normalizeHistoryMessage(item, client.userId);
      if (!parsed) continue;
      await this.messages.importExternalMessage({
        adminId,
        conversationId,
        direction: parsed.direction,
        senderRole: parsed.direction === 'outbound' ? 'agent' : parsed.bodyType === 'system' ? 'system' : 'buyer',
        bodyType: parsed.bodyType,
        bodyText: parsed.bodyText,
        bodyRef: parsed.bodyRef,
        externalMessageRef: parsed.externalMessageRef,
        externalMessageRefAliases: parsed.externalMessageRefAliases,
        source: parsed.direction === 'outbound' ? 'human' : 'system',
        riskFlags: parsed.riskFlags,
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
        await client.markRead(refs);
      } catch {
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
    const client = await this.ensureClient(adminId, accountId);
    return client.sendText(externalRef, conversation.buyerRef, normalizedText, requestId);
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
    const upload = await this.mtop.uploadChatImage(adminId, accountId, file.filename, file.contentType, file.data);
    if (!upload.success || !upload.url) throw new ServiceError(upload.accountInvalid ? 401 : 502, upload.errorCode ?? 'IMAGE_UPLOAD_FAILED', upload.message ?? 'unable to upload image');
    const client = await this.ensureClient(adminId, accountId);
    const sent = await client.sendImage(externalRef, conversation.buyerRef, upload.url, upload.width, upload.height);
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
    const inFlight = [...this.clientInFlight.values()];
    this.clientInFlight.clear();
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
    await this.ensureClient(adminId, accountId);
  }

  private async getConversation(adminId: string, accountId: string, conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.store.getConversation(adminId, conversationId);
    if (!conversation || conversation.accountId !== accountId) throw new ServiceError(404, 'NOT_FOUND', 'conversation not found');
    return conversation;
  }

  private async ensureClient(adminId: string, accountId: string): Promise<XianyuImClient> {
    const key = `${adminId}:${accountId}`;
    const existing = this.clients.get(key);
    if (existing) {
      try { await existing.connect(); return existing; } catch {
        if (this.clients.get(key) === existing) this.clients.delete(key);
      }
    }
    const inFlight = this.clientInFlight.get(key);
    if (inFlight) return inFlight;

    const connectPromise = (async () => {
      const account = await this.store.getAccount(adminId, accountId);
      if (!account) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
      let credential = await this.store.getCredential(adminId, accountId);
      if (!credential?.cookieHeader) throw new ServiceError(409, 'CREDENTIAL_MISSING', 'account credential is missing');
      if (!credential.accessToken) credential = await this.refreshCredential(adminId, account, credential);
      const client = new XianyuImClient({
        accountId,
        credential: toImCredential(credential),
        onEvent: async (event) => { await this.handleExternalEvent(adminId, event, { deferAutoReply: true }); },
        onQuarantine: async (event) => { await this.store.recordInboundQuarantine(event); },
        saveCredential: async (next) => { await this.saveCredential(adminId, account, next); },
      });
      try { await client.connect(); } catch (error) {
        if (this.clients.get(key) === client) this.clients.delete(key);
        throw error;
      }
      this.clients.set(key, client);
      return client;
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
    const token = await this.mtop.fetchImToken(adminId, account.id, deviceId);
    if (!token.success || !token.accessToken) throw new ServiceError(token.accountInvalid ? 401 : 502, token.errorCode ?? 'IM_TOKEN_FAILED', token.message ?? 'unable to obtain xianyu im token');
    return this.store.upsertCredential({ adminId, accountId: account.id, platform: account.platform, cookieHeader: token.cookieHeader, accessToken: token.accessToken, deviceId, metadata: credential.metadata, expiresAt: credential.expiresAt });
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

  async handleExternalEvent(adminId: string, event: XianyuImMessageEvent | XianyuImReadReceiptEvent, options: { deferAutoReply?: boolean } = {}): Promise<{ created: boolean; autoReply?: AutoReplyProcessResult }> {
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
    let effectiveEvent = event;
    if (event.direction === 'inbound' && !event.senderName && !conversation?.buyerDisplayName) {
      // Gateway pushes can omit the nickname even though the conversation
      // itself is addressable by a stable external ref. Resolve the profile
      // before the allowlist gate so a missing display name does not turn a
      // valid buyer into an unconditional TEST_BUYER_NOT_ALLOWLISTED skip.
      const enriched = await this.enrichConversationIdentity(adminId, event.accountId, {
        externalConversationRef: event.externalConversationRef,
        buyerRef: event.senderRef,
      });
      if (enriched.buyerDisplayName) effectiveEvent = { ...event, senderName: enriched.buyerDisplayName };
    }
    if (!conversation && effectiveEvent.direction === 'inbound') {
      conversation = await this.store.upsertExternalConversation({
        adminId,
        accountId: effectiveEvent.accountId,
        externalConversationRef: effectiveEvent.externalConversationRef,
        buyerRef: effectiveEvent.senderRef,
        buyerDisplayName: effectiveEvent.senderName,
        unreadCount: 0,
        lastMessagePreview: effectiveEvent.bodyText,
        lastMessageAt: effectiveEvent.occurredAt,
      });
    } else if (conversation && effectiveEvent.direction === 'inbound' && !conversation.buyerDisplayName && effectiveEvent.senderName) {
      // Persist a recovered nickname so later events can use the local
      // conversation identity even if profile lookup is temporarily down.
      conversation = await this.store.upsertExternalConversation({
        adminId,
        accountId: effectiveEvent.accountId,
        externalConversationRef: effectiveEvent.externalConversationRef,
        buyerRef: effectiveEvent.senderRef,
        buyerDisplayName: effectiveEvent.senderName,
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
    if (effectiveEvent.direction !== 'inbound' || !['text', 'image'].includes(effectiveEvent.bodyType) || !this.autoReply) return { created: imported.created };
    if (options.deferAutoReply) {
      await this.store.enqueueInboundInbox({ adminId, accountId: effectiveEvent.accountId, conversationId: conversation.id, inboundMessageId: imported.message.messageId, externalConversationRef: effectiveEvent.externalConversationRef, externalMessageRef: effectiveEvent.externalMessageRef, sourceEventId: effectiveEvent.sourceEventId ?? effectiveEvent.externalMessageRef, sourceSequence: effectiveEvent.sourceSequence });
      return { created: imported.created };
    }
    const autoReply = await this.autoReply.processInbound({ adminId, conversationId: conversation.id, inboundMessageId: imported.message.messageId, senderName: effectiveEvent.senderName, requestId: `xianyu:auto-reply:${effectiveEvent.externalMessageRef}`, traceId: `xianyu:auto-reply:${effectiveEvent.externalMessageRef}`, sourceEventId: effectiveEvent.sourceEventId ?? effectiveEvent.externalMessageRef, sourceSequence: effectiveEvent.sourceSequence });
    return { created: imported.created, autoReply };
  }

  async processInboundInbox(record: InboundInboxRecord): Promise<AutoReplyProcessResult | undefined> {
    if (!this.autoReply) return undefined;
    const conversation = await this.store.getConversation(record.adminId, record.conversationId);
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    const inbound = await this.store.findMessageByExternalRef(record.adminId, record.conversationId, record.externalMessageRef);
    if (!inbound) throw new Error('INBOUND_MESSAGE_NOT_FOUND');
    return this.autoReply.processInbound({ adminId: record.adminId, conversationId: record.conversationId, inboundMessageId: inbound.id, senderName: conversation.buyerDisplayName, requestId: `xianyu:auto-reply:${record.externalMessageRef}`, traceId: `xianyu:auto-reply:${record.externalMessageRef}`, sourceEventId: record.sourceEventId ?? record.externalMessageRef, sourceSequence: record.sourceSequence });
  }
}

function isReadReceiptEvent(event: XianyuImMessageEvent | XianyuImReadReceiptEvent): event is XianyuImReadReceiptEvent {
  return 'kind' in event && event.kind === 'read';
}

function toImCredential(credential: CredentialRecord): XianyuImCredential {
  return { cookieHeader: credential.cookieHeader ?? '', accessToken: credential.accessToken, deviceId: credential.deviceId };
}

function normalizeConversation(value: unknown, myId: string): { externalConversationRef: string; buyerRef: string; buyerDisplayName?: string; buyerAvatarUrl?: string; itemRef?: string; itemTitle?: string; itemImageUrl?: string; unreadCount?: number; lastMessagePreview?: string; lastMessageAt?: string } | undefined {
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
  const buyerRef = first === myId
      ? second
      : second === myId
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

function normalizeHistoryMessage(value: unknown, myId: string): { externalMessageRef: string; externalMessageRefAliases?: string[]; direction: 'inbound' | 'outbound'; bodyType: 'text' | 'image' | 'system'; bodyText?: string; bodyRef?: string; riskFlags?: string[]; createdAt: string } | undefined {
  const model = record(value);
  const message = record(model.message ?? model);
  const extension = record(message.extension);
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
  const direction = senderRef && senderRef === myId ? 'outbound' : 'inbound';
  const content = decodeCustom(record(message.content).custom);
  const custom = record(record(message.content).custom);
  const fallback = string(custom.summary ?? extension.reminderContent ?? extension.detailNotice);
  const bodyText = content.text ?? fallback;
  const bodyRef = content.images[0];
  const bodyType = bodyRef ? 'image' : bodyText ? 'text' : 'system';
  const receivedAt = new Date().toISOString();
  const createdAt = normalizeTimestamp(message.createAt);
  return { externalMessageRef, externalMessageRefAliases: externalMessageRefCandidates.filter((value) => value !== externalMessageRef), direction, bodyType, bodyText, bodyRef, riskFlags: createdAt ? undefined : ['source_timestamp_invalid'], createdAt: createdAt ?? receivedAt };
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
function strip(value: unknown): string { return String(value ?? '').replace(/@goofish$/, '').trim(); }
function numberValue(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : undefined; }
function numeric(value: unknown): number | undefined { const number = Number(value); return Number.isSafeInteger(number) ? number : undefined; }
function normalizeTimestamp(value: unknown): string | undefined { const number = Number(value); if (!Number.isFinite(number) || number <= 0) return undefined; const millis = number > 10_000_000_000 ? number : number * 1000; const parsed = new Date(millis); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString(); }
function parseQueryParam(value: string | undefined, key: string): string | undefined { if (!value) return undefined; try { return new URL(value.replace(/^fleamarket:\/\//, 'https://placeholder/')).searchParams.get(key) ?? undefined; } catch { return undefined; } }

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return await Promise.race([promise.catch(() => undefined), new Promise<undefined>((resolve) => setTimeout(resolve, timeoutMs))]);
}
