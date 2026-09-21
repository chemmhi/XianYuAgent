import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sharedUiRoot = dirname(fileURLToPath(import.meta.url));
const featuresRoot = join(sharedUiRoot, '..', '..', 'features');

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return /\.(tsx|ts)$/.test(entry.name) && !/\.test\.(tsx|ts)$/.test(entry.name) ? [path] : [];
  });
}

function sourceWindows(source: string, tagName: 'input' | 'textarea') {
  return [...source.matchAll(new RegExp(`<${tagName}\\b`, 'g'))].map((match) => {
    const start = match.index ?? 0;
    const end = source.indexOf('>', start);
    return source.slice(start, end === -1 ? start + 800 : end + 1);
  });
}

describe('shared control usage architecture', () => {
  it('keeps search inputs behind SearchField', () => {
    const violations = listSourceFiles(featuresRoot)
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return /type\s*=\s*["']search["']/.test(source) ? [relative(featuresRoot, file)] : [];
      });

    expect(violations).toEqual([]);
  });

  it('keeps ordinary inputs and textareas behind shared field components', () => {
    const violations = listSourceFiles(featuresRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const relativePath = relative(featuresRoot, file);
      const fileViolations: string[] = [];

      for (const snippet of sourceWindows(source, 'input')) {
        // Checkbox and file controls have distinct semantics and remain native.
        if (/type\s*=\s*["'](?:checkbox|file)["']/.test(snippet)) continue;
        fileViolations.push(`${relativePath}: input`);
      }

      for (const snippet of sourceWindows(source, 'textarea')) {
        // The online-chat composer has selection/emoji behavior that requires its bespoke textarea.
        if (/messages-composer-input/.test(snippet)) continue;
        fileViolations.push(`${relativePath}: textarea`);
      }

      return fileViolations;
    });

    expect(violations).toEqual([]);
  });

  it('documents the online-chat composer as the only textarea exemption', () => {
    const messagesPath = join(featuresRoot, 'messages', 'components', 'MessagesPage.tsx');
    const source = readFileSync(messagesPath, 'utf8');
    const composerMatches = source.match(/<textarea\b[\s\S]*?messages-composer-input[\s\S]*?>/g) ?? [];

    expect(composerMatches).toHaveLength(1);
    expect(composerMatches[0]).toContain('aria-label="消息内容"');
    expect(composerMatches[0]).toContain('MESSAGES_COMPOSER_PLACEHOLDER');
  });

  it('keeps the shared SelectField as the only native-select owner', () => {
    const source = readFileSync(join(sharedUiRoot, 'SelectField.tsx'), 'utf8');
    expect((source.match(/<select\b/g) ?? []).length).toBe(1);

    const violations = listSourceFiles(featuresRoot)
      .flatMap((file) => /<select\b/.test(readFileSync(file, 'utf8')) ? [relative(featuresRoot, file)] : []);
    expect(violations).toEqual([]);
  });
});
