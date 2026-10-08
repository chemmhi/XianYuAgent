import type { AutoReplyGeneratedReply } from './auto-reply.js';
import type { ModelStructuredOutput } from './pi-runtime.js';

export const AUTO_REPLY_STRUCTURED_OUTPUT: ModelStructuredOutput = {
  name: 'auto_reply_decision',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      decision: { type: 'string', enum: ['reply', 'skip', 'handoff'] },
      text: { type: 'string' },
      reason: { type: 'string' },
      segments: { type: 'array', items: { type: 'string' } },
    },
    required: ['decision', 'text', 'reason', 'segments'],
  },
};

export type AutoReplyModelDecision =
  | { decision: 'reply'; reply: AutoReplyGeneratedReply }
  | { decision: 'skip'; reason: string }
  | { decision: 'handoff'; reason: string };

export function parseAutoReplyModelDecision(content: string): AutoReplyModelDecision | undefined {
  const parsed = parseJsonObject(content);
  if (!parsed || (parsed.decision !== 'reply' && parsed.decision !== 'skip' && parsed.decision !== 'handoff')) return undefined;
  if (parsed.decision === 'skip') {
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim().slice(0, 500) : '当前消息已被上一轮回复覆盖';
    return { decision: 'skip', reason };
  }
  if (parsed.decision === 'handoff') {
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 500)
      : '模型判断当前问题需要人工处理';
    return { decision: 'handoff', reason };
  }
  const text = typeof parsed.text === 'string' ? parsed.text : undefined;
  if (!text?.trim()) return undefined;
  if (parsed.segments !== undefined && (!Array.isArray(parsed.segments) || parsed.segments.some((segment) => typeof segment !== 'string'))) return undefined;
  return { decision: 'reply', reply: { text, segments: Array.isArray(parsed.segments) ? parsed.segments as string[] : undefined } };
}

export function parseJsonObject(content: string): Record<string, unknown> | undefined {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
