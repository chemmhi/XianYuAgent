import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAutoReplyGodViewSink, sanitizeEvent, type AutoReplyGodViewEvent, type AutoReplyGodViewSink } from '../src/auto-reply-god-view.js';
import { ToolCallingAutoReplyAgent } from '../src/auto-reply-agent.js';
import { resolveAutoReplyAgentConfig } from '../src/auto-reply-agent-config.js';

test('god view redacts credentials but preserves buyer prompt and output text', () => {
  const event = sanitizeEvent({
    ts: '2026-09-23T00:00:00.000Z',
    phase: 'model',
    event: 'model.response',
    payload: {
      prompt: '请处理买家消息：还有货吗？',
      output: '有的，拍下后我会尽快发货。',
      apiKey: 'secret-key',
      headers: 'Authorization: Bearer abc123',
      image: 'data:image/png;base64,AAAA',
    },
  });

  assert.equal(event.payload.prompt, '请处理买家消息：还有货吗？');
  assert.equal(event.payload.output, '有的，拍下后我会尽快发货。');
  assert.equal(event.payload.apiKey, '[REDACTED]');
  assert.equal(event.payload.headers, 'Authorization: [REDACTED] [REDACTED]');
  assert.equal(event.payload.image, '[INLINE_IMAGE_REDACTED]');
});

test('god view sink waits for the local monitor flag before writing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xianyu-god-view-'));
  const tracePath = join(directory, 'trace.ndjson');
  const flagPath = join(directory, 'enable');
  const sink = createAutoReplyGodViewSink({ env: {}, filePath: tracePath, flagPath });
  const event = { phase: 'inbound' as const, event: 'inbound.received', payload: { bodyText: '你好' } };

  await sink.emit(event);
  assert.equal(existsSync(tracePath), false);
  await writeFile(flagPath, '', 'utf8');
  await sink.emit(event);
  const lines = (await readFile(tracePath, 'utf8')).trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]!).payload.bodyText, '你好');
});

test('god view sink ignores an unconfigured legacy flag path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xianyu-god-view-legacy-'));
  const tracePath = join(directory, 'trace.ndjson');
  const sink = createAutoReplyGodViewSink({ env: {}, filePath: tracePath });
  await sink.emit({ phase: 'inbound', event: 'inbound.received', payload: { bodyText: 'legacy flag must not enable tracing' } });
  assert.equal(existsSync(tracePath), false);
});

test('agent emits prompt, model output, and tool-capable run identifiers to god view', async () => {
  const events: Array<Omit<AutoReplyGodViewEvent, 'ts'>> = [];
  const sink: AutoReplyGodViewSink = { emit: async (event) => { events.push(event); } };
  const agent = new ToolCallingAutoReplyAgent({} as never, { supportsStructuredOutput: true, complete: async () => ({ model: 'god-view-test-model', content: JSON.stringify({ decision: 'reply', text: '已收到。' }) }) }, resolveAutoReplyAgentConfig({}), { godView: sink });

  await agent.generate({
    adminId: 'admin-1',
    runId: 'run-1',
    traceId: 'trace-1',
    classification: { intent: 'general', confidence: 0.9, decision: 'replied', riskFlags: [] },
    context: {
      conversation: { id: 'conversation-1', accountId: 'account-1', buyerRef: 'buyer-1', buyerDisplayName: '买家甲', itemRef: 'item-1', itemTitle: '资料包', handlingMode: 'ai' },
      inboundMessage: { id: 'message-1', conversationId: 'conversation-1', accountId: 'account-1', direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '还有货吗？' },
      recentMessages: [],
      orders: [],
    } as never,
  });

  assert.deepEqual(events.map((event) => event.event), ['agent.started', 'model.request', 'model.response', 'agent.decision']);
  assert.ok(events.every((event) => event.runId === 'run-1' && event.traceId === 'trace-1'));
  assert.match(JSON.stringify(events.find((event) => event.event === 'model.request')), /还有货吗/);
  assert.match(JSON.stringify(events.find((event) => event.event === 'model.response')), /已收到/);
});
