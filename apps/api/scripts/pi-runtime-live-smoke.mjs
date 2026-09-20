import assert from 'node:assert/strict';
import { loadConfig } from '../dist/config.js';
import { MemoryStore } from '../dist/store-memory.js';
import { OpenAICompatibleModelClient, PiRuntimeAdapter } from '../dist/pi-runtime.js';
import { WorkspaceService } from '../dist/workspace.js';

const config = loadConfig();
if (config.agentRuntime !== 'pi' || !config.modelApiKey || !config.modelBaseUrl || !config.modelName) {
  throw new Error('PI_LIVE_CONFIG_MISSING');
}

const store = new MemoryStore();
const admin = await store.createAdmin({ email: `pi-live-${Date.now()}@example.com`, passwordHash: 'test-only', displayName: 'Pi Live Smoke' });
const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `pi-live-${Date.now()}`, displayName: 'Pi Live Smoke Account' });
const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Pi live validation', summary: 'server-side OpenAI-compatible validation' });
const client = new OpenAICompatibleModelClient({ apiKey: config.modelApiKey, baseUrl: config.modelBaseUrl, model: config.modelName, timeoutMs: config.modelTimeoutMs });
const runtime = new PiRuntimeAdapter(store, client, { model: config.modelName, redactSecrets: [config.modelApiKey], persistUserMessage: false, messageSink: async (message) => {
  if (!message.adminId) return;
  await store.appendWorkspaceMessage({ adminId: message.adminId, sessionId: message.sessionId, runId: message.runId, type: message.messageType, content: message.content, summary: message.summary });
} });
const workspace = new WorkspaceService(store, runtime, async () => 'audit-pi-live-smoke');
const prompt = process.env.PI_LIVE_PROMPT?.trim() || '请用一句简短中文确认你已连接到 Workspace。';

try {
  const started = await workspace.startRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: prompt, clientRunRef: `pi-live-${Date.now()}`, requestId: 'pi-live-smoke', traceId: 'pi-live-smoke' });
  const deadline = Date.now() + config.modelTimeoutMs + 15_000;
  let bundle;
  while (Date.now() < deadline) {
    bundle = await store.getRun(admin.id, started.run.runId);
    if (bundle && ['succeeded', 'failed', 'cancelled', 'expired'].includes(bundle.run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(bundle, 'live run did not persist');
  assert.ok(['succeeded', 'failed'].includes(bundle.run.status), `unexpected live status: ${bundle.run.status}`);
  const messages = await store.listWorkspaceMessages(admin.id, session.id, 20);
  const serialized = JSON.stringify({ run: bundle.run, messages });
  assert.equal(serialized.includes(config.modelApiKey), false, 'API key leaked into persisted output');
  console.log(JSON.stringify({
    providerHost: new URL(config.modelBaseUrl).host,
    model: config.modelName,
    runtime: config.agentRuntime,
    runStatus: bundle.run.status,
    errorCode: bundle.run.errorCode ?? null,
    messageTypes: messages.map((message) => message.type),
    keyPrinted: false,
  }, null, 2));
  if (bundle.run.status !== 'succeeded') process.exitCode = 1;
} finally {
  runtime.stop();
}
