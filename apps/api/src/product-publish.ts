import type { ProductRecord } from './domain.js';
import { ServiceError, ProductService } from './services.js';
import type { ModelClient } from './pi-runtime.js';
import { XianyuMtopClient, type MtopResult } from './xianyu-mtop.js';

export const PRODUCT_PUBLISH_API = 'mtop.idle.pc.idleitem.publish';
export const PRODUCT_PROPERTY_RECOMMEND_API = 'mtop.taobao.idle.kgraph.property.recommend';

export type ProductPostageMode = 'free' | 'distance' | 'fixed' | 'none';

export interface ProductPublishImageInput {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface ProductPublishLocationInput {
  area?: string;
  city?: string;
  divisionId?: string;
  longitude?: number;
  latitude?: number;
  poiId?: string;
  poiName?: string;
  province?: string;
}

export interface ProductPublishInput {
  adminId: string;
  accountId: string;
  title: string;
  description: string;
  categoryCode?: string;
  priceMinor: number;
  originalPriceMinor?: number;
  quantity: number;
  postageMode: ProductPostageMode;
  postageMinor?: number;
  location?: ProductPublishLocationInput;
  images: ProductPublishImageInput[];
  requestId: string;
  traceId: string;
}

export interface ProductPublishResult {
  product: ProductRecord;
  itemId: string;
  itemUrl: string;
  category: { catId: string; catName: string; channelCatId: string; tbCatId?: string };
  postageMode: ProductPostageMode;
  imageUrls: string[];
  replay: {
    source: 'reference-project';
    steps: Array<{ api: string; status: 'succeeded' | 'skipped' }>;
  };
}

export interface ProductDescriptionOptimizeInput {
  adminId: string;
  accountId: string;
  title: string;
  description: string;
  requestId: string;
  traceId: string;
}

export class ProductPublishService {
  constructor(
    private readonly xianyu: XianyuMtopClient,
    private readonly products: ProductService,
    private readonly resolveModelClient: (adminId: string, accountId: string) => Promise<ModelClient | undefined>,
    private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>,
  ) {}

  async publish(input: ProductPublishInput): Promise<ProductPublishResult> {
    validatePublishInput(input);
    const uploaded: Array<{ url: string; width: number; height: number }> = [];
    const steps: ProductPublishResult['replay']['steps'] = [];

    for (const image of input.images) {
      const uploadedImage = await this.xianyu.uploadChatImage(input.adminId, input.accountId, image.filename, image.contentType, image.data);
      if (!uploadedImage.success || !uploadedImage.url) throw externalPublishError(uploadedImage, '商品图片上传失败');
      uploaded.push({ url: uploadedImage.url, width: uploadedImage.width ?? 800, height: uploadedImage.height ?? 600 });
    }
    steps.push({ api: 'stream-upload.goofish.com/api/upload.api', status: 'succeeded' });

    const recommendation = await this.xianyu.callApi(input.adminId, input.accountId, PRODUCT_PROPERTY_RECOMMEND_API, '2.0', buildRecommendPayload(input, uploaded), {
      spm_cnt: 'a21ybx.publish.0.0',
      spm_pre: 'a21ybx.item.sidebar.1.67321598K9Vgx8',
      log_id: '67321598K9Vgx8',
    });
    if (!recommendation.success && recommendation.accountInvalid) throw externalPublishError(recommendation, '闲鱼账号登录态已失效');
    if (!recommendation.success && !input.categoryCode) throw externalPublishError(recommendation, '闲鱼属性规格推荐失败');
    const categoryPayload = recommendation.success ? record(recommendation.response?.data) : {};
    const category = resolveCategory(categoryPayload, input.categoryCode);
    steps.push({ api: PRODUCT_PROPERTY_RECOMMEND_API, status: recommendation.success ? 'succeeded' : 'skipped' });

    const publishResponse = await this.xianyu.callApi(input.adminId, input.accountId, PRODUCT_PUBLISH_API, '1.0', buildPublishPayload(input, uploaded, categoryPayload, category), {
      spm_cnt: 'a21ybx.publish.0.0',
      spm_pre: 'a21ybx.home.sidebar.1.46413da6EPl7v5',
      log_id: '46413da6EPl7v5',
    });
    if (!publishResponse.success) throw externalPublishError(publishResponse, '闲鱼商品发布失败');
    steps.push({ api: PRODUCT_PUBLISH_API, status: 'succeeded' });
    const itemId = findStringDeep(publishResponse.response?.data, 'itemId', 'item_id', 'itemID', 'id') ?? findStringDeep(publishResponse.response, 'itemId', 'item_id', 'itemID');
    if (!itemId) throw new ServiceError(502, 'XIANYU_PUBLISH_RESULT_MISSING', '闲鱼发布成功但未返回商品 ID');

    const itemUrl = `https://www.goofish.com/item?id=${encodeURIComponent(itemId)}`;
    const imageUrls = uploaded.map((item) => item.url);
    const product = await this.products.create({
      adminId: input.adminId,
      accountId: input.accountId,
      externalProductRef: itemId,
      title: input.title.trim(),
      description: input.description.trim(),
      categoryCode: input.categoryCode ?? category.catId,
      priceMinor: input.priceMinor,
      status: 'published',
      attributesJson: {
        publish: {
          originalPriceMinor: input.originalPriceMinor,
          quantity: input.quantity,
          postageMode: input.postageMode,
          postageMinor: input.postageMinor,
          imageUrls,
          category,
          replaySteps: steps,
        },
      },
      requestId: input.requestId,
      traceId: input.traceId,
    });
    await this.audit({ actorId: input.adminId, action: 'product.published', targetRef: product.id, requestId: input.requestId, traceId: input.traceId, accountId: input.accountId, payload: { itemId, itemUrl, priceMinor: input.priceMinor, quantity: input.quantity, postageMode: input.postageMode, imageCount: imageUrls.length, replaySteps: steps } });
    return { product, itemId, itemUrl, category, postageMode: input.postageMode, imageUrls, replay: { source: 'reference-project', steps } };
  }

