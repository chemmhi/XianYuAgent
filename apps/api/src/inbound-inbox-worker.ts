import { digestJson } from './security.js';
import type { InboundInboxRecord, Store } from './domain.js';

export interface InboundInboxHandler {
  processInboundInbox(record: InboundInboxRecord): Promise<unknown>;
}

export interface InboundInboxWorkerOptions {
  workerId: string;
  batchSize?: number;
  leaseMs?: number;
  pollMs?: number;
  maxAttempts?: number;
}

export class InboundInboxWorker {
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly maxAttempts: number;
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private running?: Promise<void>;

  constructor(private readonly store: Store, private readonly handler: InboundInboxHandler, private readonly options: InboundInboxWorkerOptions) {
    this.batchSize = Math.max(1, Math.min(options.batchSize ?? 10, 100));
    this.leaseMs = Math.max(5_000, Math.min(options.leaseMs ?? 120_000, 300_000));
    this.pollMs = Math.max(250, Math.min(options.pollMs ?? 1_000, 30_000));
    this.maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 5, 20));
  }

  async pollOnce(): Promise<number> {
    await this.store.reapExpiredInboundInbox();
    const claimed = await this.store.claimInboundInbox({ workerId: this.options.workerId, limit: this.batchSize, leaseMs: this.leaseMs });
    await Promise.all(claimed.map((record) => this.processRecord(record)));
    return claimed.length;
  }

  start(): void {
    if (this.running) return;
    this.stopping = false;
    this.running = this.loop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
    this.running = undefined;
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        const processed = await this.pollOnce();
        if (processed > 0) console.log(JSON.stringify({ component: 'inbound-inbox-worker', event: 'batch_processed', workerId: this.options.workerId, count: processed }));
      } catch (error) {
        console.warn(JSON.stringify({ component: 'inbound-inbox-worker', event: 'poll_failed', workerId: this.options.workerId, errorCode: errorCode(error) }));
      }
      if (this.stopping) break;
      await new Promise<void>((resolve) => { this.timer = setTimeout(resolve, this.pollMs); });
      this.timer = undefined;
    }
  }

  private async processRecord(record: InboundInboxRecord): Promise<void> {
    const heartbeat = setInterval(() => { void this.store.heartbeatInboundInbox({ id: record.id, workerId: this.options.workerId, leaseMs: this.leaseMs }); }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
    try {
      const result = await this.handler.processInboundInbox(record);
      const retryCode = retryableResultCode(result);
      if (retryCode) {
        await this.reschedule(record, retryCode, digestJson({ code: retryCode, source: 'auto_reply_run' }));
        return;
      }
      const acked = await this.store.ackInboundInbox({ id: record.id, workerId: this.options.workerId });
      if (!acked) console.warn(JSON.stringify({ component: 'inbound-inbox-worker', event: 'ack_lost_lease', workerId: this.options.workerId, inboxId: record.id }));
    } catch (error) {
      const code = errorCode(error);
      const digest = digestJson({ code, message: error instanceof Error ? error.message : String(error) });
      await this.reschedule(record, code, digest);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async reschedule(record: InboundInboxRecord, code: string, digest: string): Promise<void> {
    if (record.attempt >= this.maxAttempts) {
      await this.store.deadLetterInboundInbox({ id: record.id, workerId: this.options.workerId, errorCode: code, errorDigest: digest });
      return;
    }
    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(record.attempt - 1, 6));
    await this.store.retryInboundInbox({ id: record.id, workerId: this.options.workerId, errorCode: code, errorDigest: digest, availableAt: new Date(Date.now() + delayMs).toISOString() });
  }
}

function errorCode(error: unknown): string {
  const candidate = error as { code?: unknown } | null;
  if (typeof candidate?.code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(candidate.code)) return candidate.code;
  if (error instanceof Error && error.name) return error.name.toUpperCase().replace(/[^A-Z0-9_:-]/g, '_');
  return 'INBOUND_INBOX_PROCESS_FAILED';
}

function retryableResultCode(result: unknown): string | undefined {
  const run = (result as { run?: { status?: unknown; failureCode?: unknown } } | null)?.run;
  if (run?.status !== 'failed') return undefined;
  const code = typeof run.failureCode === 'string' ? run.failureCode : 'AUTO_REPLY_FAILED';
  if (code === 'AUTO_REPLY_SEND_UNKNOWN' || code === 'AUTO_REPLY_SEND_FAILED' || code === 'AGENT_TOTAL_TIMEOUT' || code === 'AUTO_REPLY_FAILED' || code.startsWith('MODEL_')) return code;
  return undefined;
}
