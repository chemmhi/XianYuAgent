import Fuse from 'fuse.js';
import { RE2 } from 're2-wasm';

export type SkillSearchMode = 'literal' | 'fuzzy' | 'regex';

export interface SkillTextMatch {
  line: number;
  excerpt: string;
}

export interface SkillTextSearchOptions {
  offset?: number;
  limit?: number;
}

export interface SkillTextSearchResult {
  matches: SkillTextMatch[];
  hasMore: boolean;
  nextOffset?: number;
}

const DEFAULT_MAX_MATCHES = 3;
const MAX_SEARCH_MATCHES = 100;
const MAX_EXCERPT_CHARS = 500;

export function searchSkillText(body: string, query: string, mode: SkillSearchMode, options: SkillTextSearchOptions = {}): SkillTextSearchResult {
  const lines = body.split(/\r?\n/);
  const offset = Number.isInteger(options.offset) && (options.offset ?? 0) >= 0 ? Math.trunc(options.offset!) : 0;
  const requestedLimit = Number.isInteger(options.limit) && (options.limit ?? 0) > 0 ? Math.trunc(options.limit!) : DEFAULT_MAX_MATCHES;
  const limit = Math.min(MAX_SEARCH_MATCHES, requestedLimit);
  const requiredHits = offset + limit + 1;
  const hits: Array<{ index: number; focus: number }> = [];
  if (mode === 'fuzzy') {
    const fuse = new Fuse(lines, { includeMatches: true, ignoreLocation: true, threshold: 0.4 });
    for (const result of fuse.search(query, { limit: requiredHits })) {
      hits.push({ index: result.refIndex, focus: result.matches?.[0]?.indices[0]?.[0] ?? 0 });
    }
  } else {
    const matcher = mode === 'regex' ? new RE2(query, 'iu') : undefined;
    const needle = query.toLocaleLowerCase();
    for (let index = 0; index < lines.length && hits.length < requiredHits; index += 1) {
      const focus = matcher ? matcher.exec(lines[index])?.index ?? -1 : lines[index].toLocaleLowerCase().indexOf(needle);
      if (focus >= 0) hits.push({ index, focus });
    }
  }
  const visible = hits.slice(offset, offset + limit);
  const hasMore = hits.length > offset + limit;
  return {
    matches: visible.map(({ index, focus }) => {
      const line = lines[index];
      const start = Math.max(0, Math.min(focus - 80, Math.max(0, line.length - MAX_EXCERPT_CHARS)));
      const current = line.slice(start, start + MAX_EXCERPT_CHARS);
      const previous = index > 0 ? lines[index - 1].slice(-100) : '';
      const next = index + 1 < lines.length ? lines[index + 1].slice(0, 100) : '';
      return { line: index + 1, excerpt: [previous, current, next].filter(Boolean).join('\n') };
    }),
    hasMore,
    ...(hasMore ? { nextOffset: offset + limit } : {}),
  };
}