  async optimizeDescription(input: ProductDescriptionOptimizeInput): Promise<{ description: string; provider: string; model: string }> {
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title && !description) throw new ServiceError(422, 'VALIDATION_FAILED', 'title or description is required');
    const client = await this.resolveModelClient(input.adminId, input.accountId);
    if (!client) throw new ServiceError(409, 'MODEL_PROVIDER_NOT_CONFIGURED', '请先在配置页设置当前账号的模型 Provider');
    const result = await client.complete({
      messages: [
        { role: 'system', content: '你是闲鱼商品文案编辑。只输出可直接发布的中文商品描述，不要解释过程，不要虚构参数；保留用户提供的事实，补齐卖点、成色、适用场景和发货说明，控制在 2000 字以内。' },
        { role: 'user', content: `商品标题：${title}\n当前描述：${description || '暂无'}\n请优化成自然、可信、适合闲鱼发布的商品描述。` },
      ],
    });
    const optimized = result.content.trim();
    if (!optimized) throw new ServiceError(502, 'MODEL_PROVIDER_EMPTY', '模型未返回可用文案');
    await this.audit({ actorId: input.adminId, action: 'product.publish.description_optimized', requestId: input.requestId, traceId: input.traceId, accountId: input.accountId, payload: { title, inputLength: description.length, outputLength: optimized.length, model: result.model } });
    return { description: optimized.slice(0, 2000), provider: 'configured', model: result.model };
  }
}

