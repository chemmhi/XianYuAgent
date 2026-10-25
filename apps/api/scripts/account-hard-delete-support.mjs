import { randomUUID } from 'node:crypto';
export async function seed(f) {
  const admin = await f.actor('delete-owner@example.com');
  const invited = await f.actor('delete-invited@example.com', 'user');
  const account = await f.runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: '880000000001', displayName: '删除回归账号' });
  const other = await f.runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'other', displayName: '保留账号' });
  const product = await f.runtime.store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'delete-product', title: '删除商品', categoryCode: 'digital', attributes: {}, priceMinor: 100, status: 'ready' });
  const otherProduct = await f.runtime.store.createProduct({ adminId: admin.id, accountId: other.id, externalProductRef: 'keep-product', title: '保留商品', categoryCode: 'digital', attributes: {}, priceMinor: 100, status: 'ready' });
  const conversation = await f.runtime.store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer' });
  await f.runtime.store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '需要清空的聊天内容' });
  const session = await f.runtime.store.createLoginSession({ adminId: admin.id, accountId: account.id, loginMethod: 'qr', expiresAt: new Date(Date.now() + 60_000).toISOString(), qrTokenRef: 'test-only' });
  await f.runtime.store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=880000000001; test=only' });
  await f.runtime.store.recordAudit({ id: randomUUID(), actorType: 'admin', actorId: admin.id, accountId: account.id, action: 'test.seed', targetRef: product.id, requestId: 'test', traceId: 'test', payloadDigest: 'test', createdAt: new Date().toISOString() });
  await f.runtime.store.beginIdempotency({ scope: `${admin.id}:${account.id}:POST:test`, key: 'old', requestFingerprint: 'test', status: 'processing', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const paths = [`coupons/${account.id}/old/file.png`, `products/${product.id}/xianyu/image.png`];
  for (const key of [...paths, `products/${otherProduct.id}/keep.png`]) await f.runtime.objectStorage.putObject({ key, body: Buffer.from('test image'), contentType: 'image/png' });
  if (f.db) {
    await f.db.pool.query("insert into coupons.coupon_batches(id,account_id,purpose) values($1,$2,'text')", [randomUUID(), account.id]);
    await f.db.pool.query("insert into orders.orders(account_id,order_no,item_id,buyer_id,buyer_name,item_title,amount_minor,payment_status,order_status,delivery_status,after_sales_status,delivery_type) values($1,'delete-order','item','buyer','buyer','test',100,'paid','open','pending','none','manual')", [account.id]);
    await f.db.pool.query("insert into settings.auto_reply_agent_account_configs(account_id,config_json,config_digest) values($1,'{}','test')", [account.id]);
    await f.db.pool.query("insert into workspace.agent_sessions(id,account_id,title) values($1,$2,'delete workspace')", [randomUUID(), account.id]);
    await f.db.pool.query("insert into automation.execution_ledger(execution_key,fingerprint,status) values($1,'test','running')", [`paid_auto_delivery:${account.id}:delete-order`]);
    await f.db.pool.query("insert into execution.outbox_jobs(scope,aggregate_type,aggregate_id,operation,idempotency_key,payload_json) values('test','test',$1,'test','test',$2)", [randomUUID(), { conversation: { accountId: account.id } }]);
  }
  return { admin, invited, account, other, product, otherProduct, conversation, session, paths };
}
