import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { loadConfig, type AppConfig } from './config.js';
import { mergeAutoReplyAgentRuntimeConfig, resolveAutoReplyAgentConfig } from './auto-reply-agent-config.js';
import type { AuthContext } from './services.js';
import { AccountService, AuthService, CouponService, CredentialService, OrderService, ProductService, ProductSyncService, ServiceError, idempotent } from './services.js';
import { createIds, failure, fingerprint, parseCookies, readBody, setCookie, success, writeJson, type RequestContext } from './http.js';
import { createStore } from './store.js';
import type { ProductListResult, ProductRecord, Store } from './domain.js';
import { createId, digestJson } from './security.js';
import { XianyuQrLoginAdapter, type XianyuQrPublicSession } from './xianyu-qr-login.js';
import { XianyuVerificationBrowser } from './xianyu-verification-browser.js';
import { XianyuMtopClient } from './xianyu-mtop.js';
import { metadataWithCookieSnapshot } from './xianyu-cookie-jar.js';
import { XianyuImService } from './xianyu-im-service.js';
import { MessageRealtimeHub, MessageService } from './messages.js';
import { RedisConversationEventBridge } from './messages-realtime.js';
import { decodeMessageHistoryCursor, encodeMessageHistoryCursor } from './message-history-cursor.js';
import { InProcessAgentRuntime, isTerminalRunStatus, WorkspaceService, type WorkspaceRuntime } from './workspace.js';
import { OpenAICompatibleModelClient, PiRuntimeAdapter, type ModelClient } from './pi-runtime.js';
import { ApiKeyCredentialService } from './credential-store.js';
import { DashboardService, type DashboardRange } from './dashboard.js';
import { AutoReplyService } from './auto-reply.js';
import { ReliableExternalAutoReplySender } from './auto-reply-outbox.js';
import { AutoReplyAgentSettingsService, resolveAutoReplyAgentDefaults } from './auto-reply-agent-settings.js';
import { ToolCallingAutoReplyAgent } from './auto-reply-agent.js';
import { OpenAISettingsService, createFallbackModelClient } from './openai-settings.js';
import { AutoReplyActivityService } from './auto-reply-activity.js';
import { AutoReplyRepairRuntime } from './auto-reply-repair-runtime.js';
import { createDefaultAutoReplyRepairPolicy, parseAutoReplyRepairPolicyBundle } from './auto-reply-repair-config.js';
import { createAutoReplyGodViewSink } from './auto-reply-god-view.js';
import { MemoryObjectStorage, S3CompatibleObjectStorage, type ObjectStorage } from './object-storage.js';
import { XianyuItemDetailService } from './xianyu-item-detail-service.js';
import { ProductAutomationService } from './product-automation.js';
import { AutomationWorkflowService, PersistentAutomationExecutionLedger } from './product-automation.js';
import { ProductAutomationTrigger, ProductAutomationWorker } from './product-automation-trigger.js';
import { XianyuProductAutomationExecutionAdapter } from './product-automation-xianyu.js';
import { conversationRefreshMode, messageRefreshMode } from './messages-loading-policy.js';
import { CouponAssetService } from './coupon-assets.js';
import { ProductPublishService } from './product-publish.js';
import { classifyXianyuFailure } from './xianyu-account-health.js';