function validatePublishInput(input: ProductPublishInput): void {
  if (!input.accountId.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
  if (!input.title.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', '商品标题不能为空');
  if (!input.description.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', '商品描述不能为空');
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor <= 0) throw new ServiceError(422, 'VALIDATION_FAILED', '商品价格必须大于 0');
  if (input.originalPriceMinor !== undefined && (!Number.isSafeInteger(input.originalPriceMinor) || input.originalPriceMinor < 0)) throw new ServiceError(422, 'VALIDATION_FAILED', '原价必须是合法金额');
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw new ServiceError(422, 'VALIDATION_FAILED', '库存数量必须大于 0');
  if (!['free', 'distance', 'fixed', 'none'].includes(input.postageMode)) throw new ServiceError(422, 'VALIDATION_FAILED', '邮费模式无效');
  const postageMinor = input.postageMinor;
  if (input.postageMode === 'fixed' && (typeof postageMinor !== 'number' || !Number.isSafeInteger(postageMinor) || postageMinor < 0)) throw new ServiceError(422, 'VALIDATION_FAILED', '一口价模式必须填写合法邮费');
  if (input.postageMinor !== undefined && (!Number.isSafeInteger(input.postageMinor) || input.postageMinor < 0)) throw new ServiceError(422, 'VALIDATION_FAILED', '邮费必须是合法金额');
  if (input.images.length < 1 || input.images.length > 9) throw new ServiceError(422, 'VALIDATION_FAILED', '商品图片数量必须在 1 到 9 张之间');
}

function buildRecommendPayload(input: ProductPublishInput, images: Array<{ url: string; width: number; height: number }>): Record<string, unknown> {
  return {
    title: input.title.trim(),
    lockCpv: false,
    multiSKU: false,
    publishScene: 'mainPublish',
    scene: 'newPublishChoice',
    description: input.description.trim(),
    uniqueCode: `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`,
    imageInfos: images.map((image, index) => publishImagePayload(image, index === 0)),
  };
}

function buildPublishPayload(input: ProductPublishInput, images: Array<{ url: string; width: number; height: number }>, recommendation: Record<string, unknown>, category: { catId: string; catName: string; channelCatId: string; tbCatId?: string }): Record<string, unknown> {
  const data: Record<string, unknown> = {
    freebies: false,
    itemTypeStr: 'b',
    quantity: String(input.quantity),
    simpleItem: 'true',
    imageInfoDOList: images.map((image, index) => publishImagePayload(image, index === 0)),
    itemTextDTO: { desc: input.description.trim(), title: input.title.trim(), titleDescSeparate: false },
    itemLabelExtList: publishLabels(recommendation),
    itemPriceDTO: {
      priceInCent: String(input.priceMinor),
      ...(input.originalPriceMinor && input.originalPriceMinor > 0 ? { origPriceInCent: String(input.originalPriceMinor) } : {}),
    },
    userRightsProtocols: [{ enable: false, serviceCode: 'SKILL_PLAY_NO_MIND' }],
    itemPostFeeDTO: postageDto(input.postageMode, input.postageMinor),
    defaultPrice: false,
    itemCatDTO: category,
    uniqueCode: `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`,
    sourceId: 'pcMainPublish',
    bizcode: 'pcMainPublish',
    publishScene: 'pcMainPublish',
  };
  if (input.location) {
    const location = input.location;
    data.itemAddrDTO = {
      area: location.area ?? '',
      city: location.city ?? '',
      divisionId: location.divisionId ?? '',
      gps: `${location.latitude ?? 0},${location.longitude ?? 0}`,
      poiId: location.poiId ?? '',
      poiName: location.poiName ?? '',
      prov: location.province ?? '',
    };
  }
  return data;
}

function postageDto(mode: ProductPostageMode, postageMinor?: number): Record<string, unknown> {
  const normalizedPostageMinor = postageMinor ?? 0;
  switch (mode) {
    case 'free': return { canFreeShipping: true, supportFreight: true, onlyTakeSelf: false };
    case 'distance': return { canFreeShipping: false, supportFreight: true, onlyTakeSelf: false, templateId: '-100' };
    case 'fixed': return { canFreeShipping: false, supportFreight: true, onlyTakeSelf: false, postPriceInCent: String(normalizedPostageMinor), templateId: '0' };
    case 'none': return { canFreeShipping: false, supportFreight: false, onlyTakeSelf: true, templateId: '0' };
  }
}

function publishImagePayload(image: { url: string; width: number; height: number }, major: boolean): Record<string, unknown> {
  return { extraInfo: { isH: 'false', isT: 'false', raw: 'false' }, isQrCode: false, url: image.url, heightSize: image.height, widthSize: image.width, major, type: 0, status: 'done' };
}

function publishLabels(category: Record<string, unknown>): unknown[] {
  const cards = Array.isArray(category.cardList) ? category.cardList : [];
  const out: unknown[] = [];
  for (const rawCard of cards) {
    const cardData = record(record(rawCard).cardData);
    const values = Array.isArray(cardData.valuesList) ? cardData.valuesList : [];
    for (const rawValue of values) {
      const value = record(rawValue);
      if (!isSelected(value.isClicked)) continue;
      const propertyId = stringValue(cardData.propertyId);
      const propertyName = stringValue(cardData.propertyName);
      const channelCatId = stringValue(value.channelCatId);
      const catName = stringValue(value.catName);
      if (!propertyId || !propertyName || !channelCatId || !catName) continue;
      out.push({ channelCateName: catName, valueId: null, channelCateId: channelCatId, valueName: null, tbCatId: stringValue(value.tbCatId) || null, subPropertyId: null, labelType: 'common', subValueId: null, labelId: null, propertyName, isUserClick: '1', isUserCancel: null, from: 'newPublishChoice', propertyId, labelFrom: 'newPublish', text: catName, properties: `${propertyId}##${propertyName}:${channelCatId}##${catName}` });
      break;
    }
  }
  return out;
}

function resolveCategory(payload: Record<string, unknown>, categoryCode?: string): { catId: string; catName: string; channelCatId: string; tbCatId?: string } {
  const predicted = record(payload.categoryPredictResult);
  const selected = categoryFromCards(payload) ?? undefined;
  const catId = stringValue(predicted.catId) || selected?.catId || (categoryCode?.trim() || '50023914');
  const catName = stringValue(predicted.catName) || selected?.catName || (categoryCode?.trim() ? categoryCode.trim() : '电子资料');
  const channelCatId = stringValue(predicted.channelCatId) || selected?.channelCatId || '202036301';
  const tbCatId = stringValue(predicted.tbCatId) || selected?.tbCatId || undefined;
  return { catId, catName, channelCatId, ...(tbCatId ? { tbCatId } : {}) };
}

function categoryFromCards(payload: Record<string, unknown>): { catId: string; catName: string; channelCatId: string; tbCatId?: string } | null {
  const cards = Array.isArray(payload.cardList) ? payload.cardList : [];
  for (const rawCard of cards) {
    const cardData = record(record(rawCard).cardData);
    if (stringValue(cardData.propertyId) !== '-10000') continue;
    for (const rawValue of Array.isArray(cardData.valuesList) ? cardData.valuesList : []) {
      const value = record(rawValue);
      if (!isSelected(value.isClicked)) continue;
      const catId = stringValue(value.catId); const catName = stringValue(value.catName); const channelCatId = stringValue(value.channelCatId);
      if (catId && catName && channelCatId) return { catId, catName, channelCatId, ...(stringValue(value.tbCatId) ? { tbCatId: stringValue(value.tbCatId) } : {}) };
    }
  }
  return null;
}

function externalPublishError(result: Pick<MtopResult, 'accountInvalid' | 'errorCode' | 'message'>, fallback: string): ServiceError {
  if (result.accountInvalid) return new ServiceError(409, 'ACCOUNT_REAUTH_REQUIRED', result.message ?? fallback, { errorCode: result.errorCode });
  return new ServiceError(502, 'XIANYU_PUBLISH_FAILED', result.message ?? fallback, { errorCode: result.errorCode });
}

function findStringDeep(root: unknown, ...keys: string[]): string | undefined {
  if (!root || typeof root !== 'object') return undefined;
  if (!Array.isArray(root)) {
    const value = root as Record<string, unknown>;
    for (const key of keys) if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    for (const child of Object.values(value)) { const nested = findStringDeep(child, ...keys); if (nested) return nested; }
  } else {
    for (const child of root) { const nested = findStringDeep(child, ...keys); if (nested) return nested; }
  }
  return undefined;
}

function isSelected(value: unknown): boolean { return value === true || value === 1 || String(value ?? '').trim().toLowerCase() === '1' || String(value ?? '').trim().toLowerCase() === 'true'; }
function stringValue(value: unknown): string { return typeof value === 'string' && value.trim() ? value.trim() : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
