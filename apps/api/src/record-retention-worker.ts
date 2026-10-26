import type { Store } from './domain.js';
import { cleanupBatchLimit, retentionCutoff } from './record-retention-policy.js';

type RetentionStore = Pick<Store, 'cleanupInboundQuarantine' | 'cleanupAuditEvents'>;
export interface RecordRetentionOptions {
  enabled?: boolean;
  pollMs?: number;
  batchSize?: number;
  maxBatches?: number;
  onError?: (error: unknown) => void;
}

export class RecordRetentionWorker {
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<{ cutoff: string; quarantineDeleted: number; auditDeleted: number }>;
  private stopping = false;
  private readonly batchSize: number;
  private readonly maxBatches: number;

  constructor(private readonly store: RetentionStore, private readonly options: RecordRetentionOptions = {}) {
    this.batchSize = cleanupBatchLimit(options.batchSize);
    this.maxBatches = Number.isFinite(options.maxBatches) ? Math.max(1, Math.min(100, Math.trunc(options.maxBatches!))) : 20;
  }

  start(): void {
    if (this.options.enabled === false || this.timer) return;
    this.stopping = false;
    const poll = () => { void this.pollOnce().catch(error => this.options.onError?.(error)); };
    poll();
    const requested = this.options.pollMs ?? 60_000;
    this.timer = setInterval(poll, Number.isFinite(requested) ? Math.max(5000, requested) : 60_000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  async pollOnce(now = new Date().toISOString()): Promise<{ cutoff: string; quarantineDeleted: number; auditDeleted: number }> {
    if (this.inFlight) return this.inFlight;
    const cutoff = retentionCutoff(now);
    if (this.options.enabled === false || this.stopping) return { cutoff, quarantineDeleted: 0, auditDeleted: 0 };
    this.inFlight = this.cleanup(cutoff).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async cleanup(cutoff: string) {
    const drain = async (table: string, remove: RetentionStore['cleanupAuditEvents']) => {
      let deleted = 0;
      const deadline = Date.now() + 15_000;
      for (let batch = 0; batch < this.maxBatches && !this.stopping && Date.now() < deadline; batch++) {
        const count = await remove({ createdBefore: cutoff, limit: this.batchSize });
        deleted += count;
        if (count < this.batchSize) break;
      }
      if (deleted) console.log(JSON.stringify({ component: 'record-retention-worker', table, deleted, cutoff }));
      return deleted;
    };
    // A failure in one table must not prevent the other from being cleaned.
    const results = await Promise.allSettled([
      drain('quarantine', input => this.store.cleanupInboundQuarantine(input)),
      drain('audit', input => this.store.cleanupAuditEvents(input)),
    ]);
    const errors = results.filter(result => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map(result => result.reason), 'RECORD_RETENTION_FAILED');
    return { cutoff, quarantineDeleted: (results[0] as PromiseFulfilledResult<number>).value,
      auditDeleted: (results[1] as PromiseFulfilledResult<number>).value };
  }
}
