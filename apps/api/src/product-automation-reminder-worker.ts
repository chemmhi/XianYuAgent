import type { Store } from './domain.js';
import type { ProductAutomationTriggerBatchResult, ProductAutomationWorker } from './product-automation-trigger.js';

export interface ProductAutomationReminderWorkerOptions {
  enabled?: boolean;
  pollMs?: number;
  onError?: (error: unknown) => void;
}

export interface ProductAutomationReminderPollResult {
  processed: number;
  results: ProductAutomationTriggerBatchResult['results'];
}

export class ProductAutomationReminderWorker {
  private readonly enabled: boolean;
  private readonly pollMs: number;
  private readonly onError: (error: unknown) => void;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<ProductAutomationReminderPollResult>;

  constructor(private readonly store: Store, private readonly automation: ProductAutomationWorker, options: ProductAutomationReminderWorkerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.pollMs = Math.max(5_000, options.pollMs ?? 60_000);
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

  async pollOnce(now = new Date().toISOString()): Promise<ProductAutomationReminderPollResult> {
    if (!this.enabled) return { processed: 0, results: [] };
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.pollAllAccounts(now).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async pollAllAccounts(now: string): Promise<ProductAutomationReminderPollResult> {
    const results: ProductAutomationTriggerBatchResult['results'] = [];
    for (const adminId of await this.store.listAdminIds()) {
      const admin = await this.store.findAdminById(adminId);
      if (!admin || admin.status !== 'active') continue;
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const accounts = await this.store.listAccounts(adminId, { page, pageSize: 100 });
        totalPages = accounts.totalPages;
        for (const account of accounts.items) {
          // Degraded/disconnected accounts may still recover their IM session
          // during the attempt. Only skip accounts that cannot be acted on.
          if (account.status === 'disabled' || account.status === 'expired' || account.status === 'pending') continue;
          try {
            const batch = await this.automation.pollReviewReminders({ adminId, accountId: account.id, now });
            results.push(...batch.results);
          } catch (error) {
            this.onError({ adminId, accountId: account.id, error });
          }
        }
        page += 1;
      }
    }
    return { processed: results.length, results };
  }
}
