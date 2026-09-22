import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { ProductAssetRecord, ProductRecord, Store } from './domain.js';
import { ServiceError } from './services.js';
import { digestJson } from './security.js';
import type { ObjectStorage } from './object-storage.js';
import { XianyuMtopClient } from './xianyu-mtop.js';
import type { XianyuItemDetailSummary } from './xianyu-item-detail-mapper.js';

export interface XianyuItemDetailView extends XianyuItemDetailSummary {
  product: ProductRecord;
  itemId: string;
  summary: XianyuItemDetailSummary;
  rawResponse: Record<string, unknown>;
  imageUrls: string[];
  images: Array<ProductAssetRecord & { url?: string; publicUrl?: string }>;
  assets: ProductAssetRecord[];
  syncedAt?: string;
  cached: boolean;
  assetUploadErrors: Array<{ sourceUrl: string; message: string }>;
}

export class XianyuItemDetailService {
  constructor(
    private readonly store: Store,
    private readonly xianyu: XianyuMtopClient,
    private readonly objectStorage: ObjectStorage,
    private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>,
  ) {}

  async get(input: { adminId: string; productId: string; refresh?: boolean; categoryId?: string; referer?: string; spmPre?: string; logId?: string; requestId: string; traceId: string }): Promise<XianyuItemDetailView> {
    const product = await this.store.getProduct(input.adminId, input.productId);
    if (!product) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
    const cached = readStoredDetail(product);
    if (cached && !input.refresh) return detailView(product, cached, true);
    const itemId = product.externalProductRef?.trim();
    if (!itemId) throw new ServiceError(422, 'VALIDATION_FAILED', 'product externalProductRef is required for xianyu detail');
    const response = await this.xianyu.fetchItemDetail(input.adminId, product.accountId, itemId, { categoryId: input.categoryId, referer: input.referer, spmPre: input.spmPre, logId: input.logId });
    if (!response.success) {
      const status = response.accountInvalid ? 401 : 502;
      throw new ServiceError(status, response.errorCode ?? 'XIANYU_ITEM_DETAIL_FAILED', response.message ?? 'xianyu item detail request failed');
    }
    const summary = response.summary;
    const imageUrls = uniqueStrings(summary.imageUrls ?? []);
    const assetResult = await this.persistImages(product.id, itemId, imageUrls);
    const syncedAt = new Date().toISOString();
    const persisted = await this.store.persistXianyuItemDetail({
      adminId: input.adminId,
      productId: product.id,
      itemId,
      summary: summary as Record<string, unknown>,
      rawResponse: response.response ?? {},
      imageUrls,
      assetUploadErrors: assetResult.errors,
      syncedAt,
      sourcePayloadDigest: digestJson(response.response ?? {}),
      assets: assetResult.assets,
    });
    if (!persisted) throw new ServiceError(404, 'NOT_FOUND', 'product not found');
    await this.audit({ actorId: input.adminId, action: 'product.detail.synced', targetRef: product.id, requestId: input.requestId, traceId: input.traceId, accountId: product.accountId, payload: { itemId, imageCount: imageUrls.length, assetCount: assetResult.assets.length, assetUploadErrorCount: assetResult.errors.length } });
    return detailView(persisted, { summary, rawResponse: response.response ?? {}, imageUrls, assetUploadErrors: assetResult.errors, syncedAt }, false, assetResult.errors);
  }

  /**
   * Resolve a persisted product image for the authenticated media route.
   * If an older record points at an object that is no longer present (for
   * example, after a test bucket was removed), rehydrate that object from the
   * source URL already stored with the asset. This does not call Xianyu or
   * read DOM data; it only repairs the persisted object-storage reference.
   */
  async getAsset(input: { adminId: string; productId: string; assetId: string }): Promise<{ asset: ProductAssetRecord; object: { key: string; body: Buffer; contentType: string; etag?: string } } | undefined> {
    const product = await this.store.getProduct(input.adminId, input.productId);
    const asset = product?.assets?.find((candidate) => candidate.id === input.assetId && candidate.status === 'active' && candidate.mimeType.toLowerCase().startsWith('image/'));
    if (!asset) return undefined;
    let object = await this.objectStorage.getObject(asset.storageKey);
    if (!object && asset.sourceUrl) {
      try {
        const downloaded = await downloadImage(asset.sourceUrl);
        await this.objectStorage.putObject({ key: asset.storageKey, body: downloaded.body, contentType: downloaded.contentType });
        object = { key: asset.storageKey, body: downloaded.body, contentType: downloaded.contentType, etag: downloaded.checksum };
      } catch {
        return undefined;
      }
    }
    return object ? { asset, object } : undefined;
  }

