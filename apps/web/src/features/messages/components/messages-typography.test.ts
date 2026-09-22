import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const messagesCss = readFileSync(fileURLToPath(new URL('./messages.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('messages typography hierarchy', () => {
  it('keeps the current platform session list readable', () => {
    expect(messagesCss).toMatch(/\.messages-search\s*\{[\s\S]*?max-width:\s*none;[\s\S]*?align-self:\s*stretch;/);
    expect(messagesCss).toContain('grid-template-columns: 44px minmax(0, 1fr) 64px;');
    expect(messagesCss).toMatch(/\.messages-conversation-copy strong\s*\{[\s\S]*?font-size:\s*14px;/);
    expect(messagesCss).toMatch(/\.messages-conversation-copy small,[\s\S]*?\.messages-conversation-meta small\s*\{[\s\S]*?font-size:\s*12px;/);
  });

  it('distinguishes message body, source label, and unread state', () => {
    expect(messagesCss).toMatch(/\.messages-bubble\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?line-height:\s*1\.6;/);
    expect(messagesCss).toMatch(/\.messages-source-label\s*\{[\s\S]*?font-size:\s*13px;[\s\S]*?font-weight:\s*700;/);
    expect(messagesCss).toMatch(/\.messages-read-state\s*\{[\s\S]*?font-size:\s*12px;[\s\S]*?font-weight:\s*800;/);
    expect(messagesCss).toContain('.messages-read-state.unread');
  });

  it('keeps composer controls and outbound links legible', () => {
    expect(messagesCss).toMatch(/\.messages-composer-assist-row\s*\{[\s\S]*?min-height:\s*36px;/);
    expect(messagesCss).toMatch(/\.messages-tool-button\s*\{[\s\S]*?width:\s*34px;[\s\S]*?height:\s*34px;[\s\S]*?font-size:\s*22px;/);
    expect(messagesCss).toMatch(/\.messages-ai-assist-label\s*\{[\s\S]*?font-size:\s*12px;/);
    expect(messagesCss).toMatch(/\.messages-composer-shortcuts\s*\{[\s\S]*?font-size:\s*12px;/);
    expect(messagesCss).toMatch(/\.messages-bubble\.outbound \.messages-link\s*\{[\s\S]*?color:\s*#fff;/);
  });
});
