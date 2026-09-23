import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const productsCss = readFileSync(fileURLToPath(new URL('./products.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('product table typography', () => {
  it('uses the approved compact product-table scale with explicit hierarchy exceptions', () => {
    expect(productsCss).toMatch(/\.products-row\s*\{[^}]*font-size:\s*11px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-table \.products-row\s*\{[^}]*font-size:\s*var\(--font-size-body\);[^}]*line-height:\s*var\(--font-line-body\);/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-table \.products-head\s*\{[^}]*font-size:\s*var\(--font-size-body-compact\);[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-title strong\s*\{[^}]*font-size:\s*var\(--font-size-card-title\);[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-title small,[\s\S]*?font-size:\s*var\(--font-size-meta\);[^}]*line-height:\s*var\(--font-line-meta\);/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-coupons,[\s\S]*?font-size:\s*var\(--font-size-meta\);[^}]*line-height:\s*var\(--font-line-meta\);/s);
    expect(productsCss).toMatch(/\.products-pagination\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-page-button\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.45;/s);
    expect(productsCss).not.toMatch(/body \.app-viewport \.products-domain \.products-table \.products-row\s*\{[^}]*font-size:\s*10px;/s);
  });
});
