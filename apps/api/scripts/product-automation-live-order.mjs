import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { normalizeAutomationBuyerName } from '../dist/product-automation-live-gate.js';

const env = process.env;
assert.equal(env.PRODUCT_AUTOMATION_LIVE_TEST, '1', 'PRODUCT_AUTOMATION_LIVE_TEST=1 is required');
assert.equal(env.PRODUCT_AUTOMATION_LIVE_CONFIRM_TEXT, 'I UNDERSTAND REAL XIANYU MUTATION', 'explicit live confirmation text is required');
assert.equal(env.PRODUCT_AUTOMATION_EXECUTION_MODE, 'live', 'PRODUCT_AUTOMATION_EXECUTION_MODE=live is required');
assert.equal(String(env.PRODUCT_AUTOMATION_LIVE_CONFIRMED).toLowerCase(), 'true', 'PRODUCT_AUTOMATION_LIVE_CONFIRMED=true is required');

const adminId = required('ADMIN_ID');
const accountId = required('ACCOUNT_ID');
const orderNo = required('ORDER_NO');
const action = required('PRODUCT_AUTOMATION_LIVE_ACTION');
assert.ok(['payment_paid', 'unpaid_reprice', 'review_gift', 'review_reminder'].includes(action), 'unsupported live action');

const config = loadConfig(env);
assert.equal(config.productAutomationExecutionMode, 'live');
assert.equal(config.productAutomationLiveConfirmed, true);

const runtime = createApp(config);
try {
  const order = await runtime.store.getOrder(adminId, orderNo, accountId);
  assert.ok(order, 'order not found in the scoped local store');
  assert.equal(order.accountId, accountId);
  assert.ok(order.productId, 'order is not linked to a local product');
  const normalizedBuyerNames = config.autoReplyTestBuyerNames.map(normalizeAutomationBuyerName);
  assert.ok(normalizedBuyerNames.includes(normalizeAutomationBuyerName(order.buyerName)), 'order buyer is not in the configured buyer allowlist');
  const automation = await runtime.productAutomation.get(adminId, order.productId);
  assert.equal(automation.product.accountId, accountId);

  const now = new Date().toISOString();
  const result = action === 'payment_paid' || action === 'unpaid_reprice'
    ? (await runtime.productAutomationTrigger.onOrderRefresh({ adminId, accountId, items: [order], requestId: `live-test:${orderNo}:${action}`, traceId: `live-test:${orderNo}:${action}` })).results[0]
    : action === 'review_gift'
      ? await runtime.productAutomationTrigger.onReviewEvent({ adminId, accountId, orderNo, eventId: env.REVIEW_EVENT_ID?.trim() || `live-test:${orderNo}:${Date.now()}`, requestId: `live-test:${orderNo}:review`, traceId: `live-test:${orderNo}:review` })
      : await runtime.productAutomationTrigger.onReviewReminder({ adminId, order, now, requestId: `live-test:${orderNo}:reminder`, traceId: `live-test:${orderNo}:reminder` });
  console.log(JSON.stringify({ action, orderNo, accountId, productTitle: automation.product.title, result }, null, 2));
} finally {
  await runtime.close();
}

function required(name) {
  const value = env[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
}
