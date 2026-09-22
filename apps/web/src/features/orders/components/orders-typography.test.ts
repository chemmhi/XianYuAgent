import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ordersCss = readFileSync(fileURLToPath(new URL('./orders.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('order list and detail typography', () => {
  it('keeps order table cells readable with the shared type scale', () => {
    expect(ordersCss).toMatch(/\.orders-row\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;?/s);
    expect(ordersCss).toMatch(/\.orders-head\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-row small\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-order-link\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-order-link strong\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-buyer strong,\.orders-product strong\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-time\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-status\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.btn-small\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.45;?/s);
    expect(ordersCss).toMatch(/body \.app-viewport \.orders-domain \.orders-row-actions \.btn-small\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.45;?/s);
    expect(ordersCss).toMatch(/\.orders-pagination\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-page-button\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*1\.45;?/s);
    expect(ordersCss).not.toMatch(/\.orders-row\s*\{[^}]*font-size:\s*1[01]px;/s);
    expect(ordersCss).not.toMatch(/\.orders-row small\s*\{[^}]*font-size:\s*9px;/s);
  });

  it('keeps order detail drawer headings, body text, and metadata readable', () => {
    expect(ordersCss).toMatch(/\.orders-drawer-head \.eyebrow\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/body \.app-viewport \.orders-drawer-head h2\s*\{[^}]*font-size:\s*20px;[^}]*line-height:\s*1\.35;?/s);
    expect(ordersCss).toMatch(/body \.app-viewport \.orders-drawer-head p\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-drawer-state\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;?/s);
    expect(ordersCss).toMatch(/\.orders-drawer-body h3\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-detail-muted\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-status-cell>span\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-detail-list>div\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;?/s);
    expect(ordersCss).toMatch(/\.orders-detail-list dt\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-detail-list dd\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;?/s);
    expect(ordersCss).toMatch(/\.orders-detail-list dd small\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-risk-note strong\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-risk-note p\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;?/s);
    expect(ordersCss).toMatch(/\.orders-risk-note small\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-audit-line\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).toMatch(/\.orders-drawer-state strong\s*\{[^}]*font-size:\s*15px;[^}]*line-height:\s*1\.5;?/s);
    expect(ordersCss).not.toMatch(/\.orders-detail-list dd small\s*\{[^}]*font-size:\s*9px;/s);
    expect(ordersCss).not.toMatch(/\.orders-risk-note small\s*\{[^}]*font-size:\s*9px;/s);
  });
});
