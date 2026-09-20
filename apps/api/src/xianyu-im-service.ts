import type { AccountRecord, ConversationRecord, CredentialRecord, Store } from './domain.js';
import { ServiceError } from './services.js';
import type { MessageService } from './messages.js';
import { XianyuImClient, XianyuImMessageEvent, XianyuImCredential } from './xianyu-im.js';
import { XianyuMtopClient } from './xianyu-mtop.js';

interface ExternalPage {
  hasMore: boolean;
  nextCursor?: number;
}

export class XianyuImService {
  private readonly clients = new Map<string, XianyuImClient>();

  constructor(private readonly store: Store, private readonly mtop: XianyuMtopClient, private readonly messages: MessageService) {}

  async listConversations(adminId: string, accountId: string, startCursor?: number, limit = 50): Promise<ExternalPage> {
    const client = await this.ensureClient(adminId, accountId);
    const page = await client.listConversations(startCursor, limit);
    const items = Array.isArray(page.userConvs) ? page.userConvs : [];
    for (const item of items) {
      const parsed = normalizeConversation(item, client.userId);
      if (!parsed) continue;
      await this.store.upsertExternalConversation({ adminId, accountId, ...parsed });
    }
    return { hasMore: Boolean(page.hasMore), nextCursor: numeric(page.nextCursor) };
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
        source: parsed.direction === 'outbound' ? 'human' : 'system',
        createdAt: parsed.createdAt,
        traceId: `xianyu:history:${parsed.externalMessageRef}`,
      });
    }
    return { hasMore: Boolean(page.hasMore), nextCursor: numeric(page.nextCursor) };
  }

  async sendText(adminId: string, accountId: string, conversationId: string, text: string, requestId: string, traceId: string): Promise<unknown> {
    const normalizedText = text.trim();
    if (!normalizedText) throw new ServiceError(422, 'VALIDATION_FAILED', 'text is required');
    const conversation = await this.getConversation(adminId, accountId, conversationId);
    const externalRef = conversation.externalConversationRef;
    if (!externalRef) throw new ServiceError(409, 'EXTERNAL_CONVERSATION_MISSING', 'conversation is not linked to xianyu');
    const client = await this.ensureClient(adminId, accountId);
    const sent = await client.sendText(externalRef, conversation.buyerRef, normalizedText);
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

  async close(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((client) => client.disconnect()));
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
      try { await existing.connect(); return existing; } catch { this.clients.delete(key); }
    }
    const account = await this.store.getAccount(adminId, accountId);
    if (!account) throw new ServiceError(404, 'NOT_FOUND', 'account not found');
    let credential = await this.store.getCredential(adminId, accountId);
    if (!credential?.cookieHeader) throw new ServiceError(409, 'CREDENTIAL_MISSING', 'account credential is missing');
    if (!credential.accessToken) credential = await this.refreshCredential(adminId, account, credential);
    const client = new XianyuImClient({
      accountId,
      credential: toImCredential(credential),
      onEvent: (event) => this.importPush(adminId, event),
      saveCredential: async (next) => { await this.saveCredential(adminId, account, next); },
    });
    try { await client.connect(); } catch (error) {
      this.clients.delete(key);
      throw error;
    }
    this.clients.set(key, client);
    return client;
  }

  private async refreshCredential(adminId: string, account: AccountRecord, credential: CredentialRecord): Promise<CredentialRecord> {
    const deviceId = credential.deviceId ?? `xianyu-${account.id}`;
    const token = await this.mtop.fetchImToken(adminId, account.id, deviceId);
    if (!token.success || !token.accessToken) throw new ServiceError(token.accountInvalid ? 401 : 502, token.errorCode ?? 'IM_TOKEN_FAILED', token.message ?? 'unable to obtain xianyu im token');
    return this.store.upsertCredential({ adminId, accountId: account.id, platform: account.platform, cookieHeader: token.cookieHeader, accessToken: token.accessToken, deviceId, metadata: credential.metadata, expiresAt: credential.expiresAt });
  }

  private async saveCredential(adminId: string, account: AccountRecord, credential: XianyuImCredential): Promise<void> {
    await this.store.upsertCredential({ adminId, accountId: account.id, platform: account.platform, cookieHeader: credential.cookieHeader, accessToken: credential.accessToken, deviceId: credential.deviceId });
  }

  private async importPush(adminId: string, event: XianyuImMessageEvent): Promise<void> {
    const conversation = await this.store.findConversationByExternalRef(adminId, event.accountId, event.externalConversationRef);
    if (!conversation) return;
    await this.messages.importExternalMessage({
      adminId,
      conversationId: conversation.id,
      direction: event.direction,
      senderRole: event.direction === 'outbound' ? 'agent' : event.bodyType === 'system' ? 'system' : 'buyer',
      bodyType: event.bodyType,
      bodyText: event.bodyText,
      bodyRef: event.assetRef,
      externalMessageRef: event.externalMessageRef,
      source: event.direction === 'outbound' ? 'human' : 'system',
      createdAt: event.occurredAt,
      traceId: `xianyu:push:${event.externalMessageRef}`,
    });
  }
}