  private async persistImages(productId: string, itemId: string, imageUrls: string[]): Promise<{ assets: Array<{ storageKey: string; mimeType: string; checksum?: string; sourceUrl: string; metadata?: Record<string, unknown>; status: 'active' | 'failed' }>; errors: Array<{ sourceUrl: string; message: string }> }> {
    const assets: Array<{ storageKey: string; mimeType: string; checksum?: string; sourceUrl: string; metadata?: Record<string, unknown>; status: 'active' | 'failed' }> = [];
    const errors: Array<{ sourceUrl: string; message: string }> = [];
    for (const [index, sourceUrl] of imageUrls.slice(0, 30).entries()) {
      const baseKey = `products/${productId}/xianyu/${itemId}/images/${sha256(sourceUrl).slice(0, 32)}`;
      try {
        const downloaded = await downloadImage(sourceUrl);
        const extension = extensionForMime(downloaded.contentType);
        const key = `${baseKey}${extension}`;
        const uploaded = await this.objectStorage.putObject({ key, body: downloaded.body, contentType: downloaded.contentType });
        assets.push({ storageKey: uploaded.key, mimeType: downloaded.contentType, checksum: downloaded.checksum, sourceUrl, metadata: { source: 'xianyu-detail', itemId, ordinal: index, publicUrl: uploaded.publicUrl ?? this.objectStorage.publicUrl(uploaded.key) }, status: 'active' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'image upload failed';
        errors.push({ sourceUrl, message });
        assets.push({ storageKey: `${baseKey}.external`, mimeType: guessMime(sourceUrl), sourceUrl, metadata: { source: 'xianyu-detail', itemId, ordinal: index, uploadError: message }, status: 'failed' });
      }
    }
    return { assets, errors };
  }
}

interface StoredDetail { summary: XianyuItemDetailSummary; rawResponse: Record<string, unknown>; imageUrls: string[]; assetUploadErrors: Array<{ sourceUrl: string; message: string }>; syncedAt?: string }

function readStoredDetail(product: ProductRecord): StoredDetail | undefined {
  const xianyu = product.attributes.xianyu;
  if (!xianyu || typeof xianyu !== 'object' || Array.isArray(xianyu)) return undefined;
  const detail = (xianyu as Record<string, unknown>).detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  const value = detail as Record<string, unknown>;
  const summary = value.summary;
  const rawResponse = value.rawResponse;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary) || !rawResponse || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) return undefined;
  const assetUploadErrors = Array.isArray(value.assetUploadErrors) ? value.assetUploadErrors.filter((entry): entry is { sourceUrl: string; message: string } => Boolean(entry && typeof entry === 'object' && typeof (entry as { sourceUrl?: unknown }).sourceUrl === 'string' && typeof (entry as { message?: unknown }).message === 'string')) : [];
  return { summary: summary as XianyuItemDetailSummary, rawResponse: rawResponse as Record<string, unknown>, imageUrls: Array.isArray(value.imageUrls) ? value.imageUrls.filter((entry): entry is string => typeof entry === 'string') : [], assetUploadErrors, syncedAt: typeof value.syncedAt === 'string' ? value.syncedAt : undefined };
}

function detailView(product: ProductRecord, detail: StoredDetail, cached: boolean, assetUploadErrors: Array<{ sourceUrl: string; message: string }> = detail.assetUploadErrors): XianyuItemDetailView {
  const assets = (product.assets ?? []).filter((asset) => asset.status !== 'archived');
  const detailProduct = product.assets ? { ...product, assets, assetCount: assets.length } : product;
  const images = assets.map((asset) => {
    const publicUrl = asset.metadata && typeof asset.metadata.publicUrl === 'string' ? asset.metadata.publicUrl : undefined;
    const url = asset.status === 'active'
      ? `/api/v1/products/${encodeURIComponent(product.id)}/detail/assets/${encodeURIComponent(asset.id)}`
      : asset.sourceUrl ?? publicUrl;
    return { ...asset, url, publicUrl };
  });
  return { ...detail.summary, product: detailProduct, itemId: detail.summary.itemId ?? product.externalProductRef ?? '', summary: detail.summary, rawResponse: detail.rawResponse, imageUrls: detail.imageUrls, images, assets, syncedAt: detail.syncedAt, cached, assetUploadErrors };
}

async function downloadImage(sourceUrl: string): Promise<{ body: Buffer; contentType: string; checksum: string }> {
  const parsed = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('IMAGE_URL_PROTOCOL_UNSUPPORTED');
  assertSafeRemoteImageHost(parsed.hostname);
  const response = await fetch(parsed, { signal: AbortSignal.timeout(20_000), headers: { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
  if (!response.ok) throw new Error(`IMAGE_DOWNLOAD_FAILED:${response.status}`);
  const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() || guessMime(sourceUrl);
  if (!contentType.startsWith('image/')) throw new Error('IMAGE_CONTENT_TYPE_INVALID');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > 20 * 1024 * 1024) throw new Error('IMAGE_SIZE_UNSUPPORTED');
  return { body, contentType, checksum: sha256(body) };
}

function assertSafeRemoteImageHost(rawHostname: string): void {
  const hostname = rawHostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.lan') || hostname === 'metadata.google.internal' || hostname === 'metadata.google.com') throw new Error('IMAGE_URL_HOST_UNSAFE');
  const version = isIP(hostname);
  if (version === 4 && isPrivateIpv4(hostname)) throw new Error('IMAGE_URL_HOST_UNSAFE');
  if (version === 6 && isPrivateIpv6(hostname)) throw new Error('IMAGE_URL_HOST_UNSAFE');
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && b >= 18 && b <= 19) || (a === 198 && b === 51) || (a === 203 && b === 0) || a >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return Boolean(mapped && isPrivateIpv4(mapped[1]));
}

function extensionForMime(mimeType: string): string {
  const extension = mimeType.split('/')[1]?.split('+', 1)[0] || 'bin';
  return `.${extension === 'jpeg' ? 'jpg' : extension}`;
}
function guessMime(sourceUrl: string): string {
  const extension = sourceUrl.split('?')[0]?.split('.').pop()?.toLowerCase();
  return extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension === 'gif' ? 'image/gif' : 'image/jpeg';
}
function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function uniqueStrings(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
