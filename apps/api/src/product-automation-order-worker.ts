import type { AccountStatus, Store } from './domain.js';

export interface ProductAutomationOrderRefreshInput {
  adminId: string;
  accountId: string;
  pageSize?: number;
  maxPages?: number;
  requestId: string;
  traceId: string;
}

export interface ProductAutomationOrderRefreshWorkerOptions {
  enabled?: boolean;
  pollMs?: number;
  pageSize?: number;
  maxPages?: number;
  onError?: (error: unknown) => void;
}

export interface ProductAutomationOrderRefreshPollResult {
  refreshedAccounts: number;
  expiredReservations: number;
}

type RefreshOrders = (input: ProductAutomationOrderRefreshInput) => Promise<unknown>;

/**
 * Keeps order state moving without requiring an operator to open the order
 * page. Re-running the refresh callback is also the durable retry mechanism
 * for product automation executions marked retryable in the ledger.
 */
export class ProductAutomationOrderRefreshWorker {
  private readonly enabled: boolean;
  private readonly pollMs: number;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly onError: (error: unknown) => void;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<ProductAutomationOrderRefreshPollResult>;

  constructor(private readonly store: Store, private readonly refreshOrders: RefreshOrders, options: ProductAutomationOrderRefreshWorkerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.pollMs = Math.max(5_000, options.pollMs ?? 30_000);
    this.pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 100)));
    this.maxPages = Math.min(100, Math.max(1, Math.trunc(options.maxPages ?? 20)));
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

  async pollOnce(now = new Date().toISOString()): Promise<ProductAutomationOrderRefreshPollResult> {
    if (!this.enabled) return { refreshedAccounts: 0, expiredReservations: 0 };
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.pollAllAccounts(now).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async pollAllAccounts(now: string): Promise<ProductAutomationOrderRefreshPollResult> {
    let refreshedAccounts = 0;
    let expiredReservations = 0;
    try {
      expiredReservations = await this.store.cleanupExpiredCouponReservations();
    } catch (error) {
      this.onError({ scope: 'coupon_reservation_cleanup', error });
    }
    for (const adminId of await this.store.listAdminIds()) {
      const admin = await this.store.findAdminById(adminId);
      if (!admin || admin.status !== 'active') continue;
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const accounts = await this.store.listAccounts(adminId, { page, pageSize: 100 });
        totalPages = accounts.totalPages;
        for (const account of accounts.items) {
          if (!isRefreshEligible(account.status)) continue;
          const requestId = `automation:scheduler:orders:${account.id}:${now}`;
          try {
            await this.refreshOrders({ adminId, accountId: account.id, pageSize: this.pageSize, maxPages: this.maxPages, requestId, traceId: requestId });
            refreshedAccounts += 1;
          } catch (error) {
            this.onError({ scope: 'order_refresh', adminId, accountId: account.id, error });
          }
        }
        page += 1;
      }
    }
    return { refreshedAccounts, expiredReservations };
  }
}

function isRefreshEligible(status: AccountStatus): boolean {
  return status === 'connected' || status === 'degraded' || status === 'disconnected';
}
