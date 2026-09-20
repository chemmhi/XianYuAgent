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
    deliveryFailReason: deliveryStatuses[statusIndex] === 'failed' ? 'E2E fixture：卡券库存不足' : undefined,
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
    created.push(await runtime.store.createOrder({ adminId, order }));
  }
  return { fixture, created };
}

export function buildRefreshOrderFixture({ processId = process.pid, accountId, accountName = ORDER_FIXTURE_PRIMARY_NAME } = {}) {
  if (!accountId) throw new Error('refresh fixture requires account id');
  const order = fixtureOrder({ processId, index: 99, accountId, accountName, suffix: 'R' });
  return { ...order, orderNo: `E2E-${processId}-REFRESH`, externalOrderRef: `E2E-${processId}-REFRESH`, buyerName: '闲鱼刷新买家', itemTitle: '闲鱼刷新订单', createdAt: new Date(BASE_TIME + 60 * 60 * 1000).toISOString(), updatedAt: new Date(BASE_TIME + 60 * 60 * 1000).toISOString() };
}
