export interface XianyuItemDetailSummary {
  itemId?: string;
  categoryId?: string;
  xianyuUpdatedAt?: string;
  title?: string;
  description?: string;
  richTextDescription?: string;
  imageUrls?: string[];
  priceText?: string;
  priceMinor?: number;
  browseCount?: number;
  wantCount?: number;
  collectCount?: number;
  favoriteCount?: number;
  interactFavoriteCount?: number;
  soldCount?: number;
  quantity?: number;
  seller?: {
    sellerId?: string;
    nickname?: string;
    city?: string;
    avatarUrl?: string;
    soldCount?: number;
    itemCount?: number;
    goodRemarkCount?: number;
    badRemarkCount?: number;
  };
}

export function mapXianyuItemDetail(response: Record<string, unknown> | undefined, fallbackItemId?: string): XianyuItemDetailSummary {
  const data = asRecord(response?.data);
  const item = asRecord(data.itemDO);
  const seller = asRecord(data.sellerDO);
  const itemId = firstString(item.itemId, fallbackItemId);
  const sellerItems = arrayRecords(seller.sellerItems);
  const currentSellerItem = sellerItems.find((candidate) => {
    const candidateItem = asRecord(candidate.itemDO);
    return firstString(candidate.itemId, candidate.itemID, candidate.id, candidateItem.itemId, candidateItem.itemID) === itemId;
  });
  const sellerItemAttributes = asRecord(currentSellerItem?.attributeMap);
  const xianyuUpdatedAt = parseDate(
    item.updatedAt,
    item.updated_at,
    item.updateTime,
    item.update_time,
    item.modifyTime,
    item.modify_time,
    item.gmtModified,
    item.gmt_modified,
    currentSellerItem?.updatedAt,
    currentSellerItem?.updated_at,
    item.GMT_UPDATE_DATE_KEY,
  );
  const remarks = asRecord(seller.remarkDO);
  const priceText = firstString(item.soldPrice, item.price, item.priceText, item.originalPrice);
  const imageUrls = uniqueStrings([
    ...arrayRecords(item.imageInfos).map((image) => firstString(image.url, image.image)),
    ...arrayRecords(asRecord(item.shareData).images).map((image) => firstString(image.image, image.url)),
  ]);
  const sellerSummary = compact({
    sellerId: firstString(seller.sellerId),
    nickname: firstString(seller.nick, seller.uniqueName),
    city: firstString(seller.city, seller.publishCity),
    avatarUrl: firstString(asRecord(seller.resumeDO).mainPicUrl, seller.portraitUrl),
    soldCount: firstNumber(seller.hasSoldNumInteger),
    itemCount: firstNumber(seller.itemCount),
    goodRemarkCount: firstNumber(remarks.sellerGoodRemarkCnt),
    badRemarkCount: firstNumber(remarks.sellerBadRemarkCnt),
  }) as Record<string, unknown>;
  return compact({
    itemId,
    categoryId: firstString(item.categoryId, data.categoryId),
    xianyuUpdatedAt,
    title: firstString(item.title),
    description: firstString(item.desc),
    richTextDescription: firstString(item.richTextDesc),
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    priceText,
    priceMinor: parsePriceMinor(priceText),
    browseCount: firstNumber(item.browseCnt, asRecord(data.b2cItemDO).browseCnt),
    wantCount: firstNumber(item.wantCnt, asRecord(data.b2cItemDO).wantBuyCount, data.skillServiceDO && asRecord(data.skillServiceDO).leadWantNum),
    collectCount: firstNumber(item.collectCnt),
    favoriteCount: firstNumber(item.favorCnt),
    interactFavoriteCount: firstNumber(item.interactFavorCnt),
    soldCount: firstNumber(item.soldCnt, seller.hasSoldNumInteger),
    quantity: firstNumber(item.quantity),
    seller: Object.keys(sellerSummary).length > 0 ? sellerSummary : undefined,
  }) as XianyuItemDetailSummary;
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    if (Number.isFinite(numeric) && numeric >= 0) return Math.trunc(numeric);
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

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, compact(entry)]));
  }
  return value;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}
