import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const productsCss = readFileSync(fileURLToPath(new URL('./products.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('product table typography', () => {
  it('uses a 14px table baseline with explicit hierarchy exceptions', () => {
    expect(productsCss).toMatch(/\.products-row\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/\.products-head\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-title strong\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-title small, \.products-meta, \.products-account\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-coupons, \.products-ai-prompt, \.products-placeholder\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/\.products-pagination\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-page-button\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.45;/s);
    expect(productsCss).not.toMatch(/\.products-title small, \.products-meta, \.products-account\s*\{[^}]*font-size:\s*10px;/s);
  });
});
