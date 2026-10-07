import Fuse from 'fuse.js';
import { RE2 } from 're2-wasm';

export type SkillSearchMode = 'literal' | 'fuzzy' | 'regex';

export interface SkillTextMatch {
  line: number;
  excerpt: string;
}

const MAX_MATCHES = 3;
const MAX_EXCERPT_CHARS = 500;

export function searchSkillText(body: string, query: string, mode: SkillSearchMode): { matches: SkillTextMatch[]; hasMore: boolean } {
  const lines = body.split(/\r?\n/);
  const hits: Array<{ index: number; focus: number }> = [];
  if (mode === 'fuzzy') {
    const fuse = new Fuse(lines, { includeMatches: true, ignoreLocation: true, threshold: 0.4 });
    for (const result of fuse.search(query, { limit: MAX_MATCHES + 1 })) {
      hits.push({ index: result.refIndex, focus: result.matches?.[0]?.indices[0]?.[0] ?? 0 });
    }
  } else {
    const matcher = mode === 'regex' ? new RE2(query, 'iu') : undefined;
    const needle = query.toLocaleLowerCase();
    for (let index = 0; index < lines.length && hits.length <= MAX_MATCHES; index += 1) {
      const focus = matcher ? matcher.exec(lines[index])?.index ?? -1 : lines[index].toLocaleLowerCase().indexOf(needle);
      if (focus >= 0) hits.push({ index, focus });
    }
  }
  return {
    matches: hits.slice(0, MAX_MATCHES).map(({ index, focus }) => {
      const line = lines[index];
      const start = Math.max(0, Math.min(focus - 80, line.length - MAX_EXCERPT_CHARS));
      const current = line.slice(start, start + MAX_EXCERPT_CHARS);
      const previous = index > 0 ? lines[index - 1].slice(-100) : '';
      const next = index + 1 < lines.length ? lines[index + 1].slice(0, 100) : '';
      return { line: index + 1, excerpt: [previous, current, next].filter(Boolean).join('\n') };
    }),
    hasMore: hits.length > MAX_MATCHES,
  };
}
