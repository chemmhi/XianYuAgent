import type { Store } from './domain.js';

export interface InboundQuarantineCleanupWorkerOptions {
  enabled?: boolean;
  pollMs?: number;
  retentionDays?: number;
  batchSize?: number;
  onError?: (error: unknown) => void;
}

export interface InboundQuarantineCleanupPollResult {
  deleted: number;
  cutoff: string;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export class InboundQuarantineCleanupWorker {
  private readonly enabled: boolean;
  private readonly pollMs: number;
  private readonly retentionDays: number;
  private readonly batchSize: number;
  private readonly onError: (error: unknown) => void;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<InboundQuarantineCleanupPollResult>;

  constructor(private readonly store: Store, options: InboundQuarantineCleanupWorkerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.pollMs = clamp(options.pollMs ?? 5 * 60 * 1_000, 5_000, 7 * DAY_MS);
    this.retentionDays = clamp(options.retentionDays ?? 7, 1, 3650);
    this.batchSize = clamp(options.batchSize ?? 10_000, 1, 50_000);
    this.onError = options.onError ?? (() => undefined);
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    void this.pollOnce().catch((error) => this.onError(error));
    this.timer = setInterval(() => { void this.pollOnce().catch((error) => this.onError(error)); }, this.pollMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  async pollOnce(now = new Date().toISOString()): Promise<InboundQuarantineCleanupPollResult> {
    if (!this.enabled) return { deleted: 0, cutoff: now };
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.cleanup(now).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async cleanup(now: string): Promise<InboundQuarantineCleanupPollResult> {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new Error('INBOUND_QUARANTINE_CLEANUP_TIME_INVALID');
    const cutoff = new Date(nowMs - this.retentionDays * DAY_MS).toISOString();
    const deleted = await this.store.cleanupInboundQuarantine({ createdBefore: cutoff, limit: this.batchSize });
    if (deleted > 0) console.log(JSON.stringify({ component: 'inbound-quarantine-cleanup-worker', event: 'batch_deleted', deleted, cutoff, retentionDays: this.retentionDays }));
    return { deleted, cutoff };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.trunc(value) : min));
}
