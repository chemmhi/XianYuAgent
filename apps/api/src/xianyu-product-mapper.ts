import { createHash } from 'node:crypto';
import type { ProductSyncPageResult, XianyuProductItem } from './domain.js';

export function mapXianyuProductPage(response: Record<string, unknown> | undefined, pageNumber: number, pageSize: number): ProductSyncPageResult {
  const data = asRecord(response?.data);
  const cards = Array.isArray(data.cardList) ? data.cardList : [];
  const items: XianyuProductItem[] = [];
  for (const rawCard of cards) {
    const card = asRecord(rawCard);
    const cardData = asRecord(card.cardData);
    const detailParams = asRecord(cardData.detailParams);
    const itemInfo = asRecord(cardData.itemDO ?? cardData.itemInfo ?? cardData.item);
    const attributeMap = asRecord(cardData.attributeMap);
    const externalProductRef = firstString(detailParams.itemId, cardData.id, cardData.itemId);
    if (!externalProductRef || externalProductRef.startsWith('auto_')) continue;
    const priceInfo = asRecord(cardData.priceInfo);
    const picInfo = asRecord(cardData.picInfo);
    const title = firstString(cardData.title, cardData.itemTitle) ?? externalProductRef;
    const description = firstString(cardData.description, cardData.desc, cardData.itemDesc);
    const categoryCode = firstString(cardData.categoryId, cardData.categoryID);
    const xianyuUpdatedAt = parseDate(
      detailParams.updatedAt,
      detailParams.updated_at,
      detailParams.updateTime,
      detailParams.update_time,
      detailParams.modifyTime,
      detailParams.modify_time,
      detailParams.gmtModified,
      detailParams.gmt_modified,
      detailParams.lastUpdateTime,
      detailParams.last_update_time,
      cardData.updatedAt,
      cardData.updated_at,
      cardData.updateTime,
      cardData.update_time,
      cardData.modifyTime,
      cardData.modify_time,
      cardData.gmtModified,
      cardData.gmt_modified,
      cardData.lastUpdateTime,
      cardData.last_update_time,
      cardData.lastModified,
      cardData.last_modified,
      attributeMap.updatedAt,
      attributeMap.updateTime,
      itemInfo.updatedAt,
      itemInfo.updated_at,
      itemInfo.updateTime,
      itemInfo.update_time,
      itemInfo.gmtModified,
      itemInfo.gmt_modified,
    );
    const imageUrls = collectImageUrls(picInfo, cardData);
    const itemStatus = cardData.itemStatus;
    const item: XianyuProductItem = {
      externalProductRef,
      title,
      description,
      categoryCode,
      priceMinor: parsePriceMinor(firstString(priceInfo.price, cardData.price)),
      externalStatus: itemStatus === undefined || itemStatus === null ? undefined : String(itemStatus),
      xianyuUpdatedAt,
      xianyuListRank: Math.max(0, (pageNumber - 1) * pageSize) + items.length + 1,
      detailUrl: firstString(cardData.detailUrl, cardData.webUrl) ?? `https://www.goofish.com/item?id=${encodeURIComponent(externalProductRef)}`,
      imageUrls,
      attributes: {
        auctionType: firstString(cardData.auctionType),
        itemStatus,
        isMultiSpec: Boolean(cardData.isMultiSpec ?? cardData.multiSpec),
      },
      sourcePayloadDigest: digest(cardData),
    };
    items.push(item);
  }
  const totalCount = firstNumber(data.totalCount, data.total_count, data.total);
  const totalPages = firstNumber(data.pageCount, data.page_count, data.totalPages, data.total_pages) ?? (totalCount && pageSize > 0 ? Math.ceil(totalCount / pageSize) : undefined);
  return { items, pageNumber, pageSize, totalCount, totalPages, hasMore: totalPages ? pageNumber < totalPages : items.length >= pageSize };
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric);
  }
  return undefined;
}

function parsePriceMinor(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/[^0-9.\-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
}

function parseDate(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const raw = typeof value === 'string' ? value.trim() : value;
    if (raw === '') continue;
    if (typeof raw === 'number' || (typeof raw === 'string' && /^\d{10,13}$/.test(raw))) {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric <= 0) continue;
      const milliseconds = numeric < 2_000_000_000 ? numeric * 1000 : numeric;
      const date = new Date(milliseconds);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
      continue;
    }
    const date = new Date(String(raw));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}

function collectImageUrls(picInfo: Record<string, unknown>, cardData: Record<string, unknown>): string[] {
  const candidates: unknown[] = [picInfo.picUrl, picInfo.url, cardData.picUrl, cardData.mainPic, picInfo.picList, cardData.picList];
  const urls: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) urls.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(visit);
  };
  candidates.forEach(visit);
  return [...new Set(urls)];
}

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
