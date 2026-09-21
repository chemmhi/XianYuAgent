import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHeuristicPersona,
  cleanConversationRows,
  redactText,
  type RawMessageRow,
} from './extract-seller-persona.ts';

function row(overrides: Partial<RawMessageRow> = {}): RawMessageRow {
  return {
    conversation_id: 'conversation-1',
    account_id: 'account-1',
    buyer_ref: 'buyer-1',
    buyer_display_name: '普通买家',
    item_ref: 'item-1',
    item_title: 'AI 课程',
    message_id: `message-${Math.random()}`,
    direction: 'inbound',
    sender_role: 'buyer',
    body_type: 'text',
    body_text: '你好',
    body_ref: null,
    redaction_state: 'visible',
    status: 'created',
    source: 'system',
    risk_flags: [],
    created_at: '2026-09-21T00:00:00.000Z',
    ...overrides,
  };
}

test('redactText masks personal contact data while preserving Chinese text', () => {
  const value = redactText('加我微信 abc_def，手机号 13812345678，链接 https://example.com/a');
  assert.equal(value, '加我[联系方式],手机号 [手机号],链接 [链接]');
});

test('cleanConversationRows keeps buyer source=system messages but removes AI/system boilerplate', () => {
  const rows: RawMessageRow[] = [
    row({ conversation_id: 'excluded', buyer_display_name: '一只橘喵喵亮晶晶' }),
    row({ message_id: 'buyer-1', body_text: '这个资料怎么安装？' }),
    row({ message_id: 'ai-1', direction: 'outbound', sender_role: 'agent', source: 'ai', body_text: '你好，已收到你的消息，我先结合商品信息帮你确认。' }),
    row({ message_id: 'seller-1', direction: 'outbound', sender_role: 'agent', source: 'human', body_text: '我可以远程帮你安装。' }),
    row({ message_id: 'system-1', sender_role: 'system', body_type: 'system', body_text: '[买家确认收货，交易成功]' }),
    row({ message_id: 'ack-1', direction: 'outbound', sender_role: 'agent', source: 'human', body_text: '好嘞' }),
  ];
  const result = cleanConversationRows(rows, { minRepeatConversations: 4 });
  assert.equal(result.conversations.length, 1);
  assert.deepEqual(result.conversations[0].messages.map((message) => message.text), ['这个资料怎么安装?', '我可以远程帮你安装。']);
  assert.equal(result.report.removedByReason.ai_reply, 1);
  assert.equal(result.report.removedByReason.system_sender, 1);
  assert.equal(result.report.excludedBuyers.includes('一只橘喵喵亮晶晶'), true);
});

test('repeated short seller replies are reported as boilerplate and excluded from persona examples', () => {
  const rows: RawMessageRow[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const conversationId = `conversation-${index}`;
    rows.push(row({ conversation_id: conversationId, message_id: `${conversationId}-buyer`, body_text: '想了解一下' }));
    rows.push(row({ conversation_id: conversationId, message_id: `${conversationId}-seller`, direction: 'outbound', sender_role: 'agent', source: 'human', body_text: '没问题宝' }));
    rows.push(row({ conversation_id: conversationId, message_id: `${conversationId}-seller-2`, direction: 'outbound', sender_role: 'agent', source: 'human', body_text: `这是第${index}个具体说明` }));
  }
  const result = cleanConversationRows(rows);
  assert.equal(result.report.sellerBoilerplate[0].text, '没问题宝');
  assert.equal(result.conversations.every((conversation) => !conversation.messages.some((message) => message.text === '没问题宝')), true);
});

test('heuristic persona includes seller identity and dataset signals', () => {
  const rows = [
    row({ message_id: 'buyer-1', body_text: '可以远程安装吗？' }),
    row({ message_id: 'seller-1', direction: 'outbound', sender_role: 'agent', source: 'human', body_text: '可以，我可以远程帮你处理环境问题。' }),
  ];
  const { conversations, report } = cleanConversationRows(rows);
  const persona = buildHeuristicPersona(conversations, report);
  assert.match(persona.description, /天津大学硕士研究生毕业/u);
  assert.match(persona.description, /大厂前端开发工程师/u);
  assert.match(persona.systemPrompt, /reply\/handoff JSON/u);
});
