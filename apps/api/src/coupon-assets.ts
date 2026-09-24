import { createHash } from 'node:crypto';
import type { CouponAssetRecord, CouponBatchMetadata, CouponBatchRecord, Store } from './domain.js';
import type { ObjectStorage } from './object-storage.js';
import { createId } from './security.js';

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DATA_IMAGE_PATTERN = /^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,([a-z0-9+/=\s]+)$/i;

export class CouponAssetService {
  constructor(private readonly store: Store, private readonly objectStorage: ObjectStorage) {}

  async replaceImages(input: { adminId: string; batch: CouponBatchRecord; imageUrls: string[] }): Promise<CouponAssetRecord[]> {
    const references = [...new Set((input.imageUrls ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, MAX_IMAGES);
    const assets: Array<{ id: string; storageKey: string; mimeType: string; checksum?: string }> = [];
    for (const reference of references) {
      const existingRef = this.assetRefFromUrl(reference);
      if (existingRef) {
        const sameBatch = existingRef.batchId === input.batch.id || existingRef.batchId === String(input.batch.sequenceId ?? '');
        const existing = input.batch.assets?.find((asset) => asset.id === existingRef.assetId) ?? await this.store.getCouponAsset(input.adminId, sameBatch ? input.batch.id : existingRef.batchId, existingRef.assetId);
        if (!existing) throw new Error('COUPON_ASSET_NOT_FOUND');
        if (sameBatch) {
          assets.push({ id: existing.id, storageKey: existing.storageKey, mimeType: existing.mimeType, checksum: existing.checksum });
          continue;
        }
        const object = await this.objectStorage.getObject(existing.storageKey);
        if (!object) throw new Error('COUPON_ASSET_NOT_FOUND');
        const id = createId();
        const storageKey = `coupons/${input.batch.accountId}/${input.batch.id}/${id}.${extensionFor(existing.mimeType)}`;
        await this.objectStorage.putObject({ key: storageKey, body: object.body, contentType: existing.mimeType });
        assets.push({ id, storageKey, mimeType: existing.mimeType, checksum: existing.checksum ?? sha256(object.body) });
        continue;
      }
      const decoded = decodeDataImage(reference);
      if (!decoded) throw new Error('COUPON_IMAGE_REFERENCE_INVALID');
      const id = createId();
      const storageKey = `coupons/${input.batch.accountId}/${input.batch.id}/${id}.${extensionFor(decoded.contentType)}`;
      await this.objectStorage.putObject({ key: storageKey, body: decoded.body, contentType: decoded.contentType });
      assets.push({ id, storageKey, mimeType: decoded.contentType, checksum: sha256(decoded.body) });
    }
    return this.store.replaceCouponAssets({ adminId: input.adminId, batchId: input.batch.id, assets });
  }

  async migrateLegacyImages(input: { adminId: string; batch: CouponBatchRecord }): Promise<CouponBatchRecord> {
    const legacyImages = (input.batch.metadata?.imageUrls ?? []).filter(isDataImage);
    if (legacyImages.length === 0) return input.batch;
    const existingUrls = this.imageUrls(input.batch);
    await this.replaceImages({ adminId: input.adminId, batch: input.batch, imageUrls: [...existingUrls, ...legacyImages] });
    const metadata = withoutImageUrls(input.batch.metadata);
    await this.store.updateCouponBatch({ adminId: input.adminId, batchId: input.batch.id, patch: { metadata } });
    return await this.store.getCouponBatch(input.adminId, input.batch.id) ?? input.batch;
  }

  async getAsset(input: { adminId: string; batchId: string; assetId: string }): Promise<{ asset: CouponAssetRecord; object: { key: string; body: Buffer; contentType: string; etag?: string } } | undefined> {
    const asset = await this.store.getCouponAsset(input.adminId, input.batchId, input.assetId);
    if (!asset) return undefined;
    const object = await this.objectStorage.getObject(asset.storageKey);
    return object ? { asset, object } : undefined;
  }

  imageUrls(batch: CouponBatchRecord): string[] {
    const publicBatchId = batch.sequenceId ?? batch.id;
    return (batch.assets ?? []).filter((asset) => asset.status === 'active').map((asset) => `/api/v1/coupons/batches/${encodeURIComponent(publicBatchId)}/assets/${encodeURIComponent(asset.id)}`);
  }

  withoutImages(metadata?: CouponBatchMetadata): CouponBatchMetadata | undefined { return withoutImageUrls(metadata); }
  isDataImage(value: string): boolean { return isDataImage(value); }

  private assetRefFromUrl(value: string): { batchId: string; assetId: string } | undefined {
    const match = value.match(/\/api\/v1\/coupons\/batches\/([^/]+)\/assets\/([^/?#]+)/);
    if (!match?.[1] || !match[2]) return undefined;
    return { batchId: decodeURIComponent(match[1]), assetId: decodeURIComponent(match[2]) };
  }
}

export function withoutImageUrls(metadata?: CouponBatchMetadata): CouponBatchMetadata | undefined {
  if (!metadata) return undefined;
  const { imageUrls: _imageUrls, ...rest } = metadata;
  return rest;
}

function decodeDataImage(value: string): { contentType: string; body: Buffer } | undefined {
  const match = value.match(DATA_IMAGE_PATTERN);
  if (!match) return undefined;
  const contentType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const body = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (body.length === 0 || body.length > MAX_IMAGE_BYTES) throw new Error('COUPON_IMAGE_TOO_LARGE');
  return { contentType, body };
}

function isDataImage(value: string): boolean { return DATA_IMAGE_PATTERN.test(value); }
function extensionFor(contentType: string): string { return contentType === 'image/jpeg' ? 'jpg' : contentType.slice('image/'.length); }
function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
