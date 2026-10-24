import { PostgresStore } from './store-postgres.js';
import { loadConfig } from './config.js';
import { XianyuImOwnerClient } from './xianyu-im-owner-rpc.js';
import { XianyuMtopClient } from './xianyu-mtop.js';
import { XianyuProductAutomationExecutionAdapter } from './product-automation-xianyu.js';

async function main(): Promise<void> {
  const orderNo = process.argv.find((arg) => arg.startsWith('--order-no='))?.slice(11);
  const accountId = process.argv.find((arg) => arg.startsWith('--account-id='))?.slice(13);
  const apply = process.argv.includes('--apply');
  if (!orderNo || !accountId || !process.env.DATABASE_URL) throw new Error('order-no, account-id and DATABASE_URL are required');
  const store = new PostgresStore(process.env.DATABASE_URL);
  const config = loadConfig();
  const im = new XianyuImOwnerClient(process.env.XIANYU_IM_OWNER_URL?.trim() || `http://127.0.0.1:${config.port}`, config.credentialEncryptionKey);
  try {
    const executionKey = `paid_auto_delivery:${accountId}:${orderNo}`;
    const reservation = await store.pool.query('select admin_id from coupons.coupon_reservations where account_id=$1 and execution_key=$2', [accountId, executionKey]);
    if (reservation.rows.length !== 1) throw new Error('DELIVERY_RECOVERY_RESERVATION_NOT_FOUND');
    const adminId = String(reservation.rows[0].admin_id);
    const order = await store.getOrder(adminId, orderNo, accountId);
    const account = await store.getAccount(adminId, accountId);
    const credential = await store.getCredential(adminId, accountId);
    if (!order?.conversationId || !account || !credential?.cookieHeader) throw new Error('DELIVERY_RECOVERY_SCOPE_OR_CREDENTIAL_MISSING');
    const conversation = await store.getConversation(adminId, order.conversationId);
    if (!conversation?.externalConversationRef || conversation.accountId !== accountId || conversation.buyerRef !== order.buyerId) throw new Error('DELIVERY_RECOVERY_CONVERSATION_MISMATCH');
    const steps = await store.pool.query('select step_key,created_at,updated_at from orders.delivery_send_steps where account_id=$1 and order_no=$2', [accountId, orderNo]);
    if (steps.rows.length !== 1 || !String(steps.rows[0].step_key).endsWith(':image:0')) throw new Error('DELIVERY_RECOVERY_STEP_MISMATCH');
    const step = steps.rows[0];
    const messages = await store.pool.query(`select external_message_ref,body_ref from messages.messages where account_id=$1 and conversation_id=$2
      and direction='outbound' and body_type='image' and external_message_ref is not null
      and created_at between $3::timestamptz - interval '2 seconds' and $4::timestamptz + interval '5 seconds'`,
    [accountId, order.conversationId, step.created_at, step.updated_at]);
    if (messages.rows.length !== 1 || !messages.rows[0].body_ref) throw new Error('DELIVERY_RECOVERY_LOCAL_IMAGE_AMBIGUOUS');
    const imageRef = String(messages.rows[0].external_message_ref);
    const imageUrl = String(messages.rows[0].body_ref);
    const mtop = new XianyuMtopClient({ loadCredential: (admin, accountRef) => store.getCredential(admin, accountRef), saveCookie: async () => undefined });
    const authoritative = await new XianyuProductAutomationExecutionAdapter(store, () => mtop, () => undefined).readOrder({ adminId, accountId, orderNo, productId: order.productId, itemId: order.itemId });
    if (!authoritative || authoritative.paymentStatus !== 'paid' || authoritative.orderStatus !== 'open'
      || authoritative.deliveryStatus !== 'pending' || authoritative.afterSalesStatus !== 'none') throw new Error('DELIVERY_RECOVERY_PLATFORM_ORDER_MISMATCH');
    if (!await im.call('verifyPartialDeliveryImage', [adminId, accountId, order.conversationId,
      { externalMessageRef: imageRef, imageUrl, startedAt: new Date(step.created_at).toISOString() }])) throw new Error('DELIVERY_RECOVERY_PLATFORM_HISTORY_MISMATCH');
    if (apply) await store.resumeVerifiedPartialDelivery({ adminId, accountId, orderNo, executionKey, stepKey: String(step.step_key), externalMessageRef: imageRef });
    console.info(JSON.stringify({ orderNo, accountId, imageRef, platformOrderVerified: true, platformHistoryVerified: true, result: apply ? 'queued_missing_steps' : 'ready_to_resume' }));
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'partial_delivery_recovery_failed', errorCode: error instanceof Error ? error.message.slice(0, 120) : 'UNKNOWN' }));
  process.exitCode = 1;
});
