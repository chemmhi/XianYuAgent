import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

async function waitForTerminal(runtime: ReturnType<typeof createApp>, adminId: string, runId: string): Promise<Awaited<ReturnType<typeof runtime.store.getRun>>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const bundle = await runtime.store.getRun(adminId, runId);
    if (bundle && ['succeeded', 'failed', 'cancelled', 'expired'].includes(bundle.run.status)) return bundle;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Workspace Pi run did not reach a terminal state');
}

test('Workspace Pi ignores account AutoReply Agent settings', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.endsWith('/v1/chat/completions')) {
      const rawBody = typeof init?.body === 'string' ? init.body : '';
      requests.push(rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {});
      return new Response([
        'data: {"model":"pi-isolation-model","choices":[{"delta":{"content":"PI_AGENT_OK"}}]}\n\n',
        'data: [DONE]\n\n',
      ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const runtime = createApp(loadConfig({
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: '',
    REDIS_URL: '',
    ALLOW_IN_MEMORY: 'true',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'pi',
    API_KEY: 'pi-isolation-key',
    BASE_URL: 'https://pi-isolation.example/v1',
    MODEL: 'pi-isolation-model',
    WIRE_API: 'chat',
    AUTO_REPLY_MODEL_ENABLED: 'false',
    AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0',
  }));
  try {
    await runtime.listen();
    const admin = await runtime.store.createAdmin({ email: `pi-isolation-${process.pid}@example.com`, passwordHash: 'hash', displayName: 'Pi Isolation' });
    const account = await runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `pi-isolation-${process.pid}` });
    const current = await runtime.autoReplyAgentSettings.get(admin.id, account.id);
    const updated = await runtime.autoReplyAgentSettings.update({
      adminId: admin.id,
      accountId: account.id,
      expectedVersion: current.configVersion,
      patch: {
        enabled: false,
        maxLoops: 1,
        maxToolCalls: 1,
        sendDelaySeconds: 86_400,
        systemPrompt: 'PI_AUTO_REPLY_SENTINEL_SHOULD_NOT_REACH_WORKSPACE',
      },
      requestId: 'pi-isolation-settings',
      traceId: 'pi-isolation-settings',
    });
    assert.equal(updated.enabled, false);
    assert.equal(updated.sendDelaySeconds, 86_400);

    const session = await runtime.store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Pi isolation' });
    const startedAt = Date.now();
    const started = await runtime.workspace.startRun({
      adminId: admin.id,
      accountId: account.id,
      sessionId: session.id,
      instruction: '请用模型讲一句关于猫的冷知识，不要读取商品或订单。',
      clientRunRef: 'pi-isolation-run',
      requestId: 'pi-isolation-run',
      traceId: 'pi-isolation-run',
    });
    const bundle = await waitForTerminal(runtime, admin.id, started.run.runId);
    const elapsedMs = Date.now() - startedAt;
    assert.ok(bundle);
    assert.equal(bundle.run.status, 'succeeded');
    assert.equal(bundle.run.resultSummary, 'PI_AGENT_OK');
    assert.ok(elapsedMs < 5_000, `Workspace Pi unexpectedly inherited AutoReply send delay: ${elapsedMs}ms`);
    assert.equal(requests.length, 1);
    const firstMessage = requests[0]?.messages;
    assert.equal(JSON.stringify(firstMessage).includes('PI_AUTO_REPLY_SENTINEL_SHOULD_NOT_REACH_WORKSPACE'), false);
    assert.equal(JSON.stringify(firstMessage).includes('sendDelaySeconds'), false);
    assert.equal(JSON.stringify(firstMessage).includes('maxLoops'), false);
  } finally {
    await runtime.close();
    globalThis.fetch = originalFetch;
  }
});
