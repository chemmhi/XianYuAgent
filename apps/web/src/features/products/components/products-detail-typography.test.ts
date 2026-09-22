import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const productsCss = readFileSync(fileURLToPath(new URL('./products.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('product detail drawer typography', () => {
  it('keeps drawer body text readable while preserving title and metadata hierarchy', () => {
    expect(productsCss).toMatch(/\.products-detail-panel \.eyebrow\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-detail-panel h2\s*\{[^}]*font-size:\s*20px;/s);
    expect(productsCss).toMatch(/\.products-detail-state\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/\.products-detail-body h3\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-detail-body dt\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-detail-body dd\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/\.products-detail-panel \.xianyu-detail-subtitle\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-detail-panel \.xianyu-detail-source-note\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.xianyu-detail-body h3\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.xianyu-detail-stat span\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.xianyu-detail-list dt\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.xianyu-detail-list dd\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/\.xianyu-seller-card strong\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.xianyu-seller-card > div > span\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.xianyu-seller-metrics\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/body \.app-viewport \.products-detail-panel \.xianyu-detail-description\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.7;/s);
    expect(productsCss).toMatch(/\.xianyu-detail-image-placeholder\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.6;/s);
    expect(productsCss).toMatch(/\.xianyu-detail-image-placeholder small\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.xianyu-detail-image figcaption\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).toMatch(/\.products-detail-panel \.xianyu-raw-payload pre\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.5;/s);
    expect(productsCss).not.toMatch(/\.xianyu-detail-image-placeholder small\s*\{[^}]*font-size:\s*8px;/s);
    expect(productsCss).not.toMatch(/\.xianyu-detail-image figcaption\s*\{[^}]*font-size:\s*9px;/s);
    expect(productsCss).not.toMatch(/\.xianyu-raw-payload pre\s*\{[^}]*font-size:\s*9px;/s);
  });
});
