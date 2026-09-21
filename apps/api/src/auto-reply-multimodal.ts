import type { AutoReplyContext } from './auto-reply.js';
import type { ModelMessageContent, ModelMessageContentPart } from './pi-runtime.js';

const MAX_MEDIA_PARTS = 4;

export function buildAutoReplyModelContent(text: string, context: AutoReplyContext): ModelMessageContent {
  const parts: ModelMessageContentPart[] = [{ type: 'text', text }];
  const mediaRefs = new Set<string>();

  addMediaRef(mediaRefs, context.inboundMessage.bodyType, context.inboundMessage.bodyRef);
  for (const message of context.recentMessages) addMediaRef(mediaRefs, message.bodyType, message.bodyRef);
  addMediaRef(mediaRefs, 'image', context.conversation.itemImageUrl);
  for (const imageUrl of productImageUrls(context.product?.attributes)) addMediaRef(mediaRefs, 'image', imageUrl);

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
  addMediaRef(refs, 'image', context.conversation.itemImageUrl);
  for (const imageUrl of productImageUrls(context.product?.attributes)) addMediaRef(refs, 'image', imageUrl);
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

function productImageUrls(attributes: Record<string, unknown> | undefined): string[] {
  if (!attributes) return [];
  const xianyu = record(attributes.xianyu);
  return [
    ...stringArray(xianyu.imageUrls),
    ...stringArray(xianyu.imageUrl),
    ...stringArray(attributes.imageUrls),
    ...stringArray(attributes.imageUrl),
  ];
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
