import type { ProductRecord } from './domain.js';
import { sanitizeKnowledgeText } from './product-knowledge-base-safety.js';

export interface ProductKnowledgeBaseRedactionDecision {
  changed: boolean;
  current: string;
  sanitized: string;
  removedChars: number;
}

export function decideProductKnowledgeBaseRedaction(product: Pick<ProductRecord, 'knowledgeBase'>): ProductKnowledgeBaseRedactionDecision {
  const current = product.knowledgeBase?.trim() ?? '';
  const sanitized = sanitizeKnowledgeText(current);
  return { changed: sanitized !== current, current, sanitized, removedChars: Math.max(0, current.length - sanitized.length) };
}
