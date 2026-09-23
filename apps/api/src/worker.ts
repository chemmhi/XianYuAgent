import crypto from 'node:crypto';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { InboundInboxWorker } from './inbound-inbox-worker.js';

const config = loadConfig();
const runtime = createApp(config);
const workerId = `inbound-inbox:${process.pid}:${crypto.randomUUID()}`;
const worker = new InboundInboxWorker(runtime.store, runtime.xianyuIm, {
  workerId,
  batchSize: Number(process.env.INBOUND_INBOX_BATCH_SIZE ?? 10),
  leaseMs: Number(process.env.INBOUND_INBOX_LEASE_MS ?? 120_000),
  pollMs: Number(process.env.INBOUND_INBOX_POLL_MS ?? 1_000),
  maxAttempts: Number(process.env.INBOUND_INBOX_MAX_ATTEMPTS ?? 5),
});
const outcomeReviewWorkerId = `outcome-review:${process.pid}:${crypto.randomUUID()}`;
const outcomeReviewWorker = config.autoReplyOutcomeReviewWorkerEnabled && runtime.autoReplyRepair.currentMode !== 'off'
  ? runtime.autoReplyRepair.createOutcomeReviewWorker({
      workerId: outcomeReviewWorkerId,
      batchSize: config.autoReplyOutcomeReviewWorkerBatchSize,
      leaseSeconds: config.autoReplyOutcomeReviewWorkerLeaseSeconds,
      pollMs: config.autoReplyOutcomeReviewWorkerPollMs,
      onError: (error) => console.error('outcome review worker poll failed', error),
    })
  : undefined;
console.log(`xianyu-agent-worker started; redis=${config.redisUrl ?? 'not_configured'} workerId=${workerId} repairMode=${runtime.autoReplyRepair.currentMode} outcomeReviewWorker=${outcomeReviewWorker ? 'enabled' : 'disabled'}`);
worker.start();
outcomeReviewWorker?.start();
const shutdown = (signal: string) => {
  void (async () => {
    await outcomeReviewWorker?.stop();
    await worker.stop();
    await runtime.xianyuIm.close();
    await runtime.redisRealtime?.close();
    const close = (runtime.store as typeof runtime.store & { close?: () => Promise<void> }).close;
    if (close) await close.call(runtime.store);
    console.log(`worker received ${signal}, exiting`);
    process.exit(0);
  })().catch((error) => { console.error(error); process.exit(1); });
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
