// Isolated child-process fixture. Never use production endpoints or credentials.
import { WebSocket } from 'ws';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { XianyuImClient } from '../../src/xianyu-im.js';
import { AutomationWorkflowService, PersistentAutomationExecutionLedger } from '../../src/product-automation.js';
import { XianyuProductAutomationExecutionAdapter } from '../../src/product-automation-xianyu.js';
import { IM_OWNER_RPC_PATH } from '../../src/xianyu-im-owner-rpc.js';

const config = loadConfig();
const db = new URL(config.databaseUrl!);
if (!['localhost', '127.0.0.1'].includes(db.hostname) || db.pathname !== '/xianyu_im_owner_test') throw new Error('ISOLATED_DATABASE_REQUIRED');
const role = process.env.IM_TEST_ROLE;
let localSocketAttempts = 0;
if (role === 'owner') {
  const gateway = new URL(process.env.IM_TEST_GATEWAY!);
  if (gateway.hostname !== '127.0.0.1') throw new Error('ISOLATED_GATEWAY_REQUIRED');
  const original = (XianyuImClient.prototype as any).setupSocket;
  (XianyuImClient.prototype as any).setupSocket = function () {
    this.webSocketFactory = () => new WebSocket(gateway.toString());
    return original.call(this);
  };
} else {
  XianyuImClient.prototype.connect = async () => { localSocketAttempts++; throw new Error('WORKER_SOCKET_FORBIDDEN'); };
}
const app = createApp(config, role === 'owner' ? {} : { verificationRecoveryOwner: false, imOwnerUrl: process.env.XIANYU_IM_OWNER_URL });
let uploads = 0, shipments = 0, dropSendReceiptAfter: number | undefined;
app.xianyu.uploadChatImage = async () => { uploads++; return { success: true, accountInvalid: false, url: 'https://controlled.invalid/test.png', width: 1, height: 1, cookieHeader: '' }; };
// Drop the HTTP receipt after the owner's durable send result has been stored.
if (role === 'owner') app.server.prependListener('request', (req, res) => {
  if (req.url !== IM_OWNER_RPC_PATH || dropSendReceiptAfter === undefined) return;
  const end = res.end;
  res.end = ((body: string) => {
    if (JSON.parse(body).result?.externalMessageRef && dropSendReceiptAfter !== undefined && dropSendReceiptAfter-- === 0) {
      dropSendReceiptAfter = undefined; res.destroy(); return res;
    }
    return end.call(res, body);
  }) as typeof res.end;
});
if (role === 'owner') await app.listen();
process.send?.({ ready: true, pid: process.pid, url: role === 'owner' ? `http://127.0.0.1:${(app.server.address() as { port: number }).port}` : undefined });
process.on('message', (input: any) => {
  void (async () => {
    let result: unknown;
    if (input.op === 'close') {
      await app.close(); process.send?.({ id: input.id, result: true }); process.disconnect(); return;
    }
    if (input.op === 'drop') { dropSendReceiptAfter = input.after ?? 0; result = true; }
    else if (input.op === 'stats') result = { uploads, shipments, localSocketAttempts, clients: (app.xianyuIm as any).clients.size };
    else if (input.op === 'call') result = await (app.xianyuIm as any)[input.method](...input.args);
    else if (input.op === 'delivery') {
      const order = input.order;
      app.xianyu.fetchOrderCandidates = async () => ({ success: true, accountInvalid: false, items: [order], cookieHeader: '' });
      app.xianyu.readOrderDetail = async () => ({ success: true, accountInvalid: false, detail: order, cookieHeader: '' });
      app.xianyu.confirmShipment = async () => { shipments++; return { status: 'succeeded', externalRef: 'shipment-test', cookieHeader: '' }; };
      const adapter = new XianyuProductAutomationExecutionAdapter(app.store, () => app.xianyu, () => app.xianyuIm);
      const workflow = new AutomationWorkflowService(adapter, new PersistentAutomationExecutionLedger(app.store));
      result = await workflow.handlePaymentPaid({ adminId: input.adminId, config: input.config, order, eventId: input.eventId });
    }
    process.send?.({ id: input.id, result: result ?? null });
  })().catch(error => process.send?.({ id: input.id, error: { code: error.code, message: error.message } }));
});
