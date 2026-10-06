export type AutoReplyProductSearchMode = 'catalog' | 'exact_phrase' | 'core_terms';

export function normalizeProductSearchText(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

/**
 * Catalog searches should tolerate the punctuation and spacing differences
 * commonly introduced when a product title is copied from chat or Xianyu.
 */
export function normalizeProductCatalogSearchText(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '');
}

/**
 * Core terms are selected by the Agent. The backend only normalizes and
 * deduplicates the terms so the same query works in memory and PostgreSQL.
 */
export function normalizeProductSearchTerms(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    const normalized = normalizeProductSearchText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(normalized);
  }
  return terms.slice(0, 8);
}

/**
 * Accepts the Agent's retry form when it sends core terms in one string,
 * e.g. "夸克 自动化". It intentionally does not attempt Chinese word
 * segmentation; that decision belongs to the Agent/tool caller.
 */
export function splitProductSearchTerms(value: string | undefined): string[] {
  if (!value) return [];
  return normalizeProductSearchTerms(value.split(/[\s,，、;；|/]+/g));
}

export function productSearchScore(fields: readonly string[], terms: readonly string[]): number {
  return terms.reduce((score, term) => score + (fields.some((field) => field.includes(term)) ? 1 : 0), 0);
}
