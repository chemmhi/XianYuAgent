/**
 * Deterministic order fixture for the live Chrome/CDP slice.
 *
 * The fixture intentionally uses the same fields exposed by the order list
 * contract so the test crosses the store, HTTP adapter and browser without
 * a second mock data model.  It is only imported by the e2e script.
 */

export const ORDER_FIXTURE_PRIMARY_NAME = 'Chrome 订单账号';
export const ORDER_FIXTURE_SECONDARY_NAME = 'Secondary 订单账号';

const BASE_TIME = Date.parse('2026-09-20T10:00:00+08:00');
const BUYER_AVATAR_URL = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 40 40%22%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%2220%22 fill=%22%23dbeafe%22/%3E%3Ccircle cx=%2220%22 cy=%2216%22 r=%227%22 fill=%22%231d4ed8%22/%3E%3Cpath d=%22M9 34c2-7 20-7 22 0%22 fill=%22%231d4ed8%22/%3E%3C/svg%3E';
const PRODUCT_IMAGE_URL = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22%3E%3Crect width=%2248%22 height=%2248%22 rx=%228%22 fill=%22%23bfdbfe%22/%3E%3Cpath d=%22M10 34 20 23l7 7 4-4 7 8H10Z%22 fill=%22%231d4ed8%22/%3E%3C/svg%3E';

const paymentStatuses = ['paid', 'paid', 'paid', 'closed', 'unpaid'];
const orderStatuses = ['open', 'completed', 'failed', 'closed', 'cancelled'];
const deliveryStatuses = ['pending', 'delivered', 'failed', 'delivered', 'cancelled'];
const afterSalesStatuses = ['none', 'none', 'none', 'refunding', 'closed'];
const deliveryTypes = ['coupon_only', 'mixed', 'coupon_only', 'manual', 'no_logistics'];

function isoAt(index) {
  return new Date(BASE_TIME - index * 60 * 60 * 1000).toISOString();
}

function fixtureOrder({ processId, index, accountId, accountName, suffix = '' }) {
  const statusIndex = index % paymentStatuses.length;
  const orderNo = `E2E-${processId}-${suffix}${String(index + 1).padStart(3, '0')}`;
  const createdAt = isoAt(index);
  return {
    orderNo,
    externalOrderRef: orderNo,
    accountId,
    accountName,
    buyerId: `buyer-${processId}-${index + 1}`,
    buyerNickname: index === 0 ? '订单验收昵称' : `昵称_${String(index + 1).padStart(2, '0')}`,
    buyerAvatarUrl: BUYER_AVATAR_URL,
    buyerName: index === 0 ? '订单验收买家' : `买家_${String(index + 1).padStart(2, '0')}`,
    itemId: `ITEM-${processId}-${index + 1}`,
    itemTitle: index === 0 ? 'Chrome 订单验收商品' : `闲鱼订单商品 ${index + 1}`,
    amountMinor: 1990 + index * 100,
    paymentStatus: paymentStatuses[statusIndex],
    orderStatus: orderStatuses[statusIndex],
    deliveryStatus: deliveryStatuses[statusIndex],
    afterSalesStatus: afterSalesStatuses[statusIndex],
    deliveryType: deliveryTypes[statusIndex],
    createdAt,
    updatedAt: new Date(Date.parse(createdAt) + 60 * 1000).toISOString(),
    deliveryFailReason: deliveryStatuses[statusIndex] === 'failed' ? 'E2E fixture：未找到可交付配置' : undefined,
    conversationId: `conversation-${processId}-${index + 1}`,
    productId: `product-${processId}-${index + 1}`,
    configVersion: 1,
  };
}

export function buildOrderFixture({ processId = process.pid, accountId, secondaryAccountId, primaryCount = 21, secondaryCount = 3 }) {
  if (!accountId || !secondaryAccountId) throw new Error('order fixture requires primary and secondary account ids');
  const rows = [];
  for (let index = 0; index < primaryCount; index += 1) {
    rows.push(fixtureOrder({ processId, index, accountId, accountName: ORDER_FIXTURE_PRIMARY_NAME }));
  }
  for (let index = 0; index < secondaryCount; index += 1) {
    rows.push(fixtureOrder({ processId, index: primaryCount + index, accountId: secondaryAccountId, accountName: ORDER_FIXTURE_SECONDARY_NAME, suffix: 'B' }));
  }
  return rows;
}

export async function seedOrderFixture(runtime, { adminId, accountId, secondaryAccountId, processId = process.pid } = {}) {
  if (typeof runtime?.store?.createOrder !== 'function') {
    throw new Error('Orders E2E fixture requires runtime.store.createOrder()');
  }
  const fixture = buildOrderFixture({ processId, accountId, secondaryAccountId });
  const created = [];
  for (const order of fixture) {
    await runtime.store.createProduct({ adminId, accountId: order.accountId, externalProductRef: order.itemId, title: order.itemTitle, attributes: { xianyu: { imageUrls: [PRODUCT_IMAGE_URL] } } });
    await runtime.store.createConversation({ adminId, accountId: order.accountId, buyerRef: order.buyerId, buyerDisplayName: order.buyerNickname, buyerAvatarUrl: order.buyerAvatarUrl, itemRef: order.itemId, itemTitle: order.itemTitle, itemImageUrl: PRODUCT_IMAGE_URL, externalConversationRef: `orders-e2e-${processId}-${order.orderNo}` });
    const storedOrder = order.orderNo.endsWith('-001')
      ? { ...order, buyerNickname: undefined, itemTitle: order.itemId, conversationId: undefined, productId: undefined }
      : { ...order, conversationId: undefined, productId: undefined };
    created.push(await runtime.store.createOrder({ adminId, order: storedOrder }));
  }
  return { fixture, created };
}

export function buildRefreshOrderFixture({ processId = process.pid, accountId, accountName = ORDER_FIXTURE_PRIMARY_NAME } = {}) {
  if (!accountId) throw new Error('refresh fixture requires account id');
  const order = fixtureOrder({ processId, index: 99, accountId, accountName, suffix: 'R' });
  return { ...order, orderNo: `E2E-${processId}-REFRESH`, externalOrderRef: `E2E-${processId}-REFRESH`, buyerNickname: '闲鱼刷新昵称', buyerName: '闲鱼刷新买家', itemTitle: '闲鱼刷新订单', createdAt: new Date(BASE_TIME + 60 * 60 * 1000).toISOString(), updatedAt: new Date(BASE_TIME + 60 * 60 * 1000).toISOString() };
}