function toImCredential(credential: CredentialRecord): XianyuImCredential {
  return { cookieHeader: credential.cookieHeader ?? '', accessToken: credential.accessToken, deviceId: credential.deviceId };
}

function normalizeConversation(value: unknown, myId: string): { externalConversationRef: string; buyerRef: string; buyerDisplayName?: string; itemRef?: string; itemTitle?: string; unreadCount?: number; lastMessagePreview?: string; lastMessageAt?: string } | undefined {
  const wrapper = record(value);
  const conv = record(wrapper.singleChatUserConversation ?? wrapper);
  const single = record(conv.singleChatConversation ?? conv);
  const externalConversationRef = strip(single.cid ?? conv.cid ?? wrapper.cid);
  const first = strip(single.pairFirst ?? conv.pairFirst);
  const second = strip(single.pairSecond ?? conv.pairSecond);
  const extension = record(single.extension ?? conv.extension ?? wrapper.extension);
  const buyerRef = first === myId ? second : second === myId ? first : strip(extension.extUserId ?? extension.peerUserId ?? first);
  if (!externalConversationRef || !buyerRef || buyerRef === '0') return undefined;
  const last = record(record(conv.lastMessage).message ?? conv.lastMessage);
  const lastExtension = record(last.extension);
  const content = decodeCustom(record(last.content).custom);
  const preview = content.text ?? string(lastExtension.reminderContent ?? lastExtension.detailNotice ?? record(record(last.content).custom).summary);
  const itemRef = string(extension.itemId ?? lastExtension.itemId ?? parseQueryParam(string(lastExtension.reminderUrl), 'itemId'));
  const itemTitle = string(extension.itemTitle ?? lastExtension.itemTitle);
  const buyerDisplayName = string(extension.peerNick ?? extension.buyerNick ?? extension.userNick ?? extension.nick);
  const timestamp = normalizeTimestamp(last.createAt ?? conv.modifyTime);
  return { externalConversationRef, buyerRef, buyerDisplayName, itemRef, itemTitle, unreadCount: numberValue(conv.redPoint), lastMessagePreview: preview, lastMessageAt: timestamp };
}

function normalizeHistoryMessage(value: unknown, myId: string): { externalMessageRef: string; direction: 'inbound' | 'outbound'; bodyType: 'text' | 'image' | 'system'; bodyText?: string; bodyRef?: string; createdAt: string } | undefined {
  const model = record(value);
  const message = record(model.message ?? model);
  const extension = record(message.extension);
  const externalMessageRef = string(message.messageId ?? extension.messageId ?? parseQueryParam(string(extension.reminderUrl), 'messageId'));
  if (!externalMessageRef) return undefined;
  const senderRef = strip(extension.senderUserId ?? message.senderUserId);
  const direction = senderRef && senderRef === myId ? 'outbound' : 'inbound';
  const content = decodeCustom(record(message.content).custom);
  const fallback = string(record(message.content).custom.summary ?? extension.reminderContent ?? extension.detailNotice);
  const bodyText = content.text ?? fallback;
  const bodyRef = content.images[0];
  const bodyType = bodyRef ? 'image' : bodyText ? 'text' : 'system';
  return { externalMessageRef, direction, bodyType, bodyText, bodyRef, createdAt: normalizeTimestamp(message.createAt) ?? new Date().toISOString() };
}

function decodeCustom(custom: Record<string, any>): { text?: string; images: string[] } {
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
function strip(value: unknown): string { return String(value ?? '').replace(/@goofish$/, '').trim(); }
function numberValue(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : undefined; }
function numeric(value: unknown): number | undefined { const number = Number(value); return Number.isSafeInteger(number) ? number : undefined; }
function normalizeTimestamp(value: unknown): string | undefined { const number = Number(value); if (!Number.isFinite(number) || number <= 0) return undefined; const millis = number > 10_000_000_000 ? number : number * 1000; return new Date(millis).toISOString(); }
function parseQueryParam(value: string | undefined, key: string): string | undefined { if (!value) return undefined; try { return new URL(value.replace(/^fleamarket:\/\//, 'https://placeholder/')).searchParams.get(key) ?? undefined; } catch { return undefined; } }