export interface AppRuntime {
  config: AppConfig;
  store: Store;
  auth: AuthService;
  accounts: AccountService;
  coupons: CouponService;
  orders: OrderService;
  products: ProductService;
  productPublisher: ProductPublishService;
  productAutomation: ProductAutomationService;
  productAutomationTrigger: ProductAutomationTrigger;
  productAutomationWorker: ProductAutomationWorker;
  productSync: ProductSyncService;
  credentials: CredentialService;
  apiKeyCredentials: ApiKeyCredentialService;
  openaiSettings: OpenAISettingsService;
  dashboard: DashboardService;
  messages: MessageService;
  autoReply: AutoReplyService;
  autoReplyRepair: AutoReplyRepairRuntime;
  autoReplyAgentSettings: AutoReplyAgentSettingsService;
  autoReplyActivity: AutoReplyActivityService;
  redisRealtime?: RedisConversationEventBridge;
  workspace: WorkspaceService;
  workspaceRuntime: WorkspaceRuntime;
  qrLogin: XianyuQrLoginAdapter;
  xianyu: XianyuMtopClient;
  xianyuItemDetail: XianyuItemDetailService;
  objectStorage: ObjectStorage;
  xianyuIm: XianyuImService;
  server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export function createApp(config: AppConfig = loadConfig()): AppRuntime {
  const store = createStore(config);
  const objectStorage: ObjectStorage = config.allowInMemory
    ? new MemoryObjectStorage()
    : new S3CompatibleObjectStorage({ endpoint: config.objectStorageEndpoint, publicEndpoint: config.objectStoragePublicEndpoint, accessKey: config.objectStorageAccessKey, secretKey: config.objectStorageSecretKey, bucket: config.objectStorageBucket, region: config.objectStorageRegion });
  const couponAssets = new CouponAssetService(store, objectStorage);
  const autoReplyGodView = createAutoReplyGodViewSink();
  const autoReplyAgentConfig = config.autoReplyAgent ?? resolveAutoReplyAgentConfig();
  const modelClient = createConfiguredModelClient(config);
  const autoReplyModelClient = config.autoReplyModelEnabled === false ? undefined : modelClient;
  const auth = new AuthService(store, config);
  const accounts = new AccountService(store, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  const coupons = new CouponService(store, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, reason: input.reason, createdAt: new Date().toISOString() });
    return auditId;
  }, couponAssets);
  const products = new ProductService(store, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  const productAutomation = new ProductAutomationService(store, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  let xianyu: XianyuMtopClient;
  let xianyuIm!: XianyuImService;
  const verificationBrowser = config.xianyuVerificationBrowserMode === 'disabled'
    ? undefined
    : new XianyuVerificationBrowser({
      mode: config.xianyuVerificationBrowserMode,
      sliderMode: config.xianyuVerificationSliderMode,
      sliderMaxRetries: config.xianyuVerificationSliderMaxRetries,
      headless: config.xianyuVerificationBrowserHeadless,
      executablePath: config.xianyuVerificationBrowserExecutablePath,
      userDataDir: config.xianyuVerificationBrowserUserDataDir,
      maxWaitMs: config.xianyuVerificationBrowserMaxWaitMs,
    });
  const productAutomationExecution = new XianyuProductAutomationExecutionAdapter(store, () => xianyu, () => xianyuIm, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'system', actorId: input.adminId, action: input.action, targetRef: input.orderNo ?? input.executionKey, requestId: `automation:${input.executionKey ?? auditId}`, traceId: `automation:${input.executionKey ?? auditId}`, payloadDigest: digestJson(input.payload ?? {}), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  }, couponAssets);
  const productAutomationWorkflow = new AutomationWorkflowService(productAutomationExecution, new PersistentAutomationExecutionLedger(store));
  const productAutomationTrigger = new ProductAutomationTrigger(store, productAutomation, productAutomationWorkflow, productAutomationExecution, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'system', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  }, {
    executionMode: config.productAutomationExecutionMode,
    liveConfirmed: config.productAutomationLiveConfirmed,
    reviewExternalWritesConfirmed: config.productAutomationReviewExternalWritesConfirmed,
    buyerAllowlist: config.buyerAllowlist ?? [],
  });
  const productAutomationWorker = new ProductAutomationWorker(store, productAutomationTrigger);
  const credentials = new CredentialService(store, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  const apiKeyCredentials = new ApiKeyCredentialService(store, config.credentialEncryptionKey || 'development-only-credential-key-change-me', async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  const openaiSettings = new OpenAISettingsService(store, apiKeyCredentials, config.credentialEncryptionKey || 'development-only-credential-key-change-me', async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  }, fetch, config.modelWireApi);
  const dashboard = new DashboardService(store);
  const realtime = new MessageRealtimeHub();
  const redisRealtime = config.redisUrl && !config.allowInMemory
    ? new RedisConversationEventBridge(config.redisUrl, (event) => realtime.publish(event))
    : undefined;
  redisRealtime?.start();
  const messages = new MessageService(store, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  }, realtime, (event) => redisRealtime?.publish(event));
  const autoReplyAgentSettings = new AutoReplyAgentSettingsService(store, resolveAutoReplyAgentDefaults(config), async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), createdAt: new Date().toISOString() });
    return auditId;
  });
  const autoReplyActivity = new AutoReplyActivityService(store);
  const autoReplyRepairMode = 'enforce' as const;
  const autoReplyRepair = new AutoReplyRepairRuntime(store, autoReplyRepairMode, async (accountId, now) => {
    const persisted = await store.getActiveAutoReplyRepairPolicy(accountId, now.toISOString());
    if (persisted) return persisted;
    if (config.allowInMemory || config.autoReplyPolicyBootstrapDefault !== false) return createDefaultAutoReplyRepairPolicy(accountId, now);
    return parseAutoReplyRepairPolicyBundle(config.autoReplyPolicyJson, accountId);
  });
  const autoReply = new AutoReplyService(store, messages, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  }, {
    sendMode: config.autoReplySendMode ?? 'simulate',
    buyerAllowlist: config.buyerAllowlist,
    debounceMs: autoReplyAgentConfig.debounceMs,
    maxHistory: autoReplyAgentConfig.maxHistory,
    maxReplyLength: autoReplyAgentConfig.maxReplyLength,
    replySegmentDelayMs: autoReplyAgentConfig.replySegmentDelayMs,
    sendDelaySeconds: autoReplyAgentConfig.sendDelaySeconds,
    generator: autoReplyModelClient ? new ToolCallingAutoReplyAgent(store, autoReplyModelClient, autoReplyAgentConfig, { godView: autoReplyGodView }) : undefined,
    godView: autoReplyGodView,
    totalTimeoutMs: 60_000,
    configProvider: async (adminId, accountId) => {
      const settings = await autoReplyAgentSettings.get(adminId, accountId);
      const runtimeConfig = mergeAutoReplyAgentRuntimeConfig(autoReplyAgentConfig, settings);
      let runtimeModelClient: ModelClient | undefined = autoReplyModelClient;
      try {
        const configured = await openaiSettings.resolveForRuntime(adminId, accountId);
        if (configured.length > 0) {
          const clients = await Promise.all(configured.slice(0, 2).map((item) => openaiSettings.createRuntimeClient(item)));
          runtimeModelClient = createFallbackModelClient(clients[0]!, clients[1]);
        }
      } catch {
        runtimeModelClient = autoReplyModelClient;
      }
      const envLiveEnabled = config.autoReplySendMode === 'live';
      return {
        enabled: settings.enabled,
        sendMode: settings.sendMode === 'live' && envLiveEnabled ? 'live' : 'simulate',
        buyerAllowlist: config.buyerAllowlist,
        totalTimeoutMs: settings.totalTimeoutMs,
        debounceMs: settings.debounceMs,
        maxHistory: settings.maxHistory,
        maxReplyLength: settings.maxReplyLength,
        replySegmentDelayMs: settings.replySegmentDelayMs,
        sendDelaySeconds: settings.sendDelaySeconds,
        generator: runtimeModelClient ? new ToolCallingAutoReplyAgent(store, runtimeModelClient, runtimeConfig, { godView: autoReplyGodView }) : undefined,
      };
    },
    sender: new ReliableExternalAutoReplySender(store, messages, async (input) => {
      if (!xianyuIm) throw new Error('XIANYU_IM_NOT_READY');
      return xianyuIm.sendExternalText(input.adminId, input.accountId, input.conversation.id, input.text, input.requestId, input.traceId);
    }),
    repairRuntime: autoReplyRepair,
    requireRepairRuntime: true,
  });
  let productSync: ProductSyncService;
  const qrLogin = new XianyuQrLoginAdapter({
    verificationBrowser,
    allowManualVerificationFallback: config.xianyuVerificationSliderMode !== 'auto',
    onStatus: async (status) => {
      const localStatus = mapQrStatusToLoginStatus(status.status);
      if (!localStatus) return;
      try {
        const current = await accounts.getLoginSessionById({ adminId: status.adminId, sessionId: status.sessionId });
        if (current.status === 'succeeded' && localStatus !== 'succeeded') return;
        await accounts.updateLoginSession({ adminId: status.adminId, accountId: status.accountId, sessionId: status.sessionId, patch: { status: localStatus, failureCode: status.errorCode, completedAt: ['succeeded', 'expired', 'failed', 'cancelled'].includes(localStatus) ? new Date().toISOString() : undefined }, requestId: `qr:${status.sessionId}`, traceId: `qr:${status.sessionId}` });
      } catch (error) {
        console.warn(JSON.stringify({ component: 'xianyu-qr', event: 'status_persist_failed', sessionId: status.sessionId, adminId: status.adminId, accountId: status.accountId, errorCode: listenerErrorCode(error) }));
      }
    },
    onSuccess: async ({ sessionId, adminId, accountId, cookieHeader, cookieSnapshot, unb }) => {
      console.info(JSON.stringify({ component: 'xianyu-qr', event: 'on_success_start', sessionId, adminId, accountId, sellerRefSuffix: unb.slice(-6) }));
      if (accountId) {
        const existing = await accounts.getForLogin(adminId, accountId);
        if (existing.sellerRef && !existing.sellerRef.startsWith('pending_') && existing.sellerRef !== unb) {
          await accounts.updateLoginSession({ adminId, accountId, sessionId, patch: { status: 'failed', failureCode: 'QR_ACCOUNT_MISMATCH', completedAt: new Date().toISOString() }, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
          throw new Error('QR_ACCOUNT_MISMATCH');
        }
      }
      const resolvedAccount = await accounts.resolveForLogin({ adminId, accountId, platform: 'xianyu', sellerRef: unb, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
      const resolvedAccountId = resolvedAccount.id;
      if (resolvedAccountId !== accountId) await accounts.updateLoginSession({ adminId, accountId, sessionId, patch: { accountId: resolvedAccountId }, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
      await credentials.save({ adminId, accountId: resolvedAccountId, cookieHeader, clearAccessToken: true, metadata: metadataWithCookieSnapshot({ unb, loginMethod: 'qr_http' }, cookieSnapshot), requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
      console.info(JSON.stringify({ component: 'xianyu-qr', event: 'credential_saved', sessionId, adminId, accountId: resolvedAccountId }));
      await xianyuIm.resetClient(adminId, resolvedAccountId);
      console.info(JSON.stringify({ component: 'xianyu-qr', event: 'im_client_reset', sessionId, adminId, accountId: resolvedAccountId }));
      const verification = await xianyu.verifyLogin(adminId, resolvedAccountId);
      console.info(JSON.stringify({ component: 'xianyu-qr', event: 'verify_result', sessionId, adminId, accountId: resolvedAccountId, success: verification.success, accountInvalid: verification.accountInvalid, errorCode: verification.errorCode }));
      if (!verification.success) {
        const status = 'expired' as const;
        try { await credentials.verify({ adminId, accountId: resolvedAccountId, status, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` }); } catch { /* preserve original verification error */ }
        console.warn(JSON.stringify({ component: 'xianyu-qr', event: 'verify_failed_account_expired', sessionId, adminId, accountId: resolvedAccountId, errorCode: verification.errorCode }));
        await accounts.updateLoginSession({ adminId, accountId: resolvedAccountId, sessionId, patch: { status: 'failed', failureCode: verification.errorCode ?? 'LOGIN_STATE_VERIFY_FAILED', completedAt: new Date().toISOString() }, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
        throw new Error(verification.errorCode ?? 'LOGIN_STATE_VERIFY_FAILED');
      }
      await credentials.verify({ adminId, accountId: resolvedAccountId, status: 'active', requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
      console.info(JSON.stringify({ component: 'xianyu-qr', event: 'credential_verified_active', sessionId, adminId, accountId: resolvedAccountId }));
      await hydrateAccountProfile({ accounts, xianyu, adminId, accountId: resolvedAccountId, fallbackSellerRef: unb, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
      await accounts.updateLoginSession({ adminId, accountId: resolvedAccountId, sessionId, patch: { status: 'succeeded', completedAt: new Date().toISOString(), failureCode: undefined }, requestId: `qr:${sessionId}`, traceId: `qr:${sessionId}` });
      // QR login success is determined by the external login cookie and the
      // account verification above. IM listener bootstrap may require a
      // separate slider challenge, so retry it in the background without
      // rolling back an otherwise valid QR login session.
      void startXianyuListenerBestEffort(runtime, adminId, resolvedAccountId);
    },
  });
  xianyu = new XianyuMtopClient({
    loadCredential: async (adminId, accountId) => store.getCredential(adminId, accountId),
    saveCookie: async (adminId, accountId, cookieHeader, metadata) => {
      const account = await store.getAccount(adminId, accountId);
      if (!account) return;
      console.info(JSON.stringify({ component: 'xianyu-mtop', event: 'cookie_saved', adminId, accountId, hasMetadata: Boolean(metadata) }));
      await credentials.save({ adminId, accountId, cookieHeader, metadata, requestId: 'xianyu-mtop', traceId: 'xianyu-mtop' });
    },
    onFailure: async ({ adminId, accountId, api, errorCode, message, accountInvalid }) => {
      console.warn(JSON.stringify({ component: 'xianyu-mtop', event: 'external_failure', adminId, accountId, api, errorCode, accountInvalid, message: message?.slice(0, 160) }));
      await markXianyuAccountFailure(store, adminId, accountId, { errorCode, message, accountInvalid });
    },
  });
  const productPublisher = new ProductPublishService(xianyu, products, async (adminId, accountId) => {
    const configured = await openaiSettings.resolveForRuntime(adminId, accountId);
    if (configured.length === 0) return undefined;
    const clients = await Promise.all(configured.slice(0, 2).map((item) => openaiSettings.createRuntimeClient(item)));
    return createFallbackModelClient(clients[0]!, clients[1]);
  }, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  const xianyuItemDetail = new XianyuItemDetailService(store, xianyu, objectStorage, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  productSync = new ProductSyncService(store, xianyu, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });
  const orders = new OrderService(store, xianyu, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  }, async (input) => productAutomationWorker.processOrderRefresh(input));
  xianyuIm = new XianyuImService(store, xianyu, messages, autoReply, productAutomationTrigger, verificationBrowser);

  const wsServer = new WebSocketServer({ noServer: true });
  const workspaceRuntime: WorkspaceRuntime = config.agentRuntime === 'pi'
    ? createPiWorkspaceRuntime(config, store, modelClient)
    : new InProcessAgentRuntime(store);
  const workspace = new WorkspaceService(store, workspaceRuntime, async (input) => {
    const auditId = createId();
    await store.recordAudit({ id: auditId, actorType: 'admin', actorId: input.actorId, action: input.action, targetRef: input.targetRef, requestId: input.requestId, traceId: input.traceId, payloadDigest: digestJson(input.payload), accountId: input.accountId, createdAt: new Date().toISOString() });
    return auditId;
  });

  const server = createServer((request, response) => { void handleRequest(runtime, request, response); });
  const runtime: AppRuntime = {
    config, store, auth, accounts, coupons, orders, products, productPublisher, productAutomation, productAutomationTrigger, productAutomationWorker, productSync, credentials, apiKeyCredentials, openaiSettings, dashboard, messages, autoReply, autoReplyRepair, autoReplyAgentSettings, autoReplyActivity, redisRealtime, workspace, workspaceRuntime, qrLogin, xianyu, xianyuItemDetail, objectStorage, xianyuIm,
    server,
    async listen() {
      await new Promise<void>((resolve) => runtime.server.listen(config.port, config.host, resolve));
      await bootstrapRepairPoliciesBestEffort(runtime);
      if (config.xianyuQrMode === 'real') void startAllRecoverableListenersBestEffort(runtime);
    },
    async close() {
      for (const client of wsServer.clients) client.close(1001, 'server shutdown');
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      workspaceRuntime.stop();
      await closeHttpServer(runtime.server);
      await redisRealtime?.close();
      await xianyuIm.close();
      const close = (store as Store & { close?: () => Promise<void> }).close;
      if (close) await close.call(store);
    },
  };
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
    if (/^\/api\/v1\/conversations\/[^/]+\/events$/.test(pathname)) {
      void handleConversationUpgrade(runtime, wsServer, request, socket, head);
      return;
    }
    if (/^\/api\/v1\/workspace\/runs\/[^/]+\/events$/.test(pathname)) {
      void handleWorkspaceUpgrade(runtime, request, socket);
      return;
    }
    socket.destroy();
  });
  wsServer.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const context = (request as IncomingMessage & { __xianyuConversationContext?: { adminId: string; conversationId: string; cursor: number } }).__xianyuConversationContext;
    if (context) void attachConversationSocket(runtime, socket, request, context);
  });
  return runtime;
}

async function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
    if (!error || code === 'ERR_SERVER_NOT_RUNNING') resolve();
    else reject(error);
  }));
}

async function startXianyuListenerBestEffort(runtime: AppRuntime, adminId: string, accountId: string): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runtime.xianyuIm.startListener(adminId, accountId);
      return;
    } catch (error) {
      await markXianyuAccountFailure(runtime.store, adminId, accountId, { errorCode: listenerErrorCode(error), message: error instanceof Error ? error.message : String(error), accountInvalid: false });
      const retryInMs = attempt < maxAttempts ? 100 * 2 ** (attempt - 1) : 0;
      console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'start_failed', adminId, accountId, attempt, maxAttempts, retryInMs, errorCode: listenerErrorCode(error) }));
      if (retryInMs > 0) await delay(retryInMs);
    }
  }
}

async function markXianyuAccountFailure(store: Store, adminId: string, accountId: string, input: { errorCode?: string; message?: string; accountInvalid: boolean }): Promise<void> {
  try {
    const account = await store.getAccount(adminId, accountId);
    if (!account || account.status === 'disabled') return;
    const classification = classifyXianyuFailure(input);
    // A valid QR/Cookie login can still be blocked by a separate slider
    // challenge during IM or product bootstrap. Keep the authenticated
    // account state intact; the caller still exposes the verification error.
    if (classification.kind === 'verification_required') return;
    const status = classification.accountStatus!;
    if (classification.kind === 'reauth_required') {
      try { await store.markCredentialVerified({ adminId, accountId, status: 'expired' }); } catch { /* account status remains the primary signal */ }
    }
    if (account.status === 'expired' && status === 'degraded') return;
    if (account.status !== status) await store.updateAccount(adminId, accountId, { status });
  } catch {
    // Status reporting is best-effort and must not mask the original Xianyu error.
  }
}

async function startRecoverableListenersBestEffort(runtime: AppRuntime, adminId: string): Promise<void> {
  try {
    const accounts = await runtime.accounts.list(adminId, { page: 1, pageSize: 100 });
    for (const account of accounts.items) {
      if (account.status !== 'connected' && account.status !== 'degraded' && account.status !== 'disconnected') continue;
      if (account.status === 'disconnected') {
        const credential = await runtime.store.getCredential(adminId, account.id);
        if (credential?.status !== 'active') continue;
      }
      await startXianyuListenerBestEffort(runtime, adminId, account.id);
    }
  } catch (error) {
    console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'account_scan_failed', adminId, errorCode: listenerErrorCode(error) }));
  }
}

async function startAllRecoverableListenersBestEffort(runtime: AppRuntime): Promise<void> {
  try {
    const adminIds = await runtime.store.listAdminIds();
    for (const adminId of adminIds) await startRecoverableListenersBestEffort(runtime, adminId);
  } catch (error) {
    console.warn(JSON.stringify({ component: 'xianyu-im-listener', event: 'admin_scan_failed', errorCode: listenerErrorCode(error) }));
  }
}

async function bootstrapRepairPoliciesBestEffort(runtime: AppRuntime): Promise<void> {
  if (runtime.config.autoReplyPolicyBootstrapDefault === false) return;
  try {
    const now = new Date();
    for (const adminId of await runtime.store.listAdminIds()) {
      const accounts = await runtime.accounts.list(adminId, { page: 1, pageSize: 100 });
      for (const account of accounts.items) {
        const existing = await runtime.store.getActiveAutoReplyRepairPolicy(account.id, now.toISOString());
        if (existing) continue;
        try {
          await runtime.store.publishAutoReplyRepairPolicy({ accountId: account.id, bundle: createDefaultAutoReplyRepairPolicy(account.id, now) });
          console.info(JSON.stringify({ component: 'auto-reply-policy-bootstrap', event: 'default_policy_published', accountId: account.id, policyVersion: 'ar-vs08-shadow-v1' }));
        } catch (error) {
          console.warn(JSON.stringify({ component: 'auto-reply-policy-bootstrap', event: 'default_policy_publish_failed', accountId: account.id, errorCode: listenerErrorCode(error) }));
        }
      }
    }
  } catch (error) {
    console.warn(JSON.stringify({ component: 'auto-reply-policy-bootstrap', event: 'account_scan_failed', errorCode: listenerErrorCode(error) }));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listenerErrorCode(error: unknown): string {
  const candidate = error as { code?: unknown } | null;
  if (typeof candidate?.code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(candidate.code)) return candidate.code;
  if (typeof candidate?.code === 'number' && Number.isFinite(candidate.code)) return `REMOTE_${candidate.code}`;
  if (error instanceof Error && error.name) return error.name;
  return 'UNKNOWN_ERROR';
}
function createConfiguredModelClient(config: AppConfig): ModelClient | undefined {
  if (!config.modelApiKey || !config.modelBaseUrl || !config.modelName) return undefined;
  return new OpenAICompatibleModelClient({ apiKey: config.modelApiKey, baseUrl: config.modelBaseUrl, model: config.modelName, timeoutMs: config.modelTimeoutMs, wireApi: config.modelWireApi });
}

function createPiWorkspaceRuntime(config: AppConfig, store: Store, sharedModelClient?: ModelClient): WorkspaceRuntime {
  if (!config.modelApiKey || !config.modelBaseUrl || !config.modelName) throw new Error('PI_RUNTIME_CONFIG_MISSING');
  const modelClient = sharedModelClient ?? createConfiguredModelClient(config);
  if (!modelClient) throw new Error('PI_RUNTIME_CONFIG_MISSING');
  return new PiRuntimeAdapter(store, modelClient, {
    model: config.modelName,
    redactSecrets: [config.modelApiKey],
    persistUserMessage: false,
    messageSink: async (message) => {
      if (!message.adminId) return;
      const record = await store.appendWorkspaceMessage({ adminId: message.adminId, sessionId: message.sessionId, runId: message.runId, type: message.messageType, content: message.content, summary: message.summary });
      await store.appendRunEvent({ runId: message.runId, eventType: 'message.appended', payload: { messageId: record.id, messageType: record.type, content: record.content, summary: record.summary, createdAt: record.createdAt } });
    },
  });
}

async function handleRequest(runtime: AppRuntime, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = (request.method ?? 'GET').toUpperCase();
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const ids = createIds();
  const ctx: RequestContext = { requestId: ids.requestId, traceId: ids.traceId, method, path: url.pathname, query: Object.fromEntries(url.searchParams.entries()), body: {}, headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value])), cookies: parseCookies(request.headers.cookie) };
  try {
    if (method === 'OPTIONS') { response.statusCode = 204; response.end(); return; }
    if (method !== 'GET' && method !== 'HEAD') ctx.body = await readBody(request);
    const result = await dispatch(runtime, ctx, response);
    if (result) writeJson(response, result.statusCode, result.body);
  } catch (error) {
    const serviceError = error instanceof ServiceError ? error : undefined;
    const mapped = serviceError ?? new ServiceError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'internal error');
    const body = failure(ctx, mapped.statusCode, mapped.code, mapped.message, mapped.details);
    writeJson(response, body.statusCode, body.body);
  }
}

async function dispatch(runtime: AppRuntime, ctx: RequestContext, response: ServerResponse): Promise<{ statusCode: number; body: unknown } | undefined> {
  const { auth, accounts, coupons, orders, products, productAutomation, productSync, credentials, apiKeyCredentials, dashboard, messages, workspace, store, config, xianyuIm } = runtime;
  if (ctx.path === '/healthz' && ctx.method === 'GET') {
    const health = await store.health();
    const redis = !config.redisUrl || !runtime.redisRealtime
      ? 'not_configured'
      : (await runtime.redisRealtime.health()).reachable ? 'ok' : 'unavailable';
    const body = success(ctx, { status: health.reachable ? 'ok' : 'degraded', storage: health.kind, services: { api: 'ok', database: health.reachable ? 'ok' : 'unavailable', redis } });
    return { statusCode: health.reachable ? 200 : 503, body: body.body };
  }
  if (ctx.path === '/readyz' && ctx.method === 'GET') {
    const health = await store.health();
    const body = success(ctx, { ready: health.reachable, storage: health.kind, database: health.reachable ? 'ok' : 'unavailable' });
    return { statusCode: health.reachable ? 200 : 503, body: body.body };
  }
  if (ctx.path === '/api/v1/auth/session' && ctx.method === 'GET') {
    const authContext = await auth.contextFromSession(ctx.cookies.session_id);
    if (!authContext) return { statusCode: 200, body: success(ctx, { authenticated: false, bootstrapRequired: await auth.getBootstrapRequired() }).body };
    setSessionCookies(response, authContext.csrfToken, authContext.session.id, config.cookieSecure);
    if (config.xianyuQrMode === 'real') void startRecoverableListenersBestEffort(runtime, authContext.admin.id);
    return { statusCode: 200, body: success(ctx, { authenticated: true, bootstrapRequired: false, session: { id: authContext.session.id, expiresAt: authContext.session.expiresAt }, ...(await auth.sessionView(authContext)) }).body };
  }
  if (ctx.path === '/api/v1/auth/bootstrap' && ctx.method === 'POST') {
    const key = requireIdempotencyKey(ctx);
    const result = await idempotent(store, { scope: 'bootstrap:/api/v1/auth/bootstrap', key, fingerprint: fingerprint(ctx.method, ctx.path, ctx.body), traceId: ctx.traceId, handler: async () => {
      const input = { email: String(ctx.body.email ?? ''), password: String(ctx.body.password ?? ''), displayName: String(ctx.body.displayName ?? '') };
      if (!input.email || !input.password || !input.displayName || input.password.length < 8) throw new ServiceError(422, 'VALIDATION_FAILED', 'email, displayName and password (min 8 chars) are required');
      const result = await auth.bootstrap({ ...input, requestId: ctx.requestId, traceId: ctx.traceId });
      setSessionCookies(response, result.csrfToken, result.session.id, config.cookieSecure);
      return success(ctx, { session: { id: result.session.id, expiresAt: result.session.expiresAt }, profile: { id: result.admin.id, email: result.admin.email, displayName: result.admin.displayName, role: result.admin.role }, auditRef: result.auditRef });
    } });
    if (result.replayed) {
      const sessionId = (result.body as { data?: { session?: { id?: string } } })?.data?.session?.id;
      const csrfToken = sessionId ? auth.getCsrfToken(sessionId) : undefined;
      if (sessionId && csrfToken) setSessionCookies(response, csrfToken, sessionId, config.cookieSecure);
    }
    return { statusCode: result.statusCode, body: result.body };
  }
  if (ctx.path === '/api/v1/auth/password-login' && ctx.method === 'POST') {
    const result = await auth.login({ email: String(ctx.body.email ?? ''), password: String(ctx.body.password ?? '') });
    setSessionCookies(response, result.csrfToken, result.session.id, config.cookieSecure);
    return { statusCode: 200, body: success(ctx, { session: { id: result.session.id, expiresAt: result.session.expiresAt }, profile: { id: result.admin.id, email: result.admin.email, displayName: result.admin.displayName, role: result.admin.role } }).body };
  }

  const authContext = await requireAuth(auth, ctx);
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && ctx.path !== '/api/v1/auth/logout') await auth.validateCsrf(authContext, ctx.headers, ctx.cookies);
  if (ctx.path === '/api/v1/auth/logout' && ctx.method === 'POST') {
    await auth.validateCsrf(authContext, ctx.headers, ctx.cookies);
    await auth.logout(authContext);
    setCookie(response, 'session_id', '', { httpOnly: true, secure: config.cookieSecure, maxAge: 0 });
    setCookie(response, 'csrf_token', '', { secure: config.cookieSecure, maxAge: 0 });
    return { statusCode: 200, body: success(ctx, { loggedOut: true }).body };
  }

  if (ctx.path === '/api/v1/dashboard/snapshot' && ctx.method === 'GET') {
    const accountId = optionalString(ctx.query.accountId);
    const range = optionalString(ctx.query.range);
    const from = optionalString(ctx.query.from);
    const to = optionalString(ctx.query.to);
    if (range && !['today', '3d', '7d', '1m', 'custom'].includes(range)) throw new ServiceError(422, 'VALIDATION_FAILED', 'invalid dashboard range');
    if ((from && !to) || (to && !from) || (range === 'custom' && (!from || !to))) throw new ServiceError(422, 'VALIDATION_FAILED', 'from and to are required for custom dashboard range');
    if (from && to) {
      const fromMs = Date.parse(from);
      const toMs = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(to) + 24 * 60 * 60 * 1000 : Date.parse(to);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) throw new ServiceError(422, 'VALIDATION_FAILED', 'dashboard from/to must be valid and ordered');
      if (toMs - fromMs > 366 * 24 * 60 * 60 * 1000) throw new ServiceError(422, 'VALIDATION_FAILED', 'dashboard date range cannot exceed 366 days');
    }
    return { statusCode: 200, body: success(ctx, await dashboard.getSnapshot(authContext.admin.id, new Date(), { accountId, range: range as DashboardRange | undefined, from, to })).body };
  }

  if (ctx.path === '/api/v1/auto-reply/activity/summary' && ctx.method === 'GET') {
    const summary = await runtime.autoReplyActivity.summary({ adminId: authContext.admin.id, accountId: optionalString(ctx.query.accountId), from: optionalString(ctx.query.from), to: optionalString(ctx.query.to) });
    return { statusCode: 200, body: success(ctx, summary).body };
  }
  if (ctx.path === '/api/v1/auto-reply/runs' && ctx.method === 'GET') {
    const runs = await runtime.autoReplyActivity.list({ adminId: authContext.admin.id, query: parseAutoReplyRunListQuery(ctx.query) });
    return { statusCode: 200, body: success(ctx, runs).body };
  }
  const autoReplyRunDetailMatch = ctx.path.match(/^\/api\/v1\/auto-reply\/runs\/([^/]+)$/);
  if (autoReplyRunDetailMatch && ctx.method === 'GET') {
    const detail = await runtime.autoReplyActivity.detail({ adminId: authContext.admin.id, runId: decodeURIComponent(autoReplyRunDetailMatch[1]) });
    return { statusCode: 200, body: success(ctx, detail).body };
  }

  if (ctx.path === '/api/v1/settings/agent' && ctx.method === 'GET') {
    const accountId = String(ctx.query.accountId ?? '').trim();
    if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
    return { statusCode: 200, body: success(ctx, await runtime.autoReplyAgentSettings.get(authContext.admin.id, accountId)).body };
  }
  if (ctx.path === '/api/v1/settings/agent' && ctx.method === 'PATCH') {
    const key = requireIdempotencyKey(ctx);
    const result = await idempotent(store, {
      scope: `settings:agent:${String(ctx.body.accountId ?? '').trim()}`,
      key,
      fingerprint: fingerprint(ctx.method, ctx.path, ctx.body),
      traceId: ctx.traceId,
      handler: async () => {
        const accountId = String(ctx.body.accountId ?? '').trim();
        if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
        const expectedVersion = Number(ctx.body.expectedVersion ?? ctx.body.configVersion ?? 0);
        const patch = readAutoReplyAgentPatch(ctx.body);
        const updated = await runtime.autoReplyAgentSettings.update({ adminId: authContext.admin.id, accountId, expectedVersion, patch, requestId: ctx.requestId, traceId: ctx.traceId });
        return success(ctx, updated);
      },
    });
    return { statusCode: result.statusCode, body: result.body };
  }

  if (ctx.path === '/api/v1/settings/openai' && ctx.method === 'GET') {
    const accountId = String(ctx.query.accountId ?? '').trim();
    if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
    return { statusCode: 200, body: success(ctx, { accountId, items: await runtime.openaiSettings.list({ adminId: authContext.admin.id, accountId }) }).body };
  }
  if (ctx.path === '/api/v1/settings/openai/test' && ctx.method === 'POST') {
    const accountId = String(ctx.body.accountId ?? '').trim();
    if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
    const result = await runtime.openaiSettings.test({ ...readOpenAiConfigInput(ctx.body), adminId: authContext.admin.id, accountId, requestId: ctx.requestId, traceId: ctx.traceId });
    return { statusCode: 200, body: success(ctx, result).body };
  }
  if (ctx.path === '/api/v1/settings/openai/models' && ctx.method === 'GET') {
    const accountId = String(ctx.query.accountId ?? '').trim();
    const configId = String(ctx.query.configId ?? '').trim() || undefined;
    if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
    const resolved = configId
      ? await runtime.openaiSettings.resolveById(authContext.admin.id, configId, accountId)
      : (await runtime.openaiSettings.resolveForRuntime(authContext.admin.id, accountId))[0];
    const models = await runtime.openaiSettings.listModels({ adminId: authContext.admin.id, accountId, configId });
    return {
      statusCode: 200,
      body: success(ctx, {
        accountId,
        configId: resolved?.id ?? configId ?? '',
        provider: resolved?.provider ?? '',
        models,
      }).body,
    };
  }
  const openAiConfigMatch = ctx.path.match(/^\/api\/v1\/settings\/openai(?:\/([^/]+))?$/);
  if (openAiConfigMatch && (ctx.method === 'POST' || ctx.method === 'PATCH')) {
    const configId = decodeURIComponent(openAiConfigMatch[1] ?? '') || undefined;
    const key = requireIdempotencyKey(ctx);
    const result = await idempotent(store, {
      scope: `settings:openai:${configId ?? 'create'}:${String(ctx.body.accountId ?? '').trim()}`,
      key,
      fingerprint: fingerprint(ctx.method, ctx.path, ctx.body),
      traceId: ctx.traceId,
      handler: async () => {
        const accountId = String(ctx.body.accountId ?? '').trim();
        if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
        const saved = await runtime.openaiSettings.save({ ...readOpenAiConfigInput(ctx.body), adminId: authContext.admin.id, accountId, configId, requestId: ctx.requestId, traceId: ctx.traceId });
        return success(ctx, saved, configId ? 200 : 201);
      },
    });
    return { statusCode: result.statusCode, body: result.body };
  }

  const credentialCollectionPath = ctx.path === '/api/v1/credentials';
  if (credentialCollectionPath && ctx.method === 'GET') {
    const accountId = String(ctx.query.accountId ?? '').trim();
    const items = await apiKeyCredentials.list({ adminId: authContext.admin.id, accountId });
    return { statusCode: 200, body: success(ctx, { accountId, items }).body };
  }
  if (credentialCollectionPath && ctx.method === 'POST') {
    const key = requireIdempotencyKey(ctx);
    const result = await idempotent(store, {
      scope: 'credentials:/api/v1/credentials',
      key,
      fingerprint: fingerprint(ctx.method, ctx.path, ctx.body),
      traceId: ctx.traceId,
      handler: async () => {
        const created = await apiKeyCredentials.create({
          adminId: authContext.admin.id,
          accountId: String(ctx.body.accountId ?? ''),
          provider: String(ctx.body.provider ?? ''),
          alias: String(ctx.body.alias ?? ''),
          label: typeof ctx.body.label === 'string' ? ctx.body.label : undefined,
          apiKey: String(ctx.body.apiKey ?? ''),
          metadata: readCredentialMetadata(ctx.body.metadata),
          requestId: ctx.requestId,
          traceId: ctx.traceId,
        });
        return success(ctx, created, 201);
      },
    });
    return { statusCode: result.statusCode, body: result.body };
  }
  const credentialRefMatch = ctx.path.match(/^\/api\/v1\/credentials\/([^/]+)(?:\/(rotate|enable|disable|revoke))?$/);
  if (credentialRefMatch) {
    const credentialId = decodeURIComponent(credentialRefMatch[1]);
    const action = credentialRefMatch[2];
    if (!action && ctx.method === 'PATCH') {
      const key = requireIdempotencyKey(ctx);
      const result = await idempotent(store, {
        scope: `credentials:${credentialId}:patch`,
        key,
        fingerprint: fingerprint(ctx.method, ctx.path, ctx.body),
        traceId: ctx.traceId,
        handler: async () => {
          const updated = await apiKeyCredentials.update({ adminId: authContext.admin.id, credentialId, expectedVersion: Number(ctx.body.expectedVersion ?? 0), provider: typeof ctx.body.provider === 'string' ? ctx.body.provider : undefined, alias: typeof ctx.body.alias === 'string' ? ctx.body.alias : undefined, label: typeof ctx.body.label === 'string' ? ctx.body.label : undefined, metadata: ctx.body.metadata ? readCredentialMetadata(ctx.body.metadata) : undefined, requestId: ctx.requestId, traceId: ctx.traceId });
          return success(ctx, updated);
        },
      });
      return { statusCode: result.statusCode, body: result.body };
    }
    if (action && ctx.method === 'POST') {
      const key = requireIdempotencyKey(ctx);
      const result = await idempotent(store, {
        scope: `credentials:${credentialId}:${action}`,
        key,
        fingerprint: fingerprint(ctx.method, ctx.path, ctx.body),
        traceId: ctx.traceId,
        handler: async () => {
          const expectedVersion = Number(ctx.body.expectedVersion ?? 0);
          const payload = action === 'rotate'
            ? await apiKeyCredentials.rotate({ adminId: authContext.admin.id, credentialId, expectedVersion, apiKey: String(ctx.body.apiKey ?? ''), requestId: ctx.requestId, traceId: ctx.traceId })
            : await apiKeyCredentials.setStatus({ adminId: authContext.admin.id, credentialId, expectedVersion, status: action === 'enable' ? 'active' : action === 'disable' ? 'disabled' : 'revoked', requestId: ctx.requestId, traceId: ctx.traceId });
          return success(ctx, payload);
        },
      });
      return { statusCode: result.statusCode, body: result.body };
    }
  }

  if (ctx.path === '/api/v1/conversations' && ctx.method === 'GET') {
    const query = parseConversationListQuery(ctx.query);
    const refreshMode = conversationRefreshMode(query);
    if (query.accountId && refreshMode === 'await') {
      // The local API cursor is opaque and must never be forwarded to the
      // numeric cursor used by the Xianyu IM protocol. Refresh from the
      // external head only for the first page; the local store owns
      // pagination for the UI. Re-running the external upsert on later
      // pages would stamp every conversation with a fresh updated_at and
      // invalidate the opaque cursor issued by the previous page.
      try { await xianyuIm.listConversations(authContext.admin.id, query.accountId, undefined, query.limit); }
      catch { /* preserve locally persisted conversations when the external session is unavailable */ }
    } else if (query.accountId && refreshMode === 'background') {
      // Serve the local index immediately. The external head refresh is
      // intentionally detached so opening the route is not blocked by IM
      // login/token/profile latency; the UI's local reconciliation picks up
      // the upserts on its next cycle.
      void xianyuIm.listConversations(authContext.admin.id, query.accountId, undefined, query.limit).catch(() => undefined);
    }
    const result = await messages.listConversations(authContext.admin.id, query);
    return { statusCode: 200, body: success(ctx, result).body };
  }
  const conversationReadMatch = ctx.path.match(/^\/api\/v1\/conversations\/([^/]+)\/read$/);
  if (conversationReadMatch && ctx.method === 'POST') {
    const conversationId = decodeURIComponent(conversationReadMatch[1]);
    const local = await messages.getConversation(authContext.admin.id, conversationId);
    const result = await xianyuIm.markConversationRead(authContext.admin.id, local.accountId, conversationId, ctx.requestId, ctx.traceId);
    return { statusCode: 200, body: success(ctx, result).body };
  }
  const conversationMessagesMatch = ctx.path.match(/^\/api\/v1\/conversations\/([^/]+)\/messages$/);
  if (conversationMessagesMatch && ctx.method === 'GET') {
    const conversationId = decodeURIComponent(conversationMessagesMatch[1]);
    const local = await messages.getConversation(authContext.admin.id, conversationId);
    const query = parseMessageListQuery(ctx.query);
    const history = decodeMessageHistoryCursor(query.beforeCursor);
    if (query.beforeCursor !== undefined && !history) throw new ServiceError(422, 'VALIDATION_FAILED', 'beforeCursor is invalid');
    let externalPage: { hasMore: boolean; nextCursor?: number } = { hasMore: false };
    const isInitialTimelinePage = query.beforeCursor === undefined && query.cursor === undefined;
    const refreshMode = messageRefreshMode(query);
    const shouldReadExternalHistory = refreshMode !== 'local' && (isInitialTimelinePage || history?.externalCursor !== undefined);
    if (shouldReadExternalHistory) {
      const shouldAwaitExternal = refreshMode === 'await';
      const refresh = xianyuIm.listMessages(authContext.admin.id, local.accountId, conversationId, history?.externalCursor, query.limit)
        .then((page) => { externalPage = page; return page; })
        .catch(() => undefined);
      if (shouldAwaitExternal) {
        await refresh;
      } else {
        void refresh;
      }
    }
    const result = await messages.listMessages(authContext.admin.id, conversationId, query);
    const oldest = result.items[0];
    const hasMoreHistory = Boolean(externalPage.hasMore || result.hasMoreHistory);
    const historyCursor = hasMoreHistory && oldest
      ? encodeMessageHistoryCursor({ externalCursor: externalPage.nextCursor, beforeCreatedAt: oldest.createdAt, beforeMessageId: oldest.messageId })
      : undefined;
    return { statusCode: 200, body: success(ctx, { ...result, hasMoreHistory, historyCursor }).body };
  }
  const conversationSendMatch = ctx.path.match(/^\/api\/v1\/conversations\/([^/]+)\/messages$/);
  if (conversationSendMatch && ctx.method === 'POST') {
    const conversationId = decodeURIComponent(conversationSendMatch[1]);
    const local = await messages.getConversation(authContext.admin.id, conversationId);
    const result = await mutation(runtime, ctx, authContext, local.accountId, async () => {
      const text = typeof ctx.body.text === 'string' ? ctx.body.text : typeof ctx.body.bodyText === 'string' ? ctx.body.bodyText : '';
      const sent = await xianyuIm.sendText(authContext.admin.id, local.accountId, conversationId, text, ctx.requestId, ctx.traceId);
      return { statusCode: 200, body: success(ctx, sent).body };
    });
    return result;
  }
  const conversationImageMatch = ctx.path.match(/^\/api\/v1\/conversations\/([^/]+)\/images$/);
  if (conversationImageMatch && ctx.method === 'POST') {
    const conversationId = decodeURIComponent(conversationImageMatch[1]);
    const local = await messages.getConversation(authContext.admin.id, conversationId);
    const file = ctx.body.image;
    if (!file || typeof file !== 'object' || Array.isArray(file) || !Buffer.isBuffer((file as { data?: unknown }).data)) throw new ServiceError(422, 'VALIDATION_FAILED', 'image file is required');
    const result = await mutation(runtime, ctx, authContext, local.accountId, async () => {
      const uploaded = file as { filename?: unknown; contentType?: unknown; data: Buffer };
      const sent = await xianyuIm.sendImage(authContext.admin.id, local.accountId, conversationId, { filename: String(uploaded.filename ?? 'image'), contentType: String(uploaded.contentType ?? 'application/octet-stream'), data: uploaded.data }, ctx.requestId, ctx.traceId);
      return { statusCode: 200, body: success(ctx, sent).body };
    });
    return result;
  }

  const loginSessionMatch = ctx.path.match(/^\/api\/v1\/accounts\/([^/]+)\/login-sessions(?:\/([^/]+)(?:\/(cancel|renew|complete))?)?$/);
  if (ctx.path === '/api/v1/auth/qr-sessions' && ctx.method === 'POST') {
    const accountId = optionalString(ctx.body.accountId);
    const result = await mutation(runtime, ctx, authContext, accountId, async () => {
      const loginSession = await accounts.createLoginSession({ adminId: authContext.admin.id, accountId, loginMethod: 'qr', requestId: ctx.requestId, traceId: ctx.traceId });
      if (config.xianyuQrMode === 'stub') return success(ctx, toQrSessionView(loginSession), 201);
      try {
        const qrSession = await runtime.qrLogin.create({ sessionId: loginSession.id, adminId: authContext.admin.id, accountId: loginSession.accountId });
        return success(ctx, { ...toQrSessionView(loginSession), qrImageDataUrl: qrSession.qrImageDataUrl, pollAfterMs: qrSession.pollAfterMs, expiresAt: qrSession.expiresAt, status: qrSession.status, errorCode: qrSession.errorCode, verificationUrl: qrSession.verificationUrl }, 201);
      } catch (error) {
        await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId: loginSession.id, patch: { status: 'failed', failureCode: error instanceof Error ? error.message : 'QR_GENERATE_FAILED', completedAt: new Date().toISOString() }, requestId: ctx.requestId, traceId: ctx.traceId });
        throw new ServiceError(502, 'QR_GENERATE_FAILED', 'unable to generate xianyu qr session');
      }
    });
    return result;
  }
  if (ctx.path.startsWith('/api/v1/auth/qr-sessions/') && ctx.method === 'GET') {
    const sessionId = decodeURIComponent(ctx.path.split('/').pop() ?? '');
    const local = await accounts.getLoginSessionById({ adminId: authContext.admin.id, sessionId });
    const external = runtime.qrLogin.get(sessionId);
    const terminal = ['succeeded', 'cancelled', 'failed', 'expired'].includes(local.status);
    return { statusCode: 200, body: success(ctx, external ? { ...toQrSessionView(local), qrImageDataUrl: external.qrImageDataUrl, pollAfterMs: external.pollAfterMs, expiresAt: external.expiresAt, status: terminal ? local.status : external.status, errorCode: terminal ? local.failureCode : external.errorCode, verificationUrl: external.verificationUrl, verificationAutoLaunch: external.verificationAutoLaunch } : toQrSessionView(local)).body };
  }
  const globalQrAction = ctx.path.match(/^\/api\/v1\/auth\/qr-sessions\/([^/]+)\/(cancel|renew)$/);
  if (globalQrAction && ctx.method === 'POST') {
    const sessionId = decodeURIComponent(globalQrAction[1]);
    const local = await accounts.getLoginSessionById({ adminId: authContext.admin.id, sessionId });
    const accountId = local.accountId;
    return mutation(runtime, ctx, authContext, accountId, async () => {
      if (globalQrAction[2] === 'cancel') {
        runtime.qrLogin.cancel(sessionId);
        const cancelled = await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId, patch: { status: 'cancelled', completedAt: new Date().toISOString() }, requestId: ctx.requestId, traceId: ctx.traceId });
        return success(ctx, toQrSessionView(cancelled));
      }
      const renewed = await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId, patch: { status: 'waiting', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), failureCode: undefined }, requestId: ctx.requestId, traceId: ctx.traceId });
      if (config.xianyuQrMode === 'stub') return success(ctx, toQrSessionView(renewed));
      const qrSession = await runtime.qrLogin.create({ sessionId, adminId: authContext.admin.id, accountId: renewed.accountId });
      return success(ctx, { ...toQrSessionView(renewed), qrImageDataUrl: qrSession.qrImageDataUrl, pollAfterMs: qrSession.pollAfterMs, expiresAt: qrSession.expiresAt, status: qrSession.status, errorCode: qrSession.errorCode, verificationUrl: qrSession.verificationUrl });
    });
  }

  if (ctx.path === '/api/v1/auth/cookie-login' && ctx.method === 'POST') {
    const cookieHeader = String(ctx.body.cookieHeader ?? '').trim();
    if (!cookieHeader) throw new ServiceError(422, 'VALIDATION_FAILED', 'cookieHeader is required');
    const requestedAccountId = optionalString(ctx.body.accountId);
    const result = await mutation(runtime, ctx, authContext, undefined, async () => {
      const loginSession = await accounts.createLoginSession({ adminId: authContext.admin.id, loginMethod: 'cookie', requestId: ctx.requestId, traceId: ctx.traceId });
      try {
        const unb = readCookieValue(cookieHeader, 'unb') || `cookie_${createId()}`;
        const account = await accounts.resolveForLogin({ adminId: authContext.admin.id, accountId: requestedAccountId, platform: 'xianyu', sellerRef: unb, requestId: ctx.requestId, traceId: ctx.traceId });
        await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId: undefined, sessionId: loginSession.id, patch: { accountId: account.id }, requestId: ctx.requestId, traceId: ctx.traceId });
        await credentials.save({ adminId: authContext.admin.id, accountId: account.id, cookieHeader, clearAccessToken: true, metadata: { unb, loginMethod: 'cookie' }, requestId: ctx.requestId, traceId: ctx.traceId });
        await runtime.xianyuIm.resetClient(authContext.admin.id, account.id);
        const verification = await runtime.xianyu.verifyLogin(authContext.admin.id, account.id);
        if (!verification.success) {
          await credentials.verify({ adminId: authContext.admin.id, accountId: account.id, status: 'expired', requestId: ctx.requestId, traceId: ctx.traceId });
          await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId: account.id, sessionId: loginSession.id, patch: { status: 'failed', failureCode: verification.errorCode ?? 'COOKIE_VERIFY_FAILED', completedAt: new Date().toISOString() }, requestId: ctx.requestId, traceId: ctx.traceId });
          throw new ServiceError(422, 'COOKIE_VERIFY_FAILED', verification.message ?? '闲鱼 Cookie 校验失败');
        }
        await credentials.verify({ adminId: authContext.admin.id, accountId: account.id, status: 'active', requestId: ctx.requestId, traceId: ctx.traceId });
        await hydrateAccountProfile({ accounts, xianyu: runtime.xianyu, adminId: authContext.admin.id, accountId: account.id, fallbackSellerRef: unb, requestId: ctx.requestId, traceId: ctx.traceId });
        const completed = await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId: account.id, sessionId: loginSession.id, patch: { status: 'succeeded', completedAt: new Date().toISOString(), failureCode: undefined }, requestId: ctx.requestId, traceId: ctx.traceId });
        void startXianyuListenerBestEffort(runtime, authContext.admin.id, account.id);
        return success(ctx, { account: await accounts.get(authContext.admin.id, account.id), session: completed }, 201);
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId: loginSession.accountId, sessionId: loginSession.id, patch: { status: 'failed', failureCode: error instanceof Error ? error.message : 'COOKIE_LOGIN_FAILED', completedAt: new Date().toISOString() }, requestId: ctx.requestId, traceId: ctx.traceId });
        throw new ServiceError(502, 'COOKIE_LOGIN_FAILED', '无法完成闲鱼 Cookie 登录');
      }
    });
    return result;
  }
  if (ctx.path === '/api/v1/accounts/password-login' && ctx.method === 'POST') {
    if (!optionalString(ctx.body.account) || !optionalString(ctx.body.password)) throw new ServiceError(422, 'VALIDATION_FAILED', 'account and password are required');
    throw new ServiceError(501, 'PASSWORD_LOGIN_UNAVAILABLE', '闲鱼账号密码登录需要独立浏览器运行时，当前版本仅开放扫码和 Cookie 登录');
  }

  const credentialMatch = ctx.path.match(/^\/api\/v1\/accounts\/([^/]+)\/credential(?:\/(verify|revoke))?$/);
  if (credentialMatch) {
    const accountId = decodeURIComponent(credentialMatch[1]);
    const action = credentialMatch[2];
    if (!action && ctx.method === 'GET') return { statusCode: 200, body: success(ctx, credentialMutationView(await credentials.get(authContext.admin.id, accountId))).body };
    if (!action && (ctx.method === 'PUT' || ctx.method === 'POST')) {
      const result = await mutation(runtime, ctx, authContext, accountId, async () => {
        const credential = await credentials.save({
          adminId: authContext.admin.id,
          accountId,
          cookieHeader: typeof ctx.body.cookieHeader === 'string' ? ctx.body.cookieHeader : undefined,
          accessToken: typeof ctx.body.accessToken === 'string' ? ctx.body.accessToken : undefined,
          clearAccessToken: typeof ctx.body.cookieHeader === 'string' && typeof ctx.body.accessToken !== 'string',
          deviceId: typeof ctx.body.deviceId === 'string' ? ctx.body.deviceId : undefined,
          metadata: readCredentialMetadata(ctx.body.metadata),
          expiresAt: typeof ctx.body.expiresAt === 'string' ? ctx.body.expiresAt : undefined,
          requestId: ctx.requestId,
          traceId: ctx.traceId,
        });
        await runtime.xianyuIm.resetClient(authContext.admin.id, accountId);
        void startXianyuListenerBestEffort(runtime, authContext.admin.id, accountId);
        return success(ctx, credentialMutationView(credential));
      });
      return result;
    }
    if (action === 'revoke' && (ctx.method === 'POST' || ctx.method === 'DELETE')) return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, credentialMutationView(await credentials.revoke({ adminId: authContext.admin.id, accountId, requestId: ctx.requestId, traceId: ctx.traceId }))));
    if (action === 'verify' && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => {
      const credential = await credentials.verify({ adminId: authContext.admin.id, accountId, status: (typeof ctx.body.status === 'string' ? ctx.body.status : 'active') as never, expiresAt: typeof ctx.body.expiresAt === 'string' ? ctx.body.expiresAt : undefined, requestId: ctx.requestId, traceId: ctx.traceId });
      if (credential.status === 'active') void startXianyuListenerBestEffort(runtime, authContext.admin.id, accountId);
      return success(ctx, credentialMutationView(credential));
    });
  }
  if (loginSessionMatch) {
    const accountId = decodeURIComponent(loginSessionMatch[1]);
    const sessionId = loginSessionMatch[2] ? decodeURIComponent(loginSessionMatch[2]) : undefined;
    if (!sessionId && ctx.method === 'POST') {
      const result = await mutation(runtime, ctx, authContext, accountId, async () => {
        const loginMethod = String(ctx.body.loginMethod ?? 'qr');
        const loginSession = await accounts.createLoginSession({ adminId: authContext.admin.id, accountId, loginMethod, requestId: ctx.requestId, traceId: ctx.traceId });
        if (loginMethod !== 'qr' || config.xianyuQrMode === 'stub') return success(ctx, loginSession, 201);
        try {
          const qrSession = await runtime.qrLogin.create({ sessionId: loginSession.id, adminId: authContext.admin.id, accountId });
          return success(ctx, { ...toQrSessionView(loginSession), qrImageDataUrl: qrSession.qrImageDataUrl, pollAfterMs: qrSession.pollAfterMs, expiresAt: qrSession.expiresAt, status: qrSession.status, errorCode: qrSession.errorCode, verificationUrl: qrSession.verificationUrl }, 201);
        } catch (error) {
          await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId: loginSession.id, patch: { status: 'failed', failureCode: error instanceof Error ? error.message : 'QR_GENERATE_FAILED', completedAt: new Date().toISOString() }, requestId: ctx.requestId, traceId: ctx.traceId });
          throw new ServiceError(502, 'QR_GENERATE_FAILED', 'unable to generate xianyu qr session');
        }
      });
      return result;
    }
    if (sessionId && ctx.method === 'GET') {
      const local = await accounts.getLoginSession({ adminId: authContext.admin.id, accountId, sessionId });
      const external = runtime.qrLogin.get(sessionId);
      const terminal = ['succeeded', 'cancelled', 'failed', 'expired'].includes(local.status);
      return { statusCode: 200, body: success(ctx, external ? { ...toQrSessionView(local), qrImageDataUrl: external.qrImageDataUrl, pollAfterMs: external.pollAfterMs, expiresAt: external.expiresAt, status: terminal ? local.status : external.status, errorCode: terminal ? local.failureCode : external.errorCode, verificationUrl: external.verificationUrl, verificationAutoLaunch: external.verificationAutoLaunch } : local).body };
    }
    if (sessionId && loginSessionMatch[3] === 'cancel' && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => { runtime.qrLogin.cancel(sessionId); return success(ctx, await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId, patch: { status: 'cancelled', completedAt: new Date().toISOString() }, requestId: ctx.requestId, traceId: ctx.traceId })); });
    if (sessionId && loginSessionMatch[3] === 'renew' && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => {
      const renewed = await accounts.updateLoginSession({ adminId: authContext.admin.id, accountId, sessionId, patch: { status: 'waiting', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), failureCode: undefined }, requestId: ctx.requestId, traceId: ctx.traceId });
      if (config.xianyuQrMode === 'stub') return success(ctx, renewed);
      const qrSession = await runtime.qrLogin.create({ sessionId, adminId: authContext.admin.id, accountId });
      return success(ctx, { ...toQrSessionView(renewed), qrImageDataUrl: qrSession.qrImageDataUrl, pollAfterMs: qrSession.pollAfterMs, expiresAt: qrSession.expiresAt, status: qrSession.status, errorCode: qrSession.errorCode, verificationUrl: qrSession.verificationUrl });
    });
    if (sessionId && loginSessionMatch[3] === 'complete' && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => {
      const result = await credentials.completeLoginSession({
        adminId: authContext.admin.id,
        accountId,
        sessionId,
        cookieHeader: typeof ctx.body.cookieHeader === 'string' ? ctx.body.cookieHeader : undefined,
        accessToken: typeof ctx.body.accessToken === 'string' ? ctx.body.accessToken : undefined,
        deviceId: typeof ctx.body.deviceId === 'string' ? ctx.body.deviceId : undefined,
        metadata: readCredentialMetadata(ctx.body.metadata),
        expiresAt: typeof ctx.body.expiresAt === 'string' ? ctx.body.expiresAt : undefined,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
      });
      if (result.credential.status === 'active') void startXianyuListenerBestEffort(runtime, authContext.admin.id, accountId);
      return success(ctx, { session: result.session, credential: credentialMutationView(result.credential) });
    });
  }

  const accountMatch = ctx.path.match(/^\/api\/v1\/accounts\/([^/]+)(?:\/(scopes|connection|connection\/verify))?$/);
  if (ctx.path === '/api/v1/accounts' && ctx.method === 'GET') return { statusCode: 200, body: success(ctx, await accounts.list(authContext.admin.id, parseAccountListQuery(ctx.query))).body };
  if (ctx.path === '/api/v1/accounts' && ctx.method === 'POST') {
    const result = await mutation(runtime, ctx, authContext, undefined, async () => {
      const account = await accounts.create({ adminId: authContext.admin.id, platform: String(ctx.body.platform ?? ''), sellerRef: String(ctx.body.sellerRef ?? ''), displayName: typeof ctx.body.displayName === 'string' ? ctx.body.displayName : undefined, requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, account, 201);
    });
    return result;
  }
  if (accountMatch) {
    const accountId = decodeURIComponent(accountMatch[1]);
    if (!accountMatch[2] && ctx.method === 'GET') return { statusCode: 200, body: success(ctx, await accounts.get(authContext.admin.id, accountId)).body };
     if (!accountMatch[2] && ctx.method === 'PATCH') return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, await accounts.update({ adminId: authContext.admin.id, accountId, patch: { sellerRef: optionalString(ctx.body.sellerRef), displayName: optionalString(ctx.body.displayName), remark: optionalString(ctx.body.remark), avatarUrl: optionalString(ctx.body.avatarUrl), platformUserId: optionalString(ctx.body.platformUserId), status: typeof ctx.body.status === 'string' ? ctx.body.status as never : undefined }, requestId: ctx.requestId, traceId: ctx.traceId })));
     if (!accountMatch[2] && ctx.method === 'DELETE') return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, { account: await accounts.delete({ adminId: authContext.admin.id, accountId, requestId: ctx.requestId, traceId: ctx.traceId }), deleted: true }));
    if (accountMatch[2] === 'connection' && ctx.method === 'GET') {
      const account = await accounts.get(authContext.admin.id, accountId);
      return { statusCode: 200, body: success(ctx, connectionView(account)).body };
    }
    if (accountMatch[2] === 'connection/verify' && ctx.method === 'POST') {
      const result = await mutation(runtime, ctx, authContext, accountId, async () => {
        const verification = await runtime.xianyu.verifyLogin(authContext.admin.id, accountId);
        if (verification.success) {
          await credentials.verify({ adminId: authContext.admin.id, accountId, status: 'active', requestId: ctx.requestId, traceId: ctx.traceId });
          void startXianyuListenerBestEffort(runtime, authContext.admin.id, accountId);
        } else if (verification.accountInvalid) {
          const status = 'expired' as const;
          try { await credentials.verify({ adminId: authContext.admin.id, accountId, status, requestId: ctx.requestId, traceId: ctx.traceId }); } catch { /* missing credential remains a verification failure */ }
        }
        return success(ctx, { success: verification.success, accountInvalid: verification.accountInvalid, errorCode: verification.errorCode, message: verification.message, response: verification.response });
      });
      return result;
    }
    if (accountMatch[2] && ctx.method === 'GET') return { statusCode: 200, body: success(ctx, { items: await accounts.scopes(authContext.admin.id, accountId) }).body };
    if (accountMatch[2] && ctx.method === 'POST') return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, await accounts.grantScope({ adminId: authContext.admin.id, accountId, scope: String(ctx.body.scope ?? 'read'), requestId: ctx.requestId, traceId: ctx.traceId }), 201));
    if (accountMatch[2] && ctx.method === 'DELETE') return mutation(runtime, ctx, authContext, accountId, async () => { await accounts.revokeScope({ adminId: authContext.admin.id, accountId, scope: String(ctx.body.scope ?? 'manage'), requestId: ctx.requestId, traceId: ctx.traceId }); return success(ctx, { revoked: true }); });
  }

  const workspaceSessionAction = ctx.path.match(/^\/api\/v1\/workspace\/agent-sessions\/([^/]+)\/(switch|archive)$/);
  if (ctx.path === '/api/v1/workspace/agent-sessions' && ctx.method === 'GET') {
    return { statusCode: 200, body: success(ctx, { items: await workspace.listSessions({ adminId: authContext.admin.id, accountId: optionalString(ctx.query.accountId), search: optionalString(ctx.query.search) }) }).body };
  }
  if (ctx.path === '/api/v1/workspace/agent-sessions/search' && ctx.method === 'GET') {
    return { statusCode: 200, body: success(ctx, { items: await workspace.listSessions({ adminId: authContext.admin.id, accountId: optionalString(ctx.query.accountId), search: optionalString(ctx.query.q ?? ctx.query.search) }) }).body };
  }
  const workspaceMessagesMatch = ctx.path.match(/^\/api\/v1\/workspace\/agent-sessions\/([^/]+)\/messages$/);
  if (workspaceMessagesMatch && ctx.method === 'GET') {
    const sessionId = decodeURIComponent(workspaceMessagesMatch[1]);
    const limit = Number(ctx.query.limit ?? 100);
    return { statusCode: 200, body: success(ctx, { items: await workspace.listMessages({ adminId: authContext.admin.id, sessionId, limit: Number.isFinite(limit) ? Math.trunc(limit) : 100 }) }).body };
  }
  if (ctx.path === '/api/v1/workspace/agent-sessions' && ctx.method === 'POST') {
    const accountId = optionalString(ctx.body.accountId);
    return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, await workspace.createSession({ adminId: authContext.admin.id, accountId: accountId ?? '', title: String(ctx.body.title ?? ''), summary: optionalString(ctx.body.summary), requestId: ctx.requestId, traceId: ctx.traceId }), 201));
  }
  if (workspaceSessionAction && ctx.method === 'POST') {
    const sessionId = decodeURIComponent(workspaceSessionAction[1]);
    return mutation(runtime, ctx, authContext, undefined, async () => workspaceSessionAction[2] === 'switch'
      ? success(ctx, await workspace.switchSession({ adminId: authContext.admin.id, sessionId, requestId: ctx.requestId, traceId: ctx.traceId }))
      : success(ctx, await workspace.archiveSession({ adminId: authContext.admin.id, sessionId, requestId: ctx.requestId, traceId: ctx.traceId })));
  }

  if (ctx.path === '/api/v1/workspace/runs' && ctx.method === 'POST') {
    const accountId = optionalString(ctx.body.accountId);
    return mutation(runtime, ctx, authContext, accountId, async () => {
      const result = await workspace.startRun({ adminId: authContext.admin.id, accountId: accountId ?? '', sessionId: String(ctx.body.sessionId ?? ''), instruction: String(ctx.body.instruction ?? ''), clientRunRef: optionalString(ctx.body.clientRunRef), requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, result.run, result.duplicate ? 200 : 201);
    });
  }
  const workspaceRunMatch = ctx.path.match(/^\/api\/v1\/workspace\/runs\/([^/]+)(?:\/events)?$/);
  if (workspaceRunMatch && ctx.method === 'GET') {
    const runId = decodeURIComponent(workspaceRunMatch[1]);
    if (ctx.path.endsWith('/events')) {
      const after = Number(ctx.query.after ?? 0);
      return { statusCode: 200, body: success(ctx, { items: await workspace.listEvents({ adminId: authContext.admin.id, runId, afterSequence: Number.isFinite(after) ? after : 0 }) }).body };
    }
    return { statusCode: 200, body: success(ctx, await workspace.getRun({ adminId: authContext.admin.id, runId })).body };
  }

  if (ctx.path === '/api/v1/orders' && ctx.method === 'GET') {
    return { statusCode: 200, body: success(ctx, await orders.list(authContext.admin.id, parseOrderListQuery(ctx.query))).body };
  }
  if (ctx.path === '/api/v1/orders/refresh' && ctx.method === 'POST') {
    const accountId = optionalString(ctx.body.accountId);
    return mutation(runtime, ctx, authContext, accountId, async () => success(ctx, await orders.refresh({ adminId: authContext.admin.id, accountId, pageSize: ctx.body.pageSize, maxPages: ctx.body.maxPages, requestId: ctx.requestId, traceId: ctx.traceId })));
  }
  const orderDetailMatch = ctx.path.match(/^\/api\/v1\/orders\/([^/]+)$/);
  if (orderDetailMatch && ctx.method === 'GET') {
    return { statusCode: 200, body: success(ctx, await orders.get({ adminId: authContext.admin.id, orderNo: decodeURIComponent(orderDetailMatch[1]), accountId: optionalString(ctx.query.accountId) })).body };
  }

  if (ctx.path === '/api/v1/coupons/batches' && ctx.method === 'GET') {
    const result = await coupons.list(authContext.admin.id, parseCouponBatchListQuery(ctx.query));
    return { statusCode: 200, body: success(ctx, result).body };
  }
  if (ctx.path === '/api/v1/coupons/batches' && ctx.method === 'POST') {
    const accountId = String(ctx.body.accountId ?? '');
    const result = await mutation(runtime, ctx, authContext, accountId || undefined, async () => {
      const batch = await coupons.create({ adminId: authContext.admin.id, accountId, label: optionalString(ctx.body.label), purpose: String(ctx.body.purpose ?? ''), metadata: readCouponMetadata(ctx.body.metadata), requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, batch, 201);
    });
    return result;
  }
  const couponBatchMatch = ctx.path.match(/^\/api\/v1\/coupons\/batches\/([^/]+)(?:\/(items\/import|bind|unbind|void))?$/);
  if (couponBatchMatch) {
    const batchId = decodeURIComponent(couponBatchMatch[1]);
    const action = couponBatchMatch[2];
    if (!action && ctx.method === 'GET') return { statusCode: 200, body: success(ctx, await coupons.get(authContext.admin.id, batchId)).body };
    if (!action && (ctx.method === 'PATCH' || ctx.method === 'PUT')) {
      return mutation(runtime, ctx, authContext, batchId, async () => success(ctx, await coupons.update({ adminId: authContext.admin.id, batchId, patch: { label: optionalString(ctx.body.label), purpose: optionalString(ctx.body.purpose), status: optionalString(ctx.body.status) as never, metadata: readCouponMetadata(ctx.body.metadata) }, requestId: ctx.requestId, traceId: ctx.traceId })));
    }
    if (!action && ctx.method === 'DELETE') {
      return mutation(runtime, ctx, authContext, batchId, async () => success(ctx, await coupons.delete({ adminId: authContext.admin.id, batchId, requestId: ctx.requestId, traceId: ctx.traceId })));
    }
    if (action === 'items/import' && ctx.method === 'POST') {
      return mutation(runtime, ctx, authContext, batchId, async () => {
        const items = Array.isArray(ctx.body.items) ? ctx.body.items.filter((item): item is string => typeof item === 'string') : [];
        return success(ctx, await coupons.importItems({ adminId: authContext.admin.id, batchId, contents: items, requestId: ctx.requestId, traceId: ctx.traceId }));
      });
    }
    if (action === 'bind' && ctx.method === 'POST') {
      return mutation(runtime, ctx, authContext, batchId, async () => success(ctx, await coupons.bind({ adminId: authContext.admin.id, batchId, productId: String(ctx.body.productId ?? ''), requestId: ctx.requestId, traceId: ctx.traceId })));
    }
    if (action === 'unbind' && ctx.method === 'POST') {
      return mutation(runtime, ctx, authContext, batchId, async () => success(ctx, await coupons.unbind({ adminId: authContext.admin.id, batchId, productId: String(ctx.body.productId ?? ''), requestId: ctx.requestId, traceId: ctx.traceId })));
    }
    if (action === 'void' && ctx.method === 'POST') {
      return mutation(runtime, ctx, authContext, batchId, async () => success(ctx, await coupons.void({ adminId: authContext.admin.id, batchId, requestId: ctx.requestId, traceId: ctx.traceId })));
    }
  }
  const couponContentMatch = ctx.path.match(/^\/api\/v1\/coupons\/([^/]+)\/content$/);
  if (couponContentMatch && ctx.method === 'GET') {
    const itemId = optionalString(ctx.query.couponId) ?? decodeURIComponent(couponContentMatch[1]);
    const preview = await coupons.content({ adminId: authContext.admin.id, itemId, purpose: optionalString(ctx.query.purpose) ?? 'preview', requestId: ctx.requestId, traceId: ctx.traceId });
    return { statusCode: 200, body: success(ctx, preview).body };
  }

  const couponAssetMatch = ctx.path.match(/^\/api\/v1\/coupons\/batches\/([^/]+)\/assets\/([^/]+)$/);
  if (couponAssetMatch && (ctx.method === 'GET' || ctx.method === 'HEAD')) {
    const batchId = decodeURIComponent(couponAssetMatch[1]);
    const assetId = decodeURIComponent(couponAssetMatch[2]);
    const resolved = await coupons.getAsset({ adminId: authContext.admin.id, batchId, assetId });
    if (!resolved) return { statusCode: 404, body: failure(ctx, 404, 'NOT_FOUND', 'coupon image not found').body };
    response.statusCode = 200;
    response.setHeader('Content-Type', resolved.object.contentType || resolved.asset.mimeType);
    response.setHeader('Content-Length', String(resolved.object.body.length));
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('ETag', `"${resolved.asset.checksum ?? resolved.object.etag ?? resolved.asset.id}"`);
    if (ctx.method === 'HEAD') response.end();
    else response.end(resolved.object.body);
    return undefined;
  }

  const productDetailAssetMatch = ctx.path.match(/^\/api\/v1\/products\/([^/]+)\/detail\/assets\/([^/]+)$/);
  if (productDetailAssetMatch && (ctx.method === 'GET' || ctx.method === 'HEAD')) {
    const productId = decodeURIComponent(productDetailAssetMatch[1]);
    const assetId = decodeURIComponent(productDetailAssetMatch[2]);
    const resolved = await runtime.xianyuItemDetail.getAsset({ adminId: authContext.admin.id, productId, assetId });
    if (!resolved) return { statusCode: 404, body: failure(ctx, 404, 'NOT_FOUND', 'product image not found').body };
    const { asset, object } = resolved;
    response.statusCode = 200;
    response.setHeader('Content-Type', object.contentType || asset.mimeType);
    response.setHeader('Content-Length', String(object.body.length));
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('ETag', `"${asset.checksum ?? object.etag ?? asset.id}"`);
    if (ctx.method === 'HEAD') response.end();
    else response.end(object.body);
    return undefined;
  }

  const productDetailMatch = ctx.path.match(/^\/api\/v1\/products\/([^/]+)\/(?:xianyu-detail|detail)(?:\/refresh)?$/);
  if (productDetailMatch && (ctx.method === 'GET' || ctx.method === 'POST')) {
    const productId = decodeURIComponent(productDetailMatch[1]);
    const refresh = ctx.path.endsWith('/refresh') || ctx.query.refresh === '1' || ctx.query.refresh === 'true' || ctx.method === 'POST';
    const read = () => runtime.xianyuItemDetail.get({
      adminId: authContext.admin.id,
      productId,
      refresh,
      categoryId: optionalString(ctx.query.categoryId),
      referer: optionalString(ctx.query.referer),
      spmPre: optionalString(ctx.query.spmPre),
      logId: optionalString(ctx.query.logId),
      requestId: ctx.requestId,
      traceId: ctx.traceId,
    });
    if (ctx.method === 'POST') return mutation(runtime, ctx, authContext, undefined, async () => success(ctx, await read()));
    return { statusCode: 200, body: success(ctx, await read()).body };
  }
  const productAutomationMatch = ctx.path.match(/^\/api\/v1\/products\/([^/]+)\/automation$/);
  if (ctx.path === '/api/v1/products/automation/batch' && ctx.method === 'POST') {
    return mutation(runtime, ctx, authContext, undefined, async () => {
      const result = await productAutomation.updateBatch({ adminId: authContext.admin.id, productIds: ctx.body.productIds, expectedConfigVersions: ctx.body.expectedConfigVersions, config: ctx.body.config, requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, result);
    });
  }
  if (productAutomationMatch && ctx.method === 'GET') {
    const productId = decodeURIComponent(productAutomationMatch[1]);
    return { statusCode: 200, body: success(ctx, await productAutomation.get(authContext.admin.id, productId)).body };
  }
  if (productAutomationMatch && (ctx.method === 'PUT' || ctx.method === 'PATCH')) {
    const productId = decodeURIComponent(productAutomationMatch[1]);
    const expectedConfigVersion = parseExpectedProductVersion(ctx);
    return mutation(runtime, ctx, authContext, undefined, async () => {
      const saved = await productAutomation.update({ adminId: authContext.admin.id, productId, expectedConfigVersion, config: ctx.body.config, requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, saved);
    });
  }
  if (ctx.path === '/api/v1/products/publish' && ctx.method === 'POST') {
    const accountId = optionalString(ctx.body.accountId);
    return mutation(runtime, ctx, authContext, accountId, async () => {
      if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
      const published = await runtime.productPublisher.publish({
        adminId: authContext.admin.id,
        accountId,
        title: String(ctx.body.title ?? ''),
        description: String(ctx.body.description ?? ''),
        categoryCode: optionalString(ctx.body.categoryCode),
        priceMinor: parsePublishMinor(ctx.body.priceMinor ?? ctx.body.price),
        originalPriceMinor: parseOptionalPublishMinor(ctx.body.originalPriceMinor ?? ctx.body.originalPrice),
        quantity: parsePublishInteger(ctx.body.quantity),
        postageMode: parsePublishPostageMode(ctx.body.postageMode),
        postageMinor: parseOptionalPublishMinor(ctx.body.postageMinor ?? ctx.body.postage),
        location: parsePublishLocation(ctx.body.location),
        images: readPublishImages(ctx.body.images),
        requestId: ctx.requestId,
        traceId: ctx.traceId,
      });
      return success(ctx, { ...published, product: toProductView(published.product) }, 201);
    });
  }
  if (ctx.path === '/api/v1/products/publish/optimize-description' && ctx.method === 'POST') {
    const accountId = optionalString(ctx.body.accountId);
    return mutation(runtime, ctx, authContext, accountId, async () => {
      if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
      const optimized = await runtime.productPublisher.optimizeDescription({ adminId: authContext.admin.id, accountId, title: String(ctx.body.title ?? ''), description: String(ctx.body.description ?? ''), requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, optimized);
    });
  }
  const productMatch = ctx.path.match(/^\/api\/v1\/products\/([^/]+)$/);
  if (ctx.path === '/api/v1/products/sync' && ctx.method === 'POST') {
    const accountId = optionalString(ctx.body.accountId);
    return mutation(runtime, ctx, authContext, accountId, async () => {
      if (!accountId) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
      const result = await productSync.sync({ adminId: authContext.admin.id, accountId, pageSize: ctx.body.pageSize, maxPages: ctx.body.maxPages, requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, { ...result, items: result.items.map(toProductView) });
    });
  }
  if (ctx.path === '/api/v1/products' && ctx.method === 'POST') {
    const accountId = optionalString(ctx.body.accountId);
    return mutation(runtime, ctx, authContext, accountId, async () => {
      const product = await products.create({ adminId: authContext.admin.id, accountId: accountId ?? '', externalProductRef: optionalString(ctx.body.externalProductRef), title: ctx.body.title, description: ctx.body.description, categoryCode: ctx.body.categoryCode, attributesJson: ctx.body.attributesJson, defaultReplyTemplate: ctx.body.defaultReplyTemplate, knowledgeBase: ctx.body.knowledgeBase, priceMinor: ctx.body.priceMinor, requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, toProductView(product), 201);
    });
  }
  if (ctx.path === '/api/v1/products' && ctx.method === 'GET') {
    const result = await products.list(authContext.admin.id, parseProductListQuery(ctx.query));
    return { statusCode: 200, body: success(ctx, toProductListView(result)).body };
  }
  if (productMatch && ctx.method === 'GET') {
    const product = await products.get(authContext.admin.id, decodeURIComponent(productMatch[1]));
    return { statusCode: 200, body: success(ctx, toProductView(product)).body };
  }
  if (productMatch && ctx.method === 'PATCH') {
    const productId = decodeURIComponent(productMatch[1]);
    const expectedConfigVersion = parseExpectedProductVersion(ctx);
    const accountId = optionalString(ctx.body.accountId);
    return mutation(runtime, ctx, authContext, undefined, async () => {
      const product = await products.update({ adminId: authContext.admin.id, productId, accountId, expectedConfigVersion, patch: ctx.body, requestId: ctx.requestId, traceId: ctx.traceId });
      return success(ctx, toProductView(product));
    });
  }

  return { statusCode: 404, body: failure(ctx, 404, 'NOT_FOUND', 'route not found').body };
}

async function requireAuth(auth: AuthService, ctx: RequestContext): Promise<AuthContext> { const context = await auth.contextFromSession(ctx.cookies.session_id); if (!context) throw new ServiceError(401, 'UNAUTHENTICATED', 'session required'); return context; }

async function handleWorkspaceUpgrade(runtime: AppRuntime, request: IncomingMessage, socket: Duplex): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const match = url.pathname.match(/^\/api\/v1\/workspace\/runs\/([^/]+)\/events$/);
  if (!match) { socket.destroy(); return; }
  const origin = request.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.host) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    } catch { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  }
  const authContext = await runtime.auth.contextFromSession(parseCookies(request.headers.cookie).session_id);
  if (!authContext) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  const runId = decodeURIComponent(match[1]);
  let run;
  try { run = await runtime.workspace.getRun({ adminId: authContext.admin.id, runId }); }
  catch (error) {
    const status = error instanceof ServiceError ? error.statusCode : 500;
    const phrase = status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Internal Server Error';
    socket.write(`HTTP/1.1 ${status} ${phrase}\r\n\r\n`);
    socket.destroy();
    return;
  }
  const key = request.headers['sec-websocket-key'];
  if (!key || Array.isArray(key)) { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let closed = false;
  const requestedCursor = Number(url.searchParams.get('after') ?? 0);
  let cursor = Number.isFinite(requestedCursor) ? Math.max(0, Math.trunc(requestedCursor)) : 0;
  socket.on('close', () => { closed = true; });
  socket.on('error', () => { closed = true; });
  socket.on('data', () => { /* client frames are intentionally ignored in the read-only VS6A stream */ });
  writeWsFrame(socket, JSON.stringify({ type: 'snapshot', run, cursor }));
  while (!closed) {
    const events = await runtime.workspace.listEvents({ adminId: authContext.admin.id, runId, afterSequence: cursor });
    for (const event of events) {
      if (closed) break;
      cursor = Math.max(cursor, event.sequence);
      writeWsFrame(socket, JSON.stringify({ type: 'event', cursor, event }));
    }
    if (isTerminalRunStatus(run.status) && events.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const latest = await runtime.workspace.getRun({ adminId: authContext.admin.id, runId });
    run.status = latest.status;
    run.updatedAt = latest.updatedAt;
    run.finishedAt = latest.finishedAt;
    run.startedAt = latest.startedAt;
    run.steps = latest.steps;
    run.resultSummary = latest.resultSummary;
    run.errorCode = latest.errorCode;
  }
  if (!closed) socket.end();
}

function writeWsFrame(socket: Duplex, payload: string): void {
  const body = Buffer.from(payload);
  let header: Buffer;
  if (body.length < 126) header = Buffer.from([0x81, body.length]);
  else if (body.length < 65_536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(body.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
  socket.write(Buffer.concat([header, body]));
}

function requireIdempotencyKey(ctx: RequestContext): string { const key = ctx.headers['idempotency-key']; if (!key) throw new ServiceError(400, 'VALIDATION_FAILED', 'Idempotency-Key header is required'); return key; }
async function mutation(runtime: AppRuntime, ctx: RequestContext, authContext: AuthContext, accountId: string | undefined, handler: () => Promise<{ statusCode: number; body: unknown }>): Promise<{ statusCode: number; body: unknown }> {
  const key = requireIdempotencyKey(ctx);
  const scope = `${authContext.admin.id}:${accountId ?? 'global'}:${ctx.method}:${ctx.path}`;
  const result = await idempotent(runtime.store, { scope, key, fingerprint: fingerprint(ctx.method, ctx.path, { body: ctx.body, ifMatchVersion: ctx.headers['if-match-version'] ?? null }), traceId: ctx.traceId, handler });
  return { statusCode: result.statusCode, body: result.body };
}
function setSessionCookies(response: ServerResponse, csrfToken: string, sessionId: string, secure: boolean): void { setCookie(response, 'session_id', sessionId, { httpOnly: true, secure }); setCookie(response, 'csrf_token', csrfToken, { secure }); }

function connectionView(account: { status: string; lastConnectedAt?: string }) {
  const status = account.status === 'connected'
    ? 'online'
    : account.status === 'pending'
      ? 'connecting'
      : account.status === 'expired'
        ? 'expired'
        : account.status === 'degraded'
          ? 'unknown'
          : 'offline';
  return {
    status,
    lastConnectedAt: account.lastConnectedAt,
    failureCode: account.status === 'degraded' ? 'ADAPTER_UNKNOWN' : undefined,
    failureMessage: account.status === 'degraded' ? '外部闲鱼连接结果未知，需要人工复核。' : undefined,
  };
}

function toQrSessionView(session: { id: string; accountId?: string; status: string; expiresAt: string; failureCode?: string }) {
  // Keep the historical login-session `id` field while exposing the
  // canonical QR-specific alias used by the new auth entry point.
  return { id: session.id, qrSessionId: session.id, accountId: session.accountId, status: session.status, expiresAt: session.expiresAt, pollAfterMs: 1500, errorCode: session.failureCode };
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function parsePublishMinor(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isSafeInteger(parsed)) throw new ServiceError(422, 'VALIDATION_FAILED', '金额必须是整数分');
  return parsed;
}

function parseOptionalPublishMinor(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return parsePublishMinor(value);
}

function parsePublishInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isSafeInteger(parsed)) throw new ServiceError(422, 'VALIDATION_FAILED', '库存数量必须是整数');
  return parsed;
}

function parsePublishPostageMode(value: unknown): import('./product-publish.js').ProductPostageMode {
  const normalized = String(value ?? '').trim();
  if (normalized === 'seller' || normalized === 'free') return 'free';
  if (normalized === 'buyer' || normalized === 'fixed') return 'fixed';
  if (normalized === 'distance' || normalized === 'none') return normalized;
  throw new ServiceError(422, 'VALIDATION_FAILED', '邮费模式无效');
}

function parsePublishLocation(value: unknown): import('./product-publish.js').ProductPublishLocationInput | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value as import('./product-publish.js').ProductPublishLocationInput;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as import('./product-publish.js').ProductPublishLocationInput : undefined;
  } catch {
    throw new ServiceError(422, 'VALIDATION_FAILED', '发货地字段格式无效');
  }
}

function readPublishImages(value: unknown): Array<{ filename: string; contentType: string; data: Buffer }> {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.filter((item): item is { filename?: unknown; contentType?: unknown; data: Buffer } => Boolean(item && typeof item === 'object' && Buffer.isBuffer((item as { data?: unknown }).data))).map((item) => ({ filename: String(item.filename ?? 'image'), contentType: String(item.contentType ?? 'application/octet-stream'), data: item.data }));
}

function parseProductListQuery(query: Record<string, string>): import('./domain.js').ProductListQuery {
  const page = query.page === undefined ? undefined : Number(query.page);
  const pageSize = query.pageSize === undefined ? undefined : Number(query.pageSize);
  return {
    keyword: optionalString(query.keyword),
    accountId: optionalString(query.accountId),
    status: optionalString(query.status) as import('./domain.js').ProductListQuery['status'],
    sortBy: optionalString(query.sortBy) as import('./domain.js').ProductListQuery['sortBy'],
    sortOrder: optionalString(query.sortOrder) as import('./domain.js').ProductListQuery['sortOrder'],
    page: page === undefined || Number.isNaN(page) ? page : Math.trunc(page),
    pageSize: pageSize === undefined || Number.isNaN(pageSize) ? pageSize : Math.trunc(pageSize),
  };
}

function parseOrderListQuery(query: Record<string, string>): import('./domain.js').OrderListQuery {
  const page = query.page === undefined ? undefined : Number(query.page);
  const pageSize = query.pageSize === undefined ? undefined : Number(query.pageSize);
  return {
    accountId: optionalString(query.accountId),
    keyword: optionalString(query.keyword),
    paymentStatus: optionalString(query.paymentStatus) as import('./domain.js').OrderListQuery['paymentStatus'],
    orderStatus: optionalString(query.orderStatus) as import('./domain.js').OrderListQuery['orderStatus'],
    deliveryStatus: optionalString(query.deliveryStatus) as import('./domain.js').OrderListQuery['deliveryStatus'],
    afterSalesStatus: optionalString(query.afterSalesStatus) as import('./domain.js').OrderListQuery['afterSalesStatus'],
    sortBy: optionalString(query.sortBy) as import('./domain.js').OrderListQuery['sortBy'],
    sortOrder: optionalString(query.sortOrder) as import('./domain.js').OrderListQuery['sortOrder'],
    page: page === undefined || Number.isNaN(page) ? page : Math.trunc(page),
    pageSize: pageSize === undefined || Number.isNaN(pageSize) ? pageSize : Math.trunc(pageSize),
  };
}

function parseAccountListQuery(query: Record<string, string>): import('./domain.js').AccountListQuery {
  const page = query.page === undefined ? undefined : Number(query.page);
  const pageSize = query.pageSize === undefined ? undefined : Number(query.pageSize);
  return {
    search: optionalString(query.search),
    status: optionalString(query.status) as import('./domain.js').AccountListQuery['status'],
    connectionStatus: optionalString(query.connectionStatus) as import('./domain.js').AccountListQuery['connectionStatus'],
    page: page === undefined || Number.isNaN(page) ? page : Math.trunc(page),
    pageSize: pageSize === undefined || Number.isNaN(pageSize) ? pageSize : Math.trunc(pageSize),
  };
}

function parseCouponBatchListQuery(query: Record<string, string>): import('./domain.js').CouponBatchListQuery {
  const page = query.page === undefined ? undefined : Number(query.page);
  const pageSize = query.pageSize === undefined ? undefined : Number(query.pageSize);
  return {
    accountId: optionalString(query.accountId),
    keyword: optionalString(query.keyword),
    status: optionalString(query.status) as import('./domain.js').CouponBatchListQuery['status'],
    purpose: optionalString(query.purpose) as import('./domain.js').CouponBatchListQuery['purpose'],
    sortBy: optionalString(query.sortBy) as import('./domain.js').CouponBatchListQuery['sortBy'],
    sortOrder: optionalString(query.sortOrder) as import('./domain.js').CouponBatchListQuery['sortOrder'],
    page: page === undefined || Number.isNaN(page) ? page : Math.trunc(page),
    pageSize: pageSize === undefined || Number.isNaN(pageSize) ? pageSize : Math.trunc(pageSize),
  };
}

function parseConversationListQuery(query: Record<string, string>): import('./domain.js').ConversationListQuery {
  const cursor = query.cursor === undefined ? undefined : query.cursor;
  const limit = query.limit === undefined ? undefined : Number(query.limit);
  const refreshExternal = query.refreshExternal === undefined ? undefined : query.refreshExternal !== 'false';
  return { accountId: optionalString(query.accountId), cursor, limit: limit === undefined || Number.isNaN(limit) ? limit : Math.trunc(limit), refreshExternal };
}

function parseMessageListQuery(query: Record<string, string>): import('./domain.js').MessageListQuery {
  const cursor = query.cursor === undefined ? undefined : Number(query.cursor);
  const beforeCursor = query.beforeCursor === undefined ? undefined : query.beforeCursor;
  const limit = query.limit === undefined ? undefined : Number(query.limit);
  const refreshExternal = query.refreshExternal === undefined ? undefined : query.refreshExternal !== 'false';
  return { cursor: cursor === undefined || Number.isNaN(cursor) ? cursor : Math.trunc(cursor), beforeCursor, limit: limit === undefined || Number.isNaN(limit) ? limit : Math.trunc(limit), refreshExternal };
}

function parseAutoReplyRunListQuery(query: Record<string, string>): import('./domain.js').AutoReplyRunListQuery {
  const page = query.page === undefined ? undefined : Number(query.page);
  const pageSize = query.pageSize === undefined ? undefined : Number(query.pageSize);
  return {
    accountId: optionalString(query.accountId),
    from: optionalString(query.from),
    to: optionalString(query.to),
    status: optionalString(query.status) as import('./domain.js').AutoReplyRunListQuery['status'],
    decision: optionalString(query.decision) as import('./domain.js').AutoReplyRunListQuery['decision'],
    processing: query.processing === 'true',
    stage: optionalString(query.stage) as import('./domain.js').AutoReplyRunListQuery['stage'],
    keyword: optionalString(query.keyword),
    page: page === undefined || Number.isNaN(page) ? page : Math.trunc(page),
    pageSize: pageSize === undefined || Number.isNaN(pageSize) ? pageSize : Math.trunc(pageSize),
  };
}

async function handleConversationUpgrade(runtime: AppRuntime, wsServer: WebSocketServer, request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const match = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/events$/);
  if (!match) { socket.destroy(); return; }
  const origin = request.headers.origin;
  if (!origin || !runtime.config.webSocketAllowedOrigins.includes(origin)) { rejectUpgrade(socket, 403, 'origin forbidden'); return; }
  const cookies = parseCookies(request.headers.cookie);
  const authContext = await runtime.auth.contextFromSession(cookies.session_id);
  if (!authContext) { rejectUpgrade(socket, 401, 'session required'); return; }
  const conversationId = decodeURIComponent(match[1]);
  try {
    await runtime.messages.getConversation(authContext.admin.id, conversationId);
  } catch (error) {
    const status = error instanceof ServiceError ? error.statusCode : 404;
    rejectUpgrade(socket, status, status === 403 ? 'forbidden' : 'conversation not found');
    return;
  }
  const rawCursor = Number(url.searchParams.get('cursor') ?? '0');
  const cursor = Number.isSafeInteger(rawCursor) && rawCursor >= 0 ? rawCursor : 0;
  Object.assign(request, { __xianyuConversationContext: { adminId: authContext.admin.id, conversationId, cursor } });
  wsServer.handleUpgrade(request, socket, head, (client) => wsServer.emit('connection', client, request));
}

async function attachConversationSocket(runtime: AppRuntime, socket: WebSocket, _request: IncomingMessage, context: { adminId: string; conversationId: string; cursor: number }): Promise<void> {
  let sentCursor = context.cursor;
  let ready = false;
  let queue: import('./messages.js').RealtimeEventVM[] = [];
  const unsubscribe = runtime.messages.realtime.subscribe(context.conversationId, (event) => {
    if (!ready) { queue.push(event); return; }
    if (event.cursor <= sentCursor || event.eventId === '') return;
    sentCursor = event.cursor;
    sendSocketEvent(socket, event);
  });
  socket.on('close', unsubscribe);
  socket.on('error', unsubscribe);
  try {
    if (socket.readyState !== WebSocket.OPEN) return;
    const backlog = await runtime.messages.listEvents(context.adminId, context.conversationId, context.cursor, 200);
    for (const event of backlog) {
      if (event.cursor <= sentCursor) continue;
      sentCursor = event.cursor;
      sendSocketEvent(socket, event);
    }
    ready = true;
    const pending = queue;
    queue = [];
    for (const event of pending.sort((left, right) => left.cursor - right.cursor)) {
      if (event.cursor <= sentCursor) continue;
      sentCursor = event.cursor;
      sendSocketEvent(socket, event);
    }
    if (socket.readyState === WebSocket.OPEN) sendSocketEvent(socket, { eventId: `connection:${context.conversationId}:${Date.now()}`, conversationId: context.conversationId, accountId: (await runtime.messages.getConversation(context.adminId, context.conversationId)).accountId, cursor: sentCursor, type: 'chat.connection.changed', occurredAt: new Date().toISOString(), traceId: `ws:${context.conversationId}`, payload: { status: 'connected', cursor: sentCursor } });
  } catch {
    if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'realtime unavailable');
    unsubscribe();
  }
}

function sendSocketEvent(socket: WebSocket, event: import('./messages.js').RealtimeEventVM): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = `${message}\n`;
  socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not Found'}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  socket.destroy();
}

function parseExpectedProductVersion(ctx: RequestContext): number {
  const raw = ctx.headers['if-match-version'] ?? ctx.body.expectedVersion;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1) throw new ServiceError(422, 'VALIDATION_FAILED', 'If-Match-Version or expectedVersion must be a positive integer');
  return value;
}

type ProductView = Omit<ProductRecord, 'attributes'> & { attributesJson: Record<string, unknown> };

function toProductListView(result: ProductListResult): Omit<ProductListResult, 'items'> & { items: ProductView[] } {
  return { ...result, items: result.items.map(toProductView) };
}

function toProductView(product: ProductRecord): ProductView {
  const { attributes, ...rest } = product;
  return { ...rest, attributesJson: attributes };
}

function readCookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

async function hydrateAccountProfile(input: { accounts: AccountService; xianyu: XianyuMtopClient; adminId: string; accountId: string; fallbackSellerRef: string; requestId: string; traceId: string }): Promise<void> {
  const profile = await input.xianyu.fetchProfile(input.adminId, input.accountId);
  if (!profile.success || !profile.response) return;
  const displayName = firstProfileString(profile.response, ['userNick', 'nickname', 'nick', 'displayName', 'userName', 'username']) ?? input.fallbackSellerRef;
  const sellerRef = firstProfileString(profile.response, ['userId', 'sellerId', 'accountId', 'unb']) ?? input.fallbackSellerRef;
  const remark = firstProfileString(profile.response, ['remark', 'shopName', 'userDesc']);
  const avatarUrl = firstProfileString(profile.response, ['avatarUrl', 'avatar', 'headPic', 'userAvatar']);
  const platformUserId = firstProfileString(profile.response, ['userId', 'sellerId', 'accountId', 'unb']);
  await input.accounts.update({ adminId: input.adminId, accountId: input.accountId, patch: { sellerRef, displayName, remark, avatarUrl, platformUserId }, requestId: input.requestId, traceId: input.traceId });
}

function firstProfileString(root: unknown, keys: string[]): string | undefined {
  const expected = new Set(keys.map((key) => key.toLowerCase()));
  const queue: unknown[] = [root];
  const visited = new Set<object>();
  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== 'object') continue;
    if (visited.has(value)) continue;
    visited.add(value);
    for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
      if (expected.has(key.toLowerCase()) && typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      if (candidate && typeof candidate === 'object') queue.push(candidate);
    }
  }
  return undefined;
}

function readCredentialMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => typeof item === 'string').map(([key, item]) => [key, String(item)]));
}

function readAutoReplyAgentPatch(body: Record<string, unknown>): import('./domain.js').AutoReplyAgentConfigPatch {
  const patch: import('./domain.js').AutoReplyAgentConfigPatch = {};
  const booleanFields = ['enabled'] as const;
  const stringFields = ['systemPrompt', 'userPromptTemplate', 'sendMode'] as const;
  const numberFields = ['maxLoops', 'maxToolCalls', 'toolTimeoutMs', 'totalTimeoutMs', 'maxHistory', 'maxReplyLength', 'replySegmentDelayMs', 'debounceMs', 'sendDelaySeconds'] as const;
  for (const field of booleanFields) if (typeof body[field] === 'boolean') patch[field] = body[field] as never;
  for (const field of stringFields) if (typeof body[field] === 'string') patch[field] = body[field] as never;
  for (const field of numberFields) if (typeof body[field] === 'number') patch[field] = body[field] as never;
  return patch;
}

function readOpenAiConfigInput(body: Record<string, unknown>): import('./openai-settings.js').OpenAIConfigBody {
  const role = body.role === 'backup' ? 'backup' : 'primary';
  const wireApi = body.wireApi === 'chat' ? 'chat' : 'responses';
  return {
    configId: typeof body.configId === 'string' && body.configId.trim() ? body.configId.trim() : undefined,
    role,
    provider: String(body.provider ?? ''),
    alias: String(body.alias ?? (role === 'primary' ? 'primary' : 'backup')),
    label: typeof body.label === 'string' ? body.label : undefined,
    baseUrl: String(body.baseUrl ?? ''),
    model: String(body.model ?? ''),
    reasoningEffort: typeof body.reasoningEffort === 'string' ? body.reasoningEffort : undefined,
    wireApi,
    timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : Number(body.timeoutMs ?? NaN),
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : Number(body.expectedVersion ?? NaN),
  };
}

function readCouponMetadata(value: unknown): import('./domain.js').CouponBatchMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const metadata: import('./domain.js').CouponBatchMetadata = {};
  if (typeof source.description === 'string') metadata.description = source.description;
  if (typeof source.delaySeconds === 'number' && Number.isFinite(source.delaySeconds)) metadata.delaySeconds = Math.max(0, Math.trunc(source.delaySeconds));
  if (typeof source.useNoLogisticsForm === 'boolean') metadata.useNoLogisticsForm = source.useNoLogisticsForm;
  if (typeof source.dockable === 'boolean') metadata.dockable = source.dockable;
  if (typeof source.price === 'string') metadata.price = source.price;
  if (source.feePayer === 'distributor' || source.feePayer === 'dealer') metadata.feePayer = source.feePayer;
  if (typeof source.minPrice === 'string') metadata.minPrice = source.minPrice;
  if (source.dockVisibility === 'public' || source.dockVisibility === 'dealer_only') metadata.dockVisibility = source.dockVisibility;
  if (typeof source.multiSpec === 'boolean') metadata.multiSpec = source.multiSpec;
  if (typeof source.specName === 'string') metadata.specName = source.specName;
  if (typeof source.specValue === 'string') metadata.specValue = source.specValue;
  if (typeof source.textContent === 'string') metadata.textContent = source.textContent;
  if (typeof source.dataContent === 'string') metadata.dataContent = source.dataContent;
  if (source.apiConfig && typeof source.apiConfig === 'object' && !Array.isArray(source.apiConfig)) {
    const api = source.apiConfig as Record<string, unknown>;
    if (typeof api.url === 'string' && (api.method === 'GET' || api.method === 'POST')) metadata.apiConfig = { url: api.url, method: api.method, timeout: typeof api.timeout === 'number' ? api.timeout : undefined, headers: typeof api.headers === 'string' ? api.headers : undefined, params: typeof api.params === 'string' ? api.params : undefined, responseField: typeof api.responseField === 'string' ? api.responseField : undefined };
  }
  if (Array.isArray(source.imageUrls)) metadata.imageUrls = source.imageUrls.filter((item): item is string => typeof item === 'string').slice(0, 3);
  return metadata;
}

function mapQrStatusToLoginStatus(status: string): 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required' | undefined {
  if (['waiting', 'scanned', 'succeeded', 'expired', 'failed', 'cancelled', 'verification_required'].includes(status)) return status as 'waiting' | 'scanned' | 'succeeded' | 'expired' | 'failed' | 'cancelled' | 'verification_required';
  return undefined;
}

function credentialMutationView(credential: { id: string; accountId: string; platform: string; status: string; cookieHeader?: string; accessToken?: string; deviceId?: string; metadata: Record<string, string>; expiresAt?: string; lastVerifiedAt?: string; createdAt: string; updatedAt: string }) {
  return {
    id: credential.id,
    accountId: credential.accountId,
    platform: credential.platform,
    status: credential.status,
    fields: { cookieHeader: Boolean(credential.cookieHeader), accessToken: Boolean(credential.accessToken), deviceId: Boolean(credential.deviceId), metadataKeys: Object.keys(credential.metadata) },
    expiresAt: credential.expiresAt,
    lastVerifiedAt: credential.lastVerifiedAt,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}
