import type { AutoReplyContext } from './auto-reply.js';
import type { ModelMessageContent, ModelMessageContentPart } from './pi-runtime.js';

const MAX_MEDIA_PARTS = 4;

export function buildAutoReplyModelContent(text: string, context: AutoReplyContext): ModelMessageContent {
  const parts: ModelMessageContentPart[] = [{ type: 'text', text }];
  const mediaRefs = new Set<string>();

  addMediaRef(mediaRefs, context.inboundMessage.bodyType, context.inboundMessage.bodyRef);
  for (const message of context.recentMessages) addMediaRef(mediaRefs, message.bodyType, message.bodyRef);
  for (const message of context.pendingBuyerMessages ?? []) addMediaRef(mediaRefs, message.bodyType, message.bodyRef);

  for (const url of [...mediaRefs].slice(0, MAX_MEDIA_PARTS)) {
    parts.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
  }
  return parts.length === 1 ? text : parts;
}

export function hasSupportedAutoReplyMedia(context: AutoReplyContext): boolean {
  return [...collectMediaRefs(context)].length > 0;
}

function collectMediaRefs(context: AutoReplyContext): Set<string> {
  const refs = new Set<string>();
  addMediaRef(refs, context.inboundMessage.bodyType, context.inboundMessage.bodyRef);
  for (const message of context.recentMessages) addMediaRef(refs, message.bodyType, message.bodyRef);
  for (const message of context.pendingBuyerMessages ?? []) addMediaRef(refs, message.bodyType, message.bodyRef);
  return refs;
}

function addMediaRef(target: Set<string>, bodyType: string | undefined, bodyRef: string | undefined): void {
  if (bodyType !== 'image' || !bodyRef) return;
  const normalized = bodyRef.trim();
  if (!normalized || normalized.length > 4_000) return;
  if (normalized.startsWith('data:image/')) {
    target.add(normalized);
    return;
  }
  try {
    const url = new URL(normalized);
    if (url.protocol === 'https:' || url.protocol === 'http:') target.add(url.toString());
  } catch {
    // Invalid media refs are ignored and the caller can fall back to handoff.
  }
}
