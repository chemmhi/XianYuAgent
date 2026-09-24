import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const productsCss = readFileSync(fileURLToPath(new URL('./products.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const ordersCss = readFileSync(fileURLToPath(new URL('../../orders/components/orders.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('product table typography', () => {
  it('matches the order-management table scale and keeps explicit hierarchy', () => {
    expect(ordersCss).toMatch(/\.orders-row\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(ordersCss).toMatch(/\.orders-head\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.5;/s);
    expect(ordersCss).toMatch(/\.orders-row small\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(ordersCss).toMatch(/\.orders-status\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(ordersCss).toContain('.btn-small{min-height:28px;padding:5px 8px;font-size:13px;line-height:1.45}');
    expect(productsCss).toMatch(/\.products-row\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-table \.products-row\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-table \.products-head\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-title strong\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-title small,[\s\S]*?font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-coupons,[\s\S]*?font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-coupons,[\s\S]*?\.products-knowledge-base,[\s\S]*?font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.ui-placeholder-cell\.products-placeholder\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.products-status\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-domain \.btn,[\s\S]*?font-size:\s*13px;[^}]*line-height:\s*1\.45;/s);
    expect(productsCss).toMatch(/\.products-pagination\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-page-button\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.45;/s);
    expect(productsCss).not.toMatch(/body \.app-viewport \.products-domain \.products-table \.products-row\s*\{[^}]*font-size:\s*10px;/s);
  });
});
